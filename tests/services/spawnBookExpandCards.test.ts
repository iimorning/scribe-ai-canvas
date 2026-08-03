import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeBookExpandPlan,
  parseBookExpandPlan,
  parseBookVoiceReply,
  resolveBookExpandBranches,
  setBookExpandBranchesCollapsed,
  spawnBookExpandCards,
  bookExpandClusterSize,
  spokenBookVoiceBranchLine,
} from '../../src/services/spawnBookExpandCards';
import { db } from '../../src/db';

describe('normalizeBookExpandPlan', () => {
  it('accepts hub + branches', () => {
    const plan = normalizeBookExpandPlan({
      hub: '偶像经济',
      branches: [
        { title: '一推', content: '最喜欢的成员' },
        { title: '杰尼斯', content: '事务所体系' },
        { title: '消费', content: '应援消费' },
      ],
    });
    expect(plan?.hub).toBe('偶像经济');
    expect(plan?.branches).toHaveLength(3);
  });

  it('rejects too few branches', () => {
    expect(
      normalizeBookExpandPlan({
        hub: 'Only one',
        branches: [{ title: 'A', content: 'a' }],
      }),
    ).toBeNull();
  });
});

describe('parseBookExpandPlan', () => {
  it('parses fenced JSON', () => {
    const plan = parseBookExpandPlan(`Here you go:
\`\`\`json
{"hub":"主题","branches":[{"title":"一","content":"内容一"},{"title":"二","content":"内容二"},{"title":"三","content":"内容三"}]}
\`\`\``);
    expect(plan?.hub).toBe('主题');
    expect(plan?.branches).toHaveLength(3);
  });
});

describe('parseBookVoiceReply', () => {
  it('extracts spoken summary plus hub/branches', () => {
    const reply = parseBookVoiceReply(JSON.stringify({
      summary: '这页在讲注意力的代价。',
      hub: '注意力经济',
      branches: [
        { title: '稀缺', content: '注意力是有限资源' },
        { title: '争夺', content: '产品在抢夺焦点' },
        { title: '代价', content: '深度思考被挤掉' },
      ],
    }));
    expect(reply?.summary).toBe('这页在讲注意力的代价。');
    expect(reply?.plan.hub).toBe('注意力经济');
    expect(reply?.plan.branches).toHaveLength(3);
    expect(reply?.images).toEqual([]);
  });

  it('parses optional images for Flux', () => {
    const reply = parseBookVoiceReply(JSON.stringify({
      summary: '我来画个示意。',
      hub: '主题',
      branches: [
        { title: '一', content: 'a' },
        { title: '二', content: 'b' },
      ],
      images: [{ title: '示意', prompt: 'two classrooms side by side, soft watercolor' }],
    }));
    expect(reply?.images).toEqual([
      { title: '示意', prompt: 'two classrooms side by side, soft watercolor' },
    ]);
  });

  it('rejects plans without a spoken summary', () => {
    expect(
      parseBookVoiceReply(JSON.stringify({
        hub: '主题',
        branches: [
          { title: '一', content: 'a' },
          { title: '二', content: 'b' },
        ],
      })),
    ).toBeNull();
  });
});

describe('spokenBookVoiceBranchLine', () => {
  it('joins title and content into one spoken line', () => {
    expect(spokenBookVoiceBranchLine({ title: '稀缺', content: '注意力是有限资源' }))
      .toBe('稀缺。注意力是有限资源。');
  });
});

describe('bookExpandClusterSize', () => {
  it('covers hub plus the vertical branch lane', () => {
    const size = bookExpandClusterSize(3);
    expect(size.width).toBeGreaterThan(500);
    expect(size.height).toBeGreaterThan(400);
  });
});

describe('spawnBookExpandCards', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.edges.clear();
    let n = 0;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation((() => `id-${++n}`) as any);
  });

  it('creates hub + branches linked from the book', async () => {
    const result = await spawnBookExpandCards({
      bookNodeId: 'book-1',
      canvasId: 'c1',
      bookPos: { x: 100, y: 100, width: 380, height: 520 },
      plan: {
        hub: '中心',
        branches: [
          { title: 'A', content: 'a' },
          { title: 'B', content: 'b' },
          { title: 'C', content: 'c' },
        ],
      },
      staggerMs: 0,
    });

    expect(result.hubId).toBeTruthy();
    expect(result.branchIds).toHaveLength(3);

    const nodes = await db.nodes.toArray();
    expect(nodes.map((n) => n.type).sort()).toEqual(['text', 'text', 'text', 'theme']);

    const edges = await db.edges.toArray();
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'book-1', to: result.hubId }),
        expect.objectContaining({ from: result.hubId, to: result.branchIds[0] }),
        expect.objectContaining({ from: result.hubId, to: result.branchIds[1] }),
        expect.objectContaining({ from: result.hubId, to: result.branchIds[2] }),
      ]),
    );

    const hub = await db.nodes.get(result.hubId);
    expect(hub?.bookExpandBranchesCollapsed).toBe(false);
    const branch = await db.nodes.get(result.branchIds[0]!);
    expect(branch?.bookExpandParentId).toBe(result.hubId);
    expect(branch?.bookExpandIndex).toBe(0);
  });

  it('collapses and expands branch cards beside the hub', async () => {
    const { hubId, branchIds } = await spawnBookExpandCards({
      bookNodeId: 'book-2',
      canvasId: 'c1',
      bookPos: { x: 0, y: 0, width: 380, height: 520 },
      plan: {
        hub: '中心',
        branches: [
          { title: 'A', content: 'a' },
          { title: 'B', content: 'b' },
          { title: 'C', content: 'c' },
        ],
      },
      staggerMs: 0,
    });

    const nodes = await db.nodes.toArray();
    const edges = await db.edges.toArray();
    expect(resolveBookExpandBranches(hubId, nodes, edges)).toHaveLength(3);

    await setBookExpandBranchesCollapsed(hubId, true, { nodes, edges, hubHeight: 160 });
    const collapsedHub = await db.nodes.get(hubId);
    expect(collapsedHub?.bookExpandBranchesCollapsed).toBe(true);

    const stacked = await Promise.all(branchIds.map((id) => db.nodes.get(id)));
    const xs = stacked.map((n) => n!.x);
    expect(xs[1]).toBeGreaterThan(xs[0]!);
    expect(xs[2]).toBeGreaterThan(xs[1]!);

    await setBookExpandBranchesCollapsed(hubId, false, {
      nodes: await db.nodes.toArray(),
      edges: await db.edges.toArray(),
      hubHeight: 160,
    });
    const expanded = await Promise.all(branchIds.map((id) => db.nodes.get(id)));
    expect(expanded[0]!.x).toBe(expanded[1]!.x);
    expect(expanded[1]!.y).toBeGreaterThan(expanded[0]!.y);
  });
});
