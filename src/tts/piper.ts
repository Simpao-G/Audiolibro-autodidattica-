import type { SpeakOptions, TtsEngine, VoiceInfo } from './engine';
import type { WorkerRequest, WorkerResponse } from './piper.worker';

export interface PiperVoice {
  id: string;
  name: string;
  description: string;
  sizeMB: number;
}

/** Voci italiane disponibili per Piper (modelli open source, licenza libera). */
export const PIPER_VOICES: PiperVoice[] = [
  { id: 'it_IT-paola-medium', name: 'Paola', description: 'femminile, qualità buona', sizeMB: 63 },
  { id: 'it_IT-riccardo-x_low', name: 'Riccardo', description: 'maschile, qualità base ma più veloce', sizeMB: 28 },
];

/** File del motore (ONNX Runtime + fonetica), scaricati una volta insieme alla prima voce. */
export const ENGINE_FILES_MB = 34;

/** Frasi già convertite in audio tenute in memoria. */
const CACHE_SIZE = 16;

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (p: number) => void };
type QueueItem = { key: string; text: string; resolve: (url: string) => void; reject: (e: Error) => void };

/**
 * Motore "voce AI": genera l'audio di ogni frase nel browser con Piper (in un Web Worker)
 * e lo riproduce con un elemento <audio>. Così la lettura può continuare a schermo bloccato
 * e compare nei controlli multimediali del telefono.
 */
export class PiperEngine implements TtsEngine {
  readonly name = 'Voce AI (Piper)';
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyVoice: string | null = null;
  private loading: { voice: string; promise: Promise<void> } | null = null;
  private cache = new Map<string, Promise<string>>();
  private urls = new Map<string, string>();
  private queue: QueueItem[] = [];
  private busy = false;
  private audio: HTMLAudioElement | null = null;
  private token = 0;
  private finish: (() => void) | null = null;
  private playingKey: string | null = null;

  constructor(private getVoiceId: () => string) {}

  isSupported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && !!navigator.storage?.getDirectory;
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return PIPER_VOICES.map((v) => ({ id: v.id, name: v.name, lang: 'it-IT', quality: 'alta', local: true }));
  }

  /** Voci già scaricate sul dispositivo. */
  async downloadedVoices(): Promise<string[]> {
    try {
      const { stored } = await import('@mintplex-labs/piper-tts-web');
      return (await stored()) as string[];
    } catch {
      return [];
    }
  }

  async isDownloaded(voiceId: string): Promise<boolean> {
    return (await this.downloadedVoices()).includes(voiceId);
  }

  /** Scarica (se serve) e carica la voce. onProgress riceve un valore da 0 a 1. */
  ensureReady(voiceId = this.getVoiceId(), onProgress?: (p: number) => void): Promise<void> {
    if (this.readyVoice === voiceId) return Promise.resolve();
    if (this.loading?.voice === voiceId) return this.loading.promise;
    this.clearCache();
    this.readyVoice = null;
    const wasmBase = new URL(`${import.meta.env.BASE_URL}wasm/`, location.href).href;
    const promise = this.call({ type: 'init', voiceId, wasmBase }, onProgress)
      .then(() => {
        this.readyVoice = voiceId;
      })
      .finally(() => {
        if (this.loading?.promise === promise) this.loading = null;
      });
    this.loading = { voice: voiceId, promise };
    return promise;
  }

  async removeVoice(voiceId: string): Promise<void> {
    if (this.readyVoice === voiceId || this.loading?.voice === voiceId) this.resetWorker();
    const { remove } = await import('@mintplex-labs/piper-tts-web');
    await remove(voiceId);
  }

  async speak(text: string, opts: SpeakOptions): Promise<void> {
    this.stop();
    const token = this.token;
    const voice = this.getVoiceId();
    if (this.readyVoice !== voice) {
      if (!(await this.isDownloaded(voice))) {
        throw new Error('La voce AI non è ancora scaricata: aprila nelle impostazioni e premi “Scarica”');
      }
      await this.ensureReady(voice);
    }
    const key = this.keyFor(text);
    const url = await this.synthesize(text, true);
    if (token !== this.token) return;
    const audio = this.getAudio();
    return new Promise<void>((resolve, reject) => {
      const done = (err?: Error) => {
        if (this.finish !== fin) return;
        this.finish = null;
        this.playingKey = null;
        audio.onended = audio.onerror = audio.onplaying = null;
        if (err) reject(err);
        else resolve();
      };
      const fin = () => done();
      this.finish = fin;
      this.playingKey = key;
      audio.onended = () => done();
      audio.onerror = () => done(new Error('Errore nella riproduzione audio'));
      audio.onplaying = () => opts.onStart?.();
      audio.src = url;
      // Il cambio di sorgente riporta la velocità a defaultPlaybackRate: le impostiamo entrambe.
      audio.defaultPlaybackRate = opts.rate;
      audio.playbackRate = opts.rate;
      audio.volume = opts.volume;
      audio.play().catch((e: DOMException) => {
        if (e.name === 'AbortError') return;
        done(new Error(e.name === 'NotAllowedError' ? 'Il browser ha bloccato l’audio: premi di nuovo Play' : e.message));
      });
    });
  }

  stop(): void {
    this.token++;
    this.audio?.pause();
    this.finish?.();
  }

  prefetch(texts: string[]): void {
    if (this.readyVoice !== this.getVoiceId()) return;
    const wanted = new Set(texts.map((t) => this.keyFor(t)));
    // Scarta le frasi in coda che non servono più (es. dopo un salto di capitolo).
    this.queue = this.queue.filter((q) => {
      if (wanted.has(q.key)) return true;
      this.cache.delete(q.key);
      return false;
    });
    for (const t of texts) this.synthesize(t, false).catch(() => {});
  }

  unlock(): void {
    // Su iOS/Safari l'audio può partire solo da un tocco: facciamo "play" di un silenzio
    // sullo stesso elemento, così le frasi successive potranno partire da sole.
    const audio = this.getAudio();
    if (!audio.paused) return;
    audio.src = SILENCE;
    audio.play().catch(() => {});
  }

  updateLive(opts: Pick<SpeakOptions, 'rate' | 'volume'>): void {
    if (!this.audio) return;
    this.audio.defaultPlaybackRate = opts.rate;
    this.audio.playbackRate = opts.rate;
    this.audio.volume = opts.volume;
  }

  // ---------- interni ----------

  private keyFor(text: string): string {
    return `${this.getVoiceId()}|${text}`;
  }

  private getAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      (this.audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    }
    return this.audio;
  }

  /** Restituisce l'URL dell'audio per una frase, generandolo se serve. */
  private synthesize(text: string, urgent: boolean): Promise<string> {
    const key = this.keyFor(text);
    const cached = this.cache.get(key);
    if (cached) {
      if (urgent) {
        const i = this.queue.findIndex((q) => q.key === key);
        if (i > 0) this.queue.unshift(...this.queue.splice(i, 1));
      }
      return cached;
    }
    const promise = new Promise<string>((resolve, reject) => {
      const item = { key, text, resolve, reject };
      if (urgent) this.queue.unshift(item);
      else this.queue.push(item);
    });
    this.cache.set(key, promise);
    promise.catch(() => this.cache.delete(key));
    this.evict();
    this.pump();
    return promise;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    const item = this.queue.shift();
    if (!item) return;
    this.busy = true;
    try {
      const res = await this.call({ type: 'predict', text: item.text });
      if (res.type !== 'audio') throw new Error('Risposta inattesa dalla voce AI');
      const url = URL.createObjectURL(res.wav);
      this.urls.set(item.key, url);
      item.resolve(url);
    } catch (e) {
      item.reject(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.busy = false;
      this.pump();
    }
  }

  private evict(): void {
    for (const key of this.cache.keys()) {
      if (this.cache.size <= CACHE_SIZE) break;
      if (key === this.playingKey || this.queue.some((q) => q.key === key)) continue;
      this.cache.delete(key);
      const url = this.urls.get(key);
      if (url) URL.revokeObjectURL(url);
      this.urls.delete(key);
    }
  }

  private clearCache(): void {
    for (const q of this.queue) q.reject(new Error('Voce cambiata'));
    this.queue = [];
    this.cache.clear();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        const p = this.pending.get(msg.id);
        if (!p) return;
        if (msg.type === 'progress') {
          p.onProgress?.(msg.total ? msg.loaded / msg.total : 0);
          return;
        }
        this.pending.delete(msg.id);
        if (msg.type === 'error') p.reject(new Error(msg.message));
        else p.resolve(msg);
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.failAll(new Error(`Errore della voce AI: ${e.message || 'impossibile avviare il motore'}`));
        this.resetWorker();
      };
    }
    return this.worker;
  }

  private call(req: Omit<Extract<WorkerRequest, { type: 'init' }>, 'id'> | Omit<Extract<WorkerRequest, { type: 'predict' }>, 'id'>, onProgress?: (p: number) => void): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.getWorker().postMessage({ ...req, id } as WorkerRequest);
    });
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private resetWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new Error('Motore vocale riavviato'));
    this.readyVoice = null;
    this.loading = null;
    this.busy = false;
    this.clearCache();
  }
}

/** 0,1 secondi di silenzio in WAV (usato per sbloccare l'audio su iOS). */
const SILENCE = (() => {
  const rate = 8000;
  const n = rate / 10;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  let bin = '';
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
})();
