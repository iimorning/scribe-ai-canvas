import type { CanvasTransform } from '../hooks/useCanvasInteraction';

export const CANVAS_VIEWPORTS_KEY = 'spoor_canvas_viewports';

const DEFAULT_TRANSFORM: CanvasTransform = { x: 0, y: 0, scale: 1 };

function isValidTransform(value: unknown): value is CanvasTransform {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<CanvasTransform>;
  return (
    typeof t.x === 'number' &&
    Number.isFinite(t.x) &&
    typeof t.y === 'number' &&
    Number.isFinite(t.y) &&
    typeof t.scale === 'number' &&
    Number.isFinite(t.scale) &&
    t.scale > 0
  );
}

function readAll(): Record<string, CanvasTransform> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CANVAS_VIEWPORTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, CanvasTransform> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isValidTransform(value)) {
        out[id] = {
          x: value.x,
          y: value.y,
          scale: Math.min(5, Math.max(0.1, value.scale)),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function loadCanvasViewport(canvasId: string): CanvasTransform {
  const all = readAll();
  return all[canvasId] ? { ...all[canvasId] } : { ...DEFAULT_TRANSFORM };
}

export function saveCanvasViewport(canvasId: string, transform: CanvasTransform): void {
  if (typeof localStorage === 'undefined' || !canvasId) return;
  try {
    const all = readAll();
    all[canvasId] = {
      x: transform.x,
      y: transform.y,
      scale: Math.min(5, Math.max(0.1, transform.scale)),
    };
    localStorage.setItem(CANVAS_VIEWPORTS_KEY, JSON.stringify(all));
  } catch {
    // ignore quota / private mode
  }
}
