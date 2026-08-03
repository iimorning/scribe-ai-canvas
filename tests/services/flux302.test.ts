import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateFluxDevImage, hasFlux302Credentials } from '../../src/services/flux302';

describe('hasFlux302Credentials', () => {
  it('requires a non-empty key', () => {
    expect(hasFlux302Credentials(undefined)).toBe(false);
    expect(hasFlux302Credentials('  ')).toBe(false);
    expect(hasFlux302Credentials('sk-x')).toBe(true);
  });
});

describe('generateFluxDevImage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses Flux-2-Klein-4b sync response (Ready + sample)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 't-1',
        status: 'Ready',
        result: {
          sample: 'https://file.302ai.cn/gpt/imgs/a.jpg',
          prompt: 'a red apple',
          seed: 1,
        },
      }),
    });

    const result = await generateFluxDevImage({ apiKey: 'sk-test', prompt: 'a red apple' });
    expect(result).toEqual({
      url: 'https://file.302ai.cn/gpt/imgs/a.jpg',
      taskId: 't-1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/flux/v1/flux-2-klein-4b');
    const body = JSON.parse(String(init.body));
    expect(body.sync).toBe(true);
    expect(body.prompt).toBe('a red apple');
  });

  it('falls back to get_result polling when sync only returns an id', async () => {
    vi.useFakeTimers();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 't-2',
          polling_url: 'https://example/poll',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 't-2', status: 'Pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 't-2',
          status: 'Ready',
          result: { sample: 'https://file.302ai.cn/done.jpg' },
        }),
      });

    const pending = generateFluxDevImage({ apiKey: 'sk-test', prompt: 'lantern' });
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1600);
    const result = await pending;
    expect(result.url).toBe('https://file.302ai.cn/done.jpg');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/flux/v1/get_result?id=t-2');
  });
});
