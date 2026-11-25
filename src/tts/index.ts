import { getSettings } from '../settings';
import type { SpeakOptions, TtsEngine, VoiceInfo } from './engine';
import { NeuralEngine } from './neural';
import { PiperEngine } from './piper';
import { SupertonicEngine } from './supertonic';
import { WebSpeechEngine } from './webspeech';

export const deviceEngine = new WebSpeechEngine();
export const piperEngine = new PiperEngine(() => getSettings().piperVoice);
export const neuralEngine = new NeuralEngine(() => getSettings().neuralVoice);
export const supertonicEngine = new SupertonicEngine(() => getSettings().supertonicVoice);

/** Motore attivo secondo le impostazioni (voci del dispositivo o voce AI Piper). */
class SwitchEngine implements TtsEngine {
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
  speak(text: string, opts: SpeakOptions) {
    return this.current.speak(text, opts);
  }
  stop() {
    deviceEngine.stop();
    piperEngine.stop();
    neuralEngine.stop();
    supertonicEngine.stop();
  }
  prefetch(texts: string[]) {
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
