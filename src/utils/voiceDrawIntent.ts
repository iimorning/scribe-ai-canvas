/**
 * Detect spoken requests to generate an illustration in canvas voice mode.
 * Returns a short prompt fragment when the user asks to draw / illustrate.
 */
export function parseVoiceDrawIntent(raw: string): { prompt: string } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const patterns: RegExp[] = [
    /(?:画一张|画一幅|帮我画|生成一张图|生成图片|配一张图|配图|画个|画个图|文生图)\s*[:：]?\s*(.+)$/i,
    /(?:draw|illustrate|generate\s+(?:an?\s+)?(?:image|picture|illustration))\s*[:：]?\s*(.+)$/i,
    /^(.+?)(?:的)?(?:插画|配图|示意图)$/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    const captured = m?.[1]?.trim();
    if (captured && captured.length >= 2) {
      return { prompt: captured.slice(0, 280) };
    }
  }

  // Bare trigger with no payload — caller may fall back to recent context.
  if (
    /^(?:画一张|画一幅|帮我画|生成一张图|生成图片|配一张图|配图|文生图|draw|illustrate)[.!。！]?$/i.test(
      text,
    )
  ) {
    return { prompt: '' };
  }

  return null;
}
