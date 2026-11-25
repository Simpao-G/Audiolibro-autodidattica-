import { describe, expect, it } from 'vitest';
import { planSync, type RemoteBook } from '../src/cloud/merge';
import type { BookMeta } from '../src/types';

const U = 'utente-1';
const local = (id: string, chapter: number, sentence: number, at: number, extra: Partial<BookMeta> = {}): BookMeta => ({
  id, title: id, author: '', format: 'txt', addedAt: 0, lastOpenedAt: 0,
  position: { chapter, sentence }, chapterSizes: [10, 10], positionUpdatedAt: at, ...extra,
});
const remote = (id: string, chapter: number, sentence: number, at: number, deleted = false): RemoteBook => ({
  id, title: id, author: '', format: 'txt', cover: null, chapter_sizes: [10, 10],
  position: { chapter, sentence }, position_updated_at: new Date(at).toISOString(), added_at: new Date(0).toISOString(), deleted,
});

describe('planSync', () => {
  it('scarica i libri che mancano e carica quelli solo locali', () => {
    const p = planSync([local('a', 0, 0, 1000)], [remote('b', 1, 3, 1000)], U);
    expect(p.download.map((r) => r.id)).toEqual(['b']);
    expect(p.upload.map((b) => b.id)).toEqual(['a']);
  });

  it('vince la posizione più recente', () => {
    const p = planSync(
      [local('a', 0, 5, 2000), local('b', 1, 1, 1000)],
      [remote('a', 0, 2, 1000), remote('b', 1, 8, 3000)],
      U,
    );
    expect(p.pushPosition.map((b) => b.id)).toEqual(['a']);
    expect(p.pullPosition).toEqual([{ id: 'b', position: { chapter: 1, sentence: 8 }, at: 3000 }]);
  });

  it('propaga le eliminazioni e non riscarica i libri eliminati', () => {
    const p = planSync([local('a', 0, 0, 1)], [remote('a', 0, 0, 1, true), remote('c', 0, 0, 1, true)], U);
    expect(p.deleteLocal).toEqual(['a']);
    expect(p.download).toEqual([]);
    expect(p.upload).toEqual([]);
  });

  it('non carica mai i libri di un altro account', () => {
    const p = planSync([local('x', 0, 0, 1, { ownerId: 'altro' })], [], U);
    expect(p.upload).toEqual([]);
  });

  it('stessa posizione: nessun aggiornamento', () => {
    const p = planSync([local('a', 1, 1, 5)], [remote('a', 1, 1, 9)], U);
    expect(p.pullPosition).toEqual([]);
    expect(p.pushPosition).toEqual([]);
  });
});
