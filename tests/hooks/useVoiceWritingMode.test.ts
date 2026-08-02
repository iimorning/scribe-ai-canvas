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
const openVolcAsrSession = vi.fn(() => asrSession);
const hasVolcAsrCredentials = vi.fn(() => true);

const enterFullscreenMock = vi.fn();
const exitFullscreenMock = vi.fn();
const setStreamingAiNodeIdMock = vi.fn();
const setCanvasTransformMock = vi.fn();

const callUniversalAIMock = vi.fn(async () => 'AI reply');

vi.mock('../../src/services/micCapture', () => ({
  startMicCapture: () => startMicCapture(),
}));
vi.mock('../../src/services/volcAsr', () => ({
  openVolcAsrSession: () => openVolcAsrSession(),
  hasVolcAsrCredentials: () => hasVolcAsrCredentials(),
}));
vi.mock('../../src/db', () => ({
  db: {
    nodes: {
      add: vi.fn(async (n: { id: string }) => n.id),
      update: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
    },
    edges: {
      add: vi.fn(async (e: { id: string }) => e.id),
      delete: vi.fn(async () => undefined),
    },
  },
}));
vi.mock('../../src/services/ai', () => ({
  callUniversalAI: () => callUniversalAIMock(),
  formatAiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../src/utils/canvasStreamingAi', () => ({
  runCanvasStreamingAiCall: vi.fn(async ({ callAi }: { callAi: (cb: (s: string) => void) => Promise<void> | void }) => {
    await callAi('hello');
    return 'AI reply';
  }),
}));
vi.mock('../../src/utils/voiceNoteLayout', () => ({
  nextVoiceNotePosition: (anchor: { x: number; y: number }) => ({ x: anchor.x + 10, y: anchor.y }),
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
});

async function renderVoiceHook() {
  const { useVoiceWritingMode } = await import('../../src/hooks/useVoiceWritingMode');
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    return React.createElement(AppDialogProvider, null, children);
  };
  return renderHook(
    () =>
      useVoiceWritingMode({
        aiConfig: {
          provider: 'openai' as const,
          volcAsrApiKey: 'asr',
          minimaxApiKey: 'm',
        } as any,
        activeCanvasId: 'c1',
        transformRef: { current: { x: 0, y: 0, scale: 1 } } as any,
        setCanvasTransform: setCanvasTransformMock,
        editingNodeId: null,
        setStreamingAiNodeId: setStreamingAiNodeIdMock,
        enterFullscreen: enterFullscreenMock,
        exitFullscreen: exitFullscreenMock,
        isAnyAiBusy: false,
      }),
    { wrapper: Wrapper },
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
});
