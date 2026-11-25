import { SUPABASE_KEY, SUPABASE_URL, supabase } from '../cloud/client';
import { ClipEngine } from './clip';
import type { VoiceInfo } from './engine';

export interface NeuralVoice {
  id: string;
  name: string;
  description: string;
}

/** Voci neurali italiane di Microsoft Azure Speech. */
export const NEURAL_VOICES: NeuralVoice[] = [
  { id: 'it-IT-IsabellaNeural', name: 'Isabella', description: 'femminile, calda e naturale' },
  { id: 'it-IT-ElsaNeural', name: 'Elsa', description: 'femminile, chiara' },
  { id: 'it-IT-DiegoNeural', name: 'Diego', description: 'maschile, naturale' },
  { id: 'it-IT-GiuseppeMultilingualNeural', name: 'Giuseppe', description: 'maschile, molto espressiva' },
];

/**
 * Voci neurali (qualità quasi umana) generate da Microsoft Azure Speech
 * tramite la funzione "tts" del nostro server Supabase. Servono account e internet.
 */
export class NeuralEngine extends ClipEngine {
  readonly name = 'Voci neurali';

  constructor(private getVoiceId: () => string) {
    super();
  }

  isSupported(): boolean {
    return typeof fetch !== 'undefined';
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return NEURAL_VOICES.map((v) => ({ id: v.id, name: v.name, lang: 'it-IT', quality: 'alta', local: false }));
  }

  protected voiceKey(): string {
    return `neural:${this.getVoiceId()}`;
  }

  protected canPrefetch(): boolean {
    return navigator.onLine;
  }

  protected async prepare(): Promise<void> {
    if (!navigator.onLine) throw new Error('Le voci neurali richiedono internet: sei offline');
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Accedi al tuo account (icona 👤) per usare le voci neurali');
  }

  protected async generate(text: string): Promise<Blob> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Accedi al tuo account per usare le voci neurali');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, voice: this.getVoiceId() }),
    });
    if (!res.ok) {
      let msg = `Errore del servizio vocale (HTTP ${res.status})`;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {
        /* risposta non JSON */
      }
      throw new Error(msg);
    }
    return res.blob();
  }
}
