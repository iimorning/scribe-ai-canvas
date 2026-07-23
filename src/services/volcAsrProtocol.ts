/**
 * Volcengine / Doubao streaming ASR binary framing (big-endian).
 * @see https://www.volcengine.com/docs/6561/1354869
 */

const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE_UNITS = 0b0001; // 4 bytes

export const MSG_FULL_CLIENT_REQUEST = 0b0001;
export const MSG_AUDIO_ONLY_REQUEST = 0b0010;
export const MSG_FULL_SERVER_RESPONSE = 0b1001;
export const MSG_SERVER_ERROR = 0b1111;

const FLAG_NO_SEQUENCE = 0b0000;
const FLAG_POSITIVE_SEQUENCE = 0b0001;
const FLAG_NEG_NO_SEQUENCE = 0b0010;
const FLAG_NEGATIVE_SEQUENCE = 0b0011;

const SERIAL_NONE = 0b0000;
const SERIAL_JSON = 0b0001;
const COMPRESS_NONE = 0b0000;

function buildHeader(messageType: number, flags: number, serialization: number, compression: number): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE_UNITS;
  header[1] = (messageType << 4) | flags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0;
  return header;
}

function writeUint32BE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value >>> 0, false);
  return buf;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** First packet after WS connect: full client request (JSON, no gzip). */
export function encodeFullClientRequest(payload: object): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return concatBytes(
    buildHeader(MSG_FULL_CLIENT_REQUEST, FLAG_NO_SEQUENCE, SERIAL_JSON, COMPRESS_NONE),
    writeUint32BE(json.length),
    json,
  );
}

/** Audio-only packet with positive sequence number. */
export function encodeAudioOnlyRequest(pcm: Uint8Array, sequence: number, isLast = false): Uint8Array {
  const flags = isLast ? FLAG_NEGATIVE_SEQUENCE : FLAG_POSITIVE_SEQUENCE;
  const seq = isLast ? -Math.abs(sequence) : sequence;
  const seqBytes = new Uint8Array(4);
  new DataView(seqBytes.buffer).setInt32(0, seq, false);
  return concatBytes(
    buildHeader(MSG_AUDIO_ONLY_REQUEST, flags, SERIAL_NONE, COMPRESS_NONE),
    seqBytes,
    writeUint32BE(pcm.length),
    pcm,
  );
}

export type VolcAsrUtterance = {
  text: string;
  definite?: boolean;
};

export type VolcAsrParseResult = {
  messageType: number;
  text: string;
  utterances: VolcAsrUtterance[];
  errorMessage?: string;
  raw?: unknown;
};

function readPayloadJson(view: DataView, offset: number, size: number): unknown {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, size);
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _parseError: true, text };
  }
}

/** Parse a server binary frame into text / utterances. */
export function parseServerFrame(buffer: ArrayBuffer): VolcAsrParseResult {
  const view = new DataView(buffer);
  if (view.byteLength < 4) {
    return { messageType: 0, text: '', utterances: [], errorMessage: 'ASR frame too short' };
  }

  const headerSize = (view.getUint8(0) & 0x0f) * 4;
  const messageType = view.getUint8(1) >> 4;
  const flags = view.getUint8(1) & 0x0f;
  const serialization = view.getUint8(2) >> 4;
  let offset = headerSize;

  if (flags === FLAG_POSITIVE_SEQUENCE || flags === FLAG_NEGATIVE_SEQUENCE) {
    offset += 4; // sequence
  }

  if (view.byteLength < offset + 4) {
    return { messageType, text: '', utterances: [], errorMessage: 'ASR frame missing payload size' };
  }

  const payloadSize = view.getUint32(offset, false);
  offset += 4;

  if (view.byteLength < offset + payloadSize) {
    return { messageType, text: '', utterances: [], errorMessage: 'ASR frame truncated payload' };
  }

  if (messageType === MSG_SERVER_ERROR) {
    const raw =
      serialization === SERIAL_JSON
        ? readPayloadJson(view, offset, payloadSize)
        : new TextDecoder().decode(new Uint8Array(buffer, offset, payloadSize));
    const errObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const msg =
      (typeof errObj?.error === 'string' && errObj.error) ||
      (typeof errObj?.message === 'string' && errObj.message) ||
      JSON.stringify(raw);
    return { messageType, text: '', utterances: [], errorMessage: msg, raw };
  }

  if (serialization !== SERIAL_JSON) {
    return { messageType, text: '', utterances: [], raw: null };
  }

  const raw = readPayloadJson(view, offset, payloadSize);
  const result = (raw as { result?: { text?: string; utterances?: VolcAsrUtterance[] } } | null)?.result;
  const text = typeof result?.text === 'string' ? result.text : '';
  const utterances = Array.isArray(result?.utterances) ? result!.utterances! : [];
  return { messageType, text, utterances, raw };
}
