import type { CanvasNode } from '../db';

/** Textual card types that can disambiguate a note search. */
const SEARCH_CONTEXT_TYPES = new Set(['note', 'text', 'theme', 'ai']);

const DEFAULT_MAX_CARDS = 12;
const DEFAULT_MAX_CHARS_PER_CARD = 1200;
const DEFAULT_MAX_TOTAL_CHARS = 6000;

/** High-signal place tokens often dropped when the model only reads the primary card. */
const DISAMBIGUATORS: ReadonlyArray<{ test: RegExp; token: string }> = [
  { test: /日本|Japan|Japanese/i, token: '日本' },
  { test: /美国|USA|U\.S\.A\.|United States|America/i, token: '美国' },
  { test: /英国|Britain|UK|United Kingdom|England/i, token: '英国' },
  { test: /韩国|Korea|Korean/i, token: '韩国' },
  { test: /德国|Germany|German/i, token: '德国' },
  { test: /法国|France|French/i, token: '法国' },
  { test: /苏联|Soviet|USSR/i, token: '苏联' },
  { test: /欧洲|Europe|European/i, token: '欧洲' },
];

function nodeSearchableText(node: CanvasNode): string {
  const parts = [node.content, node.description]
    .map((p) => (typeof p === 'string' ? p.replace(/\r\n/g, '\n').trim() : ''))
    .filter(Boolean);
  return parts.join('\n\n').trim();
}

function isSearchContextNode(node: CanvasNode, sourceId: string): boolean {
  if (node.id === sourceId) return false;
  // Prior search result cards — including them pollutes the next query.
  if (node.webSearchParentId) return false;
  if (!SEARCH_CONTEXT_TYPES.has(node.type)) return false;
  return !!nodeSearchableText(node);
}

function addUndirected(
  adj: Map<string, Set<string>>,
  a: string,
  b: string,
): void {
  if (a === b) return;
  const fromA = adj.get(a) ?? new Set<string>();
  fromA.add(b);
  adj.set(a, fromA);
  const fromB = adj.get(b) ?? new Set<string>();
  fromB.add(a);
  adj.set(b, fromB);
}

/**
 * Book-expand siblings share `bookExpandParentId` even when the theme hub
 * (and its edges) were deleted — still treat them as linked background.
 */
function addBookExpandImplicitLinks(
  adj: Map<string, Set<string>>,
  nodes: CanvasNode[],
  byId: Map<string, CanvasNode>,
): void {
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const parentId = (n.bookExpandParentId ?? '').trim();
    if (!parentId) continue;
    if (n.type !== 'note' && n.type !== 'text') continue;
    const list = groups.get(parentId) ?? [];
    list.push(n.id);
    groups.set(parentId, list);
  }
  for (const [parentId, childIds] of groups) {
    if (byId.has(parentId)) {
      for (const id of childIds) addUndirected(adj, parentId, id);
    }
    for (let i = 0; i < childIds.length; i++) {
      for (let j = i + 1; j < childIds.length; j++) {
        addUndirected(adj, childIds[i]!, childIds[j]!);
      }
    }
  }
}

/**
 * Collect text from cards reachable via undirected edges from `sourceId`,
 * plus book-expand sibling/hub links via `bookExpandParentId`.
 */
export function collectLinkedCardTextsForSearch(
  sourceId: string,
  nodes: CanvasNode[],
  edges: { from: string; to: string }[],
  options?: {
    maxCards?: number;
    maxCharsPerCard?: number;
    maxTotalChars?: number;
  },
): string[] {
  const maxCards = options?.maxCards ?? DEFAULT_MAX_CARDS;
  const maxCharsPerCard = options?.maxCharsPerCard ?? DEFAULT_MAX_CHARS_PER_CARD;
  const maxTotalChars = options?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(sourceId)) return [];

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    addUndirected(adj, e.from, e.to);
  }
  addBookExpandImplicitLinks(adj, nodes, byId);

  const visited = new Set<string>([sourceId]);
  const queue = [sourceId];
  const out: string[] = [];
  let totalChars = 0;

  while (queue.length > 0 && out.length < maxCards && totalChars < maxTotalChars) {
    const id = queue.shift()!;
    for (const nid of adj.get(id) ?? []) {
      if (visited.has(nid)) continue;
      visited.add(nid);
      queue.push(nid);

      const node = byId.get(nid);
      if (!node || !isSearchContextNode(node, sourceId)) continue;

      let text = nodeSearchableText(node);
      if (!text) continue;
      if (text.length > maxCharsPerCard) text = text.slice(0, maxCharsPerCard);
      if (totalChars + text.length > maxTotalChars) {
        const room = maxTotalChars - totalChars;
        if (room < 40) return out;
        text = text.slice(0, room);
      }
      out.push(text);
      totalChars += text.length;
      if (out.length >= maxCards || totalChars >= maxTotalChars) break;
    }
  }

  return out;
}

/** Join linked card texts for the search-intent prompt. */
export function formatLinkedCardContextForSearch(texts: string[]): string {
  if (texts.length === 0) return '(none)';
  return texts.map((t) => t.trim()).filter(Boolean).join('\n\n---\n\n');
}

/**
 * If linked cards clearly name a country/region the query omitted, prepend it.
 * Guards against models that only read the primary card.
 */
export function enrichSearchQueryWithLinkedContext(
  query: string,
  linkedTexts: string[],
): string {
  const q = query.replace(/\s+/g, ' ').trim();
  if (!q || linkedTexts.length === 0) return q;
  const linkedBlob = linkedTexts.join('\n');
  const missing: string[] = [];
  for (const { test, token } of DISAMBIGUATORS) {
    if (test.test(linkedBlob) && !test.test(q)) missing.push(token);
  }
  if (missing.length === 0) return q;
  return `${missing.join(' ')} ${q}`.replace(/\s+/g, ' ').trim().slice(0, 80);
}
