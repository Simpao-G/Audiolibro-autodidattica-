import type { BookMeta, Chapter, Position } from './types';

const DB_NAME = 'audiolibro';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('contents')) db.createObjectStore('contents');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: 'books' | 'contents', mode: IDBTransactionMode = 'readonly') {
  return (await openDb()).transaction(name, mode).objectStore(name);
}

export async function listBooks(): Promise<BookMeta[]> {
  const all = await wrap((await store('books')).getAll() as IDBRequest<BookMeta[]>);
  return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getBook(id: string): Promise<BookMeta | undefined> {
  return wrap((await store('books')).get(id) as IDBRequest<BookMeta | undefined>);
}

export async function getChapters(id: string): Promise<Chapter[] | undefined> {
  return wrap((await store('contents')).get(id) as IDBRequest<Chapter[] | undefined>);
}

export async function saveBook(meta: BookMeta, chapters: Chapter[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['books', 'contents'], 'readwrite');
  tx.objectStore('books').put(meta);
  tx.objectStore('contents').put(chapters, meta.id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Spazio di archiviazione insufficiente'));
  });
}

export async function updateMeta(id: string, patch: Partial<BookMeta>): Promise<void> {
  const s = await store('books', 'readwrite');
  const cur = await wrap(s.get(id) as IDBRequest<BookMeta | undefined>);
  if (cur) await wrap(s.put({ ...cur, ...patch }));
}

type PositionListener = (id: string) => void;
const positionListeners = new Set<PositionListener>();

/** Avvisa quando una posizione di lettura viene salvata (usato dalla sincronizzazione). */
export function onPositionSaved(l: PositionListener): () => void {
  positionListeners.add(l);
  return () => positionListeners.delete(l);
}

export async function savePosition(id: string, position: Position): Promise<void> {
  const now = Date.now();
  await updateMeta(id, { position, lastOpenedAt: now, positionUpdatedAt: now });
  positionListeners.forEach((l) => l(id));
}

/** Sostituisce i metadati di un libro (usato dalla sincronizzazione). */
export async function putMeta(meta: BookMeta): Promise<void> {
  await wrap((await store('books', 'readwrite')).put(meta));
}

export async function deleteBook(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['books', 'contents'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('contents').delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Chiede al browser di non cancellare i dati (libri) quando manca spazio. */
export function requestPersistence(): void {
  navigator.storage?.persist?.().catch(() => {});
}
