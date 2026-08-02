import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Sparkles,
  Bot,
  Wand2,
  ZoomIn,
  FileText as FileTextIcon,
  Loader2,
  Mic,
  Square,
} from 'lucide-react';
import type { AgentConfig } from '../db';
import { db } from '../db';
import { getCanvasCenterPosition } from '../utils/canvas';
import { resolveAgentLocalizedName } from '../utils/aiI18n';
import type { VoicePhase } from '../hooks/useVoiceWritingMode';
import { IntentClarificationModal } from './IntentClarificationModal';
import { AgentIcon } from './AgentIcon';
import {
  CANVAS_TOOLBAR_COLLAPSED_SIZE,
  canvasToolbarDockPosition,
  clampCanvasToolbarPosition,
  defaultCanvasToolbarLayout,
  isCanvasToolbarInDockZone,
  loadCanvasToolbarLayout,
  saveCanvasToolbarLayout,
  type CanvasToolbarLayout,
  type CanvasToolbarOrientation,
} from '../utils/canvasToolbarLayout';

export interface CanvasToolbarProps {
  isToolbarAiLoading: boolean;
  isInputDisabled: boolean;
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  handleAiSubmit: () => void;
  addTextNode: () => void;
  addThemeNode: () => void;
  addFileNode: (e: React.ChangeEvent<HTMLInputElement>) => void;
  agentConfigs: AgentConfig[];
  canvasTransform: { x: number; y: number; scale: number };
  setCanvasTransform: React.Dispatch<React.SetStateAction<{ x: number; y: number; scale: number }>>;
  transformRef: React.MutableRefObject<{ x: number; y: number; scale: number }>;
  activeCanvasId: string;
  intentClarification: {
    original: string;
    options: [string, string, string];
    hint?: string;
  } | null;
  isIntentSubmitting: boolean;
  onCancelIntentClarification: () => void;
  onConfirmIntentClarification: (finalRequest: string) => void;
  voiceModeActive?: boolean;
  voicePhase?: VoicePhase;
  onToggleVoiceMode?: () => void;
  /** Phase-chip stop: finish listen / stop TTS / cancel thinking */
  onStopVoiceActivity?: () => void;
  /** Quoted passage from a book node, used as AI context on next submit. */
  pendingQuote?: { text: string; sourceLabel?: string } | null;
  onClearPendingQuote?: () => void;
}

function isToolbarInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, label, select, option, [contenteditable="true"], [data-no-toolbar-drag]',
    ),
  );
}

export function CanvasToolbar({
  isToolbarAiLoading,
  isInputDisabled,
  aiPrompt,
  setAiPrompt,
  handleAiSubmit,
  addTextNode,
  addThemeNode,
  addFileNode,
  agentConfigs,
  canvasTransform,
  setCanvasTransform,
  transformRef,
  activeCanvasId,
  intentClarification,
  isIntentSubmitting,
  onCancelIntentClarification,
  onConfirmIntentClarification,
  voiceModeActive = false,
  voicePhase = 'idle',
  onToggleVoiceMode,
  onStopVoiceActivity,
  pendingQuote = null,
  onClearPendingQuote,
}: CanvasToolbarProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressFlipRef = useRef(false);

  const [layout, setLayout] = useState<CanvasToolbarLayout>(() => {
    const saved = loadCanvasToolbarLayout();
    if (saved) return saved;
    return defaultCanvasToolbarLayout(672, 72);
  });
  const [dragging, setDragging] = useState(false);

  const isVertical = layout.orientation === 'vertical';

  const persistLayout = useCallback((next: CanvasToolbarLayout) => {
    setLayout(next);
    saveCanvasToolbarLayout(next);
  }, []);

  const collapsed = Boolean(layout.collapsed);

  const clampToViewport = useCallback(
    (
      x: number,
      y: number,
      orientation: CanvasToolbarOrientation = layout.orientation,
      asCollapsed = collapsed,
    ) => {
      if (asCollapsed) {
        const size = CANVAS_TOOLBAR_COLLAPSED_SIZE;
        return clampCanvasToolbarPosition(x, y, size, size);
      }
      const el = panelRef.current;
      const w = el?.offsetWidth ?? (orientation === 'vertical' ? 240 : 672);
      const h = el?.offsetHeight ?? (orientation === 'vertical' ? 320 : 72);
      return clampCanvasToolbarPosition(x, y, w, h);
    },
    [collapsed, layout.orientation],
  );

  const expandToolbar = useCallback(() => {
    const next = defaultCanvasToolbarLayout(672, 72);
    next.orientation = layout.orientation;
    persistLayout(next);
  }, [layout.orientation, persistLayout]);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const clamped = clampCanvasToolbarPosition(layout.x, layout.y, el.offsetWidth, el.offsetHeight);
    if (clamped.x !== layout.x || clamped.y !== layout.y) {
      persistLayout({ ...layout, ...clamped });
    }
    const onResize = () => {
      const current = panelRef.current;
      if (!current) return;
      setLayout((prev) => {
        const nextClamp = clampCanvasToolbarPosition(
          prev.x,
          prev.y,
          current.offsetWidth,
          current.offsetHeight,
        );
        const next = { ...prev, ...nextClamp };
        saveCanvasToolbarLayout(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || collapsed) return;
    const clamped = clampCanvasToolbarPosition(layout.x, layout.y, el.offsetWidth, el.offsetHeight);
    if (clamped.x !== layout.x || clamped.y !== layout.y) {
      persistLayout({ ...layout, ...clamped });
    }
  }, [layout.orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand when voice / intent / book quote needs the full bar.
  useEffect(() => {
    if (!collapsed) return;
    if (voiceModeActive || intentClarification || pendingQuote?.text) {
      expandToolbar();
    }
  }, [collapsed, voiceModeActive, intentClarification, pendingQuote?.text, expandToolbar]);

  const toggleOrientation = useCallback(() => {
    if (collapsed) return;
    const nextOrientation: CanvasToolbarOrientation =
      layout.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    persistLayout({ ...layout, orientation: nextOrientation, collapsed: false });
    requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el) return;
      const clamped = clampCanvasToolbarPosition(layout.x, layout.y, el.offsetWidth, el.offsetHeight);
      persistLayout({
        x: clamped.x,
        y: clamped.y,
        orientation: nextOrientation,
        collapsed: false,
      });
    });
  }, [collapsed, layout, persistLayout]);

  const onShellPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (!collapsed && isToolbarInteractiveTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: layout.x,
      originY: layout.y,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onShellPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && dx * dx + dy * dy > 9) {
      drag.moved = true;
      suppressFlipRef.current = true;
    }
    const clamped = clampToViewport(drag.originX + dx, drag.originY + dy);
    setLayout((prev) => ({ ...prev, ...clamped }));
  };

  const endShellDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const wasMoved = drag.moved;
    dragRef.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }

    // Collapsed FAB: click (no move) expands back to the default bar.
    if (collapsed && !wasMoved) {
      expandToolbar();
      return;
    }

    setLayout((prev) => {
      const size = prev.collapsed
        ? CANVAS_TOOLBAR_COLLAPSED_SIZE
        : panelRef.current?.offsetWidth ?? (prev.orientation === 'vertical' ? 240 : 672);
      const height = prev.collapsed
        ? CANVAS_TOOLBAR_COLLAPSED_SIZE
        : panelRef.current?.offsetHeight ?? (prev.orientation === 'vertical' ? 320 : 72);
      const clamped = clampCanvasToolbarPosition(prev.x, prev.y, size, height);
      const inDock = isCanvasToolbarInDockZone(clamped.x, clamped.y, size, height);

      if (inDock) {
        const dock = canvasToolbarDockPosition();
        const next: CanvasToolbarLayout = {
          ...prev,
          ...dock,
          collapsed: true,
        };
        saveCanvasToolbarLayout(next);
        return next;
      }

      const next: CanvasToolbarLayout = {
        ...prev,
        ...clamped,
        collapsed: false,
      };
      saveCanvasToolbarLayout(next);
      return next;
    });
  };

  const onShellDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (collapsed) return;
    if (isToolbarInteractiveTarget(e.target)) return;
    if (suppressFlipRef.current) {
      suppressFlipRef.current = false;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    toggleOrientation();
  };

  const phaseLabel =
    voicePhase === 'listening'
      ? t('voice.phase_listening')
      : voicePhase === 'thinking'
        ? t('voice.phase_thinking')
        : voicePhase === 'speaking'
          ? t('voice.phase_speaking')
          : t('voice.phase_idle');

  const stopLabel =
    voicePhase === 'listening'
      ? t('voice.stop_listening')
      : voicePhase === 'speaking'
        ? t('voice.stop_speaking')
        : t('voice.stop_thinking');

  const plusMenuPos = isVertical
    ? 'absolute left-full top-0 ml-2 w-52'
    : 'absolute bottom-full left-0 mb-2 w-52';

  return (
    <>
      <div
        ref={panelRef}
        className="fixed z-40 flex flex-col"
        style={{
          left: layout.x,
          top: layout.y,
          width: collapsed
            ? CANVAS_TOOLBAR_COLLAPSED_SIZE
            : isVertical
              ? undefined
              : 'min(42rem, calc(100vw - 16px))',
        }}
        data-no-drag=""
      >
        <IntentClarificationModal
          open={intentClarification !== null}
          original={intentClarification?.original ?? ''}
          options={intentClarification?.options ?? ['', '', '']}
          hint={intentClarification?.hint}
          isSubmitting={isIntentSubmitting}
          onCancel={onCancelIntentClarification}
          onConfirm={onConfirmIntentClarification}
        />

        {collapsed ? (
          <button
            type="button"
            title={t('canvas.toolbar_expand')}
            aria-label={t('canvas.toolbar_expand')}
            onPointerDown={onShellPointerDown}
            onPointerMove={onShellPointerMove}
            onPointerUp={endShellDrag}
            onPointerCancel={endShellDrag}
            className={`w-12 h-12 rounded-full shadow-md border border-[#E6E4DF] flex items-center justify-center transition-all ${
              dragging ? 'cursor-grabbing touch-none' : 'cursor-grab'
            } ${
              isToolbarAiLoading
                ? 'bg-[#C2410C] text-white'
                : 'bg-white text-[#C2410C] hover:bg-[#FFF7ED]'
            }`}
          >
            {isToolbarAiLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Wand2 className="w-5 h-5" />
            )}
          </button>
        ) : (
          <div className={`relative ${isVertical ? 'w-56' : 'w-full'}`}>
            {/* Float above the input so appearing chips don't push the bar off-screen. */}
            {(voiceModeActive || pendingQuote?.text) && (
              <div className="absolute bottom-full left-0 right-0 mb-2 flex flex-col gap-2 pointer-events-auto">
                {voiceModeActive && (
                  <div className="self-center flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-full bg-[#1a1a1a]/85 text-white text-[11px] font-mono tracking-wide shadow-lg">
                    <span>{phaseLabel}</span>
                    <button
                      type="button"
                      title={stopLabel}
                      aria-label={stopLabel}
                      onClick={onStopVoiceActivity}
                      className="w-6 h-6 flex items-center justify-center rounded-full bg-white/15 hover:bg-[#C2410C] transition-colors"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                    </button>
                  </div>
                )}
                {pendingQuote?.text && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-[#FFF7ED] border border-[#FDBA74] text-[12px] text-[#9a3412] shadow-sm">
                    <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-sans font-bold text-[10px] uppercase tracking-wider text-[#C2410C] mb-0.5">
                        {pendingQuote.sourceLabel
                          ? t('ai.quote_chip_with_source', { source: pendingQuote.sourceLabel })
                          : t('ai.quote_chip')}
                      </div>
                      <p className="font-serif leading-snug line-clamp-2 break-words">{pendingQuote.text}</p>
                    </div>
                    {onClearPendingQuote && (
                      <button
                        type="button"
                        title={t('ai.quote_clear')}
                        aria-label={t('ai.quote_clear')}
                        onClick={onClearPendingQuote}
                        className="shrink-0 text-[#C2410C]/70 hover:text-[#C2410C] font-bold px-1"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

        <div
          ref={shellRef}
          title={t('canvas.toolbar_move_hint')}
          onPointerDown={onShellPointerDown}
          onPointerMove={onShellPointerMove}
          onPointerUp={endShellDrag}
          onPointerCancel={endShellDrag}
          onDoubleClick={onShellDoubleClick}
          className={`bg-white rounded-2xl shadow-2xl border border-[#E6E4DF] p-2 transition-all ${
            dragging ? 'cursor-grabbing touch-none' : 'cursor-grab'
          } ${isToolbarAiLoading ? 'opacity-80' : ''} ${voiceModeActive ? 'opacity-90' : ''} ${
            isVertical
              ? 'flex flex-col items-stretch gap-2 w-full'
              : 'flex items-center space-x-2 w-full'
          }`}
        >
          <div
            className={`flex items-center gap-1 relative group ${
              isVertical
                ? 'justify-center border-b border-[#E6E4DF] pb-2'
                : 'pl-2 border-r border-[#E6E4DF] pr-3 mr-1'
            }`}
          >
            <div className="relative group/plus">
              <button
                type="button"
                onClick={addTextNode}
                title={t('sidebar.new_note')}
                className="w-8 h-8 flex items-center justify-center text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              <div
                className={`${plusMenuPos} bg-white border border-[#E6E4DF] rounded-xl shadow-xl opacity-0 invisible group-hover/plus:opacity-100 group-hover/plus:visible transition-all flex flex-col p-1 z-50`}
              >
                <button
                  type="button"
                  onClick={addTextNode}
                  className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 flex items-center gap-2 min-w-0"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0 text-[#5a5a54]" />
                  <span className="font-bold truncate">{t('sidebar.new_note')}</span>
                </button>
                <button
                  type="button"
                  onClick={addThemeNode}
                  className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 flex items-center gap-2 min-w-0"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#C2410C]" />
                  <span className="font-bold truncate">{t('sidebar.new_theme_card')}</span>
                </button>
                <div className="my-1 border-t border-[#E6E4DF]" />
                <div className="px-3 py-2 text-[10px] font-bold text-[#8c8a84] uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5" />
                  {t('sidebar.agents')}
                </div>
                {agentConfigs.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={async () => {
                      const { x, y } = getCanvasCenterPosition(transformRef.current);
                      await db.nodes.add({
                        id: crypto.randomUUID(),
                        canvasId: activeCanvasId,
                        type: 'agent',
                        agentConfigId: agent.id,
                        x,
                        y,
                      });
                    }}
                    className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 flex items-center gap-2 min-w-0"
                  >
                    <span className="w-5 h-5 rounded-md bg-[#FFF7ED] border border-[#E6E4DF] flex items-center justify-center shrink-0 overflow-hidden">
                      <AgentIcon
                        agentId={agent.id}
                        className="w-full h-full"
                        imageClassName="scale-[1.32]"
                        fallbackClassName="text-[#C2410C]"
                      />
                    </span>
                    <span className="font-bold truncate">{resolveAgentLocalizedName(agent)}</span>
                  </button>
                ))}
              </div>
            </div>
            <label
              title="Upload File"
              className="w-8 h-8 flex items-center justify-center text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg cursor-pointer transition-colors m-0"
            >
              <FileTextIcon className="w-4 h-4" />
              <input
                type="file"
                accept="image/*,video/*,.docx,.txt,.md,.pdf,.epub,application/pdf,application/epub+zip"
                className="hidden"
                onChange={addFileNode}
              />
            </label>
          </div>

          <div
            className={`relative min-w-0 flex ${
              isVertical ? 'flex-col items-stretch gap-2' : 'flex-1 items-center'
            }`}
          >
            {isVertical ? (
              <textarea
                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 font-sans text-sm py-2 pr-1 text-[#1a1a1a] placeholder-[#8c8a84] disabled:opacity-50 resize-none min-h-[7.5rem] cursor-text"
                placeholder={voiceModeActive ? t('voice.input_placeholder') : t('ai.input_placeholder')}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAiSubmit();
                  }
                }}
                disabled={isInputDisabled || voiceModeActive}
                rows={5}
              />
            ) : (
              <input
                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 font-sans text-sm py-3 pr-11 text-[#1a1a1a] placeholder-[#8c8a84] disabled:opacity-50 cursor-text"
                placeholder={voiceModeActive ? t('voice.input_placeholder') : t('ai.input_placeholder')}
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAiSubmit()}
                disabled={isInputDisabled || voiceModeActive}
              />
            )}
            <button
              type="button"
              title={
                !voiceModeActive
                  ? t('voice.toggle_on')
                  : voicePhase === 'listening'
                    ? t('voice.finish_turn')
                    : t('voice.toggle_off')
              }
              onClick={onToggleVoiceMode}
              className={`${
                isVertical
                  ? 'self-end'
                  : 'absolute right-1 top-1/2 -translate-y-1/2'
              } w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors ${
                voiceModeActive
                  ? 'text-white bg-[#C2410C] hover:bg-[#a0350a]'
                  : 'text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED]'
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleAiSubmit}
            disabled={isInputDisabled || voiceModeActive}
            className={`bg-[#C2410C] text-white p-2.5 rounded-xl font-sans text-sm font-bold shadow-md flex items-center justify-center hover:bg-[#a0350a] transition-colors disabled:opacity-75 shrink-0 cursor-pointer ${
              isVertical ? 'w-full' : ''
            }`}
          >
            {isToolbarAiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
          </button>
        </div>
          </div>
        )}
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-8 right-6 flex items-center bg-white/80 backdrop-blur-sm border border-[#E6E4DF] rounded-md px-3 py-1.5 shadow-sm font-sans text-[10px] font-bold text-[#8c8a84] space-x-3 z-40">
        <button
          className="hover:text-[#1a1a1a] transition-colors"
          onClick={() => setCanvasTransform((p) => ({ ...p, scale: Math.max(0.1, p.scale / 1.1) }))}
        >
          {t('canvas.zoom')} -
        </button>
        <span className="flex items-center gap-1 w-12 justify-center">
          <ZoomIn className="w-3 h-3" /> {Math.round(canvasTransform.scale * 100)}%
        </span>
        <button
          className="hover:text-[#1a1a1a] transition-colors"
          onClick={() => setCanvasTransform((p) => ({ ...p, scale: Math.min(5, p.scale * 1.1) }))}
        >
          {t('canvas.zoom')} +
        </button>
      </div>
    </>
  );
}
