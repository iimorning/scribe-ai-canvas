import { describe, it, expect } from 'vitest';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { getCanvasNodeSearchText, searchCanvasNodes } from '../../src/utils/canvasNodeSearch';
import type { CanvasNode } from '../../src/db';

function node(partial: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type'>): CanvasNode {
  return {
    x: 0,
    y: 0,
    ...partial,
  };
}

describe('getCanvasNodeSearchText', () => {
  it('includes note content and skips data URLs', () => {
    expect(
      getCanvasNodeSearchText(
        node({
          id: '1',
          type: 'note',
          content: '返乡就业潮',
          description: 'data:image/png;base64,abc',
        }),
      ),
    ).toBe('返乡就业潮');
  });

  it('indexes book title and chapter text', () => {
    const content = encodeBookContent({
      format: 'epub',
      title: '以日为鉴',
      units: [{ title: '第三章', text: '日本漂流一族的故事' }],
    });
    const text = getCanvasNodeSearchText(
      node({ id: 'b', type: 'book', content, description: 'book.epub' }),
    );
    expect(text).toContain('以日为鉴');
    expect(text).toContain('日本漂流一族的故事');
  });
});

describe('searchCanvasNodes', () => {
  it('finds notes by keyword and ranks them first', () => {
    const nodes = [
      node({ id: 'ai', type: 'ai', content: '关于返乡的分析' }),
      node({ id: 'n1', type: 'note', content: '讨论返乡就业' }),
      node({ id: 'img', type: 'image', content: 'data:image/png;base64,xx' }),
    ];
    const hits = searchCanvasNodes(nodes, '返乡');
    expect(hits.map((h) => h.node.id)).toEqual(['n1', 'ai']);
    expect(hits[0].preview).toContain('返乡');
  });

  it('returns empty for blank query', () => {
    expect(searchCanvasNodes([node({ id: '1', type: 'note', content: 'a' })], '  ')).toEqual([]);
  });
});
