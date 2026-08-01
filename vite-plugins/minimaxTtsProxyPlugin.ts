/**
 * Development-only MiniMax TTS WebSocket proxy.
 *
 * Browsers cannot add an Authorization header during a WebSocket upgrade. The browser
 * exchanges its MiniMax key for a short-lived opaque token over same-origin HTTP, then opens
 * a same-origin WS. This proxy injects the Bearer key for the upstream connection.
 */
import type { IncomingMessage } from 'http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'stream';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

const ISSUE_PATH = '/api/minimax-tts/issue-token';
const WS_PATH = '/api/minimax-tts';
const UPSTREAM_URL = 'wss://api.minimaxi.com/ws/v1/t2a_v2';
const TOKEN_TTL_MS = 10 * 60 * 1000;

type TokenRecord = { apiKey: string; expiresAt: number };
const tokens = new Map<string, TokenRecord>();

function readQuery(reqUrl: string | undefined): URLSearchParams {
  return new URL(reqUrl || '', 'http://localhost').searchParams;
}

function issue(apiKey: string): { token: string; expiresIn: number } {
  const token = randomUUID();
  tokens.set(token, { apiKey, expiresAt: Date.now() + TOKEN_TTL_MS });
  return { token, expiresIn: TOKEN_TTL_MS / 1000 };
}

function lookup(token: string): string | null {
  const record = tokens.get(token);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    tokens.delete(token);
    return null;
  }
  return record.apiKey;
}

function attachIssueEndpoint(server: {
  middlewares: { use: (fn: (req: IncomingMessage, res: any, next: (err?: unknown) => void) => void) => void };
}) {
  server.middlewares.use(async (req, res, next) => {
    if (req.method !== 'POST' || req.url !== ISSUE_PATH) return next();
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => resolve(body));
        req.on('error', reject);
      });
      const parsed = raw ? JSON.parse(raw) as { apiKey?: unknown } : {};
      const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
      if (!apiKey) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'missing_minimax_api_key' }));
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(issue(apiKey)));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });
}

function attachWsProxy(server: {
  httpServer?: { on: (event: string, listener: (...args: any[]) => void) => void } | null;
}) {
  const wss = new WebSocketServer({ noServer: true });
  server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!(req.url || '').startsWith(WS_PATH)) return;
    const apiKey = lookup(readQuery(req.url).get('token') || '');
    if (!apiKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(UPSTREAM_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const queued: WebSocket.RawData[] = [];
      const forward = (data: WebSocket.RawData) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        else queued.push(data);
      };
      upstream.on('open', () => {
        for (const data of queued) upstream.send(data);
        queued.length = 0;
      });
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });
      upstream.on('error', (error) => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ event: 'error', error: error.message }));
      });
      upstream.on('close', () => {
        if (client.readyState === WebSocket.OPEN) client.close();
      });
      client.on('message', forward);
      client.on('close', () => upstream.close());
      client.on('error', () => upstream.close());
    });
  });
}

export function minimaxTtsProxyPlugin(): Plugin {
  return {
    name: 'spoor-minimax-tts-proxy',
    configureServer(server) {
      attachIssueEndpoint(server);
      attachWsProxy(server);
    },
    configurePreviewServer(server) {
      attachIssueEndpoint(server);
      attachWsProxy(server);
    },
  };
}
