import { describe, it, expect, beforeEach } from 'vitest';
import {
  CANVAS_TOOLBAR_LAYOUT_KEY,
  canvasToolbarDockPosition,
  clampCanvasToolbarPosition,
  defaultCanvasToolbarLayout,
  isCanvasToolbarInDockZone,
  loadCanvasToolbarLayout,
  saveCanvasToolbarLayout,
} from '../../src/utils/canvasToolbarLayout';

describe('canvasToolbarLayout', () => {
  beforeEach(() => {
    localStorage.removeItem(CANVAS_TOOLBAR_LAYOUT_KEY);
  });

  it('defaults to bottom-center horizontal', () => {
    const layout = defaultCanvasToolbarLayout(600, 64, 1200, 800);
    expect(layout.orientation).toBe('horizontal');
    expect(layout.collapsed).toBe(false);
    expect(layout.x).toBe(300);
    expect(layout.y).toBe(800 - 64 - 32);
  });

  it('clamps position inside the viewport', () => {
    expect(clampCanvasToolbarPosition(-100, 9999, 200, 80, 1000, 600)).toEqual({
      x: 8,
      y: 600 - 80 - 8,
    });
  });

  it('round-trips layout through localStorage including collapsed', () => {
    saveCanvasToolbarLayout({ x: 40, y: 50, orientation: 'vertical', collapsed: true });
    expect(loadCanvasToolbarLayout()).toEqual({
      x: 40,
      y: 50,
      orientation: 'vertical',
      collapsed: true,
    });
  });

  it('detects bottom-right dock zone', () => {
    expect(isCanvasToolbarInDockZone(900, 700, 200, 80, 1200, 800)).toBe(true);
    expect(isCanvasToolbarInDockZone(300, 700, 600, 64, 1200, 800)).toBe(false);
    expect(isCanvasToolbarInDockZone(1000, 200, 180, 80, 1200, 800)).toBe(false);
  });

  it('docks collapsed FAB above zoom controls', () => {
    expect(canvasToolbarDockPosition(1200, 800)).toEqual({
      x: 1200 - 48 - 24,
      y: 800 - 48 - 88,
    });
  });
});
