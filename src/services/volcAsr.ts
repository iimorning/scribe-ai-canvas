import {
  VOLC_ASR_DEFAULT_RESOURCE_ID,
  VOLC_ASR_END_WINDOW_MS,
  VOLC_ASR_PROXY_PATH,
} from '../constants/voiceWriting';
import {
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
  parseServerFrame,
  parseServerFrameAsync,
  type VolcAsrUtterance,
} from './volcAsrProtocol';

export type VolcAsrCredentials = {
  /** New console API key (X-Api-Key). Preferred when set. */
  apiKey?: string;
  /** Legacy console APP ID (X-Api-App-Key). */
  appId?: string;
  /** Legacy console Access Token (X-Api-Access-Key). */
  accessToken?: string;
  resourceId?: string;
};

export type VolcAsrHandlers = {
  onPartial?: (text: string) => void;
  onDefinite?: (text: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

export type VolcAsrSession = {
  sendPcm: (pcm: Uint8Array) => void;
  finish: () => void;
  close: () => void;
};

/**
 * POST creds to the dev proxy, get back a short-lived opaque token. The token — not the
 * original key — is what appears in the WebSocket URL and dev-server logs. Outside the dev
 * proxy (production builds) this call hits a 404; callers should fall back to a direct
 * upstream WebSocket with custom headers via the Tauri IPC path.
 */
export async function issueVolcAsrToken(
  creds: VolcAsrCredentials,
  opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<{ token: string; expiresIn: number }> {
  const body: Record<string, string> = {};
  const apiKey = (creds.apiKey ?? '').trim();
  const appId = (creds.appId ?? '').trim();
  const accessToken = (creds.accessToken ?? '').trim();
  if (apiKey) body.apiKey = apiKey;
  if (appId) body.appId = appId;
  if (accessToken) body.accessToken = accessToken;

  const f = opts?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f('/api/volc-asr/issue-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (e) {
    throw new Error(
      `Volc ASR token issuance failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Volc ASR token HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  const json = (await res.json()) as { token?: string; expiresIn?: number; error?: string };
  if (!json.token) {
    throw new Error(`Volc ASR proxy returned no token: ${json.error ?? 'unknown'}`);
  }
  // Default to a 10-min fallback if the proxy forgot to send `expiresIn`. Must match the
  // server's DEFAULT_TOKEN_TTL_MS so callers don't accidentally treat a stale token as fresh.
  return { token: json.token, expiresIn: json.expiresIn ?? 10 * 60 };
}

function buildProxyWsUrl(token: string, creds: VolcAsrCredentials): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const qs = new URLSearchParams();
  qs.set('token', token);
  qs.set(
    'resourceId',
    (creds.resourceId ?? '').trim() || VOLC_ASR_DEFAULT_RESOURCE_ID,
  );
  qs.set('requestId', crypto.randomUUID());
  return `${proto}//${window.location.host}${VOLC_ASR_PROXY_PATH}?${qs.toString()}`;
}

export function hasVolcAsrCredentials(creds: VolcAsrCredentials): boolean {
  if ((creds.apiKey ?? '').trim()) return true;
  return !!(creds.appId ?? '').trim() && !!(creds.accessToken ?? '').trim();
}

/** Join utterance texts, skipping exact duplicate segments (nostream can re-emit the same line). */
function joinUtteranceTexts(utterances: VolcAsrUtterance[]): string {
  let out = '';
  for (const u of utterances) {
    const t = (u.text ?? '').trim();
    if (!t) continue;
    if (!out) {
      out = t;
      continue;
    }
    if (t === out || out.endsWith(t)) continue;
    if (t.startsWith(out)) {
      out = t;
      continue;
    }
    out = `${out}${t}`;
  }
  return out;
}

/** Cumulative transcript for result_type=full — prefer server `text`, else utterances. */
function fullTranscriptFromParsed(parsed: {
  text?: string;
  utterances: VolcAsrUtterance[];
}): string {
  const fromText = (parsed.text ?? '').trim();
  if (fromText) return fromText;
  return joinUtteranceTexts(parsed.utterances);
}

export type OpenVolcAsrSessionOptions = {
  /**
   * Pre-issued token from `issueVolcAsrToken`. Skips the POST; useful for tests and
   * for callers that want to refresh on a known schedule.
   */
  token?: string;
  /** Test injection: replace the global `fetch`. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

/**
 * Open a streaming ASR session via same-origin Vite proxy. Credentials are exchanged for
 * a short-lived opaque token so they never appear in the WebSocket URL or browser history.
 */
export async function openVolcAsrSession(
  creds: VolcAsrCredentials,
  handlers: VolcAsrHandlers,
  opts: OpenVolcAsrSessionOptions = {},
): Promise<VolcAsrSession> {
  if (!hasVolcAsrCredentials(creds)) {
    throw new Error('Missing Volc ASR credentials');
  }

  const token =
    opts.token ?? (await issueVolcAsrToken(creds, { signal: opts.signal, fetchImpl: opts.fetchImpl })).token;

  console.log('[Spoor ASR] token issued, opening WS', { hasApiKey: !!(creds.apiKey ?? '').trim(), hasAppId: !!(creds.appId ?? '').trim(), resourceId: (creds.resourceId ?? '').trim() || VOLC_ASR_DEFAULT_RESOURCE_ID });

  let closed = false;
  /** Only true after the server acknowledges the full client request (or ready timeout). */
  let ready = false;
  const MAX_PENDING_BYTES = 256 * 1024;
  let pendingBytes = 0;
  const pending: Uint8Array[] = [];
  /** Serialize gzip + send so packet order matches wire order. */
  let writeChain: Promise<void> = Promise.resolve();
  let readyTimer: ReturnType<typeof setTimeout> | null = null;

  const ws = new WebSocket(buildProxyWsUrl(token, creds));
  ws.binaryType = 'arraybuffer';

  const enqueueWrite = (task: () => Promise<void>) => {
    writeChain = writeChain
      .then(task)
      .catch((e) => {
        if (closed) return;
        handlers.onError?.(e instanceof Error ? e.message : String(e));
      });
  };

  const flushPending = () => {
    while (pending.length > 0 && ready && !closed) {
      const chunk = pending.shift()!;
      pendingBytes -= chunk.length;
      enqueueWrite(async () => {
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        const frame = await encodeAudioOnlyRequest(chunk);
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        ws.send(frame);
      });
    }
  };

  const markReadyAndFlush = () => {
    if (ready || closed) return;
    ready = true;
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    flushPending();
  };

  ws.onopen = () => {
    console.log('[Spoor ASR] ws.onopen');
    enqueueWrite(async () => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      const fullReq = await encodeFullClientRequest({
        user: { uid: 'spoor-voice' },
        audio: {
          format: 'pcm',
          codec: 'raw',
          rate: 16000,
          bits: 16,
          channel: 1,
        },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
          show_utterances: true,
          result_type: 'full',
          enable_nonstream: true,
          // Silence window before definite. 800ms ends mid-thought on any brief pause.
          end_window_size: VOLC_ASR_END_WINDOW_MS,
          force_to_speech_time: 1000,
        },
      });
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      ws.send(fullReq);
      console.log('[Spoor ASR] full client request sent', { bytes: fullReq.byteLength });
      // Prefer waiting for the init full-server-response; fall back so a missed ACK
      // cannot leave the mic buffering forever with no UI error.
      readyTimer = setTimeout(() => {
        console.warn('[Spoor ASR] ready timer fired without ACK — flushing anyway');
        markReadyAndFlush();
      }, 800);
    });
  };

  const handleParsed = (parsed: ReturnType<typeof parseServerFrame>) => {
    if (closed) return;
    console.log('[Spoor ASR] parsed frame', { type: parsed.messageType, text: parsed.text, utterances: parsed.utterances, error: parsed.errorMessage });
    if (parsed.errorMessage) {
      handlers.onError?.(parsed.errorMessage);
      return;
    }

    // Any non-error binary frame means the full client request was accepted.
    if (!ready) console.log('[Spoor ASR] first non-error frame → ready');
    markReadyAndFlush();

    // result_type=full: each frame carries the cumulative transcript. Always emit that
    // whole string (replace upstream) — never only the latest fragment, or voice UI will
    // concatenate revised hypotheses and look like an echo.
    const fullText = fullTranscriptFromParsed(parsed);
    if (!fullText) return;

    const hasDefinite = parsed.utterances.some((u) => u.definite && (u.text ?? '').trim());
    if (hasDefinite) {
      console.log('[Spoor ASR] onDefinite', JSON.stringify(fullText));
      handlers.onDefinite?.(fullText);
      return;
    }

    console.log('[Spoor ASR] onPartial', JSON.stringify(fullText));
    handlers.onPartial?.(fullText);
  };

  ws.onmessage = (ev) => {
    console.log('[Spoor ASR] ws.onmessage', { kind: typeof ev.data, bytes: typeof ev.data === 'string' ? ev.data.length : ev.data.byteLength });
    if (typeof ev.data === 'string') {
      try {
        const j = JSON.parse(ev.data) as { error?: string };
        if (j.error) {
          if (!closed) handlers.onError?.(j.error);
        }
      } catch {
        if (!closed) handlers.onError?.(ev.data);
      }
      return;
    }
    const buffer = ev.data as ArrayBuffer;
    const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4));
    const compression = head.length >= 3 ? head[2]! & 0x0f : 0;
    if (compression === 0) {
      handleParsed(parseServerFrame(buffer));
    } else {
      void parseServerFrameAsync(buffer).then((parsed) => handleParsed(parsed));
    }
  };

  ws.onerror = () => {
    console.error('[Spoor ASR] ws.onerror');
    if (closed) return;
    handlers.onError?.('Volc ASR WebSocket error');
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  ws.onclose = () => {
    console.log('[Spoor ASR] ws.onclose');
    closed = true;
    handlers.onClose?.();
  };

  let sendPcmCount = 0;
  return {
    sendPcm(pcm: Uint8Array) {
      if (closed || pcm.length === 0) return;
      sendPcmCount += 1;
      if (sendPcmCount <= 3 || sendPcmCount % 50 === 0) {
        console.log('[Spoor ASR] sendPcm', { n: sendPcmCount, bytes: pcm.length, ready, wsState: ws.readyState, pending: pending.length });
      }
      if (!ready || ws.readyState !== WebSocket.OPEN) {
        pendingBytes += pcm.length;
        pending.push(pcm);
        while (pendingBytes > MAX_PENDING_BYTES && pending.length > 1) {
          const dropped = pending.shift()!;
          pendingBytes -= dropped.length;
        }
        return;
      }
      enqueueWrite(async () => {
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        const frame = await encodeAudioOnlyRequest(pcm);
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        ws.send(frame);
      });
    },
    finish() {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      enqueueWrite(async () => {
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        const frame = await encodeAudioOnlyRequest(new Uint8Array(0), 0, true);
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        ws.send(frame);
      });
    },
    close() {
      closed = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}
