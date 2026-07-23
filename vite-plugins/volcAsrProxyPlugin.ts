/**
 * Vite plugin: dev-only two-leg proxy for Volcengine streaming ASR.
 *
 *   - POST /api/volc-asr/issue-token  →  issues a short-lived opaque token.
 *   - WS   /api/volc-asr?token=…       →  looks up the credentials by token and
 *                                         opens an upstream WebSocket to
 *                                         `wss://openspeech.bytedance.com` with
 *                                         `X-Api-*` headers injected.
 *
 * ⚠️  LOCAL DEV / PREVIEW ONLY. DO NOT expose this plugin (or any build that contains it)
 *     to the public internet.
 *
 *     `POST /api/volc-asr/issue-token` has NO authentication and NO CSRF protection —
 *     anyone able to reach the dev/preview server can immediately obtain a token bound
 *     to whatever credentials the user has already cached there, then proxy traffic to
 *     `openspeech.bytedance.com` on the server's bill. This is fine for `npm run dev`
 *     on a laptop; it is catastrophic if the dev bundle is published.
 *
 *     Production / Tauri builds should bypass this proxy entirely (Tauri IPC can pass
 *     custom WS headers directly to `wss://openspeech.bytedance.com`); this plugin is
 *     guarded out of production by virtue of `vite-plugins/*` being dev-only code.
 *
 * The browser never puts the long-lived ASR credentials in the WebSocket URL. Only an
 * opaque short-lived token (default 10 min TTL — voice sessions reissue each start) is
 * visible in browser history, dev-server logs, and screenshots.
 */
import type { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { randomUUID } from 'node:crypto';
import { createTokenStore, DEFAULT_TOKEN_TTL_MS } from './volcAsrTokenStore';

const UPSTREAM_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const ISSUE_PATH = '/api/volc-asr/issue-token';
const WS_PATH = '/api/volc-asr';

// Single shared store across dev / preview servers. Reset on process restart.
const tokenStore = createTokenStore();

// Periodic sweep so the map doesn't grow indefinitely if the dev server runs for days.
const sweepTimer = setInterval(() => {
  tokenStore.sweep();
}, 60_000);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

function readQuery(reqUrl: string | undefined): URLSearchParams {
  try {
    return new URL(reqUrl || '', 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

type IssueBody = { apiKey?: string; appId?: string; accessToken?: string };

function pickCreds(body: IssueBody | null): IssueBody | null {
  if (!body) return null;
  const apiKey = (body.apiKey ?? '').trim();
  const appId = (body.appId ?? '').trim();
  const accessToken = (body.accessToken ?? '').trim();
  if (apiKey) return { apiKey };
  if (appId && accessToken) return { appId, accessToken };
  return null;
}

/** Connect-style middleware reads the body and writes a JSON response.
 *
 *  ⚠️ NO AUTHENTICATION / NO CSRF — only safe because the dev server is bound to localhost.
 */
function attachIssueEndpoint(server: {
  middlewares: { use: (fn: (req: IncomingMessage, res: any, next: (err?: unknown) => void) => void) => void };
}) {
  server.middlewares.use(async (req, res, next) => {
    if (req.method !== 'POST' || req.url !== ISSUE_PATH) {
      return next();
    }
    try {
      const raw: unknown = await new Promise((resolve, reject) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          data += chunk;
        });
        req.on('end', () => {
          if (!data) return resolve(null);
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
        req.on('error', reject);
      });
      const creds = pickCreds(raw as IssueBody | null);
      if (!creds) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'missing_volc_asr_credentials' }));
        return;
      }
      const { token, expiresIn } = tokenStore.issue(creds, DEFAULT_TOKEN_TTL_MS);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ token, expiresIn }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
}

function attachVolcAsrUpgrade(server: {
  httpServer?: { on: (event: string, listener: (...args: any[]) => void) => void } | null;
}) {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    if (!url.startsWith(WS_PATH)) return;

    const qs = readQuery(url);
    const token = (qs.get('token') || '').trim();
    const resourceId = (qs.get('resourceId') || 'volc.bigasr.sauc.duration').trim();
    const requestId = (qs.get('requestId') || randomUUID()).trim();

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const creds = tokenStore.lookup(token);
    if (!creds) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const headers: Record<string, string> = {
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': requestId,
      'X-Api-Connect-Id': requestId,
      'X-Api-Sequence': '-1',
    };
    if (creds.apiKey) {
      headers['X-Api-Key'] = creds.apiKey;
    } else {
      // pickCreds() guarantees either apiKey OR (appId && accessToken), but TS doesn't
      // narrow — the `!` here is safe given the contract above.
      headers['X-Api-App-Key'] = creds.appId!;
      headers['X-Api-Access-Key'] = creds.accessToken!;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      let upstream: WebSocket;
      try {
        upstream = new WebSocket(UPSTREAM_URL, { headers });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        client.send(JSON.stringify({ error: msg }));
        client.close();
        return;
      }

      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      });
      upstream.on('error', (err) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ error: err.message || 'upstream error' }));
        }
      });
      upstream.on('close', () => {
        try {
          client.close();
        } catch {
          /* ignore */
        }
      });
      client.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: !!isBinary });
        }
      });
      client.on('close', () => {
        try {
          upstream.close();
        } catch {
          /* ignore */
        }
      });
      client.on('error', () => {
        try {
          upstream.close();
        } catch {
          /* ignore */
        }
      });
    });
  };

  server.httpServer?.on('upgrade', onUpgrade);
}

export function volcAsrProxyPlugin(): Plugin {
  return {
    name: 'spoor-volc-asr-proxy',
    configureServer(server) {
      attachIssueEndpoint(server);
      attachVolcAsrUpgrade(server);
    },
    configurePreviewServer(server) {
      attachIssueEndpoint(server);
      attachVolcAsrUpgrade(server);
    },
  };
}

/** Exposed for tests so they can introspect / reset the store between cases. */
export const __volcAsrTestHooks = {
  issue: tokenStore.issue,
  lookup: tokenStore.lookup,
  revoke: tokenStore.revoke,
  sweep: tokenStore.sweep,
  size: tokenStore.size,
  clear: tokenStore.clear,
};
