import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { CanvasNode } from '../db';
import {
  canvasNodeTypeLabelKey,
  searchCanvasNodes,
  type CanvasNodeSearchHit,
} from '../utils/canvasNodeSearch';

export interface CanvasNoteSearchProps {
  nodes: CanvasNode[];
  onFocusNode: (node: CanvasNode) => void;
}

export function CanvasNoteSearch({ nodes, onFocusNode }: CanvasNoteSearchProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const hits = useMemo(() => searchCanvasNodes(nodes, query), [nodes, query]);
  const showResults = expanded && query.trim().length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!expanded) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setExpanded(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded]);

  const collapse = () => {
    setExpanded(false);
    setQuery('');
  };

  const focusHit = (hit: CanvasNodeSearchHit) => {
    onFocusNode(hit.node);
    collapse();
  };

  return (
    <div ref={rootRef} className="relative">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="bg-white text-[#1a1a1a] p-3 rounded-full shadow-md hover:bg-[#F4F1ED] transition-all flex items-center justify-center border border-[#E6E4DF] group"
          title={t('canvas.search_notes')}
          aria-label={t('canvas.search_notes')}
        >
          <Search className="w-5 h-5 transition-transform group-hover:scale-110" />
        </button>
      ) : (
        <div className="flex items-center gap-2 h-11 pl-3 pr-3 rounded-full bg-white border border-[#E6E4DF] shadow-md focus-within:border-[#C2410C]/50 transition-all w-[200px] sm:w-[240px]">
          <Search className="w-4 h-4 text-[#8c8a84] shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (query) {
                  setQuery('');
                } else {
                  collapse();
                }
                return;
              }
              if (!hits.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const hit = hits[activeIndex] ?? hits[0];
                if (hit) focusHit(hit);
              }
            }}
            placeholder={t('canvas.search_placeholder')}
            aria-label={t('canvas.search_notes')}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-[#1a1a1a] placeholder:text-[#8c8a84]"
          />
        </div>
      )}

      {showResults && (
        <div className="absolute top-full left-0 mt-2 w-[280px] sm:w-[320px] bg-white border border-[#E6E4DF] rounded-xl shadow-2xl p-1 z-50">
          <div className="px-3 py-2 text-[10px] font-bold text-[#8c8a84] uppercase tracking-wider font-mono border-b border-[#F4F1ED] mb-1">
            {t('canvas.search_notes')}
          </div>
          {hits.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[#8c8a84]">{t('canvas.search_no_matches')}</div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {hits.slice(0, 40).map((hit, index) => (
                <button
                  key={hit.node.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => focusHit(hit)}
                  className={`w-full text-left px-3 py-2 rounded-lg mb-0.5 transition-colors ${
                    index === activeIndex ? 'bg-[#F4F1ED]' : 'hover:bg-[#F4F1ED]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#C2410C]">
                      {t(canvasNodeTypeLabelKey(hit.node.type))}
                    </span>
                  </div>
                  <div className="text-sm text-[#1a1a1a] leading-snug line-clamp-2">{hit.preview}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
