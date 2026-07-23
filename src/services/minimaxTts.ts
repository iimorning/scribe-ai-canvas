import {
  MINIMAX_DEFAULT_TTS_MODEL,
  MINIMAX_DEFAULT_VOICE_ID,
} from '../constants/voiceWriting';

export type MinimaxTtsOptions = {
  apiKey: string;
  text: string;
  model?: string;
  voiceId?: string;
  signal?: AbortSignal;
};

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Synthesize one utterance via MiniMax HTTP T2A (non-stream for simpler playback).
 * Proxied through `/api/minimax` in Vite/Tauri webview.
 */
export async function synthesizeMinimaxSpeech(opts: MinimaxTtsOptions): Promise<Blob> {
  const apiKey = opts.apiKey.trim();
  if (!apiKey) throw new Error('Missing MiniMax API key');
  const text = opts.text.trim();
  if (!text) throw new Error('Empty TTS text');

  const res = await fetch('/api/minimax/v1/t2a_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model?.trim() || MINIMAX_DEFAULT_TTS_MODEL,
      text,
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: opts.voiceId?.trim() || MINIMAX_DEFAULT_VOICE_ID,
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
      language_boost: 'Chinese',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`MiniMax TTS HTTP ${res.status}: ${body.slice(0, 240)}`);
  }

  const json = (await res.json()) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
    audio_file?: string;
  };

  const code = json.base_resp?.status_code;
  if (typeof code === 'number' && code !== 0) {
    throw new Error(json.base_resp?.status_msg || `MiniMax TTS error ${code}`);
  }

  const hex = json.data?.audio || json.audio_file;
  if (!hex || typeof hex !== 'string') {
    throw new Error('MiniMax TTS returned no audio');
  }

  return new Blob([hexToUint8Array(hex)], { type: 'audio/mpeg' });
}
