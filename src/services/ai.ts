import { GoogleGenAI } from '@google/genai';
import { MIMO_TOKEN_PLAN_BASE_URL, resolveMimoApiKey } from '../constants/mimo';
import {
  DOUBAO_ARK_BASE_URL,
  DOUBAO_DEFAULT_MODEL,
  formatDoubaoKeyMissingError,
  resolveDoubaoApiKey,
} from '../constants/doubao';
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '../constants/deepseek';
import { MINIMAX_BASE_URL, MINIMAX_DEFAULT_MODEL } from '../constants/minimax';

const LOG_PREFIX = '[Scribe AI]';

/** For logs only — never log full API keys. */
export function maskApiKeyForLog(key: string | undefined): string {
  if (!key?.trim()) return '(empty)';
  const k = key.trim();
  if (k.length <= 12) return `${k.slice(0, 3)}…`;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

export function formatAiError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');
}

function parseOpenAiStyleErrorBody(raw: string, status: number): string {
  if (!raw.trim()) return `HTTP ${status} (empty body)`;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const errObj = j.error as Record<string, unknown> | string | undefined;
    if (typeof errObj === 'string') return errObj;
    if (errObj && typeof errObj === 'object') {
      const m = errObj.message;
      if (typeof m === 'string') return m;
    }
    const direct =
      (typeof j.message === 'string' && j.message) ||
      (typeof j.msg === 'string' && j.msg) ||
      (typeof j.detail === 'string' && j.detail);
    if (direct) return direct;
  } catch {
    /* not JSON */
  }
  return raw.length > 800 ? `${raw.slice(0, 800)}…` : raw;
}

function extractChatCompletionContent(data: unknown): string {
  const d = data as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = d?.choices?.[0]?.message?.content;
  if (content == null || content === '') {
    console.error(`${LOG_PREFIX} unexpected response (no choices[0].message.content)`, data);
    throw new Error('API returned no text content. Open DevTools → Console for the full response.');
  }
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .map((c) => {
        if (typeof c === 'object' && c !== null && 'text' in c) {
          const t = (c as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .filter(Boolean);
    if (texts.length > 0) return texts.join('');
  }
  return String(content);
}

/** Parse `data:image/...;base64,...` for multimodal APIs. */
export function parseImageDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const trimmed = dataUrl.trim();
  const m = /^data:(image\/[a-zA-Z0-9+.^-]+);base64,(.+)$/s.exec(trimmed);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function buildOpenAiUserContent(
  prompt: string,
  images: string[] | undefined,
): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  if (!images?.length) return prompt;
  const content: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: prompt }];
  for (const url of images) {
    if (parseImageDataUrl(url)) content.push({ type: 'image_url', image_url: { url } });
  }
  return content;
}

type AnthropicUserBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

function buildAnthropicUserContent(
  prompt: string,
  images: string[] | undefined,
): string | AnthropicUserBlock[] {
  if (!images?.length) return prompt;
  const blocks: AnthropicUserBlock[] = [{ type: 'text', text: prompt }];
  for (const url of images) {
    const p = parseImageDataUrl(url);
    if (p) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: p.mediaType, data: p.base64 },
      });
    }
  }
  return blocks;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

function buildGeminiUserPayload(
  prompt: string,
  images: string[] | undefined,
): string | GeminiPart[] {
  if (!images?.length) return prompt;
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const url of images) {
    const p = parseImageDataUrl(url);
    if (p) parts.push({ inlineData: { mimeType: p.mediaType, data: p.base64 } });
  }
  return parts;
}

async function postOpenAiCompatibleChat(
  apiKey: string,
  url: string,
  body: Record<string, unknown>,
  meta: { provider: string; model: string }
): Promise<string> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error('API Key 为空（或只有空格）。请在设置中粘贴 MiMo 的密钥（通常以 tp- 开头）。');
  }
  console.info(`${LOG_PREFIX} chat/completions request`, {
    provider: meta.provider,
    model: meta.model,
    url,
    runtime: isTauriRuntime() ? 'tauri' : 'web',
    apiKey: maskApiKeyForLog(key),
  });

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const text = await invoke<string>('openai_compatible_chat', { apiKey: key, url, body });
      return text;
    } catch (e) {
      const msg = formatAiError(e);
      console.error(`${LOG_PREFIX} Tauri invoke openai_compatible_chat failed`, msg);
      throw new Error(msg);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} network/fetch failed`, { url, error: formatAiError(e) });
    throw new Error(`Network error: ${formatAiError(e)}. If this is MiMo / Doubao / MiniMax in the browser, ensure Vite dev server is running (proxy /api/mimo, /api/doubao, /api/minimax) or use the desktop app.`);
  }

  const rawText = await response.text();
  if (!response.ok) {
    const msg = parseOpenAiStyleErrorBody(rawText, response.status);
    console.error(`${LOG_PREFIX} chat/completions HTTP error`, {
      status: response.status,
      url,
      bodyPreview: rawText.slice(0, 2000),
    });
    throw new Error(msg);
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    console.error(`${LOG_PREFIX} invalid JSON response`, rawText.slice(0, 2000));
    throw new Error('API returned non-JSON response. See console for preview.');
  }
  return extractChatCompletionContent(data);
}

/** Accumulate OpenAI-style SSE (`data: {...}\\n`) deltas from a fetch Response body. */
async function consumeOpenAiSseFromResponse(
  response: Response,
  onAccumulated: (full: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const rawText = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error('API returned non-JSON response.');
    }
    const content = extractChatCompletionContent(data);
    onAccumulated(content);
    return content;
  }

  const decoder = new TextDecoder();
  let carry = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '').trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataLine = trimmed.slice(5).trimStart();
      if (dataLine === '[DONE]') continue;
      try {
        const json = JSON.parse(dataLine) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const piece = json?.choices?.[0]?.delta?.content ?? '';
        if (piece) {
          full += piece;
          onAccumulated(full);
        }
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
  return full;
}

async function postOpenAiCompatibleChatWithOptionalStream(
  apiKey: string,
  url: string,
  body: Record<string, unknown>,
  meta: { provider: string; model: string },
  onStreamChunk?: (accumulated: string) => void,
): Promise<string> {
  if (!onStreamChunk) {
    return postOpenAiCompatibleChat(apiKey, url, body, meta);
  }

  const streamBody = { ...body, stream: true };

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    const streamId = crypto.randomUUID();
    const unlisten = await listen<{ id: string; text: string }>('lab-ai-stream', (event) => {
      if (event.payload.id !== streamId) return;
      onStreamChunk(event.payload.text);
    });
    try {
      return await invoke<string>('openai_compatible_chat_stream', {
        apiKey: apiKey.trim(),
        url,
        body: streamBody,
        streamId,
      });
    } finally {
      unlisten();
    }
  }

  const key = apiKey.trim();
  if (!key) {
    throw new Error('API Key 为空（或只有空格）。请在设置中粘贴 MiMo 的密钥（通常以 tp- 开头）。');
  }
  console.info(`${LOG_PREFIX} chat/completions stream`, {
    provider: meta.provider,
    model: meta.model,
    url,
    runtime: 'web',
    apiKey: maskApiKeyForLog(key),
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(streamBody),
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} stream network/fetch failed`, { url, error: formatAiError(e) });
    throw new Error(`Network error: ${formatAiError(e)}. If this is MiMo / Doubao / MiniMax in the browser, ensure Vite dev server is running (proxy /api/mimo, /api/doubao, /api/minimax) or use the desktop app.`);
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(parseOpenAiStyleErrorBody(errBody, response.status));
  }

  const full = await consumeOpenAiSseFromResponse(response, onStreamChunk);
  if (!full.trim()) {
    throw new Error('API returned an empty streamed response.');
  }
  return full;
}

export type CallAIFn = (params: {
  config: AiProviderConfig;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  /** `data:image/*;base64,...` URLs from canvas image nodes */
  images?: string[];
  onStreamChunk?: (accumulatedText: string) => void;
}) => Promise<string>;

export type AiProviderConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  localGgufPath?: string;
  localEnableThinking?: boolean;
};

export async function callUniversalAI({
  config,
  prompt,
  systemInstruction,
  temperature = 0.7,
  topP = 0.4,
  images,
  onStreamChunk,
}: {
  config: AiProviderConfig;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  images?: string[];
  onStreamChunk?: (accumulatedText: string) => void;
}): Promise<string> {
  const apiKeyTrimmed = (config.apiKey ?? '').trim();
  const useUserConfig = Boolean(apiKeyTrimmed);
  const mimoApiKey =
    config.provider === 'mimo' ? resolveMimoApiKey(apiKeyTrimmed) : '';
  const doubaoApiKey =
    config.provider === 'doubao' ? resolveDoubaoApiKey(apiKeyTrimmed) : '';

  if (config.provider === 'local_llama') {
    if (images?.length) {
      throw new Error(
        '本地 GGUF（llama.cpp）当前不支持在请求中附带图片。请改用在线多模态模型，或暂时移除与便签/Agent 相连的图片来源后再试。',
      );
    }
    if (!isTauriRuntime()) {
      throw new Error('本地 GGUF（内置 llama.cpp）仅在使用 Tauri 桌面版时可用，网页版请改用在线模型。');
    }
    const modelPath = (config.localGgufPath ?? '').trim();
    if (!modelPath) {
      throw new Error('请在设置中填写本地 GGUF 模型文件的完整路径。');
    }
    const { invoke } = await import('@tauri-apps/api/core');

    let logPath: string | null = null;
    try {
      logPath = await invoke<string>('get_local_llama_log_path');
    } catch {
      // 忽略：旧版本没有这个命令
    }

    const startedAt = Date.now();
    console.info(`${LOG_PREFIX} local_llama → invoke`, {
      modelPath: modelPath.slice(0, 80) + (modelPath.length > 80 ? '…' : ''),
      promptChars: prompt.length,
      systemChars: (systemInstruction ?? '').length,
      temperature,
      topP,
      maxTokens: 256,
      nCtx: 1024,
      logPath,
    });

    try {
      const out = await invoke<string>('local_llama_chat', {
        payload: {
          modelPath,
          systemInstruction: systemInstruction ?? null,
          userMessage: prompt,
          temperature,
          topP,
          maxTokens: 256,
          nCtx: 1024,
          enableThinking: config.localEnableThinking ?? false,
        },
      });
      console.info(`${LOG_PREFIX} local_llama ← done`, {
        elapsedMs: Date.now() - startedAt,
        outChars: (out ?? '').length,
      });
      const text = out ?? '';
      onStreamChunk?.(text);
      return text;
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      const msg = formatAiError(e);
      console.error(`${LOG_PREFIX} local_llama ← FAILED (${elapsedMs}ms)`, msg, { logPath });
      const suffix = logPath ? `\n\n详细日志：${logPath}` : '';
      throw new Error(`${msg}${suffix}`);
    }
  }

  if (config.provider === 'gemini') {
    const apiKey = useUserConfig ? apiKeyTrimmed : (process.env.GEMINI_API_KEY as string | undefined)?.trim();
    if (!apiKey) throw new Error("Gemini: API Key missing (set in Settings or GEMINI_API_KEY).");

    console.info(`${LOG_PREFIX} Gemini generateContent`, {
      model: useUserConfig ? config.model : 'gemini-3-flash-preview',
      apiKey: maskApiKeyForLog(apiKey),
    });

    const ai = new GoogleGenAI({ apiKey });
    const modelId = useUserConfig ? config.model : "gemini-3-flash-preview";

    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: buildGeminiUserPayload(prompt, images),
        config: {
          systemInstruction,
          temperature,
          topP
        }
      });
      const text = response.text || '';
      onStreamChunk?.(text);
      return text;
    } catch (e) {
      console.error(`${LOG_PREFIX} Gemini failed`, formatAiError(e));
      throw e instanceof Error ? e : new Error(formatAiError(e));
    }
  }

  if (config.provider === 'mimo' && !mimoApiKey) {
    throw new Error(
      'MiMo API Key 未配置。请在设置中粘贴 tp- 密钥，或在构建时设置 VITE_BUILTIN_MIMO_API_KEY。',
    );
  }

  if (config.provider === 'doubao' && !doubaoApiKey) {
    throw new Error(formatDoubaoKeyMissingError());
  }

  if (!useUserConfig && config.provider !== 'mimo' && config.provider !== 'doubao') {
    throw new Error(`API Key missing for provider "${config.provider}". Open Settings and paste your key.`);
  }

  if (
    config.provider === 'openai' ||
    config.provider === 'custom' ||
    config.provider === 'mimo' ||
    config.provider === 'deepseek' ||
    config.provider === 'doubao' ||
    config.provider === 'minimax'
  ) {
    const baseNormalized = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const mimoBase = (config.baseUrl || MIMO_TOKEN_PLAN_BASE_URL).replace(/\/$/, '');
    const deepseekBase = (config.baseUrl || DEEPSEEK_BASE_URL).replace(/\/$/, '');
    const doubaoBase = (config.baseUrl || DOUBAO_ARK_BASE_URL).replace(/\/$/, '');
    const minimaxBase = (config.baseUrl || MINIMAX_BASE_URL).replace(/\/$/, '');
    const chatUrl =
      config.provider === 'mimo'
        ? (isTauriRuntime() ? `${mimoBase}/chat/completions` : '/api/mimo/chat/completions')
        : config.provider === 'deepseek'
          ? (isTauriRuntime() ? `${deepseekBase}/chat/completions` : '/api/deepseek/chat/completions')
          : config.provider === 'doubao'
            ? (isTauriRuntime() ? `${doubaoBase}/chat/completions` : '/api/doubao/chat/completions')
            : config.provider === 'minimax'
              ? (isTauriRuntime() ? `${minimaxBase}/chat/completions` : '/api/minimax/v1/chat/completions')
              : `${baseNormalized}/chat/completions`;

    const model =
      config.model ||
      (config.provider === 'mimo'
        ? 'mimo-v2.5-pro'
        : config.provider === 'deepseek'
          ? DEEPSEEK_DEFAULT_MODEL
          : config.provider === 'doubao'
            ? DOUBAO_DEFAULT_MODEL
            : config.provider === 'minimax'
              ? MINIMAX_DEFAULT_MODEL
              : 'gpt-4o');
    const body = {
      model,
      messages: [
        ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
        { role: 'user' as const, content: buildOpenAiUserContent(prompt, images) }
      ],
      temperature,
      top_p: topP
    };

    const openAiKey =
      config.provider === 'mimo'
        ? mimoApiKey
        : config.provider === 'doubao'
          ? doubaoApiKey
          : apiKeyTrimmed;
    return postOpenAiCompatibleChatWithOptionalStream(openAiKey, chatUrl, body, {
      provider: config.provider,
      model,
    }, onStreamChunk);
  }

  if (config.provider === 'anthropic') {
    console.info(`${LOG_PREFIX} Anthropic messages`, {
      model: config.model || 'claude-3-5-sonnet-20240620',
      apiKey: maskApiKeyForLog(apiKeyTrimmed),
    });
    const response = await fetch(`https://api.anthropic.com/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKeyTrimmed,
        'anthropic-version': '2023-06-01',
        'dangerouslyAllowBrowser': 'true'
      },
      body: JSON.stringify({
        model: config.model || 'claude-3-5-sonnet-20240620',
        system: systemInstruction,
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildAnthropicUserContent(prompt, images) }],
        temperature
      })
    });

    if (!response.ok) {
      const raw = await response.text();
      const msg = parseOpenAiStyleErrorBody(raw, response.status);
      console.error(`${LOG_PREFIX} Anthropic HTTP error`, response.status, raw.slice(0, 2000));
      throw new Error(msg);
    }
    const data = await response.json();
    const blocks = data.content as Array<{ type?: string; text?: string }>;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      console.error(`${LOG_PREFIX} unexpected Anthropic response`, data);
      throw new Error('API returned no content blocks.');
    }
    const text = blocks
      .map((b) => {
        if (typeof b.text !== 'string') return '';
        if (b.type === 'image') return '';
        return b.text;
      })
      .join('');
    if (!text) {
      console.error(`${LOG_PREFIX} Anthropic returned no text blocks`, data);
      throw new Error('API returned no text content.');
    }
    onStreamChunk?.(text);
    return text;
  }

  throw new Error(`Provider not supported: ${config.provider}`);
}
