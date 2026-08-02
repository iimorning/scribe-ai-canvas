import { db, type CanvasNode, type Edge } from '../db';
import type { MetasoImage, MetasoWebpage } from './search';
import { resolveMetasoImageUrl } from './search';

const DEFAULT_STAGGER_MS = 320;
/** Sources live in a dedicated vertical lane beside the answer, never in a fan of overlaps. */
export const SOURCE_LANE_OFFSET_X = 380;
export const SOURCE_ROW_GAP_Y = 240;
export const SOURCE_CARD_WIDTH = 320;
export const SOURCE_CARD_HEIGHT = 210;
/** Neat deck offset when sources are collapsed (keep small so the pile stays tidy). */
export const SOURCE_STACK_STEP = 5;
/** Fallback when the answer card height is not measured yet (streaming / just created). */
export const DEFAULT_ANCHOR_HEIGHT = 280;

/**
 * Use the first non-empty line of the draft (cap length) as the Metaso query.
 */
export function deriveSearchQueryFromNoteText(text: string, maxLen = 280): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  const line = normalized.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen);
}

/**
 * Y of source card `index` so the whole lane is vertically centered on the answer card.
 * Tall stacks extend equally above and below the answer instead of hanging from its top edge.
 */
export function sourceCardY(
  baseY: number,
  index: number,
  count: number,
  anchorHeight = DEFAULT_ANCHOR_HEIGHT,
): number {
  const n = Math.max(count, 1);
  const stackHeight = (n - 1) * SOURCE_ROW_GAP_Y + SOURCE_CARD_HEIGHT;
  const centerY = baseY + Math.max(anchorHeight, 1) / 2;
  const firstY = centerY - stackHeight / 2;
  return firstY + index * SOURCE_ROW_GAP_Y;
}

export function sourceCardStackPos(
  base: { x: number; y: number },
  index: number,
  _count = 1,
  anchorHeight = DEFAULT_ANCHOR_HEIGHT,
): { x: number; y: number } {
  const centerY = base.y + Math.max(anchorHeight, 1) / 2;
  // Front card (index 0) at the anchor; each deeper card peeks a few px bottom-right.
  return {
    x: base.x + SOURCE_LANE_OFFSET_X + index * SOURCE_STACK_STEP,
    y: centerY - SOURCE_CARD_HEIGHT / 2 + index * SOURCE_STACK_STEP,
  };
}

/** Higher z for earlier sources so #1 sits on top of the neat deck. */
export function sourceStackZIndex(index: number): number {
  return 420 - index;
}

export function isWebSearchSourceNode(node: CanvasNode): boolean {
  if (node.webSearchParentId) return true;
  if (node.type === 'image' && typeof node.webSearchIndex === 'number') return true;
  if (node.type !== 'text' && node.type !== 'note') return false;
  if (node.layout !== 2) return false;
  return /^###\s*\d+\./m.test((node.content ?? '').trim());
}

export function webSearchSourceIndex(node: CanvasNode): number {
  if (typeof node.webSearchIndex === 'number') return node.webSearchIndex;
  const m = /^###\s*(\d+)\./m.exec((node.content ?? '').trim());
  return m ? Math.max(0, Number.parseInt(m[1]!, 10) - 1) : 0;
}

export function listWebSearchSourcesForParent(
  parentId: string,
  nodes: CanvasNode[],
  edges: Pick<Edge, 'from' | 'to'>[],
): CanvasNode[] {
  const childIds = new Set(edges.filter((e) => e.from === parentId).map((e) => e.to));
  return nodes
    .filter((n) => {
      if (!childIds.has(n.id)) return false;
      if (n.webSearchParentId === parentId) return true;
      if (n.webSearchParentId) return false;
      if (n.type === 'image') return typeof n.webSearchIndex === 'number';
      return isWebSearchSourceNode(n);
    })
    .sort((a, b) => webSearchSourceIndex(a) - webSearchSourceIndex(b));
}

/** Keep stacked cards upright — tilt made the pile look scattered. */
export function sourceStackTiltDeg(_index: number): number {
  return 0;
}

/**
 * Collapse sources into a photo stack beside the answer, or expand back to the vertical lane.
 */
export async function setWebSearchSourcesCollapsed(
  parentId: string,
  collapsed: boolean,
  options?: {
    nodes?: CanvasNode[];
    edges?: Pick<Edge, 'from' | 'to'>[];
    anchorHeight?: number;
  },
): Promise<number> {
  const parent = await db.nodes.get(parentId);
  if (!parent) return 0;

  const nodes = options?.nodes ?? (await db.nodes.toArray());
  const edges = options?.edges ?? (await db.edges.toArray());
  const sources = listWebSearchSourcesForParent(parentId, nodes, edges);
  if (sources.length === 0) return 0;

  const anchorHeight = options?.anchorHeight ?? parent.height ?? DEFAULT_ANCHOR_HEIGHT;
  const base = { x: parent.x, y: parent.y };

  await db.transaction('rw', db.nodes, async () => {
    await db.nodes.update(parentId, { webSearchSourcesCollapsed: collapsed });
    for (let i = 0; i < sources.length; i++) {
      const pos = collapsed
        ? sourceCardStackPos(base, i, sources.length, anchorHeight)
        : {
            x: base.x + SOURCE_LANE_OFFSET_X,
            y: sourceCardY(base.y, i, sources.length, anchorHeight),
          };
      await db.nodes.update(sources[i]!.id, pos);
    }
  });
  return sources.length;
}

function pageToMarkdown(wp: MetasoWebpage, index: number): string {
  const title = (wp.title || 'Source').replace(/\n/g, ' ');
  const snippet = (wp.snippet || '').trim();
  const link = wp.link || '';
  return `### ${index}. ${title}\n\n${snippet}${link ? `\n\n[${link}](${link})` : ''}`;
}

/**
 * Create one compact, scrollable source card per hit in a vertical lane beside the source node.
 */
export async function spawnWebSearchCardsFromPages(
  sourceNodeId: string,
  base: { x: number; y: number },
  pages: MetasoWebpage[],
  activeCanvasId: string,
  options?: { staggerMs?: number; anchorHeight?: number },
): Promise<void> {
  const staggerMs = options?.staggerMs ?? DEFAULT_STAGGER_MS;
  const anchorHeight = options?.anchorHeight ?? DEFAULT_ANCHOR_HEIGHT;
  const list = pages.filter((p) => (p.title || p.snippet || p.link).trim().length > 0);

  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    const id = crypto.randomUUID();
    await db.nodes.add({
      id,
      canvasId: activeCanvasId,
      type: 'text',
      content: pageToMarkdown(list[i]!, i + 1),
      x: base.x + SOURCE_LANE_OFFSET_X,
      y: sourceCardY(base.y, i, list.length, anchorHeight),
      width: SOURCE_CARD_WIDTH,
      height: SOURCE_CARD_HEIGHT,
      layout: 2,
      webSearchParentId: sourceNodeId,
      webSearchIndex: i,
    });
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      from: sourceNodeId,
      to: id,
    });
  }
}

/**
 * Create image nodes from Metaso image search hits in the same vertical lane as webpage sources.
 */
export async function spawnWebSearchCardsFromImages(
  sourceNodeId: string,
  base: { x: number; y: number },
  images: MetasoImage[],
  activeCanvasId: string,
  options?: { staggerMs?: number; anchorHeight?: number },
): Promise<void> {
  const staggerMs = options?.staggerMs ?? DEFAULT_STAGGER_MS;
  const anchorHeight = options?.anchorHeight ?? DEFAULT_ANCHOR_HEIGHT;
  const list = images
    .map((img) => ({
      img,
      url: resolveMetasoImageUrl(img),
      title: (img.title || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((row) => row.url.length > 0);

  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    const row = list[i]!;
    const id = crypto.randomUUID();
    await db.nodes.add({
      id,
      canvasId: activeCanvasId,
      type: 'image',
      content: row.url,
      description: row.title || undefined,
      x: base.x + SOURCE_LANE_OFFSET_X,
      y: sourceCardY(base.y, i, list.length, anchorHeight),
      width: SOURCE_CARD_WIDTH,
      height: SOURCE_CARD_HEIGHT,
      webSearchParentId: sourceNodeId,
      webSearchIndex: i,
    });
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      from: sourceNodeId,
      to: id,
    });
  }
}
