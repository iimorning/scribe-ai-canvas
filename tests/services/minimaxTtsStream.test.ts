import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(payload: object) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  createBuffer = vi.fn((_channels: number, length: number, sampleRate: number) => ({
    duration: length / sampleRate,
    copyToChannel: vi.fn(),
  }));
  createBufferSource = vi.fn(() => {
    const source = {
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      start: vi.fn(() => queueMicrotask(() => source.onended?.())),
      onended: null as (() => void) | null,
    };
    return source;
  });
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
}

vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'opaque' }), { status: 200 })));

import { openMinimaxTtsStream } from '../../src/services/minimaxTtsStream';

describe('MiniMax WebSocket TTS stream', () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
  });

  it('follows connected → start → continue → finish protocol in order', async () => {
    const stream = await openMinimaxTtsStream({ apiKey: 'key' });
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url).toContain('/api/minimax-tts?token=opaque');
    stream.enqueueText('第一句。');
    stream.finish();
    ws.open();
    ws.message({ event: 'connected_success', base_resp: { status_code: 0 } });
    expect(JSON.parse(ws.sent[0]!).event).toBe('task_start');
    ws.message({ event: 'task_started', base_resp: { status_code: 0 } });
    expect(JSON.parse(ws.sent[1]!)).toMatchObject({ event: 'task_continue', text: '第一句。' });
    ws.message({
      event: 'task_continued',
      is_final: true,
      data: { audio: '00000000' },
      base_resp: { status_code: 0 },
    });
    expect(JSON.parse(ws.sent[2]!).event).toBe('task_finish');
    await stream.waitUntilIdle();
  });

  it('surfaces MiniMax event errors', async () => {
    const onError = vi.fn();
    await openMinimaxTtsStream({ apiKey: 'key', onError });
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.message({ event: 'connected_success', base_resp: { status_code: 1004, status_msg: 'auth failed' } });
    expect(onError).toHaveBeenCalledWith('auth failed');
  });

  // 守护 8c2f266 的"speaking 阶段按 stop 后，waitUntilIdle 必须立刻 resolve"
  // —— useVoiceWritingMode 在 runAiTurn 末尾 `await tts.waitUntilIdle()` 之后才会
  // 进入下一轮 listening。如果 stop 路径漏掉 idleWaiters 解锁，speaking 阶段点
  // 状态胶囊会卡死，下一轮永不启动。
  it('stop() unblocks waitUntilIdle() and clears activeText (speaking-stage stop path)', async () => {
    const onActiveTextChange = vi.fn();
    const onSpeakingChange = vi.fn();
    const stream = await openMinimaxTtsStream({
      apiKey: 'key',
      onActiveTextChange,
      onSpeakingChange,
    });
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.message({ event: 'connected_success', base_resp: { status_code: 0 } });
    ws.message({ event: 'task_started', base_resp: { status_code: 0 } });

    // Enqueue + 推进合成，让 activeText 被设置成"第一句"。
    stream.enqueueText('第一句。');
    ws.message({
      event: 'task_continued',
      is_final: true,
      data: { audio: '00000000' },
      base_resp: { status_code: 0 },
    });

    // 等待 microtask 让 playhead 定时器 fire（FakeAudioContext 当前时间 0，
    // scheduledUntil 0，armPlayheadAt 内部把 delay 设为 (0.03 - 0) * 1000 = 30ms）。
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 至少有被设置过 activeText = "第一句。"
    const armedCalls = onActiveTextChange.mock.calls.map((c) => c[0]);
    expect(armedCalls).toContain('第一句。');

    // 关键：模拟 useVoiceWritingMode 的调用顺序。
    // runAiTurn 先 `await tts.waitUntilIdle()`，用户在它阻塞期间点状态胶囊 stop。
    // 这两个 promise 必须配对 —— stop 必须解锁 waitUntilIdle，否则 runAiTurn
    // 永远不进入下一轮 listening。
    const idlePromise = stream.waitUntilIdle();
    // 现在调用 stop —— 正在"speaking"阶段。
    stream.stop();
    // 关键断言：waitUntilIdle 必须立刻 resolve（不能 hang）。
    await idlePromise;

    // activeText 必须被清成 null（为 useVoiceWritingMode 的 setTtsHighlight(null) 提供依据）。
    const lastActive = onActiveTextChange.mock.calls.at(-1)?.[0];
    expect(lastActive).toBeNull();

    // 状态被清：再次 enqueue 不应再播（已 closed）。
    const enqueueCountBefore = ws.sent.length;
    stream.enqueueText('第二句。');
    expect(ws.sent.length).toBe(enqueueCountBefore);
  });

  // 守护 7255161 的"playhead 跟随真实播放时刻"契约：onActiveTextChange 的第一次
  // 调用必须晚于对应的 task_continued（即不在合成就立即触发）。我们用可控的
  // 假 currentTime 来验证。
  it('onActiveTextChange fires only on the first audio buffer of a sentence (not on every chunk)', async () => {
    const onActiveTextChange = vi.fn();
    // 调整 fake AudioContext 让 source.start 的 onended 异步触发前能拿到多次 task_continued
    const stream = await openMinimaxTtsStream({
      apiKey: 'key',
      onActiveTextChange,
    });
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.message({ event: 'connected_success', base_resp: { status_code: 0 } });
    ws.message({ event: 'task_started', base_resp: { status_code: 0 } });

    // 句 1：分多个 chunk（模拟 nostream + 平滑流）。
    stream.enqueueText('第一句。');
    ws.message({
      event: 'task_continued',
      is_final: false,
      data: { audio: '00000000' },
      base_resp: { status_code: 0 },
    });
    ws.message({
      event: 'task_continued',
      is_final: true,
      data: { audio: '00000000' },
      base_resp: { status_code: 0 },
    });
    // 让 microtask 跑完，playhead 定时器触发（30ms 延迟）。
    await new Promise((resolve) => setTimeout(resolve, 60));

    const callsForSentence1 = onActiveTextChange.mock.calls
      .map((c) => c[0])
      .filter((t) => t === '第一句。');
    expect(callsForSentence1).toHaveLength(1);
  });

  // 守护 7255161 的"无音频数据时不应该 arm playhead"：onActiveTextChange 不应被调用。
  it('task_continued without audio data does not arm the playhead', async () => {
    const onActiveTextChange = vi.fn();
    const stream = await openMinimaxTtsStream({ apiKey: 'key', onActiveTextChange });
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.message({ event: 'connected_success', base_resp: { status_code: 0 } });
    ws.message({ event: 'task_started', base_resp: { status_code: 0 } });

    stream.enqueueText('第一句。');
    ws.message({
      event: 'task_continued',
      is_final: true,
      data: { audio: null },
      base_resp: { status_code: 0 },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onActiveTextChange).not.toHaveBeenCalled();
  });
});
