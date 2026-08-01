/**
 * Strip chain-of-thought / "thinking" blocks from model output so they are never shown
 * on the canvas nor read aloud by TTS.
 *
 * Supports the two common delimiter conventions (built from parts so the literal tags
 * are not stripped from source by tooling):
 *   - DeepSeek / MiniMax-M3 style: <think> ... </think>
 *   - Generic style:                <thought> ... </thought>
 *
 * Streaming-safe: `accumulated` grows monotonically. While the model is still inside an
 * open thinking block (opening tag seen, closing tag not yet), return '' so neither the
 * card nor TTS gets partial reasoning. Once the closing tag arrives, return only the
 * content after it. If no thinking tag is present, return the text unchanged.
 */

const LT = '<';
const GT = '>';
const SL = '/';

const THINK_OPEN = LT + 'think' + GT;
const THINK_CLOSE = LT + SL + 'think' + GT;
const THOUGHT_OPEN = LT + 'thought' + GT;
const THOUGHT_CLOSE = LT + SL + 'thought' + GT;

export function stripThinking(text: string): string {
  if (!text) return '';

  // <think> ... </think>
  const thinkOpen = text.lastIndexOf(THINK_OPEN);
  if (thinkOpen !== -1) {
    const thinkClose = text.indexOf(THINK_CLOSE, thinkOpen);
    if (thinkClose === -1) return ''; // still thinking
    // Recurse in case multiple blocks; take everything after the last close.
    return stripThinking(text.slice(thinkClose + THINK_CLOSE.length));
  }

  // <thought> ... </thought>
  const thoughtOpen = text.lastIndexOf(THOUGHT_OPEN);
  if (thoughtOpen !== -1) {
    const thoughtClose = text.indexOf(THOUGHT_CLOSE, thoughtOpen);
    if (thoughtClose === -1) return ''; // still thinking
    return stripThinking(text.slice(thoughtClose + THOUGHT_CLOSE.length));
  }

  return text;
}
