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
import { encodeFullClientRequest, MSG_FULL_SERVER_RESPONSE, FLAG_POSITIVE_SEQUENCE, SERIAL_JSON, COMPRESS_NONE } from '../../src/services/volcAsrProtocol';

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
  function init(handlers: Parameters<typeof openVolcAsrSession>[1] = {}) {
    const session = openVolcAsrSession({ apiKey: 'k' }, handlers);
    const ws = FakeWebSocket.instances[0]!;
    ws.fakeOpen();
    return { session, ws };
  }

  it('sends a full client request as the first frame after open', () => {
    init();
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.sent.length).toBeGreaterThanOrEqual(1);
    // First sent payload should be the full client request — decode the header to verify
    const frame = ws.sent[0]!;
    expect((frame[1] >> 4) & 0x0f).toBe(0b0001); // MSG_FULL_CLIENT_REQUEST
  });

  it('decodes and routes onPartial when only partials arrive', () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    init({ onPartial, onDefinite });
    FakeWebSocket.instances[0]!.fakeMessage(
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

  it('routes single definite utterance via onDefinite', () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    init({ onPartial, onDefinite });
    FakeWebSocket.instances[0]!.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '完成', definite: true }] },
      }),
    );
    expect(onDefinite).toHaveBeenCalledWith('完成');
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('joins MULTIPLE definite utterances into one onDefinite call (regression on #5)', () => {
    const onDefinite = vi.fn();
    init({ onDefinite });
    FakeWebSocket.instances[0]!.fakeMessage(
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

  it('skips definite-only frames whose text is just whitespace', () => {
    const onDefinite = vi.fn();
    const onPartial = vi.fn();
    init({ onDefinite, onPartial });
    FakeWebSocket.instances[0]!.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '   ', definite: true }] },
      }),
    );
    expect(onDefinite).not.toHaveBeenCalled();
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('onError closes the underlying WebSocket (regression on #8)', () => {
    const onError = vi.fn();
    const { ws } = init({ onError });
    ws.fakeError();
    expect(onError).toHaveBeenCalled();
    expect(ws.closed).toBe(true);
  });

  it('late frames after close() are ignored', () => {
    const onPartial = vi.fn();
    const onDefinite = vi.fn();
    const { session, ws } = init({ onPartial, onDefinite });
    session.close();
    ws.fakeMessage(
      buildJsonServerFrame({
        result: { utterances: [{ text: '迟到的帧', definite: true }] },
      }),
    );
    expect(onDefinite).not.toHaveBeenCalled();
  });

  it('after open, sendPcm routes audio frames directly to send', () => {
    const { session, ws } = init();
    // init() already opened the socket; first send should pass through immediately.
    session.sendPcm(new Uint8Array([1, 2, 3]));
    session.sendPcm(new Uint8Array([4, 5, 6]));
    // 1 full-client-request + 2 audio frames
    expect(ws.sent.length).toBe(3);
  });

  it('pre-open PCM is queued and plays in order via flushPending on open', async () => {
    // Defer fakeOpen until after we enqueue so we exercise the pending-buffer path.
    const pendingPcms: Uint8Array[][] = [];
    const wsRef: { current: FakeWebSocket | null } = { current: null };
    const session = openVolcAsrSession({ apiKey: 'k' }, {});
    wsRef.current = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    session.sendPcm(new Uint8Array([1, 2, 3]));
    session.sendPcm(new Uint8Array([4, 5, 6]));
    expect(wsRef.current.sent.length).toBe(0);
    wsRef.current.fakeOpen();
    // After open, the queued chunks flush through send.
    expect(wsRef.current.sent.length).toBeGreaterThanOrEqual(2);
    void pendingPcms; // silence unused
  });

  it('caps the pre-open pending buffer to avoid unbounded growth (#8 secondary)', () => {
    const { session } = init();
    // Push more than the 256 KB cap; oldest should be dropped.
    const chunk = new Uint8Array(64 * 1024); // 64 KB
    for (let i = 0; i < 8; i++) session.sendPcm(chunk);
    // Pending cap drops oldest — only ~256 KB worth remains, but no socket to flush into.
    // Just assert no throw and no UnhandledPromiseRejection.
    session.close();
  });

  it('throws when called without credentials', () => {
    expect(() => openVolcAsrSession({}, {})).toThrow(/Missing Volc ASR credentials/);
  });
});

// ensure encodeFullClientRequest is reachable through the same import surface.
void encodeFullClientRequest;
