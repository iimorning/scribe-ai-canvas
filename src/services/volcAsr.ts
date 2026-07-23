import {
  VOLC_ASR_DEFAULT_RESOURCE_ID,
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

function joinDefinite(utterances: VolcAsrUtterance[]): string {
  return utterances
    .filter((u) => u.definite && (u.text ?? '').trim())
    .map((u) => u.text.trim())
    .join(' ');
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

  let sequence = 1;
  let closed = false;
  let ready = false;
  const MAX_PENDING_BYTES = 256 * 1024;
  let pendingBytes = 0;
  const pending: Uint8Array[] = [];

  const ws = new WebSocket(buildProxyWsUrl(token, creds));
  ws.binaryType = 'arraybuffer';

  const flushPending = () => {
    while (pending.length > 0 && ready && ws.readyState === WebSocket.OPEN) {
      const chunk = pending.shift()!;
      pendingBytes -= chunk.length;
      ws.send(encodeAudioOnlyRequest(chunk, sequence++));
    }
  };

  ws.onopen = () => {
    const fullReq = encodeFullClientRequest({
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
        end_window_size: 800,
        force_to_speech_time: 1000,
      },
    });
    ws.send(fullReq);
    ready = true;
    flushPending();
  };

  const handleParsed = (parsed: ReturnType<typeof parseServerFrame>) => {
    if (closed) return;
    if (parsed.errorMessage) {
      handlers.onError?.(parsed.errorMessage);
      return;
    }

    const definiteText = joinDefinite(parsed.utterances);
    if (definiteText) {
      handlers.onDefinite?.(definiteText);
      return;
    }

    const partialFromUtterances = parsed.utterances
      .filter((u) => !u.definite)
      .map((u) => u.text)
      .join('');
    const partial = (partialFromUtterances || parsed.text || '').trim();
    if (partial) handlers.onPartial?.(partial);
  };

  ws.onmessage = (ev) => {
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
    if (closed) return;
    handlers.onError?.('Volc ASR WebSocket error');
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  ws.onclose = () => {
    closed = true;
    handlers.onClose?.();
  };

  return {
    sendPcm(pcm: Uint8Array) {
      if (closed || pcm.length === 0) return;
      if (!ready || ws.readyState !== WebSocket.OPEN) {
        pendingBytes += pcm.length;
        pending.push(pcm);
        while (pendingBytes > MAX_PENDING_BYTES && pending.length > 1) {
          const dropped = pending.shift()!;
          pendingBytes -= dropped.length;
        }
        return;
      }
      ws.send(encodeAudioOnlyRequest(pcm, sequence++));
    },
    finish() {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      ws.send(encodeAudioOnlyRequest(new Uint8Array(0), sequence++, true));
    },
    close() {
      closed = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}
