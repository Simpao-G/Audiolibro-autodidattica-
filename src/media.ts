/** Mantiene lo schermo acceso durante la lettura (evita che il telefono interrompa la voce). */
let wakeLock: WakeLockSentinel | null = null;
let wantLock = false;

export async function setKeepAwake(on: boolean): Promise<void> {
  wantLock = on;
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* non concesso (es. batteria scarica) */
  }
}

// Il wake lock si perde quando la pagina va in background: lo richiediamo al ritorno.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantLock) setKeepAwake(true);
});

export interface MediaHandlers {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
}

/** Controlli nella notifica / tastiera multimediale / cuffie Bluetooth. */
export function setupMediaSession(title: string, artist: string, cover: string | undefined, h: MediaHandlers): void {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album: 'Audiolibro',
    artwork: cover ? [{ src: cover, sizes: '512x512' }] : [],
  });
  const set = (a: MediaSessionAction, fn: () => void) => {
    try {
      navigator.mediaSession.setActionHandler(a, fn);
    } catch {
      /* azione non supportata */
    }
  };
  set('play', h.play);
  set('pause', h.pause);
  set('nexttrack', h.next);
  set('previoustrack', h.prev);
  set('seekforward', h.next);
  set('seekbackward', h.prev);
}

export function setMediaPlaying(playing: boolean): void {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

export function clearMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = null;
  for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekforward', 'seekbackward'] as MediaSessionAction[]) {
    try {
      navigator.mediaSession.setActionHandler(a, null);
    } catch {
      /* ignora */
    }
  }
}
