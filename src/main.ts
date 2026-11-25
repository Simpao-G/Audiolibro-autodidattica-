import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { getSettings, onSettingsChange, type Settings } from './settings';
import { getBook, getChapters, requestPersistence } from './storage';
import { engine } from './tts';
import { renderLibrary } from './ui/library';
import { renderReader } from './ui/reader';
import { openSettings } from './ui/settings';
import { toast } from './ui/dom';

const root = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function applyTheme(s: Settings) {
  if (s.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = s.theme;
}
applyTheme(getSettings());
onSettingsChange(applyTheme);

/** Routing semplice con l'hash: #/ = libreria, #/libro/<id> = lettore */
async function route() {
  cleanup?.();
  cleanup = null;
  const m = location.hash.match(/^#\/libro\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const [meta, chapters] = await Promise.all([getBook(id), getChapters(id)]);
    if (!meta || !chapters?.length) {
      toast('Libro non trovato');
      location.hash = '#/';
      return;
    }
    document.title = `${meta.title} · Audiolibro`;
    cleanup = renderReader(root, meta, chapters, engine, () => (location.hash = '#/'));
  } else {
    document.title = 'Audiolibro';
    await renderLibrary(
      root,
      (id) => (location.hash = `#/libro/${encodeURIComponent(id)}`),
      () =>
        openSettings(() => {
          engine.unlock?.();
          engine
            .speak('Ciao! Questa è la voce che leggerà i tuoi libri.', getSettings())
            .catch((e) => toast(e instanceof Error ? e.message : String(e), 6000));
        }),
    );
  }
}

window.addEventListener('hashchange', route);
route();
requestPersistence();
registerSW({ immediate: true });
