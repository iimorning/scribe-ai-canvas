import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  deriveSearchQueryFromNoteText,
  listWebSearchSourcesForParent,
  setWebSearchSourcesCollapsed,
  sourceCardStackPos,
  sourceCardY,
  SOURCE_LANE_OFFSET_X,
  SOURCE_STACK_STEP,
} from '../../src/services/spawnWebSearchNoteCards';

describe('deriveSearchQueryFromNoteText', () => {
  it('returns empty for blank', () => {
    expect(deriveSearchQueryFromNoteText('')).toBe('');
    expect(deriveSearchQueryFromNoteText('  \n  ')).toBe('');
  });

  it('uses first non-empty line', () => {
    expect(deriveSearchQueryFromNoteText('\nfoo\nbar')).toBe('foo');
  });

  it('truncates long first line', () => {
    const long = 'a'.repeat(400);
    expect(deriveSearchQueryFromNoteText(long, 280)).toHaveLength(280);
  });
});

describe('sourceCardY', () => {
  it('centers a single card on the answer card mid-line', () => {
    // baseY=100, anchorH=280 → center 240; cardH=210 → firstY = 240 - 105 = 135
    expect(sourceCardY(100, 0, 1, 280)).toBe(135);
  });

  it('spreads a 3-card lane evenly above and below the answer mid-line', () => {
    const baseY = 100;
    const anchorH = 280;
    const y0 = sourceCardY(baseY, 0, 3, anchorH);
    const y1 = sourceCardY(baseY, 1, 3, anchorH);
    const y2 = sourceCardY(baseY, 2, 3, anchorH);
    expect(y1 - y0).toBe(240);
    expect(y2 - y1).toBe(240);
    // Midpoint of first-top → last-bottom aligns with answer center.
    const stackMid = (y0 + y2 + 210) / 2;
    expect(stackMid).toBe(baseY + anchorH / 2);
    // First card starts above the answer top (not flush with it).
    expect(y0).toBeLessThan(baseY);
  });
});

describe('setWebSearchSourcesCollapsed', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
  });

  it('stacks then expands source cards relative to the answer card', async () => {
    await db.nodes.add({
      id: 'ai1',
      canvasId: 'default',
      type: 'ai',
      content: 'answer',
      x: 100,
      y: 100,
      height: 280,
    });
    for (let i = 0; i < 3; i++) {
      const id = `src${i}`;
      await db.nodes.add({
        id,
        canvasId: 'default',
        type: 'text',
        content: `### ${i + 1}. Title`,
        x: 100 + SOURCE_LANE_OFFSET_X,
        y: sourceCardY(100, i, 3, 280),
        layout: 2,
        webSearchParentId: 'ai1',
        webSearchIndex: i,
      });
      await db.edges.add({ id: `e${i}`, canvasId: 'default', from: 'ai1', to: id });
    }

    const nodes = await db.nodes.toArray();
    const edges = await db.edges.toArray();
    expect(listWebSearchSourcesForParent('ai1', nodes, edges)).toHaveLength(3);

    await setWebSearchSourcesCollapsed('ai1', true, { nodes, edges, anchorHeight: 280 });
    const stacked = await db.nodes.bulkGet(['src0', 'src1', 'src2']);
    expect(stacked[0]).toMatchObject(sourceCardStackPos({ x: 100, y: 100 }, 0, 3, 280));
    expect(stacked[1]!.x - stacked[0]!.x).toBe(SOURCE_STACK_STEP);
    expect(stacked[2]!.x - stacked[0]!.x).toBe(2 * SOURCE_STACK_STEP);
    expect((await db.nodes.get('ai1'))?.webSearchSourcesCollapsed).toBe(true);

    const afterStack = await db.nodes.toArray();
    await setWebSearchSourcesCollapsed('ai1', false, {
      nodes: afterStack,
      edges,
      anchorHeight: 280,
    });
    const expanded = await db.nodes.get('src1');
    expect(expanded?.x).toBe(100 + SOURCE_LANE_OFFSET_X);
    expect(expanded?.y).toBe(sourceCardY(100, 1, 3, 280));
    expect((await db.nodes.get('ai1'))?.webSearchSourcesCollapsed).toBe(false);
  });
});
