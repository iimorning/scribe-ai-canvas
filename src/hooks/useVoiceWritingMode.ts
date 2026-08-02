import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { useAppDialog } from '../components/AppDialogProvider';
import {
  MINIMAX_DEFAULT_TTS_MODEL,
  MINIMAX_DEFAULT_VOICE_ID,
  VOLC_ASR_DEFAULT_RESOURCE_ID,
} from '../constants/voiceWriting';
import { db } from '../db';
import { callUniversalAI, formatAiError } from '../services/ai';
import { startMicCapture, type MicCapture } from '../services/micCapture';
import { buildSearchContext, metasoSearch } from '../services/search';
import {
  spawnWebSearchCardsFromImages,
  spawnWebSearchCardsFromPages,
} from '../services/spawnWebSearchNoteCards';
import { hasVolcAsrCredentials, openVolcAsrSession, type VolcAsrSession } from '../services/volcAsr';
import { getCanvasCenterPosition } from '../utils/canvas';
import { runCanvasStreamingAiCall } from '../utils/canvasStreamingAi';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { createTtsSentenceQueue } from '../utils/ttsSentenceQueue';
import { voiceAiPosition, voiceUserPosition, transformToFocusNode } from '../utils/voiceNoteLayout';
import { parseVoiceWebSearchIntent } from '../utils/webSearchCommand';
import type { CanvasTransform } from './useCanvasInteraction';

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

type UseVoiceWritingModeParams = {
  aiConfig: AIConfig;
  activeCanvasId: string;
  transformRef: RefObject<CanvasTransform>;
  setCanvasTransform: Dispatch<SetStateAction<CanvasTransform>>;
  /** When the user is typing in a note, ASR must not overwrite that note. */
  editingNodeId: string | null;
  setStreamingAiNodeId: (id: string | null) => void;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  isAnyAiBusy: boolean;
};

export function useVoiceWritingMode({
  aiConfig,
  activeCanvasId,
  transformRef,
  setCanvasTransform,
  editingNodeId,
  setStreamingAiNodeId,
  enterFullscreen,
  exitFullscreen,
  isAnyAiBusy,
}: UseVoiceWritingModeParams) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  /** Follow-along highlight while MiniMax TTS plays a sentence on an AI card. */
  const [ttsHighlight, setTtsHighlight] = useState<{ nodeId: string; sentence: string } | null>(null);

  const activeRef = useRef(false);
  const rowRef = useRef(0);
  const currentUserNoteIdRef = useRef<string | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const asrRef = useRef<VolcAsrSession | null>(null);
  const ttsRef = useRef<ReturnType<typeof createTtsSentenceQueue> | null>(null);
  const handlingUtteranceRef = useRef(false);
  const pausedListeningRef = useRef(false);
  const latestTranscriptRef = useRef('');
  const voicePhaseRef = useRef<VoicePhase>('idle');
  const editingNodeIdRef = useRef<string | null>(editingNodeId);
  editingNodeIdRef.current = editingNodeId;
  /** Assigned while a listening session is live; mic toggle calls this to commit the turn. */
  const finishListeningRoundRef = useRef<(() => void) | null>(null);
  // Synchronous gate: voiceModeActive is React state and lags behind ref writes by one tick,
  // so a fast double-click observes the same `false` in both closures and would launch two
  // sessions. `startingRef` is a ref so the second click sees `true` immediately.
  const startingRef = useRef(false);

  const setPhase = (p: VoicePhase) => {
    voicePhaseRef.current = p;
    setVoicePhase(p);
  };

  const teardownSession = useCallback(async () => {
    finishListeningRoundRef.current = null;
    const promises: Promise<void>[] = [];
    try {
      asrRef.current?.close();
    } catch {
      /* ignore */
    }
    asrRef.current = null;
    if (micRef.current) {
      promises.push(
        micRef.current.stop().catch(() => {
          /* best effort */
        }),
      );
      micRef.current = null;
    }
    try {
      ttsRef.current?.stop();
    } catch {
      /* ignore */
    }
    ttsRef.current = null;
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }, []);

  const focusNode = useCallback(
    (x: number, y: number) => {
      const scale = transformRef.current.scale || 1;
      setCanvasTransform(transformToFocusNode(x, y, scale));
    },
    [setCanvasTransform, transformRef],
  );

  async function rollbackOnStartFailure(e: unknown): Promise<void> {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Spoor] startVoiceMode failed', msg);
    void appAlert({
      message: /Permission|NotAllowed|麦克风|microphone/i.test(msg)
        ? t('voice.mic_denied')
        : t('voice.asr_error', { message: msg }),
    });
    startingRef.current = false;
    activeRef.current = false;
    await teardownSession();
    setVoiceModeActive(false);
    setStreamingAiNodeId(null);
    setPhase('idle');
    exitFullscreen();
  }

  const stopVoiceMode = useCallback(() => {
    activeRef.current = false;
    pausedListeningRef.current = true;
    handlingUtteranceRef.current = false;
    startingRef.current = false;
    latestTranscriptRef.current = '';
    finishListeningRoundRef.current = null;
    setTtsHighlight(null);
    void teardownSession().finally(() => {
      setStreamingAiNodeId(null);
      setVoiceModeActive(false);
      setPhase('idle');
      exitFullscreen();
    });
  }, [exitFullscreen, setStreamingAiNodeId, teardownSession]);

  const startListeningLoop = useCallback(async () => {
    if (!activeRef.current) return;

    await teardownSession();

    const creds = {
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
      resourceId: aiConfig.volcAsrResourceId || VOLC_ASR_DEFAULT_RESOURCE_ID,
    };

    latestTranscriptRef.current = '';

    // Volc result_type=full: every callback is the complete transcript so far. Replace
    // the note — do not concatenate, or revised hypotheses stack into an "echo".
    const applyTranscript = (incoming: string) => {
      const next = incoming.trim();
      if (!next || next === latestTranscriptRef.current) return;
      latestTranscriptRef.current = next;
      const id = currentUserNoteIdRef.current;
      // User clicked into the note to type — keep ASR for mic UX but don't clobber the editor.
      if (id && editingNodeIdRef.current === id) {
        console.log('[Spoor Voice] transcript skipped (user editing)', { id });
        return;
      }
      console.log('[Spoor Voice] transcript → db.update', { id, next });
      if (id) void db.nodes.update(id, { content: next });
    };

    const commitUtterance = (text: string) => {
      if (!activeRef.current || handlingUtteranceRef.current) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      handlingUtteranceRef.current = true;
      pausedListeningRef.current = true;
      latestTranscriptRef.current = '';
      finishListeningRoundRef.current = null;
      void teardownSession();
      void runAiTurn(trimmed).finally(() => {
        handlingUtteranceRef.current = false;
      });
    };

    finishListeningRoundRef.current = () => {
      if (!activeRef.current || handlingUtteranceRef.current) return;
      if (voicePhaseRef.current !== 'listening') return;
      const id = currentUserNoteIdRef.current;
      void (async () => {
        // Flush uncontrolled contentEditable → db before reading the note.
        const ae = document.activeElement;
        if (ae instanceof HTMLElement && ae.isContentEditable) {
          ae.blur();
          await Promise.resolve();
        }
        const row = id ? await db.nodes.get(id) : undefined;
        const text = (row?.content ?? latestTranscriptRef.current).trim();
        if (!text) {
          // Nothing spoken — treat mic-off as exiting voice mode.
          stopVoiceMode();
          return;
        }
        commitUtterance(text);
      })();
    };

    const session = await openVolcAsrSession(creds, {
      onPartial: (partial) => {
        console.log('[Spoor Voice] onPartial', JSON.stringify(partial));
        if (!activeRef.current || pausedListeningRef.current) {
          console.log('[Spoor Voice] onPartial dropped', { active: activeRef.current, paused: pausedListeningRef.current });
          return;
        }
        applyTranscript(partial);
      },
      onDefinite: (text) => {
        // Definite only finalizes transcript segments — never auto-starts the AI turn.
        console.log('[Spoor Voice] onDefinite (accumulate only)', JSON.stringify(text));
        if (!activeRef.current || pausedListeningRef.current) return;
        applyTranscript(text);
      },
      onError: (message) => {
        if (!activeRef.current) return;
        console.error('[Spoor] Volc ASR', message);
        void appAlert({ message: t('voice.asr_error', { message }) });
        // The session is gone — surface this as a stop so the hook returns to idle.
        stopVoiceMode();
      },
    });
    asrRef.current = session;
    console.log('[Spoor Voice] ASR session opened');

    let mic: MicCapture;
    try {
      mic = await startMicCapture((pcm) => {
        if (!activeRef.current || pausedListeningRef.current) return;
        asrRef.current?.sendPcm(pcm);
      });
    } catch (e) {
      if (!activeRef.current) return;
      await rollbackOnStartFailure(e);
      return;
    }

    // Race: user may have toggled off while getUserMedia was awaiting. If `activeRef` is now
    // false, immediately release the new mic instead of installing it.
    if (!activeRef.current) {
      await mic.stop().catch(() => {
        /* ignore */
      });
      return;
    }
    micRef.current = mic;
    setPhase('listening');
    pausedListeningRef.current = false;
    // Voice mode is now fully booted: release the synchronous startingRef so the next click
    // on the toolbar mic button can call stopVoiceMode() instead of being ignored as a
    // duplicate. Mirrors the rollback path which resets startingRef on failure/stop.
    startingRef.current = false;

    async function runAiTurn(userText: string) {
      if (!activeRef.current) return;

      const userNoteId = currentUserNoteIdRef.current;
      if (userNoteId) {
        await db.nodes.update(userNoteId, { content: userText });
      }

      const origin = originRef.current || getCanvasCenterPosition(transformRef.current);
      const aiPos = voiceAiPosition(origin, rowRef.current);

      const aiNodeId = crypto.randomUUID();
      const edgeId = crypto.randomUUID();
      await db.nodes.add({
        id: aiNodeId,
        canvasId: activeCanvasId,
        type: 'ai',
        content: '',
        x: aiPos.x,
        y: aiPos.y,
      });
      if (userNoteId) {
        await db.edges.add({
          id: edgeId,
          canvasId: activeCanvasId,
          from: userNoteId,
          to: aiNodeId,
        });
      }
      focusNode(aiPos.x, aiPos.y);
      setStreamingAiNodeId(aiNodeId);
      setPhase('thinking');

      const minimaxKey = (aiConfig.minimaxApiKey || '').trim();
      const tts =
        minimaxKey.length > 0
          ? createTtsSentenceQueue({
              apiKey: minimaxKey,
              model: aiConfig.minimaxTtsModel || MINIMAX_DEFAULT_TTS_MODEL,
              voiceId: aiConfig.minimaxVoiceId || MINIMAX_DEFAULT_VOICE_ID,
              onSpeakingChange: (speaking) => {
                if (!activeRef.current) return;
                if (speaking) setPhase('speaking');
              },
              onActiveSentenceChange: (sentence) => {
                if (!activeRef.current) return;
                if (!sentence) {
                  setTtsHighlight(null);
                  return;
                }
                setTtsHighlight({ nodeId: aiNodeId, sentence });
              },
              onError: (message) => {
                console.error('[Spoor] MiniMax TTS', message);
                void appAlert({ message: t('voice.tts_error', { message }) });
              },
            })
          : null;
      ttsRef.current = tts;

      let replyText = '';
      try {
        let aiPrompt = userText;
        const searchIntent = parseVoiceWebSearchIntent(userText);
        if (searchIntent) {
          const searchKey = (aiConfig.metasoApiKey || '').trim();
          const query = searchIntent.explicitQuery;
          if (!searchKey) {
            void appAlert({ message: t('nodes.search_no_metaso_key') });
            aiPrompt = '用户请求了联网搜索，但尚未配置秘塔搜索 API Key。请简洁说明这一点，并请用户在设置中配置后重试。';
          } else if (!query) {
            void appAlert({ message: t('nodes.search_need_text') });
            aiPrompt = '用户请求了联网搜索，但没有提供检索关键词。请简洁请用户补充关键词。';
          } else {
            try {
              const isImage = searchIntent.kind === 'image';
              const searchResult = await metasoSearch(query, {
                apiKey: searchKey,
                scope: isImage ? 'image' : 'webpage',
              });
              const pages = searchResult.webpages ?? [];
              const images = searchResult.images ?? [];
              const hitCount = isImage ? images.length : pages.length;
              if (hitCount === 0) {
                void appAlert({
                  message: isImage ? t('nodes.search_no_images') : t('nodes.search_no_results'),
                });
                aiPrompt = isImage
                  ? `用户搜图“${query}”但没有获得结果。请简洁告知用户，并建议更具体的检索词。`
                  : `用户联网搜索“${query}”但没有获得结果。请简洁告知用户，并建议更具体的检索词。`;
              } else {
                const searchContext = buildSearchContext(searchResult);
                // Show sources as linked cards without holding up the answer / TTS pipeline.
                if (isImage) {
                  void spawnWebSearchCardsFromImages(aiNodeId, aiPos, images, activeCanvasId);
                } else {
                  void spawnWebSearchCardsFromPages(aiNodeId, aiPos, pages, activeCanvasId);
                }
                aiPrompt = [
                  `用户的问题：${query}`,
                  isImage
                    ? '系统已经完成图片检索，结果如下（请直接据此回答，不要再发起搜索或工具调用）：'
                    : '系统已经完成网页检索，结果如下（请直接据此回答，不要再发起搜索或工具调用）：',
                  searchContext,
                  '要求：只用自然语言回答；禁止输出 tool_call、函数调用 JSON、XML 标签，或任何 ]<]minimax[> 之类的特殊标记；不要提及内部工具或检索流程；不确定处请说清楚。',
                ].join('\n\n');
              }
            } catch (e) {
              const msg = formatAiError(e);
              console.error('[Spoor] voice web search failed', msg);
              void appAlert({ message: `${t('nodes.search_failed')}\n\n${msg}` });
              aiPrompt = `用户联网搜索“${query}”时失败。请简洁告知用户搜索暂时不可用，并建议稍后重试。`;
            }
          }
        }

        replyText = await runCanvasStreamingAiCall({
          nodeId: aiNodeId,
          callAi: (onStreamChunk) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction: combineSystemParts(
                t('ai.prompts.voiceWritingPersona'),
                getLocaleDirective(),
              ),
              prompt: aiPrompt,
              onStreamChunk: (accumulated) => {
                onStreamChunk(accumulated);
                tts?.pushAccumulatedText(accumulated);
              },
            }),
        });

        tts?.flush();
        if (tts) {
          setPhase('speaking');
          await tts.waitUntilIdle();
        }

        if (!replyText) {
          try {
            await db.edges.delete(edgeId);
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        try {
          await db.edges.delete(edgeId);
        } catch {
          /* ignore */
        }
        const msg = formatAiError(e);
        console.error('[Spoor] voice AI turn failed', msg);
        void appAlert({ message: t('voice.ai_error', { message: msg }) });
      } finally {
        setStreamingAiNodeId(null);
        setTtsHighlight(null);
        ttsRef.current?.stop();
        ttsRef.current = null;
      }

      if (!activeRef.current) return;

      const nextOrigin = originRef.current || getCanvasCenterPosition(transformRef.current);
      const nextRow = rowRef.current + 1;
      rowRef.current = nextRow;
      const nextPos = voiceUserPosition(nextOrigin, nextRow);
      const nextUserId = crypto.randomUUID();
      await db.nodes.add({
        id: nextUserId,
        canvasId: activeCanvasId,
        type: 'text',
        content: '',
        x: nextPos.x,
        y: nextPos.y,
      });
      if (replyText) {
        await db.edges.add({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          from: aiNodeId,
          to: nextUserId,
        });
      }
      currentUserNoteIdRef.current = nextUserId;
      focusNode(nextPos.x, nextPos.y);
      await startListeningLoop();
    }
  }, [
    activeCanvasId,
    aiConfig,
    appAlert,
    exitFullscreen,
    focusNode,
    rollbackOnStartFailure,
    setStreamingAiNodeId,
    stopVoiceMode,
    t,
    teardownSession,
    transformRef,
  ]);

  const startVoiceMode = useCallback(async () => {
    // Synchronous guard so back-to-back clicks can't both start.
    if (startingRef.current) return;
    if (voiceModeActive || isAnyAiBusy) return;
    startingRef.current = true;

    const asrOk = hasVolcAsrCredentials({
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
    });
    if (!asrOk) {
      startingRef.current = false;
      void appAlert({ message: t('voice.need_asr_keys') });
      return;
    }
    if (!(aiConfig.minimaxApiKey || '').trim()) {
      startingRef.current = false;
      void appAlert({ message: t('voice.need_minimax_key') });
      return;
    }

    activeRef.current = true;
    setVoiceModeActive(true);
    rowRef.current = 0;
    handlingUtteranceRef.current = false;
    enterFullscreen();

    try {
      const { x, y } = getCanvasCenterPosition(transformRef.current);
      const userNoteId = crypto.randomUUID();
      await db.nodes.add({
        id: userNoteId,
        canvasId: activeCanvasId,
        type: 'text',
        content: '',
        x,
        y,
      });
      currentUserNoteIdRef.current = userNoteId;
      originRef.current = { x, y };
      focusNode(x, y);

      try {
        await startListeningLoop();
      } catch (e) {
        await rollbackOnStartFailure(e);
      }
    } catch (e) {
      await rollbackOnStartFailure(e);
    }
  }, [
    activeCanvasId,
    aiConfig,
    appAlert,
    enterFullscreen,
    exitFullscreen,
    focusNode,
    isAnyAiBusy,
    rollbackOnStartFailure,
    startListeningLoop,
    t,
    transformRef,
    voiceModeActive,
  ]);

  const toggleVoiceMode = useCallback(() => {
    if (startingRef.current) return; // mid-startup click — let the in-flight start resolve
    if (!voiceModeActive) {
      void startVoiceMode();
      return;
    }
    // Listening: mic-off ends this speaking turn (or exits if nothing was said).
    // Thinking / speaking: mic-off cancels the whole voice session.
    if (voicePhaseRef.current === 'listening' && !handlingUtteranceRef.current) {
      finishListeningRoundRef.current?.();
      return;
    }
    stopVoiceMode();
  }, [startVoiceMode, stopVoiceMode, voiceModeActive]);

  /**
   * Toolbar phase-chip stop:
   * - listening → finish this turn (same as mic)
   * - speaking → stop TTS only, then continue to the next listening note
   * - thinking → cancel the whole voice session
   */
  const stopVoiceActivity = useCallback(() => {
    if (!voiceModeActive || startingRef.current) return;
    const phase = voicePhaseRef.current;
    if (phase === 'speaking') {
      setTtsHighlight(null);
      try {
        ttsRef.current?.stop();
      } catch {
        /* ignore */
      }
      ttsRef.current = null;
      return;
    }
    if (phase === 'listening' && !handlingUtteranceRef.current) {
      finishListeningRoundRef.current?.();
      return;
    }
    stopVoiceMode();
  }, [stopVoiceMode, voiceModeActive]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      startingRef.current = false;
      void teardownSession();
      // Voice mode may have put the document in fullscreen; restore on unmount.
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {
          /* ignore */
        });
      }
    };
  }, [teardownSession]);

  return {
    voiceModeActive,
    voicePhase,
    ttsHighlight,
    toggleVoiceMode,
    stopVoiceMode,
    stopVoiceActivity,
  };
}
