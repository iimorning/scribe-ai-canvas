/**
 * Strip chain-of-thought / tool-call chrome from model output so it is never shown
 * on the canvas nor read aloud by TTS.
 *
 * Supports:
 *   - DeepSeek / MiniMax-M3 thinking: <think> ... </think>
 *   - Generic:                        <thought> ... </thought>
 *   - MiniMax-M3 tool-call namespace:  ]<]minimax[>[ … <tool_call> …
 *   - Bare tool-call markers:         [<tool_call> / <tool_call>
 *
 * Streaming-safe: while the model is still inside an open thinking block, return ''.
 * Tool-call markup is cut from the first marker to end (calls are for the runtime, not the user).
 */

const LT = '<';
const GT = '>';
const SL = '/';

const THINK_OPEN = LT + 'think' + GT;
const THINK_CLOSE = LT + SL + 'think' + GT;
const THOUGHT_OPEN = LT + 'thought' + GT;
const THOUGHT_CLOSE = LT + SL + 'thought' + GT;

/** MiniMax-M3 chat-template namespace token (see their jinja: ns_token). */
const MINIMAX_NS = ']<]minimax[>[';
/** Truncated / mistyped variant sometimes seen mid-stream. */
const MINIMAX_NS_LOOSE = ']<]minimax[>';

const TOOL_CALL_MARKERS = [
  MINIMAX_NS + '<tool_call>',
  MINIMAX_NS_LOOSE + '[<tool_call>',
  MINIMAX_NS_LOOSE + '<tool_call>',
  '[<tool_call>',
  '<tool_call>',
  '```tool_call',
] as const;

function stripToolChrome(text: string): string {
  let s = text;
  // Remove namespace tokens that prefix every MiniMax tool XML tag.
  if (s.includes(MINIMAX_NS)) s = s.split(MINIMAX_NS).join('');
  if (s.includes(MINIMAX_NS_LOOSE)) s = s.split(MINIMAX_NS_LOOSE).join('');

  let cut = -1;
  for (const marker of TOOL_CALL_MARKERS) {
    const i = s.indexOf(marker);
    if (i !== -1 && (cut === -1 || i < cut)) cut = i;
  }
  if (cut !== -1) s = s.slice(0, cut);

  // Drop orphan closing tool tags if any remain.
  s = s.replace(/<\/tool_call>/g, '');
  return s;
}

export function stripThinking(text: string): string {
  if (!text) return '';

  // <think> ... </think>
  const thinkOpen = text.lastIndexOf(THINK_OPEN);
  if (thinkOpen !== -1) {
    const thinkClose = text.indexOf(THINK_CLOSE, thinkOpen);
    if (thinkClose === -1) return ''; // still thinking
    return stripThinking(text.slice(thinkClose + THINK_CLOSE.length));
  }

  // <thought> ... </thought>
  const thoughtOpen = text.lastIndexOf(THOUGHT_OPEN);
  if (thoughtOpen !== -1) {
    const thoughtClose = text.indexOf(THOUGHT_CLOSE, thoughtOpen);
    if (thoughtClose === -1) return ''; // still thinking
    return stripThinking(text.slice(thoughtClose + THOUGHT_CLOSE.length));
  }

  return stripToolChrome(text);
}
