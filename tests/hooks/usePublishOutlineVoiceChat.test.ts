import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';

// ------- Service mocks（vi.hoisted 以便 vi.mock factory 可引用） --------
const asrSession = {
  sendPcm: vi.fn(),
  finish: vi.fn(),
  close: vi.fn(),
};
const micStop = vi.fn(async () => undefined);
const asrHandlers: {
  onPartial?: (text: string) => void;
  onDefinite?: (text: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
} = {};

const startMicCapture = vi.fn(async () => ({ stop: micStop }));
const openVolcAsrSession = vi.fn(async (_creds?: unknown) => asrSession);
const hasVolcAsrCredentials = vi.fn(() => true);

const ttsPushAccumulated = vi.fn();
const ttsFlush = vi.fn();
const ttsWaitUntilIdle = vi.fn(async () => undefined);
const ttsStop = vi.fn();
const ttsSpeakingChangeHandlers: Array<(s: boolean) => void> = [];
const ttsErrorHandlers: Array<(m: string) => void> = [];
const createTtsSentenceQueue = vi.fn((cfg?: { onSpeakingChange?: (s: boolean) => void; onError?: (m: string) => void }) => {
  if (cfg?.onSpeakingChange) ttsSpeakingChangeHandlers.push(cfg.onSpeakingChange);
  if (cfg?.onError) ttsErrorHandlers.push(cfg.onError);
  return {
    pushAccumulatedText: ttsPushAccumulated,
    flush: ttsFlush,
    waitUntilIdle: ttsWaitUntilIdle,
    stop: ttsStop,
  };
});

const callUniversalAI = vi.fn(async (args: { onStreamChunk?: (acc: string) => void }) => {
  args.onStreamChunk?.('partial');
  return JSON.stringify({ summary: 'ai-summary', outline: { title: 'A', sections: [{ cardId: 'n1', heading: 'H', summary: 'S' }] } });
});

vi.mock('../../src/services/micCapture', () => ({
  startMicCapture: (...a: unknown[]) => (startMicCapture as unknown as (...a: unknown[]) => unknown)(...a),
}));
vi.mock('../../src/services/volcAsr', () => ({
  openVolcAsrSession: (creds: unknown, opts: unknown) => {
    Object.assign(asrHandlers, opts ?? {});
    return (openVolcAsrSession as unknown as (c: unknown) => unknown)(creds);
  },
  hasVolcAsrCredentials: (creds: unknown) =>
    (hasVolcAsrCredentials as unknown as (c: unknown) => boolean)(creds),
}));
vi.mock('../../src/utils/ttsSentenceQueue', () => ({
  createTtsSentenceQueue: (cfg: unknown) =>
    (createTtsSentenceQueue as unknown as (c: unknown) => unknown)(cfg),
}));
vi.mock('../../src/services/ai', () => ({
  callUniversalAI: (args: unknown) => (callUniversalAI as unknown as (a: unknown) => unknown)(args),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock(import('react-i18next'), async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await (vi as any).importActual('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'ai.prompts.outlineVoiceUser') return `outline=${opts?.outline} | request=${opts?.request}`;
        if (key === 'ai.prompts.outlineVoicePersona') return 'persona-stub';
        if (key === 'voice.need_asr_keys') return 'need-asr-keys';
        if (key === 'voice.need_minimax_key') return 'need-minimax-key';
        if (key === 'voice.config_missing') return 'config-missing';
        if (key === 'publish.voice_no_outline') return 'no-outline-stub';
        if (key === 'publish.voice_parse_failed') return 'parse-failed-stub';
        if (key === 'publish.voice_revised_default') return 'revised-default-stub';
        return key;
      },
    }),
  };
});

import { usePublishOutlineVoiceChat } from '../../src/hooks/usePublishOutlineVoiceChat';

const FULL_AI_CONFIG = {
  provider: 'openai' as const,
  apiKey: 'k',
  baseUrl: 'https://example',
  model: 'm',
  volcAsrApiKey: 'asr',
  minimaxApiKey: 'mm',
  minimaxTtsModel: 'tm',
  minimaxVoiceId: 'tv',
};

beforeEach(() => {
  micStop.mockClear();
  micStop.mockResolvedValue(undefined);
  startMicCapture.mockClear();
  openVolcAsrSession.mockClear();
  hasVolcAsrCredentials.mockClear();
  hasVolcAsrCredentials.mockReturnValue(true);
  for (const k of Object.keys(asrHandlers)) delete (asrHandlers as Record<string, unknown>)[k];
  Object.values(asrSession).forEach((fn) => (fn as { mockClear: () => void }).mockClear());
  ttsPushAccumulated.mockClear();
  ttsFlush.mockClear();
  ttsWaitUntilIdle.mockClear();
  ttsStop.mockClear();
  ttsSpeakingChangeHandlers.length = 0;
  ttsErrorHandlers.length = 0;
  createTtsSentenceQueue.mockClear();
  callUniversalAI.mockClear();
  callUniversalAI.mockImplementation(async (args: { onStreamChunk?: (acc: string) => void }) => {
    args.onStreamChunk?.('partial');
    return JSON.stringify({
      summary: 'ai-summary',
      outline: { title: 'A', sections: [{ cardId: 'n1', heading: 'H', summary: 'S' }] },
    });
  });
});

function wrap({ children }: { children: React.ReactNode }) {
  return React.createElement(AppDialogProvider, null, children);
}

type Outline = Parameters<typeof usePublishOutlineVoiceChat>[0]['outline'];

function renderChat(
  options: {
    aiConfig?: typeof FULL_AI_CONFIG | null;
    outline?: Outline;
    disabled?: boolean;
    onOutlineRevised?: (o: NonNullable<Outline>) => void;
  } = {},
) {
  const initialProps = {
    aiConfig: options.aiConfig === undefined ? FULL_AI_CONFIG : options.aiConfig,
    outline: options.outline ?? { title: 'init', sections: [{ cardId: 'n1', heading: 'init-h', summary: '' }] },
    onOutlineRevised: options.onOutlineRevised ?? vi.fn(),
    disabled: options.disabled,
  };
  return renderHook(
    ({ aiConfig, outline, onOutlineRevised, disabled }: typeof initialProps) =>
      usePublishOutlineVoiceChat({ aiConfig, outline, onOutlineRevised, disabled }),
    { wrapper: wrap, initialProps },
  );
}

async function flushMicrotasks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('usePublishOutlineVoiceChat — toggle / stop lifecycle', () => {
  it('第一次 toggle 启动 ASR，第二次 toggle 中断并 stop', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(true);
    expect(openVolcAsrSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
    expect(micStop).toHaveBeenCalled();
    expect(asrSession.close).toHaveBeenCalled();
  });

  it('disabled=true 时 toggle 直接 no-op', async () => {
    const { result } = renderChat({ disabled: true });
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
    expect(openVolcAsrSession).not.toHaveBeenCalled();
  });

  it('disabled 由 false 翻 true 时正在进行的 session 自动 stop', async () => {
    const initialProps = {
      aiConfig: FULL_AI_CONFIG as typeof FULL_AI_CONFIG | null,
      outline: { title: 'init', sections: [{ cardId: 'n1', heading: 'h', summary: '' }] },
      onOutlineRevised: vi.fn(),
      disabled: undefined as boolean | undefined,
    };
    const { result, rerender } = renderHook(
      ({ aiConfig, outline, onOutlineRevised, disabled }: typeof initialProps) =>
        usePublishOutlineVoiceChat({ aiConfig, outline, onOutlineRevised, disabled }),
      { wrapper: wrap, initialProps },
    );
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(true);
    rerender({ ...initialProps, disabled: true });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
  });

  it('toggle 启动链（ASR→mic）抛出时回滚到 idle，不残留 active=true', async () => {
    startMicCapture.mockRejectedValueOnce(new Error('mic permission denied'));
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.phase).toBe('idle');
  });
});

describe('usePublishOutlineVoiceChat — partial/definite transcript', () => {
  // Volc ASR result_type=full 下每一帧都发累积全文，partialTranscript 每次替换而非追加
  it('连续 onPartial 把 partialTranscript 替换成最新累积全文', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    await act(async () => {
      asrHandlers.onPartial?.('你好');
      asrHandlers.onPartial?.('你好 我想');
      asrHandlers.onPartial?.('你好 我想 合并');
      await flushMicrotasks();
    });
    expect(result.current.partialTranscript).toBe('你好 我想 合并');
  });

  it('onDefinite 之后的 onPartial 不会回退到旧的累积', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    await act(async () => {
      asrHandlers.onDefinite?.('committed line');
      asrHandlers.onPartial?.('committed line + pending tail');
      await flushMicrotasks();
    });
    expect(result.current.partialTranscript).toBe('committed line + pending tail');
  });

  it('stop() 清空 partialTranscript', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
      asrHandlers.onPartial?.('something');
      await flushMicrotasks();
    });
    expect(result.current.partialTranscript).not.toBe('');
    await act(async () => {
      result.current.stop();
      await flushMicrotasks();
    });
    expect(result.current.partialTranscript).toBe('');
  });
});

describe('usePublishOutlineVoiceChat — phase state machine', () => {
  it('idle → listening（toggle 启动后）→ idle（stop 后）', async () => {
    const { result } = renderChat();
    expect(result.current.phase).toBe('idle');
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.phase).toBe('listening');
    await act(async () => {
      result.current.stop();
      await flushMicrotasks();
    });
    expect(result.current.phase).toBe('idle');
  });

  it('AI 跑题阶段会经过 thinking → speaking（mock 推 onSpeakingChange(true)）', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
      asrHandlers.onDefinite?.('hi');
      await flushMicrotasks();
      await result.current.toggle();
      await flushMicrotasks();
    });
    // createTtsSentenceQueue 在 AI turn 中被建立，注册 onSpeakingChange
    expect(createTtsSentenceQueue).toHaveBeenCalled();
    expect(ttsSpeakingChangeHandlers.length).toBeGreaterThan(0);
    // 模拟 TTS 服务开始朗读 → 推进到 speaking
    act(() => {
      ttsSpeakingChangeHandlers[0]?.(true);
    });
    expect(result.current.phase).toBe('speaking');
  });
});

describe('usePublishOutlineVoiceChat — AI turn & outline 修订', () => {
  it('toggle 后 AI 返回合法 {summary, outline} JSON → 触发 onOutlineRevised 并朗读 summary', async () => {
    const onOutlineRevised = vi.fn();
    callUniversalAI.mockReset();
    callUniversalAI.mockResolvedValueOnce(
      JSON.stringify({
        summary: '已合并第一节与第二节',
        outline: {
          title: '合并后标题',
          sections: [{ cardId: 'n1', heading: '合并段', summary: '共用论点' }],
        },
      }),
    );
    const { result } = renderChat({ onOutlineRevised });
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
      asrHandlers.onDefinite?.('帮我合并一二节');
      await flushMicrotasks();
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(onOutlineRevised).toHaveBeenCalledWith({
      title: '合并后标题',
      sections: [{ cardId: 'n1', heading: '合并段', summary: '共用论点' }],
    });
    expect(ttsPushAccumulated).toHaveBeenCalledWith('已合并第一节与第二节');
  });

  it('AI 返回纯文本（无 JSON）→ 不污染 outline、走 parse_failed 兜底朗读', async () => {
    const onOutlineRevised = vi.fn();
    callUniversalAI.mockReset();
    callUniversalAI.mockResolvedValueOnce('我只是普通文本，没有结构化字段');
    const { result } = renderChat({ onOutlineRevised });
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
      asrHandlers.onDefinite?.('重构大纲');
      await flushMicrotasks();
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(onOutlineRevised).not.toHaveBeenCalled();
    expect(ttsPushAccumulated).toHaveBeenCalledWith('parse-failed-stub');
  });

  it('AI 抛错时 assistant bubble 文本用 formatAiError 后回填', async () => {
    callUniversalAI.mockReset();
    callUniversalAI.mockImplementationOnce(async () => {
      throw new Error('upstream down');
    });
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
      asrHandlers.onDefinite?.('hi');
      await flushMicrotasks();
      await result.current.toggle();
      await flushMicrotasks();
    });
    const lastAssistant = [...result.current.messages].reverse().find((m) => m.role === 'assistant');
    expect(lastAssistant?.text).toBe('upstream down');
  });

  it('用户消息在 assistant 消息之前（顺序）', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
      asrHandlers.onDefinite?.('hi');
      await flushMicrotasks();
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.messages[0]?.role).toBe('user');
    expect(result.current.messages[1]?.role).toBe('assistant');
    expect(result.current.messages[0]?.text).toBe('hi');
  });
});
