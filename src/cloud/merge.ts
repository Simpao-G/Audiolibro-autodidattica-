import type { BookMeta, Position } from '../types';

/** Riga della tabella `books` su Supabase. */
export interface RemoteBook {
  id: string;
  title: string;
  author: string;
  format: BookMeta['format'];
  cover: string | null;
  chapter_sizes: number[];
  position: Position;
  position_updated_at: string;
  added_at: string;
  deleted: boolean;
}

export interface SyncPlan {
  /** Libri presenti nel cloud ma non sul dispositivo: da scaricare. */
  download: RemoteBook[];
  /** Libri eliminati da un altro dispositivo: da togliere qui. */
  deleteLocal: string[];
  /** Libri solo locali: da caricare nel cloud. */
  upload: BookMeta[];
  /** Il cloud è più avanti: aggiorna la posizione locale. */
  pullPosition: { id: string; position: Position; at: number }[];
  /** Questo dispositivo è più avanti: aggiorna il cloud. */
  pushPosition: BookMeta[];
}

/** Decide cosa scaricare, caricare o aggiornare confrontando dispositivo e cloud. */
export function planSync(local: BookMeta[], remote: RemoteBook[], userId: string): SyncPlan {
  const plan: SyncPlan = { download: [], deleteLocal: [], upload: [], pullPosition: [], pushPosition: [] };
  const localById = new Map(local.map((b) => [b.id, b]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));

  for (const r of remote) {
    const l = localById.get(r.id);
    if (r.deleted) {
      if (l) plan.deleteLocal.push(r.id);
      continue;
    }
    if (!l) {
      plan.download.push(r);
      continue;
    }
    const remoteAt = Date.parse(r.position_updated_at) || 0;
    const localAt = l.positionUpdatedAt ?? 0;
    const samePos = l.position.chapter === r.position.chapter && l.position.sentence === r.position.sentence;
    if (samePos) continue;
    if (remoteAt > localAt) plan.pullPosition.push({ id: r.id, position: r.position, at: remoteAt });
    else if (localAt > remoteAt) plan.pushPosition.push(l);
  }

  for (const l of local) {
    // Libri di un altro account rimasti sul dispositivo: non vanno mai caricati qui.
    if (l.ownerId && l.ownerId !== userId) continue;
    if (!remoteById.has(l.id)) plan.upload.push(l);
  }
  return plan;
}
