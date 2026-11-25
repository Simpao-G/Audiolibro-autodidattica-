/** Opzioni passate al motore di sintesi per ogni frase. */
export interface SpeakOptions {
  rate: number;
  pitch: number;
  volume: number;
  voiceURI: string | null;
}

export interface VoiceInfo {
  id: string;
  name: string;
  lang: string;
  /** Voci "online"/neurali di solito suonano meglio. */
  quality: 'alta' | 'normale';
  local: boolean;
}

/**
 * Interfaccia comune ai motori di sintesi vocale.
 * Fase 1: Web Speech API. Fase 2: Kokoro (voce AI nel browser).
 */
export interface TtsEngine {
  readonly name: string;
  isSupported(): boolean;
  getVoices(): Promise<VoiceInfo[]>;
  /** Legge il testo; si risolve a fine lettura, si rifiuta solo per errori veri. */
  speak(text: string, opts: SpeakOptions): Promise<void>;
  /** Interrompe subito la lettura in corso (la promise di speak si risolve). */
  stop(): void;
}
