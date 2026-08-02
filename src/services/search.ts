const LOG_PREFIX = '[Scribe AI][Search]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetasoSearchScope = 'webpage' | 'image';

export interface MetasoSearchConfig {
  apiKey: string;
  /** Default: webpage */
  scope?: MetasoSearchScope;
  /** Default: 5 */
  size?: number;
}

export interface MetasoWebpage {
  title: string;
  link: string;
  snippet: string;
  score: string;
  date: string;
}

export interface MetasoImage {
  title?: string;
  /** Source page or image URL */
  link: string;
  /** Prefer this for display when present */
  thumbnail?: string;
}

export interface MetasoSearchResponse {
  credits: number;
  total: number;
  webpages: MetasoWebpage[];
  images?: MetasoImage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
  );
}

/** Prefer thumbnail, then a direct image link. */
export function resolveMetasoImageUrl(img: MetasoImage): string {
  const thumb = (img.thumbnail || '').trim();
  if (/^https?:\/\//i.test(thumb)) return thumb;
  const link = (img.link || '').trim();
  if (/^https?:\/\//i.test(link)) return link;
  return '';
}

// ---------------------------------------------------------------------------
// Core search function
// ---------------------------------------------------------------------------

const METASO_ENDPOINT = 'https://metaso.cn/api/v1/search';
const SEARCH_TIMEOUT_MS = 15_000;

/**
 * Call the Metaso (秘塔) web search API.
 *
 * - **Tauri desktop**: uses a Rust-side HTTP command to avoid CORS.
 * - **Browser dev/preview**: uses the Vite `/api/metaso` proxy.
 */
export async function metasoSearch(
  query: string,
  config: MetasoSearchConfig,
): Promise<MetasoSearchResponse> {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new Error('Metaso API key is empty');
  }

  const scope: MetasoSearchScope = config.scope === 'image' ? 'image' : 'webpage';
  const size = Math.min(Math.max(config.size ?? 5, 1), 20);

  console.info(`${LOG_PREFIX} metasoSearch`, { query, scope, size });

  // ---- Tauri path --------------------------------------------------------
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const json = await invoke<string>('metaso_search', {
        apiKey,
        query,
        scope,
        size,
      });
      return JSON.parse(json) as MetasoSearchResponse;
    } catch (e) {
      console.error(`${LOG_PREFIX} Tauri metaso_search failed`, e);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // ---- Browser path (Vite proxy) -----------------------------------------
  const proxyUrl = `/api/metaso/api/v1/search`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        q: query,
        scope,
        size,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`${LOG_PREFIX} HTTP ${response.status}`, text.slice(0, 500));
      throw new Error(`Metaso search HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return (await response.json()) as MetasoSearchResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

/**
 * Turn raw search results into a text block that can be injected into an LLM
 * prompt as supplementary context.
 */
export function buildSearchContext(results: MetasoSearchResponse): string {
  const webpages = results.webpages ?? [];
  const images = results.images ?? [];
  if (webpages.length === 0 && images.length === 0) return '';

  const fragments: string[] = [];

  webpages.forEach((wp, idx) => {
    fragments.push(`[Source ${idx + 1}: ${wp.title}](${wp.link})\n${wp.snippet}`);
  });

  images.forEach((img, idx) => {
    const url = resolveMetasoImageUrl(img);
    const title = (img.title || 'Image').trim();
    fragments.push(
      `[Image ${idx + 1}: ${title}]${url ? `(${url})` : ''}${img.link && img.link !== url ? `\nPage: ${img.link}` : ''}`,
    );
  });

  return [
    '--- Web search results ---',
    fragments.join('\n\n'),
    '--- End of search results ---',
  ].join('\n');
}
