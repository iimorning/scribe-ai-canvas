import { db, type CanvasNode, type Edge } from '../db';

export const CANVAS_UNDO_MAX = 30;

export type CanvasUndoEntry =
  | { type: 'delete'; nodes: CanvasNode[]; edges: Edge[] }
  | { type: 'paste'; nodeIds: string[]; edgeIds: string[] };

export type CanvasUndoStack = {
  push: (entry: CanvasUndoEntry) => void;
  pop: () => CanvasUndoEntry | undefined;
  clear: () => void;
  readonly size: number;
};

export function createCanvasUndoStack(max = CANVAS_UNDO_MAX): CanvasUndoStack {
  const stack: CanvasUndoEntry[] = [];
  return {
    push(entry) {
      stack.push(entry);
      while (stack.length > max) stack.shift();
    },
    pop() {
      return stack.pop();
    },
    clear() {
      stack.length = 0;
    },
    get size() {
      return stack.length;
    },
  };
}

/** Apply the inverse of a recorded canvas mutation. */
export async function applyCanvasUndo(entry: CanvasUndoEntry): Promise<void> {
  if (entry.type === 'delete') {
    if (entry.nodes.length === 0 && entry.edges.length === 0) return;
    await db.transaction('rw', db.nodes, db.edges, async () => {
      if (entry.nodes.length > 0) await db.nodes.bulkPut(entry.nodes);
      if (entry.edges.length > 0) await db.edges.bulkPut(entry.edges);
    });
    return;
  }

  await db.transaction('rw', db.nodes, db.edges, async () => {
    if (entry.nodeIds.length > 0) await db.nodes.bulkDelete(entry.nodeIds);
    if (entry.edgeIds.length > 0) await db.edges.bulkDelete(entry.edgeIds);
  });
}
