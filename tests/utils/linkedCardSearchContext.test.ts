import { describe, it, expect } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  collectLinkedCardTextsForSearch,
  enrichSearchQueryWithLinkedContext,
  formatLinkedCardContextForSearch,
} from '../../src/utils/linkedCardSearchContext';

const makeNode = (overrides: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type'>): CanvasNode => ({
  x: 0,
  y: 0,
  ...overrides,
});

describe('collectLinkedCardTextsForSearch', () => {
  it('returns empty when there are no edges', () => {
    const nodes = [
      makeNode({ id: 'a', type: 'note', content: '80年代教师' }),
      makeNode({ id: 'b', type: 'note', content: '日本婴儿潮' }),
    ];
    expect(collectLinkedCardTextsForSearch('a', nodes, [])).toEqual([]);
  });

  it('includes undirected neighbors with text', () => {
    const nodes = [
      makeNode({ id: 'mid', type: 'note', content: '80年代荣光\n教师被尊称为先生' }),
      makeNode({ id: 'left', type: 'note', content: '误判婴儿潮埋雷\n1985年日本政府' }),
    ];
    const edges = [{ from: 'left', to: 'mid' }];
    const texts = collectLinkedCardTextsForSearch('mid', nodes, edges);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('日本');
    expect(texts[0]).toContain('婴儿潮');
  });

  it('follows multi-hop links within the connected component', () => {
    const nodes = [
      makeNode({ id: 'a', type: 'note', content: 'A 主笔记教师' }),
      makeNode({ id: 'b', type: 'theme', content: 'B 日本背景' }),
      makeNode({ id: 'c', type: 'note', content: 'C 政策细节' }),
    ];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    const texts = collectLinkedCardTextsForSearch('a', nodes, edges);
    expect(texts.join('\n')).toMatch(/日本/);
    expect(texts.join('\n')).toMatch(/政策/);
  });

  it('skips prior web-search result cards and non-text types', () => {
    const nodes = [
      makeNode({ id: 'a', type: 'note', content: '主笔记' }),
      makeNode({
        id: 'img',
        type: 'image',
        content: 'https://example.com/x.jpg',
        description: '教师尊严',
        webSearchParentId: 'a',
      }),
      makeNode({ id: 'b', type: 'note', content: '日本教师编制' }),
      makeNode({ id: 'vid', type: 'video', content: 'https://bilibili.com/x', description: '无关视频' }),
    ];
    const edges = [
      { from: 'a', to: 'img' },
      { from: 'a', to: 'b' },
      { from: 'a', to: 'vid' },
    ];
    const texts = collectLinkedCardTextsForSearch('a', nodes, edges);
    expect(texts).toEqual(['日本教师编制']);
  });

  it('finds book-expand siblings via bookExpandParentId even without edges', () => {
    const nodes = [
      makeNode({
        id: 'mid',
        type: 'text',
        content: '80年代荣光\n教师被尊称为先生',
        bookExpandParentId: 'hub',
      }),
      makeNode({
        id: 'japan',
        type: 'text',
        content: '误判婴儿潮埋雷\n1985年日本政府多招教师',
        bookExpandParentId: 'hub',
      }),
    ];
    const texts = collectLinkedCardTextsForSearch('mid', nodes, []);
    expect(texts.join('\n')).toMatch(/日本/);
  });
});

describe('enrichSearchQueryWithLinkedContext', () => {
  it('prepends 日本 when linked context has it but query does not', () => {
    expect(
      enrichSearchQueryWithLinkedContext('80年代 教师 社会地位', [
        '1985年日本政府误判婴儿潮',
      ]),
    ).toBe('日本 80年代 教师 社会地位');
  });

  it('leaves query unchanged when place already present', () => {
    expect(enrichSearchQueryWithLinkedContext('日本 教师', ['日本婴儿潮'])).toBe('日本 教师');
  });
});

describe('formatLinkedCardContextForSearch', () => {
  it('returns (none) for empty list', () => {
    expect(formatLinkedCardContextForSearch([])).toBe('(none)');
  });

  it('joins cards with separators', () => {
    expect(formatLinkedCardContextForSearch(['甲', '乙'])).toBe('甲\n\n---\n\n乙');
  });
});
