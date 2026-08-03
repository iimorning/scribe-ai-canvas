import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { NoteNodeProps } from '../../types';
import { NoteBody } from '../NoteBody';
import { WebSearchSourcesToggle } from '../../WebSearchSourcesToggle';

/** 0/2/3 经典与 neo；1 毛玻璃。与 ThemeNode 相同：单层外壳 + `transition-all duration-500` 做形态过渡。 */
export type NoteChromeLayout = 0 | 1 | 2 | 3;

/** 勿用 `transition-all`：box-shadow 在 neo 偏移阴影与毛玻璃光晕之间插值会产生黑色细边假影。 */
const NOTE_SHELL_TRANSITION =
  'transition-[background-color,border-color,border-radius,padding,gap] duration-500 ease-in-out';

export function NoteLayoutStandard({
  node,
  editingNodeId,
  setEditingNodeId,
  layout,
  webSearchSourceCount = 0,
  webSearchSourcesCollapsed = false,
  onToggleWebSearchSources,
}: NoteNodeProps & { layout: NoteChromeLayout }) {
  const { t } = useTranslation();
  const isGlass = layout === 1;

  const standardOuter = `note-surface-standard relative w-full h-full ${NOTE_SHELL_TRANSITION} border-2 flex flex-col rounded-none outline-none ring-0 ${
    layout === 3 ? 'shadow-[4px_4px_0px_0px_#1b1b1c]' : 'shadow-lg'
  } ${
    layout === 2
      ? 'p-4 bg-[#F4F1ED] border-transparent shadow-sm'
      : layout === 3
        ? 'neo-brut-surface p-6 gap-4 bg-[#fcf8f9] border-[#1b1b1c]'
        : 'p-5 bg-white border-[#E6E4DF]'
  }`;

  const glassOuter = `note-surface-glass isolate relative flex h-full w-full flex-col overflow-hidden rounded-xl ${NOTE_SHELL_TRANSITION} [transform:translateZ(0)] border-2 border-transparent shadow-none p-0 outline-none ring-0`;

  const outerClass = isGlass ? glassOuter : standardOuter;

  const editTypography = isGlass
    ? 'font-sans text-[18px] font-normal leading-[1.6] text-[#464652]'
    : layout === 2
      ? 'text-xs font-mono leading-5 text-[#5a5a54]'
      : layout === 3
        ? 'font-newsreader text-[24px] font-medium leading-[1.3] tracking-[-0.02em] text-[#1b1b1c] pt-2'
        : 'text-sm font-serif leading-relaxed text-[#4a4a44]';

  const viewTypography = isGlass
    ? 'markdown-body font-sans text-[18px] font-normal leading-[1.6] text-[#464652]'
    : layout === 2
      ? 'markdown-body text-xs font-mono leading-5 text-[#5a5a54]'
      : layout === 3
        ? 'markdown-body font-newsreader text-[24px] font-medium leading-[1.3] tracking-[-0.02em] text-[#1b1b1c] pt-2'
        : 'markdown-body text-sm font-serif leading-relaxed text-[#4a4a44]';

  const emptyBefore = isGlass ? 'empty:before:text-gray-300/80' : 'empty:before:text-gray-300';
  const editClassName = `focus:outline-none rounded px-1 -mx-1 transition-[color,font-size,line-height,font-family] duration-500 cursor-text min-h-[50px] select-text empty:before:content-['${t('nodes.type_something')}'] ${emptyBefore} ${editTypography}`;

  return (
    <div className={outerClass}>
      {isGlass && (
        <>
          <div className="note-glass-wash pointer-events-none absolute inset-0" aria-hidden />
          <div
            className="note-glass-hotspot pointer-events-none absolute left-0 top-0 h-24 w-24 blur-md"
            aria-hidden
          />
        </>
      )}

      <WebSearchSourcesToggle
        count={webSearchSourceCount}
        collapsed={webSearchSourcesCollapsed}
        onToggle={onToggleWebSearchSources}
      />

      {isGlass && (
        <header className="note-chrome relative z-10 flex shrink-0 items-center justify-between px-6 pt-6 mb-4">
          <Sparkles className="h-7 w-7 shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="text-right font-sans text-[12px] font-semibold uppercase leading-none tracking-[0.05em] opacity-80">
            {t('nodes.thought_node')}
          </span>
        </header>
      )}

      <NoteBody
        node={node}
        editingNodeId={editingNodeId}
        setEditingNodeId={setEditingNodeId}
        editClassName={editClassName}
        viewClassName={viewTypography}
        emptyNoteMarkdown={`_${t('nodes.empty_note')}_`}
        scrollAreaClassName={
          isGlass
            ? 'note-glass-markdown relative z-10 min-h-0 flex-1 overflow-y-auto px-6 pb-6 pr-7 custom-scrollbar'
            : 'flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar'
        }
      />
    </div>
  );
}
