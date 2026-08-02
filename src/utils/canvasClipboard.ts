import type { CanvasNode, Edge } from '../db';
import {
  buildStickyClipboardPayload,
  isTextEditingTarget,
  parseStickyClipboardPayload,
  stickyPastePosition,
  STICKY_CLIPBOARD_KIND,
  type StickyClipboardPayloadV1,
} from './noteClipboard';

export { isTextEditingTarget };

export const CANVAS_CLIPBOARD_KIND = 'scribe-canvas-v2' as const;

const PASTE_OFFSET = 24;

/** Node fields that may point at other canvas node ids and should be remapped on paste. */
const REMAP_ID_KEYS = [
  'threadRootContextNodeId',
  'webSearchParentId',
  'bookExpandParentId',
] as const;

export type CanvasClipboardNodeV2 = Omit<CanvasNode, 'id' | 'canvasId'> & {
  /** Original id used only for edge remapping inside the payload. */
  key: string;
};

export type CanvasClipboardEdgeV2 = {
  fromKey: string;
  toKey: string;
};

export type CanvasClipboardPayloadV2 = {
  kind: typeof CANVAS_CLIPBOARD_KIND;
  nodes: CanvasClipboardNodeV2[];
  edges: CanvasClipboardEdgeV2[];
};

export type CanvasClipboardPayload = CanvasClipboardPayloadV2 | StickyClipboardPayloadV1;

function cloneNodeForClipboard(n: CanvasNode): CanvasClipboardNodeV2 {
  const { id, canvasId: _canvasId, ...rest } = n;
  return { ...rest, key: id };
}

export function buildCanvasClipboardPayload(
  nodes: CanvasNode[],
  edges: Edge[],
): CanvasClipboardPayloadV2 | null {
  if (nodes.length === 0) return null;
  const idSet = new Set(nodes.map((n) => n.id));
  return {
    kind: CANVAS_CLIPBOARD_KIND,
    nodes: nodes.map(cloneNodeForClipboard),
    edges: edges
      .filter((e) => idSet.has(e.from) && idSet.has(e.to))
      .map((e) => ({ fromKey: e.from, toKey: e.to })),
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function parseCanvasClipboardPayload(raw: string): CanvasClipboardPayload | null {
  const v1 = parseStickyClipboardPayload(raw);
  if (v1) return v1;

  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    const rec = o as Record<string, unknown>;
    if (rec.kind !== CANVAS_CLIPBOARD_KIND || !Array.isArray(rec.nodes)) return null;

    const nodes: CanvasClipboardNodeV2[] = [];
    for (const item of rec.nodes) {
      if (!item || typeof item !== 'object') return null;
      const n = item as Record<string, unknown>;
      if (typeof n.type !== 'string' || !n.type) return null;
      if (!isFiniteNumber(n.x) || !isFiniteNumber(n.y)) return null;
      const key = typeof n.key === 'string' && n.key ? n.key : crypto.randomUUID();
      const copy = { ...(n as object) } as Record<string, unknown>;
      delete copy.id;
      delete copy.canvasId;
      delete copy.key;
      nodes.push({
        ...(copy as Omit<CanvasClipboardNodeV2, 'key' | 'type' | 'x' | 'y'>),
        key,
        type: n.type,
        x: n.x,
        y: n.y,
      });
    }
    if (nodes.length === 0) return null;

    const keySet = new Set(nodes.map((n) => n.key));
    const edges: CanvasClipboardEdgeV2[] = [];
    if (Array.isArray(rec.edges)) {
      for (const item of rec.edges) {
        if (!item || typeof item !== 'object') continue;
        const e = item as Record<string, unknown>;
        if (typeof e.fromKey !== 'string' || typeof e.toKey !== 'string') continue;
        if (!keySet.has(e.fromKey) || !keySet.has(e.toKey)) continue;
        edges.push({ fromKey: e.fromKey, toKey: e.toKey });
      }
    }

    return { kind: CANVAS_CLIPBOARD_KIND, nodes, edges };
  } catch {
    return null;
  }
}

function materializeV1(
  payload: StickyClipboardPayloadV1,
  canvasId: string,
): { nodes: CanvasNode[]; edges: Edge[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const nodes: CanvasNode[] = payload.nodes.map((item) => {
    const id = crypto.randomUUID();
    const { x, y } = stickyPastePosition(item);
    return {
      id,
      canvasId,
      type: item.type,
      content: item.content ?? '',
      layout: item.layout,
      width: item.width,
      height: item.height,
      x,
      y,
    };
  });
  return { nodes, edges: [], idMap };
}

function materializeV2(
  payload: CanvasClipboardPayloadV2,
  canvasId: string,
): { nodes: CanvasNode[]; edges: Edge[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  for (const n of payload.nodes) {
    idMap.set(n.key, crypto.randomUUID());
  }

  const nodes: CanvasNode[] = payload.nodes.map((n) => {
    const { key, ...rest } = n;
    const next: CanvasNode = {
      ...rest,
      id: idMap.get(key)!,
      canvasId,
      x: n.x + PASTE_OFFSET,
      y: n.y + PASTE_OFFSET,
    };

    for (const field of REMAP_ID_KEYS) {
      const val = next[field];
      if (typeof val === 'string') {
        const mapped = idMap.get(val);
        if (mapped) next[field] = mapped;
      }
    }

    if (Array.isArray(next.threadContextImageNodeIds)) {
      next.threadContextImageNodeIds = next.threadContextImageNodeIds.map(
        (id) => idMap.get(id) ?? id,
      );
    }

    return next;
  });

  const edges: Edge[] = payload.edges.map((e) => ({
    id: crypto.randomUUID(),
    canvasId,
    from: idMap.get(e.fromKey)!,
    to: idMap.get(e.toKey)!,
  }));

  return { nodes, edges, idMap };
}

/** Turn a clipboard payload into DB rows with fresh ids and paste offset. */
export function materializeCanvasPaste(
  payload: CanvasClipboardPayload,
  canvasId: string,
): { nodes: CanvasNode[]; edges: Edge[]; idMap: Map<string, string> } {
  if (payload.kind === STICKY_CLIPBOARD_KIND) {
    return materializeV1(payload, canvasId);
  }
  return materializeV2(payload, canvasId);
}

/** Snapshot nodes + any edges touching them (for delete/cut undo). */
export function snapshotNodesAndTouchingEdges(
  nodeIds: Iterable<string>,
  allNodes: CanvasNode[],
  allEdges: Edge[],
): { nodes: CanvasNode[]; edges: Edge[] } {
  const idSet = new Set(nodeIds);
  const nodes = allNodes.filter((n) => idSet.has(n.id)).map((n) => ({ ...n }));
  const edges = allEdges
    .filter((e) => idSet.has(e.from) || idSet.has(e.to))
    .map((e) => ({ ...e }));
  return { nodes, edges };
}

/** @deprecated Prefer buildCanvasClipboardPayload; kept for sticky-only callers/tests. */
export { buildStickyClipboardPayload, parseStickyClipboardPayload, STICKY_CLIPBOARD_KIND };
