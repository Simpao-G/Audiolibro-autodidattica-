import { ClipEngine } from '../clip';
import type { VoiceInfo } from '../engine';
import { download, isDownloaded, remove, TOTAL_MB, VOICE_IDS, type VoiceId } from './assets';
import type { StRequest, StResponse } from './supertonic.worker';

export { TOTAL_MB as SUPERTONIC_MB };

export const SUPERTONIC_VOICES: { id: VoiceId; name: string; description: string }[] = VOICE_IDS.map((id) => ({
  id,
  name: `${id.startsWith('F') ? 'Voce femminile' : 'Voce maschile'} ${id.slice(1)}`,
  description: id.startsWith('F') ? 'femminile' : 'maschile',
}));

type Pending = { resolve: (r: StResponse) => void; reject: (e: Error) => void };

/**
 * Voce AI HD offline: Supertonic 3, modello neurale (~380 MB) eseguito nel browser in un Web Worker.
 * Qualità molto più alta di Piper; dopo il primo download funziona senza internet.
 */
export class SupertonicEngine extends ClipEngine {
  readonly name = 'Voce AI HD (Supertonic)';
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;
  /** Passi di generazione: più passi = più qualità ma più lento (8 = massima qualità, minimo 6). */
  steps = 8;
  /** Ultimo tempo di generazione (ms). */
  lastMs = 0;
  /** 'webgpu' = scheda grafica, 'wasm' = processore (noto dopo il primo caricamento). */
  backend: string | null = null;

  constructor(private getVoiceId: () => string) {
    super();
  }

  isSupported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && 'caches' in self;
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return SUPERTONIC_VOICES.map((v) => ({ id: v.id, name: v.name, lang: 'it-IT', quality: 'alta', local: true }));
  }

  isDownloaded(): Promise<boolean> {
    return isDownloaded();
  }

  /** Scarica il modello (una volta sola). onProgress: da 0 a 1. */
  async download(onProgress?: (p: number) => void): Promise<void> {
    await download(onProgress);
  }

  /** Carica il modello in anticipo (es. all'apertura di un libro), se è già scaricato. */
  preload(): void {
    this.prepare().catch(() => {});
  }

  async removeModel(): Promise<void> {
    this.resetWorker();
    await remove();
  }

  protected voiceKey(): string {
    return `supertonic:${this.getVoiceId()}`;
  }

  protected canPrefetch(): boolean {
    return this.ready !== null;
  }

  protected async prepare(): Promise<void> {
    if (!this.ready) {
      if (!(await isDownloaded())) {
        throw new Error('La voce AI HD non è ancora scaricata: apri “Voce” e premi “Scarica”');
      }
      const wasmBase = new URL(`${import.meta.env.BASE_URL}wasm/`, location.href).href;
      this.ready = this.call({ type: 'init', wasmBase })
        .then((r) => {
          if (r.type === 'ready') this.backend = r.backend;
        })
        .catch((e) => {
          this.ready = null;
          throw e;
        });
    }
    await this.ready;
  }

  protected async generate(text: string): Promise<Blob> {
    const res = await this.call({ type: 'predict', text, voice: this.getVoiceId(), steps: this.steps });
    if (res.type !== 'audio') throw new Error('Risposta inattesa dalla voce AI HD');
    this.lastMs = res.ms;
    // Qualità adattiva: se il dispositivo genera troppo lentamente rispetto alla durata
    // dell'audio, riduce un po' i passi (mai sotto 6); se è veloce, torna alla massima qualità.
    const ratio = res.ms / Math.max(1, res.audioMs);
    if (ratio > 0.6 && this.steps > 6) this.steps--;
    else if (ratio < 0.3 && this.steps < 8) this.steps++;
    return res.wav;
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./supertonic.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<StResponse>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.type === 'error') p.reject(new Error(e.data.message));
        else p.resolve(e.data);
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        const err = new Error(`Errore della voce AI HD: ${e.message || 'memoria insufficiente o browser non compatibile'}`);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.resetWorker();
      };
    }
    return this.worker;
  }

  private call(req: Omit<Extract<StRequest, { type: 'init' }>, 'id'> | Omit<Extract<StRequest, { type: 'predict' }>, 'id'>): Promise<StResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.getWorker().postMessage({ ...req, id } as StRequest);
    });
  }

  private resetWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.resetQueue();
  }
}
