import { synthesizeMinimaxSpeech } from '../services/minimaxTts';
import { stripThinking } from './stripThinking';

const SENTENCE_END = /([。！？!?；;\n]+)/;

export type TtsQueueConfig = {
  apiKey: string;
  model?: string;
  voiceId?: string;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (message: string) => void;
};

/**
 * Find the longest common prefix of `a` and `b`.
 * Cheaper than computing suffix matches and works for the monotonic case (which is 99% of
 * streaming providers). Returns 0 if there's no shared prefix at all.
 */
function longestCommonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * Find the longest suffix of `a` that is also a prefix of `b`.
 * Fallback for the rare case where the provider rewinds slightly (e.g. drops a leading
 * character) — LCP would return 0, but the tail of `a` might still match a prefix of `b`.
 */
function overlapSuffixPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  for (let len = max; len > 0; len--) {
    if (a.endsWith(b.slice(0, len))) return len;
  }
  return 0;
}

/**
 * Dedupe anchor length between two accumulated strings. Returns the number of leading chars
 * of `next` that we have already accounted for (as queue entries or carry).
 */
function dedupeLength(prev: string, next: string): number {
  const lcp = longestCommonPrefix(prev, next);
  // If LCP covers the full previous content or comes within a small tolerance, trust it.
  if (lcp >= prev.length || (prev.length > 0 && lcp >= prev.length - 8)) {
    return lcp;
  }
  // Fallback: maybe the provider rewound a few chars; see if a suffix of prev still aligns.
  return overlapSuffixPrefix(prev, next);
}

function cutSentences(input: string): { sentences: string[]; carry: string } {
  const out: string[] = [];
  let carry = '';
  const parts = input.split(SENTENCE_END);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (!part) continue;
    if (SENTENCE_END.test(part)) continue;
    const delim = parts[i + 1];
    if (delim && SENTENCE_END.test(delim)) {
      out.push(part + delim);
      i++;
    } else if (i === parts.length - 1) {
      carry = part;
    } else {
      out.push(part);
    }
  }
  return { sentences: out, carry };
}

/**
 * Buffer streaming text, cut on sentence boundaries, synthesize & play in order.
 *
 * The provider's accumulated text is mostly monotonic but may be re-normalized (leading
 * whitespace, mid-stream corrections). We dedupe by anchoring against `seenConcat + carry`
 * via a longest-common-prefix with a tail-overlap fallback, then drop any sentence that
 * already appears at the tail of `seenConcat` so an erroneously re-delivered tail is skipped.
 */
export function createTtsSentenceQueue(config: TtsQueueConfig) {
  // The full cleaned accumulated text we have already processed, WITH original spacing.
  // Used as the LCP dedup anchor so inter-sentence spaces don't break alignment.
  let consumed = '';
  let carry = '';
  // Every sentence text we've ever enqueued — a sentence already spoken must never be
  // spoken again, regardless of where it sits in the stream.
  const spoken = new Set<string>();
  let closed = false;
  let speaking = false;
  const abort = new AbortController();
  const pendingTexts: string[] = [];
  let pumpRunning = false;
  let currentAudio: HTMLAudioElement | null = null;

  const setSpeaking = (v: boolean) => {
    if (speaking === v) return;
    speaking = v;
    config.onSpeakingChange?.(v);
  };

  const playBlob = (blob: Blob) =>
    new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
      };
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('Audio playback failed'));
      };
      void audio.play().catch((e) => {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });

  const enqueueSentence = (sentence: string) => {
    const t = sentence.trim();
    if (!t || closed) return;
    if (spoken.has(t)) return; // never repeat a sentence already spoken
    spoken.add(t);
    pendingTexts.push(t);
    void pump();
  };

  const pump = async () => {
    if (pumpRunning) return;
    if (closed) return;
    pumpRunning = true;
    setSpeaking(true);
    try {
      while (!closed && pendingTexts.length > 0) {
        const text = pendingTexts.shift()!;
        try {
          const blob = await synthesizeMinimaxSpeech({
            apiKey: config.apiKey,
            text,
            model: config.model,
            voiceId: config.voiceId,
            signal: abort.signal,
          });
          if (closed) break;
          await playBlob(blob);
        } catch (e) {
          if (closed || abort.signal.aborted) break;
          config.onError?.(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      pumpRunning = false;
      if (pendingTexts.length === 0) setSpeaking(false);
      else if (!closed) void pump();
    }
  };

  return {
    pushAccumulatedText(accumulated: string) {
      if (closed) return;
      // Never read chain-of-thought blocks aloud.
      const cleaned = stripThinking(accumulated);
      // Providers often normalize streaming boundaries with leading/trailing whitespace.
      // Trim both sides before matching so a ` 你好。` (leading space) dedupes correctly.
      const trimmed = cleaned.replace(/^\s+/u, '');
      if (!trimmed) return;
      const prior = consumed + carry;
      const overlap = dedupeLength(prior.replace(/\s+$/u, ''), trimmed);
      const newPart = trimmed.slice(overlap);
      // `consumed` mirrors the real streamed text (with spacing) so the next LCP aligns.
      consumed = trimmed;

      const { sentences, carry: nextCarry } = cutSentences(carry + newPart);
      for (const s of sentences) {
        enqueueSentence(s);
      }
      carry = nextCarry;
    },
    flush() {
      const t = carry.trim();
      if (t) {
        enqueueSentence(t);
        carry = '';
      }
    },
    async waitUntilIdle() {
      while (pumpRunning || pendingTexts.length > 0) {
        await new Promise((r) => setTimeout(r, 80));
        if (closed) break;
      }
    },
    stop() {
      closed = true;
      pendingTexts.length = 0;
      abort.abort();
      try {
        currentAudio?.pause();
      } catch {
        /* ignore */
      }
      currentAudio = null;
      setSpeaking(false);
    },
  };
}
