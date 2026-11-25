import type { ParsedBook } from '../types';

export const ACCEPTED = '.epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain';

/** Sceglie il parser in base all'estensione. I parser pesanti sono caricati solo quando servono. */
export async function parseBook(file: File, onProgress?: (p: number) => void): Promise<ParsedBook> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'epub' || file.type === 'application/epub+zip') {
    return (await import('./epub')).parseEpub(file);
  }
  if (ext === 'pdf' || file.type === 'application/pdf') {
    return (await import('./pdf')).parsePdf(file, onProgress);
  }
  if (ext === 'txt' || file.type.startsWith('text/')) {
    return (await import('./txt')).parseTxt(file);
  }
  throw new Error(`Formato non supportato: .${ext ?? '?'} (usa EPUB, PDF o TXT)`);
}
