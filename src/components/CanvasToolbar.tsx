import React from 'react';
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
  MicOff,
} from 'lucide-react';
import type { AgentConfig } from '../db';
import { db } from '../db';
import { getCanvasCenterPosition } from '../utils/canvas';
import { resolveAgentLocalizedName } from '../utils/aiI18n';
import type { VoicePhase } from '../hooks/useVoiceWritingMode';
import { IntentClarificationModal } from './IntentClarificationModal';
import { AgentIcon } from './AgentIcon';

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
}: CanvasToolbarProps) {
  const { t } = useTranslation();

  const phaseLabel =
    voicePhase === 'listening'
      ? t('voice.phase_listening')
      : voicePhase === 'thinking'
        ? t('voice.phase_thinking')
        : voicePhase === 'speaking'
          ? t('voice.phase_speaking')
          : t('voice.phase_idle');

  return (
    <>
      {/* AI Prompt Bar */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-40 flex flex-col">
        <IntentClarificationModal
          open={intentClarification !== null}
          original={intentClarification?.original ?? ''}
          options={intentClarification?.options ?? ['', '', '']}
          hint={intentClarification?.hint}
          isSubmitting={isIntentSubmitting}
          onCancel={onCancelIntentClarification}
          onConfirm={onConfirmIntentClarification}
        />
        {voiceModeActive && (
          <div className="mb-2 self-center px-3 py-1.5 rounded-full bg-[#1a1a1a]/85 text-white text-[11px] font-mono tracking-wide shadow-lg">
            {phaseLabel}
          </div>
        )}
        <div className={`bg-white rounded-2xl shadow-2xl border border-[#E6E4DF] p-2 flex items-center space-x-2 ring-4 ring-[#F4F1ED]/50 transition-all ${isToolbarAiLoading ? 'opacity-80' : ''} ${voiceModeActive ? 'opacity-90' : ''}`}>
          <div className="flex items-center gap-1 pl-2 border-r border-[#E6E4DF] pr-3 mr-1 relative group">
            <div className="relative group/plus">
              <button
                type="button"
                onClick={addTextNode}
                title={t('sidebar.new_note')}
                className="w-8 h-8 flex items-center justify-center text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              <div className="absolute bottom-full left-0 mb-2 w-52 bg-white border border-[#E6E4DF] rounded-xl shadow-xl opacity-0 invisible group-hover/plus:opacity-100 group-hover/plus:visible transition-all flex flex-col p-1 z-50">
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
                {agentConfigs.map(agent => (
                  <button key={agent.id} onClick={async () => {
                    const { x, y } = getCanvasCenterPosition(transformRef.current);
                    await db.nodes.add({ id: crypto.randomUUID(), canvasId: activeCanvasId, type: 'agent', agentConfigId: agent.id, x, y });
                  }} className="text-left px-3 py-2 text-sm text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg mb-1 flex items-center gap-2 min-w-0">
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
            <label title="Upload File" className="w-8 h-8 flex items-center justify-center text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg cursor-pointer transition-colors m-0">
              <FileTextIcon className="w-4 h-4" />
              <input type="file" accept="image/*,video/*,.docx,.txt,.md" className="hidden" onChange={addFileNode} />
            </label>
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
              className={`w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors ${
                voiceModeActive
                  ? 'text-white bg-[#C2410C] hover:bg-[#a0350a]'
                  : 'text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED]'
              }`}
            >
              {voiceModeActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>
          <input 
            className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 font-sans text-sm py-3 text-[#1a1a1a] placeholder-[#8c8a84] disabled:opacity-50" 
            placeholder={voiceModeActive ? t('voice.input_placeholder') : t('ai.input_placeholder')} 
            type="text"
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAiSubmit()}
            disabled={isInputDisabled || voiceModeActive}
          />
          <button 
            onClick={handleAiSubmit}
            disabled={isInputDisabled || voiceModeActive}
            className="bg-[#C2410C] text-white p-2.5 rounded-xl font-sans text-sm font-bold shadow-md flex items-center justify-center hover:bg-[#a0350a] transition-colors disabled:opacity-75 shrink-0"
          >
            {isToolbarAiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-8 right-6 flex items-center bg-white/80 backdrop-blur-sm border border-[#E6E4DF] rounded-md px-3 py-1.5 shadow-sm font-sans text-[10px] font-bold text-[#8c8a84] space-x-3 z-40">
        <button 
          className="hover:text-[#1a1a1a] transition-colors"
          onClick={() => setCanvasTransform(p => ({ ...p, scale: Math.max(0.1, p.scale / 1.1) }))}
        >{t('canvas.zoom')} -</button>
        <span className="flex items-center gap-1 w-12 justify-center"><ZoomIn className="w-3 h-3" /> {Math.round(canvasTransform.scale * 100)}%</span>
        <button 
          className="hover:text-[#1a1a1a] transition-colors"
          onClick={() => setCanvasTransform(p => ({ ...p, scale: Math.min(5, p.scale * 1.1) }))}
        >{t('canvas.zoom')} +</button>
      </div>
    </>
  );
}
