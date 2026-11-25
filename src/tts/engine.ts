/** Opzioni passate al motore di sintesi per ogni frase. */
export interface SpeakOptions {
  rate: number;
  pitch: number;
  volume: number;
  voiceURI: string | null;
  /** Chiamata quando l'audio inizia davvero (per mostrare il caricamento fino ad allora). */
  onStart?: () => void;
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
 * - Web Speech API (voci del dispositivo)
 * - Piper (voce AI che gira nel browser, offline)
 */
export interface TtsEngine {
  readonly name: string;
  isSupported(): boolean;
  getVoices(): Promise<VoiceInfo[]>;
  /** Legge il testo; si risolve a fine lettura, si rifiuta solo per errori veri. */
  speak(text: string, opts: SpeakOptions): Promise<void>;
  /** Interrompe subito la lettura in corso (la promise di speak si risolve). */
  stop(): void;
  /** Prepara in anticipo le prossime frasi (motori che generano audio). */
  prefetch?(texts: string[]): void;
  /** Da chiamare durante un tocco dell'utente: sblocca la riproduzione audio su iOS/Safari. */
  unlock?(): void;
  /** Applica subito velocità/volume alla frase in corso. */
  updateLive?(opts: Pick<SpeakOptions, 'rate' | 'volume'>): void;
}
