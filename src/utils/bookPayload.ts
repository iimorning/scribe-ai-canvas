/** Serialized into CanvasNode.content for type="book". */

export const BOOK_CONTENT_PREFIX = 'spoor-book:v1:';

export type BookHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type BookContentBlock =
  | { type: 'text'; text: string }
  | { type: 'heading'; level: BookHeadingLevel; text: string }
  | { type: 'image'; src: string; alt?: string };

export interface BookUnit {
  /** Page number or chapter title */
  title?: string;
  /** Plain text for selection / AI (images represented as [图] markers). */
  text: string;
  /** Rich chapter body for EPUB (text + inline images). */
  blocks?: BookContentBlock[];
}

export interface BookPayload {
  format: 'pdf' | 'epub';
  title: string;
  units: BookUnit[];
}

function normalizeHeadingLevel(level: unknown): BookHeadingLevel | null {
  const n = typeof level === 'number' ? level : Number(level);
  if (n >= 1 && n <= 6) return n as BookHeadingLevel;
  return null;
}

function normalizeBlocks(raw: unknown): BookContentBlock[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const blocks: BookContentBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const block = item as {
      type?: unknown;
      text?: unknown;
      src?: unknown;
      alt?: unknown;
      level?: unknown;
    };
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      blocks.push({ type: 'text', text: block.text });
      continue;
    }
    if (block.type === 'heading' && typeof block.text === 'string' && block.text) {
      const level = normalizeHeadingLevel(block.level);
      if (level) blocks.push({ type: 'heading', level, text: block.text });
      continue;
    }
    if (
      block.type === 'image' &&
      typeof block.src === 'string' &&
      block.src.startsWith('data:image/')
    ) {
      blocks.push({
        type: 'image',
        src: block.src,
        alt: typeof block.alt === 'string' && block.alt ? block.alt : undefined,
      });
    }
  }
  return blocks.length > 0 ? blocks : undefined;
}

export function encodeBookContent(payload: BookPayload): string {
  return BOOK_CONTENT_PREFIX + JSON.stringify(payload);
}

export function tryParseBookContent(content: string | undefined | null): BookPayload | null {
  if (!content || !content.startsWith(BOOK_CONTENT_PREFIX)) return null;
  try {
    const raw = JSON.parse(content.slice(BOOK_CONTENT_PREFIX.length)) as BookPayload;
    if (!raw || (raw.format !== 'pdf' && raw.format !== 'epub') || !Array.isArray(raw.units)) {
      return null;
    }
    return {
      format: raw.format,
      title: typeof raw.title === 'string' ? raw.title : '',
      units: raw.units
        .filter((u) => u && typeof u.text === 'string')
        .map((u) => ({
          title: typeof u.title === 'string' ? u.title : undefined,
          text: u.text,
          blocks: normalizeBlocks(u.blocks),
        })),
    };
  } catch {
    return null;
  }
}
