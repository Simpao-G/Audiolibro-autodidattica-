import type { Session } from '@supabase/supabase-js';
import { onSettingsChange, settingsUpdatedAt, sharedSettings, updateSettings, type Settings } from '../settings';
import { deleteBook, getBook, getChapters, listBooks, onPositionSaved, putMeta, saveBook } from '../storage';
import type { BookMeta, Chapter } from '../types';
import { BUCKET, supabase } from './client';
import { planSync, type RemoteBook } from './merge';

export interface CloudStatus {
  user: { id: string; email: string } | null;
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
}

let status: CloudStatus = { user: null, syncing: false, lastSync: null, error: null };
const statusListeners = new Set<(s: CloudStatus) => void>();
const libraryListeners = new Set<() => void>();

function setStatus(patch: Partial<CloudStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((l) => l(status));
}

export function getCloudStatus(): CloudStatus {
  return status;
}

export function onCloudStatus(l: (s: CloudStatus) => void): () => void {
  statusListeners.add(l);
  l(status);
  return () => statusListeners.delete(l);
}

/** Avvisa quando la sincronizzazione ha cambiato i libri sul dispositivo. */
export function onLibraryChanged(l: () => void): () => void {
  libraryListeners.add(l);
  return () => libraryListeners.delete(l);
}

const BOOK_COLUMNS = 'id,title,author,format,cover,chapter_sizes,position,position_updated_at,added_at,deleted';
const MAX_REMOTE_COVER = 290_000;

// ---------- Messaggi di errore comprensibili ----------

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email o password non corretti.';
  if (m.includes('email not confirmed')) return 'Devi prima confermare l’email: apri il link che ti abbiamo inviato.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Esiste già un account con questa email: prova ad accedere.';
  if (m.includes('password should be') || m.includes('at least 6')) return 'La password deve avere almeno 6 caratteri.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Troppi tentativi: riprova tra qualche minuto.';
  if (m.includes('invalid email') || m.includes('unable to validate email') || (m.includes('email address') && m.includes('invalid')))
    return 'L’indirizzo email non è valido.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Nessuna connessione: riprova quando sei online.';
  return msg;
}

// ---------- Accesso ----------

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyError(error));
}

/** Restituisce true se serve confermare l'email prima di accedere. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, location.href).href },
  });
  if (error) throw new Error(friendlyError(error));
  return !data.session;
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL(import.meta.env.BASE_URL, location.href).href,
  });
  if (error) throw new Error(friendlyError(error));
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(friendlyError(error));
}

/** Esce dall'account: i libri sincronizzati vengono tolti dal dispositivo (restano nel cloud). */
export async function signOut(): Promise<void> {
  await flushPositions().catch(() => {});
  const uid = status.user?.id;
  if (uid) {
    await pushDeletes(uid).catch(() => {});
    setPendingDeletes([]);
    for (const b of await listBooks()) if (b.ownerId === uid) await deleteBook(b.id);
  }
  await supabase.auth.signOut();
  libraryListeners.forEach((l) => l());
}

// ---------- Compressione del contenuto ----------

async function gzipJson(data: unknown): Promise<Blob> {
  const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function gunzipJson<T>(blob: Blob): Promise<T> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as T;
}

const objectPath = (uid: string, id: string) => `${uid}/${id}.json.gz`;

// ---------- Operazioni sui libri ----------

function toRow(b: BookMeta) {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    format: b.format,
    cover: b.cover && b.cover.length < MAX_REMOTE_COVER ? b.cover : null,
    chapter_sizes: b.chapterSizes,
    position: b.position,
    position_updated_at: new Date(b.positionUpdatedAt ?? b.addedAt).toISOString(),
    added_at: new Date(b.addedAt).toISOString(),
    deleted: false,
  };
}

async function uploadBook(uid: string, b: BookMeta): Promise<void> {
  const chapters = await getChapters(b.id);
  if (!chapters) return;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath(uid, b.id), await gzipJson(chapters), { upsert: true, contentType: 'application/gzip' });
  if (upErr) throw upErr;
  const { error } = await supabase.from('books').upsert(toRow(b));
  if (error) throw error;
  await putMeta({ ...b, ownerId: uid });
}

async function downloadBook(uid: string, r: RemoteBook): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath(uid, r.id));
  if (error || !data) throw error ?? new Error('Contenuto del libro non trovato');
  const chapters = await gunzipJson<Chapter[]>(data);
  const at = Date.parse(r.position_updated_at) || Date.now();
  const meta: BookMeta = {
    id: r.id,
    title: r.title,
    author: r.author,
    cover: r.cover ?? undefined,
    format: r.format,
    addedAt: Date.parse(r.added_at) || Date.now(),
    lastOpenedAt: at,
    position: r.position,
    positionUpdatedAt: at,
    chapterSizes: r.chapter_sizes,
    ownerId: uid,
  };
  await saveBook(meta, chapters);
}

// Eliminazioni in attesa di essere inviate al cloud (sopravvivono a offline e riavvii).
const PENDING_KEY = 'audiolibro:pendingDeletes';
function pendingDeletes(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function setPendingDeletes(ids: string[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(ids));
  } catch {
    /* ignora */
  }
}

async function pushDeletes(uid: string): Promise<void> {
  const left: string[] = [];
  for (const id of pendingDeletes()) {
    const { error } = await supabase.from('books').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      left.push(id);
      continue;
    }
    await supabase.storage.from(BUCKET).remove([objectPath(uid, id)]);
  }
  setPendingDeletes(left);
}

/** Da chiamare quando l'utente elimina un libro sincronizzato: lo toglie anche dagli altri dispositivi. */
export function markDeleted(book: BookMeta): void {
  const uid = status.user?.id;
  if (!uid || (book.ownerId && book.ownerId !== uid)) return;
  setPendingDeletes([...new Set([...pendingDeletes(), book.id])]);
  syncNow();
}

// ---------- Posizione di lettura ----------

const dirty = new Set<string>();
let pushTimer: number | undefined;

function queuePositionPush(id: string) {
  if (!status.user) return;
  dirty.add(id);
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => flushPositions().catch(() => {}), 5000);
}

export async function flushPositions(): Promise<void> {
  clearTimeout(pushTimer);
  const uid = status.user?.id;
  if (!uid || !dirty.size) return;
  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    const b = await getBook(id);
    if (!b || (b.ownerId && b.ownerId !== uid)) continue;
    const { error } = await supabase
      .from('books')
      .update({ position: b.position, position_updated_at: new Date(b.positionUpdatedAt ?? Date.now()).toISOString() })
      .eq('id', id);
    if (error) dirty.add(id);
  }
}

// ---------- Impostazioni ----------

let settingsTimer: number | undefined;
let applyingRemoteSettings = false;

async function syncSettings(uid: string): Promise<void> {
  const { data, error } = await supabase.from('user_settings').select('settings,updated_at').maybeSingle();
  if (error) throw error;
  const localAt = settingsUpdatedAt();
  const remoteAt = data ? Date.parse(data.updated_at) || 0 : 0;
  if (data && remoteAt > localAt) {
    applyingRemoteSettings = true;
    updateSettings(data.settings as Partial<Settings>, { fromSync: true, at: remoteAt });
    applyingRemoteSettings = false;
  } else if (localAt > remoteAt) {
    await pushSettings(uid);
  }
}

async function pushSettings(uid: string): Promise<void> {
  const at = settingsUpdatedAt() || Date.now();
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: uid, settings: sharedSettings(), updated_at: new Date(at).toISOString() });
  if (error) throw error;
}

// ---------- Sincronizzazione completa ----------

let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncOnce(): Promise<void> {
  const uid = status.user?.id;
  if (!uid || !navigator.onLine) return;
  setStatus({ syncing: true, error: null });
  let changed = false;
  try {
    await pushDeletes(uid);
    await flushPositions();
    const { data, error } = await supabase.from('books').select(BOOK_COLUMNS);
    if (error) throw error;
    const local = await listBooks();
    const plan = planSync(local, (data ?? []) as RemoteBook[], uid);

    for (const id of plan.deleteLocal) {
      await deleteBook(id);
      changed = true;
    }
    for (const p of plan.pullPosition) {
      const b = local.find((x) => x.id === p.id)!;
      await putMeta({ ...b, position: p.position, positionUpdatedAt: p.at, lastOpenedAt: Math.max(b.lastOpenedAt, p.at), ownerId: uid });
      changed = true;
    }
    for (const b of plan.pushPosition) queuePositionPush(b.id);
    await flushPositions();
    for (const r of plan.download) {
      await downloadBook(uid, r);
      changed = true;
    }
    for (const b of plan.upload) {
      await uploadBook(uid, b);
      changed = true;
    }
    // Segna come "dell'account" i libri già presenti in entrambi
    for (const b of local) {
      if (!b.ownerId && !plan.upload.includes(b) && !plan.deleteLocal.includes(b.id)) await putMeta({ ...b, ownerId: uid });
    }
    await syncSettings(uid);
    setStatus({ syncing: false, lastSync: Date.now() });
  } catch (e) {
    setStatus({ syncing: false, error: friendlyError(e) });
  } finally {
    if (changed) libraryListeners.forEach((l) => l());
  }
}

/** Spazio usato nel cloud (byte). */
export async function cloudUsage(): Promise<number> {
  const uid = status.user?.id;
  if (!uid) return 0;
  const { data } = await supabase.storage.from(BUCKET).list(uid, { limit: 1000 });
  return (data ?? []).reduce((n, f) => n + ((f.metadata as { size?: number } | null)?.size ?? 0), 0);
}

// ---------- Avvio ----------

let started = false;

/** Collega accesso, sincronizzazione automatica e salvataggio della posizione. */
export function initCloud(onPasswordRecovery?: () => void): void {
  if (started) return;
  started = true;
  const apply = (session: Session | null) => {
    const user = session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null;
    const changedUser = user?.id !== status.user?.id;
    setStatus({ user });
    if (user && changedUser) syncNow();
  };
  supabase.auth.getSession().then(({ data }) => apply(data.session));
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') onPasswordRecovery?.();
    // Rimanda fuori dal callback: evita blocchi interni della libreria
    setTimeout(() => apply(session), 0);
  });

  onPositionSaved((id) => queuePositionPush(id));
  onSettingsChange(() => {
    if (applyingRemoteSettings || !status.user) return;
    clearTimeout(settingsTimer);
    const uid = status.user.id;
    settingsTimer = window.setTimeout(() => pushSettings(uid).catch(() => {}), 3000);
  });

  let lastAuto = 0;
  const auto = () => {
    if (!status.user || Date.now() - lastAuto < 30_000) return;
    lastAuto = Date.now();
    syncNow();
  };
  window.addEventListener('online', auto);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') auto();
    else flushPositions().catch(() => {});
  });
}
