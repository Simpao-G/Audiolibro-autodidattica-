import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Chapter, ParsedBook } from '../types';
import { toParagraphs } from '../text';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PAGES_PER_CHAPTER = 10;

type TextItem = { str: string; hasEOL?: boolean; transform: number[]; height: number };

/** Ricostruisce i paragrafi di una pagina dalle righe di testo di pdf.js. */
function pageParagraphs(items: TextItem[]): string[] {
  const lines: { text: string; y: number; h: number }[] = [];
  let cur = '';
  let y = 0;
  let h = 0;
  for (const it of items) {
    if (!cur) {
      y = it.transform[5];
      h = it.height || h;
    }
    cur += it.str;
    if (it.hasEOL) {
      lines.push({ text: cur, y, h });
      cur = '';
    }
  }
  if (cur) lines.push({ text: cur, y, h });

  const paragraphs: string[] = [];
  let para = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text.trim();
    if (!line) {
      if (para) paragraphs.push(para);
      para = '';
      continue;
    }
    // Unisce le parole spezzate a fine riga ("compu-\nter")
    if (para.endsWith('-') && /^\p{Ll}/u.test(line)) para = para.slice(0, -1) + line;
    else para = para ? `${para} ${line}` : line;
    const next = lines[i + 1];
    // Nuovo paragrafo se c'è uno spazio verticale grande o la riga finisce con punto ed è corta
    const gap = next ? Math.abs(lines[i].y - next.y) : 0;
    const bigGap = next && lines[i].h > 0 && gap > lines[i].h * 1.8;
    if (bigGap) {
      paragraphs.push(para);
      para = '';
    }
  }
  if (para) paragraphs.push(para);
  // Scarta numeri di pagina isolati
  return paragraphs.filter((p) => !/^\s*\d{1,4}\s*$/.test(p));
}

export async function parsePdfData(data: ArrayBuffer, fileName = 'libro.pdf', onProgress?: (p: number) => void): Promise<ParsedBook> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };

  const pages: string[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(pageParagraphs(content.items.filter((it) => 'str' in it) as unknown as TextItem[]));
    onProgress?.(i / doc.numPages);
  }

  // Capitoli dal sommario del PDF (se presente), altrimenti gruppi di pagine.
  let starts: { title: string; page: number }[] = [];
  try {
    const outline = await doc.getOutline();
    for (const item of outline ?? []) {
      let dest = item.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (Array.isArray(dest) && dest[0]) {
        const page = await doc.getPageIndex(dest[0] as never);
        starts.push({ title: item.title, page });
      }
    }
    starts = starts.filter((s, i, a) => i === 0 || s.page > a[i - 1].page);
  } catch {
    starts = [];
  }
  if (starts.length < 2) {
    starts = [];
    for (let p = 0; p < pages.length; p += PAGES_PER_CHAPTER) {
      const last = Math.min(p + PAGES_PER_CHAPTER, pages.length);
      starts.push({ title: last === p + 1 ? `Pagina ${last}` : `Pagine ${p + 1}–${last}`, page: p });
    }
  } else if (starts[0].page > 0) {
    starts.unshift({ title: 'Inizio', page: 0 });
  }

  const chapters: Chapter[] = [];
  for (let c = 0; c < starts.length; c++) {
    const end = c + 1 < starts.length ? starts[c + 1].page : pages.length;
    const paras = toParagraphs(pages.slice(starts[c].page, end).flat());
    if (paras.length) chapters.push({ title: starts[c].title, paragraphs: paras });
  }
  if (!chapters.length) {
    throw new Error('Il PDF non contiene testo leggibile (forse è una scansione di immagini).');
  }
  return {
    title: info.Title?.trim() || fileName.replace(/\.pdf$/i, ''),
    author: info.Author?.trim() ?? '',
    format: 'pdf',
    chapters,
  };
}

export async function parsePdf(file: File, onProgress?: (p: number) => void): Promise<ParsedBook> {
  return parsePdfData(await file.arrayBuffer(), file.name, onProgress);
}
