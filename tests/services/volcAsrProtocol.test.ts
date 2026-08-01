import { describe, it, expect } from 'vitest';
import {
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
  parseServerFrame,
  parseServerFrameAsync,
  MSG_FULL_CLIENT_REQUEST,
  MSG_AUDIO_ONLY_REQUEST,
  MSG_FULL_SERVER_RESPONSE,
  MSG_SERVER_ERROR,
  SERIAL_JSON,
  COMPRESS_NONE,
  COMPRESS_GZIP,
  type VolcAsrParseResult,
} from '../../src/services/volcAsrProtocol';

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function be32(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value >>> 0, false);
  return buf;
}

function buildFrame(opts: {
  messageType: number;
  flags: number;
  serialization: number;
  compression?: number;
  payload: Uint8Array;
  seq?: number;
}): Uint8Array {
  const header = new Uint8Array(4);
  // version=1, headerSize=1 (4 bytes)
  header[0] = 0x11;
  header[1] = (opts.messageType << 4) | (opts.flags & 0x0f);
  header[2] = (opts.serialization << 4) | ((opts.compression ?? 0) & 0x0f);
  header[3] = 0;
  const parts: Uint8Array[] = [header];
  if (typeof opts.seq === 'number') {
    const seq = new Uint8Array(4);
    new DataView(seq.buffer).setInt32(0, opts.seq, false);
    parts.push(seq);
  }
  parts.push(be32(opts.payload.length), opts.payload);
  return concat(...parts);
}

describe('volcAsrProtocol', () => {
  describe('encodeFullClientRequest', () => {
    it('emits FLAG_NO_SEQUENCE + SERIAL_JSON + COMPRESS_GZIP', async () => {
      const frame = await encodeFullClientRequest({ hello: 'world' });
      expect(frame[0]).toBe(0x11); // version=1, headerSize=1
      expect((frame[1] >> 4) & 0x0f).toBe(MSG_FULL_CLIENT_REQUEST);
      expect(frame[1] & 0x0f).toBe(0b0000); // FLAG_NO_SEQUENCE
      expect((frame[2] >> 4) & 0x0f).toBe(0b0001); // SERIAL_JSON
      expect(frame[2] & 0x0f).toBe(COMPRESS_GZIP);
    });

    it('writes gzip payload length and inflates back to JSON', async () => {
      const payload = { a: 1 };
      const json = new TextEncoder().encode(JSON.stringify(payload));
      const frame = await encodeFullClientRequest(payload);
      const view = new DataView(frame.buffer);
      const len = view.getUint32(4, false);
      const body = frame.slice(8, 8 + len);
      expect(body.length).toBe(len);
      const { gunzipSync } = await import('node:zlib');
      const inflated = gunzipSync(Buffer.from(body));
      expect(new TextDecoder().decode(inflated)).toBe(new TextDecoder().decode(json));
    });
  });

  describe('encodeAudioOnlyRequest', () => {
    it('normal packet uses FLAG_NO_SEQUENCE + gzip PCM (no seq slot)', async () => {
      const pcm = bytes(0x01, 0x02, 0x03, 0x04);
      const frame = await encodeAudioOnlyRequest(pcm, 7);
      expect((frame[1] >> 4) & 0x0f).toBe(MSG_AUDIO_ONLY_REQUEST);
      expect(frame[1] & 0x0f).toBe(0b0000); // FLAG_NO_SEQUENCE
      expect(frame[2] & 0x0f).toBe(COMPRESS_GZIP);
      const len = new DataView(frame.buffer).getUint32(4, false);
      const body = frame.slice(8, 8 + len);
      const { gunzipSync } = await import('node:zlib');
      expect(Array.from(gunzipSync(Buffer.from(body)))).toEqual([0x01, 0x02, 0x03, 0x04]);
    });

    it('isLast packet uses FLAG_NEG_NO_SEQUENCE without a sequence field', async () => {
      const empty = new Uint8Array(0);
      const frame = await encodeAudioOnlyRequest(empty, 0, true);
      expect(frame[1] & 0x0f).toBe(0b0010); // FLAG_NEG_NO_SEQUENCE
      // header(4) + size(4) + gzip(empty) — no int32 sequence after header
      expect(frame.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('parseServerFrame error paths', () => {
    it('too-short frame returns error', () => {
      const r = parseServerFrame(new Uint8Array([0, 1, 2]).buffer);
      expect(r.errorMessage).toBe('ASR frame too short');
      expect(r.utterances).toEqual([]);
      expect(r.text).toBe('');
    });

    it('missing payload size returns specific error', () => {
      const frame = buildFrame({
        messageType: MSG_FULL_SERVER_RESPONSE,
        flags: 0b0001,
        serialization: 0b0001,
        payload: bytes(0x00),
      });
      // Strip payload size by hand so we have header + seq + 1 byte (no length word)
      const truncated = frame.slice(0, 4 + 4 + 1);
      const r = parseServerFrame(truncated.buffer);
      expect(r.errorMessage).toBe('ASR frame missing payload size');
    });

    it('truncated payload returns specific error', () => {
      const frame = buildFrame({
        messageType: MSG_FULL_SERVER_RESPONSE,
        flags: 0b0001,
        serialization: 0b0001,
        payload: bytes(1, 2, 3, 4),
        seq: 1,
      });
      const truncated = frame.slice(0, frame.length - 2);
      const r = parseServerFrame(truncated.buffer);
      expect(r.errorMessage).toMatch(/^ASR frame truncated payload/);
    });

    it('unsupported compression (sync parser) routes to async instead', () => {
      const payload = bytes(0x00);
      const frame = buildFrame({
        messageType: MSG_FULL_SERVER_RESPONSE,
        flags: 0b0001,
        serialization: 0b0001,
        compression: 0b0001,
        payload,
        seq: 1,
      });
      const r = parseServerFrame(frame.buffer);
      expect(r.errorMessage).toContain('unsupported compression');
      expect(r.errorMessage).toContain('use parseServerFrameAsync');
    });
  });

  describe('parseServerFrame JSON payload', () => {
    function makeJsonServerFrame(json: object, flags = 0b0001, seq = 1): Uint8Array {
      return buildFrame({
        messageType: MSG_FULL_SERVER_RESPONSE,
        flags,
        serialization: 0b0001,
        compression: 0b0000,
        payload: new TextEncoder().encode(JSON.stringify(json)),
        seq,
      });
    }

    it('decodes result.text', () => {
      const r = parseServerFrame(
        makeJsonServerFrame({ result: { text: '你好' } }).buffer,
      );
      expect(r.text).toBe('你好');
      expect(r.utterances).toEqual([]);
      expect(r.errorMessage).toBeUndefined();
    });

    it('decodes utterances array preserving definite flag', () => {
      const r = parseServerFrame(
        makeJsonServerFrame({
          result: {
            utterances: [
              { text: 'partial', definite: false },
              { text: 'final', definite: true },
            ],
          },
        }).buffer,
      );
      expect(r.utterances).toHaveLength(2);
      expect(r.utterances[0]?.definite).toBe(false);
      expect(r.utterances[1]?.definite).toBe(true);
      expect(r.utterances[1]?.text).toBe('final');
    });

    it('handles multiple definite utterances in one frame (used by #5 fix)', () => {
      const r = parseServerFrame(
        makeJsonServerFrame({
          result: {
            utterances: [
              { text: '第一句', definite: true },
              { text: '第二句', definite: true },
            ],
          },
        }).buffer,
      );
      const definiteTexts = r.utterances.filter((u) => u.definite).map((u) => u.text);
      expect(definiteTexts).toEqual(['第一句', '第二句']);
    });

    it('missing result field yields empty text/utterances', () => {
      const r = parseServerFrame(makeJsonServerFrame({}).buffer);
      expect(r.text).toBe('');
      expect(r.utterances).toEqual([]);
    });
  });

  describe('parseServerFrame error-frame handling', () => {
    /** Real wire format: header (+seq) + errorCode(4) + messageSize(4) + message — NOT size+payload. */
    function buildErrorFrame(opts: {
      code: number;
      message: Uint8Array;
      serialization: number;
      flags?: number;
      seq?: number;
    }): Uint8Array {
      const flags = opts.flags ?? 0b0001;
      const header = new Uint8Array(4);
      header[0] = 0x11;
      header[1] = (MSG_SERVER_ERROR << 4) | (flags & 0x0f);
      header[2] = (opts.serialization << 4) | 0;
      header[3] = 0;
      const parts: Uint8Array[] = [header];
      if (flags & 0x01) {
        const seq = new Uint8Array(4);
        new DataView(seq.buffer).setInt32(0, opts.seq ?? 1, false);
        parts.push(seq);
      }
      const code = new Uint8Array(4);
      new DataView(code.buffer).setInt32(0, opts.code, false);
      parts.push(code, be32(opts.message.length), opts.message);
      return concat(...parts);
    }

    it('JSON error frame with error/message keys', () => {
      const message = new TextEncoder().encode(JSON.stringify({ error: 'auth failed', code: 401 }));
      const frame = buildErrorFrame({ code: 45000000, message, serialization: 0b0001 });
      const r = parseServerFrame(frame.buffer);
      expect(r.errorCode).toBe(45000000);
      expect(r.errorMessage).toBe('Volc ASR error 45000000: auth failed');
    });

    it('JSON error frame with message key only', () => {
      const message = new TextEncoder().encode(JSON.stringify({ message: 'rate-limited' }));
      const frame = buildErrorFrame({ code: 42, message, serialization: 0b0001 });
      const r = parseServerFrame(frame.buffer);
      expect(r.errorMessage).toBe('Volc ASR error 42: rate-limited');
    });

    it('non-JSON error frame keeps raw text as message', () => {
      const message = new TextEncoder().encode('plain text upstream error');
      const frame = buildErrorFrame({ code: 7, message, serialization: 0b0000 });
      const r = parseServerFrame(frame.buffer);
      expect(r.errorMessage).toBe('Volc ASR error 7: plain text upstream error');
    });

    it('does not misread error code as payload size (regression for truncated 45000008B alert)', () => {
      const message = new TextEncoder().encode('resource not granted');
      // 4 header + 4 code + 4 size + msg ≈ 145 when msg is ~133 bytes — matches production report
      const pad = 'x'.repeat(120);
      const longMsg = new TextEncoder().encode(`resource not granted ${pad}`);
      const frame = buildErrorFrame({
        code: 45000000,
        message: longMsg,
        serialization: 0b0000,
        flags: 0b0000, // no sequence — same as the user screenshot
      });
      expect(frame.length).toBeGreaterThan(100);
      const r = parseServerFrame(frame.buffer);
      expect(r.errorMessage).toMatch(/^Volc ASR error 45000000:/);
      expect(r.errorMessage).not.toMatch(/truncated payload/);
    });
  });

  describe('parseServerFrame sequence handling', () => {
    it('FLAG_NEG_NO_SEQUENCE does NOT consume a seq slot — payload starts right after the header', () => {
      // Spec: 0b0010 is "last packet, no sequence" — no 4-byte seq slot between header and
      // payload-size field. Reading through a seq field here would misalign the payload-size
      // word and silently corrupt every neg-no-seq frame.
      const payload = new TextEncoder().encode(JSON.stringify({ result: { text: 'ok' } }));
      const header = new Uint8Array(4);
      header[0] = 0x11;
      header[1] = (MSG_FULL_SERVER_RESPONSE << 4) | 0b0010; // FLAG_NEG_NO_SEQUENCE
      header[2] = (SERIAL_JSON << 4) | COMPRESS_NONE;
      header[3] = 0;
      const lenBytes = new Uint8Array(4);
      new DataView(lenBytes.buffer).setUint32(0, payload.length, false);
      const out = new Uint8Array(header.length + lenBytes.length + payload.length);
      out.set(header, 0);
      out.set(lenBytes, header.length);
      out.set(payload, header.length + lenBytes.length);
      const r = parseServerFrame(out.buffer);
      expect(r.errorMessage).toBeUndefined();
      expect(r.text).toBe('ok');
    });

    it('FLAG_NO_SEQUENCE skips the seq field', () => {
      const json = { result: { text: 'ok' } };
      const frame = buildFrame({
        messageType: MSG_FULL_CLIENT_REQUEST, // any value, just to test header skip
        flags: 0b0000,
        serialization: 0b0001,
        payload: new TextEncoder().encode(JSON.stringify(json)),
      });
      const r = parseServerFrame(frame.buffer);
      // Frame's body = JSON, not a real server-frame, but we just verify the parser
      // didn't read 4 extra bytes for seq.
      expect(r.errorMessage).toBeUndefined();
      expect(r.text).toBe('ok');
    });
  });

  describe('parseServerFrameAsync (gzip)', () => {
    // jsdom + older runtimes often lack the Blob.stream / Response.body stream APIs that
    // decompress uses. Skip cleanly when the surrounding platform can't inflate at all.
    const hasGzipInfra =
      typeof DecompressionStream !== 'undefined' &&
      typeof Response !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof new Blob([new Uint8Array(1)]).stream === 'function';
    if (!hasGzipInfra) {
      it.skip('skipped: stream/DecompressionStream not available in env', () => {});
      return;
    }
    it('inflates a gzip JSON payload', async () => {
      const json = { result: { text: 'gzip decoded', utterances: [] } };
      const bytes = new TextEncoder().encode(JSON.stringify(json));
      // Build gzip bytes locally; node:zlib is always present in test runs.
      const { gzipSync } = await import('node:zlib');
      const gz = new Uint8Array(gzipSync(Buffer.from(bytes)));

      const frame = buildFrame({
        messageType: MSG_FULL_SERVER_RESPONSE,
        flags: 0b0001,
        serialization: 0b0001,
        compression: 0b0001, // COMPRESS_GZIP
        payload: gz,
        seq: 1,
      });
      const r: VolcAsrParseResult = await parseServerFrameAsync(frame.buffer);
      expect(r.text).toBe('gzip decoded');
      expect(r.errorMessage).toBeUndefined();
    });
  });
});
