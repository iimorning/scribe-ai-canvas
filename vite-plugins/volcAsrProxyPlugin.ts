/**
 * Vite plugin: proxy `/api/volc-asr` WebSocket to Volcengine openspeech,
 * injecting auth headers from query params (browsers cannot set WS headers).
 */
import type { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { randomUUID } from 'crypto';

const UPSTREAM_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

function readQuery(reqUrl: string | undefined): URLSearchParams {
  try {
    return new URL(reqUrl || '', 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function attachVolcAsrUpgrade(server: { httpServer?: { on: (event: string, listener: (...args: any[]) => void) => void } | null }) {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    if (!url.startsWith('/api/volc-asr')) return;

    const qs = readQuery(url);
    const apiKey = (qs.get('apiKey') || '').trim();
    const appId = (qs.get('appId') || '').trim();
    const accessToken = (qs.get('accessToken') || '').trim();
    const resourceId = (qs.get('resourceId') || 'volc.bigasr.sauc.duration').trim();
    const requestId = (qs.get('requestId') || randomUUID()).trim();

    if (!apiKey && !(appId && accessToken)) {
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
    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
    } else {
      headers['X-Api-App-Key'] = appId;
      headers['X-Api-Access-Key'] = accessToken;
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
      attachVolcAsrUpgrade(server);
    },
    configurePreviewServer(server) {
      attachVolcAsrUpgrade(server);
    },
  };
}
