import type { SpeakOptions, TtsEngine, VoiceInfo } from './engine';

/** Motore basato sulla Web Speech API del browser: gratuito, nessun download. */
export class WebSpeechEngine implements TtsEngine {
  readonly name = 'Voci del dispositivo';
  private current: SpeechSynthesisUtterance | null = null;
  private finish: (() => void) | null = null;
  private watchdog: number | undefined;

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  getVoices(): Promise<VoiceInfo[]> {
    if (!this.isSupported()) return Promise.resolve([]);
    const map = (vs: SpeechSynthesisVoice[]) => vs.map(toInfo).sort(compareVoices);
    const now = speechSynthesis.getVoices();
    if (now.length) return Promise.resolve(map(now));
    // Su Chrome le voci arrivano in modo asincrono
    return new Promise((resolve) => {
      const done = () => resolve(map(speechSynthesis.getVoices()));
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }

  speak(text: string, opts: SpeakOptions): Promise<void> {
    this.stop();
    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voiceURI);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = document.documentElement.lang || 'it-IT';
      }
      u.rate = opts.rate;
      u.pitch = opts.pitch;
      u.volume = opts.volume;

      const finish = (err?: unknown) => {
        if (this.current !== u) return;
        clearTimeout(this.watchdog);
        this.current = null;
        this.finish = null;
        if (err) reject(err);
        else resolve();
      };
      u.onstart = () => opts.onStart?.();
      u.onend = () => finish();
      u.onerror = (e) => {
        // "interrupted"/"canceled" arrivano quando fermiamo noi la lettura: non sono errori
        if (e.error === 'interrupted' || e.error === 'canceled') finish();
        else finish(new Error(`Errore sintesi vocale: ${e.error}`));
      };
      // Tiene il riferimento (Chrome a volte perde l'evento onend se l'oggetto viene raccolto)
      this.current = u;
      this.finish = () => finish();
      // Sicurezza: se il browser non segnala la fine, si va avanti comunque
      const expectedMs = (text.length / (14 * opts.rate)) * 1000;
      this.watchdog = window.setTimeout(() => finish(), expectedMs * 3 + 8000);
      speechSynthesis.speak(u);
    });
  }

  stop(): void {
    if (!this.isSupported()) return;
    // Risolve prima la promise in corso (finish azzera lo stato), poi ferma l'audio
    this.finish?.();
    speechSynthesis.cancel();
  }
}

function toInfo(v: SpeechSynthesisVoice): VoiceInfo {
  const high = /natural|neural|online|premium|enhanced|wavenet|google/i.test(v.name);
  return { id: v.voiceURI, name: v.name, lang: v.lang, quality: high ? 'alta' : 'normale', local: v.localService };
}

/** Prima le voci italiane, poi quelle di qualità alta. */
function compareVoices(a: VoiceInfo, b: VoiceInfo): number {
  const it = (v: VoiceInfo) => (v.lang.toLowerCase().startsWith('it') ? 0 : 1);
  const q = (v: VoiceInfo) => (v.quality === 'alta' ? 0 : 1);
  return it(a) - it(b) || q(a) - q(b) || a.name.localeCompare(b.name);
}
