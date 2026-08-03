import { describe, it, expect } from 'vitest';
import {
  buildCanvasClipboardPayload,
  CANVAS_CLIPBOARD_KIND,
  materializeCanvasPaste,
  parseCanvasClipboardPayload,
  snapshotNodesAndTouchingEdges,
} from '../../src/utils/canvasClipboard';
import { STICKY_CLIPBOARD_KIND } from '../../src/utils/noteClipboard';
import type { CanvasNode, Edge } from '../../src/db';

describe('canvasClipboard v2', () => {
  it('builds payload with nodes and internal edges only', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', type: 'ai', content: 'ans', userTurn: 'q', x: 0, y: 0 },
      { id: 'b', type: 'book', content: '{}', x: 10, y: 20, width: 380 },
      { id: 'c', type: 'theme', content: 'hub', x: 40, y: 50 },
    ];
    const edges: Edge[] = [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'a', to: 'outside' },
    ];
    const payload = buildCanvasClipboardPayload([nodes[0]!, nodes[1]!], edges);
    expect(payload?.kind).toBe(CANVAS_CLIPBOARD_KIND);
    expect(payload?.nodes).toHaveLength(2);
    expect(payload?.nodes.map((n) => n.key)).toEqual(['a', 'b']);
    expect(payload?.edges).toEqual([{ fromKey: 'a', toKey: 'b' }]);
    expect(payload?.nodes[0]).toMatchObject({ type: 'ai', userTurn: 'q', content: 'ans' });
  });

  it('materializePaste remaps ids, offsets position, and rebuilds edges', () => {
    const payload = buildCanvasClipboardPayload(
      [
        { id: 'a', type: 'text', content: 'one', x: 100, y: 200 },
        { id: 'b', type: 'ai', content: 'two', x: 140, y: 240, webSearchParentId: 'a' },
      ],
      [{ id: 'e1', from: 'a', to: 'b' }],
    )!;
    const { nodes, edges, idMap } = materializeCanvasPaste(payload, 'canvas-1');
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(idMap.size).toBe(2);
    expect(nodes[0]!.id).not.toBe('a');
    expect(nodes[0]!.canvasId).toBe('canvas-1');
    expect(nodes[0]!.x).toBe(124);
    expect(nodes[0]!.y).toBe(224);
    expect(nodes[1]!.webSearchParentId).toBe(nodes[0]!.id);
    expect(edges[0]!.from).toBe(nodes[0]!.id);
    expect(edges[0]!.to).toBe(nodes[1]!.id);
  });

  it('parses sticky v1 payloads for paste compatibility', () => {
    const raw = JSON.stringify({
      kind: STICKY_CLIPBOARD_KIND,
      nodes: [{ type: 'note', content: 'hi', x: 5, y: 6, layout: 1 }],
    });
    const parsed = parseCanvasClipboardPayload(raw);
    expect(parsed?.kind).toBe(STICKY_CLIPBOARD_KIND);
    const { nodes, edges } = materializeCanvasPaste(parsed!, 'c1');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'note', content: 'hi', x: 29, y: 30, canvasId: 'c1' });
    expect(edges).toHaveLength(0);
  });

  it('snapshotNodesAndTouchingEdges includes edges to outside nodes', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', type: 'text', x: 0, y: 0 },
      { id: 'b', type: 'text', x: 1, y: 1 },
    ];
    const edges: Edge[] = [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'a', to: 'z' },
    ];
    const snap = snapshotNodesAndTouchingEdges(['a'], nodes, edges);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.edges.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('skips corrupt nodes instead of rejecting the whole payload', () => {
    const raw = JSON.stringify({
      kind: CANVAS_CLIPBOARD_KIND,
      nodes: [
        { type: 'text', x: 0, y: 0 },                   // ok
        null,                                            // bad: null item
        { type: '', x: 0, y: 0 },                       // bad: empty type
        { type: 'ai', x: 'NaN', y: 0 },                 // bad: non-number x
        { type: 'book', x: 10, y: 20, content: '{}' },  // ok
      ],
    });
    const parsed = parseCanvasClipboardPayload(raw);
    expect(parsed?.kind).toBe(CANVAS_CLIPBOARD_KIND);
    expect(parsed?.nodes).toHaveLength(2);
    expect(parsed?.nodes.map((n) => n.type)).toEqual(['text', 'book']);
  });
});
