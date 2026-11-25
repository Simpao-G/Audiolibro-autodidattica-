import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { decodeText, parseTxtString } from '../src/parsers/txt';
import { parseEpubData } from '../src/parsers/epub';

describe('parser TXT', () => {
  it('riconosce i capitoli', () => {
    const book = parseTxtString(
      'Capitolo 1\n\nC’era una volta un re. Viveva in un castello.\n\nCapitolo 2\n\nUn giorno partì.',
      'il_mio-libro.txt',
    );
    expect(book.title).toBe('il mio libro');
    expect(book.chapters.map((c) => c.title)).toEqual(['Capitolo 1', 'Capitolo 2']);
    expect(book.chapters[0].paragraphs).toEqual([['C’era una volta un re.', 'Viveva in un castello.']]);
  });

  it('senza intestazioni divide in parti', () => {
    const text = Array.from({ length: 90 }, (_, i) => `Paragrafo numero ${i}.`).join('\n\n');
    const book = parseTxtString(text, 'x.txt');
    expect(book.chapters.length).toBe(3);
    expect(book.chapters[0].title).toBe('Parte 1');
  });

  it('decodifica Windows-1252', () => {
    const bytes = new Uint8Array([0x70, 0x65, 0x72, 0xf2]); // "però" in cp1252
    expect(decodeText(bytes.buffer)).toBe('però');
  });
});

async function makeEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Il Libro</dc:title><dc:creator>Ada Autrice</dc:creator></metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>
      <li><a href="text/c1.xhtml">L'inizio</a></li><li><a href="text/c2.xhtml#x">La fine</a></li></ol></nav></body></html>`,
  );
  zip.file(
    'OEBPS/text/c1.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body>
      <h1>Uno</h1><p>Prima frase. Seconda <em>frase</em> qui.<sup>1</sup></p><p>Altro paragrafo.</p></body></html>`,
  );
  zip.file('OEBPS/text/c2.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Ultimo capitolo!</p></body></html>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('parser EPUB', () => {
  it('legge metadati, indice e testo', async () => {
    const book = await parseEpubData(await makeEpub());
    expect(book.title).toBe('Il Libro');
    expect(book.author).toBe('Ada Autrice');
    expect(book.chapters.map((c) => c.title)).toEqual(["L'inizio", 'La fine']);
    expect(book.chapters[0].paragraphs).toEqual([['Uno'], ['Prima frase.', 'Seconda frase qui.'], ['Altro paragrafo.']]);
    expect(book.chapters[1].paragraphs).toEqual([['Ultimo capitolo!']]);
  });
});
