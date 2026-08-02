import type { CanvasNode } from '../db';
import { tryParseBookContent } from './bookPayload';

const DATA_URL_RE = /^data:/i;
const MAX_FIELD_CHARS = 20_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushField(parts: string[], value: string | undefined | null) {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (DATA_URL_RE.test(trimmed)) return;
  parts.push(trimmed.length > MAX_FIELD_CHARS ? trimmed.slice(0, MAX_FIELD_CHARS) : trimmed);
}

/** Flatten a canvas node into searchable plain text. */
export function getCanvasNodeSearchText(node: CanvasNode): string {
  const parts: string[] = [];
  pushField(parts, node.description);
  pushField(parts, node.themeTag);
  pushField(parts, node.userTurn);

  const content = node.content?.trim() ?? '';
  if (!content || DATA_URL_RE.test(content)) {
    return parts.join('\n');
  }

  if (node.type === 'book') {
    const book = tryParseBookContent(content);
    if (book) {
      pushField(parts, book.title);
      for (const unit of book.units) {
        pushField(parts, unit.title);
        pushField(parts, unit.text);
      }
    } else {
      pushField(parts, content);
    }
    return parts.join('\n');
  }

  if (node.type === 'document' || /<\/?[a-z][\s\S]*>/i.test(content)) {
    pushField(parts, stripHtml(content));
    return parts.join('\n');
  }

  pushField(parts, content);
  return parts.join('\n');
}

export function canvasNodeTypeLabelKey(type: string): string {
  switch (type) {
    case 'note':
    case 'text':
      return 'canvas.search_type_note';
    case 'theme':
      return 'canvas.search_type_theme';
    case 'ai':
      return 'canvas.search_type_ai';
    case 'book':
      return 'canvas.search_type_book';
    case 'document':
      return 'canvas.search_type_document';
    case 'image':
      return 'canvas.search_type_image';
    case 'video':
      return 'canvas.search_type_video';
    case 'agent':
      return 'canvas.search_type_agent';
    default:
      return 'canvas.search_type_other';
  }
}

export interface CanvasNodeSearchHit {
  node: CanvasNode;
  preview: string;
}

function makePreview(haystack: string, query: string, maxLen = 72): string {
  const lower = haystack.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) {
    const compact = haystack.replace(/\s+/g, ' ').trim();
    return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
  }
  const pad = Math.floor((maxLen - query.length) / 2);
  const start = Math.max(0, idx - pad);
  const end = Math.min(haystack.length, start + maxLen);
  const slice = haystack.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < haystack.length ? '…' : '';
  return `${prefix}${slice}${suffix}`;
}

/** Case-insensitive keyword match across note/card text. */
export function searchCanvasNodes(nodes: CanvasNode[], query: string): CanvasNodeSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: CanvasNodeSearchHit[] = [];
  for (const node of nodes) {
    // Skip pure media URL cards with no caption — little to find by keyword.
    if ((node.type === 'image' || node.type === 'video') && !node.description?.trim()) {
      continue;
    }
    const text = getCanvasNodeSearchText(node);
    if (!text.toLowerCase().includes(q)) continue;
    hits.push({ node, preview: makePreview(text, q) || node.type });
  }

  // Prefer note/text first, then theme/ai, then the rest.
  const rank = (type: string) => {
    if (type === 'note' || type === 'text') return 0;
    if (type === 'theme') return 1;
    if (type === 'ai') return 2;
    if (type === 'book' || type === 'document') return 3;
    return 4;
  };
  hits.sort((a, b) => rank(a.node.type) - rank(b.node.type));
  return hits;
}
