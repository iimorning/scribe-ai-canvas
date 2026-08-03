import { describe, it, expect } from 'vitest';
import {
  parsePublishOutlineResponse,
  serializeOutlineForPrompt,
  type PublishOutline,
} from '../../src/utils/parsePublishOutlineResponse';

const FALLBACK = '默认标题';

describe('parsePublishOutlineResponse', () => {
  it('合法 JSON：sections 全字段正常解析', () => {
    const raw = JSON.stringify({
      title: '大纲标题',
      sections: [
        { cardId: 'n1', heading: '引言', summary: '开门见山' },
        { cardId: 'n2', heading: '展开', summary: '主题论述' },
      ],
    });
    expect(parsePublishOutlineResponse(raw, FALLBACK)).toEqual({
      title: '大纲标题',
      sections: [
        { cardId: 'n1', heading: '引言', summary: '开门见山' },
        { cardId: 'n2', heading: '展开', summary: '主题论述' },
      ],
    });
  });

  it('契约：heading 与 summary 都为空的 section 也要保留（与 prompt 契约一致）', () => {
    const raw = JSON.stringify({
      title: 'T',
      sections: [
        { cardId: 'n1', heading: '正面', summary: '有内容' },
        { cardId: 'n2', heading: '', summary: '' },
        { cardId: 'n3', heading: '结尾', summary: '总结' },
      ],
    });
    const parsed = parsePublishOutlineResponse(raw, FALLBACK)!;
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[1]).toEqual({ cardId: 'n2', heading: '', summary: '' });
  });

  it('JSON 中夹杂代码块围栏也能解析', () => {
    const raw = '```json\n{"title":"A","sections":[{"cardId":"x","heading":"H","summary":"S"}]}\n```';
    expect(parsePublishOutlineResponse(raw, FALLBACK)?.title).toBe('A');
  });

  it('非元素段（null / 数组 / 非对象）会被跳过，但合法段保留', () => {
    const raw = JSON.stringify({
      title: 'T',
      sections: [null, [], 'string', { cardId: 'ok', heading: 'H', summary: 'S' }],
    });
    const parsed = parsePublishOutlineResponse(raw, FALLBACK)!;
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].cardId).toBe('ok');
  });

  it('非法 JSON → 走 Markdown 回退（首行 H1 提标题）', () => {
    const raw = '# Markdown 大纲\n\n- 第一条\n- 第二条\n';
    expect(parsePublishOutlineResponse(raw, FALLBACK)).toEqual({
      title: 'Markdown 大纲',
      sections: [
        { cardId: '', heading: '第一条', summary: '' },
        { cardId: '', heading: '第二条', summary: '' },
      ],
    });
  });

  it('非法 JSON → Markdown 回退（无 H1 时使用 fallbackTitle）', () => {
    const raw = '## 第一节\n\n段落一\n\n## 第二节\n\n段落二';
    expect(parsePublishOutlineResponse(raw, FALLBACK)).toEqual({
      title: FALLBACK,
      sections: [
        { cardId: '', heading: '第一节', summary: '' },
        { cardId: '', heading: '段落一', summary: '' },
        { cardId: '', heading: '第二节', summary: '' },
        { cardId: '', heading: '段落二', summary: '' },
      ],
    });
  });

  it('空字符串 / 纯空白 → 返回 null', () => {
    expect(parsePublishOutlineResponse('', FALLBACK)).toBeNull();
    expect(parsePublishOutlineResponse('   \n  ', FALLBACK)).toBeNull();
  });

  it('合法 JSON 但 sections 缺失 → 走 Markdown 回退', () => {
    const raw = JSON.stringify({ title: '孤零零' });
    const parsed = parsePublishOutlineResponse(raw, FALLBACK)!;
    expect(parsed.title).toBe(FALLBACK);
    // Markdown 回退：整段 JSON 字符串当作单条无标题段落
    expect(parsed.sections).toEqual([{ cardId: '', heading: '{"title":"孤零零"}', summary: '' }]);
  });

  it('serializeOutlineForPrompt 给每段加上【cardId:】前缀与从 1 开始的序号', () => {
    const outline: PublishOutline = {
      title: '示例',
      sections: [
        { cardId: 'n1', heading: '引言', summary: '开门' },
        { cardId: '', heading: '新增段', summary: '' },
      ],
    };
    const text = serializeOutlineForPrompt(outline);
    expect(text.startsWith('# 示例')).toBe(true);
    expect(text).toContain('【cardId:n1】1. 引言');
    expect(text).toContain('2. 新增段');
    expect(text.indexOf('【cardId:n1】')).toBeLessThan(text.indexOf('2. 新增段'));
  });
});
