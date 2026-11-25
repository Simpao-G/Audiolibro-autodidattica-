import { describe, expect, it } from 'vitest';
import { MAX_CHUNK, splitSentences } from '../src/text';

describe('splitSentences', () => {
  it('divide frasi semplici', () => {
    expect(splitSentences('Ciao a tutti. Come state? Bene!')).toEqual(['Ciao a tutti.', 'Come state?', 'Bene!']);
  });

  it('non spezza sulle abbreviazioni', () => {
    expect(splitSentences('Il Sig. Rossi e il Dott. Bianchi arrivarono. Poi partirono.')).toEqual([
      'Il Sig. Rossi e il Dott. Bianchi arrivarono.',
      'Poi partirono.',
    ]);
  });

  it('non spezza su iniziali e numeri', () => {
    expect(splitSentences('Lo scrisse J. R. R. Tolkien nel 1954. Fine.')).toEqual(['Lo scrisse J. R. R. Tolkien nel 1954.', 'Fine.']);
  });

  it('gestisce virgolette e puntini di sospensione', () => {
    expect(splitSentences('«Vieni qui!» disse. Lei esitò… Poi andò.')).toEqual(['«Vieni qui!» disse.', 'Lei esitò…', 'Poi andò.']);
  });

  it('spezza le frasi troppo lunghe', () => {
    const long = Array.from({ length: 60 }, (_, i) => `parola${i}`).join(', ') + '.';
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_CHUNK);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });

  it('ignora testo senza lettere', () => {
    expect(splitSentences('  * * *  ')).toEqual([]);
  });
});
