import type { Chapter } from './types';

/** Lunghezza massima di un pezzo letto in una volta (alcuni browser troncano frasi lunghe). */
export const MAX_CHUNK = 220;

// Abbreviazioni comuni (minuscolo, senza punto finale) dopo le quali NON si va a capo.
const ABBREVIATIONS = new Set([
  'sig', 'sigg', 'sig.ra', 'dott', 'dott.ssa', 'prof', 'prof.ssa', 'ing', 'avv', 'arch', 'geom',
  'rag', 'on', 'sen', 'mons', 'don', 'p', 'pag', 'pagg', 'cap', 'capp', 'es', 'ecc', 'etc', 'cfr',
  'vol', 'voll', 'n', 'nn', 'art', 'artt', 'fig', 'tab', 'ca', 'circa', 'sec', 'secc', 'a.c', 'd.c',
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'no', 'e.g', 'i.e', 'p.es', 'tel', 'ved', 'v',
]);

/** Normalizza spazi e caratteri strani. */
export function cleanText(s: string): string {
  return s
    .replace(/­/g, '') // trattino morbido
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Divide un paragrafo in frasi, gestendo abbreviazioni, numeri e virgolette. */
export function splitSentences(paragraph: string): string[] {
  const text = cleanText(paragraph);
  if (!text) return [];
  const out: string[] = [];
  // Fine frase: . ! ? … (anche ripetuti), seguiti da eventuali virgolette/parentesi chiuse e spazio.
  const re = /([.!?…]+)(["'»”’)\]]*)\s+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[1].length + m[2].length;
    const before = text.slice(start, m.index);
    const next = text.slice(re.lastIndex, re.lastIndex + 1);
    if (m[1] === '.' && !m[2]) {
      const lastWord = (before.match(/(\S+)$/)?.[1] ?? '').toLowerCase().replace(/^["'«“(]+/, '');
      // Abbreviazione o iniziale puntata (es. "J. R. R. Tolkien")
      if (ABBREVIATIONS.has(lastWord) || /^\p{L}$/u.test(lastWord)) continue;
    }
    // Se dopo viene una minuscola non è una nuova frase («Vieni!» disse. / 3. capitolo)
    if (/\p{Ll}/u.test(next)) continue;
    out.push(text.slice(start, end).trim());
    start = re.lastIndex;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out.flatMap(splitLong).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** Spezza le frasi troppo lunghe su ; : , o spazi, per non superare MAX_CHUNK. */
export function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_CHUNK) {
    const window = rest.slice(0, MAX_CHUNK);
    let cut = -1;
    for (const sep of [/[;:]\s/g, /[,–—)]\s/g, /\s/g]) {
      let mm: RegExpExecArray | null;
      let last = -1;
      while ((mm = sep.exec(window))) if (mm.index > MAX_CHUNK * 0.4) last = mm.index + mm[0].length - 1;
      if (last > 0) {
        cut = last;
        break;
      }
    }
    if (cut <= 0) cut = MAX_CHUNK;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Trasforma una lista di paragrafi di testo grezzo in paragrafi di frasi. */
export function toParagraphs(rawParagraphs: string[]): string[][] {
  return rawParagraphs.map(splitSentences).filter((p) => p.length > 0);
}

/** Tutte le frasi di un capitolo in un array piatto. */
export function flatSentences(ch: Chapter): string[] {
  return ch.paragraphs.flat();
}

export function countSentences(ch: Chapter): number {
  return ch.paragraphs.reduce((n, p) => n + p.length, 0);
}
