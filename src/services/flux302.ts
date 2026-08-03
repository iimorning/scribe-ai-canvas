import { isTauriRuntime } from '../utils/isTauriRuntime';

const LOG_PREFIX = '[Spoor] flux302';
/**
 * 302.AI China host — more reliable from CN than api.302.ai.
 * Vite/Netlify proxy `/api/302` rewrites to this origin.
 */
export const FLUX302_UPSTREAM = 'https://api.302ai.cn';
/** Docs: https://doc.302.ai/408538615e0 */
const CREATE_PATH = '/flux/v1/flux-2-klein-4b';
/** Docs: GET /flux/v1/get_result?id=… */
const RESULT_PATH = '/flux/v1/get_result';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

export type Flux302GenerateOptions = {
  apiKey: string;
  prompt: string;
  width?: number;
  height?: number;
  signal?: AbortSignal;
};

export type Flux302GenerateResult = {
  url: string;
  taskId: string;
};

type FluxResultBody = {
  id?: string;
  polling_url?: string;
  status?: string;
  result?: {
    sample?: string;
    prompt?: string;
    seed?: number;
  };
  sample?: string;
  detail?: unknown;
  error?: string;
  message?: string;
};

function resolveUrl(pathAndQuery: string): string {
  if (isTauriRuntime()) {
    return `${FLUX302_UPSTREAM}${pathAndQuery}`;
  }
  return `/api/302${pathAndQuery}`;
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: 'application/json',
  };
}

function extractSampleUrl(body: FluxResultBody): string | null {
  const fromResult = (body.result?.sample ?? '').trim();
  if (/^https?:\/\//i.test(fromResult)) return fromResult;
  const top = (body.sample ?? '').trim();
  if (/^https?:\/\//i.test(top)) return top;
  return null;
}

function isReady(body: FluxResultBody): boolean {
  if (extractSampleUrl(body)) return true;
  const s = (body.status ?? '').toLowerCase();
  return s === 'ready' || s === 'success' || s === 'succeeded' || s === 'completed';
}

function isFailed(body: FluxResultBody): boolean {
  const s = (body.status ?? '').toLowerCase();
  return s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled';
}

function formatErrorBody(body: FluxResultBody, status: number): string {
  if (typeof body.error === 'string') return body.error;
  if (typeof body.message === 'string') return body.message;
  return JSON.stringify(body.detail ?? body) || `HTTP ${status}`;
}

async function queryFluxResult(
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<FluxResultBody> {
  const q = new URLSearchParams({ id: taskId });
  const res = await fetch(resolveUrl(`${RESULT_PATH}?${q}`), {
    method: 'GET',
    headers: authHeaders(apiKey),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as FluxResultBody;
  if (!res.ok) {
    throw new Error(`302 Flux query failed (HTTP ${res.status}): ${formatErrorBody(body, res.status)}`);
  }
  return body;
}

/**
 * Generate an image via 302.AI Flux-2-Klein-4b.
 * Prefers `sync: true` (returns Ready + sample URL); falls back to get_result polling.
 *
 * Pricing (docs): first MP ~0.014 PTC, then ~0.001 PTC / MP.
 */
export async function generateFluxDevImage(
  options: Flux302GenerateOptions,
): Promise<Flux302GenerateResult> {
  const apiKey = options.apiKey.trim();
  const prompt = options.prompt.replace(/\s+/g, ' ').trim();
  if (!apiKey) throw new Error('302.AI API key is empty');
  if (!prompt) throw new Error('Flux prompt is empty');

  const width = options.width ?? 1024;
  const height = options.height ?? 768;
  console.info(`${LOG_PREFIX} create`, { prompt: prompt.slice(0, 80), width, height });

  const res = await fetch(resolveUrl(CREATE_PATH), {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      width,
      height,
      output_format: 'jpeg',
      safety_tolerance: 2,
      // Sync returns { id, status: "Ready", result: { sample } } on 302ai.cn.
      sync: true,
    }),
    signal: options.signal,
  });

  const body = (await res.json().catch(() => ({}))) as FluxResultBody;
  if (!res.ok) {
    throw new Error(`302 Flux create failed (HTTP ${res.status}): ${formatErrorBody(body, res.status)}`);
  }

  const syncUrl = extractSampleUrl(body);
  const taskId = (body.id ?? '').trim() || 'sync';
  if (syncUrl && isReady(body)) {
    console.info(`${LOG_PREFIX} ready (sync)`, { taskId });
    return { url: syncUrl, taskId };
  }

  if (!taskId || taskId === 'sync') {
    throw new Error('302 Flux returned neither sample URL nor task id');
  }

  // Async fallback: poll /flux/v1/get_result
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new Error('302 Flux aborted');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (options.signal?.aborted) throw new Error('302 Flux aborted');

    const status = await queryFluxResult(apiKey, taskId, options.signal);
    const url = extractSampleUrl(status);
    if (url && isReady(status)) {
      console.info(`${LOG_PREFIX} ready (poll)`, { taskId });
      return { url, taskId };
    }
    if (isFailed(status)) {
      throw new Error(`302 Flux task failed (status=${status.status ?? 'unknown'})`);
    }
  }

  throw new Error('302 Flux timed out waiting for the image');
}

export function hasFlux302Credentials(apiKey: string | undefined | null): boolean {
  return !!(apiKey ?? '').trim();
}
