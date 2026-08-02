/**
 * Detect "search the web" commands in the AI card follow-up box or voice transcript.
 * Returns `null` if the message is a normal follow-up / utterance.
 */

const PREFIX_PATTERNS = [
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
const INLINE_TRIGGER =
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

/**
 * Typed follow-up box: command must lead the message (product convention).
 */
export function parseThreadWebSearchIntent(raw: string): { explicitQuery: string } | null {
  const s = raw.trim();
  if (!s) return null;

  for (const re of PREFIX_PATTERNS) {
    if (re.test(s)) {
      return { explicitQuery: cleanTrailingQuery(s.replace(re, '')) };
    }
  }
  return null;
}

/**
 * Voice transcripts: accept mid-sentence and casual search asks
 * (“帮我搜索一下”, “查一下…”), not only a leading “联网搜索”.
 */
export function parseVoiceWebSearchIntent(raw: string): { explicitQuery: string } | null {
  const prefix = parseThreadWebSearchIntent(raw);
  if (prefix) return prefix;

  const s = raw.trim();
  if (!s) return null;

  const match = INLINE_TRIGGER.exec(s);
  if (!match || match.index == null) return null;

  // Topic often comes before the ask (“最近 Kimi…帮我搜索一下”).
  const before = s.slice(0, match.index);
  const after = cleanTrailingQuery(s.slice(match.index + match[0].length));
  const query = buildInlineQuery(before, after);
  if (!query) return null;

  return { explicitQuery: query };
}
