import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Search,
  Bot,
  Wand2,
  Send,
  MessageSquare,
  X,
  FileText,
  Loader2,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import type { AgentConfig, AgentMarkdownKnowledgeFile } from '../db';
import { db } from '../db';
import type { CallAIFn } from '../types';
import { formatAiError } from '../services/ai';
import {
  buildAgentSystemInstruction,
  getLocaleDirective,
  resolveAgentLocalizedName,
  resolveAgentLocalizedRole,
  resolveAgentSystemPrompt,
} from '../utils/aiI18n';
import {
  AGENT_KNOWLEDGE_MAX_FILE_BYTES,
  isAgentMarkdownFilename,
} from '../utils/agentMarkdownKnowledge';
import { useAppDialog } from './AppDialogProvider';
import { AgentIcon } from './AgentIcon';

type SandboxChatMessage = { role: 'user' | 'model'; text: string };

async function persistSandboxThread(agentId: string, messages: SandboxChatMessage[]) {
  await db.agentSandboxThreads.put({
    agentId,
    messages,
    updatedAt: Date.now(),
  });
}

export interface AgentsStudioProps {
  agentConfigs: AgentConfig[];
  setAgentConfigs: (configs: AgentConfig[]) => Promise<void>;
  aiConfig: {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  callAI: CallAIFn;
}

export function AgentsStudio({ agentConfigs, setAgentConfigs, aiConfig, callAI }: AgentsStudioProps) {
  const { t } = useTranslation();
  const { confirm, alert: appAlert } = useAppDialog();
  const [activeAgentId, setActiveAgentId] = useState<string | null>(agentConfigs[0]?.id || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isSandboxOpen, setIsSandboxOpen] = useState(false);
  const [sandboxMessages, setSandboxMessages] = useState<SandboxChatMessage[]>([]);
  const [sandboxInput, setSandboxInput] = useState('');
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const knowledgeFileInputRef = useRef<HTMLInputElement>(null);
  const sandboxUiAgentRef = useRef<string | null>(null);

  const activeAgent = agentConfigs.find((a) => a.id === activeAgentId) || agentConfigs[0];

  const displayName = activeAgent ? resolveAgentLocalizedName(activeAgent) : '';
  const displayPrompt = activeAgent ? resolveAgentSystemPrompt(activeAgent) : '';

  useEffect(() => {
    sandboxUiAgentRef.current = activeAgentId;
    setIsSandboxLoading(false);

    let cancelled = false;
    (async () => {
      if (!activeAgentId) {
        setSandboxMessages([]);
        return;
      }
      const row = await db.agentSandboxThreads.get(activeAgentId);
      if (cancelled) return;
      setSandboxMessages(row?.messages ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAgentId]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sandboxMessages, isSandboxLoading]);

  const handleAddAgent = () => {
    const newId = "agent-" + Math.random().toString(36).substr(2, 9);
    setAgentConfigs([...agentConfigs, {
      id: newId,
      name: t('agents.new_persona'),
      role: 'Assistant',
      prompt: '',
      temperature: 0.7,
      creativity: 0.4
    }]);
    setActiveAgentId(newId);
  };

  const handleUpdateActiveAgent = (field: string, value: string | number) => {
    if (!activeAgentId) return;
    setAgentConfigs(agentConfigs.map((a) => (a.id === activeAgentId ? { ...a, [field]: value } : a)));
  };

  const setActiveAgentKnowledgeFiles = (next: AgentMarkdownKnowledgeFile[] | undefined) => {
    if (!activeAgentId) return;
    setAgentConfigs(
      agentConfigs.map((a) =>
        a.id === activeAgentId ? { ...a, knowledgeMarkdownFiles: next?.length ? next : undefined } : a,
      ),
    );
  };

  const openKnowledgeFilePicker = () => knowledgeFileInputRef.current?.click();

  const readOneFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('read'));
      reader.readAsText(file, 'UTF-8');
    });

  const handleKnowledgeFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = '';
    if (!list?.length || !activeAgentId || !activeAgent) return;

    const errors: string[] = [];
    const merged = new Map((activeAgent.knowledgeMarkdownFiles ?? []).map((f) => [f.name, f]));

    for (const file of Array.from(list)) {
      if (!isAgentMarkdownFilename(file.name)) {
        errors.push(t('agents.knowledge_not_markdown', { name: file.name }));
        continue;
      }
      if (file.size > AGENT_KNOWLEDGE_MAX_FILE_BYTES) {
        errors.push(t('agents.knowledge_file_too_large', { name: file.name }));
        continue;
      }
      try {
        const content = await readOneFileAsText(file);
        merged.set(file.name, { name: file.name, content });
      } catch {
        errors.push(t('agents.knowledge_read_failed', { name: file.name }));
      }
    }

    if (errors.length) {
      void appAlert({ message: errors.join('\n') });
    }
    if (merged.size > 0) {
      setActiveAgentKnowledgeFiles(Array.from(merged.values()));
    }
  };

  const removeKnowledgeFile = (fileName: string) => {
    if (!activeAgent) return;
    const next = (activeAgent.knowledgeMarkdownFiles ?? []).filter((f) => f.name !== fileName);
    setActiveAgentKnowledgeFiles(next.length ? next : undefined);
  };

  const handleEnhancePrompt = async () => {
    if (!activeAgent || !displayPrompt.trim()) return;
    setIsEnhancing(true);
    try {
      const newPrompt = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: t('agents.studio.enhance_user', {
          name: resolveAgentLocalizedName(activeAgent),
          role: resolveAgentLocalizedRole(activeAgent),
          prompt: resolveAgentSystemPrompt(activeAgent),
        }),
        temperature: activeAgent.temperature ?? 0.7,
        topP: activeAgent.creativity ?? 0.4,
      });
      
      let enhanced = newPrompt.trim();
      enhanced = enhanced.replace(/^(New Enhanced Prompt:|新增强提示词[:：])\s*/i, '').trim();
      handleUpdateActiveAgent('prompt', enhanced);
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Scribe AI] enhance prompt failed', msg);
      void appAlert({
        message: `增强提示词失败\n\n${msg}\n\nF12 → Console 查看 [Scribe AI] 日志。`,
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!sandboxInput.trim() || isSandboxLoading || !activeAgent) return;

    const scopedAgentId = activeAgent.id;
    const userMsg = sandboxInput.trim();

    const afterUser: SandboxChatMessage[] = [...sandboxMessages, { role: 'user', text: userMsg }];
    setSandboxMessages(afterUser);
    setSandboxInput('');
    setIsSandboxLoading(true);

    try {
      await persistSandboxThread(scopedAgentId, afterUser);
    } catch (err) {
      console.error('[Scribe AI] sandbox persist (user msg) failed', err);
    }

    const streamingModel: SandboxChatMessage = { role: 'model', text: '' };
    if (sandboxUiAgentRef.current === scopedAgentId) {
      setSandboxMessages([...afterUser, streamingModel]);
    }

    try {
      const responseText = await callAI({
        config: aiConfig,
        prompt: userMsg,
        systemInstruction: buildAgentSystemInstruction(activeAgent, {
          fallbackPrompt: t('agents.studio.fallback_assistant'),
        }),
        temperature: activeAgent.temperature ?? 0.7,
        topP: activeAgent.creativity ?? 0.4,
        onStreamChunk: (acc) => {
          if (sandboxUiAgentRef.current !== scopedAgentId) return;
          setSandboxMessages((prev) => {
            const base = prev.length > 0 && prev[prev.length - 1]?.role === 'model' ? prev.slice(0, -1) : prev;
            return [...base, { role: 'model', text: acc }];
          });
        },
      });
      const afterModel: SandboxChatMessage[] = [...afterUser, { role: 'model', text: responseText }];
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setSandboxMessages(afterModel);
      }
      try {
        await persistSandboxThread(scopedAgentId, afterModel);
      } catch (err) {
        console.error('[Scribe AI] sandbox persist (assistant) failed', err);
      }
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Scribe AI] sandbox chat failed', msg);
      const errLine: SandboxChatMessage = {
        role: 'model',
        text: `Error: ${msg}（详见 Console [Scribe AI]）`,
      };
      const afterErr: SandboxChatMessage[] = [...afterUser, errLine];
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setSandboxMessages(afterErr);
      }
      try {
        await persistSandboxThread(scopedAgentId, afterErr);
      } catch (err) {
        console.error('[Scribe AI] sandbox persist (error bubble) failed', err);
      }
    } finally {
      if (sandboxUiAgentRef.current === scopedAgentId) {
        setIsSandboxLoading(false);
      }
    }
  };

  const handleClearSandboxChat = async () => {
    if (!activeAgentId || sandboxMessages.length === 0) return;
    const ok = await confirm({ message: t('agents.sandbox_clear_confirm'), variant: 'danger' });
    if (!ok) return;
    setSandboxMessages([]);
    try {
      await db.agentSandboxThreads.delete(activeAgentId);
    } catch (err) {
      console.error('[Scribe AI] sandbox clear failed', err);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: t('agents.delete_confirm'), variant: 'danger' });
    if (!ok) return;
    const newConfigs = agentConfigs.filter((a) => a.id !== id);
    await setAgentConfigs(newConfigs);
    try {
      await db.agentSandboxThreads.delete(id);
    } catch (err) {
      console.error('[Scribe AI] sandbox thread delete failed', err);
    }
    if (activeAgentId === id) {
      setActiveAgentId(newConfigs[0]?.id || null);
    }
  };

  const filteredAgents = agentConfigs.filter((a) =>
    resolveAgentLocalizedName(a).toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex min-h-0 bg-[#FAF9F6] overflow-hidden relative">
      {/* Pane 1: Persona List */}
      <section className="w-64 shrink-0 flex flex-col min-h-0 border-r border-[#E6E4DF] bg-white z-10">
        <div className="p-4 border-b border-[#E6E4DF] flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              className="w-full pl-9 pr-3 py-2 text-xs font-sans bg-white border border-[#E6E4DF] rounded-lg focus:ring-1 focus:ring-[#C2410C] focus:border-[#C2410C] outline-none"
              placeholder={t('agents.search_personas')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              type="search"
              autoComplete="off"
              aria-label={t('agents.search_personas')}
            />
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8c8a84] pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={handleAddAgent}
            aria-label={t('agents.new_persona')}
            className="text-[#C2410C] hover:bg-[#F4F1ED] p-1 rounded-full transition-colors flex items-center justify-center shrink-0"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div>
            {filteredAgents.map((agent) => (
              <div 
                key={agent.id}
                onClick={() => {
                  setActiveAgentId(agent.id);
                }}
                className={`p-4 cursor-pointer transition-colors border-l-4 ${activeAgentId === agent.id ? 'bg-[#F4F1ED] border-[#C2410C]' : 'hover:bg-[#F4F1ED]/50 border-transparent'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#FFF7ED] border border-[#E6E4DF] flex items-center justify-center overflow-hidden">
                    <AgentIcon
                      agentId={agent.id}
                      className="w-full h-full"
                      imageClassName="scale-[1.32]"
                      fallbackClassName={activeAgentId === agent.id ? 'text-[#C2410C]' : 'text-[#8c8a84]'}
                    />
                  </div>
                  <div className="min-w-0">
                    <h4 className={`font-bold truncate ${activeAgentId === agent.id ? 'text-[#1a1a1a]' : 'text-[#5a5a54]'}`}>{resolveAgentLocalizedName(agent)}</h4>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pane 2: Workspace/Editor */}
      <section className="flex-1 flex flex-col min-h-0 overflow-y-auto relative">
        {activeAgent ? (
          <>
            <div className="sticky top-0 bg-[#FAF9F6]/80 backdrop-blur-md px-10 py-6 border-b border-[#E6E4DF] flex flex-col sm:flex-row justify-between items-start sm:items-end z-10 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-[#FFF7ED] border border-[#E6E4DF] flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
                  <AgentIcon
                    agentId={activeAgent.id}
                    className="w-full h-full"
                    imageClassName="scale-[1.32]"
                    fallbackClassName="text-[#C2410C]"
                  />
                </div>
                <input
                  type="text"
                  className="font-serif text-3xl font-bold text-[#1a1a1a] bg-transparent border-0 border-b border-transparent hover:border-[#E6E4DF] focus:border-[#C2410C] focus:ring-0 outline-none w-full max-w-2xl py-1 px-0 transition-colors placeholder:text-[#8c8a84] placeholder:font-normal"
                  value={displayName}
                  onChange={(e) => handleUpdateActiveAgent('name', e.target.value)}
                  placeholder={t('agents.new_persona')}
                  aria-label={t('agents.persona_name')}
                />
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsSandboxOpen(!isSandboxOpen)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-sans font-bold transition-all text-sm shadow-sm ${isSandboxOpen ? 'bg-[#C2410C] text-white shadow-[#C2410C]/20' : 'bg-white border border-[#E6E4DF] text-[#5a5a54] hover:bg-[#F4F1ED]'}`}
                >
                  <MessageSquare className="w-4 h-4" />
                  {isSandboxOpen ? t('agents.close_sandbox') : t('agents.test_sandbox')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(activeAgent.id)}
                  className="px-6 py-2 text-[#ef4444] rounded-lg font-sans font-bold hover:bg-[#ef4444]/10 transition-all text-sm"
                >
                  {t('agents.delete_persona')}
                </button>
              </div>
            </div>

            <div className="p-10 max-w-4xl w-full mx-auto md:mx-0">
              <div className="grid grid-cols-1 gap-12 pb-32">
                {/* Identity Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-1 h-8 bg-[#C2410C] rounded-full"></div>
                    <h3 className="text-xl font-serif font-bold text-[#1a1a1a]">{t('agents.identity_tone')}</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="text-xs font-mono font-bold text-[#5a5a54] uppercase tracking-wider">{t('agents.system_prompt')}</label>
                      <div className="flex items-center gap-3">
                        <span className={`${(displayPrompt.length || 0) > 2000 ? 'text-red-500' : 'text-[#5a5a54]'} text-xs font-mono`}>{displayPrompt.length} / 2000</span>
                        <button
                          onClick={handleEnhancePrompt}
                          disabled={isEnhancing || !displayPrompt.trim()}
                          className="flex items-center gap-1.5 text-xs font-bold text-[#C2410C] hover:text-[#9a3412] px-2 py-1 bg-[#C2410C]/5 rounded border border-[#C2410C]/20 transition-all disabled:opacity-50"
                        >
                          {isEnhancing ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Wand2 className="w-3.5 h-3.5" />}
                          {t('agents.enhance_prompt')}
                        </button>
                      </div>
                    </div>
                    <textarea
                      className={`w-full p-4 font-mono text-base leading-relaxed text-[#1a1a1a] bg-white border ${displayPrompt.length > 2000 ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-[#E6E4DF] focus:border-[#C2410C] focus:ring-[#C2410C]'} rounded-lg outline-none transition-colors overflow-y-auto resize-y min-h-[180px]`}
                      style={{ height: Math.max(180, (displayPrompt.split('\n').length || 1) * 26 + 40) + 'px' }}
                      value={displayPrompt}
                      onChange={e => handleUpdateActiveAgent('prompt', e.target.value)}
                      placeholder="You are a specialized agent. Your goal is to..."
                    />
                  </div>
                </div>

                {/* Knowledge Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-1 h-8 bg-[#C2410C] rounded-full"></div>
                    <h3 className="text-xl font-serif font-bold text-[#1a1a1a]">{t('agents.knowledge_base')}</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-4 shadow-sm">
                      <input
                        ref={knowledgeFileInputRef}
                        type="file"
                        accept=".md,.markdown,text/markdown,text/x-markdown"
                        multiple
                        className="hidden"
                        onChange={(e) => void handleKnowledgeFilesChange(e)}
                      />
                      <div className="flex justify-between items-center">
                        <h4 className="font-sans font-bold text-[#1a1a1a]">{t('agents.knowledge_custom_title')}</h4>
                        <button
                          type="button"
                          onClick={openKnowledgeFilePicker}
                          className="text-xs text-[#C2410C] font-bold hover:underline"
                        >
                          {t('agents.knowledge_manage_files')}
                        </button>
                      </div>
                      <p className="text-sm text-[#5a5a54] font-sans leading-relaxed">{t('agents.knowledge_hint')}</p>
                      <div className="space-y-2 min-h-[3rem]">
                        {(activeAgent.knowledgeMarkdownFiles ?? []).length === 0 ? (
                          <p className="text-sm text-[#5a5a54] font-sans py-2">{t('agents.knowledge_empty')}</p>
                        ) : (
                          (activeAgent.knowledgeMarkdownFiles ?? []).map((f) => (
                            <div
                              key={f.name}
                              className="flex items-center justify-between gap-2 p-3 bg-[#F4F1ED] rounded-lg border border-[#E6E4DF]"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <FileText className="w-4 h-4 text-[#8c8a84] shrink-0" />
                                <span className="text-sm font-sans font-medium text-[#1a1a1a] truncate" title={f.name}>
                                  {f.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-[#5a5a54] font-mono">
                                  {t('agents.knowledge_chars', { count: f.content.length })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeKnowledgeFile(f.name)}
                                  className="p-1.5 rounded-md text-[#8c8a84] hover:text-[#ef4444] hover:bg-[#fee2e2] transition-colors"
                                  aria-label={t('agents.knowledge_remove_file', { name: f.name })}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="pt-4 border-t border-[#E6E4DF] flex items-center justify-center">
                        <button
                          type="button"
                          onClick={openKnowledgeFilePicker}
                          className="flex items-center gap-2 text-[#C2410C] hover:text-[#9a3412] font-sans text-sm font-bold transition-colors"
                        >
                          <Plus className="w-4 h-4" /> {t('agents.knowledge_add_md')}
                        </button>
                      </div>
                    </div>
                    <div className="p-6 bg-white text-[#1a1a1a] border border-[#E6E4DF] rounded-xl flex flex-col justify-between shadow-sm">
                      <div>
                        <h4 className="font-sans font-bold mb-2">{t('agents.model_params')}</h4>
                        <div className="space-y-4 mt-6">
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs uppercase font-mono tracking-widest text-[#5a5a54] mb-2">
                              <span>{t('agents.temp')}</span>
                              <span>{activeAgent.temperature ?? 0.7}</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" max="2" step="0.1" 
                              value={activeAgent.temperature ?? 0.7}
                              onChange={(e) => handleUpdateActiveAgent('temperature', parseFloat(e.target.value))}
                              className="w-full accent-[#C2410C] h-1 bg-[#F4F1ED] rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                          <div className="space-y-1 mt-4">
                            <div className="flex justify-between text-xs uppercase font-mono tracking-widest text-[#5a5a54] mb-2">
                              <span>{t('agents.creativity')}</span>
                              <span>{activeAgent.creativity ?? 0.4}</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" max="1" step="0.1" 
                              value={activeAgent.creativity ?? 0.4}
                              onChange={(e) => handleUpdateActiveAgent('creativity', parseFloat(e.target.value))}
                              className="w-full accent-[#C2410C] h-1 bg-[#F4F1ED] rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="text-xs font-mono text-[#5a5a54] mt-6">
                        {t('agents.model_params_footer')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Test Sandbox Panel */}
            {isSandboxOpen && (
              <div className="absolute inset-y-0 right-0 z-20 flex w-[min(100vw,400px)] min-h-0 flex-col border-l border-[#E6E4DF] bg-[#FAF9F6] shadow-[-12px_0_32px_rgba(0,0,0,0.06)] animate-in slide-in-from-right duration-300">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E6E4DF] bg-[#F4F1ED]/50 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <MessageSquare className="h-4 w-4 shrink-0 text-[#C2410C]" />
                    <span className="truncate font-serif font-bold text-[#1a1a1a]">
                      {t('agents.sandbox_title', { name: displayName })}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleClearSandboxChat()}
                      disabled={sandboxMessages.length === 0 || isSandboxLoading}
                      title={t('agents.sandbox_clear')}
                      aria-label={t('agents.sandbox_clear_aria')}
                      className="rounded-md p-2 text-[#8c8a84] transition-colors hover:bg-[#E6E4DF]/60 hover:text-[#1a1a1a] disabled:pointer-events-none disabled:opacity-30"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSandboxOpen(false)}
                      className="rounded-md p-2 text-[#8c8a84] hover:bg-[#E6E4DF]/60 hover:text-[#1a1a1a]"
                      aria-label={t('agents.close_sandbox')}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
                  {sandboxMessages.length === 0 && (
                    <div className="text-center py-10 px-4">
                      <Bot className="w-10 h-10 text-[#E6E4DF] mx-auto mb-3" />
                      <p className="text-xs text-[#8c8a84] font-sans">
                        {t('agents.sandbox_empty', { name: displayName })}
                      </p>
                    </div>
                  )}
                  {sandboxMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm font-sans shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-[#EAE7E2] text-[#1a1a1a] rounded-tr-none border border-[#D9D6D1]' 
                          : 'bg-white border border-[#E6E4DF] text-[#1a1a1a] rounded-tl-none'
                      }`}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {isSandboxLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-[#E6E4DF] px-4 py-2.5 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                        <Loader2 className="w-4 h-4 text-[#C2410C] animate-spin" />
                        <span className="text-xs text-[#8c8a84] italic">{t('agents.ai_thinking')}</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="shrink-0 border-t border-[#E6E4DF] bg-[#FAF9F6] p-4">
                  <form onSubmit={handleSendMessage} className="relative">
                    <input 
                      type="text"
                      className="w-full rounded-xl border border-[#E6E4DF] bg-white py-3 pl-4 pr-12 text-sm font-sans shadow-sm transition-all focus:border-[#C2410C] focus:outline-none focus:ring-1 focus:ring-[#C2410C]"
                      placeholder={t('agents.message_placeholder', { name: displayName })}
                      value={sandboxInput}
                      onChange={e => setSandboxInput(e.target.value)}
                    />
                    <button 
                      type="submit"
                      disabled={!sandboxInput.trim() || isSandboxLoading}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-[#C2410C] text-white flex items-center justify-center hover:bg-[#9a3412] transition-colors disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                  <p className="text-[10px] text-center text-[#8c8a84] mt-2 font-mono">
                    {t('agents.sandbox_note')}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-50">
            <Bot className="w-16 h-16 text-[#8c8a84] mb-4" />
            <h2 className="font-serif text-2xl font-bold text-[#1a1a1a]">{t('agents.select_persona')}</h2>
            <p className="font-sans text-[#5a5a54] mt-2">{t('agents.select_subtitle')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
