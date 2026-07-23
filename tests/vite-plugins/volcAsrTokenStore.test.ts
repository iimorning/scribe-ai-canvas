import { describe, it, expect } from 'vitest';
import {
  createTokenStore,
  DEFAULT_TOKEN_TTL_MS,
} from '../../vite-plugins/volcAsrTokenStore';

describe('volcAsrTokenStore', () => {
  it('default TTL is 10 minutes (voice sessions reissue each start; long enough for one)', () => {
    expect(DEFAULT_TOKEN_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('issue returns a token with expiresIn', () => {
    const s = createTokenStore(60_000);
    const { token, expiresIn } = s.issue({ apiKey: 'k' });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(expiresIn).toBe(60);
    s.clear();
  });

  it('lookup returns the credentials while valid', () => {
    const s = createTokenStore(60_000);
    const { token } = s.issue({ apiKey: 'k', appId: 'a', accessToken: 't' });
    expect(s.lookup(token)).toEqual({ apiKey: 'k', appId: 'a', accessToken: 't' });
    s.clear();
  });

  it('lookup is idempotent within TTL — repeated WS reconnects / retries hit the same token', () => {
    const s = createTokenStore(60_000);
    const { token } = s.issue({ apiKey: 'k' });
    expect(s.lookup(token)).toEqual({ apiKey: 'k', appId: undefined, accessToken: undefined });
    // A second lookup returns the same credentials — there is no consume semantic.
    expect(s.lookup(token)).toEqual({ apiKey: 'k', appId: undefined, accessToken: undefined });
    s.clear();
  });

  it('lookup returns null and removes the entry after expiry', async () => {
    const s = createTokenStore(10);
    const { token } = s.issue({ apiKey: 'k' });
    await new Promise((r) => setTimeout(r, 25));
    expect(s.lookup(token)).toBeNull();
    expect(s.size()).toBe(0);
    s.clear();
  });

  it('lookup on an unknown token returns null', () => {
    const s = createTokenStore();
    expect(s.lookup('nope')).toBeNull();
    s.clear();
  });

  it('revoke explicitly invalidates a still-valid token', () => {
    const s = createTokenStore(60_000);
    const { token } = s.issue({ apiKey: 'k' });
    expect(s.revoke(token)).toBe(true);
    expect(s.lookup(token)).toBeNull();
    expect(s.revoke(token)).toBe(false);
    s.clear();
  });

  it('sweep removes expired entries and reports the count', async () => {
    const s = createTokenStore(10);
    s.issue({ apiKey: 'a' });
    s.issue({ apiKey: 'b' });
    s.issue({ apiKey: 'c' }, 60_000); // long-lived
    await new Promise((r) => setTimeout(r, 25));
    const removed = s.sweep();
    expect(removed).toBe(2);
    expect(s.size()).toBe(1);
    s.clear();
  });
});
