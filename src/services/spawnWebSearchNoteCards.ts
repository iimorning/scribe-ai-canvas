import { db } from '../db';
import type { MetasoWebpage } from './search';

const DEFAULT_STAGGER_MS = 320;
/** Sources live in a dedicated vertical lane beside the answer, never in a fan of overlaps. */
const SOURCE_LANE_OFFSET_X = 380;
const SOURCE_ROW_GAP_Y = 240;
const SOURCE_CARD_WIDTH = 320;
const SOURCE_CARD_HEIGHT = 210;
/** Fallback when the answer card height is not measured yet (streaming / just created). */
const DEFAULT_ANCHOR_HEIGHT = 280;

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
      content: pageToMarkdown(list[i], i + 1),
      x: base.x + SOURCE_LANE_OFFSET_X,
      y: sourceCardY(base.y, i, list.length, anchorHeight),
      width: SOURCE_CARD_WIDTH,
      height: SOURCE_CARD_HEIGHT,
      layout: 2,
    });
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      from: sourceNodeId,
      to: id,
    });
  }
}
