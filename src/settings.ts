export interface Settings {
  voiceURI: string | null;
  rate: number;
  pitch: number;
  volume: number;
  theme: 'auto' | 'light' | 'dark';
  fontSize: number;
  keepAwake: boolean;
  /** Pausa (ms) tra un paragrafo e l'altro. */
  paragraphPause: number;
}

export const DEFAULTS: Settings = {
  voiceURI: null,
  rate: 1,
  pitch: 1,
  volume: 1,
  theme: 'auto',
  fontSize: 19,
  keepAwake: true,
  paragraphPause: 350,
};

const KEY = 'audiolibro:settings';
type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* localStorage non disponibile */
  }
  return { ...DEFAULTS };
}

let current = load();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignora */
  }
  listeners.forEach((l) => l(current));
}

export function onSettingsChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
