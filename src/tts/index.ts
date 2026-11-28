import { getSettings, onSettingsChange } from '../settings';
import type { SpeakOptions, TtsEngine, VoiceInfo } from './engine';
import { NeuralEngine } from './neural';
import { PiperEngine } from './piper';
import { DetailedError, SupertonicEngine } from './supertonic';
import { WebSpeechEngine } from './webspeech';
import { NotDownloadedError } from './guard';

export const deviceEngine = new WebSpeechEngine();
export const piperEngine = new PiperEngine(() => getSettings().piperVoice);
export const neuralEngine = new NeuralEngine(() => getSettings().neuralVoice);
export const supertonicEngine = new SupertonicEngine(() => getSettings().supertonicVoice);

/** Motore attivo secondo le impostazioni (voci del dispositivo o voce AI Piper). */
class SwitchEngine implements TtsEngine {
  /** Il motore scelto non funziona qui (guasto o non scaricato): per ora si usa la voce del dispositivo. */
  private broken: TtsEngine | null = null;

  constructor() {
    onSettingsChange((s) => {
      // Cambiando motore (o dopo un download) si riprova quello scelto
      if (s.engine !== this.lastSeen) this.broken = null;
      this.lastSeen = s.engine;
    });
  }

  /** Da chiamare dopo aver scaricato una voce: il motore scelto torna disponibile. */
  resetFallback() {
    this.broken = null;
  }
  private lastSeen = getSettings().engine;

  private get current(): TtsEngine {
    const e = getSettings().engine;
    if (e === 'supertonic') return supertonicEngine;
    return e === 'piper' ? piperEngine : e === 'neural' ? neuralEngine : deviceEngine;
  }
  get name() {
    return this.current.name;
  }
  isSupported() {
    return this.current.isSupported();
  }
  getVoices(): Promise<VoiceInfo[]> {
    return this.current.getVoices();
  }
  async speak(text: string, opts: SpeakOptions): Promise<void> {
    const cur = this.current;
    if (cur === this.broken) return deviceEngine.speak(text, opts);
    try {
      return await cur.speak(text, opts);
    } catch (e) {
      // Voce AI non scaricata qui, o guasta su questo dispositivo: la lettura continua con la voce del dispositivo
      const recoverable = e instanceof NotDownloadedError || (cur === supertonicEngine && e instanceof DetailedError);
      if (!recoverable || cur === deviceEngine || !deviceEngine.isSupported()) throw e;
      this.broken = cur;
      const message =
        e instanceof NotDownloadedError
          ? `${e.message}: per ora leggo con la voce del dispositivo. Puoi scaricarla dal pulsante “Voce”`
          : `${(e as Error).message.replace(/[.!]+$/, '')}. Per ora continuo con la voce del dispositivo`;
      const detail = e instanceof DetailedError ? e.detail : `${(e as Error).message}\n${navigator.userAgent}`;
      window.dispatchEvent(new CustomEvent('tts-fallback', { detail: { message, detail } }));
      return deviceEngine.speak(text, opts);
    }
  }
  stop() {
    deviceEngine.stop();
    piperEngine.stop();
    neuralEngine.stop();
    supertonicEngine.stop();
  }
  prefetch(texts: string[]) {
    if (this.current === this.broken) return;
    this.current.prefetch?.(texts);
  }
  unlock() {
    this.current.unlock?.();
  }
  updateLive(opts: Pick<SpeakOptions, 'rate' | 'volume'>) {
    this.current.updateLive?.(opts);
  }
}

export const engine = new SwitchEngine();
