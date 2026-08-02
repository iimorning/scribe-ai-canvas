/**
 * Detect "search the web" / "search images" commands in the AI card follow-up box or voice transcript.
 * Returns `null` if the message is a normal follow-up / utterance.
 */

export type WebSearchKind = 'webpage' | 'image';

export interface WebSearchIntent {
  kind: WebSearchKind;
  explicitQuery: string;
}

const IMAGE_PREFIX_PATTERNS = [
  /^搜图\s*/,
  /^搜图片\s*/,
  /^图片搜索\s*/,
  /^搜索图片\s*/,
  /^查找图片\s*/,
  /^image\s*search\s*/i,
];

const WEBPAGE_PREFIX_PATTERNS = [
  /^联网搜索\s*/,
  /^联网检索\s*/,
  // ASR commonly transcribes “联网搜索” as these.
  /^全网搜索\s*/,
  /^全网检索\s*/,
  /^网上搜索\s*/,
  /^网络搜索\s*/,
  /^连网搜索\s*/,
  /^web\s*search\s*/i,
];

/**
 * Voice triggers (longer phrases first). Includes casual “搜索一下 / 帮我搜索”,
 * not only the product keyword “联网搜索”.
 */
const IMAGE_INLINE_TRIGGER = /搜图|搜图片|图片搜索|搜索图片|查找图片|image\s*search/i;

const WEBPAGE_INLINE_TRIGGER =
  /联网搜索|联网检索|全网搜索|全网检索|网上搜索|网络搜索|连网搜索|web\s*search|搜索一下|检索一下|搜一下|查一下|查一查|搜一搜|搜索下|帮我搜索|给我搜索|请搜索|搜索(?=[\s，,。？?！!]|$)/i;

/** Filler ASR often glues onto the trigger (“联网搜索功能”, “帮我…一下”). */
const QUERY_FILLER =
  /^(?:功能|一下|下|看看|查查|检索|搜一下|搜索一下)\s*/;

const POLITE_FILLER =
  /你能帮我|能不能帮我|可以帮我|能帮我|帮我|可不可以|请你|麻烦你|麻烦|请|你能|给我/g;

function cleanTrailingQuery(rest: string): string {
  return rest.replace(QUERY_FILLER, '').trim();
}

function buildInlineQuery(before: string, after: string): string {
  return `${before} ${after}`
    .replace(POLITE_FILLER, ' ')
    .replace(/[？?！!。，,、\s]+/g, ' ')
    .trim();
}

function matchPrefix(
  s: string,
  patterns: RegExp[],
  kind: WebSearchKind,
): WebSearchIntent | null {
  for (const re of patterns) {
    if (re.test(s)) {
      return { kind, explicitQuery: cleanTrailingQuery(s.replace(re, '')) };
    }
  }
  return null;
}

/**
 * Typed follow-up box: command must lead the message (product convention).
 */
export function parseThreadWebSearchIntent(raw: string): WebSearchIntent | null {
  const s = raw.trim();
  if (!s) return null;

  return (
    matchPrefix(s, IMAGE_PREFIX_PATTERNS, 'image') ||
    matchPrefix(s, WEBPAGE_PREFIX_PATTERNS, 'webpage')
  );
}

/**
 * Voice transcripts: accept mid-sentence and casual search asks
 * (“帮我搜索一下”, “查一下…”), not only a leading “联网搜索”.
 */
export function parseVoiceWebSearchIntent(raw: string): WebSearchIntent | null {
  const prefix = parseThreadWebSearchIntent(raw);
  if (prefix) return prefix;

  const s = raw.trim();
  if (!s) return null;

  const imageMatch = IMAGE_INLINE_TRIGGER.exec(s);
  if (imageMatch && imageMatch.index != null) {
    const before = s.slice(0, imageMatch.index);
    const after = cleanTrailingQuery(s.slice(imageMatch.index + imageMatch[0].length));
    const query = buildInlineQuery(before, after);
    if (query) return { kind: 'image', explicitQuery: query };
  }

  const match = WEBPAGE_INLINE_TRIGGER.exec(s);
  if (!match || match.index == null) return null;

  // Topic often comes before the ask (“最近 Kimi…帮我搜索一下”).
  const before = s.slice(0, match.index);
  const after = cleanTrailingQuery(s.slice(match.index + match[0].length));
  const query = buildInlineQuery(before, after);
  if (!query) return null;

  return { kind: 'webpage', explicitQuery: query };
}
