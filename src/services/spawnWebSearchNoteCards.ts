import { db } from '../db';
import type { MetasoWebpage } from './search';

const DEFAULT_STAGGER_MS = 320;
/** Sources live in a dedicated vertical lane beside the answer, never in a fan of overlaps. */
const SOURCE_LANE_OFFSET_X = 380;
const SOURCE_ROW_GAP_Y = 240;
const SOURCE_CARD_WIDTH = 320;
const SOURCE_CARD_HEIGHT = 210;

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
  options?: { staggerMs?: number },
): Promise<void> {
  const staggerMs = options?.staggerMs ?? DEFAULT_STAGGER_MS;
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
      y: base.y + i * SOURCE_ROW_GAP_Y,
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
