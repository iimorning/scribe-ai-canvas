import {
  MINIMAX_DEFAULT_TTS_MODEL,
  MINIMAX_DEFAULT_VOICE_ID,
} from '../constants/voiceWriting';

const ISSUE_PATH = '/api/minimax-tts/issue-token';
const WS_PATH = '/api/minimax-tts';
const PCM_SAMPLE_RATE = 32_000;

type MinimaxEvent = {
  event?: string;
  data?: { audio?: string | null };
  is_final?: boolean;
  base_resp?: { status_code?: number; status_msg?: string };
  error?: string;
};

export type MinimaxTtsStreamOptions = {
  apiKey: string;
  model?: string;
  voiceId?: string;
  onSpeakingChange?: (speaking: boolean) => void;
  /** Fires when a sentence's audio actually starts playing; `null` when the queue goes idle. */
  onActiveTextChange?: (text: string | null) => void;
  onError?: (message: string) => void;
};

export type MinimaxTtsStream = {
  enqueueText: (text: string) => void;
  finish: () => void;
  waitUntilIdle: () => Promise<void>;
  stop: () => void;
};

function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/[^0-9a-f]/gi, '');
  const bytes = new Uint8Array(Math.floor(cleaned.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function pcm16leToFloat32(bytes: Uint8Array): Float32Array {
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000;
  return samples;
}

async function issueToken(apiKey: string): Promise<string> {
  const res = await fetch(ISSUE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  const body = await res.json().catch(() => ({})) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error || `MiniMax TTS token HTTP ${res.status}`);
  return body.token;
}

function proxyUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * MiniMax's official WebSocket protocol emits hex PCM chunks in `task_continued` events.
 * A single AudioContext schedule is used so chunks never create independent HTMLAudioElement
 * playback races or sentence-boundary gaps.
 */
export async function openMinimaxTtsStream(options: MinimaxTtsStreamOptions): Promise<MinimaxTtsStream> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Missing MiniMax API key');
  const token = await issueToken(apiKey);
  const ws = new WebSocket(proxyUrl(token));

  let closed = false;
  let started = false;
  let finishing = false;
  let finishSent = false;
  let taskInFlight = false;
  let speaking = false;
  let audioContext: AudioContext | null = null;
  let scheduledUntil = 0;
  let activeSources = 0;
  let audioChain: Promise<void> = Promise.resolve();
  const texts: string[] = [];
  const idleWaiters: Array<() => void> = [];
  /** Sentence currently being synthesized (may still be ahead of audible playback). */
  let currentTaskText: string | null = null;
  /** Whether we've already armed the playhead highlight for `currentTaskText`. */
  let taskPlayheadArmed = false;
  const playheadTimers: ReturnType<typeof setTimeout>[] = [];

  let activeText: string | null = null;

  const setSpeaking = (value: boolean) => {
    if (speaking === value) return;
    speaking = value;
    options.onSpeakingChange?.(value);
  };

  const setActiveText = (text: string | null) => {
    if (activeText === text) return;
    activeText = text;
    options.onActiveTextChange?.(text);
  };

  const clearPlayheadTimers = () => {
    while (playheadTimers.length) clearTimeout(playheadTimers.shift()!);
  };

  /** Arm highlight for when this sentence's first audio buffer actually starts. */
  const armPlayheadAt = (text: string, audioTime: number, ctx: AudioContext) => {
    const delayMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
    const timer = setTimeout(() => {
      if (!closed) setActiveText(text);
    }, delayMs);
    playheadTimers.push(timer);
  };

  const fail = (message: string) => {
    if (!closed) options.onError?.(message);
  };

  const isIdle = () => finishSent && !taskInFlight && texts.length === 0 && activeSources === 0;
  const settleIdle = () => {
    if (!isIdle()) return;
    clearPlayheadTimers();
    setSpeaking(false);
    setActiveText(null);
    while (idleWaiters.length) idleWaiters.shift()?.();
  };

  const send = (payload: object) => {
    if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const sendNext = () => {
    if (!started || taskInFlight || closed) return;
    const text = texts.shift();
    if (text) {
      taskInFlight = true;
      currentTaskText = text;
      taskPlayheadArmed = false;
      send({ event: 'task_continue', text });
      return;
    }
    if (finishing && !finishSent) {
      finishSent = true;
      send({ event: 'task_finish' });
      settleIdle();
    }
  };

  const schedulePcm = (hex: string, announceText: string | null) => {
    // Count before awaiting resume so task_final cannot settle the session prematurely.
    activeSources += 1;
    audioChain = audioChain
      .then(async () => {
        const bytes = hexToBytes(hex);
        if (!bytes.length || closed) {
          activeSources -= 1;
          settleIdle();
          return;
        }
        audioContext ??= new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
        if (audioContext.state === 'suspended') await audioContext.resume();
        const samples = pcm16leToFloat32(bytes);
        const buffer = audioContext.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
        buffer.copyToChannel(samples, 0);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        const startAt = Math.max(audioContext.currentTime + 0.03, scheduledUntil);
        scheduledUntil = startAt + buffer.duration;
        if (announceText) {
          armPlayheadAt(announceText, startAt, audioContext);
        }
        setSpeaking(true);
        source.onended = () => {
          activeSources -= 1;
          settleIdle();
        };
        source.start(startAt);
      })
      .catch((e) => {
        activeSources -= 1;
        fail(e instanceof Error ? e.message : String(e));
        settleIdle();
      });
  };

  ws.onopen = () => {
    // Official protocol waits for connected_success before task_start.
  };
  ws.onmessage = (event) => {
    let payload: MinimaxEvent;
    try {
      payload = JSON.parse(String(event.data)) as MinimaxEvent;
    } catch {
      fail('MiniMax TTS returned invalid WebSocket JSON');
      return;
    }
    const code = payload.base_resp?.status_code;
    if ((typeof code === 'number' && code !== 0) || payload.event === 'error') {
      fail(payload.error || payload.base_resp?.status_msg || `MiniMax TTS error ${code ?? 'unknown'}`);
      return;
    }
    if (payload.event === 'connected_success') {
      send({
        event: 'task_start',
        model: options.model?.trim() || MINIMAX_DEFAULT_TTS_MODEL,
        language_boost: 'Chinese',
        voice_setting: {
          voice_id: options.voiceId?.trim() || MINIMAX_DEFAULT_VOICE_ID,
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: PCM_SAMPLE_RATE,
          format: 'pcm',
          channel: 1,
        },
      });
      return;
    }
    if (payload.event === 'task_started') {
      started = true;
      sendNext();
      return;
    }
    if (payload.event === 'task_continued') {
      if (payload.data?.audio) {
        // Highlight follows audible playback, not synthesis start (synth runs ahead).
        const announce = !taskPlayheadArmed ? currentTaskText : null;
        if (announce) taskPlayheadArmed = true;
        schedulePcm(payload.data.audio, announce);
      }
      if (payload.is_final) {
        taskInFlight = false;
        sendNext();
      }
      return;
    }
    if (payload.event === 'task_finished') {
      settleIdle();
    }
  };
  ws.onerror = () => fail('MiniMax TTS WebSocket error');
  ws.onclose = () => {
    if (!closed && !finishSent) fail('MiniMax TTS WebSocket closed unexpectedly');
    settleIdle();
  };

  return {
    enqueueText(text: string) {
      const value = text.trim();
      if (!value || closed) return;
      texts.push(value);
      sendNext();
    },
    finish() {
      if (closed) return;
      finishing = true;
      sendNext();
    },
    waitUntilIdle() {
      if (isIdle()) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    stop() {
      if (closed) return;
      closed = true;
      texts.length = 0;
      currentTaskText = null;
      taskPlayheadArmed = false;
      clearPlayheadTimers();
      try { ws.close(); } catch { /* ignore */ }
      try { void audioContext?.close(); } catch { /* ignore */ }
      activeSources = 0;
      setSpeaking(false);
      setActiveText(null);
      while (idleWaiters.length) idleWaiters.shift()?.();
    },
  };
}
