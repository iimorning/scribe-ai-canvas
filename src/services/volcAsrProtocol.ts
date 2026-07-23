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
export const FLAG_POSITIVE_SEQUENCE = 0b0001;
export const FLAG_NEG_NO_SEQUENCE = 0b0010;
export const FLAG_NEGATIVE_SEQUENCE = 0b0011;

const SERIAL_NONE = 0b0000;
export const SERIAL_JSON = 0b0001;
export const COMPRESS_NONE = 0b0000;
export const COMPRESS_GZIP = 0b0001;

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
  // Spec mandates negative sequence number (e.g. -1) for the last packet; -0 is not a valid
  // terminator. floor to -Math.abs(sequence) so callers passing 0 still produce -1 on the wire.
  const flags = isLast ? FLAG_NEGATIVE_SEQUENCE : FLAG_POSITIVE_SEQUENCE;
  const seq = isLast ? -Math.max(1, Math.abs(sequence)) : sequence;
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

/** Inflate a gzip payload. Returns the original array if magic bytes don't match gzip. */
function maybeInflate(bytes: Uint8Array): Uint8Array {
  // Gzip magic: 1f 8b
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return bytes;
  }
  // The platform's DecompressionStream handles gzip both in modern browsers and in Node 18+.
  // Sync inflate is awkward in browser-only code; expose the decoder promise so the caller
  // can await it. parseServerFrame is sync, but the only caller is onmessage which is async
  // by nature. We return the raw bytes here and inflate via async helper.
  throw new Error('gzip frame must be decoded via decodePayload');
}

async function decodePayload(bytes: Uint8Array, compression: number): Promise<Uint8Array> {
  if (compression !== COMPRESS_GZIP) return bytes;
  if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('Gzip-compressed ASR frame but DecompressionStream/Response/Blob are unavailable');
  }
  // Feed the bytes through DecompressionStream. The platform's Blob#stream is missing in
  // some jsdom builds, so we wrap via Response which always provides a body stream.
  const stream = new Response(new Blob([bytes])).body;
  if (!stream) throw new Error('Gzip-compressed ASR frame but no readable stream available');
  const inflated = await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return new Uint8Array(inflated);
}

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

/**
 * Parse a server binary frame into text / utterances.
 * Sync variant for `compression === COMPRESS_NONE`. For gzip frames use `parseServerFrameAsync`.
 */
export function parseServerFrame(buffer: ArrayBuffer): VolcAsrParseResult {
  const view = new DataView(buffer);
  if (view.byteLength < 4) {
    return { messageType: 0, text: '', utterances: [], errorMessage: 'ASR frame too short' };
  }

  const headerSize = (view.getUint8(0) & 0x0f) * 4;
  const messageType = view.getUint8(1) >> 4;
  const flags = view.getUint8(1) & 0x0f;
  const serialization = view.getUint8(2) >> 4;
  const compression = view.getUint8(2) & 0x0f;
  let offset = headerSize;

  // Spec: only 0b0001 (positive-sequence) and 0b0011 (negative-sequence) carry a 4-byte
  // sequence AFTER the header. 0b0010 (FLAG_NEG_NO_SEQUENCE) marks the last packet but DOES
  // NOT include the 4-byte slot — treating it as a seq field would misalign payload reads.
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

  if (compression !== COMPRESS_NONE) {
    return {
      messageType,
      text: '',
      utterances: [],
      errorMessage: `ASR frame uses unsupported compression=${compression}; use parseServerFrameAsync`,
    };
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
      (typeof raw === 'string' ? raw : JSON.stringify(raw));
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

/** Async variant: handles gzip-compressed JSON payloads via the platform DecompressionStream. */
export async function parseServerFrameAsync(buffer: ArrayBuffer): Promise<VolcAsrParseResult> {
  const view = new DataView(buffer);
  if (view.byteLength < 4) {
    return { messageType: 0, text: '', utterances: [], errorMessage: 'ASR frame too short' };
  }
  const headerSize = (view.getUint8(0) & 0x0f) * 4;
  const messageType = view.getUint8(1) >> 4;
  const flags = view.getUint8(1) & 0x0f;
  const serialization = view.getUint8(2) >> 4;
  const compression = view.getUint8(2) & 0x0f;
  let offset = headerSize;
  // See note in parseServerFrame above: only POSITIVE/NEGATIVE carry a 4-byte sequence.
  if (flags === FLAG_POSITIVE_SEQUENCE || flags === FLAG_NEGATIVE_SEQUENCE) offset += 4;
  if (view.byteLength < offset + 4) {
    return { messageType, text: '', utterances: [], errorMessage: 'ASR frame missing payload size' };
  }
  const payloadSize = view.getUint32(offset, false);
  offset += 4;
  if (view.byteLength < offset + payloadSize) {
    return { messageType, text: '', utterances: [], errorMessage: 'ASR frame truncated payload' };
  }
  const rawBytes = new Uint8Array(buffer, offset, payloadSize);
  const inflated = await decodePayload(rawBytes, compression);

  if (messageType === MSG_SERVER_ERROR) {
    const raw =
      serialization === SERIAL_JSON
        ? safeJsonDecode(inflated)
        : new TextDecoder().decode(inflated);
    const errObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const msg =
      (typeof errObj?.error === 'string' && errObj.error) ||
      (typeof errObj?.message === 'string' && errObj.message) ||
      (typeof raw === 'string' ? raw : JSON.stringify(raw));
    return { messageType, text: '', utterances: [], errorMessage: msg, raw };
  }

  if (serialization !== SERIAL_JSON) {
    return { messageType, text: '', utterances: [], raw: null };
  }

  const raw = safeJsonDecode(inflated);
  const result = (raw as { result?: { text?: string; utterances?: VolcAsrUtterance[] } } | null)?.result;
  const text = typeof result?.text === 'string' ? result.text : '';
  const utterances = Array.isArray(result?.utterances) ? result!.utterances! : [];
  return { messageType, text, utterances, raw };
}

function safeJsonDecode(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _parseError: true, text };
  }
}

// Suppress dead-code warning for the maybeflate helper kept for future use.
void maybeInflate;
