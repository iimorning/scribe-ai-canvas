import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useAiActions } from '../../src/hooks/useAiActions';
import { db } from '../../src/db';
import type { AgentConfig, CanvasNode } from '../../src/db';
import type { AIConfig } from '../../src/components/AISettingsModal';

/** Stable vi.fn() across re-renders so assertions stay valid after async handlers trigger state updates. */
function stableMockFn<T extends (...args: any[]) => any>(): T {
  return useRef(vi.fn()).current as T;
}

const publishJsonResponse = vi.hoisted(() =>
  JSON.stringify({
    title: 'Synthesized Title',
    body: '## Section\n\nParagraph one.',
  }),
);

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn().mockResolvedValue(publishJsonResponse),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  maskApiKeyForLog: (k: string) => (k ? `${k.slice(0, 2)}…` : ''),
}));

vi.mock('../../src/services/search', () => ({
  metasoSearch: vi.fn().mockResolvedValue({
    credits: 0,
    total: 0,
    webpages: [],
  }),
  buildSearchContext: vi.fn(),
}));

const analyzeToolbarIntentPreflightMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ambiguous: false }),
);

vi.mock('../../src/services/toolbarIntentClarification', () => ({
  analyzeToolbarIntentPreflight: (...args: unknown[]) => analyzeToolbarIntentPreflightMock(...args),
}));

import { callUniversalAI } from '../../src/services/ai';
import { metasoSearch } from '../../src/services/search';
import i18n from '../../src/i18n';

function mockCallUniversalAIWithStream(finalText: string) {
  vi.mocked(callUniversalAI).mockImplementation(async (opts) => {
    if (opts.onStreamChunk) {
      opts.onStreamChunk('partial');
      opts.onStreamChunk(finalText);
    }
    return finalText;
  });
}

const baseAiConfig: AIConfig = {
  provider: 'gemini',
  apiKey: 'test',
  baseUrl: '',
  model: 'gemini-1.5-flash',
  metasoApiKey: 'metaso-k',
};

function useTestAiActions(opts?: {
  agentConfigs?: AgentConfig[];
  selectedNodes?: Set<string>;
  edges?: { from: string; to: string; id?: string }[];
  dynamicNodes?: CanvasNode[];
  aiConfigOverrides?: Partial<AIConfig>;
}) {
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(opts?.selectedNodes ?? new Set());
  const setActiveReferenceId = stableMockFn<(id: string) => void>();
  const setActiveTab = stableMockFn<(tab: string) => void>();

  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });

  return {
    ...useAiActions({
      aiConfig: { ...baseAiConfig, ...opts?.aiConfigOverrides },
      agentConfigs: opts?.agentConfigs ?? ([] as AgentConfig[]),
      activeCanvasId: 'default',
      nodesRef: nodesRef as React.RefObject<Record<string, HTMLElement | null>>,
      transformRef: transformRef as React.RefObject<{ x: number; y: number; scale: number }>,
      dynamicNodes: opts?.dynamicNodes ?? [],
      edges: (opts?.edges ?? []) as any[],
      selectedNodes,
      setSelectedNodes,
      setActiveReferenceId,
      setActiveTab,
    }),
    nodesRef,
    setActiveReferenceId,
    setActiveTab,
    setSelectedNodes,
  };
}

describe('useAiActions', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.articles.clear();
    await db.edges.clear();
    await i18n.changeLanguage('en');
    vi.mocked(callUniversalAI).mockClear();
    mockCallUniversalAIWithStream('AI generated text');
    vi.mocked(metasoSearch).mockClear();
    vi.mocked(metasoSearch).mockResolvedValue({
      credits: 0,
      total: 0,
      webpages: [],
    });
    analyzeToolbarIntentPreflightMock.mockClear();
    analyzeToolbarIntentPreflightMock.mockResolvedValue({ ambiguous: false });
  });

  // --- handlePublish ---
  describe('handlePublish', () => {
    it('selectedNodes 为空时不执行', async () => {
      const { result } = renderHook(() => useTestAiActions());

      await act(async () => {
        await result.current.handlePublish();
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
    });

    it('有选中节点时合成并写入 articles（含扩展字段）', async () => {
      const { result } = renderHook(() => useTestAiActions());

      act(() => {
        result.current.setSelectedNodes(new Set(['n1']));
        const el = document.createElement('div');
        el.innerText = 'Hello publish body';
        result.current.nodesRef.current.n1 = el;
      });

      vi.mocked(callUniversalAI).mockResolvedValueOnce(publishJsonResponse);

      await act(async () => {
        await result.current.handlePublish();
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      expect(vi.mocked(callUniversalAI).mock.calls[0][0].onStreamChunk).toBeUndefined();
      expect(result.current.setActiveTab).toHaveBeenCalledWith('reference');
      expect(result.current.setActiveReferenceId).toHaveBeenCalled();

      const rows = await db.articles.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Synthesized Title');
      expect(rows[0].content).toContain('## Section');
      expect(rows[0].tags).toEqual([]);
      expect(rows[0].linkedCanvasIds).toEqual(['default']);
      expect(rows[0].author).toBe('');
      expect(rows[0].type).toMatch(/^GEN-/);
    });
  });

  // --- handleAiSubmit ---
  describe('handleAiSubmit', () => {
    it('aiPrompt 为空时不执行', async () => {
      const { result } = renderHook(() => useTestAiActions());

      await act(async () => {
        await result.current.handleAiSubmit();
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
    });

    it('aiPrompt 有值时调用 AI 并创建节点', async () => {
      const { result } = renderHook(() => useTestAiActions());

      act(() => {
        result.current.setAiPrompt(
          'Write a long reflective paragraph about episodic memory, aging, and narrative identity so that the toolbar intent gate skips preflight.',
        );
      });

      await act(async () => {
        await result.current.handleAiSubmit();
      });

      expect(analyzeToolbarIntentPreflightMock).not.toHaveBeenCalled();
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('episodic memory'),
        }),
      );

      const nodes = await db.nodes.toArray();
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe('ai');
      expect(nodes[0].content).toBe('AI generated text');
      expect(result.current.aiPrompt).toBe('');
    });

    it('无勾选所选节点时不带入便签：prompt 为用户原文且 system 含思维伙伴设定', async () => {
      const longSkipPreflight =
        'Write a long reflective paragraph about rivers and deltas so toolbar intent gate skips preflight without question marks.';
      const { result } = renderHook(() => useTestAiActions({ selectedNodes: new Set() }));

      act(() => {
        result.current.setAiPrompt(longSkipPreflight);
      });

      await act(async () => {
        await result.current.handleAiSubmit();
      });

      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: longSkipPreflight,
          systemInstruction: expect.stringMatching(/AI thinking partner[\s\S]*not to behave like a chatbot[\s\S]*Never expose the product metaphor[\s\S]*Always reply entirely in English/i),
        }),
      );
    });

    it('勾选节点时拼装所选正文，system 将节选作为隐性上下文', async () => {
      const longSkipPreflight =
        'Write at length about cloud patterns and precipitation types so toolbar intent gate skips without question marks.';
      const hook = renderHook(() =>
        useTestAiActions({ selectedNodes: new Set(['n1']), edges: [{ from: 'n1', to: 'x' }] }),
      );

      act(() => {
        const noteEl = document.createElement('div');
        noteEl.innerText = 'EXCERPT_FROM_SELECTED_NOTE';
        hook.result.current.nodesRef.current['n1'] = noteEl;
        hook.result.current.setAiPrompt(longSkipPreflight);
      });

      await act(async () => {
        await hook.result.current.handleAiSubmit();
      });

      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/EXCERPT_FROM_SELECTED_NOTE[\s\S]*precipitation types/i),
          systemInstruction: expect.stringMatching(/selected material[\s\S]*private context[\s\S]*do not expose the product metaphor[\s\S]*Always reply entirely in English/i),
        }),
      );
    });

    it('命中预检闸门时先跑意图分析，无疑义则用原文调主模型', async () => {
      const { result } = renderHook(() => useTestAiActions());
      act(() => {
        result.current.setAiPrompt('你怎么看？');
      });
      await act(async () => {
        await result.current.handleAiSubmit();
      });
      expect(analyzeToolbarIntentPreflightMock).toHaveBeenCalledTimes(1);
      expect(analyzeToolbarIntentPreflightMock).toHaveBeenCalledWith(
        '你怎么看？',
        expect.objectContaining({ provider: 'gemini' }),
        expect.any(Function),
      );
      expect(callUniversalAI).toHaveBeenCalledTimes(1);
    });

    it('AI 失败时不创建节点', async () => {
      vi.mocked(callUniversalAI).mockRejectedValueOnce(new Error('API Error'));

      const { result } = renderHook(() => useTestAiActions());

      act(() => {
        result.current.setAiPrompt('Fail request');
      });

      await act(async () => {
        await result.current.handleAiSubmit();
      });

      const nodes = await db.nodes.toArray();
      expect(nodes.length).toBe(0);
    });
  });

  // --- triggerAgentAnalysis ---
  describe('triggerAgentAnalysis', () => {
    it('agentConfigId 不存在时提前返回', async () => {
      const { result } = renderHook(() => useTestAiActions());

      await act(async () => {
        await result.current.triggerAgentAnalysis('nonexistent', 'node1', 'node2');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
    });

    it('传入 temperature、topP，且 system 含 Markdown 知识块', async () => {
      const agent: AgentConfig = {
        id: 'a1',
        name: 'Test',
        role: 'R',
        prompt: 'You are test',
        temperature: 0.3,
        creativity: 0.9,
        knowledgeMarkdownFiles: [{ name: 'doc.md', content: 'Hello knowledge' }],
      };

      const { result } = renderHook(() =>
        useTestAiActions({
          agentConfigs: [agent],
          dynamicNodes: [
            { id: 'agent-node', type: 'agent', agentConfigId: 'a1', x: 0, y: 0, canvasId: 'default' },
          ],
        }),
      );

      act(() => {
        const el = document.createElement('div');
        el.appendChild(document.createTextNode('context body'));
        result.current.nodesRef.current.ctx1 = el;
      });

      await act(async () => {
        await result.current.triggerAgentAnalysis('a1', 'agent-node', 'ctx1');
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
          topP: 0.9,
          systemInstruction: expect.stringMatching(/Markdown knowledge base[\s\S]*doc\.md[\s\S]*Hello knowledge/),
          prompt: expect.stringMatching(/context body/),
        }),
      );

      const rows = await db.nodes.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].threadRootContextNodeId).toBe('ctx1');
      expect(rows[0].threadAgentConfigId).toBe('a1');
    });

    it('便签与 Agent 邻接图片时 callUniversalAI 传入 images 并写入 threadContextImageNodeIds', async () => {
      const tinyPng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const agent: AgentConfig = {
        id: 'a1',
        name: 'Test',
        role: 'R',
        prompt: 'You are test',
        temperature: 0.7,
        creativity: 0.4,
      };

      const { result } = renderHook(() =>
        useTestAiActions({
          agentConfigs: [agent],
          dynamicNodes: [
            { id: 'agent-node', type: 'agent', agentConfigId: 'a1', x: 0, y: 0, canvasId: 'default' },
            { id: 'img1', type: 'image', content: tinyPng, x: 0, y: 0, canvasId: 'default' },
          ],
          edges: [
            { id: 'e1', from: 'img1', to: 'agent-node', canvasId: 'default' },
            { id: 'e2', from: 'ctx1', to: 'agent-node', canvasId: 'default' },
          ],
        }),
      );

      act(() => {
        const el = document.createElement('div');
        el.appendChild(document.createTextNode('note text'));
        result.current.nodesRef.current.ctx1 = el;
      });

      await act(async () => {
        await result.current.triggerAgentAnalysis('a1', 'agent-node', 'ctx1');
      });

      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/note text/),
          images: [tinyPng],
        }),
      );

      const rows = await db.nodes.toArray();
      expect(rows[0].threadContextImageNodeIds).toEqual(['img1']);
    });
  });

  describe('加载状态标志', () => {
    it('初始均为空闲', () => {
      const { result } = renderHook(() => useTestAiActions());
      expect(result.current.isPublishing).toBe(false);
      expect(result.current.isToolbarAiLoading).toBe(false);
      expect(result.current.analyzingAgentNodeId).toBe(null);
      expect(result.current.followUpParentId).toBe(null);
      expect(result.current.isAnyAiBusy).toBe(false);
    });
  });

  // --- submitAiThreadFollowUp ---
  describe('submitAiThreadFollowUp', () => {
    const parentCard: CanvasNode = {
      id: 'parent-ai',
      type: 'ai',
      content: '上一轮 AI 正文',
      x: 5,
      y: 10,
      canvasId: 'default',
    };

    it('追问文案为空时不调用 AI', async () => {
      await db.nodes.add({ ...parentCard });
      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [parentCard] })
      );

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', '   ');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
    });

    it('父节点不是 ai 类型时不调用 AI', async () => {
      const noteNode: CanvasNode = {
        id: 'note-1',
        type: 'note',
        content: 'x',
        x: 0,
        y: 0,
        canvasId: 'default',
      };
      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [noteNode] })
      );

      await act(async () => {
        await result.current.submitAiThreadFollowUp('note-1', '追问');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
    });

    it('成功时创建子 AI 节点、边，并写入父节点 followUpSent', async () => {
      await db.nodes.add({ ...parentCard });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [parentCard] })
      );

      const mockEl = document.createElement('div');
      Object.defineProperties(mockEl, {
        offsetHeight: { get: () => 100 },
        offsetWidth: { get: () => 280 },
      });

      act(() => {
        result.current.nodesRef.current['parent-ai'] = mockEl;
      });

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', '我的追问');
      });

      expect(callUniversalAI).toHaveBeenCalledTimes(1);
      const callArg = vi.mocked(callUniversalAI).mock.calls[0][0];
      expect(callArg.prompt).toContain('我的追问');
      expect(callArg.prompt).toContain('上一轮 AI 正文');
      expect(callArg.systemInstruction).toContain('Always reply entirely in English');
      expect(callArg.onStreamChunk).toEqual(expect.any(Function));

      const allNodes = await db.nodes.toArray();
      expect(allNodes).toHaveLength(2);
      const child = allNodes.find((n) => n.id !== 'parent-ai');
      expect(child?.type).toBe('ai');
      expect(child?.userTurn).toBe('我的追问');
      expect(child?.content).toBe('AI generated text');
      expect(child?.canvasId).toBe('default');
      expect(child?.x).toBe(5);
      expect(child?.y).toBe(10 + 100 + 24);
      expect(child?.width).toBe(280);

      const edges = await db.edges.toArray();
      expect(edges).toHaveLength(1);
      expect(edges[0].from).toBe('parent-ai');
      expect(edges[0].to).toBe(child!.id);

      const parentRow = await db.nodes.get('parent-ai');
      expect(parentRow?.followUpSent).toBe(true);
    });

    it('AI 返回空字符串时不创建子节点且不标记 followUpSent', async () => {
      vi.mocked(callUniversalAI).mockResolvedValueOnce('');
      await db.nodes.add({ ...parentCard });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [parentCard] })
      );

      const mockEl = document.createElement('div');
      Object.defineProperty(mockEl, 'offsetHeight', { get: () => 50 });

      act(() => {
        result.current.nodesRef.current['parent-ai'] = mockEl;
      });

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', '追问');
      });

      const nodes = await db.nodes.toArray();
      expect(nodes).toHaveLength(1);

      const parentRow = await db.nodes.get('parent-ai');
      expect(parentRow?.followUpSent).not.toBe(true);
    });

    it('「联网搜索」时调用秘塔并生成子节点与资料卡，不调用对话模型', async () => {
      vi.mocked(metasoSearch).mockResolvedValueOnce({
        credits: 0,
        total: 1,
        webpages: [{ title: 'T', snippet: 'S', link: 'https://ex.com', score: '', date: '' }],
      });
      await db.nodes.add({ ...parentCard });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [parentCard] })
      );

      const mockEl = document.createElement('div');
      Object.defineProperties(mockEl, {
        offsetHeight: { get: () => 100 },
        offsetWidth: { get: () => 280 },
      });

      act(() => {
        result.current.nodesRef.current['parent-ai'] = mockEl;
      });

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', '联网搜索');
      });

      expect(callUniversalAI).not.toHaveBeenCalled();
      expect(metasoSearch).toHaveBeenCalledWith('上一轮 AI 正文', { apiKey: 'metaso-k', scope: 'webpage' });

      const allNodes = await db.nodes.toArray();
      expect(allNodes).toHaveLength(3);
      const child = allNodes.find((n) => n.userTurn === '联网搜索');
      expect(child?.type).toBe('ai');
      expect(child?.content).toBeTruthy();

      const edges = await db.edges.toArray();
      expect(edges.length).toBeGreaterThanOrEqual(2);

      const parentRow = await db.nodes.get('parent-ai');
      expect(parentRow?.followUpSent).toBe(true);
    });

    it('「联网搜索」且父卡带 Agent 链字段时子 AI 卡复制 threadContextImageNodeIds', async () => {
      vi.mocked(metasoSearch).mockResolvedValueOnce({
        credits: 0,
        total: 1,
        webpages: [{ title: 'T', snippet: 'S', link: 'https://ex.com', score: '', date: '' }],
      });
      const parentWithThread: CanvasNode = {
        ...parentCard,
        threadRootContextNodeId: 'ctx-note',
        threadAgentConfigId: 'ag-x',
        threadContextImageNodeIds: ['img-a', 'img-b'],
      };
      await db.nodes.add(parentWithThread);

      const { result } = renderHook(() => useTestAiActions({ dynamicNodes: [parentWithThread] }));

      const mockEl = document.createElement('div');
      Object.defineProperties(mockEl, {
        offsetHeight: { get: () => 100 },
        offsetWidth: { get: () => 280 },
      });
      act(() => {
        result.current.nodesRef.current['parent-ai'] = mockEl;
      });

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', '联网搜索');
      });

      const child = (await db.nodes.toArray()).find((n) => n.userTurn === '联网搜索');
      expect(child?.threadRootContextNodeId).toBe('ctx-note');
      expect(child?.threadAgentConfigId).toBe('ag-x');
      expect(child?.threadContextImageNodeIds).toEqual(['img-a', 'img-b']);
    });

    it('「联网搜索 主题」用后面的词作为检索词', async () => {
      vi.mocked(metasoSearch).mockResolvedValueOnce({
        credits: 0,
        total: 1,
        webpages: [{ title: 'T', snippet: 'S', link: 'https://ex.com', score: '', date: '' }],
      });
      await db.nodes.add({ ...parentCard });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [parentCard] })
      );

      const mockEl = document.createElement('div');
      Object.defineProperty(mockEl, 'offsetHeight', { get: () => 50 });

      act(() => {
        result.current.nodesRef.current['parent-ai'] = mockEl;
      });

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', '联网搜索 仅用这个');
      });

      expect(metasoSearch).toHaveBeenCalledWith('仅用这个', { apiKey: 'metaso-k', scope: 'webpage' });
    });

    it('无秘塔 Key 时不调用检索', async () => {
      await db.nodes.add({ ...parentCard });

      const { result } = renderHook(() =>
        useTestAiActions({
          dynamicNodes: [parentCard],
          aiConfigOverrides: { metasoApiKey: '' },
        })
      );

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', '联网搜索');
      });

      expect(metasoSearch).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('AI 失败时不标记 followUpSent', async () => {
      vi.mocked(callUniversalAI).mockRejectedValueOnce(new Error('network'));
      await db.nodes.add({ ...parentCard });

      const { result } = renderHook(() =>
        useTestAiActions({ dynamicNodes: [parentCard] })
      );

      const mockEl = document.createElement('div');
      Object.defineProperty(mockEl, 'offsetHeight', { get: () => 40 });

      act(() => {
        result.current.nodesRef.current['parent-ai'] = mockEl;
      });

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', '追问');
      });

      const parentRow = await db.nodes.get('parent-ai');
      expect(parentRow?.followUpSent).not.toBe(true);
    });

    it('Agent 链追问时传入 threadContextImageNodeIds 解析出的 images', async () => {
      const tinyPng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const agent: AgentConfig = {
        id: 'ac1',
        name: 'A',
        role: 'R',
        prompt: 'You are A',
        temperature: 0.2,
        creativity: 0.3,
      };
      const parentWithThread: CanvasNode = {
        ...parentCard,
        threadRootContextNodeId: 'ctx-note',
        threadAgentConfigId: 'ac1',
        threadContextImageNodeIds: ['img1'],
      };
      const imgNode: CanvasNode = {
        id: 'img1',
        type: 'image',
        content: tinyPng,
        x: 0,
        y: 0,
        canvasId: 'default',
      };
      await db.nodes.add({ ...parentWithThread });

      const { result } = renderHook(() =>
        useTestAiActions({
          agentConfigs: [agent],
          dynamicNodes: [parentWithThread, imgNode],
          edges: [],
        }),
      );

      const mockEl = document.createElement('div');
      Object.defineProperties(mockEl, {
        offsetHeight: { get: () => 100 },
        offsetWidth: { get: () => 280 },
      });
      const ctxEl = document.createElement('div');
      ctxEl.appendChild(document.createTextNode('initial ctx'));

      act(() => {
        result.current.nodesRef.current['parent-ai'] = mockEl;
        result.current.nodesRef.current['ctx-note'] = ctxEl;
      });

      await act(async () => {
        await result.current.submitAiThreadFollowUp('parent-ai', 'follow up');
      });

      expect(callUniversalAI).toHaveBeenCalledWith(
        expect.objectContaining({
          images: [tinyPng],
          temperature: 0.2,
          topP: 0.3,
          systemInstruction: expect.stringMatching(/You are A/),
          prompt: expect.stringMatching(/follow up/),
        }),
      );
    });
  });
});
