export interface Settings {
  /** 'supertonic' = voce AI HD offline, 'piper' = voce AI leggera, 'device' = voci del sistema, 'neural' = Azure (nascosto) */
  engine: 'supertonic' | 'device' | 'piper' | 'neural';
  supertonicVoice: string;
  piperVoice: string;
  neuralVoice: string;
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
  engine: 'device',
  piperVoice: 'it_IT-paola-medium',
  supertonicVoice: 'F1',
  neuralVoice: 'it-IT-IsabellaNeural',
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
const UPDATED_KEY = 'audiolibro:settingsUpdatedAt';

/** Impostazioni condivise tra dispositivi (le altre dipendono dal dispositivo). */
// "engine" NON è condiviso: i modelli delle voci AI si scaricano per dispositivo.
export const SHARED_KEYS = ['piperVoice', 'neuralVoice', 'supertonicVoice', 'rate', 'pitch', 'volume', 'theme', 'fontSize', 'paragraphPause'] as const;
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

/**
 * Aggiorna le impostazioni. `fromSync` = valori arrivati dal cloud
 * (non cambiano la data di modifica locale, così non vengono rimandati indietro).
 */
export function updateSettings(patch: Partial<Settings>, opts: { fromSync?: boolean; at?: number } = {}): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
    const touchesShared = Object.keys(patch).some((k) => (SHARED_KEYS as readonly string[]).includes(k));
    if (opts.fromSync) localStorage.setItem(UPDATED_KEY, String(opts.at ?? Date.now()));
    else if (touchesShared) localStorage.setItem(UPDATED_KEY, String(Date.now()));
  } catch {
    /* ignora */
  }
  listeners.forEach((l) => l(current));
}

/** Momento dell'ultima modifica delle impostazioni condivise (0 = mai). */
export function settingsUpdatedAt(): number {
  try {
    return Number(localStorage.getItem(UPDATED_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function sharedSettings(): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of SHARED_KEYS) out[k] = current[k];
  return out as Partial<Settings>;
}

export function onSettingsChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
