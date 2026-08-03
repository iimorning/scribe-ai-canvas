import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { useAppDialog } from '../components/AppDialogProvider';
import {
  MINIMAX_DEFAULT_TTS_MODEL,
  MINIMAX_DEFAULT_VOICE_ID,
} from '../constants/voiceWriting';
import { callUniversalAI, formatAiError } from '../services/ai';
import { startMicCapture, type MicCapture } from '../services/micCapture';
import { hasVolcAsrCredentials, openVolcAsrSession, type VolcAsrSession } from '../services/volcAsr';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { createTtsSentenceQueue } from '../utils/ttsSentenceQueue';
import { parseLenientLlmJson } from '../utils/llmJson';
import { serializeOutlineForPrompt, type PublishOutline } from '../utils/parsePublishOutlineResponse';

export type OutlineVoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export type OutlineVoiceMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type UsePublishOutlineVoiceChatParams = {
  aiConfig: AIConfig | null;
  /** 当前大纲；每次修订后会由外部更新，hook 通过 ref 读取最新值 */
  outline: PublishOutline | null;
  /** AI 解析出新大纲后回调，外部用于更新弹窗 state */
  onOutlineRevised: (outline: PublishOutline) => void;
  /** 是否禁用（例如弹窗未打开） */
  disabled?: boolean;
};

interface VoiceRevisionPayload {
  summary: string;
  outline: PublishOutline;
}

function parseVoiceRevision(raw: string): VoiceRevisionPayload | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const data = parseLenientLlmJson(trimmed) as {
      summary?: unknown;
      outline?: unknown;
    };
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const outlineRaw = data.outline;
    if (!outlineRaw || typeof outlineRaw !== 'object' || Array.isArray(outlineRaw)) return null;
    const o = outlineRaw as { title?: unknown; sections?: unknown };
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const sectionsRaw = Array.isArray(o.sections) ? o.sections : null;
    if (!sectionsRaw) return null;
    const sections: PublishOutline['sections'] = [];
    for (const seg of sectionsRaw) {
      if (!seg || typeof seg !== 'object' || Array.isArray(seg)) continue;
      const s = seg as { cardId?: unknown; heading?: unknown; summary?: unknown };
      const cardId = typeof s.cardId === 'string' ? s.cardId.trim() : '';
      const heading = typeof s.heading === 'string' ? s.heading.trim() : '';
      const segSummary = typeof s.summary === 'string' ? s.summary.trim() : '';
      sections.push({ cardId, heading, summary: segSummary });
    }
    if (sections.length === 0) return null;
    return { summary, outline: { title, sections } };
  } catch {
    return null;
  }
}

export function usePublishOutlineVoiceChat({
  aiConfig,
  outline,
  onOutlineRevised,
  disabled,
}: UsePublishOutlineVoiceChatParams) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();

  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<OutlineVoicePhase>('idle');
  const [messages, setMessages] = useState<OutlineVoiceMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState('');

  const activeRef = useRef(false);
  const phaseRef = useRef<OutlineVoicePhase>('idle');
  const micRef = useRef<MicCapture | null>(null);
  const asrRef = useRef<VolcAsrSession | null>(null);
  const ttsRef = useRef<ReturnType<typeof createTtsSentenceQueue> | null>(null);
  const messagesRef = useRef<OutlineVoiceMessage[]>([]);
  const outlineRef = useRef<PublishOutline | null>(outline);
  const latestTranscriptRef = useRef('');
  const finishRoundRef = useRef<(() => string) | null>(null);
  const startingRef = useRef(false);

  outlineRef.current = outline;
  phaseRef.current = phase;
  messagesRef.current = messages;

  const setPhaseSync = useCallback((p: OutlineVoicePhase) => {
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

  useEffect(() => {
    if (disabled || !aiConfig) {
      if (activeRef.current) stop();
    }
  }, [disabled, aiConfig, stop]);

  const startListening = useCallback(async () => {
    if (!aiConfig) {
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

    const replaceTranscript = (text: string) => {
      if (!activeRef.current) return;
      latestTranscriptRef.current = text;
      setPartialTranscript(text);
    };

    const session = await openVolcAsrSession(creds, {
      onPartial: replaceTranscript,
      onDefinite: replaceTranscript,
      onError: (message) => {
        if (!activeRef.current) return;
        appAlert({ message });
        stop();
      },
      onClose: () => {
        if (!activeRef.current) return;
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
    const currentOutline = outlineRef.current;
    const outlineText = currentOutline
      ? serializeOutlineForPrompt(currentOutline)
      : t('publish.voice_no_outline');
    const history = messagesRef.current
      .map((m) => (m.role === 'user' ? `User: ${m.text}` : `Assistant: ${m.text}`))
      .join('\n');

    const userMsg: OutlineVoiceMessage = { role: 'user', text: userText };
    const assistantMsg: OutlineVoiceMessage = { role: 'assistant', text: '' };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    messagesRef.current = [...messagesRef.current, userMsg, assistantMsg];

    setPhaseSync('thinking');

    if (!aiConfig) {
      assistantMsg.text = t('voice.config_missing');
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...assistantMsg };
        return next;
      });
      return;
    }

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
          t('ai.prompts.outlineVoicePersona'),
          getLocaleDirective(),
        ),
        prompt: t('ai.prompts.outlineVoiceUser', {
          outline: outlineText,
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
        },
      });
    } catch (err) {
      assistantText = assistantText || (err instanceof Error ? err.message : String(err));
      assistantMsg.text = assistantText;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...assistantMsg };
        return next;
      });
    }

    // 解析 {summary, outline}：成功则更新大纲 + TTS 朗读 summary；失败则朗读简短错误
    const parsed = parseVoiceRevision(assistantText);
    if (parsed) {
      onOutlineRevised(parsed.outline);
      const speakText = parsed.summary || t('publish.voice_revised_default');
      tts.pushAccumulatedText(speakText);
      tts.flush();
      assistantMsg.text = parsed.summary || assistantText;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...assistantMsg };
        return next;
      });
    } else {
      const fallback = t('publish.voice_parse_failed');
      tts.pushAccumulatedText(fallback);
      tts.flush();
    }

    await tts.waitUntilIdle();
    if (ttsRef.current === tts) ttsRef.current = null;

    if (!activeRef.current) return;
    setPhaseSync('idle');
    await startListening();
  }, [aiConfig, appAlert, onOutlineRevised, setPhaseSync, startListening, t]);

  const toggle = useCallback(async () => {
    if (disabled) return;
    if (startingRef.current) return;
    if (activeRef.current) {
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
    } catch (e) {
      console.error('[Spoor] voice toggle start failed', { error: formatAiError(e) });
      stop();
    } finally {
      startingRef.current = false;
    }
  }, [disabled, runAiTurn, startListening, stop]);

  return { active, phase, messages, partialTranscript, toggle, stop };
}
