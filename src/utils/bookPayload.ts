/** Serialized into CanvasNode.content for type="book". */

export const BOOK_CONTENT_PREFIX = 'spoor-book:v1:';

export interface BookUnit {
  /** Page number or chapter title */
  title?: string;
  text: string;
}

export interface BookPayload {
  format: 'pdf' | 'epub';
  title: string;
  units: BookUnit[];
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
        })),
    };
  } catch {
    return null;
  }
}
