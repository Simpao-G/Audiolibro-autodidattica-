import type { SpeakOptions, TtsEngine, VoiceInfo } from './engine';

/** Frasi già convertite in audio tenute in memoria. */
const CACHE_SIZE = 16;

type QueueItem = { key: string; text: string; urgent: boolean; resolve: (url: string) => void; reject: (e: Error) => void };

/**
 * Base per i motori che generano un file audio per ogni frase (voce AI offline, voci neurali).
 * Gestisce: coda di generazione con priorità, anticipo delle frasi successive, cache,
 * riproduzione con un unico elemento <audio> (continua a schermo bloccato), velocità e volume.
 */
export abstract class ClipEngine implements TtsEngine {
  abstract readonly name: string;
  abstract isSupported(): boolean;
  abstract getVoices(): Promise<VoiceInfo[]>;

  /** Identifica la voce attuale (fa parte della chiave della cache). */
  protected abstract voiceKey(): string;
  /** Prepara il motore prima di leggere; lancia un errore comprensibile se non è possibile. */
  protected abstract prepare(): Promise<void>;
  /** Genera l'audio di una frase. */
  protected abstract generate(text: string): Promise<Blob>;
  /** Se ha senso preparare in anticipo le frasi successive. */
  protected abstract canPrefetch(): boolean;

  private cache = new Map<string, Promise<string>>();
  private urls = new Map<string, string>();
  private queue: QueueItem[] = [];
  private busy = false;
  private audio: HTMLAudioElement | null = null;
  private token = 0;
  private finish: (() => void) | null = null;
  private playingKey: string | null = null;
  /** Mentre una frase da leggere subito si sta preparando, le anticipazioni aspettano. */
  private holdPrefetch = false;

  async speak(text: string, opts: SpeakOptions): Promise<void> {
    this.stop();
    const token = this.token;
    this.holdPrefetch = true;
    try {
      await this.prepare();
    } catch (e) {
      this.holdPrefetch = false;
      throw e;
    }
    if (token !== this.token) return;
    const key = this.keyFor(text);
    const pending = this.synthesize(text, true);
    this.holdPrefetch = false;
    this.pump();
    const url = await pending;
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
    this.holdPrefetch = false;
    this.audio?.pause();
    this.finish?.();
  }

  prefetch(texts: string[]): void {
    if (!this.canPrefetch()) return;
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

  /** Svuota cache e coda (es. quando cambia la voce). */
  protected clearCache(): void {
    for (const q of this.queue) q.reject(new Error('Voce cambiata'));
    this.queue = [];
    this.cache.clear();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  protected resetQueue(): void {
    this.busy = false;
    this.clearCache();
  }

  private keyFor(text: string): string {
    return `${this.voiceKey()}|${text}`;
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
      const item = { key, text, urgent, resolve, reject };
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
    if (this.busy || !this.queue.length) return;
    if (this.holdPrefetch && !this.queue[0].urgent) return;
    const item = this.queue.shift()!;
    this.busy = true;
    try {
      const url = URL.createObjectURL(await this.generate(item.text));
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
