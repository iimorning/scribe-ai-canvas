import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { issueVolcAsrToken } from '../../src/services/volcAsr';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // @ts-expect-error replace for test
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('issueVolcAsrToken', () => {
  it('POSTs to /api/volc-asr/issue-token and returns token+expiresIn', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'opaque-uuid', expiresIn: 86400 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await issueVolcAsrToken({ apiKey: 'secret-key' });
    expect(r.token).toBe('opaque-uuid');
    expect(r.expiresIn).toBe(86400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/volc-asr/issue-token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ apiKey: 'secret-key' });
  });

  it('legacy appId/accessToken pair is forwarded', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 't', expiresIn: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await issueVolcAsrToken({ appId: 'aid', accessToken: 'tk' });
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({
      appId: 'aid',
      accessToken: 'tk',
    });
  });

  it('throws on non-2xx with HTTP status and body excerpt', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response('proxy offline', { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(issueVolcAsrToken({ apiKey: 'k' })).rejects.toThrow(/HTTP 502/);
  });

  it('throws when the proxy returns no token', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate-limited' }), { status: 200 }),
    );
    await expect(issueVolcAsrToken({ apiKey: 'k' })).rejects.toThrow(/rate-limited/);
  });

  it('trims whitespace before forwarding credentials', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 't', expiresIn: 1 }), { status: 200 }),
    );
    await issueVolcAsrToken({ apiKey: '   spaced-key   ' });
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).apiKey).toBe(
      'spaced-key',
    );
  });
});
