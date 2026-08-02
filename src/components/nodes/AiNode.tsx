import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers2, Loader2, Send } from 'lucide-react';
import Markdown from 'react-markdown';
import { db } from '../../db';
import type { AiNodeProps } from './types';
import { isContentBlurPersistenceDisabled } from '../../config/persistence';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';

export function AiNode({
  node,
  editingNodeId,
  setEditingNodeId,
  onSubmitFollowUp,
  isFollowUpLoading,
  isFollowUpDisabled,
  isContentStreaming,
  webSearchSourceCount = 0,
  webSearchSourcesCollapsed = false,
  onToggleWebSearchSources,
}: AiNodeProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const followUpTaRef = useRef<HTMLTextAreaElement>(null);

  const showFollowUp = onSubmitFollowUp && !node.followUpSent;
  const showSourcesToggle = webSearchSourceCount > 1 && !!onToggleWebSearchSources;

  useLayoutEffect(() => {
    const el = followUpTaRef.current;
    if (!el || !showFollowUp) return;
    el.style.height = 'auto';
    const cap = 160;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 36), cap)}px`;
  }, [draft, showFollowUp]);

  const handleSubmit = () => {
    const msg = draft.trim();
    if (!msg || !onSubmitFollowUp || isFollowUpDisabled) return;
    onSubmitFollowUp(msg);
    setDraft('');
  };

  const renderAiBody = () =>
    editingNodeId === node.id ? (
      <div
        autoFocus
        className="whitespace-pre-wrap text-sm text-[#4a4a44] font-serif leading-relaxed focus:outline-none bg-[#EAE7E2]/50 rounded px-1 -mx-1 transition-colors cursor-text min-h-[40px]"
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => {
          if (!isContentBlurPersistenceDisabled()) {
            db.nodes.update(node.id, { content: e.currentTarget.innerText });
          }
          setEditingNodeId(null);
        }}
      >
        {node.content}
      </div>
    ) : isContentStreaming ? (
      <div className="whitespace-pre-wrap text-sm text-[#4a4a44] font-serif leading-relaxed min-h-[40px]">
        {node.content || (
          <span className="text-[#8c8a84] italic">{t('nodes.ai_streaming')}</span>
        )}
      </div>
    ) : (
      <div
        onClick={() => setEditingNodeId(node.id)}
        className="markdown-body text-sm text-[#4a4a44] font-serif leading-relaxed cursor-text min-h-[40px]"
      >
        <Markdown>{node.content}</Markdown>
      </div>
    );

  return (
    <div className="w-full h-full bg-[#F4F1ED] p-6 shadow-lg border border-[#E6E4DF] flex flex-col relative">
      {showSourcesToggle ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleWebSearchSources?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title={
            webSearchSourcesCollapsed
              ? t('nodes.expand_web_sources')
              : t('nodes.collapse_web_sources')
          }
          aria-label={
            webSearchSourcesCollapsed
              ? t('nodes.expand_web_sources')
              : t('nodes.collapse_web_sources')
          }
          className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-full border border-[#E6E4DF] bg-white/90 px-2 py-1 text-[10px] font-sans font-medium text-[#5a5a54] shadow-sm hover:border-[#C2410C]/50 hover:text-[#C2410C] transition-colors"
        >
          <Layers2 className="h-3.5 w-3.5" aria-hidden />
          <span>
            {webSearchSourcesCollapsed
              ? t('nodes.expand_web_sources_short')
              : t('nodes.collapse_web_sources_short')}
          </span>
          <span className="tabular-nums text-[#a8a6a0]">{webSearchSourceCount}</span>
        </button>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col" {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}>
      {node.userTurn ? (
        <>
          <div className="mb-3 shrink-0">
            <div className="text-sm text-[#1a1a1a] font-serif leading-relaxed border-l-2 border-[#C2410C]/35 pl-3 py-0.5 bg-white/50 rounded-r">
              {node.userTurn}
            </div>
          </div>
          <div className="min-h-0 max-h-[min(14rem,38vh)] overflow-y-auto pr-1 scrollbar-hide flex-1">
            {renderAiBody()}
          </div>
        </>
      ) : (
        <>
          <div className="min-h-0 max-h-[min(14rem,38vh)] overflow-y-auto pr-1 scrollbar-hide flex-1">
            {renderAiBody()}
          </div>
        </>
      )}
      </div>

      {showFollowUp ? (
        <div className="mt-2 shrink-0">
          <div className="relative">
            <textarea
              ref={followUpTaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={!!isFollowUpDisabled}
              placeholder={t('nodes.ai_follow_up_placeholder')}
              rows={1}
              className="w-full resize-none overflow-y-auto scrollbar-hide rounded-lg border border-[#E6E4DF]/90 bg-white/80 pl-3 pr-10 py-1.5 text-xs leading-snug text-[#1a1a1a] placeholder:text-[#a8a6a0] focus:outline-none focus:ring-1 focus:ring-[#C2410C]/30 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSubmit}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!!isFollowUpDisabled || !draft.trim()}
              title={t('nodes.ai_follow_up_send')}
              aria-label={t('nodes.ai_follow_up_send')}
              className="absolute bottom-1 right-1.5 flex items-center justify-center rounded-md p-1 text-[#C2410C] transition-colors hover:bg-[#EAE7E2]/80 hover:text-[#a33508] disabled:pointer-events-none disabled:opacity-40"
            >
              {isFollowUpLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
