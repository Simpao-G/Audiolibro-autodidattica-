import { getSettings } from '../settings';
import type { SpeakOptions, TtsEngine, VoiceInfo } from './engine';
import { PiperEngine } from './piper';
import { WebSpeechEngine } from './webspeech';

export const deviceEngine = new WebSpeechEngine();
export const piperEngine = new PiperEngine(() => getSettings().piperVoice);

/** Motore attivo secondo le impostazioni (voci del dispositivo o voce AI Piper). */
class SwitchEngine implements TtsEngine {
  private get current(): TtsEngine {
    return getSettings().engine === 'piper' ? piperEngine : deviceEngine;
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
