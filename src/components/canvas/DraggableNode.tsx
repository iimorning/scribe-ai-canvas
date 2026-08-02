import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { colorPresets, fontPresets } from '../../constants/presets';
import { isDarkNodeBackground } from '../../utils/nodePaletteTone';
import { useDraggable } from '../../hooks/useDraggable';
import { useResizable } from '../../hooks/useResizable';

export interface DraggableNodeProps {
  id: string;
  nodesRef: React.MutableRefObject<Record<string, HTMLElement | null>>;
  isConnecting: boolean;
  onLink: (id: string) => void;
  children: React.ReactNode;
  initialX?: number;
  initialY?: number;
  onDelete?: () => void;
  onCycleLayout?: () => void;
  className?: string;
  scale?: number;
  isSelected?: boolean;
  isEditing?: boolean;
  onToggleSelect?: () => void;
  allowPalette?: boolean;
  onDragEnd?: (id: string, pos: {x: number, y: number}) => void;
  onResizeEnd?: (size: { width: number, height: number }) => void;
  initialWidth?: number;
  initialHeight?: number;
  rotation?: number;
  /** When set, overrides drag-managed z-index (e.g. neat web-search photo stack). */
  zIndexOverride?: number;
  /** When set (glass note layout), palette does not paint an opaque layer on this root so `backdrop-filter` on the card can sample the canvas. */
  glassSurface?: boolean;
  /** Note/text: card body pointer sets which node Ctrl+C duplicates (not from checkbox). */
  onStickyActivate?: (id: string) => void;
}

export const DraggableNode: React.FC<DraggableNodeProps> = ({ 
  id, nodesRef, isConnecting, onLink, children, 
  initialX = 100, initialY = 100, initialWidth = 320, initialHeight = 0,
  onDelete, onCycleLayout, className = '', scale = 1, 
  isSelected, isEditing, onToggleSelect, allowPalette, onDragEnd, onResizeEnd,
  rotation = 0,
  zIndexOverride,
  glassSurface = false,
  onStickyActivate,
}) => {
  const { t } = useTranslation();
  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  /** 编辑正文时隐藏外链、布局/删除、缩放手柄等外围控件（避免 group-hover 仍显示） */
  const hideChrome = Boolean(isEditing);

  const node = useDraggable(initialX, initialY, scale, (pos) => {
    if (onDragEnd) onDragEnd(id, pos);
  });

  const { size, onPointerDown: onResizePointerDown } = useResizable(initialWidth, initialHeight, scaleRef, (newSize) => {
    if (onResizeEnd) onResizeEnd(newSize);
  });

  const [showPalette, setShowPalette] = useState(false);
  const [styleOverrides, setStyleOverrides] = useState({ bg: '', text: '', font: '', border: '' });

  const paletteColorChoices = glassSurface ? colorPresets.slice(3) : colorPresets;
  return (
    <div 
      className={`absolute group pointer-events-auto select-none ${isSelected ? 'cursor-move' : 'cursor-default'} ${className} ${isSelected && !hideChrome ? 'ring-2 ring-[#C2410C]' : ''}`}
      data-glass-surface={glassSurface ? '' : undefined}
      data-node-tone={
        styleOverrides.bg
          ? isDarkNodeBackground(styleOverrides.bg)
            ? 'dark'
            : 'light'
          : undefined
      }
      style={{ 
        left: node.pos.x, 
        top: node.pos.y, 
        width: size.width || undefined,
        height: size.height || undefined,
        zIndex: zIndexOverride ?? node.zIndex,
        ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
        '--node-bg': styleOverrides.bg || undefined, 
        '--node-text': styleOverrides.text || undefined, 
        '--node-font': styleOverrides.font || undefined, 
        '--node-border': styleOverrides.border || undefined 
      } as React.CSSProperties}
      onDoubleClick={(e) => {
        if (allowPalette) {
          e.stopPropagation();
          setShowPalette(true);
        }
      }}
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        if (
          onStickyActivate &&
          !target.closest('button') &&
          !target.closest('.node-palette') &&
          !target.closest('.cursor-nwse-resize')
        ) {
          onStickyActivate(id);
        }
        if (showPalette) setShowPalette(false);
        if (isConnecting) {
          e.stopPropagation();
          e.preventDefault();
          onLink(id);
        } else {
          // Selection chrome (red ring) only via top-left check or canvas marquee —
          // body click must not enter selectedNodes.
          node.onPointerDown(e);
        }
      }}
      ref={el => { if (nodesRef) nodesRef.current[id] = el; }}
    >
      {onToggleSelect && (
        <button 
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onToggleSelect(); }} 
          className={`absolute -top-3 -left-3 w-6 h-6 bg-white border ${isSelected ? 'border-[#C2410C] text-[#C2410C] opacity-100' : 'border-[#E6E4DF] text-transparent hover:border-[#C2410C] opacity-0 group-hover:opacity-40'} rounded-full flex items-center justify-center transition-all z-10 shadow-sm ${hideChrome ? '!opacity-0 pointer-events-none' : ''}`}
          title={t('canvas.select_note')}
        >
          <Check className="w-3 h-3" />
        </button>
      )}
      <button 
        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onLink(id); }}
        className={`absolute top-1/2 -mt-3 -right-3 w-6 h-6 bg-white border border-[#E6E4DF] rounded-full flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] hover:border-[#C2410C] transition-all z-10 shadow-sm ${
          hideChrome
            ? '!opacity-0 pointer-events-none'
            : isSelected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
        }`}
        title={t('canvas.link_note')}
      >
        <Plus className="w-4 h-4" />
      </button>
      <div
        className={`absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 transition-opacity z-10 ${
          hideChrome
            ? '!opacity-0 pointer-events-none'
            : isSelected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {onCycleLayout && (
          <button 
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onCycleLayout(); }} 
            className="w-6 h-6 bg-white border border-[#E6E4DF] rounded-full flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] hover:border-[#C2410C] transition-all shadow-sm"
            title={t('canvas.cycle_layout')}
          >
            <SlidersHorizontal className="w-3 h-3" />
          </button>
        )}
        {onDelete && (
          <button 
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(); }} 
            className="w-6 h-6 bg-white border border-[#E6E4DF] rounded-full flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] hover:border-[#C2410C] transition-all shadow-sm"
            title={t('canvas.delete_note')}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      {children}
      
      {/* Resize Handle */}
      <div 
        onPointerDown={onResizePointerDown}
        className={`absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize flex items-center justify-center transition-opacity z-20 ${
          hideChrome
            ? '!opacity-0 pointer-events-none'
            : isSelected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <div className="w-1.5 h-1.5 border-r border-b border-[#8c8a84]"></div>
      </div>

      {showPalette && allowPalette && (
        <div 
          className="node-palette absolute -bottom-14 left-0 bg-white/90 backdrop-blur-md border border-[#E6E4DF] shadow-xl rounded-lg p-2 z-50 flex items-center gap-4 cursor-default pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()} /* Prevent drag when clicking palette */
        >
          <div className="flex gap-1.5">
            {paletteColorChoices.map((color, i) => (
              <button 
                key={glassSurface ? i + 3 : i} 
                onClick={() => setStyleOverrides(prev => ({ ...prev, bg: color.bg, text: color.text, border: color.border }))}
                className="w-5 h-5 rounded-full border border-black/10 transition-transform hover:scale-110 shadow-sm"
                style={{ backgroundColor: color.bg }}
                title={t('canvas.change_color')}
              />
            ))}
          </div>
          <div className="w-[1px] h-4 bg-[#E6E4DF]"></div>
          <div className="flex gap-2 text-xs">
            {fontPresets.map((font, i) => (
              <button
                key={i}
                onClick={() => setStyleOverrides(prev => ({ ...prev, font: font.value }))}
                className="px-2 py-0.5 rounded hover:bg-[#F4F1ED] text-[#5a5a54] hover:text-[#1a1a1a] transition-colors"
                title={`${t('canvas.change_font')}: ${font.name}`}
                style={{ fontFamily: font.value }}
              >
                Aa
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
