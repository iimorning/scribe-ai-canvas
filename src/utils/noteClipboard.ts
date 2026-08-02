import type { CanvasNode } from '../db';

export const STICKY_CLIPBOARD_KIND = 'scribe-sticky-v1' as const;

export type StickyClipboardNodeV1 = Pick<
  CanvasNode,
  'type' | 'content' | 'layout' | 'width' | 'height'
> & {
  x: number;
  y: number;
};

export type StickyClipboardPayloadV1 = {
  kind: typeof STICKY_CLIPBOARD_KIND;
  nodes: StickyClipboardNodeV1[];
};

const PASTE_OFFSET = 24;

export function isStickyNoteType(type: string | undefined): type is 'note' | 'text' {
  return type === 'note' || type === 'text';
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const ce = (target.getAttribute('contenteditable') ?? '').toLowerCase();
  if (ce === 'true') return true;
  if (target.closest('[contenteditable="true"]')) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** True when the user has highlighted copyable text (e.g. book body, which is not contenteditable). */
export function hasNonEmptyTextSelection(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  return sel.toString().trim().length > 0;
}

/**
 * When true, canvas copy/cut/paste shortcuts must not steal the event
 * (inputs, contenteditable, or a non-empty DOM text selection).
 */
export function shouldDeferToNativeClipboard(target: EventTarget | null): boolean {
  return isTextEditingTarget(target) || hasNonEmptyTextSelection();
}

export function buildStickyClipboardPayload(nodes: CanvasNode[]): StickyClipboardPayloadV1 | null {
  const stickies = nodes.filter((n) => isStickyNoteType(n.type));
  if (stickies.length === 0) return null;
  return {
    kind: STICKY_CLIPBOARD_KIND,
    nodes: stickies.map((n) => ({
      type: n.type,
      content: n.content,
      layout: n.layout,
      width: n.width,
      height: n.height,
      x: n.x,
      y: n.y,
    })),
  };
}

export function parseStickyClipboardPayload(raw: string): StickyClipboardPayloadV1 | null {
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    const rec = o as Record<string, unknown>;
    if (rec.kind !== STICKY_CLIPBOARD_KIND || !Array.isArray(rec.nodes)) return null;
    const nodes: StickyClipboardNodeV1[] = [];
    for (const item of rec.nodes) {
      if (!item || typeof item !== 'object') return null;
      const n = item as Record<string, unknown>;
      const type = n.type;
      if (type !== 'note' && type !== 'text') return null;
      const x = Number(n.x);
      const y = Number(n.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      nodes.push({
        type,
        content: typeof n.content === 'string' ? n.content : undefined,
        layout: typeof n.layout === 'number' ? n.layout : undefined,
        width: typeof n.width === 'number' ? n.width : undefined,
        height: typeof n.height === 'number' ? n.height : undefined,
        x,
        y,
      });
    }
    if (nodes.length === 0) return null;
    return { kind: STICKY_CLIPBOARD_KIND, nodes };
  } catch {
    return null;
  }
}

/** Apply standard offset for pasted duplicates (canvas space). */
export function stickyPastePosition(n: StickyClipboardNodeV1): { x: number; y: number } {
  return { x: n.x + PASTE_OFFSET, y: n.y + PASTE_OFFSET };
}
