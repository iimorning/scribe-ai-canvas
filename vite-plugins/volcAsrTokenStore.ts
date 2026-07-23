/**
 * In-memory token store for the Volcengine streaming ASR dev proxy.
 *
 * The dev WebSocket proxy can't read `X-Api-Key` / `X-Api-App-Key` headers (browsers forbid
 * custom WS headers), so credentials have to be passed somehow. We use a two-leg flow:
 *
 *   1. Browser POSTs the credentials to `/api/volc-asr/issue-token`. The proxy stores them
 *      in this map keyed by an opaque short-lived token and returns the token.
 *   2. Browser opens a WebSocket to `/api/volc-asr?token=<opaque>` — the proxy looks up
 *      the credentials by token and forwards them as upstream headers.
 *
 * The browser URL never carries the long-lived credentials. The token TTL bounds the
 * window if a screenshot / log leaks; voice sessions reissue each start, so a short
 * TTL (10 min) is sufficient and shrinks the worst-case exposure.
 *
 * `lookup` is intentionally idempotent within TTL — repeated WS reconnects / retries
 * should hit the same token. There is no `consume` semantic; TTL expiry is the only
 * way a token stops working. Use `revoke` for explicit invalidation.
 *
 * Restart of the dev server wipes the map; the user re-issues silently.
 */

import { randomUUID } from 'node:crypto';

/**
 * 10 minutes matches a typical voice-writing session start-to-end. If a token leaks via a
 * screenshot or dev-server log, the worst-case window is 10 min — and the long-lived
 * Volc ASR credentials are never in the URL/log to begin with.
 */
export const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;

export type IssuedCredential = {
  apiKey?: string;
  appId?: string;
  accessToken?: string;
};

export type IssuedRecord = IssuedCredential & { expiresAt: number };

export type TokenStore = {
  issue: (creds: IssuedCredential, ttlMs?: number) => { token: string; expiresIn: number };
  /** Read credentials by token. Returns null if missing or expired (and clears on expiry). */
  lookup: (token: string) => IssuedCredential | null;
  /** Explicitly invalidate a token. Mostly for tests; the dev proxy does not call this. */
  revoke: (token: string) => boolean;
  /** Drop every entry whose TTL has passed. Returns the number removed. */
  sweep: () => number;
  size: () => number;
  clear: () => void;
};

export function createTokenStore(defaultTtlMs: number = DEFAULT_TOKEN_TTL_MS): TokenStore {
  const store = new Map<string, IssuedRecord>();

  return {
    issue(creds, ttlMs = defaultTtlMs) {
      const token = randomUUID();
      const expiresAt = Date.now() + ttlMs;
      store.set(token, { ...creds, expiresAt });
      return { token, expiresIn: Math.floor(ttlMs / 1000) };
    },
    lookup(token) {
      const v = store.get(token);
      if (!v) return null;
      if (v.expiresAt <= Date.now()) {
        store.delete(token);
        return null;
      }
      return { apiKey: v.apiKey, appId: v.appId, accessToken: v.accessToken };
    },
    revoke(token) {
      return store.delete(token);
    },
    sweep() {
      const now = Date.now();
      let removed = 0;
      for (const [k, v] of store) {
        if (v.expiresAt <= now) {
          store.delete(k);
          removed++;
        }
      }
      return removed;
    },
    size() {
      return store.size;
    },
    clear() {
      store.clear();
    },
  };
}
