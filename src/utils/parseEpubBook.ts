import JSZip from 'jszip';
import type { BookPayload, BookUnit } from './bookPayload';

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Strip tags / scripts from XHTML and return readable text. */
export function xhtmlToPlainText(xhtml: string): string {
  const withoutNoise = xhtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<rt[\s\S]*?<\/rt>/gi, ' ')
    .replace(/<rp[\s\S]*?<\/rp>/gi, ' ');
  const withBreaks = withoutNoise
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|chapter)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeXmlEntities(withBreaks)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

function resolveZipPath(basePath: string, href: string): string {
  const cleaned = href.split('#')[0];
  if (!cleaned) return basePath;
  if (cleaned.startsWith('/')) return cleaned.replace(/^\/+/, '');
  const baseDir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : '';
  const parts = (baseDir + cleaned).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function findZipEntry(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = zip.file(path);
  if (direct) return direct;
  const lower = path.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase() === lower) return zip.file(name);
  }
  return null;
}

export async function parseEpubBook(arrayBuffer: ArrayBuffer, fileName: string): Promise<BookPayload> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const containerEntry = findZipEntry(zip, 'META-INF/container.xml');
  if (!containerEntry) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml');
  }
  const containerXml = await containerEntry.async('text');
  const rootHrefMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!rootHrefMatch) {
    throw new Error('Invalid EPUB: missing rootfile path');
  }
  const opfPath = rootHrefMatch[1].replace(/^\/+/, '');
  const opfEntry = findZipEntry(zip, opfPath);
  if (!opfEntry) {
    throw new Error(`Invalid EPUB: missing OPF at ${opfPath}`);
  }
  const opfXml = await opfEntry.async('text');

  const titleMatch =
    opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) ||
    opfXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const bookTitle = titleMatch
    ? decodeXmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim())
    : fileName.replace(/\.epub$/i, '') || fileName;

  const manifest = new Map<string, { href: string; mediaType: string }>();
  const manifestBlock = opfXml.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i)?.[1] ?? '';
  for (const itemMatch of manifestBlock.matchAll(/<item\b[^>]*>/gi)) {
    const tag = itemMatch[0];
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    const mediaType = attr(tag, 'media-type') || attr(tag, 'mediaType') || '';
    if (id && href) {
      manifest.set(id, { href, mediaType });
    }
  }

  const spineBlock = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i)?.[1] ?? '';
  const spineIds = [...spineBlock.matchAll(/<itemref\b[^>]*>/gi)]
    .map((m) => attr(m[0], 'idref'))
    .filter((id): id is string => Boolean(id));

  const units: BookUnit[] = [];
  let chapterIndex = 0;

  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) continue;
    if (item.mediaType && !/html|xml/i.test(item.mediaType)) continue;
    const entryPath = resolveZipPath(opfPath, item.href);
    const entry = findZipEntry(zip, entryPath);
    if (!entry) continue;
    const xhtml = await entry.async('text');
    const text = xhtmlToPlainText(xhtml);
    if (!text) continue;
    chapterIndex += 1;
    const heading =
      xhtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const title = heading
      ? decodeXmlEntities(heading.replace(/<[^>]+>/g, '').trim()).slice(0, 80)
      : String(chapterIndex);
    units.push({ title, text });
  }

  if (units.length === 0) {
    throw new Error('EPUB has no readable chapters');
  }

  return {
    format: 'epub',
    title: bookTitle,
    units,
  };
}
