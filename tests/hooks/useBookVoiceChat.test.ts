import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';

// ------- Service mocks (vi.hoisted so vi.mock factories can reference them) --------
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
const openVolcAsrSession = vi.fn(async (_creds?: unknown) => {
  return asrSession;
});
const hasVolcAsrCredentials = vi.fn(() => true);

const ttsPushAccumulated = vi.fn();
const ttsFlush = vi.fn();
const ttsWaitUntilIdle = vi.fn(async () => undefined);
const ttsStop = vi.fn();
const ttsSpeakingChangeHandlers: Array<(s: boolean) => void> = [];
const ttsErrorHandlers: Array<(msg: string) => void> = [];
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
  args.onStreamChunk?.('hello');
  return 'AI reply text';
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
        if (key === 'ai.prompts.bookVoiceUser') {
          return `ctx.source=${opts?.source} | pageText=${opts?.pageText} | history=${opts?.history} | request=${opts?.request}`;
        }
        if (key === 'ai.prompts.bookVoicePersona') return 'persona-stub';
        if (key === 'voice.need_asr_keys') return 'need-asr-keys';
        if (key === 'voice.need_minimax_key') return 'need-minimax-key';
        if (key === 'voice.config_missing') return 'config-missing';
        return key;
      },
    }),
  };
});

import { useBookVoiceChat } from '../../src/hooks/useBookVoiceChat';

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
  asrSession.close.mockReset();
  asrSession.close.mockImplementation(() => undefined);
  ttsPushAccumulated.mockClear();
  ttsFlush.mockClear();
  ttsWaitUntilIdle.mockClear();
  ttsStop.mockClear();
  ttsSpeakingChangeHandlers.length = 0;
  ttsErrorHandlers.length = 0;
  createTtsSentenceQueue.mockClear();
  callUniversalAI.mockClear();
  callUniversalAI.mockImplementation(async (args: { onStreamChunk?: (acc: string) => void }) => {
    args.onStreamChunk?.('hello');
    return 'AI reply text';
  });
});

function wrap({ children }: { children: React.ReactNode }) {
  return React.createElement(AppDialogProvider, null, children);
}

function renderChat(
  options: {
    aiConfig?: typeof FULL_AI_CONFIG | null;
    pageContext?: { text: string; label: string };
    disabled?: boolean;
  } = {},
) {
  const initialProps = {
    aiConfig: options.aiConfig === undefined ? FULL_AI_CONFIG : options.aiConfig,
    pageContext: options.pageContext ?? { text: 'page1', label: 'Demo · Ch1' },
    disabled: options.disabled,
  };
  return renderHook(
    ({ aiConfig, pageContext, disabled }: typeof initialProps) =>
      useBookVoiceChat({ aiConfig, pageContext, disabled }),
    { wrapper: wrap, initialProps },
  );
}

async function flushMicrotasks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('useBookVoiceChat — toggle / stop lifecycle', () => {
  it('starts listening on first toggle and ignores a second tap while still starting', async () => {
    const { result } = renderChat();
    // Two toggles in the same microtask burst; the second should be dropped
    // by the `startingRef` guard before it can flip phase/state.
    await act(async () => {
      const p1 = result.current.toggle();
      const p2 = result.current.toggle();
      await Promise.all([p1, p2]);
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(true);
    expect(startMicCapture).toHaveBeenCalledTimes(1);
    expect(openVolcAsrSession).toHaveBeenCalledTimes(1);
  });

  it('stops the active session when toggle is called after start', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(true);
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
    expect(micStop).toHaveBeenCalled();
    expect(asrSession.close).toHaveBeenCalled();
  });

  it('returns immediately from toggle when disabled', async () => {
    const { result } = renderChat({ disabled: true });
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
    expect(startMicCapture).not.toHaveBeenCalled();
  });
});

describe('useBookVoiceChat — auto-stop & guard', () => {
  it('tears down an active session when `disabled` flips to true', async () => {
    const initialProps = {
      aiConfig: FULL_AI_CONFIG as typeof FULL_AI_CONFIG | null,
      pageContext: { text: 'p', label: 'l' },
      disabled: undefined as boolean | undefined,
    };
    const { result, rerender } = renderHook(
      ({ aiConfig, pageContext, disabled }: typeof initialProps) =>
        useBookVoiceChat({ aiConfig, pageContext, disabled }),
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
    expect(micStop).toHaveBeenCalled();
    expect(asrSession.close).toHaveBeenCalled();
  });

  it('tears down an active session when `aiConfig` becomes null', async () => {
    const initialProps = {
      aiConfig: FULL_AI_CONFIG as typeof FULL_AI_CONFIG | null,
      pageContext: { text: 'p', label: 'l' },
      disabled: undefined as boolean | undefined,
    };
    const { result, rerender } = renderHook(
      ({ aiConfig, pageContext, disabled }: typeof initialProps) =>
        useBookVoiceChat({ aiConfig, pageContext, disabled }),
      { wrapper: wrap, initialProps },
    );
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(true);
    rerender({ ...initialProps, aiConfig: null });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
  });

  it('shows an alert and bails when ASR credentials are missing', async () => {
    hasVolcAsrCredentials.mockReturnValue(false);
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
    expect(startMicCapture).not.toHaveBeenCalled();
    expect(openVolcAsrSession).not.toHaveBeenCalled();
  });

  it('shows an alert and bails when MiniMax TTS key is missing', async () => {
    const { result } = renderChat({
      aiConfig: { ...FULL_AI_CONFIG, minimaxApiKey: '' },
    });
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
    expect(startMicCapture).not.toHaveBeenCalled();
  });

  it('stops the session when ASR fires onError mid-listening', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(true);
    await act(async () => {
      asrHandlers.onError?.('boom');
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
    expect(micStop).toHaveBeenCalled();
  });

  it('stops the session when ASR fires onClose mid-listening', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(true);
    await act(async () => {
      asrHandlers.onClose?.();
      await flushMicrotasks();
    });
    expect(result.current.active).toBe(false);
  });
});

describe('useBookVoiceChat — partial transcripts', () => {
  // Volc ASR result_type=full 下：onPartial / onDefinite 都发送累积全文（整段当前识别结果），
  // 所以 partialTranscript 每次都被最新一帧替换，而不是在 hook 内累积。
  it('consecutive onPartial frames replace partialTranscript with the latest cumulative text', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    await act(async () => {
      asrHandlers.onPartial?.('first');
      asrHandlers.onPartial?.('first second');
      asrHandlers.onPartial?.('first second third');
      await flushMicrotasks();
    });
    expect(result.current.partialTranscript).toBe('first second third');
  });

  it('onDefinite replaces partialTranscript (treated as the latest committed cumulative)', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    await act(async () => {
      asrHandlers.onDefinite?.('first');
      asrHandlers.onDefinite?.('first second');
      await flushMicrotasks();
    });
    expect(result.current.partialTranscript).toBe('first second');
  });

  it('onDefinite 之后再 onPartial 不会回退到旧值', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    await act(async () => {
      asrHandlers.onDefinite?.('committed-line');
      asrHandlers.onPartial?.('committed-line pending-tail');
      await flushMicrotasks();
    });
    expect(result.current.partialTranscript).toBe('committed-line pending-tail');
  });

  it('clears partialTranscript on stop()', async () => {
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

describe('useBookVoiceChat — AI turn', () => {
  it('toggle during listening runs the AI turn with the transcript', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    await act(async () => {
      asrHandlers.onDefinite?.('user question');
      await flushMicrotasks();
    });
    callUniversalAI.mockClear();
    await act(async () => {
      // Single toggle while listening + ASR accumulated = should trigger AI turn.
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(callUniversalAI).toHaveBeenCalled();
    const arg = callUniversalAI.mock.calls[0]?.[0] as { prompt?: string; systemInstruction?: string };
    expect(arg.prompt).toContain('user question');
    expect(arg.prompt).toContain('page1');
    expect(arg.systemInstruction).toContain('persona-stub');
    // After AI reply, TTS queue is created once and consumes the streamed chunk.
    expect(createTtsSentenceQueue).toHaveBeenCalled();
  });

  it('records user + assistant messages in order on a successful turn', async () => {
    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
      asrHandlers.onDefinite?.('hi');
      await flushMicrotasks();
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(result.current.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.current.messages[0]?.role).toBe('user');
    expect(result.current.messages[1]?.role).toBe('assistant');
  });

  it('records the formatted error text in the assistant bubble when callUniversalAI throws', async () => {
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

  it('auto-submits after silence following ASR text (no second mic tap)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderChat();
      await act(async () => {
        await result.current.toggle();
        await flushMicrotasks();
      });
      callUniversalAI.mockClear();
      await act(async () => {
        asrHandlers.onDefinite?.('自动接话');
        await flushMicrotasks();
      });
      expect(callUniversalAI).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400);
        await flushMicrotasks();
      });
      expect(callUniversalAI).toHaveBeenCalled();
      const arg = callUniversalAI.mock.calls[0]?.[0] as { prompt?: string };
      expect(arg.prompt).toContain('自动接话');
    } finally {
      vi.useRealTimers();
    }
  });

  it('async ASR onClose after finishRound does not wipe transcript / abort the AI turn', async () => {
    // Real Volc close fires ws.onclose on a later tick — must not call stop().
    asrSession.close.mockImplementation(() => {
      queueMicrotask(() => {
        asrHandlers.onClose?.();
      });
    });

    const { result } = renderChat();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
      asrHandlers.onDefinite?.('还在吗');
      await flushMicrotasks();
    });
    callUniversalAI.mockClear();
    await act(async () => {
      await result.current.toggle();
      await flushMicrotasks();
    });
    expect(callUniversalAI).toHaveBeenCalled();
    const arg = callUniversalAI.mock.calls[0]?.[0] as { prompt?: string };
    expect(arg.prompt).toContain('还在吗');
    // Session stays active through the AI turn (mic only "closes" for listening).
    expect(result.current.active).toBe(true);
  });
});
