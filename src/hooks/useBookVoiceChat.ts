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
import { hasVolcAsrCredentials, openVolcAsrSession, type VolcAsrSession } from '../services/volcAsr';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { createTtsSentenceQueue } from '../utils/ttsSentenceQueue';

export type BookVoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export type BookVoiceMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type UseBookVoiceChatParams = {
  aiConfig: AIConfig;
  /** Current page context; updated as the user flips pages. */
  pageContext: { text: string; label: string };
  /** Disable starting (e.g. when canvas voice mode is active). */
  disabled?: boolean;
};

export function useBookVoiceChat({ aiConfig, pageContext, disabled }: UseBookVoiceChatParams) {
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

  pageContextRef.current = pageContext;
  phaseRef.current = phase;
  messagesRef.current = messages;

  const setPhaseSync = useCallback((p: BookVoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const teardownSession = useCallback(() => {
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
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    startingRef.current = false;
    setActive(false);
    setPhaseSync('idle');
    teardownSession();
  }, [setPhaseSync, teardownSession]);

  useEffect(() => () => { teardownSession(); }, [teardownSession]);

  const startListening = useCallback(async () => {
    const creds = {
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
      resourceId: aiConfig.volcAsrResourceId,
    };
    if (!hasVolcAsrCredentials(creds)) {
      appAlert({ message: t('voice.need_asr_keys') });
      return;
    }
    const minimaxKey = (aiConfig.minimaxApiKey ?? '').trim();
    if (!minimaxKey) {
      appAlert({ message: t('voice.need_minimax_key') });
      return;
    }

    let accumulated = '';
    latestTranscriptRef.current = '';
    setPartialTranscript('');

    const session = await openVolcAsrSession(creds, {
      onPartial: (text) => {
        if (!activeRef.current) return;
        const merged = accumulated ? `${accumulated} ${text}` : text;
        latestTranscriptRef.current = merged;
        setPartialTranscript(merged);
      },
      onDefinite: (text) => {
        if (!activeRef.current) return;
        accumulated = accumulated ? `${accumulated} ${text}` : text;
        latestTranscriptRef.current = accumulated;
        setPartialTranscript(accumulated);
      },
      onError: (message) => {
        if (!activeRef.current) return;
        appAlert({ message });
        stop();
      },
      onClose: () => {
        if (!activeRef.current) return;
        // Unexpected close mid-listening: abort.
        stop();
      },
    });
    asrRef.current = session;

    const mic = await startMicCapture((pcm) => asrRef.current?.sendPcm(pcm));
    micRef.current = mic;

    finishRoundRef.current = () => {
      finishRoundRef.current = null;
      if (micRef.current) { void micRef.current.stop(); micRef.current = null; }
      if (asrRef.current) { asrRef.current.close(); asrRef.current = null; }
      const userText = latestTranscriptRef.current.trim();
      setPartialTranscript('');
      return userText;
    };

    setPhaseSync('listening');
  }, [aiConfig, appAlert, setPhaseSync, stop, t]);

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

    const minimaxKey = (aiConfig.minimaxApiKey ?? '').trim();
    const tts = createTtsSentenceQueue({
      apiKey: minimaxKey,
      model: aiConfig.minimaxTtsModel || MINIMAX_DEFAULT_TTS_MODEL,
      voiceId: aiConfig.minimaxVoiceId || MINIMAX_DEFAULT_VOICE_ID,
      onSpeakingChange: (speaking) => {
        if (speaking) setPhaseSync('speaking');
      },
      onError: (message) => appAlert({ message }),
    });
    ttsRef.current = tts;

    let assistantText = '';
    try {
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
        onStreamChunk: (acc) => {
          assistantMsg.text = acc;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { ...assistantMsg };
            return next;
          });
          tts?.pushAccumulatedText(acc);
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

    tts?.flush();
    await tts?.waitUntilIdle();
    if (ttsRef.current === tts) ttsRef.current = null;

    if (!activeRef.current) return;
    // Loop: resume listening for the next turn.
    setPhaseSync('idle');
    await startListening();
  }, [aiConfig, appAlert, setPhaseSync, startListening, t]);

  const toggle = useCallback(async () => {
    if (disabled) return;
    if (activeRef.current || startingRef.current) {
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
    startingRef.current = false;
    await startListening();
  }, [disabled, runAiTurn, startListening, stop]);

  return { active, phase, messages, partialTranscript, toggle, stop };
}

function formatAiError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
