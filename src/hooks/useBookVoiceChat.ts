import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { useAppDialog } from '../components/AppDialogProvider';
import {
  MINIMAX_DEFAULT_TTS_MODEL,
  MINIMAX_DEFAULT_VOICE_ID,
} from '../constants/voiceWriting';
import { callUniversalAI } from '../services/ai';
import { startMicCapture, type MicCapture } from '../services/micCapture';
import type { BookExpandBranch, BookVoiceImageSpec } from '../services/spawnBookExpandCards';
import {
  parseBookVoiceReply,
  spokenBookVoiceBranchLine,
} from '../services/spawnBookExpandCards';
import { generateFluxDevImage, hasFlux302Credentials } from '../services/flux302';
import { hasVolcAsrCredentials, openVolcAsrSession, type VolcAsrSession } from '../services/volcAsr';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { createTtsSentenceQueue } from '../utils/ttsSentenceQueue';

export type BookVoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export type BookVoiceMessage = {
  role: 'user' | 'assistant';
  text: string;
};

/**
 * Progressive card sink: hub first, then one branch card as that viewpoint is spoken.
 */
export type BookVoiceCardSpawner = {
  spawnHub: (hubLabel: string, branchCount: number) => Promise<{ hubId: string }>;
  spawnBranch: (
    hubId: string,
    branch: BookExpandBranch,
    index: number,
    branchCount: number,
  ) => Promise<void>;
  /** Place a Flux illustration beside the current hub lane. */
  spawnImage?: (
    hubId: string,
    image: { title: string; imageUrl: string },
    index: number,
    total: number,
  ) => Promise<void>;
};

/** After the last ASR update, wait this long before auto-submitting the turn. */
const AUTO_SUBMIT_SILENCE_MS = 1300;

type UseBookVoiceChatParams = {
  /** Required when not disabled. The BookNode passes `aiConfig ?? null`; the hook
   *  treats null/undefined as "no voice chat possible" and stops the session. */
  aiConfig: AIConfig | null;
  /** Current page context; updated as the user flips pages. */
  pageContext: { text: string; label: string };
  /** Disable starting (e.g. when canvas voice mode is active). */
  disabled?: boolean;
  /**
   * Spawn viewpoint cards in sync with speech: hub before the intro, each branch
   * card right as that viewpoint starts being read aloud.
   */
  cardSpawner?: BookVoiceCardSpawner;
};

export function useBookVoiceChat({
  aiConfig,
  pageContext,
  disabled,
  cardSpawner,
}: UseBookVoiceChatParams) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();

  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<BookVoicePhase>('idle');
  const [messages, setMessages] = useState<BookVoiceMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState('');

  const activeRef = useRef(false);
  const phaseRef = useRef<BookVoicePhase>('idle');
  const micRef = useRef<MicCapture | null>(null);
  const asrRef = useRef<VolcAsrSession | null>(null);
  const ttsRef = useRef<ReturnType<typeof createTtsSentenceQueue> | null>(null);
  const messagesRef = useRef<BookVoiceMessage[]>([]);
  const pageContextRef = useRef(pageContext);
  const latestTranscriptRef = useRef('');
  const finishRoundRef = useRef<(() => string) | null>(null);
  const startingRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runAiTurnRef = useRef<(userText: string) => Promise<void>>(async () => {});
  const cardSpawnerRef = useRef(cardSpawner);
  cardSpawnerRef.current = cardSpawner;
  /**
   * Suppress onClose→stop while we intentionally tear down ASR (finishRound / stop).
   * Must stay true across the async WebSocket onclose tick, or stop() wipes the
   * transcript before runAiTurn and aborts the session with no reply.
   */
  const suppressAsrCloseStopRef = useRef(false);

  pageContextRef.current = pageContext;
  phaseRef.current = phase;
  messagesRef.current = messages;

  const setPhaseSync = useCallback((p: BookVoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const teardownSession = useCallback(() => {
    clearSilenceTimer();
    suppressAsrCloseStopRef.current = true;
    if (micRef.current) {
      void micRef.current.stop();
      micRef.current = null;
    }
    if (asrRef.current) {
      asrRef.current.close();
      asrRef.current = null;
    }
    if (ttsRef.current) {
      ttsRef.current.stop();
      ttsRef.current = null;
    }
    finishRoundRef.current = null;
    latestTranscriptRef.current = '';
    setPartialTranscript('');
  }, [clearSilenceTimer]);

  const stop = useCallback(() => {
    activeRef.current = false;
    startingRef.current = false;
    setActive(false);
    setPhaseSync('idle');
    teardownSession();
  }, [setPhaseSync, teardownSession]);

  useEffect(() => () => { teardownSession(); }, [teardownSession]);

  // Auto-stop an active session if the book gets disabled (canvas voice mode on)
  // or `aiConfig` is cleared from settings — otherwise the ASR socket, mic, and TTS
  // queue keep consuming resources and the floating panel stays mounted.
  useEffect(() => {
    if (disabled || !aiConfig) {
      if (activeRef.current) {
        stop();
      }
    }
  }, [disabled, aiConfig, stop]);

  const startListening = useCallback(async () => {
    if (!aiConfig) {
      // Auto-stop useEffect already guards the active case; defensive bail here
      // so a stale ref from a rapid enable/disable cycle can't crash on `null.x`.
      stop();
      return;
    }
    const creds = {
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
      resourceId: aiConfig.volcAsrResourceId,
    };
    if (!hasVolcAsrCredentials(creds)) {
      appAlert({ message: t('voice.need_asr_keys') });
      stop();
      return;
    }
    const minimaxKey = (aiConfig.minimaxApiKey ?? '').trim();
    if (!minimaxKey) {
      appAlert({ message: t('voice.need_minimax_key') });
      stop();
      return;
    }

    // Volc ASR result_type=full 模式下，每一帧 onPartial / onDefinite 都发累积全文
    // （参见 services/volcAsr.ts:253-267 注释）。直接以最新累积文本替换即可，不要追加。
    latestTranscriptRef.current = '';
    setPartialTranscript('');
    clearSilenceTimer();
    // New listen round — unexpected socket drops should stop again.
    suppressAsrCloseStopRef.current = false;

    const scheduleAutoSubmit = () => {
      clearSilenceTimer();
      if (!latestTranscriptRef.current.trim()) return;
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        if (!activeRef.current || phaseRef.current !== 'listening') return;
        const finish = finishRoundRef.current;
        if (!finish) return;
        const userText = finish();
        if (userText) void runAiTurnRef.current(userText);
      }, AUTO_SUBMIT_SILENCE_MS);
    };

    const replaceTranscript = (text: string) => {
      if (!activeRef.current) return;
      latestTranscriptRef.current = text;
      setPartialTranscript(text);
      if (text.trim()) scheduleAutoSubmit();
    };

    const session = await openVolcAsrSession(creds, {
      onPartial: replaceTranscript,
      onDefinite: replaceTranscript,
      onError: (message) => {
        if (!activeRef.current) return;
        if (suppressAsrCloseStopRef.current) return;
        appAlert({ message });
        stop();
      },
      onClose: () => {
        if (!activeRef.current) return;
        // finishRound / teardown close the socket on purpose — ws.onclose is async.
        if (suppressAsrCloseStopRef.current) return;
        stop();
      },
    });
    asrRef.current = session;

    const mic = await startMicCapture((pcm) => asrRef.current?.sendPcm(pcm));
    micRef.current = mic;

    finishRoundRef.current = () => {
      finishRoundRef.current = null;
      clearSilenceTimer();
      // Capture before close: async asr.onClose must not clear this via stop().
      const userText = latestTranscriptRef.current.trim();
      setPartialTranscript('');
      suppressAsrCloseStopRef.current = true;
      if (micRef.current) { void micRef.current.stop(); micRef.current = null; }
      if (asrRef.current) { asrRef.current.close(); asrRef.current = null; }
      return userText;
    };

    setPhaseSync('listening');
  }, [aiConfig, appAlert, clearSilenceTimer, setPhaseSync, stop, t]);

  const runAiTurn = useCallback(async (userText: string) => {
    const ctx = pageContextRef.current;
    const history = messagesRef.current
      .map((m) => (m.role === 'user' ? `User: ${m.text}` : `Assistant: ${m.text}`))
      .join('\n');

    const userMsg: BookVoiceMessage = { role: 'user', text: userText };
    const assistantMsg: BookVoiceMessage = { role: 'assistant', text: '' };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    messagesRef.current = [...messagesRef.current, userMsg, assistantMsg];

    setPhaseSync('thinking');

    if (!aiConfig) {
      // Bailout — the Auto-stop effect for `!aiConfig` may flip activeRef mid-turn.
      assistantMsg.text = t('voice.config_missing');
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...assistantMsg };
        return next;
      });
      return;
    }

    const minimaxKey = (aiConfig.minimaxApiKey ?? '').trim();
    const ttsOpts = {
      apiKey: minimaxKey,
      model: aiConfig.minimaxTtsModel || MINIMAX_DEFAULT_TTS_MODEL,
      voiceId: aiConfig.minimaxVoiceId || MINIMAX_DEFAULT_VOICE_ID,
      onSpeakingChange: (speaking: boolean) => {
        if (speaking) setPhaseSync('speaking');
      },
      onError: (message: string) => appAlert({ message }),
    };

    /** One TTS stream per spoken segment so we can await idle between viewpoints.
     *  Always `stop()` afterward — MiniMax keeps an AudioContext open until stop(),
     *  and leaking one context per summary/branch quickly OOMs the tab. */
    const speakSegment = async (text: string) => {
      const line = text.replace(/\s+/g, ' ').trim();
      if (!line || !activeRef.current) return;
      if (ttsRef.current) {
        ttsRef.current.stop();
        ttsRef.current = null;
      }
      const tts = createTtsSentenceQueue(ttsOpts);
      ttsRef.current = tts;
      try {
        tts.pushAccumulatedText(line);
        tts.flush();
        await tts.waitUntilIdle();
      } finally {
        tts.stop();
        if (ttsRef.current === tts) ttsRef.current = null;
      }
    };

    let assistantText = '';
    try {
      // Do not stream into TTS — the model returns JSON; segments are spoken after parse.
      assistantText = await callUniversalAI({
        config: aiConfig,
        systemInstruction: combineSystemParts(
          t('ai.prompts.bookVoicePersona'),
          getLocaleDirective(),
        ),
        prompt: t('ai.prompts.bookVoiceUser', {
          source: ctx.label,
          pageText: ctx.text,
          history: history || '',
          request: userText,
        }),
        onStreamChunk: () => {
          // Do not push raw JSON into React message state every token — that retains
          // large intermediate strings across many re-renders and can OOM the tab.
        },
      });
    } catch (err) {
      assistantText = assistantText || formatAiError(err);
      assistantMsg.text = assistantText;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...assistantMsg };
        return next;
      });
    }

    const parsed = parseBookVoiceReply(assistantText);
    if (parsed) {
      assistantMsg.text = parsed.summary;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...assistantMsg };
        return next;
      });

      const spawner = cardSpawnerRef.current;
      const branches = parsed.plan.branches;
      let hubId: string | null = null;
      if (spawner) {
        try {
          // Theme hub appears as the intro starts (open space reserved for full lane).
          hubId = (await spawner.spawnHub(parsed.plan.hub, branches.length)).hubId;
        } catch (err) {
          console.error('[Spoor] book voice spawn hub failed', err);
        }
      }

      // Kick off Flux illustrations while speech runs (do not block TTS).
      const imageJobs = startBookVoiceImages({
        images: parsed.images,
        hubId,
        apiKey: aiConfig.api302Key,
        spawner,
        activeRef,
        onMissingKey: () => {
          if (parsed.images.length > 0) {
            void appAlert({ message: t('voice.flux_need_key') });
          }
        },
        onError: (message) => {
          void appAlert({ message: t('voice.flux_error', { message }) });
        },
      });

      await speakSegment(parsed.summary);

      for (let i = 0; i < branches.length; i++) {
        if (!activeRef.current) return;
        const branch = branches[i]!;
        if (spawner && hubId) {
          try {
            // Card appears as this viewpoint begins — not earlier.
            await spawner.spawnBranch(hubId, branch, i, branches.length);
          } catch (err) {
            console.error('[Spoor] book voice spawn branch failed', err);
          }
        }
        await speakSegment(spokenBookVoiceBranchLine(branch));
      }

      await imageJobs;
    } else if (assistantText.trim()) {
      // Graceful fallback: plain prose still gets spoken; broken JSON gets a short notice.
      const trimmed = assistantText.trim();
      const looksBrokenJson = trimmed.startsWith('{') || trimmed.startsWith('[');
      const speakText = looksBrokenJson ? t('voice.book_voice_parse_failed') : trimmed;
      if (!looksBrokenJson) {
        assistantMsg.text = speakText;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...assistantMsg };
          return next;
        });
      }
      await speakSegment(speakText);
    }

    if (!activeRef.current) return;
    // Loop: resume listening for the next turn.
    setPhaseSync('idle');
    await startListening();
  }, [aiConfig, appAlert, setPhaseSync, startListening, t]);

  runAiTurnRef.current = runAiTurn;

  const toggle = useCallback(async () => {
    if (disabled) return;
    // While we're racing to bring up the session, ignore further taps. Without this
    // guard a fast double click resets `startingRef` (set false synchronously before
    // the await), falls into the "active" branch with `phaseRef === 'idle'`, and
    // tears down the half-open session — leaving a dangling ASR/mic handle that
    // the in-flight startListening will keep alive past teardown.
    if (startingRef.current) return;
    if (activeRef.current) {
      // Active: phase-aware stop.
      const p = phaseRef.current;
      if (p === 'listening' && finishRoundRef.current) {
        const userText = finishRoundRef.current();
        if (userText) {
          await runAiTurn(userText);
          return;
        }
      }
      stop();
      return;
    }
    startingRef.current = true;
    activeRef.current = true;
    setActive(true);
    try {
      await startListening();
    } finally {
      startingRef.current = false;
    }
  }, [disabled, runAiTurn, startListening, stop]);

  return { active, phase, messages, partialTranscript, toggle, stop };
}

function formatAiError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function startBookVoiceImages(options: {
  images: BookVoiceImageSpec[];
  hubId: string | null;
  apiKey: string | undefined;
  spawner: BookVoiceCardSpawner | undefined;
  activeRef: { current: boolean };
  onMissingKey: () => void;
  onError: (message: string) => void;
}): Promise<void> {
  const specs = options.images.slice(0, 2);
  if (specs.length === 0 || !options.spawner?.spawnImage || !options.hubId) return;
  if (!hasFlux302Credentials(options.apiKey)) {
    options.onMissingKey();
    return;
  }
  const apiKey = (options.apiKey ?? '').trim();
  const hubId = options.hubId;
  const spawnImage = options.spawner.spawnImage;

  await Promise.allSettled(
    specs.map(async (spec, index) => {
      try {
        const { url } = await generateFluxDevImage({ apiKey, prompt: spec.prompt });
        if (!options.activeRef.current) return;
        await spawnImage(hubId, { title: spec.title, imageUrl: url }, index, specs.length);
      } catch (err) {
        console.error('[Spoor] book voice flux image failed', err);
        options.onError(err instanceof Error ? err.message : String(err));
      }
    }),
  );
}
