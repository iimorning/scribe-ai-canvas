import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronLeft, ChevronRight, GitBranch, Loader2, Mic, Square, StickyNote, Sparkles } from 'lucide-react';
import { db } from '../../db';
import type { BookNodeProps } from './types';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import type { BookContentBlock } from '../../utils/bookPayload';
import { tryParseBookContent } from '../../utils/bookPayload';
import {
  BOOK_READER_PAGE_LOCK_MS,
  BOOK_READER_SCROLL_END_SENTINEL,
  bookChapterFlipFromWheel,
  nextBookReaderScrollTop,
} from '../../utils/bookReaderScroll';
import { useBookVoiceChat } from '../../hooks/useBookVoiceChat';
import {
  BOOK_EXPAND_CHILD_HEIGHT,
  BOOK_EXPAND_CHILD_OFFSET_X,
  BOOK_EXPAND_CHILD_WIDTH,
  BOOK_EXPAND_HUB_HEIGHT,
  BOOK_EXPAND_HUB_WIDTH,
  bookExpandBranchLaneY,
  bookExpandClusterSize,
  spawnBookExpandBranchCard,
  spawnBookExpandHubCard,
} from '../../services/spawnBookExpandCards';
import {
  FLUX_IMAGE_CARD_HEIGHT,
  FLUX_IMAGE_CARD_WIDTH,
  fluxImageCardPos,
  spawnFluxImageCard,
} from '../../services/spawnFluxImageCards';
import type { BookVoiceCardSpawner } from '../../hooks/useBookVoiceChat';
import { findOpenCanvasPosition } from '../../utils/canvas';

function clampPageIndex(index: number, unitCount: number): number {
  if (unitCount <= 0) return 0;
  return Math.min(Math.max(0, index), unitCount - 1);
}

const HEADING_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'text-[1.35rem] font-bold tracking-wide text-[#2a2a26] leading-snug mt-1 mb-3 first:mt-0',
  2: 'text-[1.15rem] font-bold text-[#2a2a26] leading-snug mt-4 mb-2 first:mt-0',
  3: 'text-base font-semibold text-[#2a2a26] leading-snug mt-3 mb-2 first:mt-0',
  4: 'text-[0.95rem] font-semibold text-[#3a3a34] leading-snug mt-3 mb-1.5 first:mt-0',
  5: 'text-sm font-semibold text-[#3a3a34] leading-snug mt-2 mb-1 first:mt-0',
  6: 'text-sm font-medium text-[#4a4a44] leading-snug mt-2 mb-1 first:mt-0',
};

function BookUnitBody({
  blocks,
  fallbackText,
}: {
  blocks?: BookContentBlock[];
  fallbackText: string;
}) {
  if (!blocks || blocks.length === 0) {
    return <>{fallbackText}</>;
  }
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'image') {
          return (
            <figure key={`img-${i}`} className="my-3 first:mt-0 last:mb-0">
              <img
                src={block.src}
                alt={block.alt || ''}
                className="max-w-full h-auto mx-auto block rounded-sm"
                draggable={false}
              />
              {block.alt ? (
                <figcaption className="mt-1 text-[11px] font-sans text-[#8c8a84] text-center leading-snug">
                  {block.alt}
                </figcaption>
              ) : null}
            </figure>
          );
        }
        if (block.type === 'heading') {
          const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
          return (
            <Tag key={`h-${i}`} className={HEADING_CLASS[block.level]}>
              {block.text}
            </Tag>
          );
        }
        return (
          <div key={`txt-${i}`} className="whitespace-pre-wrap my-2 first:mt-0 last:mb-0">
            {block.text}
          </div>
        );
      })}
    </>
  );
}

export function BookNode({
  node,
  onExtractSelectionToCard,
  onAskAboutSelection,
  onExpandSelection,
  isExpanding = false,
  aiConfig,
  voiceChatDisabled,
  canvasTransform,
  canvasNodes,
  onFocusCanvasRect,
}: BookNodeProps) {
  const { t } = useTranslation();
  const book = useMemo(() => tryParseBookContent(node.content), [node.content]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreScrollPersistRef = useRef(false);
  const pageScrollLockUntilRef = useRef(0);
  const [askUi, setAskUi] = useState<{ top: number; left: number; text: string } | null>(null);

  const unitCount = book?.units.length ?? 0;
  const storedIndex = typeof node.bookPageIndex === 'number' ? node.bookPageIndex : 0;
  const safeIndex = clampPageIndex(storedIndex, unitCount);
  const unit = book?.units[safeIndex];
  const pageLabel = unit?.title?.trim() || String(safeIndex + 1);
  const sourceLabel = node.description || book?.title || t('nodes.book');
  const selectionSource = `${sourceLabel} · ${pageLabel}`;
  const storedScrollTop = typeof node.bookScrollTop === 'number' ? Math.max(0, node.bookScrollTop) : 0;

  // Keep persisted index in range if book content shrinks after a re-import.
  useEffect(() => {
    if (unitCount <= 0) return;
    if (storedIndex === safeIndex) return;
    void db.nodes.update(node.id, { bookPageIndex: safeIndex, bookScrollTop: 0 });
  }, [node.id, unitCount, storedIndex, safeIndex]);

  // Restore in-page scroll after refresh / page change (not on every liveQuery scroll write).
  useLayoutEffect(() => {
    setAskUi(null);
    const el = bodyRef.current;
    if (!el) return;
    const top = storedScrollTop;
    ignoreScrollPersistRef.current = true;
    el.scrollTop = top;
    // Re-apply after images/layout settle so a mid-page position isn't clamped to 0 height.
    const retry = window.setTimeout(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = top;
      ignoreScrollPersistRef.current = false;
    }, 80);
    return () => {
      window.clearTimeout(retry);
      ignoreScrollPersistRef.current = false;
    };
    // Intentionally only when page/node changes — not when bookScrollTop updates from scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, safeIndex]);

  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    };
  }, []);

  const clearAskUi = useCallback(() => setAskUi(null), []);

  const persistScrollTop = useCallback(
    (scrollTop: number) => {
      if (ignoreScrollPersistRef.current) return;
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = setTimeout(() => {
        void db.nodes.update(node.id, { bookScrollTop: Math.max(0, Math.round(scrollTop)) });
      }, 150);
    },
    [node.id],
  );

  const goToPage = useCallback(
    (next: number, scroll: 'start' | 'end' = 'start') => {
      const clamped = clampPageIndex(next, unitCount);
      clearAskUi();
      if (clamped === safeIndex) return;
      void db.nodes.update(node.id, {
        bookPageIndex: clamped,
        bookScrollTop: scroll === 'end' ? BOOK_READER_SCROLL_END_SENTINEL : 0,
      });
    },
    [unitCount, clearAskUi, safeIndex, node.id],
  );

  const goToPageRef = useRef(goToPage);
  goToPageRef.current = goToPage;
  const pageIndexRef = useRef(safeIndex);
  pageIndexRef.current = safeIndex;
  const pageCountRef = useRef(unitCount);
  pageCountRef.current = unitCount;
  const chapterFlipLockUntilRef = useRef(0);

  // Full-viewport in-page jumps; at top/bottom, wheel/arrow flips to prev/next chapter.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const stepPage = (direction: 1 | -1, now: number) => {
      const nextTop = nextBookReaderScrollTop({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        direction,
      });
      const canScrollFurther = Math.abs(nextTop - el.scrollTop) > 0.5;

      const tryChapterFlip = (): boolean => {
        const flip = bookChapterFlipFromWheel({
          canScrollFurther,
          direction,
          pageIndex: pageIndexRef.current,
          pageCount: pageCountRef.current,
        });
        if (!flip) return false;
        if (now < chapterFlipLockUntilRef.current) return true;
        chapterFlipLockUntilRef.current = now + BOOK_READER_PAGE_LOCK_MS;
        pageScrollLockUntilRef.current = now + BOOK_READER_PAGE_LOCK_MS;
        if (flip === 'next') goToPageRef.current(pageIndexRef.current + 1, 'start');
        else goToPageRef.current(pageIndexRef.current - 1, 'end');
        return true;
      };

      if (now < pageScrollLockUntilRef.current) {
        tryChapterFlip();
        return;
      }
      if (canScrollFurther) {
        pageScrollLockUntilRef.current = now + BOOK_READER_PAGE_LOCK_MS;
        el.scrollTop = nextTop;
        return;
      }
      tryChapterFlip();
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (e.deltaY === 0) return;
      const direction: 1 | -1 = e.deltaY > 0 ? 1 : -1;
      stepPage(direction, performance.now());
      e.preventDefault();
      e.stopPropagation();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.shiftKey) return; // shift+arrow = native text selection
      // Left/Right flip chapters directly (same as the bottom chevron buttons).
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        goToPageRef.current(pageIndexRef.current - 1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        goToPageRef.current(pageIndexRef.current + 1);
        return;
      }
      let direction: 1 | -1 | null = null;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') direction = 1;
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') direction = -1;
      if (direction === null) return;
      e.preventDefault();
      e.stopPropagation();
      stepPage(direction, performance.now());
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKeyDown);
    };
    // unitCount: bodyRef only mounts once parsed book units exist.
  }, [node.id, unitCount]);

  const askToolbarRef = useRef<HTMLDivElement>(null);
  /** True while pointer is down on the ask/expand bar (selection often clears on press). */
  const askToolbarArmedRef = useRef(false);
  /** Latest quote snapshot so actions still work if askUi is cleared mid-gesture. */
  const askQuoteRef = useRef<{ text: string; sourceLabel: string } | null>(null);

  useEffect(() => {
    if (askUi) {
      askQuoteRef.current = { text: askUi.text, sourceLabel: selectionSource };
    }
  }, [askUi, selectionSource]);

  const updateSelectionAsk = useCallback(() => {
    if (isExpanding) {
      setAskUi(null);
      return;
    }
    // Keep the action bar mounted while interacting with it.
    if (askToolbarArmedRef.current || askToolbarRef.current?.matches(':hover')) {
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
    const positionParent = bodyRef.current.parentElement ?? bodyRef.current;
    const host = positionParent.getBoundingClientRect();
    // Canvas pan/zoom scales screen coords; convert back to local CSS px.
    const scale = host.height / Math.max(1, positionParent.offsetHeight);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const first = rects[0] ?? range.getBoundingClientRect();
    const last = rects[rects.length - 1] ?? first;
    const toolbarW = 188;
    const toolbarH = 40;
    const gap = 8;

    // Prefer above the first line of the selection so the popup doesn't cover the quote.
    let top = (first.top - host.top) / scale - toolbarH - gap;
    if (top < 4) {
      top = (last.bottom - host.top) / scale + gap;
    }
    top = Math.min(Math.max(4, top), Math.max(4, positionParent.clientHeight - toolbarH - 4));

    const midX = (first.left + first.width / 2 - host.left) / scale;
    const left = Math.min(
      Math.max(8, midX - toolbarW / 2),
      Math.max(8, positionParent.clientWidth - toolbarW - 8),
    );

    setAskUi({ text, top, left });
  }, [isExpanding]);

  const dismissSelectionToolbar = useCallback(() => {
    askToolbarArmedRef.current = false;
    askQuoteRef.current = null;
    clearAskUi();
    window.getSelection()?.removeAllRanges();
  }, [clearAskUi]);

  const runExtractSelectionToCard = useCallback(() => {
    const quote = askQuoteRef.current;
    if (!quote || !onExtractSelectionToCard) return;
    onExtractSelectionToCard(quote.text, quote.sourceLabel, node.id);
    dismissSelectionToolbar();
  }, [onExtractSelectionToCard, dismissSelectionToolbar, node.id]);

  const runAskAboutSelection = useCallback(() => {
    const quote = askQuoteRef.current;
    if (!quote || !onAskAboutSelection) return;
    onAskAboutSelection(quote.text, quote.sourceLabel, node.id);
    dismissSelectionToolbar();
  }, [onAskAboutSelection, dismissSelectionToolbar, node.id]);

  const runExpandSelection = useCallback(() => {
    const quote = askQuoteRef.current;
    if (!quote || !onExpandSelection) return;
    onExpandSelection(quote.text, quote.sourceLabel);
    dismissSelectionToolbar();
  }, [onExpandSelection, dismissSelectionToolbar]);

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
  const hasHeadingBlocks = Boolean(unit?.blocks?.some((b) => b.type === 'heading'));
  // Avoid duplicating the chapter title when body already renders h1–h6.
  const showUnitTitle = Boolean(unit?.title && book.format === 'epub' && !hasHeadingBlocks);
  const showSelectionActions =
    askUi &&
    (onExtractSelectionToCard || onAskAboutSelection || onExpandSelection) &&
    !isExpanding;

  const voiceHubLayoutRef = useRef<{ hubId: string; hubX: number; hubY: number } | null>(null);
  const canvasTransformRef = useRef(canvasTransform);
  canvasTransformRef.current = canvasTransform;
  const canvasNodesRef = useRef(canvasNodes);
  canvasNodesRef.current = canvasNodes;
  const onFocusCanvasRectRef = useRef(onFocusCanvasRect);
  onFocusCanvasRectRef.current = onFocusCanvasRect;

  const voiceCardSpawner = useMemo<BookVoiceCardSpawner>(() => ({
    spawnHub: async (hubLabel, branchCount) => {
      const cluster = bookExpandClusterSize(branchCount);
      const transform = canvasTransformRef.current ?? { x: 0, y: 0, scale: 1 };
      const obstacles = (canvasNodesRef.current ?? []).filter((n) => n.id !== node.id);
      // Reserve the full hub+lane footprint in open space beside the book.
      const open = findOpenCanvasPosition({
        transform,
        obstacles: [node, ...obstacles],
        size: cluster,
        preferBeside: node,
        gap: 36,
      });
      const hubPos = {
        x: open.x,
        y: open.y + Math.max(0, (cluster.height - BOOK_EXPAND_HUB_HEIGHT) / 2),
      };
      const placed = await spawnBookExpandHubCard({
        bookNodeId: node.id,
        canvasId: node.canvasId ?? 'default',
        bookPos: {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        },
        hub: hubLabel,
        hubPos,
      });
      voiceHubLayoutRef.current = placed;
      onFocusCanvasRectRef.current?.({
        x: placed.hubX,
        y: placed.hubY,
        width: BOOK_EXPAND_HUB_WIDTH,
        height: BOOK_EXPAND_HUB_HEIGHT,
      });
      return { hubId: placed.hubId };
    },
    spawnBranch: async (hubId, branch, index, branchCount) => {
      const layout = voiceHubLayoutRef.current;
      if (!layout || layout.hubId !== hubId) return;
      await spawnBookExpandBranchCard({
        canvasId: node.canvasId ?? 'default',
        hubId,
        hubX: layout.hubX,
        hubY: layout.hubY,
        branch,
        index,
        branchCount,
      });
      const branchY = bookExpandBranchLaneY(layout.hubY, index, branchCount, BOOK_EXPAND_HUB_HEIGHT);
      onFocusCanvasRectRef.current?.({
        x: layout.hubX + BOOK_EXPAND_CHILD_OFFSET_X,
        y: branchY,
        width: BOOK_EXPAND_CHILD_WIDTH,
        height: BOOK_EXPAND_CHILD_HEIGHT,
      });
    },
    spawnImage: async (hubId, image, index, total) => {
      const layout = voiceHubLayoutRef.current;
      if (!layout || layout.hubId !== hubId) return;
      const pos = fluxImageCardPos(
        { x: layout.hubX, y: layout.hubY },
        index,
        total,
      );
      await spawnFluxImageCard({
        canvasId: node.canvasId ?? 'default',
        imageUrl: image.imageUrl,
        description: image.title,
        x: pos.x,
        y: pos.y,
        linkFromId: hubId,
      });
      onFocusCanvasRectRef.current?.({
        x: pos.x,
        y: pos.y,
        width: FLUX_IMAGE_CARD_WIDTH,
        height: FLUX_IMAGE_CARD_HEIGHT,
      });
    },
  }), [node]);

  const voice = useBookVoiceChat({
    aiConfig: aiConfig ?? null,
    pageContext: { text: unitText, label: selectionSource },
    disabled: !aiConfig || voiceChatDisabled,
    cardSpawner: voiceCardSpawner,
  });
  const voiceActive = voice.active;
  const voicePhase = voice.phase;
  const voicePartial = voice.partialTranscript;
  const voiceToggle = voice.toggle;
  const voiceStop = voice.stop;
  const voiceToggleRef = useRef(voiceToggle);
  voiceToggleRef.current = voiceToggle;
  const voiceStopRef = useRef(voiceStop);
  voiceStopRef.current = voiceStop;

  // Stop voice chat if the book node is removed while active.
  useEffect(() => {
    return () => {
      voiceStopRef.current?.();
    };
  }, []);

  const voicePhaseLabel =
    voicePhase === 'listening'
      ? t('voice.phase_listening')
      : voicePhase === 'thinking'
        ? t('voice.phase_thinking')
        : voicePhase === 'speaking'
          ? t('voice.phase_speaking')
          : t('voice.book_chat_title');

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
          tabIndex={-1}
          className={`h-full overflow-y-auto min-h-0 pr-1 custom-scrollbar text-sm font-serif leading-relaxed text-[#4a4a44] select-text cursor-text focus:outline-none${
            unit?.blocks?.length ? '' : ' whitespace-pre-wrap'
          }`}
          {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseUp={updateSelectionAsk}
          onScroll={(e) => persistScrollTop(e.currentTarget.scrollTop)}
        >
          {showUnitTitle && (
            <div className="text-[11px] font-sans font-semibold text-[#8c8a84] mb-2 tracking-wide">
              {unit?.title}
            </div>
          )}
          <BookUnitBody blocks={unit?.blocks} fallbackText={unitText} />
        </div>

        {showSelectionActions && askUi && (
          <div
            ref={askToolbarRef}
            className="absolute z-20 flex items-center gap-1 p-0.5 rounded-lg bg-white border border-[#E6E4DF] shadow-md"
            style={{ top: askUi.top, left: askUi.left }}
            data-no-drag=""
            onPointerDown={(e) => {
              // Keep selection; note: preventDefault suppresses mouse* events, so actions use pointerup.
              e.stopPropagation();
              e.preventDefault();
              askToolbarArmedRef.current = true;
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              askToolbarArmedRef.current = false;
            }}
            onPointerCancel={() => {
              askToolbarArmedRef.current = false;
            }}
          >
            {onExtractSelectionToCard && (
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#C2410C] text-white text-[11px] font-sans font-bold hover:bg-[#a0350a] transition-colors"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  askToolbarArmedRef.current = true;
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  runExtractSelectionToCard();
                }}
              >
                <StickyNote className="w-3 h-3" />
                {t('nodes.book_to_card')}
              </button>
            )}
            {onAskAboutSelection && (
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[#C2410C] text-[11px] font-sans font-bold hover:bg-[#FFF7ED] transition-colors"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  askToolbarArmedRef.current = true;
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  runAskAboutSelection();
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
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  askToolbarArmedRef.current = true;
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  runExpandSelection();
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!aiConfig || voiceChatDisabled || isExpanding}
            className={`p-1.5 rounded-md transition-colors disabled:opacity-30 ${
              voiceActive
                ? 'text-[#C2410C] bg-[#FFF7ED] ring-2 ring-[#C2410C]/25'
                : 'text-[#5a5a54] hover:bg-[#F4F1ED]'
            }`}
            aria-label={voiceActive ? t('voice.book_chat_stop') : t('voice.book_chat_start')}
            title={
              voiceActive
                ? `${voicePhaseLabel}${voicePartial ? ` · ${voicePartial}` : ''}`
                : t('voice.book_chat_start')
            }
            onClick={() => voiceToggleRef.current?.()}
          >
            {voicePhase === 'thinking' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : voicePhase === 'speaking' ? (
              <Square className="w-4 h-4" />
            ) : (
              <Mic className={`w-4 h-4 ${voiceActive && voicePhase === 'listening' ? 'animate-pulse' : ''}`} />
            )}
          </button>
          <button
            type="button"
            disabled={safeIndex <= 0 || isExpanding}
            className="p-1.5 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            aria-label={t('nodes.book_prev')}
            onClick={() => goToPage(safeIndex - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
        <span className="text-[11px] font-mono text-[#8c8a84] tabular-nums">
          {t('nodes.book_page', { current: safeIndex + 1, total: unitCount })}
          {book.format === 'pdf' ? ` · p.${pageLabel}` : ''}
        </span>
        <button
          type="button"
          disabled={safeIndex >= unitCount - 1 || isExpanding}
          className="p-1.5 rounded-md text-[#5a5a54] hover:bg-[#F4F1ED] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label={t('nodes.book_next')}
          onClick={() => goToPage(safeIndex + 1)}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
