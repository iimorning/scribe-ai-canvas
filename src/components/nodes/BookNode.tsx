import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronLeft, ChevronRight, GitBranch, Loader2, Sparkles } from 'lucide-react';
import type { BookNodeProps } from './types';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import { tryParseBookContent } from '../../utils/bookPayload';

export function BookNode({
  node,
  onAskAboutSelection,
  onExpandSelection,
  isExpanding = false,
}: BookNodeProps) {
  const { t } = useTranslation();
  const book = useMemo(() => tryParseBookContent(node.content), [node.content]);
  const [pageIndex, setPageIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [askUi, setAskUi] = useState<{ top: number; left: number; text: string } | null>(null);

  const unitCount = book?.units.length ?? 0;
  const safeIndex = unitCount === 0 ? 0 : Math.min(pageIndex, unitCount - 1);
  const unit = book?.units[safeIndex];
  const pageLabel = unit?.title?.trim() || String(safeIndex + 1);
  const sourceLabel = node.description || book?.title || t('nodes.book');
  const selectionSource = `${sourceLabel} · ${pageLabel}`;

  useEffect(() => {
    setPageIndex(0);
    setAskUi(null);
  }, [node.id, node.content]);

  const clearAskUi = useCallback(() => setAskUi(null), []);

  const updateSelectionAsk = useCallback(() => {
    if (isExpanding) {
      setAskUi(null);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !bodyRef.current) {
      setAskUi(null);
      return;
    }
    if (!bodyRef.current.contains(sel.anchorNode) || !bodyRef.current.contains(sel.focusNode)) {
      setAskUi(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) {
      setAskUi(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const host = bodyRef.current.getBoundingClientRect();
    const toolbarW = 188;
    setAskUi({
      text,
      top: Math.max(8, rect.top - host.top - 40),
      left: Math.min(Math.max(8, rect.left - host.left + rect.width / 2 - toolbarW / 2), Math.max(8, host.width - toolbarW - 8)),
    });
  }, [isExpanding]);

  useEffect(() => {
    const onSelChange = () => {
      requestAnimationFrame(updateSelectionAsk);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, [updateSelectionAsk]);

  if (!book || unitCount === 0) {
    return (
      <div className="w-full h-full bg-white p-5 shadow-lg border-2 border-[#E6E4DF] flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-[#C2410C]" />
          <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
            {t('nodes.book')}
          </span>
        </div>
        <p className="text-sm text-[#8c8a84] font-serif">{t('nodes.book_empty')}</p>
      </div>
    );
  }

  const formatBadge = book.format === 'pdf' ? 'PDF' : 'EPUB';
  const unitText = unit?.text?.trim() || t('nodes.book_page_no_text');
  const showSelectionActions = askUi && (onAskAboutSelection || onExpandSelection) && !isExpanding;

  return (
    <div
      className="w-full h-full bg-white p-4 shadow-lg border-2 border-[#E6E4DF] flex flex-col min-h-[280px]"
      style={{ outline: '1px solid transparent' }}
    >
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <BookOpen className="w-4 h-4 text-[#C2410C]" />
        <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#8c8a84]">
          {t('nodes.book')}
        </span>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#F4F1ED] text-[#8c8a84]">
          {formatBadge}
        </span>
        {isExpanding && (
          <span className="flex items-center gap-1 text-[10px] font-sans text-[#C2410C]">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('nodes.book_expanding')}
          </span>
        )}
        <span
          className="text-[10px] font-mono text-[#5a5a54] ml-auto truncate max-w-[140px]"
          title={sourceLabel}
        >
          {book.title || sourceLabel}
        </span>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={bodyRef}
          data-no-drag=""
          className="h-full overflow-y-auto min-h-0 pr-1 custom-scrollbar text-sm font-serif leading-relaxed text-[#4a4a44] select-text cursor-text whitespace-pre-wrap"
          {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseUp={updateSelectionAsk}
        >
          {unit?.title && book.format === 'epub' && (
            <div className="text-[11px] font-sans font-semibold text-[#8c8a84] mb-2 tracking-wide">
              {unit.title}
            </div>
          )}
          {unitText}
        </div>

        {showSelectionActions && askUi && (
          <div
            className="absolute z-10 flex items-center gap-1 p-0.5 rounded-lg bg-white border border-[#E6E4DF] shadow-md"
            style={{ top: askUi.top, left: askUi.left }}
            data-no-drag=""
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            {onAskAboutSelection && (
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#C2410C] text-white text-[11px] font-sans font-bold hover:bg-[#a0350a] transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onAskAboutSelection(askUi.text, selectionSource);
                  clearAskUi();
                  window.getSelection()?.removeAllRanges();
                }}
              >
                <Sparkles className="w-3 h-3" />
                {t('nodes.book_ask_ai')}
              </button>
            )}
            {onExpandSelection && (
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[#C2410C] text-[11px] font-sans font-bold hover:bg-[#FFF7ED] transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpandSelection(askUi.text, selectionSource);
                  clearAskUi();
                  window.getSelection()?.removeAllRanges();
                }}
              >
                <GitBranch className="w-3 h-3" />
                {t('nodes.book_expand')}
              </button>
            )}
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-[#E6E4DF] shrink-0"
        data-no-drag=""
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={safeIndex <= 0 || isExpanding}
          className="p-1.5 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label={t('nodes.book_prev')}
          onClick={() => {
            setPageIndex((i) => Math.max(0, i - 1));
            clearAskUi();
          }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-mono text-[#8c8a84] tabular-nums">
          {t('nodes.book_page', { current: safeIndex + 1, total: unitCount })}
          {book.format === 'pdf' ? ` · p.${pageLabel}` : ''}
        </span>
        <button
          type="button"
          disabled={safeIndex >= unitCount - 1 || isExpanding}
          className="p-1.5 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label={t('nodes.book_next')}
          onClick={() => {
            setPageIndex((i) => Math.min(unitCount - 1, i + 1));
            clearAskUi();
          }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
