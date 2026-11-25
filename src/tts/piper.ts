import { ClipEngine } from './clip';
import type { VoiceInfo } from './engine';
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

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (p: number) => void };

/**
 * Motore "voce AI offline": genera l'audio di ogni frase nel browser con Piper (in un Web Worker).
 */
export class PiperEngine extends ClipEngine {
  readonly name = 'Voce AI offline (Piper)';
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyVoice: string | null = null;
  private loading: { voice: string; promise: Promise<void> } | null = null;

  constructor(private getVoiceId: () => string) {
    super();
  }

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

  protected voiceKey(): string {
    return `piper:${this.getVoiceId()}`;
  }

  protected canPrefetch(): boolean {
    return this.readyVoice === this.getVoiceId();
  }

  protected async prepare(): Promise<void> {
    const voice = this.getVoiceId();
    if (this.readyVoice === voice) return;
    if (!(await this.isDownloaded(voice))) {
      throw new Error('La voce AI non è ancora scaricata: aprila nelle impostazioni e premi “Scarica”');
    }
    await this.ensureReady(voice);
  }

  protected async generate(text: string): Promise<Blob> {
    const res = await this.call({ type: 'predict', text });
    if (res.type !== 'audio') throw new Error('Risposta inattesa dalla voce AI');
    return res.wav;
  }

  // ---------- Worker ----------

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
    this.resetQueue();
  }
}
