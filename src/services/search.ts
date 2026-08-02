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
  /** Source page URL (when available) */
  link?: string;
  /** Direct image URL from Metaso (`imageUrl`) */
  imageUrl?: string;
  /** Alternate thumbnail / preview URL */
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

function asHttpUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function looksLikeImageUrl(url: string): boolean {
  if (!url) return false;
  // Strip query/hash for extension checks; many CDNs omit extensions but are still images.
  const path = url.split('?')[0]?.split('#')[0] ?? url;
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\b|$)/i.test(path) || /\/image|img\.|cdn\.|pic\.|thumb/i.test(url);
}

/** Prefer Metaso `imageUrl`, then thumbnail, then an image-looking link. */
export function resolveMetasoImageUrl(img: MetasoImage): string {
  const imageUrl = asHttpUrl(img.imageUrl);
  if (imageUrl) return imageUrl;
  const thumb = asHttpUrl(img.thumbnail);
  if (thumb) return thumb;
  const link = asHttpUrl(img.link);
  if (link && looksLikeImageUrl(link)) return link;
  // Last resort: some payloads put the image in `link` without a clear extension.
  return link;
}

function normalizeMetasoImage(raw: unknown): MetasoImage | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const imageUrl =
    asHttpUrl(o.imageUrl) ||
    asHttpUrl(o.image_url) ||
    asHttpUrl(o.image) ||
    asHttpUrl(o.url) ||
    asHttpUrl(o.thumbnail) ||
    asHttpUrl(o.coverImage);
  const link =
    asHttpUrl(o.sourceUrl) ||
    asHttpUrl(o.source_url) ||
    asHttpUrl(o.link) ||
    asHttpUrl(o.pageUrl) ||
    '';
  const thumbnail = asHttpUrl(o.thumbnail) || asHttpUrl(o.coverImage) || '';
  const title =
    typeof o.title === 'string'
      ? o.title
      : typeof o.description === 'string'
        ? o.description
        : undefined;

  const normalized: MetasoImage = {
    title,
    link: link || undefined,
    imageUrl: imageUrl || undefined,
    thumbnail: thumbnail || undefined,
  };
  if (!resolveMetasoImageUrl(normalized)) return null;
  return normalized;
}

/** Normalize API payloads so callers always see `images[].imageUrl`. */
export function normalizeMetasoSearchResponse(raw: unknown): MetasoSearchResponse {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const webpages = Array.isArray(o.webpages) ? (o.webpages as MetasoWebpage[]) : [];
  const rawImages = Array.isArray(o.images) ? o.images : [];
  const images = rawImages
    .map((item) => normalizeMetasoImage(item))
    .filter((item): item is MetasoImage => item != null);

  if (rawImages.length > 0 && images.length === 0) {
    console.warn(`${LOG_PREFIX} received ${rawImages.length} image hits but none had a usable URL`, {
      sampleKeys: Object.keys((rawImages[0] as object) ?? {}),
    });
  }

  return {
    credits: typeof o.credits === 'number' ? o.credits : 0,
    total: typeof o.total === 'number' ? o.total : images.length || webpages.length,
    webpages,
    images,
  };
}

// ---------------------------------------------------------------------------
// Core search function
// ---------------------------------------------------------------------------

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
      return normalizeMetasoSearchResponse(JSON.parse(json));
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
        Accept: 'application/json',
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

    return normalizeMetasoSearchResponse(await response.json());
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
    const page = img.link && img.link !== url ? `\nPage: ${img.link}` : '';
    fragments.push(`[Image ${idx + 1}: ${title}]${url ? `(${url})` : ''}${page}`);
  });

  return [
    '--- Web search results ---',
    fragments.join('\n\n'),
    '--- End of search results ---',
  ].join('\n');
}
