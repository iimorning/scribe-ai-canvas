import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthesizeMinimaxSpeech } from '../../src/services/minimaxTts';
import {
  MINIMAX_DEFAULT_TTS_MODEL,
  MINIMAX_DEFAULT_VOICE_ID,
} from '../../src/constants/voiceWriting';

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

function mockResponseOnce(opts: {
  status?: number;
  ok?: boolean;
  jsonBody?: unknown;
  textBody?: string;
}) {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const res = {
    ok,
    status,
    text: vi.fn().mockResolvedValue(opts.textBody ?? JSON.stringify(opts.jsonBody ?? {})),
    json: vi.fn().mockResolvedValue(opts.jsonBody ?? {}),
  };
  fetchMock.mockResolvedValueOnce(res as unknown as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('synthesizeMinimaxSpeech — input validation', () => {
  it('throws "Missing MiniMax API key" when apiKey is empty', async () => {
    await expect(
      synthesizeMinimaxSpeech({ apiKey: '', text: 'hi' }),
    ).rejects.toThrow('Missing MiniMax API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when apiKey is only whitespace', async () => {
    await expect(
      synthesizeMinimaxSpeech({ apiKey: '   ', text: 'hi' }),
    ).rejects.toThrow('Missing MiniMax API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws "Empty TTS text" when text is empty', async () => {
    await expect(
      synthesizeMinimaxSpeech({ apiKey: 'k', text: '' }),
    ).rejects.toThrow('Empty TTS text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when text is only whitespace', async () => {
    await expect(
      synthesizeMinimaxSpeech({ apiKey: 'k', text: '   ' }),
    ).rejects.toThrow('Empty TTS text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('trims the apiKey before use', async () => {
    mockResponseOnce({ jsonBody: { data: { audio: '00' } } });
    await synthesizeMinimaxSpeech({ apiKey: '  sk-cp-abc  ', text: '你好' });
    const req = fetchMock.mock.calls[0];
    const headers = req[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-cp-abc');
  });

  it('trims the text before sending it in the body', async () => {
    mockResponseOnce({ jsonBody: { data: { audio: '00' } } });
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: '  你好  ' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe('你好');
  });
});

describe('synthesizeMinimaxSpeech — request shape', () => {
  beforeEach(() => {
    mockResponseOnce({ jsonBody: { data: { audio: '00' } } });
  });

  it('POSTs to /api/minimax/v1/t2a_v2', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/minimax/v1/t2a_v2');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('sends Content-Type: application/json', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends Authorization: Bearer <key>', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'my-key', text: 'hi' });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer my-key');
  });

  it('sets the documented body shape (model, text, stream:false, output_format:hex, voice_setting, audio_setting, language_boost)', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe(MINIMAX_DEFAULT_TTS_MODEL);
    expect(body.text).toBe('hi');
    expect(body.stream).toBe(false);
    expect(body.output_format).toBe('hex');
    expect(body.voice_setting).toEqual({
      voice_id: MINIMAX_DEFAULT_VOICE_ID,
      speed: 1,
      vol: 1,
      pitch: 0,
    });
    expect(body.audio_setting).toEqual({
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    });
    expect(body.language_boost).toBe('Chinese');
  });

  it('uses the default model when model is not provided', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe(MINIMAX_DEFAULT_TTS_MODEL);
  });

  it('uses the default model when model is empty/whitespace', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi', model: '   ' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe(MINIMAX_DEFAULT_TTS_MODEL);
  });

  it('uses the custom model when provided', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi', model: 'speech-hd' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('speech-hd');
  });

  it('uses the default voice when voiceId is not provided', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.voice_setting.voice_id).toBe(MINIMAX_DEFAULT_VOICE_ID);
  });

  it('uses the custom voice when provided', async () => {
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi', voiceId: 'my-voice' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.voice_setting.voice_id).toBe('my-voice');
  });

  it('forwards AbortSignal to fetch', async () => {
    const ac = new AbortController();
    await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi', signal: ac.signal });
    const passed = fetchMock.mock.calls[0][1].signal;
    expect(passed).toBe(ac.signal);
  });
});

describe('synthesizeMinimaxSpeech — success response', () => {
  it('decodes data.audio hex into a Blob of audio/mpeg', async () => {
    mockResponseOnce({ jsonBody: { data: { audio: '0001ff' } } });
    const blob = await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/mpeg');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0x00, 0x01, 0xff]);
  });

  it('accepts uppercase hex', async () => {
    mockResponseOnce({ jsonBody: { data: { audio: 'AABBCC' } } });
    const blob = await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('falls back to audio_file when data.audio is missing', async () => {
    mockResponseOnce({ jsonBody: { audio_file: 'deadbeef' } });
    const blob = await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('decodes long hex payloads correctly', async () => {
    const hex = 'ff'.repeat(1000);
    mockResponseOnce({ jsonBody: { data: { audio: hex } } });
    const blob = await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes.length).toBe(1000);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[999]).toBe(0xff);
  });
});

describe('synthesizeMinimaxSpeech — error response', () => {
  it('throws on HTTP non-ok with status + first 240 chars of body', async () => {
    const body = 'X'.repeat(500);
    mockResponseOnce({ status: 401, ok: false, textBody: body });
    let err: Error | null = null;
    try {
      await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/MiniMax TTS HTTP 401/);
    expect(err!.message).toContain('X'.repeat(240));
    // 241st X is not included (truncated to 240)
    expect(err!.message).not.toContain('X'.repeat(241));
  });

  it('throws on HTTP 500 with the body preview', async () => {
    mockResponseOnce({ status: 500, ok: false, textBody: 'server boom' });
    await expect(
      synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' }),
    ).rejects.toThrow(/HTTP 500.*server boom/);
  });

  it('throws when base_resp.status_code is non-zero, using status_msg', async () => {
    mockResponseOnce({
      jsonBody: { data: { audio: '00' }, base_resp: { status_code: 1001, status_msg: '余额不足' } },
    });
    await expect(
      synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' }),
    ).rejects.toThrow('余额不足');
  });

  it('falls back to a generic error code when status_msg is missing', async () => {
    mockResponseOnce({
      jsonBody: { data: { audio: '00' }, base_resp: { status_code: 1002 } },
    });
    await expect(
      synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' }),
    ).rejects.toThrow(/MiniMax TTS error 1002/);
  });

  it('throws "returned no audio" when data.audio and audio_file are both missing', async () => {
    mockResponseOnce({ jsonBody: { base_resp: { status_code: 0 } } });
    await expect(
      synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' }),
    ).rejects.toThrow('MiniMax TTS returned no audio');
  });

  it('throws "returned no audio" when data.audio is not a string', async () => {
    mockResponseOnce({ jsonBody: { data: { audio: 123 } } });
    await expect(
      synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' }),
    ).rejects.toThrow('MiniMax TTS returned no audio');
  });

  it('status_code === 0 (success) does not throw', async () => {
    mockResponseOnce({
      jsonBody: { data: { audio: '00' }, base_resp: { status_code: 0 } },
    });
    const blob = await synthesizeMinimaxSpeech({ apiKey: 'k', text: 'hi' });
    expect(blob).toBeInstanceOf(Blob);
  });
});
