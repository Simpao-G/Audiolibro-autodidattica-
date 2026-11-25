import type { Chapter, ParsedBook } from '../types';
import { toParagraphs } from '../text';

/** Riconosce le intestazioni di capitolo più comuni (italiano e inglese). */
const HEADING_RE =
  /^\s*((capitolo|cap\.|parte|libro|chapter|part|prologo|epilogo|prefazione|introduzione|prologue|epilogue)\b[^\n]{0,80}|[IVXLC]{1,7}\.?|\d{1,3}\.?)\s*$/i;

/** Decodifica il file provando UTF-8 e, se fallisce, Windows-1252 (tipico dei vecchi .txt). */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Paragrafi per capitolo quando il testo non ha intestazioni riconoscibili. */
const PARAGRAPHS_PER_CHUNK = 40;

export function parseTxtString(text: string, fileName: string): ParsedBook {
  const normalized = text.replace(/\r\n?/g, '\n');
  // Paragrafi separati da righe vuote; se non ce ne sono, ogni riga è un paragrafo.
  let blocks = normalized.split(/\n\s*\n/);
  if (blocks.length < 3) blocks = normalized.split('\n');
  blocks = blocks.map((b) => b.replace(/-\n(?=\p{Ll})/gu, '').replace(/\n/g, ' ').trim()).filter(Boolean);

  const chapters: Chapter[] = [];
  let current: { title: string; raw: string[] } | null = null;
  const flush = () => {
    if (current && current.raw.length) {
      chapters.push({ title: current.title, paragraphs: toParagraphs(current.raw) });
    }
  };

  const headingCount = blocks.filter((b) => b.length < 90 && HEADING_RE.test(b)).length;
  if (headingCount >= 2) {
    for (const b of blocks) {
      if (b.length < 90 && HEADING_RE.test(b)) {
        flush();
        current = { title: b, raw: [] };
      } else {
        if (!current) current = { title: 'Inizio', raw: [] };
        current.raw.push(b);
      }
    }
    flush();
  } else {
    for (let i = 0; i < blocks.length; i += PARAGRAPHS_PER_CHUNK) {
      current = { title: `Parte ${chapters.length + 1}`, raw: blocks.slice(i, i + PARAGRAPHS_PER_CHUNK) };
      flush();
    }
  }

  const title = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Senza titolo';
  return { title, author: '', format: 'txt', chapters: chapters.filter((c) => c.paragraphs.length) };
}

export async function parseTxt(file: File): Promise<ParsedBook> {
  return parseTxtString(decodeText(await file.arrayBuffer()), file.name);
}
