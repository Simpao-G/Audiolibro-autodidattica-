// Preparazione del testo per Supertonic 3 (porting di UnicodeProcessor dal demo ufficiale, licenza MIT).

const REPLACEMENTS: [RegExp, string][] = [
  [/[–‑—]/g, '-'],
  [/[_[\]|/#→←]/g, ' '],
  [/[“”„«»]/g, '"'],
  [/[‘’‚´`]/g, "'"],
  [/[♥☆♡©\\]/g, ''],
  [/@/g, ' at '],
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu;
const ENDS_WITH_PUNCT = /[.!?;:,'")\]}…。」』】>》»]$/;

/** Normalizza una frase come si aspetta il modello e la racchiude nel tag della lingua. */
export function preprocess(text: string, lang = 'it'): string {
  let t = text.normalize('NFKD').replace(EMOJI, '');
  for (const [re, rep] of REPLACEMENTS) t = t.replace(re, rep);
  t = t
    .replace(/\s+([,.!?;:'])/g, '$1') // niente spazio prima della punteggiatura
    .replace(/""+/g, '"')
    .replace(/''+/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (t && !ENDS_WITH_PUNCT.test(t)) t += '.';
  return `<${lang}>${t}</${lang}>`;
}

/**
 * Converte il testo in identificativi del modello tramite unicode_indexer
 * (un array indicizzato per code point). I caratteri sconosciuti vengono saltati.
 */
export function toIds(text: string, indexer: ArrayLike<number>): number[] {
  const ids: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const id = cp < indexer.length ? indexer[cp] : -1;
    if (id >= 0) ids.push(id);
  }
  return ids;
}
