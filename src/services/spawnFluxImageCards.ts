import { db } from '../db';
import {
  BOOK_EXPAND_CHILD_OFFSET_X,
  BOOK_EXPAND_CHILD_WIDTH,
  BOOK_EXPAND_HUB_HEIGHT,
} from './spawnBookExpandCards';

export const FLUX_IMAGE_CARD_WIDTH = 320;
export const FLUX_IMAGE_CARD_HEIGHT = 210;
export const FLUX_IMAGE_GAP_Y = 24;
/** Place Flux cards to the right of the book-expand branch lane. */
export const FLUX_IMAGE_OFFSET_FROM_HUB_X =
  BOOK_EXPAND_CHILD_OFFSET_X + BOOK_EXPAND_CHILD_WIDTH + 48;

export function fluxImageCardPos(
  hub: { x: number; y: number },
  index: number,
  count: number,
): { x: number; y: number } {
  const n = Math.max(1, count);
  const stackH = (n - 1) * (FLUX_IMAGE_CARD_HEIGHT + FLUX_IMAGE_GAP_Y) + FLUX_IMAGE_CARD_HEIGHT;
  const centerY = hub.y + BOOK_EXPAND_HUB_HEIGHT / 2;
  const firstY = centerY - stackH / 2;
  return {
    x: hub.x + FLUX_IMAGE_OFFSET_FROM_HUB_X,
    y: firstY + index * (FLUX_IMAGE_CARD_HEIGHT + FLUX_IMAGE_GAP_Y),
  };
}

/** Image card beside an AI / note anchor (voice writing dialogue mode). */
export function fluxImageBesideAnchorPos(
  anchor: { x: number; y: number; width?: number; height?: number },
  index: number,
): { x: number; y: number } {
  const aw = anchor.width && anchor.width > 0 ? anchor.width : 320;
  return {
    x: anchor.x + aw + 48,
    y: anchor.y + index * (FLUX_IMAGE_CARD_HEIGHT + FLUX_IMAGE_GAP_Y),
  };
}

export async function spawnFluxImageCard(options: {
  canvasId: string;
  imageUrl: string;
  description?: string;
  x: number;
  y: number;
  /** Optional edge from a hub / AI / branch card. */
  linkFromId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.nodes.add({
    id,
    canvasId: options.canvasId,
    type: 'image',
    content: options.imageUrl,
    description: options.description?.trim() || undefined,
    sourceUrl: options.imageUrl,
    x: options.x,
    y: options.y,
    width: FLUX_IMAGE_CARD_WIDTH,
    height: FLUX_IMAGE_CARD_HEIGHT,
  });
  if (options.linkFromId) {
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId: options.canvasId,
      from: options.linkFromId,
      to: id,
    });
  }
  return id;
}
