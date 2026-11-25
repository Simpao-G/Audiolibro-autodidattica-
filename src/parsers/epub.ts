import JSZip from 'jszip';
import type { Chapter, ParsedBook } from '../types';
import { cleanText, toParagraphs } from '../text';

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DT', 'DD',
  'TR', 'FIGCAPTION', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'TD', 'BR',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'NOSCRIPT', 'SVG', 'MATH', 'RT']);

function parseXml(text: string, type: DOMParserSupportedType = 'application/xml'): Document {
  const doc = new DOMParser().parseFromString(text, type);
  if (doc.getElementsByTagName('parsererror').length && type !== 'text/html') {
    return new DOMParser().parseFromString(text, 'text/html');
  }
  return doc;
}

/** Trova elementi ignorando i namespace (dc:title, opf:item, ecc.). */
function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(
    (el) => (el.localName || el.nodeName).toLowerCase().replace(/^.*:/, '') === name,
  );
}

function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0]);
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '') + clean;
  const out: string[] = [];
  for (const seg of parts.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

/** Estrae i paragrafi di testo da un documento XHTML. */
export function extractParagraphs(doc: Document): { paragraphs: string[]; heading?: string } {
  const paragraphs: string[] = [];
  let heading: string | undefined;
  let buf = '';
  const flush = () => {
    const t = cleanText(buf);
    if (t) paragraphs.push(t);
    buf = '';
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      buf += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = (el.localName || el.nodeName).toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    // Salta le note a piè di pagina inline (rimandi numerici)
    if (tag === 'SUP' || el.getAttribute('epub:type') === 'noteref') return;
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    if (!heading && /^H[1-3]$/.test(tag)) heading = cleanText(el.textContent ?? '') || undefined;
    el.childNodes.forEach(walk);
    if (block) flush();
  };
  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
  walk(body);
  flush();
  return { paragraphs, heading };
}

/** Titoli dall'indice: EPUB3 (nav) o EPUB2 (toc.ncx). Restituisce path → titolo. */
async function readToc(zip: JSZip, opfPath: string, manifest: Map<string, { href: string; type: string; props: string }>, ncxId: string | null) {
  const titles = new Map<string, string>();
  const nav = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'));
  if (nav) {
    const navPath = resolvePath(opfPath, nav.href);
    const text = await zip.file(navPath)?.async('string');
    if (text) {
      const doc = parseXml(text, 'application/xhtml+xml');
      for (const a of byLocalName(doc, 'a')) {
        const href = a.getAttribute('href');
        const t = cleanText(a.textContent ?? '');
        if (href && t) {
          const p = resolvePath(navPath, href);
          if (!titles.has(p)) titles.set(p, t);
        }
      }
    }
  }
  const ncx = ncxId ? manifest.get(ncxId) : [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
  if (!titles.size && ncx) {
    const ncxPath = resolvePath(opfPath, ncx.href);
    const text = await zip.file(ncxPath)?.async('string');
    if (text) {
      const doc = parseXml(text);
      for (const np of byLocalName(doc, 'navpoint')) {
        const label = byLocalName(np, 'text')[0]?.textContent;
        const src = byLocalName(np, 'content')[0]?.getAttribute('src');
        if (label && src) {
          const p = resolvePath(ncxPath, src);
          if (!titles.has(p)) titles.set(p, cleanText(label));
        }
      }
    }
  }
  return titles;
}

async function toDataUrl(zip: JSZip, path: string, type: string): Promise<string | undefined> {
  const b64 = await zip.file(path)?.async('base64');
  return b64 ? `data:${type || 'image/jpeg'};base64,${b64}` : undefined;
}

export async function parseEpubData(data: ArrayBuffer | Uint8Array, fileName = 'libro.epub'): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(data);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB non valido: manca META-INF/container.xml');
  const opfPath = byLocalName(parseXml(container), 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB non valido: manca il file OPF');
  const opfText = await zip.file(opfPath)?.async('string');
  if (!opfText) throw new Error('EPUB non valido: file OPF non trovato');
  const opf = parseXml(opfText);

  const title = cleanText(byLocalName(opf, 'title')[0]?.textContent ?? '') || fileName.replace(/\.epub$/i, '');
  const author = cleanText(byLocalName(opf, 'creator')[0]?.textContent ?? '');

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of byLocalName(opf, 'item')) {
    const id = it.getAttribute('id');
    const href = it.getAttribute('href');
    if (id && href) {
      manifest.set(id, { href, type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' });
    }
  }

  // Copertina: EPUB3 properties="cover-image" oppure EPUB2 <meta name="cover" content="id">
  let coverItem = [...manifest.values()].find((m) => m.props.includes('cover-image'));
  if (!coverItem) {
    const coverId = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    if (coverId) coverItem = manifest.get(coverId);
  }
  const cover = coverItem ? await toDataUrl(zip, resolvePath(opfPath, coverItem.href), coverItem.type) : undefined;

  const spineEl = byLocalName(opf, 'spine')[0];
  const toc = await readToc(zip, opfPath, manifest, spineEl?.getAttribute('toc') ?? null);

  const chapters: Chapter[] = [];
  for (const ref of byLocalName(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item) continue;
    const path = resolvePath(opfPath, item.href);
    const html = await zip.file(path)?.async('string');
    if (!html) continue;
    const type = item.type.includes('html') && !item.type.includes('xhtml') ? 'text/html' : 'application/xhtml+xml';
    const { paragraphs, heading } = extractParagraphs(parseXml(html, type));
    const paras = toParagraphs(paragraphs);
    if (!paras.length) continue;
    chapters.push({ title: toc.get(path) ?? heading ?? `Capitolo ${chapters.length + 1}`, paragraphs: paras });
  }
  if (!chapters.length) throw new Error('Nessun testo trovato nel libro (potrebbe essere protetto da DRM).');
  return { title, author, cover, format: 'epub', chapters };
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  return parseEpubData(await file.arrayBuffer(), file.name);
}
