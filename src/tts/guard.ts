// Protezione contro i crash per memoria della voce AI HD (soprattutto su iPhone/iPad).
// Prima di caricare il modello salviamo un segno; quando è pronto lo togliamo.
// Se all'avvio il segno è ancora lì, la pagina è stata chiusa dal sistema durante il caricamento.

const LOADING = 'audiolibro:hdLoading';
const CRASHED = 'audiolibro:hdCrashed';

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignora */
  }
}

/** Telefono o tablet (iPadOS si presenta come Mac con touch). */
export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function markHdLoading(): void {
  set(LOADING, String(Date.now()));
}

export function clearHdLoading(): void {
  set(LOADING, null);
}

/** Da chiamare all'avvio: true se l'ultima volta la pagina è crollata caricando la voce HD. */
export function detectHdCrash(): boolean {
  if (!get(LOADING)) return false;
  set(LOADING, null);
  set(CRASHED, String(Date.now()));
  return true;
}

export function hdCrashedHere(): boolean {
  return !!get(CRASHED);
}

/** "Riprova comunque": l'utente vuole provare di nuovo la voce HD. */
export function clearHdCrash(): void {
  set(CRASHED, null);
}

// Se l'utente chiude o cambia pagina normalmente, non è un crash.
if (typeof window !== 'undefined') window.addEventListener('pagehide', clearHdLoading);

/** La voce scelta non è scaricata su questo dispositivo. */
export class NotDownloadedError extends Error {}
