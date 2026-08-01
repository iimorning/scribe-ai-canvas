import { describe, it, expect, vi, beforeEach } from 'vitest';

const streamMocks = vi.hoisted(() => {
  const enqueueText = vi.fn();
  const finish = vi.fn();
  const stop = vi.fn();
  const waitUntilIdle = vi.fn(async () => {});
  const openMinimaxTtsStream = vi.fn(async () => ({
    enqueueText,
    finish,
    stop,
    waitUntilIdle,
  }));
  return { enqueueText, finish, stop, waitUntilIdle, openMinimaxTtsStream };
});

vi.mock('../../src/services/minimaxTtsStream', () => ({ openMinimaxTtsStream: streamMocks.openMinimaxTtsStream }));

import { createTtsSentenceQueue } from '../../src/utils/ttsSentenceQueue';

describe('ttsSentenceQueue', () => {
  beforeEach(() => {
    streamMocks.enqueueText.mockClear();
    streamMocks.finish.mockClear();
    streamMocks.stop.mockClear();
    streamMocks.waitUntilIdle.mockClear();
    streamMocks.openMinimaxTtsStream.mockClear();
  });

  it('cuts at Chinese period and enqueues one chunk', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('你好世界。');
    queue.flush();
    await queue.waitUntilIdle();
    expect(streamMocks.enqueueText).toHaveBeenCalledWith('你好世界。');
  });

  it('cuts at multiple Chinese terminators within one accumulated string', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('第一句。第二句！第三句？');
    queue.flush();
    await queue.waitUntilIdle();
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
    expect(texts).toEqual(['第一句。', '第二句！', '第三句？']);
  });

  it('keeps the unfinished tail as carry and emits after flush()', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('半句话');
    expect(streamMocks.enqueueText).not.toHaveBeenCalled();
    queue.pushAccumulatedText('半句话还没结束。');
    queue.flush();
    await queue.waitUntilIdle();
    expect(streamMocks.enqueueText).toHaveBeenCalledWith('半句话还没结束。');
  });

  it('does not double-count carry when an unfinished tail is extended', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('前缀YY');
    queue.pushAccumulatedText('前缀YYY。下一句。');
    queue.flush();
    await queue.waitUntilIdle();
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
    expect(texts).toEqual(['前缀YYY。', '下一句。']);
  });

  it('flush() forces the carried tail out', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('只有半句话');
    expect(streamMocks.enqueueText).not.toHaveBeenCalled();
    queue.flush();
    await queue.waitUntilIdle();
    expect(streamMocks.enqueueText).toHaveBeenCalledWith('只有半句话');
  });

  it('monotonic extension only synthesizes the delta (no duplicates) — regression on #4', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('你好。');
    queue.pushAccumulatedText('你好。今天怎样？');
    queue.pushAccumulatedText('你好。今天怎样？我很好。');
    queue.flush();
    await queue.waitUntilIdle();
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
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
    queue.flush();
    await queue.waitUntilIdle();
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
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
    queue.flush();
    await queue.waitUntilIdle();
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
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
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
    expect(texts).not.toContain('第二句。');
    expect(onError).not.toHaveBeenCalled();
  });

  it('long multi-sentence stream with inter-sentence SPACES does not scramble', async () => {
    // Real MiniMax voice replies separate sentences with spaces. Streaming them in
    // chunks must produce exactly each sentence once, in order — no repeats, no drops.
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    const full = '第一句。 第二句。 第三句。 第四句。 第五句。';
    // Stream in awkward chunk boundaries that cut through spaces and sentences.
    const chunks = [
      '第一句。 第',
      '第一句。 第二句。 第',
      '第一句。 第二句。 第三句。 ',
      '第一句。 第二句。 第三句。 第四句。 第五',
      full,
    ];
    for (const c of chunks) queue.pushAccumulatedText(c);
    queue.flush();
    await queue.waitUntilIdle();
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
    expect(texts).toEqual(['第一句。', '第二句。', '第三句。', '第四句。', '第五句。']);
  });

  it('thinking block + spaced sentences + renormalized chunks = clean order, no scramble', async () => {
    const TO = '<think>';
    const TC = '</think>';
    const answer = '第一句。 第二句。 第三句。 第四句。';
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    const chunks = [
      TO + '让我想',
      TO + '让我想想怎么回答。' + TC + '第一句。 第',
      TO + '让我想想怎么回答。' + TC + '第一句。 第二句。 第三句。 第',
      TO + '让我想想怎么回答。' + TC + answer,
    ];
    for (const c of chunks) queue.pushAccumulatedText(c);
    queue.flush();
    await queue.waitUntilIdle();
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
    expect(texts).toEqual(['第一句。', '第二句。', '第三句。', '第四句。']);
    // No thinking content, no repeats.
    expect(texts.some((t) => t.includes('想想'))).toBe(false);
  });

  it('English sentence-end punctuation cuts when present', async () => {
    const queue = createTtsSentenceQueue({ apiKey: 'k' });
    queue.pushAccumulatedText('Hello there! How are you?');
    queue.flush();
    await queue.waitUntilIdle();
    const texts = streamMocks.enqueueText.mock.calls.map((c) => c[0] as string);
    // Both ! and ? are sentence terminators.
    expect(texts.length).toBe(2);
    expect(texts[0]).toMatch(/^Hello there!$/);
    expect(texts[1]).toMatch(/^How are you\?$/);
  });
});
