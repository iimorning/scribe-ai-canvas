import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import {
  deriveSearchQueryFromNoteText,
  isWebSearchSourceNode,
  listWebSearchSourcesForParent,
  setWebSearchSourcesCollapsed,
  sourceCardStackPos,
  sourceCardY,
  SOURCE_LANE_OFFSET_X,
  SOURCE_ROW_GAP_Y,
  SOURCE_STACK_STEP,
  webSearchSourceIndex,
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

  // 守护 35830a6 的"老数据回退"契约：迁移前没有 webSearchParentId 的来源卡必须
  // 仍能被识别、折叠/展开。如果未来有人去掉 isWebSearchSourceNode 的正则回退，
  // 历史数据会被当作普通便签而失去折叠功能。
  it('老数据：无 webSearchParentId 但 layout=2 且内容以 ### 1. 开头，仍能识别为来源卡', async () => {
    await db.nodes.add({
      id: 'legacy-ai',
      canvasId: 'default',
      type: 'ai',
      content: 'legacy answer',
      x: 200,
      y: 200,
      height: 280,
    });
    // 模拟迁移前的来源卡：layout=2，正文以 "### 1." 起首，无 webSearchParentId。
    await db.nodes.add({
      id: 'legacy-src-1',
      canvasId: 'default',
      type: 'text',
      content: '### 1. Legacy Title\n\nlegacy snippet',
      x: 200 + SOURCE_LANE_OFFSET_X,
      y: sourceCardY(200, 0, 2, 280),
      layout: 2,
    });
    await db.nodes.add({
      id: 'legacy-src-2',
      canvasId: 'default',
      type: 'text',
      content: '### 2. Another Legacy',
      x: 200 + SOURCE_LANE_OFFSET_X,
      y: sourceCardY(200, 1, 2, 280),
      layout: 2,
    });
    // 关联边
    await db.edges.add({ id: 'legacy-e1', canvasId: 'default', from: 'legacy-ai', to: 'legacy-src-1' });
    await db.edges.add({ id: 'legacy-e2', canvasId: 'default', from: 'legacy-ai', to: 'legacy-src-2' });
    // 一个普通便签（不该被误识为来源）
    await db.nodes.add({
      id: 'plain-note',
      canvasId: 'default',
      type: 'text',
      content: '### 1. 我不是搜索来源',
      x: 0,
      y: 0,
    });
    await db.edges.add({ id: 'plain-e', canvasId: 'default', from: 'legacy-ai', to: 'plain-note' });

    const sources = listWebSearchSourcesForParent('legacy-ai', await db.nodes.toArray(), await db.edges.toArray());
    expect(sources.map((s) => s.id).sort()).toEqual(['legacy-src-1', 'legacy-src-2']);
    // 普通便签不应当被误识
    expect(isWebSearchSourceNode(await db.nodes.get('plain-note'))).toBe(false);

    // 老数据回退的 webSearchSourceIndex 必须按内容编号排序（1→0, 2→1）。
    const sortedByContent = sources.slice().sort((a, b) => webSearchSourceIndex(a) - webSearchSourceIndex(b));
    expect(sortedByContent[0]?.id).toBe('legacy-src-1');
    expect(sortedByContent[1]?.id).toBe('legacy-src-2');
  });

  // 守护 35830a6 的"折叠原子性"契约：setWebSearchSourcesCollapsed 必须把状态写和位置写
  // 放在同一事务里。否则中途崩溃会留下"webSearchSourcesCollapsed=true 但位置仍是展开态"
  // 的脏数据。fake-indexeddb 不会真做事务并发，但我们可以验证子卡的位置与父卡状态同时被改。
  it('折叠/展开后，父卡 collapsed 状态与子卡位置必须同时被改写（一次 commit）', async () => {
    await db.nodes.add({
      id: 'ai2',
      canvasId: 'default',
      type: 'ai',
      content: 'atomic answer',
      x: 50,
      y: 50,
      height: 280,
    });
    for (let i = 0; i < 2; i++) {
      const id = `atom-${i}`;
      await db.nodes.add({
        id,
        canvasId: 'default',
        type: 'text',
        content: `### ${i + 1}. title`,
        x: 50 + SOURCE_LANE_OFFSET_X,
        y: sourceCardY(50, i, 2, 280),
        layout: 2,
        webSearchParentId: 'ai2',
        webSearchIndex: i,
      });
      await db.edges.add({ id: `atom-e${i}`, canvasId: 'default', from: 'ai2', to: id });
    }

    await setWebSearchSourcesCollapsed('ai2', true, { anchorHeight: 280 });
    // 折叠后立刻读：父卡 collapsed 已是 true，子卡 x 也已经是 SOURCE_LANE_OFFSET_X + 步进。
    const aiCollapsed = await db.nodes.get('ai2');
    const src0Collapsed = await db.nodes.get('atom-0');
    const src1Collapsed = await db.nodes.get('atom-1');
    expect(aiCollapsed?.webSearchSourcesCollapsed).toBe(true);
    expect(src0Collapsed?.x).toBe(50 + SOURCE_LANE_OFFSET_X); // 折叠时 x = lane offset + 0*step
    expect(src1Collapsed?.x).toBe(50 + SOURCE_LANE_OFFSET_X + SOURCE_STACK_STEP);

    await setWebSearchSourcesCollapsed('ai2', false, { anchorHeight: 280 });
    const aiExpanded = await db.nodes.get('ai2');
    const src0Expanded = await db.nodes.get('atom-0');
    const src1Expanded = await db.nodes.get('atom-1');
    expect(aiExpanded?.webSearchSourcesCollapsed).toBe(false);
    // 展开：两卡都回到 lane offset（x 相同），y 按 sourceCardY 排开
    expect(src0Expanded?.x).toBe(50 + SOURCE_LANE_OFFSET_X);
    expect(src1Expanded?.x).toBe(50 + SOURCE_LANE_OFFSET_X);
    expect(src1Expanded?.y - (src0Expanded?.y ?? 0)).toBe(SOURCE_ROW_GAP_Y);
  });
});
