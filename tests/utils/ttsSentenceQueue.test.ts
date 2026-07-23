import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock synthesizeMinimaxSpeech so the queue doesn't hit the network.
const synthesizeMinimaxSpeech = vi.fn(async ({ text }: { text: string }) => {
  // Return a different blob per call so the queue can verify call ordering
  // and not double-enqueue.
  return new Blob([new TextEncoder().encode(`mp3:${text}`)], { type: 'audio/mpeg' });
});

vi.mock('../../src/services/minimaxTts', () => ({
  synthesizeMinimaxSpeech: (...args: unknown[]) =>
    (synthesizeMinimaxSpeech as unknown as (...a: unknown[]) => unknown)(...args),
}));

// jsdom's HTMLMediaElement.play() returns a Promise that doesn't resolve without media
// elements. Stub Audio so playBlob's promise can settle deterministically.
class FakeAudio {
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  constructor(src: string) {
    this.src = src;
    queueMicrotask(() => {
      this.onended?.();
    });
  }
  async play(): Promise<void> {
    // onended is fired in the microtask above; play() returns immediately.
    return;
  }
}

vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);

import { createTtsSentenceQueue } from '../../src/utils/ttsSentenceQueue';

describe('ttsSentenceQueue', () => {
  beforeEach(() => {
    synthesizeMinimaxSpeech.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cuts at Chinese period and enqueues one chunk', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('你好世界。');
    await queue.waitUntilIdle();
    expect(synthesizeMinimaxSpeech).toHaveBeenCalledTimes(1);
    expect(synthesizeMinimaxSpeech.mock.calls[0]?.[0]).toMatchObject({ text: '你好世界。' });
  });

  it('cuts at multiple Chinese terminators within one accumulated string', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('第一句。第二句！第三句？');
    await queue.waitUntilIdle();
    expect(synthesizeMinimaxSpeech).toHaveBeenCalledTimes(3);
    const texts = synthesizeMinimaxSpeech.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts).toEqual(['第一句。', '第二句！', '第三句？']);
  });

  it('keeps the unfinished tail as carry and emits after flush()', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('半句话');
    expect(synthesizeMinimaxSpeech).toHaveBeenCalledTimes(0);
    queue.pushAccumulatedText('半句话还没结束。');
    await queue.waitUntilIdle();
    expect(synthesizeMinimaxSpeech).toHaveBeenCalledTimes(1);
    expect(synthesizeMinimaxSpeech.mock.calls[0]?.[0]).toMatchObject({ text: '半句话还没结束。' });
  });

  it('flush() forces the carried tail out', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('只有半句话');
    expect(synthesizeMinimaxSpeech).toHaveBeenCalledTimes(0);
    queue.flush();
    await queue.waitUntilIdle();
    expect(synthesizeMinimaxSpeech).toHaveBeenCalledTimes(1);
    expect(synthesizeMinimaxSpeech.mock.calls[0]?.[0]).toMatchObject({ text: '只有半句话' });
  });

  it('monotonic extension only synthesizes the delta (no duplicates) — regression on #4', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('你好。');
    queue.pushAccumulatedText('你好。今天怎样？');
    queue.pushAccumulatedText('你好。今天怎样？我很好。');
    await queue.waitUntilIdle();
    expect(synthesizeMinimaxSpeech).toHaveBeenCalledTimes(3);
    const texts = synthesizeMinimaxSpeech.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts).toEqual(['你好。', '今天怎样？', '我很好。']);
  });

  it('NON-PREFIX accumulated chunk does NOT re-enqueue prior sentences (the #4 fix)', async () => {
    // The original code reset unsokenCarry and used `newPart = accumulated` (the FULL string)
    // when accumulated didn't start with buffer. With a leading whitespace correction, that
    // caused the prior reply to be replayed.
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('你好。');
    queue.pushAccumulatedText(' 你好。今天怎样？'); // leading whitespace correction
    queue.pushAccumulatedText(' 你好。今天怎样？我很好。');
    await queue.waitUntilIdle();
    const texts = synthesizeMinimaxSpeech.mock.calls.map((c) => (c[0] as { text: string }).text);
    // We expect at most one '你好。' (the first enqueue). Subsequent calls must not duplicate it.
    const helloCount = texts.filter((t) => /^你好[。！?？]?$/.test(t)).length;
    expect(helloCount).toBe(1);
    expect(texts).toContain('今天怎样？');
    expect(texts).toContain('我很好。');
  });

  it('partial correction (LCP drops) does not duplicate the carried prefix', async () => {
    // Model regenerates and shaves one char off the front ("好。" → "好。" edge case).
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('你好。世界。');
    // mid-correction: provider drops the leading "你" but keeps everything after.
    queue.pushAccumulatedText('好。世界。下一步。');
    await queue.waitUntilIdle();
    const texts = synthesizeMinimaxSpeech.mock.calls.map((c) => (c[0] as { text: string }).text);
    // We must not emit "你好。世界。" twice in any form.
    const helloWorld = texts.filter((t) => t.includes('你好。世界')).length;
    expect(helloWorld).toBeLessThanOrEqual(1);
    // And the new tail must make it through.
    expect(texts.some((t) => t.includes('下一步'))).toBe(true);
  });

  it('stop() prevents further enqueues and audio playback', async () => {
    const onError = vi.fn();
    const queue = createTtsSentenceQueue({ apiKey: 'k', onError });
    queue.pushAccumulatedText('第一句。');
    queue.stop();
    // After stop(), pushed texts are dropped and the in-flight pump exits on the next loop iter.
    queue.pushAccumulatedText('第二句。');
    await queue.waitUntilIdle();
    const texts = synthesizeMinimaxSpeech.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts).not.toContain('第二句。');
    expect(onError).not.toHaveBeenCalled();
  });

  it('English sentence-end punctuation cuts when present', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('Hello there! How are you?');
    await queue.waitUntilIdle();
    const texts = synthesizeMinimaxSpeech.mock.calls.map((c) => (c[0] as { text: string }).text);
    // Both ! and ? are sentence terminators.
    expect(texts.length).toBe(2);
    expect(texts[0]).toMatch(/^Hello there!$/);
    expect(texts[1]).toMatch(/^How are you\?$/);
  });
});
