import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateArticleFromOutline } from '../../src/utils/generateArticleFromOutline';
import type { PublishOutline } from '../../src/utils/parsePublishOutlineResponse';
import type { PublishSourceCardMeta, PublishMediaAsset } from '../../src/utils/publishSourceMaterial';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

import { callUniversalAI } from '../../src/services/ai';

const baseAiConfig = {
  provider: 'gemini' as const,
  apiKey: 'k',
  baseUrl: '',
  model: 'm',
};

const t = (key: string, opts?: Record<string, unknown>): string => {
  if (key === 'ai.prompts.publishArticleFromOutline') return `outline=${opts?.outline} | content=${opts?.content}`;
  if (key === 'ai.prompts.publishOutline') return `content=${opts?.content}`;
  if (key === 'ai.prompts.publishOutlineSystem') return 'system-stub';
  if (key === 'ai.prompts.publishOutlineRevise') return 'revise-stub';
  if (key === 'ai.publish_related_media') return 'Related media';
  if (key === 'ai.generated_article_title') return '默认标题';
  return key;
};

function makeCards(): PublishSourceCardMeta[] {
  return [
    { nodeId: 'n1', canvasId: 'cv', kind: 'note', title: '卡片一' },
    { nodeId: 'n2', canvasId: 'cv', kind: 'note', title: '卡片二' },
  ];
}

function makeOutline(extra: Partial<PublishOutline> = {}): PublishOutline {
  return {
    title: '示例大纲',
    sections: [
      { cardId: 'n1', heading: '段一', summary: '' },
      { cardId: 'n2', heading: '段二', summary: '' },
    ],
    ...extra,
  };
}

beforeEach(() => {
  vi.mocked(callUniversalAI).mockReset();
});

describe('generateArticleFromOutline', () => {
  it('segments 输出时按 cardId 对齐到 cards，构建 sourceCards 并按段拼正文', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: '结构化标题',
        segments: [
          { cardId: 'n1', text: '## 段一\n\n第一段正文。' },
          { cardId: 'n2', text: '## 段二\n\n第二段正文。' },
        ],
      }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'prompt',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    // outline.title 与 parsed.title 都有值时优先 outline（用户/AI 在弹窗确认过的标题）
    expect(article.title).toBe('示例大纲');
    expect(article.linkedCanvasIds).toEqual(['cv']);
    expect(article.sourceCards).toHaveLength(2);
    expect(article.sourceCards![0]).toMatchObject({
      nodeId: 'n1',
      canvasId: 'cv',
      kind: 'note',
      title: '卡片一',
      segmentText: '## 段一\n\n第一段正文。',
    });
    expect(article.sourceCards![1]).toMatchObject({
      nodeId: 'n2',
      segmentText: '## 段二\n\n第二段正文。',
    });
    expect(article.content).toBe('## 段一\n\n第一段正文。\n\n## 段二\n\n第二段正文。');
  });

  it('旧 {title, body} 格式且大纲无 cardId → 不构建 sourceCards，正文用模型 body', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: '旧格式标题', body: '单段正文' }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: { title: '', sections: [] }, // 空 outline → outline.title 为空，用 parsed.title
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.title).toBe('旧格式标题');
    expect(article.sourceCards).toBeUndefined();
    expect(article.content).toBe('单段正文');
  });

  it('旧 {title, body} 格式但大纲仍有 cardId → 仍构建 sourceCards（关联画布），body 挂到第一张卡', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: '旧格式标题', body: '单段正文' }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.sourceCards).toHaveLength(2);
    expect(article.sourceCards![0].segmentText).toBe('单段正文');
    expect(article.sourceCards![1].segmentText).toBe('');
    expect(article.content).toBe('单段正文');
  });

  it('大纲完全不含 cardId（用户清空）→ 不走 sourceCards 链路', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [{ cardId: 'n1', text: '## 段一' }],
      }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline({
        sections: [
          { cardId: '', heading: '全新章节 1', summary: '' },
          { cardId: '', heading: '全新章节 2', summary: '' },
        ],
      }),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    // 大纲无 cardId → eligibleCards 为空 → sourceCards=undefined → 走旧 body 格式
    expect(article.sourceCards).toBeUndefined();
    expect(article.content).toBe('## 段一');
  });

  it('大纲只保留部分 cardId → sourceCards 只包含被大纲提及的卡', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [
          { cardId: 'n1', text: '## 段一' },
          { cardId: 'n2', text: '## 段二' },
        ],
      }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline({
        sections: [{ cardId: 'n1', heading: '只保留 n1', summary: '' }],
      }),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    expect(article.sourceCards).toHaveLength(1);
    expect(article.sourceCards![0].nodeId).toBe('n1');
  });

  it('媒体兜底：模型遗漏 media URL 时按 nodeId 拼回到对应段末尾', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [
          { cardId: 'n1', text: '## 段一' },
          { cardId: 'n2', text: '## 段二' },
        ],
      }),
    );

    const mediaAssets: PublishMediaAsset[] = [
      {
        nodeId: 'n2',
        articleMarkdown: '![img](https://cdn.example.com/x.png)',
        promptMarkdown: '[img](https://cdn.example.com/x.png)',
      },
    ];

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets,
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });

    // 兜底必须把 missing media 写到 n2 段末尾，n1 段保持原样
    expect(article.sourceCards![1].segmentText).toContain('https://cdn.example.com/x.png');
    expect(article.sourceCards![0].segmentText).not.toContain('https://cdn.example.com/x.png');
    expect(article.content).toContain('Related media');
  });

  it('媒体兜底：sourceCards 链路 missing 为空时不应走到 ensurePublishMediaInBody', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        title: 'T',
        segments: [
          { cardId: 'n1', text: '段一含 https://cdn.example.com/y.png' },
          { cardId: 'n2', text: '段二' },
        ],
      }),
    );
    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [
        {
          nodeId: 'n1',
          articleMarkdown: '![img](https://cdn.example.com/y.png)',
          promptMarkdown: '![img](https://cdn.example.com/y.png)',
        },
      ],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
    });
    // 模型已含 URL → 不算 missing → 不应出现 'Related media' 兜底头
    expect(article.content).not.toContain('Related media');
    expect(article.content).not.toContain('## Related');
  });

  it('流式：onStreamChunk 把累积文本透传', async () => {
    vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
      opts.onStreamChunk?.('partial-1');
      opts.onStreamChunk?.('partial-1-2');
      return JSON.stringify({ title: 'T', body: '最终' });
    });

    const seen: string[] = [];
    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'cv',
      t,
      onStreamChunk: (acc) => seen.push(acc),
    });

    expect(seen).toEqual(['partial-1', 'partial-1-2']);
    expect(article.content).toBe('最终');
  });

  it('Article 默认字段：id/date/tags/author/type/linkedCanvasIds 符合契约', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({ title: 'T', body: 'b' }),
    );

    const article = await generateArticleFromOutline({
      aiConfig: baseAiConfig,
      outline: makeOutline(),
      promptContent: 'p',
      mediaAssets: [],
      cards: makeCards(),
      activeCanvasId: 'canvas-x',
      t,
    });

    expect(article.id).toMatch(/^gen-/);
    expect(article.tags).toEqual([]);
    expect(article.author).toBe('');
    expect(article.type).toMatch(/^GEN-\d+$/);
    expect(article.linkedCanvasIds).toEqual(['canvas-x']);
    expect(article.date).toMatch(/^\d{4}$/);
  });

  it('AI 抛出错误时同步抛错（由调用方上抛到弹窗）', async () => {
    vi.mocked(callUniversalAI).mockRejectedValueOnce(new Error('upstream down'));
    await expect(
      generateArticleFromOutline({
        aiConfig: baseAiConfig,
        outline: makeOutline(),
        promptContent: 'p',
        mediaAssets: [],
        cards: makeCards(),
        activeCanvasId: 'cv',
        t,
      }),
    ).rejects.toThrow('upstream down');
  });
});
