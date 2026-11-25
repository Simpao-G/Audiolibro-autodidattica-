import { getSettings, onSettingsChange } from '../settings';
import type { SpeakOptions, TtsEngine, VoiceInfo } from './engine';
import { NeuralEngine } from './neural';
import { PiperEngine } from './piper';
import { DetailedError, SupertonicEngine } from './supertonic';
import { WebSpeechEngine } from './webspeech';

export const deviceEngine = new WebSpeechEngine();
export const piperEngine = new PiperEngine(() => getSettings().piperVoice);
export const neuralEngine = new NeuralEngine(() => getSettings().neuralVoice);
export const supertonicEngine = new SupertonicEngine(() => getSettings().supertonicVoice);

/** Motore attivo secondo le impostazioni (voci del dispositivo o voce AI Piper). */
class SwitchEngine implements TtsEngine {
  /** La voce AI HD ha dato un errore grave: per questa sessione si usa la voce del dispositivo. */
  private hdBroken = false;

  constructor() {
    onSettingsChange((s) => {
      if (s.engine === 'supertonic' && this.lastSeen !== 'supertonic') this.hdBroken = false;
      this.lastSeen = s.engine;
    });
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
    if (cur === supertonicEngine && this.hdBroken) return deviceEngine.speak(text, opts);
    try {
      return await cur.speak(text, opts);
    } catch (e) {
      // Se la voce AI HD si guasta su questo dispositivo, la lettura continua con la voce del dispositivo
      if (cur !== supertonicEngine || !(e instanceof DetailedError) || !deviceEngine.isSupported()) throw e;
      this.hdBroken = true;
      window.dispatchEvent(new CustomEvent('tts-fallback', { detail: { message: e.message, detail: e.detail } }));
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
    if (this.hdBroken && this.current === supertonicEngine) return;
    this.current.prefetch?.(texts);
  }
  unlock() {
    this.current.unlock?.();
  }
  updateLive(opts: Pick<SpeakOptions, 'rate' | 'volume'>) {
    this.current.updateLive?.(opts);
  }
}

export const engine: TtsEngine = new SwitchEngine();
