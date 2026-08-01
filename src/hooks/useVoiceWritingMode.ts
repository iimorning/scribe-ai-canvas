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
import { hasVolcAsrCredentials, openVolcAsrSession, type VolcAsrSession } from '../services/volcAsr';
import { getCanvasCenterPosition } from '../utils/canvas';
import { runCanvasStreamingAiCall } from '../utils/canvasStreamingAi';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { createTtsSentenceQueue } from '../utils/ttsSentenceQueue';
import { nextVoiceNotePosition, transformToFocusNode } from '../utils/voiceNoteLayout';
import type { CanvasTransform } from './useCanvasInteraction';

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

type UseVoiceWritingModeParams = {
  aiConfig: AIConfig;
  activeCanvasId: string;
  transformRef: RefObject<CanvasTransform>;
  setCanvasTransform: Dispatch<SetStateAction<CanvasTransform>>;
  setEditingNodeId: (id: string | null) => void;
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
  setEditingNodeId,
  setStreamingAiNodeId,
  enterFullscreen,
  exitFullscreen,
  isAnyAiBusy,
}: UseVoiceWritingModeParams) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');

  const activeRef = useRef(false);
  const turnIndexRef = useRef(0);
  const currentUserNoteIdRef = useRef<string | null>(null);
  const lastAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const asrRef = useRef<VolcAsrSession | null>(null);
  const ttsRef = useRef<ReturnType<typeof createTtsSentenceQueue> | null>(null);
  const handlingUtteranceRef = useRef(false);
  const pausedListeningRef = useRef(false);
  // Synchronous gate: voiceModeActive is React state and lags behind ref writes by one tick,
  // so a fast double-click observes the same `false` in both closures and would launch two
  // sessions. `startingRef` is a ref so the second click sees `true` immediately.
  const startingRef = useRef(false);

  const setPhase = (p: VoicePhase) => {
    setVoicePhase(p);
  };

  const teardownSession = useCallback(async () => {
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

    const handleDefinite = (text: string) => {
      if (!activeRef.current || handlingUtteranceRef.current) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      handlingUtteranceRef.current = true;
      pausedListeningRef.current = true;
      void teardownSession();
      void runAiTurn(trimmed).finally(() => {
        handlingUtteranceRef.current = false;
      });
    };

    const session = await openVolcAsrSession(creds, {
      onPartial: (partial) => {
        console.log('[Spoor Voice] onPartial', JSON.stringify(partial));
        if (!activeRef.current || pausedListeningRef.current) {
          console.log('[Spoor Voice] onPartial dropped', { active: activeRef.current, paused: pausedListeningRef.current });
          return;
        }
        const id = currentUserNoteIdRef.current;
        console.log('[Spoor Voice] onPartial → db.update', { id, hasId: !!id });
        if (id) void db.nodes.update(id, { content: partial });
      },
      onDefinite: handleDefinite,
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

      const anchor = lastAnchorRef.current || getCanvasCenterPosition(transformRef.current);
      const aiPos = nextVoiceNotePosition(anchor, turnIndexRef.current);
      turnIndexRef.current += 1;

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
      lastAnchorRef.current = aiPos;
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
              onError: (message) => {
                console.error('[Spoor] MiniMax TTS', message);
                void appAlert({ message: t('voice.tts_error', { message }) });
              },
            })
          : null;
      ttsRef.current = tts;

      let replyText = '';
      try {
        replyText = await runCanvasStreamingAiCall({
          nodeId: aiNodeId,
          callAi: (onStreamChunk) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction: combineSystemParts(
                t('ai.prompts.voiceWritingPersona'),
                getLocaleDirective(),
              ),
              prompt: userText,
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
        ttsRef.current?.stop();
        ttsRef.current = null;
      }

      if (!activeRef.current) return;

      const nextPos = nextVoiceNotePosition(lastAnchorRef.current || aiPos, turnIndexRef.current);
      turnIndexRef.current += 1;
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
      lastAnchorRef.current = nextPos;
      setEditingNodeId(nextUserId);
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
    setEditingNodeId,
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
    turnIndexRef.current = 0;
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
      lastAnchorRef.current = { x, y };
      setEditingNodeId(userNoteId);
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
    setEditingNodeId,
    startListeningLoop,
    t,
    transformRef,
    voiceModeActive,
  ]);

  const toggleVoiceMode = useCallback(() => {
    if (startingRef.current) return; // mid-startup click — let the in-flight start resolve
    if (voiceModeActive) {
      stopVoiceMode();
    } else {
      void startVoiceMode();
    }
  }, [startVoiceMode, stopVoiceMode, voiceModeActive]);

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
    toggleVoiceMode,
    stopVoiceMode,
  };
}
