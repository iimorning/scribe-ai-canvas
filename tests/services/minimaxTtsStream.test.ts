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
});
