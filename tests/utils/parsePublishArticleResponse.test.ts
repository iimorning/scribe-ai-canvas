import { describe, it, expect } from 'vitest';
import { parsePublishArticleResponse } from '../../src/utils/parsePublishArticleResponse';

const FALLBACK = '生成的合成稿';

describe('parsePublishArticleResponse', () => {
  it('解析 JSON 中的 title 与 segments', () => {
    const raw = JSON.stringify({
      title: '创业的意义是什么？',
      segments: [
        { cardId: 'c1', text: '## 用不确定性交换可能性\n\n正文段落。' },
        { cardId: 'c2', text: '## 第二节\n\n另一段。' },
      ],
    });
    const parsed = parsePublishArticleResponse(raw, FALLBACK);
    expect(parsed.title).toBe('创业的意义是什么？');
    expect(parsed.segments).toEqual([
      { cardId: 'c1', text: '## 用不确定性交换可能性\n\n正文段落。' },
      { cardId: 'c2', text: '## 第二节\n\n另一段。' },
    ]);
    expect(parsed.body).toBe('## 用不确定性交换可能性\n\n正文段落。\n\n## 第二节\n\n另一段。');
  });

  it('旧格式 {title, body} 回退为单段 segments', () => {
    const raw = JSON.stringify({
      title: '创业的意义是什么？',
      body: '## 用不确定性交换可能性\n\n正文段落。',
    });
    expect(parsePublishArticleResponse(raw, FALLBACK)).toEqual({
      title: '创业的意义是什么？',
      body: '## 用不确定性交换可能性\n\n正文段落。',
      segments: [{ cardId: '', text: '## 用不确定性交换可能性\n\n正文段落。' }],
    });
  });

  it('JSON 带代码块包裹时仍能解析', () => {
    const raw = '```json\n{"title":"标题A","body":"## 小节\\n\\n内容"}\n```';
    expect(parsePublishArticleResponse(raw, FALLBACK).title).toBe('标题A');
    expect(parsePublishArticleResponse(raw, FALLBACK).body).toContain('## 小节');
  });

  it('非 JSON 时从首个一级标题拆出标题', () => {
    const raw = '# 从 H1 拆出的标题\n\n## 第二节\n\n段落';
    expect(parsePublishArticleResponse(raw, FALLBACK)).toEqual({
      title: '从 H1 拆出的标题',
      body: '## 第二节\n\n段落',
      segments: [{ cardId: '', text: '## 第二节\n\n段落' }],
    });
  });

  it('无法解析时使用回退标题并保留全文', () => {
    const raw = '纯段落文字，没有标题结构。';
    expect(parsePublishArticleResponse(raw, FALLBACK)).toEqual({
      title: FALLBACK,
      body: raw,
      segments: [{ cardId: '', text: raw }],
    });
  });
});
