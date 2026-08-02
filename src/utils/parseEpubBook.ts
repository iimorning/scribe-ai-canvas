import JSZip from 'jszip';
import type {
  BookContentBlock,
  BookHeadingLevel,
  BookPayload,
  BookUnit,
} from './bookPayload';

/** Skip oversized embeds to keep IndexedDB / node content manageable. */
const MAX_EPUB_IMAGE_BYTES = 1_500_000;
const MAX_EPUB_IMAGES_PER_UNIT = 24;

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

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function mimeFromPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg') || lower.endsWith('.svgz')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return null;
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

type InlinePart =
  | { type: 'text'; text: string }
  | { type: 'heading'; level: BookHeadingLevel; text: string }
  | { type: 'image'; href: string; alt?: string };

function pushTextPart(parts: InlinePart[], xhtmlFragment: string) {
  const text = xhtmlToPlainText(xhtmlFragment);
  if (text) parts.push({ type: 'text', text });
}

function pushImageFromTag(parts: InlinePart[], tag: string) {
  const src = attr(tag, 'src') || attr(tag, 'href') || attr(tag, 'xlink:href');
  const altRaw = attr(tag, 'alt') || attr(tag, 'title');
  const alt = altRaw ? decodeXmlEntities(altRaw).trim() : undefined;
  if (src?.trim()) {
    parts.push({ type: 'image', href: src.trim(), alt: alt || undefined });
  }
}

/** Split XHTML into ordered headings, text, and image references. */
export function xhtmlToInlineParts(xhtml: string): InlinePart[] {
  const cleaned = xhtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<rt[\s\S]*?<\/rt>/gi, ' ')
    .replace(/<rp[\s\S]*?<\/rp>/gi, ' ');

  const parts: InlinePart[] = [];
  // Headings first (with inner HTML), then standalone image tags.
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>|<(?:img|image)\b[^>]*>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    pushTextPart(parts, cleaned.slice(lastIndex, match.index));

    if (match[1] != null) {
      const level = Number(match[1]) as BookHeadingLevel;
      const headingText = xhtmlToPlainText(match[2] ?? '');
      if (headingText) parts.push({ type: 'heading', level, text: headingText });
    } else {
      pushImageFromTag(parts, match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  pushTextPart(parts, cleaned.slice(lastIndex));
  return parts;
}

async function loadImageDataUrl(
  zip: JSZip,
  chapterPath: string,
  href: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (href.startsWith('data:image/')) return href;
  if (/^https?:\/\//i.test(href) || href.startsWith('//')) return null;

  const entryPath = resolveZipPath(chapterPath, decodeHref(href));
  if (cache.has(entryPath)) return cache.get(entryPath) ?? null;

  const mime = mimeFromPath(entryPath);
  if (!mime) {
    cache.set(entryPath, null);
    return null;
  }

  const entry = findZipEntry(zip, entryPath);
  if (!entry) {
    cache.set(entryPath, null);
    return null;
  }

  const bytes = await entry.async('uint8array');
  if (!bytes.length || bytes.length > MAX_EPUB_IMAGE_BYTES) {
    cache.set(entryPath, null);
    return null;
  }

  const dataUrl = `data:${mime};base64,${uint8ToBase64(bytes)}`;
  cache.set(entryPath, dataUrl);
  return dataUrl;
}

async function buildUnitFromXhtml(
  zip: JSZip,
  chapterPath: string,
  xhtml: string,
  title: string,
  imageCache: Map<string, string | null>,
): Promise<BookUnit | null> {
  const parts = xhtmlToInlineParts(xhtml);
  if (parts.length === 0) return null;

  const blocks: BookContentBlock[] = [];
  const textChunks: string[] = [];
  let imageCount = 0;

  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
      textChunks.push(part.text);
      continue;
    }
    if (part.type === 'heading') {
      blocks.push({ type: 'heading', level: part.level, text: part.text });
      textChunks.push(part.text);
      continue;
    }

    const marker = part.alt ? `[图: ${part.alt}]` : '[图]';
    textChunks.push(marker);

    if (imageCount >= MAX_EPUB_IMAGES_PER_UNIT) continue;
    const dataUrl = await loadImageDataUrl(zip, chapterPath, part.href, imageCache);
    if (!dataUrl) continue;
    imageCount += 1;
    blocks.push({ type: 'image', src: dataUrl, alt: part.alt });
  }

  const text = textChunks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text && blocks.every((b) => b.type !== 'image')) return null;

  return {
    title,
    text: text || '[图]',
    blocks: blocks.length > 0 ? blocks : undefined,
  };
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
  const imageCache = new Map<string, string | null>();
  let chapterIndex = 0;

  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) continue;
    if (item.mediaType && !/html|xml/i.test(item.mediaType)) continue;
    const entryPath = resolveZipPath(opfPath, item.href);
    const entry = findZipEntry(zip, entryPath);
    if (!entry) continue;
    const xhtml = await entry.async('text');
    chapterIndex += 1;
    const heading =
      xhtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const title = heading
      ? decodeXmlEntities(heading.replace(/<[^>]+>/g, '').trim()).slice(0, 80)
      : String(chapterIndex);
    const unit = await buildUnitFromXhtml(zip, entryPath, xhtml, title, imageCache);
    if (unit) units.push(unit);
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
