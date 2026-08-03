import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Mic,
  MicOff,
  PenLine,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { AIConfig } from './AISettingsModal';
import type { CanvasNode } from '../db';
import { db } from '../db';
import { useAppDialog } from './AppDialogProvider';
import { buildPublishSourceMaterial } from '../utils/publishSourceMaterial';
import {
  generateArticleFromOutline,
  generatePublishOutline,
  revisePublishOutline,
} from '../utils/generateArticleFromOutline';
import type { PublishOutline, PublishOutlineSection } from '../utils/parsePublishOutlineResponse';
import { usePublishOutlineVoiceChat } from '../hooks/usePublishOutlineVoiceChat';
import { hasVolcAsrCredentials } from '../services/volcAsr';
import { getCanvasNodeContextText } from '../utils/canvasNodeContextText';
import { formatAiError } from '../services/ai';

interface PublishOutlineDialogProps {
  open: boolean;
  onClose: () => void;
  aiConfig: AIConfig;
  selectedIds: string[];
  dynamicNodes: CanvasNode[];
  nodesRef: React.RefObject<Record<string, HTMLElement | null>>;
  activeCanvasId: string;
  setActiveReferenceId: (id: string) => void;
  setActiveTab: (tab: string) => void;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
}

type Phase = 'loadingOutline' | 'ready' | 'revising' | 'generating';

function hasVoiceCredentials(aiConfig: AIConfig): boolean {
  return (
    hasVolcAsrCredentials({
      apiKey: aiConfig.volcAsrApiKey,
      appId: aiConfig.volcAsrAppId,
      accessToken: aiConfig.volcAsrAccessToken,
      resourceId: aiConfig.volcAsrResourceId,
    }) && Boolean((aiConfig.minimaxApiKey ?? '').trim())
  );
}

export function PublishOutlineDialog({
  open,
  onClose,
  aiConfig,
  selectedIds,
  dynamicNodes,
  nodesRef,
  activeCanvasId,
  setActiveReferenceId,
  setActiveTab,
  setSelectedNodes,
}: PublishOutlineDialogProps) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();

  const [phase, setPhase] = useState<Phase>('loadingOutline');
  const [outline, setOutline] = useState<PublishOutline | null>(null);
  const [revisionText, setRevisionText] = useState('');
  const [streamingOutlineText, setStreamingOutlineText] = useState('');
  const [streamingArticleText, setStreamingArticleText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sourceMaterialRef = useRef<ReturnType<typeof buildPublishSourceMaterial> | null>(null);

  const voiceEnabled = useMemo(() => hasVoiceCredentials(aiConfig), [aiConfig]);

  const handleOutlineRevised = useCallback((next: PublishOutline) => {
    setOutline(next);
    setError(null);
  }, []);

  const voice = usePublishOutlineVoiceChat({
    aiConfig,
    outline,
    onOutlineRevised: handleOutlineRevised,
    disabled: !open,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loadingOutline');
    setOutline(null);
    setError(null);
    setStreamingOutlineText('');
    setRevisionText('');

    const material = buildPublishSourceMaterial(
      selectedIds,
      dynamicNodes,
      (nodeId) => {
        const el = nodesRef.current[nodeId];
        return el ? getCanvasNodeContextText(el) : '';
      },
      (kind) => t(`canvas.search_type_${kind}`, { defaultValue: kind }),
      activeCanvasId,
    );
    sourceMaterialRef.current = material;

    (async () => {
      try {
        const result = await generatePublishOutline({
          aiConfig,
          promptContent: material.promptContent,
          fallbackTitle: t('ai.generated_article_title'),
          t,
          onStreamChunk: (acc) => {
            if (!cancelled) setStreamingOutlineText(acc);
          },
        });
        if (cancelled) return;
        if (!result) {
          setError(t('publish.outline_load_failed'));
          setPhase('ready');
          return;
        }
        setOutline(result);
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        const msg = formatAiError(e);
        console.error('[Spoor] generatePublishOutline failed', { error: msg });
        setError(`${t('publish.outline_load_failed')}\n\n${msg}`);
        setPhase('ready');
      } finally {
        if (!cancelled) setStreamingOutlineText('');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    selectedIds,
    dynamicNodes,
    activeCanvasId,
    aiConfig,
    t,
  ]);

  useEffect(() => {
    if (open) return;
    voice.stop();
    setPhase('loadingOutline');
    setOutline(null);
    setError(null);
    setRevisionText('');
    setStreamingOutlineText('');
    setStreamingArticleText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const updateSection = (idx: number, patch: Partial<PublishOutlineSection>) => {
    setOutline((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      return { ...prev, sections };
    });
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    setOutline((prev) => {
      if (!prev) return prev;
      const sections = [...prev.sections];
      const target = idx + dir;
      if (target < 0 || target >= sections.length) return prev;
      [sections[idx], sections[target]] = [sections[target], sections[idx]];
      return { ...prev, sections };
    });
  };

  const removeSection = (idx: number) => {
    setOutline((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.filter((_, i) => i !== idx);
      return { ...prev, sections };
    });
  };

  const addSection = () => {
    setOutline((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: [...prev.sections, { cardId: '', heading: '', summary: '' }],
      };
    });
  };

  const handleRevise = async () => {
    const instruction = revisionText.trim();
    if (!instruction || !outline || phase === 'revising') return;
    setPhase('revising');
    setError(null);
    try {
      const next = await revisePublishOutline({
        aiConfig,
        outline,
        instruction,
        t,
        onStreamChunk: (acc) => setStreamingOutlineText(acc),
      });
      if (next) {
        setOutline(next);
      } else {
        setError(t('publish.outline_revise_failed'));
      }
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] revisePublishOutline failed', { error: msg });
      setError(`${t('publish.outline_revise_failed')}\n\n${msg}`);
    } finally {
      setPhase('ready');
      setStreamingOutlineText('');
      setRevisionText('');
    }
  };

  const handleConfirmGenerate = async () => {
    if (!outline || phase === 'generating') return;
    const material = sourceMaterialRef.current;
    if (!material) {
      setError(t('publish.outline_load_failed'));
      return;
    }
    setPhase('generating');
    setError(null);
    setStreamingArticleText('');
    try {
      const newArticle = await generateArticleFromOutline({
        aiConfig,
        outline,
        promptContent: material.promptContent,
        mediaAssets: material.mediaAssets,
        cards: material.cards,
        activeCanvasId,
        t,
        onStreamChunk: (acc) => setStreamingArticleText(acc),
      });
      await db.articles.add(newArticle);
      setActiveReferenceId(newArticle.id);
      setActiveTab('reference');
      setSelectedNodes(new Set());
      onClose();
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] generateArticleFromOutline failed', { error: msg });
      void appAlert({
        message: `${t('publish.generate_failed')}\n\n${msg}`,
      });
      setPhase('ready');
    } finally {
      setStreamingArticleText('');
    }
  };

  const handleClose = () => {
    if (phase === 'loadingOutline' || phase === 'generating') return;
    voice.stop();
    onClose();
  };

  const voicePhaseLabel =
    voice.phase === 'listening'
      ? t('publish.voice_listening')
      : voice.phase === 'thinking'
        ? t('publish.voice_thinking')
        : voice.phase === 'speaking'
          ? t('publish.voice_speaking')
          : t('publish.voice_idle');

  const busy = phase === 'loadingOutline' || phase === 'revising' || phase === 'generating';

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/20 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl max-h-[88vh] bg-white rounded-2xl shadow-2xl border border-[#E6E4DF] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-0 flex items-center justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={phase === 'loadingOutline' || phase === 'generating'}
            className="p-1.5 rounded-lg text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-40 transition-colors"
            aria-label={t('dialog.cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
          {phase === 'loadingOutline' && (
            <div className="flex items-center gap-2 text-sm font-sans text-[#5a5a54]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('publish.outline_loading')}</span>
            </div>
          )}
          {phase === 'loadingOutline' && streamingOutlineText && (
            <pre className="text-xs font-mono text-[#8c8a84] whitespace-pre-wrap bg-[#FAF9F6] rounded-lg p-3 max-h-48 overflow-y-auto scrollbar-hide">
              {streamingOutlineText}
            </pre>
          )}

          {outline && (
            <>
              <div>
                <label className="block text-[11px] font-sans font-bold uppercase tracking-wider text-[#8c8a84] mb-1">
                  {t('publish.outline_article_title')}
                </label>
                <input
                  type="text"
                  value={outline.title}
                  onChange={(e) => setOutline({ ...outline, title: e.target.value })}
                  disabled={busy}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E4DF] bg-white text-sm font-sans text-[#1a1a1a] focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C]/30 disabled:bg-[#F4F1ED]"
                />
              </div>

              <div className="space-y-2">
                {outline.sections.map((s, i) => (
                  <div key={i} className="rounded-xl border border-[#E6E4DF] bg-white p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold text-[#C2410C] tabular-nums shrink-0">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={s.heading}
                        onChange={(e) => updateSection(i, { heading: e.target.value })}
                        disabled={busy}
                        placeholder={t('publish.outline_heading_placeholder')}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-[#E6E4DF] bg-white text-sm font-sans font-medium text-[#1a1a1a] focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C]/30 disabled:bg-[#F4F1ED]"
                      />
                      <button
                        type="button"
                        onClick={() => moveSection(i, -1)}
                        disabled={busy || i === 0}
                        className="p-1 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 transition-colors shrink-0"
                        aria-label={t('publish.outline_move_up')}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSection(i, 1)}
                        disabled={busy || i === outline.sections.length - 1}
                        className="p-1 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 transition-colors shrink-0"
                        aria-label={t('publish.outline_move_down')}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSection(i)}
                        disabled={busy}
                        className="p-1 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 transition-colors shrink-0"
                        aria-label={t('publish.outline_remove')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={s.summary}
                      onChange={(e) => updateSection(i, { summary: e.target.value })}
                      disabled={busy}
                      placeholder={t('publish.outline_summary_placeholder')}
                      rows={2}
                      className="w-full px-2 py-1.5 rounded-md border border-[#E6E4DF] bg-white text-xs font-sans text-[#4a4a44] leading-relaxed focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C]/30 disabled:bg-[#F4F1ED] resize-none"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addSection}
                  disabled={busy}
                  className="w-full py-2 rounded-xl border border-dashed border-[#E6E4DF] text-xs font-sans text-[#5a5a54] hover:bg-[#FAF9F6] hover:border-[#C2410C] hover:text-[#C2410C] disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('publish.outline_add_section')}
                </button>
              </div>
            </>
          )}

          {error && (
            <div className="text-xs font-sans text-[#C2410C] bg-[#FFF7ED] border border-[#C2410C]/20 rounded-lg p-3 whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 pb-5 pt-3 border-t border-[#F4F1ED] bg-[#FAF9F6] space-y-3">
          {voice.active && (
            <div className="max-h-32 overflow-y-auto scrollbar-hide space-y-1.5 text-xs font-sans leading-relaxed bg-white rounded-lg border border-[#E6E4DF] p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-sans font-bold uppercase tracking-wider text-[#C2410C] mb-1">
                {voice.phase === 'listening' && <Mic className="w-3 h-3 animate-pulse" />}
                {voice.phase === 'thinking' && <Loader2 className="w-3 h-3 animate-spin" />}
                {voice.phase === 'speaking' && <Square className="w-3 h-3" />}
                {voicePhaseLabel}
              </div>
              {voice.messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-[#5a5a54]' : 'text-[#1a1a1a]'}>
                  <span className="text-[9px] font-mono uppercase tracking-wider text-[#8c8a84] mr-1">
                    {m.role === 'user' ? 'You' : 'AI'}
                  </span>
                  {m.text || '…'}
                </div>
              ))}
              {voice.phase === 'listening' && voice.partialTranscript && (
                <div className="text-[#8c8a84] italic">{voice.partialTranscript}</div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                value={revisionText}
                onChange={(e) => setRevisionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleRevise();
                  }
                }}
                disabled={busy || !outline}
                placeholder={t('publish.revise_placeholder')}
                className="w-full pl-3 pr-10 py-2 rounded-lg border border-[#E6E4DF] bg-white text-sm font-sans text-[#1a1a1a] focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C]/30 disabled:bg-[#F4F1ED]"
              />
              <button
                type="button"
                onClick={() => voice.toggle()}
                disabled={!voiceEnabled || busy}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors disabled:opacity-30 ${
                  voice.active
                    ? 'text-[#C2410C] bg-[#FFF7ED]'
                    : 'text-[#5a5a54] hover:bg-[#F4F1ED]'
                }`}
                aria-label={voice.active ? t('publish.voice_stop') : t('publish.voice_start')}
                title={
                  !voiceEnabled
                    ? t('publish.voice_disabled_hint')
                    : voice.active
                      ? t('publish.voice_stop')
                      : t('publish.voice_start')
                }
              >
                {voice.active ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={handleRevise}
              disabled={busy || !revisionText.trim() || !outline}
              className="px-3 py-2 rounded-lg bg-[#1a1a1a] text-white text-sm font-sans font-bold hover:bg-[#333] disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
            >
              {phase === 'revising' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {phase === 'revising' ? t('publish.revise_applying') : t('publish.revise_apply')}
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={phase === 'loadingOutline' || phase === 'generating'}
              className="px-4 py-2 rounded-xl text-sm font-sans font-medium border border-[#E6E4DF] text-[#5a5a54] bg-white hover:bg-[#F4F1ED] disabled:opacity-40 transition-colors"
            >
              {t('dialog.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmGenerate}
              disabled={busy || !outline || outline.sections.length === 0}
              className="px-4 py-2 rounded-xl text-sm font-sans font-bold bg-[#C2410C] text-white hover:bg-[#a0350a] disabled:opacity-40 transition-colors flex items-center gap-1.5"
            >
              {phase === 'generating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
              {phase === 'generating' ? t('publish.generating') : t('publish.confirm_generate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
