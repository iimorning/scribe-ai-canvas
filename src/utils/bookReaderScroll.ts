/** No continuity overlap: each mouse-wheel page shows entirely new content. */
export const BOOK_READER_SCROLL_OVERLAP_PX = 0;

/** Ignore extra wheel events that fire for a single physical mouse notch. */
export const BOOK_READER_PAGE_LOCK_MS = 320;

/**
 * Detect discrete mouse-wheel notches vs continuous trackpad pixel streams.
 * - LINE / PAGE modes are always treated as discrete.
 * - Pixel mode: notches are commonly ~100–120; trackpads send many small deltas.
 */
export function isDiscreteReaderWheel(e: {
  deltaMode: number;
  deltaY: number;
}): boolean {
  if (e.deltaMode === 1 || e.deltaMode === 2) return true; // DOM_DELTA_LINE / PAGE
  const abs = Math.abs(e.deltaY);
  return abs >= 48 && abs <= 240;
}

/** Distance to advance for one reader "page" (viewport minus continuity overlap). */
export function bookReaderScrollStep(
  clientHeight: number,
  overlapPx = BOOK_READER_SCROLL_OVERLAP_PX,
): number {
  const h = Math.max(0, Math.round(clientHeight));
  const overlap = Math.max(0, Math.min(overlapPx, Math.floor(h / 2)));
  return Math.max(1, h - overlap);
}

export function nextBookReaderScrollTop(options: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  direction: 1 | -1;
  overlapPx?: number;
}): number {
  const step = bookReaderScrollStep(options.clientHeight, options.overlapPx);
  const maxScroll = Math.max(0, options.scrollHeight - options.clientHeight);
  const next = options.scrollTop + options.direction * step;
  return Math.min(maxScroll, Math.max(0, next));
}
