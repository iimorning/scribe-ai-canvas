export const CANVAS_TOOLBAR_LAYOUT_KEY = 'spoor_canvas_toolbar_layout';

export type CanvasToolbarOrientation = 'horizontal' | 'vertical';

export interface CanvasToolbarLayout {
  x: number;
  y: number;
  orientation: CanvasToolbarOrientation;
  /** Collapsed to a FAB when docked at the bottom-right. */
  collapsed?: boolean;
}

const MARGIN = 8;
/** Distance from viewport right/bottom edges that counts as the dock zone. */
export const CANVAS_TOOLBAR_DOCK_ZONE_PX = 140;
export const CANVAS_TOOLBAR_COLLAPSED_SIZE = 48;

/** Default bottom-center horizontal placement for a given panel size. */
export function defaultCanvasToolbarLayout(
  panelWidth: number,
  panelHeight: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): CanvasToolbarLayout {
  return {
    x: Math.max(MARGIN, (viewportWidth - panelWidth) / 2),
    y: Math.max(MARGIN, viewportHeight - panelHeight - 32),
    orientation: 'horizontal',
    collapsed: false,
  };
}

/** Snapped FAB position above the zoom controls (bottom-right). */
export function canvasToolbarDockPosition(
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): { x: number; y: number } {
  const size = CANVAS_TOOLBAR_COLLAPSED_SIZE;
  // Leave room for zoom bar (~40px) + gap above it.
  return {
    x: Math.max(MARGIN, viewportWidth - size - 24),
    y: Math.max(MARGIN, viewportHeight - size - 88),
  };
}

/**
 * True when the panel's bottom-right corner sits in the viewport's bottom-right dock zone.
 */
export function isCanvasToolbarInDockZone(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): boolean {
  const rightGap = viewportWidth - (x + panelWidth);
  const bottomGap = viewportHeight - (y + panelHeight);
  return rightGap <= CANVAS_TOOLBAR_DOCK_ZONE_PX && bottomGap <= CANVAS_TOOLBAR_DOCK_ZONE_PX;
}

export function clampCanvasToolbarPosition(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): { x: number; y: number } {
  const maxX = Math.max(MARGIN, viewportWidth - panelWidth - MARGIN);
  const maxY = Math.max(MARGIN, viewportHeight - panelHeight - MARGIN);
  return {
    x: Math.min(Math.max(MARGIN, x), maxX),
    y: Math.min(Math.max(MARGIN, y), maxY),
  };
}

export function loadCanvasToolbarLayout(): CanvasToolbarLayout | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CANVAS_TOOLBAR_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CanvasToolbarLayout>;
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      (parsed.orientation !== 'horizontal' && parsed.orientation !== 'vertical')
    ) {
      return null;
    }
    return {
      x: parsed.x,
      y: parsed.y,
      orientation: parsed.orientation,
      collapsed: Boolean(parsed.collapsed),
    };
  } catch {
    return null;
  }
}

export function saveCanvasToolbarLayout(layout: CanvasToolbarLayout): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CANVAS_TOOLBAR_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // ignore quota / private mode
  }
}
