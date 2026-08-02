import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';

// Lazy import so we can vi.resetModules between tests and re-mock dependencies in one place.

const stop = vi.fn(async () => undefined);
const startMicCapture = vi.fn(async () => ({ stop }));

const asrSession = {
  sendPcm: vi.fn(),
  finish: vi.fn(),
  close: vi.fn(),
};
// Use `any` for the mock signature so we can pass options through the vi.mock wrapper
// without forcing a public type for the test-only mock. Production types are validated
// by tests of the real implementation; this mock just needs to round-trip its args.
const openVolcAsrSession = vi.fn((_creds?: unknown, _options?: unknown) => asrSession);
const hasVolcAsrCredentials = vi.fn(() => true);

const enterFullscreenMock = vi.fn();
const exitFullscreenMock = vi.fn();
const setStreamingAiNodeIdMock = vi.fn();
const setCanvasTransformMock = vi.fn();

const callUniversalAIMock = vi.fn(async (_args?: unknown) => 'AI reply');

// Module-level db mock so individual tests can override get/update with a backing store.
// `add` records into a Map, `get` reads from it, `update` merges into it. This lets us
// reproduce "user edited the note while ASR was live" without spinning up fake-indexeddb.
const dbNodeStore = new Map<string, { id: string; content: string; canvasId: string; type: string; x: number; y: number }>();
// Loose typing on purpose — the test only needs the mock to round-trip args.
const dbNodesAddMock = vi.fn(async (n: { id: string; content?: string; canvasId?: string; type?: string; x?: number; y?: number }) => {
  const node = { id: n.id, content: n.content ?? '', canvasId: n.canvasId ?? 'c1', type: n.type ?? 'text', x: n.x ?? 0, y: n.y ?? 0 };
  dbNodeStore.set(n.id, node);
  return n.id;
});
const dbNodesUpdateMock = vi.fn(async (id: string, changes: Partial<{ content: string }>) => {
  const existing = dbNodeStore.get(id);
  if (existing) dbNodeStore.set(id, { ...existing, ...changes });
  return undefined;
});
const dbNodesGetMock = vi.fn(async (id: string) => dbNodeStore.get(id));

vi.mock('../../src/services/micCapture', () => ({
  startMicCapture: () => startMicCapture(),
}));
vi.mock('../../src/services/volcAsr', () => ({
  openVolcAsrSession: (creds: unknown, options: unknown) =>
    (openVolcAsrSession as unknown as (c: unknown, o: unknown) => unknown)(creds, options),
  hasVolcAsrCredentials: () => hasVolcAsrCredentials(),
}));
vi.mock('../../src/db', () => ({
  db: {
    nodes: {
      add: (n: unknown) => dbNodesAddMock(n as Parameters<typeof dbNodesAddMock>[0]),
      update: (id: unknown, changes: unknown) =>
        dbNodesUpdateMock(id as string, changes as Parameters<typeof dbNodesUpdateMock>[1]),
      get: (id: unknown) => dbNodesGetMock(id as string),
    },
    edges: {
      add: vi.fn(async (e: { id: string }) => e.id),
      delete: vi.fn(async () => undefined),
    },
  },
}));
vi.mock('../../src/services/ai', () => ({
  callUniversalAI: (...args: unknown[]) => callUniversalAIMock(...args),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../src/utils/canvasStreamingAi', () => ({
  runCanvasStreamingAiCall: vi.fn(async ({ callAi }: { callAi: (cb: (s: string) => void) => Promise<void> | void }) => {
    await (callAi as (s: any) => any)('hello');
    return 'AI reply';
  }),
}));
vi.mock('../../src/utils/voiceNoteLayout', () => ({
  voiceAiPosition: (anchor: { x: number; y: number }) => ({ x: anchor.x + 200, y: anchor.y + 200 }),
  voiceUserPosition: (anchor: { x: number; y: number }) => ({ x: anchor.x, y: anchor.y + 100 }),
  transformToFocusNode: () => ({ x: 0, y: 0, scale: 1 }),
}));
vi.mock('../../src/utils/canvas', () => ({
  getCanvasCenterPosition: () => ({ x: 100, y: 200 }),
}));
vi.mock('../../src/services/minimaxTts', () => ({
  synthesizeMinimaxSpeech: vi.fn(async () => new Blob()),
}));

beforeEach(() => {
  stop.mockClear();
  stop.mockResolvedValue(undefined);
  startMicCapture.mockClear();
  openVolcAsrSession.mockClear();
  hasVolcAsrCredentials.mockClear();
  hasVolcAsrCredentials.mockReturnValue(true);
  asrSession.sendPcm.mockClear();
  asrSession.close.mockClear();
  enterFullscreenMock.mockClear();
  exitFullscreenMock.mockClear();
  setStreamingAiNodeIdMock.mockClear();
  setCanvasTransformMock.mockClear();
  callUniversalAIMock.mockClear();
  dbNodeStore.clear();
  dbNodesAddMock.mockClear();
  dbNodesUpdateMock.mockClear();
  dbNodesGetMock.mockClear();
});

async function renderVoiceHook(options?: { editingNodeId?: string | null }) {
  const { useVoiceWritingMode } = await import('../../src/hooks/useVoiceWritingMode');
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    return React.createElement(AppDialogProvider, null, children);
  };
  const initialEditing = options?.editingNodeId !== undefined ? options.editingNodeId : null;
  return renderHook(
    ({ editingNodeId }: { editingNodeId: string | null }) =>
      useVoiceWritingMode({
        aiConfig: {
          provider: 'openai' as const,
          volcAsrApiKey: 'asr',
          minimaxApiKey: 'm',
        } as any,
        activeCanvasId: 'c1',
        transformRef: { current: { x: 0, y: 0, scale: 1 } } as any,
        setCanvasTransform: setCanvasTransformMock,
        editingNodeId,
        setStreamingAiNodeId: setStreamingAiNodeIdMock,
        enterFullscreen: enterFullscreenMock,
        exitFullscreen: exitFullscreenMock,
        isAnyAiBusy: false,
      }),
    {
      wrapper: Wrapper,
      initialProps: { editingNodeId: initialEditing },
    },
  );
}

describe('useVoiceWritingMode', () => {
  it('rejects back-to-back toggle clicks via the synchronous startingRef gate (#10)', async () => {
    const { result } = await renderVoiceHook();
    await act(async () => {
      result.current.toggleVoiceMode();
      result.current.toggleVoiceMode();
      result.current.toggleVoiceMode();
      await Promise.resolve();
    });
    // Only the first call should start anything observable; the second/third are dropped.
    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(openVolcAsrSession).toHaveBeenCalledTimes(1);
    expect(enterFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it('releases startingRef after a successful start so the next click can stop voice mode', async () => {
    const { result } = await renderVoiceHook();
    await act(async () => {
      result.current.toggleVoiceMode();
      // Drain through getUserMedia → setPhase('listening') → startingRef.current = false.
      await Promise.resolve();
      await Promise.resolve();
    });
    // Voice mode is now active.
    expect(startMicCapture).toHaveBeenCalledTimes(1);
    // Second click must NOT be silently ignored — it should call stopVoiceMode, which
    // tear-downs the mic capture.
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
    });
    expect(stop).toHaveBeenCalled();
  });

  // 守护 bf6112f 的"ASR 与人工编辑共存"契约：用户编辑时 ASR 应当让位，提交时取用户文本。
  it('用户编辑便签时，ASR 部分结果不覆盖用户文本；mic-off 提交的是用户文本（不是 ASR 最新片段）', async () => {
    const { result, rerender } = await renderVoiceHook({ editingNodeId: null });

    // 1) 启动语音模式 —— 创建 user note（add 返回 id）并打开 ASR 会话。
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(openVolcAsrSession).toHaveBeenCalledTimes(1);
    // 抓取当前 ASR 会话注入的回调。
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
      onDefinite?: (text: string) => void;
    };

    // 2) 找到新建的 user note（add 的第一个参数带 id）。
    const userNoteId = (dbNodesAddMock.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'text',
    )?.[0] as { id: string } | undefined)?.id;
    expect(userNoteId).toBeTruthy();

    // 3) 模拟"用户在便签上打字"——直接通过 update 把 db 里的内容写成用户文本。
    //    这相当于 contentEditable 的 onBlur 写库完成。
    await act(async () => {
      await dbNodesUpdateMock(userNoteId!, { content: '用户手动编辑的文本' });
    });
    expect(dbNodeStore.get(userNoteId!)?.content).toBe('用户手动编辑的文本');

    // 4) 重新渲染，把 editingNodeId 设成 user note id，模拟"用户已点进便签编辑"。
    rerender({ editingNodeId: userNoteId! });

    // 5) 触发 ASR onPartial：应当被 applyTranscript 静默丢弃，不写回 db。
    const updateCallsBeforeAsr = dbNodesUpdateMock.mock.calls.length;
    await act(async () => {
      asrOpts.onPartial?.('ASR 临时片段不应覆盖用户');
      await Promise.resolve();
    });
    const afterAsrUpdates = dbNodesUpdateMock.mock.calls
      .slice(updateCallsBeforeAsr)
      .filter((c) => c[0] === userNoteId);
    // 用户的文本必须保留，不被 ASR 改写。
    expect(dbNodeStore.get(userNoteId!)?.content).toBe('用户手动编辑的文本');
    expect(afterAsrUpdates).toEqual([]);

    // 6) 第二次 toggle —— 触发 finishListeningRoundRef。
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 7) callUniversalAI 收到的 prompt 必须包含"用户手动编辑的文本"，不包含 ASR 片段。
    expect(callUniversalAIMock).toHaveBeenCalled();
    const lastCall = callUniversalAIMock.mock.calls.at(-1)?.[0] as { prompt: string };
    expect(lastCall.prompt).toContain('用户手动编辑的文本');
    expect(lastCall.prompt).not.toContain('ASR 临时片段');
  });

  // 配套守护：用户没在编辑时，ASR 正常推进，提交文本来自 ASR。
  it('用户未编辑便签时，ASR 部分结果正常写库；mic-off 提交的是 ASR 当前累积文本', async () => {
    const { result } = await renderVoiceHook({ editingNodeId: null });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[0]?.[1] as {
      onPartial?: (text: string) => void;
    };
    const userNoteId = (dbNodesAddMock.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'text',
    )?.[0] as { id: string } | undefined)?.id;
    expect(userNoteId).toBeTruthy();

    // ASR 推进；onDefinite 不会自动提交，applyTranscript 会更新 db。
    await act(async () => {
      asrOpts.onPartial?.('今天天气真好');
      await Promise.resolve();
    });
    expect(dbNodeStore.get(userNoteId!)?.content).toBe('今天天气真好');

    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(callUniversalAIMock).toHaveBeenCalled();
    const lastCall = callUniversalAIMock.mock.calls.at(-1)?.[0] as { prompt: string };
    expect(lastCall.prompt).toContain('今天天气真好');
  });

  // 守护 d2d42c0 的"ASR 累积 = replace"契约：onDefinite 不再是"开始 AI 轮"，只是累积。
  it('onDefinite 只累积转写，不自动启动 AI 轮（防止半句触发思考）', async () => {
    const { result } = await renderVoiceHook({ editingNodeId: null });
    await act(async () => {
      result.current.toggleVoiceMode();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const asrOpts = openVolcAsrSession.mock.calls[1]?.[1] as {
      onDefinite?: (text: string) => void;
    } | undefined;
    // startListeningLoop 会再次打开 ASR；这里拿最近一次。
    const allAsrOpts = openVolcAsrSession.mock.calls
      .map((c) => c[1] as { onDefinite?: (text: string) => void })
      .filter(Boolean);
    const last = allAsrOpts.at(-1);

    const callCountBefore = callUniversalAIMock.mock.calls.length;
    await act(async () => {
      last?.onDefinite?.('我正在思考的半句话');
      await Promise.resolve();
    });
    // 不应触发 AI 调用。
    expect(callUniversalAIMock.mock.calls.length).toBe(callCountBefore);
  });
});
