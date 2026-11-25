import type { BookMeta, Chapter } from '../types';
import { Player, type PlayerState } from '../player';
import type { TtsEngine } from '../tts/engine';
import { getSettings, onSettingsChange, updateSettings } from '../settings';
import { savePosition, updateMeta } from '../storage';
import { clearMediaSession, setKeepAwake, setMediaMetadata, setMediaPlaying, setupMediaSession } from '../media';
import { h, icon, openDialog, toast } from './dom';
import { openSettings, SPEEDS } from './settings';

/** Caratteri al secondo letti a velocità 1× (stima per il tempo rimanente). */
const CHARS_PER_SEC = 14;

function formatMinutes(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function renderReader(root: HTMLElement, meta: BookMeta, chapters: Chapter[], engine: TtsEngine, onBack: () => void): () => void {
  const player = new Player({
    engine,
    getOptions: () => {
      const s = getSettings();
      return { rate: s.rate, pitch: s.pitch, volume: s.volume, voiceURI: s.voiceURI, paragraphPause: s.paragraphPause };
    },
    onPosition: (p) => savePosition(meta.id, p).catch(() => {}),
  });
  updateMeta(meta.id, { lastOpenedAt: Date.now() }).catch(() => {});

  // ---------- Elementi ----------
  const text = h('article', { class: 'text', 'aria-live': 'off' });
  const playBtn = h('button', { class: 'play', 'aria-label': 'Riproduci', onclick: () => player.toggle() }, icon('play'));
  const seek = h('input', { type: 'range', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Posizione nel capitolo' });
  const chapterLabel = h('span', {});
  const remainLabel = h('span', {});
  const speedBtn = h('button', { class: 'pill', 'aria-label': 'Velocità', onclick: () => cycleSpeed() });
  const sleepBtn = h('button', { class: 'pill', 'aria-label': 'Timer di spegnimento', onclick: () => openSleep() }, icon('moon'));
  const errorBar = h('div', { class: 'error-bar', hidden: true });

  const ctrl = (name: string, label: string, fn: () => void) => h('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick: fn }, icon(name));

  const controls = h(
    'div',
    { class: 'controls' },
    h(
      'div',
      { class: 'inner' },
      errorBar,
      h('div', { class: 'seek' }, chapterLabel, seek, remainLabel),
      h(
        'div',
        { class: 'buttons' },
        speedBtn,
        ctrl('prev', 'Capitolo precedente', () => player.prevChapter()),
        ctrl('back', 'Frase precedente', () => player.prevSentence()),
        playBtn,
        ctrl('fwd', 'Frase successiva', () => player.nextSentence()),
        ctrl('next', 'Capitolo successivo', () => player.nextChapter()),
        sleepBtn,
      ),
    ),
  );

  root.replaceChildren(
    h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Libreria', onclick: onBack }, icon('arrowLeft')),
      h('h1', {}, meta.title),
      h('button', { class: 'icon-btn', 'aria-label': 'Indice', onclick: () => openToc() }, icon('list')),
      h('button', { class: 'icon-btn', 'aria-label': 'Impostazioni', onclick: () => openSettings(preview) }, icon('settings')),
    ),
    h('main', { class: 'reader' }, text),
    controls,
  );

  // ---------- Rendering capitolo ----------
  let renderedChapter = -1;
  let spans: HTMLElement[] = [];
  let lastUserScroll = 0;
  const markScroll = () => (lastUserScroll = Date.now());
  window.addEventListener('wheel', markScroll, { passive: true });
  window.addEventListener('touchmove', markScroll, { passive: true });

  function renderChapter(i: number) {
    renderedChapter = i;
    const ch = chapters[i];
    spans = [];
    const frag = document.createDocumentFragment();
    frag.append(h('h2', { class: 'chapter-title' }, ch.title));
    let idx = 0;
    for (const para of ch.paragraphs) {
      const p = h('p');
      for (const s of para) {
        const span = h('span', { class: 's', 'data-i': idx++ }, s);
        spans.push(span);
        p.append(span, ' ');
      }
      frag.append(p);
    }
    text.replaceChildren(frag);
    seek.max = String(Math.max(0, spans.length - 1));
    window.scrollTo({ top: 0 });
  }

  text.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('.s') as HTMLElement | null;
    if (!t) return;
    const sentence = Number(t.dataset.i);
    player.seek({ chapter: player.state.position.chapter, sentence });
    if (!player.state.playing) player.play();
  });

  seek.addEventListener('input', () => {
    player.seek({ chapter: player.state.position.chapter, sentence: Number(seek.value) });
  });

  let active: HTMLElement | null = null;
  function update(s: PlayerState) {
    const { chapter, sentence } = s.position;
    if (chapter !== renderedChapter) {
      renderChapter(chapter);
      setMediaMetadata(chapters[chapter].title, meta.author ? `${meta.title} · ${meta.author}` : meta.title, meta.cover);
    }
    const el = spans[sentence] ?? null;
    if (el !== active) {
      active?.classList.remove('active');
      el?.classList.add('active');
      active = el;
      if (el && Date.now() - lastUserScroll > 4000) {
        const r = el.getBoundingClientRect();
        const bottomLimit = window.innerHeight - controls.offsetHeight - 40;
        if (r.top < 70 || r.bottom > bottomLimit) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    playBtn.replaceChildren(s.playing && s.buffering ? h('div', { class: 'spinner' }) : icon(s.playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', s.playing ? (s.buffering ? 'Caricamento… (tocca per fermare)' : 'Pausa') : 'Riproduci');
    seek.value = String(Math.min(sentence, spans.length - 1));
    chapterLabel.textContent = `${chapter + 1}/${chapters.length}`;
    const rate = getSettings().rate;
    const remainingChars = chapters[chapter].paragraphs.flat().slice(sentence).reduce((n, t) => n + t.length, 0);
    remainLabel.textContent = formatMinutes(remainingChars / (CHARS_PER_SEC * rate));
    remainLabel.title = 'Tempo stimato alla fine del capitolo';
    sleepBtn.classList.toggle('on', s.sleep !== null);
    sleepBtn.replaceChildren(icon('moon'), s.sleep === 'chapter' ? 'cap.' : typeof s.sleep === 'number' ? `${Math.max(1, Math.round((s.sleep - Date.now()) / 60000))}′` : '');
    if (s.finished) {
      errorBar.hidden = false;
      errorBar.textContent = 'Fine del libro 🎉';
      errorBar.style.background = 'var(--accent)';
    } else {
      errorBar.hidden = !s.error;
      errorBar.textContent = s.error ? `${s.error}. Prova un'altra voce nelle impostazioni.` : '';
      errorBar.style.background = '';
    }
    setMediaPlaying(s.playing);
    if (getSettings().keepAwake) setKeepAwake(s.playing);
  }

  // ---------- Velocità, timer, indice ----------
  function showSpeed() {
    speedBtn.textContent = `${getSettings().rate.toFixed(2).replace(/\.?0+$/, '')}×`;
  }
  function cycleSpeed() {
    const r = getSettings().rate;
    const next = SPEEDS.find((sp) => sp > r + 0.001) ?? SPEEDS[0];
    updateSettings({ rate: next });
  }

  function openSleep() {
    const opts: [string, null | 'chapter' | number][] = [
      ['Disattivato', null], ['15 minuti', 15], ['30 minuti', 30], ['45 minuti', 45], ['60 minuti', 60], ['Fine capitolo', 'chapter'],
    ];
    const list = h('div', { class: 'toc' });
    const dlg = openDialog('Timer di spegnimento', list);
    for (const [label, val] of opts) {
      list.append(h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); player.setSleep(val); dlg.close(); } }, label));
    }
  }

  function openToc() {
    const list = h('nav', { class: 'toc' });
    const dlg = openDialog('Indice', list);
    chapters.forEach((c, i) => {
      const a = h('a', {
        href: '#',
        class: i === player.state.position.chapter ? 'current' : undefined,
        onclick: (e: Event) => { e.preventDefault(); player.seek({ chapter: i, sentence: 0 }); dlg.close(); },
      }, h('span', { class: 'n' }, String(i + 1)), c.title);
      list.append(a);
    });
    (list.querySelector('.current') as HTMLElement | null)?.scrollIntoView({ block: 'center' });
  }

  /** Legge la frase corrente (o una frase di esempio) per provare voce/velocità. */
  function preview() {
    player.pause();
    engine.unlock?.();
    const { chapter, sentence } = player.state.position;
    const sample = chapters[chapter]?.paragraphs.flat()[sentence] ?? 'Ciao, questa è la voce che leggerà il tuo libro.';
    engine.speak(sample, getSettings()).catch((e) => toast(e instanceof Error ? e.message : String(e), 6000));
  }

  // ---------- Tastiera e sessione multimediale ----------
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('dialog[open]') || (e.target as HTMLElement).matches('input, select, textarea')) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowRight') player.nextSentence();
    else if (e.key === 'ArrowLeft') player.prevSentence();
    else if (e.key === 'ArrowDown' && e.shiftKey) player.nextChapter();
    else if (e.key === 'ArrowUp' && e.shiftKey) player.prevChapter();
  };
  document.addEventListener('keydown', onKey);
  setupMediaSession(meta.title, meta.author, meta.cover, {
    play: () => player.play(),
    pause: () => player.pause(),
    next: () => player.nextSentence(),
    prev: () => player.prevSentence(),
  });

  let lastEngine = `${getSettings().engine}|${getSettings().piperVoice}`;
  const offSettings = onSettingsChange((s) => {
    document.documentElement.style.setProperty('--reader-size', `${s.fontSize}px`);
    engine.updateLive?.({ rate: s.rate, volume: s.volume });
    // Cambio di motore o di voce: fermiamo la lettura (riparte col nuovo motore)
    const eng = `${s.engine}|${s.piperVoice}`;
    if (eng !== lastEngine) {
      lastEngine = eng;
      player.pause();
    }
    showSpeed();
    update(player.state);
  });
  document.documentElement.style.setProperty('--reader-size', `${getSettings().fontSize}px`);
  showSpeed();

  const tick = window.setInterval(() => { if (player.state.sleep !== null) update(player.state); }, 30_000);

  player.load(chapters, meta.position);
  const unsub = player.subscribe(update);

  return () => {
    unsub();
    offSettings();
    clearInterval(tick);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('wheel', markScroll);
    window.removeEventListener('touchmove', markScroll);
    savePosition(meta.id, player.state.position).catch(() => {});
    player.destroy();
    setKeepAwake(false);
    clearMediaSession();
  };
}
