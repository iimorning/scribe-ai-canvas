import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers2, Sparkles } from 'lucide-react';
import { db } from '../../db';
import type { ThemeNodeProps } from './types';
import { isContentBlurPersistenceDisabled } from '../../config/persistence';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';

type ThemeEditableTag = 'h3' | 'p' | 'span';

interface ThemeEditableFieldProps {
  as: ThemeEditableTag;
  nodeId: string;
  displayValue: string;
  className: string;
  onPersist: (raw: string) => void;
}

/** 聚焦时不从 props 回写 DOM，避免 useLiveQuery 刷新导致光标乱跳、输入法中断 */
function ThemeEditableField({ as: Tag, nodeId, displayValue, className, onPersist }: ThemeEditableFieldProps) {
  const elRef = useRef<HTMLElement | null>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el || isFocusedRef.current) return;
    if (el.innerText !== displayValue) {
      el.textContent = displayValue;
    }
  }, [displayValue, nodeId]);

  return (
    <Tag
      ref={(el) => {
        elRef.current = el;
      }}
      className={className}
      contentEditable
      suppressContentEditableWarning
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={(e) => {
        isFocusedRef.current = false;
        onPersist(e.currentTarget.innerText);
      }}
    />
  );
}

export function ThemeNode({
  node,
  editingNodeId,
  bookExpandBranchCount = 0,
  bookExpandBranchesCollapsed = false,
  onToggleBookExpandBranches,
}: ThemeNodeProps) {
  const { t } = useTranslation();

  const defaultThemeFooter = node.layout === 3 ? 'LATENT_SPACE' : 'Spatial Encoding';
  const themeFooterDisplay =
    node.themeTag !== undefined && node.themeTag.trim() !== '' ? node.themeTag : defaultThemeFooter;
  const descriptionDisplay =
    node.description || 'Central research objective for the current workspace.';
  const showBranchesToggle = bookExpandBranchCount > 1 && !!onToggleBookExpandBranches;

  const persistField = (field: 'content' | 'description' | 'themeTag') => (raw: string) => {
    if (isContentBlurPersistenceDisabled()) return;
    const patch =
      field === 'themeTag'
        ? { themeTag: raw.replace(/\s+/g, ' ').trim() }
        : { [field]: raw };
    void db.nodes.update(node.id, patch);
  };

  return (
    <div
      className={`relative w-full h-full shadow-xl border-2 transition-all duration-500 flex flex-col ${
        node.layout === 1 ? 'p-8 border-l-4 border-[#C2410C] bg-white border-[#E6E4DF]' :
        node.layout === 2 ? 'p-10 bg-[#1a1a1a] text-white border-[#333] shadow-2xl' :
        node.layout === 3 ? 'p-6 border-2 border-black bg-white' :
        'p-6 bg-white border-[#E6E4DF]'
      }`}
      style={{ outline: '1px solid transparent' }}
    >
      {showBranchesToggle ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookExpandBranches?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title={
            bookExpandBranchesCollapsed
              ? t('nodes.expand_book_branches')
              : t('nodes.collapse_book_branches')
          }
          aria-label={
            bookExpandBranchesCollapsed
              ? t('nodes.expand_book_branches')
              : t('nodes.collapse_book_branches')
          }
          className={`absolute top-3 right-3 z-20 flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-sans font-medium shadow-sm transition-colors ${
            node.layout === 2
              ? 'border-white/20 bg-white/10 text-white/80 hover:border-[#C2410C]/60 hover:text-[#FDBA74]'
              : 'border-[#E6E4DF] bg-white/90 text-[#5a5a54] hover:border-[#C2410C]/50 hover:text-[#C2410C]'
          }`}
        >
          <Layers2 className="h-3.5 w-3.5" aria-hidden />
          <span>
            {bookExpandBranchesCollapsed
              ? t('nodes.expand_book_branches_short')
              : t('nodes.collapse_book_branches_short')}
          </span>
          <span className={`tabular-nums ${node.layout === 2 ? 'text-white/45' : 'text-[#a8a6a0]'}`}>
            {bookExpandBranchCount}
          </span>
        </button>
      ) : null}
      <div className={`flex items-center space-x-2 mb-3 ${node.layout === 3 ? 'hidden' : ''}`}>
        <Sparkles className={`w-3 h-3 ${node.layout === 2 ? 'text-[#C2410C]' : 'text-[#C2410C]'}`} />
        <span className={`text-[10px] font-sans font-bold uppercase tracking-widest ${node.layout === 2 ? 'text-[#8c8a84]' : 'text-[#C2410C]'}`}>{t('nodes.theme')}</span>
        <div className={`h-px flex-1 ${node.layout === 2 ? 'bg-white/10' : 'bg-[#F4F1ED]'}`}></div>
      </div>

      {node.layout === 3 && (
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-black mb-6 flex justify-between items-center">
          <span>Manifesto // 01</span>
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 bg-black rounded-full"></div>
            <div className="w-1.5 h-1.5 bg-[#C2410C] rounded-full"></div>
          </div>
        </div>
      )}

      <div
        className={`flex-1 overflow-y-auto min-h-0 pr-2 custom-scrollbar ${editingNodeId === node.id ? 'select-text' : ''}`}
        {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
      >
        <ThemeEditableField
          as="h3"
          nodeId={node.id}
          displayValue={node.content ?? ''}
          className={`font-bold leading-tight focus:outline-none rounded px-1 -mx-1 transition-all cursor-text ${
            node.layout === 1 ? 'text-3xl font-serif mb-4' :
            node.layout === 2 ? 'text-4xl tracking-tighter mb-4' :
            node.layout === 3 ? 'text-xl font-mono uppercase mb-4' :
            'text-2xl text-[#1a1a1a] mb-2'
          }`}
          onPersist={persistField('content')}
        />

        <ThemeEditableField
          as="p"
          nodeId={node.id}
          displayValue={descriptionDisplay}
          className={`focus:outline-none rounded px-1 -mx-1 transition-all cursor-text ${
            node.layout === 1 ? 'text-base font-serif leading-relaxed italic text-[#5a5a54]' :
            node.layout === 2 ? 'text-sm font-sans opacity-60 leading-relaxed' :
            node.layout === 3 ? 'text-xs font-mono leading-5 bg-[#F4F1ED] p-4 text-[#1a1a1a] border-l-2 border-black' :
            'text-sm font-serif leading-relaxed text-[#4a4a44]'
          }`}
          onPersist={persistField('description')}
        />
      </div>

      <div className={`mt-6 pt-4 flex justify-start items-center ${node.layout === 2 ? 'text-white/30 border-t border-white/10' : 'text-[#8c8a84] border-t border-[#F4F1ED]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 w-1 h-1 rounded-full ${node.layout === 2 ? 'bg-[#C2410C]' : 'bg-[#C2410C]'}`}></div>
          <ThemeEditableField
            as="span"
            nodeId={node.id}
            displayValue={themeFooterDisplay}
            className="text-[10px] font-sans font-medium uppercase tracking-widest focus:outline-none focus:ring-1 focus:ring-[#C2410C]/40 rounded px-0.5 cursor-text truncate min-w-0"
            onPersist={persistField('themeTag')}
          />
        </div>
      </div>
    </div>
  );
}
