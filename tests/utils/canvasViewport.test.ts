import { describe, it, expect, beforeEach } from 'vitest';
import {
  CANVAS_VIEWPORTS_KEY,
  loadCanvasViewport,
  saveCanvasViewport,
} from '../../src/utils/canvasViewport';

describe('canvasViewport', () => {
  beforeEach(() => {
    localStorage.removeItem(CANVAS_VIEWPORTS_KEY);
  });

  it('returns default transform when nothing saved', () => {
    expect(loadCanvasViewport('a')).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('round-trips per canvas id', () => {
    saveCanvasViewport('a', { x: -120, y: 40, scale: 1.25 });
    saveCanvasViewport('b', { x: 10, y: 20, scale: 0.8 });
    expect(loadCanvasViewport('a')).toEqual({ x: -120, y: 40, scale: 1.25 });
    expect(loadCanvasViewport('b')).toEqual({ x: 10, y: 20, scale: 0.8 });
  });
});
