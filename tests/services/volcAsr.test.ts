import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake WebSocket — capture handlers so tests can drive open/message/error/close.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  binaryType: BinaryType = 'arraybuffer';
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sent: Uint8Array[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  // Helpers used by tests to drive the client.
  fakeOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  fakeMessage(data: string | ArrayBuffer): void {
    this.onmessage?.({ data });
  }
  fakeError(): void {
    this.onerror?.(new Event('error'));
  }
  fakeClose(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close'));
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

import { hasVolcAsrCredentials, openVolcAsrSession } from '../../src/services/volcAsr';
import {
  MSG_FULL_SERVER_RESPONSE,
  FLAG_POSITIVE_SEQUENCE,
  SERIAL_JSON,
  COMPRESS_NONE,
  COMPRESS_GZIP,
} from '../../src/services/volcAsrProtocol';

function buildJsonServerFrame(json: object): ArrayBuffer {
  const payload = new TextEncoder().encode(JSON.stringify(json));
  const header = new Uint8Array(4);
  header[0] = 0x11;
  header[1] = (MSG_FULL_SERVER_RESPONSE << 4) | FLAG_POSITIVE_SEQUENCE;
  header[2] = (SERIAL_JSON << 4) | COMPRESS_NONE;
  header[3] = 0;
  const seq = new Uint8Array(4);
  new DataView(seq.buffer).setInt32(0, 1, false);
  const lenBytes = new Uint8Array(4);
  new DataView(lenBytes.buffer).setUint32(0, payload.length, false);
  const out = new Uint8Array(header.length + seq.length + lenBytes.length + payload.length);
  out.set(header, 0);
  out.set(seq, header.length);
  out.set(lenBytes, header.length + seq.length);
  out.set(payload, header.length + seq.length + lenBytes.length);
  return out.buffer;
}

async function flushAsyncWork(): Promise<void> {
  // CompressionStream / write queue settle across micro + macro tasks.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function waitForSent(ws: FakeWebSocket, count: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (ws.sent.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${count} sent frames (have ${ws.sent.length})`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
});

describe('hasVolcAsrCredentials', () => {
  it('rejects empty object', () => {
    expect(hasVolcAsrCredentials({})).toBe(false);
  });

  it('apiKey alone is sufficient', () => {
    expect(hasVolcAsrCredentials({ apiKey: 'k' })).toBe(true);
  });

  it('legacy appId + accessToken pair is required', () => {
    expect(hasVolcAsrCredentials({ appId: 'a' })).toBe(false);
    expect(hasVolcAsrCredentials({ accessToken: 't' })).toBe(false);
    expect(hasVolcAsrCredentials({ appId: 'a', accessToken: 't' })).toBe(true);
  });

  it('trims whitespace before checking', () => {
    expect(hasVolcAsrCredentials({ apiKey: '   ' })).toBe(false);
    expect(hasVolcAsrCredentials({ apiKey: '   k   ' })).toBe(true);
  });
});

describe('openVolcAsrSession', () => {
  async function init(
    handlers: Parameters<typeof openVolcAsrSession>[1] = {},
    opts: Parameters<typeof openVolcAsrSession>[2] = { token: 'preissued-test-token' },
  ) {
    const session = await openVolcAsrSession({ apiKey: 'k' }, handlers, opts);
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    ws.fakeOpen();
    await waitForSent(ws, 1);
    return { session, ws };
  }

  /** Server ACK after full client request — required before audio may be sent. */
  async function ackSession(ws: FakeWebSocket): Promise<void> {
    ws.fakeMessage(
      buildJsonServerFrame({
        result: { text: '', utterances: [] },
      }),
    );
    await flushAsyncWork();
  }

  it('WebSocket URL carries only the opaque token, never the API key', async () => {
    const { ws } = await init();
    const url = new URL(ws.url);
    expect(url.searchParams.get('token')).toBe('preissued-test-token');
    expect(url.searchParams.has('apiKey')).toBe(false);
    expect(url.searchParams.has('appId')).toBe(false);
    expect(url.searchParams.has('accessToken')).toBe(false);
  });

  it('sends a gzip full client request as the first frame after open', async () => {
    const { ws } = await init();
    expect(ws.sent.length).toBe(1);
    const frame = ws.sent[0]!;
    expect((frame[1] >> 4) & 0x0f).toBe(0b0001); // MSG_FULL_CLIENT_REQUEST
    expect(frame[2] & 0x0f).toBe(COMPRESS_GZIP);
  });

  it('does not send audio until the server ACK arrives', async () => {
    const { session, ws } = await init();
    session.sendPcm(new Uint8Array([1, 2, 3]));
    await flushAsyncWork();
    expect(ws.sent.length).toBe(1); // only full client request
    await ackSession(ws);
    await waitForSent(ws, 2);
    expect((ws.sent[1]![1] >> 4) & 0x0f).toBe(0b0010); // MSG_AUDIO_ONLY_REQUEST
  });

  it('decodes and routes onPartial when only partials arrive', async () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    await init({ onPartial, onDefinite });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: {
          text: '',
          utterances: [{ text: '你好', definite: false }],
        },
      }),
    );
    expect(onPartial).toHaveBeenCalledWith('你好');
    expect(onDefinite).not.toHaveBeenCalled();
  });

  it('routes single definite utterance via onDefinite', async () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    await init({ onPartial, onDefinite });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '完成', definite: true }] },
      }),
    );
    expect(onDefinite).toHaveBeenCalledWith('完成');
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('joins MULTIPLE definite utterances into one onDefinite call (regression on #5)', async () => {
    const onDefinite = vi.fn();
    await init({ onDefinite });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: {
          utterances: [
            { text: '第一句。', definite: true },
            { text: '第二句。', definite: true },
          ],
        },
      }),
    );
    expect(onDefinite).toHaveBeenCalledTimes(1);
    expect(onDefinite).toHaveBeenCalledWith(expect.stringContaining('第一句。'));
    expect(onDefinite.mock.calls[0]?.[0]).toContain('第二句。');
  });

  it('skips definite-only frames whose text is just whitespace', async () => {
    const onDefinite = vi.fn();
    const onPartial = vi.fn();
    await init({ onDefinite, onPartial });
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '   ', definite: true }] },
      }),
    );
    expect(onDefinite).not.toHaveBeenCalled();
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('onError closes the underlying WebSocket (regression on #8)', async () => {
    const onError = vi.fn();
    const { ws } = await init({ onError });
    ws.fakeError();
    expect(onError).toHaveBeenCalled();
    expect(ws.closed).toBe(true);
  });

  it('late frames after close() are ignored', async () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    const { session, ws } = await init({ onPartial, onDefinite });
    session.close();
    ws.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '迟到的帧', definite: true }] },
      }),
    );
    expect(onDefinite).not.toHaveBeenCalled();
  });

  it('after ACK, sendPcm routes audio frames to send', async () => {
    const { session, ws } = await init();
    await ackSession(ws);
    const before = ws.sent.length;
    session.sendPcm(new Uint8Array([1, 2, 3]));
    session.sendPcm(new Uint8Array([4, 5, 6]));
    await waitForSent(ws, before + 2);
  });

  it('pre-open PCM is queued and flushes only after open + ACK', async () => {
    const session = await openVolcAsrSession({ apiKey: 'k' }, {}, { token: 'tok' });
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    session.sendPcm(new Uint8Array([1, 2, 3]));
    session.sendPcm(new Uint8Array([4, 5, 6]));
    expect(ws.sent.length).toBe(0);
    ws.fakeOpen();
    await waitForSent(ws, 1);
    expect(ws.sent.length).toBe(1); // full request only
    await ackSession(ws);
    await waitForSent(ws, 3); // full + 2 audio
  });

  it('caps the pre-open pending buffer to avoid unbounded growth (#8 secondary)', async () => {
    const { session } = await init();
    const chunk = new Uint8Array(64 * 1024); // 64 KB
    for (let i = 0; i < 8; i++) session.sendPcm(chunk);
    session.close();
  });

  it('throws when called without credentials', async () => {
    await expect(openVolcAsrSession({}, {})).rejects.toThrow(/Missing Volc ASR credentials/);
  });
});
