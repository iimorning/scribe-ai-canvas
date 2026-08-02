import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { runCanvasStreamingAiCall } from '../../src/utils/canvasStreamingAi';

describe('runCanvasStreamingAiCall', () => {
  beforeEach(async () => {
    await db.nodes.clear();
  });

  it('streams updates then writes final content', async () => {
    await db.nodes.add({
      id: 'n1',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const updates: string[] = [];
    const origUpdate = db.nodes.update.bind(db.nodes);
    vi.spyOn(db.nodes, 'update').mockImplementation((async (id: any, changes: any) => {
      if (typeof changes === 'object' && changes && 'content' in changes) {
        updates.push(String(changes.content));
      }
      return origUpdate(id, changes);
    }) as any);

    const result = await runCanvasStreamingAiCall({
      nodeId: 'n1',
      throttleMs: 0,
      callAi: async (onStream) => {
        onStream('Hel');
        onStream('Hello');
        return 'Hello';
      },
    });

    expect(result).toBe('Hello');
    const row = await db.nodes.get('n1');
    expect(row?.content).toBe('Hello');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('deletes placeholder when response empty', async () => {
    await db.nodes.add({
      id: 'n2',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    const result = await runCanvasStreamingAiCall({
      nodeId: 'n2',
      callAi: async () => '   ',
    });

    expect(result).toBe('');
    expect(await db.nodes.get('n2')).toBeUndefined();
  });

  it('deletes node on failure', async () => {
    await db.nodes.add({
      id: 'n3',
      canvasId: 'default',
      type: 'ai',
      content: '',
      x: 0,
      y: 0,
    });

    await expect(
      runCanvasStreamingAiCall({
        nodeId: 'n3',
        callAi: async () => {
          throw new Error('fail');
        },
      }),
    ).rejects.toThrow('fail');

    expect(await db.nodes.get('n3')).toBeUndefined();
  });
});
