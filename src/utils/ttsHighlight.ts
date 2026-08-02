/**
 * Locate the span of `sentence` inside `content` for TTS follow-along highlighting.
 * Tolerates trailing whitespace / terminator drift between ASR-cleaned speech chunks
 * and the card's displayed markdown-ish text.
 */
export function findSentenceRange(
  content: string,
  sentence: string,
): { start: number; end: number } | null {
  if (!content || !sentence) return null;
  const needle = sentence.trim();
  if (!needle) return null;

  const extendEnd = (start: number, end: number): number => {
    let i = end;
    while (i < content.length && /[。．.！？!?；;\s]/u.test(content[i]!)) i += 1;
    return i;
  };

  const direct = content.indexOf(needle);
  if (direct >= 0) {
    return { start: direct, end: extendEnd(direct, direct + needle.length) };
  }

  const soft = needle.replace(/[。．.！？!?；;\n]+$/u, '').trim();
  if (soft && soft !== needle) {
    const softIdx = content.indexOf(soft);
    if (softIdx >= 0) {
      return { start: softIdx, end: extendEnd(softIdx, softIdx + soft.length) };
    }
  }

  // Whitespace-insensitive fallback (maps compact indices back to the original string).
  const compactMap: number[] = [];
  let compact = '';
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (/\s/u.test(ch)) continue;
    compactMap.push(i);
    compact += ch;
  }
  const compactNeedle = needle.replace(/\s+/gu, '');
  if (!compactNeedle) return null;
  const cStart = compact.indexOf(compactNeedle);
  if (cStart < 0) return null;
  const start = compactMap[cStart];
  const endIdx = compactMap[cStart + compactNeedle.length - 1];
  if (start == null || endIdx == null) return null;
  return { start, end: endIdx + 1 };
}
