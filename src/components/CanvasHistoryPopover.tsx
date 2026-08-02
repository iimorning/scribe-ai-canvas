import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Plus, Edit3 } from 'lucide-react';
import { db } from '../db';
import type { Canvas } from '../db';

export interface CanvasHistoryPopoverProps {
  canvases: Canvas[];
  activeCanvasId: string;
  setActiveCanvasId: (id: string) => void;
}

export function CanvasHistoryPopover({ canvases, activeCanvasId, setActiveCanvasId }: CanvasHistoryPopoverProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingCanvasName, setEditingCanvasName] = useState('');

  const renameCanvas = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    await db.canvases.update(id, { name: newName, updatedAt: Date.now() });
    setEditingCanvasId(null);
  };

  const createNewCanvas = async () => {
    const id = crypto.randomUUID();
    await db.canvases.add({
      id,
      name: t('canvas.default_name', { number: canvases.length + 1 }),
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    setActiveCanvasId(id);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-white text-[#1a1a1a] p-3 rounded-full shadow-md hover:bg-[#F4F1ED] transition-all flex items-center justify-center border border-[#E6E4DF] group"
        title={t('canvas.history')}
      >
        <History className="w-5 h-5 transition-transform group-hover:rotate-[-10deg]" />
      </button>
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-[#E6E4DF] rounded-xl shadow-2xl p-1 z-50">
          <div className="px-3 py-2 text-[10px] font-bold text-[#8c8a84] uppercase tracking-wider font-mono border-b border-[#F4F1ED] mb-1">{t('canvas.history')}</div>
          <div className="max-h-60 overflow-y-auto">
            {canvases.map(canvas => (
              <div 
                key={canvas.id}
                className={`group w-full text-left px-3 py-2 text-sm rounded-lg mb-1 transition-colors flex flex-col ${activeCanvasId === canvas.id ? 'bg-[#F4F1ED] border border-[#E6E4DF]' : 'hover:bg-[#F4F1ED]'}`}
              >
                {editingCanvasId === canvas.id ? (
                  <form 
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      renameCanvas(canvas.id, editingCanvasName);
                    }}
                  >
                    <input
                      autoFocus
                      value={editingCanvasName}
                      onChange={(e) => setEditingCanvasName(e.target.value)}
                      onBlur={() => renameCanvas(canvas.id, editingCanvasName)}
                      className="flex-1 bg-white border border-[#C2410C] px-2 py-0.5 rounded outline-none text-xs text-[#1a1a1a]"
                    />
                  </form>
                ) : (
                  <div className="font-bold flex items-center justify-between">
                    <button 
                      onClick={() => {
                        setActiveCanvasId(canvas.id);
                        setIsOpen(false);
                      }}
                      className="flex-1 text-left truncate"
                    >
                      {canvas.name}
                    </button>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCanvasId(canvas.id);
                          setEditingCanvasName(canvas.name);
                        }}
                        className="p-1 hover:text-[#C2410C] opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t('canvas.rename')}
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      {activeCanvasId === canvas.id && <div className="w-1.5 h-1.5 rounded-full bg-[#C2410C]" />}
                    </div>
                  </div>
                )}
                <div className="text-[10px] text-[#8c8a84]">{new Date(canvas.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="p-1 mt-1 border-t border-[#F4F1ED]">
            <button 
              onClick={createNewCanvas}
              className="w-full text-left px-3 py-2 text-sm text-[#C2410C] font-bold hover:bg-[#F4F1ED] rounded-lg flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('canvas.new_canvas')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
