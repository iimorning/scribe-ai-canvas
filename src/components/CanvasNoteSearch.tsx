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
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const hits = useMemo(() => searchCanvasNodes(nodes, query), [nodes, query]);
  const showResults = open && query.trim().length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!showResults) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showResults]);

  const focusHit = (hit: CanvasNodeSearchHit) => {
    onFocusNode(hit.node);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 h-11 pl-3 pr-3 rounded-full bg-white border border-[#E6E4DF] shadow-md focus-within:border-[#C2410C]/50 focus-within:ring-2 focus-within:ring-[#C2410C]/10 transition-all w-[200px] sm:w-[240px]">
        <Search className="w-4 h-4 text-[#8c8a84] shrink-0" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (query) {
                setQuery('');
              } else {
                setOpen(false);
                inputRef.current?.blur();
              }
              e.stopPropagation();
              return;
            }
            if (!hits.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
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
