/**
 * Detect "search the web" commands typed in the AI card follow-up box.
 * Returns `null` if the message is a normal follow-up.
 */
export function parseThreadWebSearchIntent(raw: string): { explicitQuery: string } | null {
  const s = raw.trim();
  if (!s) return null;

  const patterns = [
    /^联网搜索\s*/,
    /^联网检索\s*/,
    // ASR commonly transcribes “联网搜索” as “全网搜索”.
    /^全网搜索\s*/,
    /^全网检索\s*/,
    /^网上搜索\s*/,
    /^网络搜索\s*/,
    /^web\s*search\s*/i,
  ];

  for (const re of patterns) {
    if (re.test(s)) {
      const explicitQuery = s.replace(re, '').trim();
      return { explicitQuery };
    }
  }
  return null;
}
