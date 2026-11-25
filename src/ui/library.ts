import type { BookMeta } from '../types';
import { deleteBook, listBooks, saveBook } from '../storage';
import { ACCEPTED, parseBook } from '../parsers';
import { countSentences } from '../text';
import { h, hueFrom, icon, toast } from './dom';
import { getCloudStatus, markDeleted, onCloudStatus, onLibraryChanged, syncNow } from '../cloud/sync';
import { openAccount } from './account';

/** Riduce la copertina (max 400 px di altezza, JPEG): occupa meno spazio sul dispositivo e nel cloud. */
async function shrinkCover(dataUrl: string | undefined): Promise<string | undefined> {
  if (!dataUrl) return undefined;
  try {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, 400 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return dataUrl.length < 250_000 ? dataUrl : undefined;
  }
}

export function progressOf(b: BookMeta): number {
  const total = b.chapterSizes.reduce((a, n) => a + n, 0);
  if (!total) return 0;
  const done = b.chapterSizes.slice(0, b.position.chapter).reduce((a, n) => a + n, 0) + b.position.sentence;
  return Math.min(1, done / total);
}

function coverEl(b: Pick<BookMeta, 'title' | 'author' | 'cover'>): HTMLElement {
  if (b.cover) return h('div', { class: 'cover' }, h('img', { src: b.cover, alt: '', loading: 'lazy' }));
  const hue = hueFrom(b.title);
  return h(
    'div',
    { class: 'cover generated', style: `background: linear-gradient(160deg, hsl(${hue} 45% 38%), hsl(${(hue + 40) % 360} 50% 22%))` },
    h('div', { class: 't' }, b.title),
    h('div', { class: 'a' }, b.author),
  );
}

export async function importFiles(files: FileList | File[], onStatus: (msg: string | null) => void): Promise<string | null> {
  let lastId: string | null = null;
  for (const file of Array.from(files)) {
    onStatus(`Importo “${file.name}”…`);
    try {
      const parsed = await parseBook(file, (p) => onStatus(`Leggo “${file.name}”… ${Math.round(p * 100)}%`));
      const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const now = Date.now();
      const meta: BookMeta = {
        id,
        title: parsed.title,
        author: parsed.author,
        cover: await shrinkCover(parsed.cover),
        format: parsed.format,
        addedAt: now,
        lastOpenedAt: now,
        position: { chapter: 0, sentence: 0 },
        chapterSizes: parsed.chapters.map(countSentences),
      };
      await saveBook(meta, parsed.chapters);
      lastId = id;
      const n = parsed.chapters.length;
      toast(`“${parsed.title}” aggiunto (${n} ${n === 1 ? 'capitolo' : 'capitoli'})`);
    } catch (e) {
      console.error(e);
      toast(`Impossibile aprire “${file.name}”: ${e instanceof Error ? e.message : e}`, 6000);
    }
  }
  onStatus(null);
  if (lastId && getCloudStatus().user) syncNow();
  return lastId;
}

export async function renderLibrary(root: HTMLElement, onOpen: (id: string) => void, onSettings: () => void): Promise<() => void> {
  const input = h('input', { type: 'file', accept: ACCEPTED, multiple: true, class: 'sr-only', id: 'file' });
  const status = h('div', { class: 'loading', hidden: true });
  const grid = h('div', { class: 'grid' });

  const refresh = async () => {
    const books = await listBooks();
    grid.replaceChildren();
    if (!books.length) {
      grid.append(h('div', { class: 'empty', style: 'grid-column: 1 / -1' }, 'La libreria è vuota. Aggiungi il tuo primo libro!'));
      return;
    }
    for (const b of books) {
      const pct = Math.round(progressOf(b) * 100);
      const card = h(
        'div',
        { class: 'card', role: 'button', tabindex: 0, 'aria-label': `Apri ${b.title}` },
        coverEl(b),
        h('div', { class: 'progress', 'aria-hidden': 'true' }, h('div', { style: `width:${pct}%` })),
        h('div', { class: 'meta' }, h('strong', {}, b.title), h('span', {}, `${b.author ? b.author + ' · ' : ''}${pct}%`)),
        h(
          'button',
          {
            class: 'icon-btn del',
            'aria-label': `Elimina ${b.title}`,
            onclick: async (e: Event) => {
              e.stopPropagation();
              if (confirm(`Eliminare “${b.title}” dalla libreria?`)) {
                await deleteBook(b.id);
                markDeleted(b);
                refresh();
              }
            },
          },
          icon('trash'),
        ),
      );
      card.addEventListener('click', () => onOpen(b.id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(b.id);
        }
      });
      grid.append(card);
    }
  };

  const handle = async (files: FileList | File[]) => {
    if (!files.length) return;
    const setStatus = (msg: string | null) => {
      status.hidden = !msg;
      status.replaceChildren(h('div', { class: 'spinner' }), msg ?? '');
    };
    const id = await importFiles(files, setStatus);
    await refresh();
    if (id && files.length === 1) onOpen(id);
  };
  input.addEventListener('change', () => {
    if (input.files) handle(Array.from(input.files));
    input.value = '';
  });

  const dropHint = h('p', {});
  const drop = h(
    'div',
    { class: 'dropzone' },
    h('label', { class: 'btn', for: 'file' }, icon('upload'), 'Aggiungi libro'),
    dropHint,
    input,
  );
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files) handle(Array.from(e.dataTransfer.files));
  });

  const accountBtn = h('button', { class: 'icon-btn account-btn', 'aria-label': 'Account', title: 'Account', onclick: () => openAccount() }, icon('user'));
  const syncBadge = h('span', { class: 'sync-badge', hidden: true }, h('div', { class: 'spinner' }), 'Sincronizzo…');
  const offStatus = onCloudStatus((s) => {
    accountBtn.classList.toggle('logged', !!s.user);
    accountBtn.setAttribute('aria-label', s.user ? `Account (${s.user.email})` : 'Accedi');
    syncBadge.hidden = !s.syncing;
    dropHint.textContent = s.user
      ? 'EPUB, PDF o TXT — oppure trascina qui il file. I libri vengono salvati anche nel tuo account.'
      : 'EPUB, PDF o TXT — oppure trascina qui il file. I libri restano sul dispositivo (accedi per averli ovunque).';
  });
  const offLibrary = onLibraryChanged(() => refresh());

  root.replaceChildren(
    h(
      'header',
      { class: 'topbar' },
      h('img', { class: 'logo', src: `${import.meta.env.BASE_URL}icon.svg`, alt: '' }),
      h('h1', { class: 'brand' }, 'Audiolibro'),
      syncBadge,
      accountBtn,
      h('button', { class: 'icon-btn', 'aria-label': 'Impostazioni', onclick: onSettings }, icon('settings')),
    ),
    h('main', { class: 'library' }, drop, status, grid),
  );
  await refresh();
  return () => {
    offStatus();
    offLibrary();
  };
}
