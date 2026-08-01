/**
 * Volcengine / Doubao streaming ASR binary framing (big-endian).
 * @see https://www.volcengine.com/docs/6561/1354869
 */

const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE_UNITS = 0b0001; // 4 bytes

export const MSG_FULL_CLIENT_REQUEST = 0b0001;
export const MSG_AUDIO_ONLY_REQUEST = 0b0010;
export const MSG_FULL_SERVER_RESPONSE = 0b1001;
export const MSG_SERVER_ACK = 0b1011;
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

function bytesToReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

async function readStreamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatBytes(...chunks);
}

/** Gzip-compress bytes (Volc SAUC demos always gzip full-request + audio payloads). */
async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('Gzip required for Volc ASR but CompressionStream is unavailable');
  }
  // Prefer ReadableStream over Blob/Response — jsdom Blob lacks `.stream()`, which breaks undici Response.
  return readStreamToBytes(bytesToReadableStream(data).pipeThrough(new CompressionStream('gzip')));
}

/** First packet after WS connect: full client request (JSON + gzip). */
export async function encodeFullClientRequest(payload: object): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await gzipCompress(json);
  return concatBytes(
    buildHeader(MSG_FULL_CLIENT_REQUEST, FLAG_NO_SEQUENCE, SERIAL_JSON, COMPRESS_GZIP),
    writeUint32BE(compressed.length),
    compressed,
  );
}

/**
 * Audio-only packet (PCM + gzip).
 *
 * Volc SAUC bigmodel docs use flags without a sequence slot:
 * - normal: FLAG_NO_SEQUENCE (0b0000)
 * - last:   FLAG_NEG_NO_SEQUENCE (0b0010)
 * Frame layout: header(4) + payloadSize(4) + gzip(pcm).
 *
 * `@param _sequence` kept for call-site compatibility; not written on the wire.
 */
export async function encodeAudioOnlyRequest(
  pcm: Uint8Array,
  _sequence: number = 0,
  isLast = false,
): Promise<Uint8Array> {
  const flags = isLast ? FLAG_NEG_NO_SEQUENCE : FLAG_NO_SEQUENCE;
  const compressed = await gzipCompress(pcm);
  return concatBytes(
    buildHeader(MSG_AUDIO_ONLY_REQUEST, flags, SERIAL_NONE, COMPRESS_GZIP),
    writeUint32BE(compressed.length),
    compressed,
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
  errorCode?: number;
  raw?: unknown;
};

type FrameHeader = {
  messageType: number;
  flags: number;
  serialization: number;
  compression: number;
  /** Byte offset of the first field after header / optional seq / optional event. */
  offset: number;
};

function readFrameHeader(view: DataView): FrameHeader | { errorMessage: string } {
  if (view.byteLength < 4) {
    return { errorMessage: 'ASR frame too short' };
  }
  const headerSize = (view.getUint8(0) & 0x0f) * 4;
  const messageType = view.getUint8(1) >> 4;
  const flags = view.getUint8(1) & 0x0f;
  const serialization = view.getUint8(2) >> 4;
  const compression = view.getUint8(2) & 0x0f;
  let offset = headerSize;
  // bit0: sequence number present; bit2: event id present (newer SAUC framing).
  if (flags & 0x01) offset += 4;
  if (flags & 0x04) offset += 4;
  return { messageType, flags, serialization, compression, offset };
}

function sliceBytes(view: DataView, offset: number, size: number): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset + offset, size);
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

function formatServerError(code: number, messageBytes: Uint8Array, serialization: number): string {
  let detail = new TextDecoder().decode(messageBytes).trim();
  if (serialization === SERIAL_JSON) {
    const raw = safeJsonDecode(messageBytes);
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      detail =
        (typeof o.error === 'string' && o.error) ||
        (typeof o.message === 'string' && o.message) ||
        (typeof o.error_message === 'string' && o.error_message) ||
        detail ||
        JSON.stringify(raw);
    }
  }
  return detail ? `Volc ASR error ${code}: ${detail}` : `Volc ASR error ${code}`;
}

function parseResultJson(bytes: Uint8Array): Pick<VolcAsrParseResult, 'text' | 'utterances' | 'raw'> {
  const raw = safeJsonDecode(bytes);
  const result = (raw as { result?: { text?: string; utterances?: VolcAsrUtterance[] } } | null)?.result;
  const text = typeof result?.text === 'string' ? result.text : '';
  const utterances = Array.isArray(result?.utterances) ? result!.utterances! : [];
  return { text, utterances, raw };
}

async function decodePayload(bytes: Uint8Array, compression: number): Promise<Uint8Array> {
  if (compression !== COMPRESS_GZIP) return bytes;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Gzip-compressed ASR frame but DecompressionStream is unavailable');
  }
  return readStreamToBytes(bytesToReadableStream(bytes).pipeThrough(new DecompressionStream('gzip')));
}

/**
 * Parse a server binary frame into text / utterances.
 * Sync variant for `compression === COMPRESS_NONE`. For gzip frames use `parseServerFrameAsync`.
 *
 * Important: error frames (message type 0b1111) are NOT `size + payload` — they are
 * `errorCode(4) + messageSize(4) + message`. Mis-reading the code as payload size produced
 * bogus "truncated payload (need 45000008B)" alerts.
 */
export function parseServerFrame(buffer: ArrayBuffer): VolcAsrParseResult {
  const view = new DataView(buffer);
  const header = readFrameHeader(view);
  if ('errorMessage' in header) {
    return { messageType: 0, text: '', utterances: [], errorMessage: header.errorMessage };
  }
  const { messageType, serialization, compression, offset: start } = header;
  let offset = start;

  if (compression !== COMPRESS_NONE) {
    return {
      messageType,
      text: '',
      utterances: [],
      errorMessage: `ASR frame uses unsupported compression=${compression}; use parseServerFrameAsync`,
    };
  }

  if (messageType === MSG_SERVER_ERROR) {
    if (view.byteLength < offset + 8) {
      return {
        messageType,
        text: '',
        utterances: [],
        errorMessage: 'ASR error frame missing code/size',
      };
    }
    const code = view.getInt32(offset, false);
    const msgSize = view.getUint32(offset + 4, false);
    offset += 8;
    if (view.byteLength < offset + msgSize) {
      return {
        messageType,
        text: '',
        utterances: [],
        errorCode: code,
        errorMessage: `ASR error frame truncated (code=${code}, have ${view.byteLength - offset}B, need ${msgSize}B)`,
      };
    }
    const msgBytes = sliceBytes(view, offset, msgSize);
    return {
      messageType,
      text: '',
      utterances: [],
      errorCode: code,
      errorMessage: formatServerError(code, msgBytes, serialization),
      raw: { code, message: new TextDecoder().decode(msgBytes) },
    };
  }

  // FULL_SERVER_RESPONSE / ACK with body: payload size + payload
  if (view.byteLength < offset + 4) {
    // Bare ACK with only sequence/event and no body — ignore.
    if (messageType === MSG_SERVER_ACK) {
      return { messageType, text: '', utterances: [] };
    }
    return { messageType, text: '', utterances: [], errorMessage: 'ASR frame missing payload size' };
  }

  const payloadSize = view.getUint32(offset, false);
  offset += 4;
  if (view.byteLength < offset + payloadSize) {
    return {
      messageType,
      text: '',
      utterances: [],
      errorMessage: `ASR frame truncated payload (have ${view.byteLength}B, need ${offset + payloadSize}B, type=0x${messageType.toString(16)}, flags=0x${header.flags.toString(16)})`,
    };
  }

  if (serialization !== SERIAL_JSON) {
    return { messageType, text: '', utterances: [], raw: null };
  }

  const { text, utterances, raw } = parseResultJson(sliceBytes(view, offset, payloadSize));
  return { messageType, text, utterances, raw };
}

/** Async variant: handles gzip-compressed payloads via DecompressionStream. */
export async function parseServerFrameAsync(buffer: ArrayBuffer): Promise<VolcAsrParseResult> {
  const view = new DataView(buffer);
  const header = readFrameHeader(view);
  if ('errorMessage' in header) {
    return { messageType: 0, text: '', utterances: [], errorMessage: header.errorMessage };
  }
  const { messageType, serialization, compression, offset: start, flags } = header;
  let offset = start;

  if (messageType === MSG_SERVER_ERROR) {
    if (view.byteLength < offset + 8) {
      return {
        messageType,
        text: '',
        utterances: [],
        errorMessage: 'ASR error frame missing code/size',
      };
    }
    const code = view.getInt32(offset, false);
    const msgSize = view.getUint32(offset + 4, false);
    offset += 8;
    if (view.byteLength < offset + msgSize) {
      return {
        messageType,
        text: '',
        utterances: [],
        errorCode: code,
        errorMessage: `ASR error frame truncated (code=${code}, have ${view.byteLength - offset}B, need ${msgSize}B)`,
      };
    }
    let msgBytes = sliceBytes(view, offset, msgSize);
    try {
      msgBytes = await decodePayload(msgBytes, compression);
    } catch (e) {
      return {
        messageType,
        text: '',
        utterances: [],
        errorCode: code,
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
    return {
      messageType,
      text: '',
      utterances: [],
      errorCode: code,
      errorMessage: formatServerError(code, msgBytes, serialization),
      raw: { code, message: new TextDecoder().decode(msgBytes) },
    };
  }

  if (view.byteLength < offset + 4) {
    if (messageType === MSG_SERVER_ACK) {
      return { messageType, text: '', utterances: [] };
    }
    return { messageType, text: '', utterances: [], errorMessage: 'ASR frame missing payload size' };
  }

  const payloadSize = view.getUint32(offset, false);
  offset += 4;
  if (view.byteLength < offset + payloadSize) {
    return {
      messageType,
      text: '',
      utterances: [],
      errorMessage: `ASR frame truncated payload (have ${view.byteLength}B, need ${offset + payloadSize}B, type=0x${messageType.toString(16)}, flags=0x${flags.toString(16)})`,
    };
  }

  let payload = sliceBytes(view, offset, payloadSize);
  try {
    payload = await decodePayload(payload, compression);
  } catch (e) {
    return {
      messageType,
      text: '',
      utterances: [],
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }

  if (serialization !== SERIAL_JSON) {
    return { messageType, text: '', utterances: [], raw: null };
  }

  const { text, utterances, raw } = parseResultJson(payload);
  return { messageType, text, utterances, raw };
}
