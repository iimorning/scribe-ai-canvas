import {
  VOLC_ASR_DEFAULT_RESOURCE_ID,
  VOLC_ASR_PROXY_PATH,
} from '../constants/voiceWriting';
import {
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
  parseServerFrame,
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

function buildProxyWsUrl(creds: VolcAsrCredentials): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const qs = new URLSearchParams();
  const apiKey = (creds.apiKey ?? '').trim();
  const appId = (creds.appId ?? '').trim();
  const accessToken = (creds.accessToken ?? '').trim();
  const resourceId = (creds.resourceId ?? '').trim() || VOLC_ASR_DEFAULT_RESOURCE_ID;
  if (apiKey) qs.set('apiKey', apiKey);
  if (appId) qs.set('appId', appId);
  if (accessToken) qs.set('accessToken', accessToken);
  qs.set('resourceId', resourceId);
  qs.set('requestId', crypto.randomUUID());
  return `${proto}//${window.location.host}${VOLC_ASR_PROXY_PATH}?${qs.toString()}`;
}

export function hasVolcAsrCredentials(creds: VolcAsrCredentials): boolean {
  if ((creds.apiKey ?? '').trim()) return true;
  return !!(creds.appId ?? '').trim() && !!(creds.accessToken ?? '').trim();
}

/**
 * Open a streaming ASR session via same-origin Vite proxy (auth headers injected server-side).
 */
export function openVolcAsrSession(creds: VolcAsrCredentials, handlers: VolcAsrHandlers): VolcAsrSession {
  if (!hasVolcAsrCredentials(creds)) {
    throw new Error('Missing Volc ASR credentials');
  }

  let sequence = 1;
  let closed = false;
  let ready = false;
  const pending: Uint8Array[] = [];

  const ws = new WebSocket(buildProxyWsUrl(creds));
  ws.binaryType = 'arraybuffer';

  const flushPending = () => {
    while (pending.length > 0 && ready && ws.readyState === WebSocket.OPEN) {
      const chunk = pending.shift()!;
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

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const j = JSON.parse(ev.data) as { error?: string };
        if (j.error) handlers.onError?.(j.error);
      } catch {
        handlers.onError?.(ev.data);
      }
      return;
    }
    const parsed = parseServerFrame(ev.data as ArrayBuffer);
    if (parsed.errorMessage) {
      handlers.onError?.(parsed.errorMessage);
      return;
    }

    const definiteUtterance = parsed.utterances.find((u) => u.definite && (u.text ?? '').trim());
    if (definiteUtterance) {
      handlers.onDefinite?.(definiteUtterance.text.trim());
      return;
    }

    const partialFromUtterances = parsed.utterances
      .filter((u) => !u.definite)
      .map((u) => u.text)
      .join('');
    const partial = (partialFromUtterances || parsed.text || '').trim();
    if (partial) handlers.onPartial?.(partial);
  };

  ws.onerror = () => {
    handlers.onError?.('Volc ASR WebSocket error');
  };

  ws.onclose = () => {
    closed = true;
    handlers.onClose?.();
  };

  return {
    sendPcm(pcm: Uint8Array) {
      if (closed || pcm.length === 0) return;
      if (!ready || ws.readyState !== WebSocket.OPEN) {
        pending.push(pcm);
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
