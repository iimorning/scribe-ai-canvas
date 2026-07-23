import { synthesizeMinimaxSpeech } from '../services/minimaxTts';

const SENTENCE_END = /([。！？!?；;\n]+)/;

export type TtsQueueConfig = {
  apiKey: string;
  model?: string;
  voiceId?: string;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (message: string) => void;
};

/**
 * Buffer streaming text, cut on sentence boundaries, synthesize & play in order.
 */
export function createTtsSentenceQueue(config: TtsQueueConfig) {
  let buffer = '';
  let unsokenCarry = '';
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
    pendingTexts.push(t);
    void pump();
  };

  const pump = async () => {
    if (pumpRunning) return;
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
      let newPart = '';
      if (accumulated.startsWith(buffer)) {
        newPart = accumulated.slice(buffer.length);
      } else {
        unsokenCarry = '';
        newPart = accumulated;
      }
      buffer = accumulated;
      const combined = unsokenCarry + newPart;
      const parts = combined.split(SENTENCE_END);
      unsokenCarry = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? '';
        if (!part) continue;
        if (SENTENCE_END.test(part)) continue;
        const delim = parts[i + 1];
        if (delim && SENTENCE_END.test(delim)) {
          enqueueSentence(part + delim);
          i++;
        } else if (i === parts.length - 1) {
          unsokenCarry = part;
        } else {
          enqueueSentence(part);
        }
      }
    },
    flush() {
      if (unsokenCarry.trim()) {
        enqueueSentence(unsokenCarry);
        unsokenCarry = '';
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
