import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatAiError } from '../services/ai';
import { getLocaleDirective } from '../utils/aiI18n';
import { parseLenientLlmJson } from '../utils/llmJson';
import { openExternalUrl } from '../utils/openExternal';
import { metasoSearch, buildSearchContext } from '../services/search';
import {
  db,
  type ResearchSession,
  type ResearchSessionSearchStatus,
  type ResearchSessionWebpageSnapshot,
} from '../db';
import {
  Terminal,
  Microscope,
  ArrowRight,
  ListChecks,
  Check,
  CheckCircle2,
  Loader2,
  FileText,
  Globe,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Trash2,
  X,
  History,
} from 'lucide-react';
import type { CallAIFn } from '../types';
import { useAppDialog } from './AppDialogProvider';

export type ResearchPlanStep = { title: string; desc: string };

const RESEARCH_PLAN_FALLBACK: ResearchPlanStep[] = [
  { title: 'Archive Extraction', desc: "Scan personal drafts and reference library for direct mentions." },
  { title: 'Thematic Networking', desc: 'Cross-reference dialogue with established metaphors.' },
  { title: 'Synthesis & Drafting', desc: 'Generate a comprehensive deep-dive report.' },
];

const RESEARCH_HISTORY_LIMIT = 50;

function formatSessionListDate(createdAt: number, language: string): string {
  const d = new Date(createdAt);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const safeDays = Math.max(0, diffDays);
  const loc = language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  try {
    if (safeDays < 7) {
      const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
      if (safeDays === 0) return rtf.format(0, 'day');
      return rtf.format(-safeDays, 'day');
    }
  } catch {
    /* fall through */
  }
  return d.toLocaleDateString(loc, { month: 'short', day: 'numeric', year: 'numeric' });
}

function normalizeResearchPlan(raw: unknown): ResearchPlanStep[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchPlanStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = String(o.title ?? '').trim();
    const desc = String(o.desc ?? '').trim();
    if (!title && !desc) continue;
    out.push({ title: title || `Step ${out.length + 1}`, desc });
  }
  return out;
}

export type ResearchReportBody = {
  intro: string;
  points: { title: string; text: string }[];
  conclusion: string;
};

function normalizeResearchReport(raw: unknown): ResearchReportBody {
  if (!raw || typeof raw !== 'object') {
    return { intro: '', points: [], conclusion: '' };
  }
  const o = raw as Record<string, unknown>;
  const intro = String(o.intro ?? '').trim();
  const conclusion = String(o.conclusion ?? '').trim();
  const points: { title: string; text: string }[] = [];
  if (Array.isArray(o.points)) {
    for (const p of o.points) {
      if (!p || typeof p !== 'object') continue;
      const rec = p as Record<string, unknown>;
      points.push({
        title: String(rec.title ?? '').trim(),
        text: String(rec.text ?? '').trim(),
      });
    }
  }
  return { intro, points, conclusion };
}

function researchReportParseFallback(language: string): ResearchReportBody {
  const zh = language.toLowerCase().startsWith('zh');
  if (zh) {
    return {
      intro:
        '未能解析模型返回的报告：输出不是合法 JSON，或字符串中含有未转义的英文双引号、真实换行等。',
      points: [
        {
          title: '常见原因',
          text:
            '要点段落过长时在字符串里插入了真实换行；正文里使用了未转义的英文双引号；在 JSON 前后写了说明文字；数组或对象末尾带了尾随逗号等。',
        },
      ],
      conclusion:
        '请尝试缩短检索摘要、更换模型后重试。若多次失败，可在控制台查看 JSON 报错位置（character position）以核对模型原始输出。',
    };
  }
  return {
    intro:
      'The model returned malformed JSON (often unescaped quotes or raw newlines inside strings, trailing commas, or extra prose outside the object).',
    points: [
      {
        title: 'What happened',
        text: 'The previous English “blueprint / chapter 4” copy was a fixed fallback after parse failure — not your topic.',
      },
    ],
    conclusion: 'Retry with a stricter JSON model or shorter web-search context; check the console for the exact parse position.',
  };
}

export interface ResearchLabProps {
  aiConfig: {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    metasoApiKey?: string;
  };
  callAI: CallAIFn;
}

type WebSearchOutcome = {
  context: string;
  sourceCount: number;
  searchStatus: ResearchSessionSearchStatus;
  webpages: ResearchSessionWebpageSnapshot[];
};

const EMPTY_WEB_OUTCOME: WebSearchOutcome = {
  context: '',
  sourceCount: 0,
  searchStatus: 'idle',
  webpages: [],
};

/** Parse `{"need_web":boolean}` from classifier output; default true if ambiguous (prefer fetching sources). */
function parseNeedWebDecision(text: string): boolean {
  try {
    const raw = parseLenientLlmJson(text ?? '');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const v = (raw as Record<string, unknown>).need_web;
      if (v === true) return true;
      if (v === false) return false;
    }
  } catch {
    /* fall through */
  }
  return true;
}

export function ResearchLab({ aiConfig, callAI }: ResearchLabProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useAppDialog();
  const [phase, setPhase] = useState<'idle' | 'planning' | 'plan_ready' | 'researching' | 'completed'>('idle');
  const [query, setQuery] = useState('');
  /** Real execute pipeline: await resolveWebSearchForExecute → await callAI(report). */
  const [researchExecStage, setResearchExecStage] = useState<'resolving_context' | 'generating_report'>(
    'resolving_context',
  );
  const [researchPlan, setResearchPlan] = useState<ResearchPlanStep[]>([]);
  const [researchReport, setResearchReport] = useState<{intro: string, points: {title: string, text: string}[], conclusion: string}>({
    intro: '', points: [], conclusion: ''
  });
  const [reportGenerationFailed, setReportGenerationFailed] = useState(false);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'found' | 'fallback'>('idle');
  const [sourceCount, setSourceCount] = useState(0);
  const [planRevisionNote, setPlanRevisionNote] = useState('');
  const [planRevising, setPlanRevising] = useState(false);
  /** Raw model output while generating outline (streaming when provider supports it). */
  const [planStreamText, setPlanStreamText] = useState('');
  /** Raw model output while generating report (stream preview; parsed after complete). */
  const [reportStreamText, setReportStreamText] = useState('');
  const [searchSources, setSearchSources] = useState<ResearchSessionWebpageSnapshot[]>([]);
  const [sourceDetail, setSourceDetail] = useState<ResearchSessionWebpageSnapshot | null>(null);
  const executeResearchInFlightRef = useRef(false);
  /** When Metaso key is set: classifier result for current session (whether to call web search). */
  const labNeedWebRef = useRef(true);
  /** 历史会话/来源面板默认折叠，点击左上角按钮展开 */
  const [historyOpen, setHistoryOpen] = useState(false);

  const pastSessions = useLiveQuery(
    () => db.researchSessions.orderBy('createdAt').reverse().limit(RESEARCH_HISTORY_LIMIT).toArray(),
    []
  ) ?? [];

  useEffect(() => {
    if (!sourceDetail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSourceDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sourceDetail]);

  const openHistorySession = (session: ResearchSession) => {
    setQuery(session.query);
    setResearchPlan(session.researchPlan.map((s) => ({ title: s.title, desc: s.desc })));
    setResearchReport({
      intro: session.researchReport.intro,
      points: session.researchReport.points ?? [],
      conclusion: session.researchReport.conclusion,
    });
    setSourceCount(session.sourceCount);
    setSearchStatus(session.searchStatus);
    setSearchSources(session.searchWebpages ?? []);
    setReportGenerationFailed(false);
    setPhase('completed');
  };

  const deleteResearchSession = async (sessionId: string) => {
    const ok = await confirm({
      message: t('lab.delete_session_confirm'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await db.researchSessions.delete(sessionId);
    } catch (e) {
      console.error('[Scribe AI] ResearchLab delete session failed', formatAiError(e));
    }
  };

  const classifyNeedWebSearch = async (searchQuery: string): Promise<boolean> => {
    try {
      const prompt = t('lab.ai_need_web_classifier', { query: searchQuery });
      const text = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt,
      });
      return parseNeedWebDecision(String(text ?? ''));
    } catch (e) {
      console.warn('[Scribe AI] ResearchLab need_web classification failed', formatAiError(e));
      return true;
    }
  };

  /**
   * If Metaso key is set: run lightweight classifier once per session start; only search when need_web.
   * If no key: no classifier; returns empty outcome (same as before).
   */
  const resolveWebSearchOutcome = async (searchQuery: string): Promise<WebSearchOutcome> => {
    const apiKey = aiConfig.metasoApiKey?.trim();
    if (!apiKey) {
      return tryWebSearch(searchQuery);
    }
    const needWeb = await classifyNeedWebSearch(searchQuery);
    labNeedWebRef.current = needWeb;
    if (!needWeb) {
      setSearchStatus('idle');
      setSourceCount(0);
      setSearchSources([]);
      return { ...EMPTY_WEB_OUTCOME };
    }
    return tryWebSearch(searchQuery);
  };

  /**
   * Execute-phase search: reuse session classifier; skip Metaso when model chose reasoning-only.
   */
  const resolveWebSearchForExecute = async (searchQuery: string): Promise<WebSearchOutcome> => {
    const apiKey = aiConfig.metasoApiKey?.trim();
    if (!apiKey) {
      return tryWebSearch(searchQuery);
    }
    if (!labNeedWebRef.current) {
      setSearchStatus('idle');
      setSourceCount(0);
      setSearchSources([]);
      return { ...EMPTY_WEB_OUTCOME };
    }
    return tryWebSearch(searchQuery);
  };

  /**
   * Attempt a Metaso web search; returns context string and status for prompts and persistence.
   */
  const tryWebSearch = async (searchQuery: string): Promise<WebSearchOutcome> => {
    const apiKey = aiConfig.metasoApiKey?.trim();
    if (!apiKey) {
      setSearchStatus('idle');
      setSourceCount(0);
      setSearchSources([]);
      return { context: '', sourceCount: 0, searchStatus: 'idle', webpages: [] };
    }

    setSearchStatus('searching');
    try {
      const results = await metasoSearch(searchQuery, { apiKey });
      const context = buildSearchContext(results);
      const webpages = (results.webpages ?? []).map((w) => ({
        title: String(w.title ?? ''),
        link: String(w.link ?? ''),
        snippet: String(w.snippet ?? ''),
      }));
      if (context) {
        const count = webpages.length;
        setSourceCount(count);
        setSearchStatus('found');
        setSearchSources(webpages);
        return { context, sourceCount: count, searchStatus: 'found', webpages };
      }
      setSearchStatus('fallback');
      setSearchSources([]);
      return { context: '', sourceCount: 0, searchStatus: 'fallback', webpages: [] };
    } catch (e) {
      console.warn('[Scribe AI] Metaso search failed, degrading to offline mode', formatAiError(e));
      setSearchStatus('fallback');
      setSearchSources([]);
      return { context: '', sourceCount: 0, searchStatus: 'fallback', webpages: [] };
    }
  };

  const generatePlan = async () => {
    setPhase('planning');
    setReportGenerationFailed(false);
    setSearchStatus('idle');
    setSearchSources([]);
    setSourceDetail(null);
    setPlanRevisionNote('');
    labNeedWebRef.current = true;
    setPlanStreamText('');
    setReportStreamText('');

    const { context: searchContext } = await resolveWebSearchOutcome(query);

    try {
      const prompt = searchContext
        ? `${t('lab.ai_decompose_question', { query })}\n\nAdditionally, here are web search results that may inform your plan:\n\n${searchContext}`
        : t('lab.ai_decompose_question', { query });

      const text = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt,
        onStreamChunk: (acc) => setPlanStreamText(acc),
      });
      const plan = normalizeResearchPlan(parseLenientLlmJson(text ?? '[]'));
      setResearchPlan(plan.length > 0 ? plan : RESEARCH_PLAN_FALLBACK);
      setPlanStreamText('');
      setPhase('plan_ready');
    } catch (e) {
      console.error('[Scribe AI] ResearchLab generatePlan failed', formatAiError(e));
      setPlanStreamText('');
      setResearchPlan(RESEARCH_PLAN_FALLBACK);
      setPhase('plan_ready');
    }
  };

  const updatePlanItem = (idx: number, field: 'title' | 'desc', value: string) => {
    setResearchPlan(prev => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const revisePlanWithAi = async () => {
    const instruction = planRevisionNote.trim();
    if (!instruction || planRevising || researchPlan.length === 0) return;

    setPlanRevising(true);
    setPlanStreamText('');
    try {
      const prompt = t('lab.ai_revise_decompose', {
        query,
        plan: JSON.stringify(researchPlan, null, 2),
        instruction,
      });
      const text = await callAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt,
        onStreamChunk: (acc) => setPlanStreamText(acc),
      });
      const revised = normalizeResearchPlan(parseLenientLlmJson(text ?? '[]'));
      if (revised.length > 0) {
        setResearchPlan(revised);
        setPlanRevisionNote('');
      }
      setPlanStreamText('');
    } catch (e) {
      console.error('[Scribe AI] ResearchLab revisePlan failed', formatAiError(e));
      setPlanStreamText('');
    } finally {
      setPlanRevising(false);
    }
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    generatePlan();
  };

  const executeResearch = async () => {
    if (executeResearchInFlightRef.current) return;
    executeResearchInFlightRef.current = true;
    try {
      setPhase('researching');
      setReportGenerationFailed(false);
      setSourceDetail(null);
      setResearchExecStage('resolving_context');

      const {
        context: searchContext,
        sourceCount: persistedSourceCount,
        searchStatus: persistedSearchStatus,
        webpages: persistedSearchWebpages,
      } = await resolveWebSearchForExecute(query);

      setResearchExecStage('generating_report');
      setReportStreamText('');

      const planContext =
        researchPlan.length > 0
          ? `\n\nThe user-approved research plan (your report must follow this structure: align the "points" array with these steps in order and honor each step's goals in the analysis):\n${JSON.stringify(researchPlan, null, 2)}`
          : '';

      const fallbackReport = researchReportParseFallback(i18n.language);

      let finalReport: ResearchReportBody = fallbackReport;
      let executionSucceeded = false;

      try {
        const prompt = searchContext
          ? `${t('lab.ai_research_report', { query })}${planContext}\n\nUse the following web search results as primary sources for your report. Cite sources where appropriate.\n\n${searchContext}`
          : `${t('lab.ai_research_report', { query })}${planContext}`;

        const text = await callAI({
          config: aiConfig,
          systemInstruction: getLocaleDirective(),
          prompt,
          onStreamChunk: (acc) => setReportStreamText(acc),
        });
        setReportStreamText('');
        const report = normalizeResearchReport(parseLenientLlmJson(text ?? '{}'));
        setResearchReport(report);
        finalReport = report;
        executionSucceeded = true;
      } catch (e) {
        console.error('[Scribe AI] ResearchLab executeResearch failed', formatAiError(e));
        setReportStreamText('');
        setReportGenerationFailed(true);
        setResearchReport(fallbackReport);
        finalReport = fallbackReport;
      } finally {
        if (executionSucceeded) {
          try {
            const now = Date.now();
            await db.researchSessions.add({
              id: crypto.randomUUID(),
              query,
              createdAt: now,
              updatedAt: now,
              researchPlan: researchPlan.map((s) => ({ title: s.title, desc: s.desc })),
              researchReport: {
                intro: finalReport.intro ?? '',
                points: Array.isArray(finalReport.points)
                  ? finalReport.points.map((p: { title?: string; text?: string }) => ({
                      title: String(p?.title ?? ''),
                      text: String(p?.text ?? ''),
                    }))
                  : [],
                conclusion: finalReport.conclusion ?? '',
              },
              sourceCount: persistedSourceCount,
              searchStatus: persistedSearchStatus,
              searchWebpages: persistedSearchWebpages,
            });
          } catch (persistErr) {
            console.error('[Scribe AI] ResearchLab failed to persist session', persistErr);
          }
        }
        setPhase('completed');
      }
    } finally {
      executeResearchInFlightRef.current = false;
    }
  };

  return (
    <div className="flex-1 flex min-h-0 bg-[#FAF9F6] paper-texture text-[#1a1a1a] overflow-hidden">
      {/* Side Panel: History & Status（默认折叠，点击左上角按钮展开） */}
      {historyOpen && (
      <div className="w-64 border-r border-[#E6E4DF] flex flex-col bg-[#F4F1ED]/50 z-10 shrink-0">
        <div className="flex items-center justify-between px-4 h-12 border-b border-[#E6E4DF] shrink-0">
          <h3 className="font-sans text-xs font-bold text-[#8c8a84] uppercase tracking-wider">
            {phase === 'idle' ? t('lab.past_sessions') : t('lab.sources_utilized')}
          </h3>
          <button
            type="button"
            onClick={() => setHistoryOpen(false)}
            aria-label={t('settings.close')}
            title={t('settings.close')}
            className="rounded p-1 text-[#8c8a84] hover:bg-[#EAE7E2] hover:text-[#1a1a1a] transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
           {phase === 'idle' ? (
             <>
               <h3 className="font-sans text-xs font-bold text-[#8c8a84] uppercase tracking-wider mb-4">{t('lab.past_sessions')}</h3>
               {pastSessions.length === 0 ? (
                 <p className="text-xs text-[#8c8a84] font-sans leading-relaxed">{t('lab.no_past_sessions')}</p>
               ) : (
                 <div className="space-y-2">
                   {pastSessions.map((session) => (
                     <div
                       key={session.id}
                       className="flex gap-0 rounded-lg border border-[#E6E4DF] bg-white shadow-sm overflow-hidden hover:border-[#C2410C]/45 transition-colors"
                     >
                       <button
                         type="button"
                         data-testid={`research-session-${session.id}`}
                         onClick={() => openHistorySession(session)}
                         className="flex-1 min-w-0 text-left p-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C2410C]/25"
                       >
                         <div className="text-[#8c8a84] text-[10px] mb-1 font-sans">
                           {formatSessionListDate(session.createdAt, i18n.language)}
                         </div>
                         <div className="text-sm font-sans font-medium text-[#1a1a1a] line-clamp-3">{session.query}</div>
                       </button>
                       <button
                         type="button"
                         data-testid={`research-session-delete-${session.id}`}
                         aria-label={t('lab.delete_session')}
                         title={t('lab.delete_session')}
                         onClick={(e) => {
                           e.preventDefault();
                           e.stopPropagation();
                           void deleteResearchSession(session.id);
                         }}
                         className="shrink-0 px-2.5 flex items-center justify-center border-l border-[#E6E4DF] text-[#8c8a84] hover:bg-[#FEF2F2] hover:text-[#b91c1c] transition-colors"
                       >
                         <Trash2 className="w-4 h-4" aria-hidden />
                       </button>
                     </div>
                   ))}
                 </div>
               )}
             </>
           ) : (
             <>
               <div className="flex justify-between items-center mb-4">
                 <span className="font-mono text-xs text-[#8c8a84] uppercase font-bold tracking-wider">{t('lab.sources_utilized')}</span>
                 {phase === 'completed' && (
                   <button
                     type="button"
                     onClick={() => {
                       setPhase('idle');
                       setQuery('');
                       setSearchStatus('idle');
                       setSourceCount(0);
                       setSearchSources([]);
                       setReportGenerationFailed(false);
                       setSourceDetail(null);
                       labNeedWebRef.current = true;
                       setPlanStreamText('');
                     }}
                     className="text-[#C2410C] text-xs hover:underline font-bold"
                   >
                     {t('lab.new_research')}
                   </button>
                 )}
               </div>

               {/* Search status indicator */}
               {searchStatus === 'searching' && (
                 <div className="mb-3 p-2 bg-white border border-[#C2410C]/30 rounded text-xs flex items-center gap-2 text-[#C2410C] font-mono">
                   <Globe className="w-3 h-3 animate-pulse" />
                   <span>{t('lab.searching')}</span>
                 </div>
               )}
               {searchStatus === 'found' && (
                 <div className="mb-3 p-2 bg-white border border-[#4ade80]/30 rounded text-xs flex items-center gap-2 text-[#16a34a] font-mono">
                   <Globe className="w-3 h-3" />
                   <span>{t('lab.search_complete', { count: sourceCount })}</span>
                 </div>
               )}
               {searchStatus === 'fallback' && (
                 <div className="mb-3 p-2 bg-white border border-[#eab308]/30 rounded text-xs flex items-center gap-2 text-[#a16207] font-mono">
                   <AlertTriangle className="w-3 h-3" />
                   <span>{t('lab.search_fallback')}</span>
                 </div>
               )}

               <div className="space-y-3">
                 {searchSources.length > 0 ? (
                   searchSources.map((wp, idx) => {
                     const cardShell =
                       'w-full text-left bg-white border border-[#E6E4DF] p-3 rounded-lg text-sm shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2410C]/30 hover:border-[#C2410C]/45 hover:shadow-md cursor-pointer';
                     return (
                       <button
                         key={`${wp.link}-${idx}`}
                         type="button"
                         data-testid={`lab-source-card-${idx}`}
                         aria-label={t('lab.source_view_detail')}
                         onClick={() => setSourceDetail(wp)}
                         className={`${cardShell} ${
                           phase === 'researching' && researchExecStage === 'resolving_context'
                             ? 'opacity-90'
                             : ''
                         }`}
                       >
                         <div className="text-[10px] text-[#4ade80] mb-1 font-mono flex items-center gap-1 font-bold">
                           <Check className="w-3 h-3 shrink-0" aria-hidden />
                           {t('lab.processed')}
                         </div>
                         <div className="flex items-start justify-between gap-2">
                           <span className="text-[#1a1a1a] font-serif font-bold leading-snug line-clamp-3">
                             {wp.title?.trim() || wp.link || t('lab.source_untitled')}
                           </span>
                           <ExternalLink className="w-4 h-4 shrink-0 text-[#8c8a84] mt-0.5" aria-hidden />
                         </div>
                         {wp.snippet?.trim() ? (
                           <p className="text-[#5a5a54] text-xs mt-2 font-sans leading-relaxed line-clamp-4">
                             {wp.snippet.trim()}
                           </p>
                         ) : null}
                       </button>
                     );
                   })
                 ) : (
                   <p className="text-[11px] text-[#8c8a84] font-sans leading-relaxed px-0.5">{t('lab.sources_none_hint')}</p>
                 )}
               </div>
             </>
           )}
        </div>
      </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {/* 折叠时的左上角切换按钮 */}
        {!historyOpen && (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            data-testid="research-history-toggle"
            className="absolute top-4 left-4 z-20 inline-flex items-center gap-2 rounded-lg border border-[#E6E4DF] bg-white/90 px-3 py-2 text-xs font-sans font-bold text-[#5a5a54] shadow-sm backdrop-blur hover:bg-white hover:border-[#C2410C]/45 hover:text-[#1a1a1a] transition-colors"
            title={phase === 'idle' ? t('lab.past_sessions') : t('lab.sources_utilized')}
            aria-label={phase === 'idle' ? t('lab.past_sessions') : t('lab.sources_utilized')}
          >
            <History className="w-4 h-4 text-[#C2410C]" aria-hidden />
            {phase === 'idle' ? t('lab.past_sessions') : t('lab.sources_utilized')}
          </button>
        )}
         {phase === 'idle' && (
           <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-3xl mx-auto w-full">
               <div className="w-16 h-16 bg-white border border-[#E6E4DF] shadow-sm rounded-2xl flex items-center justify-center mb-8">
                <Microscope className="w-8 h-8 text-[#C2410C]" />
              </div>
              <h1 className="text-4xl font-serif font-bold mb-4 text-center text-[#1a1a1a]">{t('lab.investigate')}</h1>
              <p className="text-[#5a5a54] text-center mb-8 font-sans text-lg">
                 {t('lab.idle_intro')}
              </p>

              <form onSubmit={handleStart} className="w-full relative group">
                 <div className="absolute -inset-1 bg-gradient-to-r from-[#C2410C]/20 to-[#C2410C]/0 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
                 <input
                   type="text"
                   value={query}
                   onChange={e => setQuery(e.target.value)}
                   placeholder={t('lab.placeholder')}
                   className="relative w-full bg-white border border-[#E6E4DF] text-[#1a1a1a] pl-6 pr-16 py-4 rounded-xl font-sans focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] shadow-lg text-lg placeholder-[#8c8a84]"
                   autoFocus
                 />
                 <button
                   type="submit"
                   className={`absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg flex items-center justify-center transition-all ${query.trim() ? 'bg-[#C2410C] text-white hover:bg-[#a0350a] shadow-md' : 'bg-[#F4F1ED] text-[#8c8a84] cursor-not-allowed border border-[#E6E4DF]'}`}
                 >
                   <ArrowRight className="w-5 h-5" />
                 </button>
              </form>

              <div className="mt-8 flex gap-3 text-xs font-mono text-[#5a5a54]">
                 <span className="bg-white px-3 py-1 rounded-full border border-[#E6E4DF] shadow-sm">{t('lab.suggested_tag_1')}</span>
                 <span className="bg-white px-3 py-1 rounded-full border border-[#E6E4DF] shadow-sm">{t('lab.suggested_tag_2')}</span>
              </div>
           </div>
         )}

         {(phase === 'planning' || phase === 'plan_ready') && (
           <div className="flex-1 p-12 overflow-y-auto w-full max-w-5xl mx-auto">
              <div className="mb-8 border-b border-[#E6E4DF] pb-8">
                 <div className="text-[#C2410C] font-mono text-xs mb-2">{t('lab.target_inquiry')}</div>
                 <h2 className="text-3xl font-serif font-bold text-[#1a1a1a]">{query}</h2>
              </div>

              <div className="bg-white border border-[#E6E4DF] shadow-md rounded-xl p-8 relative overflow-hidden">
                {phase === 'planning' && (
                  <div className="space-y-4">
                    {planStreamText ? (
                      <div className="space-y-2">
                        <p className="text-xs text-[#8c8a84] font-sans leading-relaxed">{t('lab.plan_stream_hint')}</p>
                        <pre className="max-h-[min(420px,55vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[#1a1a1a] bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg p-4">
                          {planStreamText}
                        </pre>
                      </div>
                    ) : null}
                    <div className={`flex flex-col items-center justify-center gap-3 ${planStreamText ? 'py-6' : 'py-12'}`}>
                      <Loader2 className="w-8 h-8 text-[#C2410C] animate-spin" aria-hidden />
                      <div className="font-mono text-sm text-[#8c8a84] text-center px-2">
                        {searchStatus === 'searching'
                          ? t('lab.searching')
                          : planStreamText
                            ? t('lab.plan_stream_status')
                            : t('nodes.ai_loading')}
                      </div>
                    </div>
                  </div>
                )}

                {phase === 'plan_ready' && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                     <div className="flex items-center gap-3 mb-2">
                        <ListChecks className="w-6 h-6 text-[#4ade80]" />
                        <h3 className="text-xl font-sans font-bold text-[#1a1a1a]">{t('lab.recommended_plan_title')}</h3>
                     </div>
                     <p className="text-[#5a5a54] text-sm font-sans mb-6">{t('lab.plan_edit_hint')}</p>

                     {planRevising && planStreamText ? (
                       <pre className="mb-6 max-h-[min(280px,40vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[#1a1a1a] bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg p-4">
                         {planStreamText}
                       </pre>
                     ) : null}

                     <div className="space-y-5 mb-8">
                        {researchPlan.length > 0 ? researchPlan.map((plan, idx) => (
                           <div key={idx} className="flex gap-4">
                              <div className="w-6 h-6 rounded-full bg-[#F4F1ED] border border-[#E6E4DF] flex items-center justify-center font-mono text-xs text-[#5a5a54] shrink-0 font-bold mt-2">{idx + 1}</div>
                              <div className="flex-1 min-w-0 space-y-2">
                                 <input
                                   type="text"
                                   value={plan.title}
                                   onChange={e => updatePlanItem(idx, 'title', e.target.value)}
                                   disabled={planRevising}
                                   className="w-full font-bold text-[#1a1a1a] text-base bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg px-3 py-2 font-sans focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] disabled:opacity-60"
                                   aria-label={`Step ${idx + 1} title`}
                                 />
                                 <textarea
                                   value={plan.desc}
                                   onChange={e => updatePlanItem(idx, 'desc', e.target.value)}
                                   disabled={planRevising}
                                   rows={4}
                                   className="w-full text-[#5a5a54] text-sm bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg px-3 py-2 font-sans leading-relaxed resize-y min-h-[5rem] focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] disabled:opacity-60"
                                   aria-label={`Step ${idx + 1} description`}
                                 />
                              </div>
                           </div>
                        )) : (
                           <div className="text-center text-[#5a5a54]">Generating plan...</div>
                        )}
                     </div>

                     <div className="border-t border-[#E6E4DF] pt-6 space-y-3">
                        <form
                          onSubmit={e => {
                            e.preventDefault();
                            void revisePlanWithAi();
                          }}
                          className="space-y-3"
                        >
                           <textarea
                             value={planRevisionNote}
                             onChange={e => setPlanRevisionNote(e.target.value)}
                             disabled={planRevising || researchPlan.length === 0}
                             rows={3}
                             placeholder={t('lab.plan_revision_placeholder')}
                             className="w-full text-[#1a1a1a] text-sm bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg px-4 py-3 font-sans placeholder:text-[#8c8a84] focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] disabled:opacity-60 resize-y min-h-[5.5rem]"
                           />
                           <div className="flex flex-wrap items-center justify-between gap-3">
                              <button
                                type="submit"
                                disabled={planRevising || !planRevisionNote.trim() || researchPlan.length === 0}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-sans text-sm font-bold border border-[#E6E4DF] bg-white text-[#1a1a1a] hover:border-[#C2410C]/60 hover:bg-[#FFF7ED] disabled:opacity-50 disabled:pointer-events-none transition-colors shadow-sm"
                              >
                                {planRevising ? <Loader2 className="w-4 h-4 animate-spin text-[#C2410C]" /> : <Sparkles className="w-4 h-4 text-[#C2410C]" />}
                                {planRevising ? t('lab.plan_revision_applying') : t('lab.plan_revision_apply')}
                              </button>
                           </div>
                        </form>
                     </div>

                     <div className="flex justify-end pt-6 border-t border-[#E6E4DF] mt-6">
                        <button
                          type="button"
                          onClick={() => void executeResearch()}
                          disabled={planRevising || researchPlan.length === 0}
                          className="bg-[#C2410C] hover:bg-[#a0350a] disabled:opacity-50 disabled:pointer-events-none text-white px-6 py-3 rounded-lg font-sans font-bold transition-all shadow-md flex items-center gap-2"
                        >
                          {t('lab.approve')} <ArrowRight className="w-4 h-4" />
                        </button>
                     </div>
                  </div>
                )}
              </div>
           </div>
         )}

         {phase === 'researching' && (
           <div className="flex-1 flex items-center justify-center p-8 w-full max-w-2xl mx-auto">
              <div className="w-full bg-white border border-[#E6E4DF] shadow-md rounded-xl p-6 font-mono text-sm">
                 <div className="flex items-center gap-2 mb-6 text-[#C2410C] font-bold">
                   <Terminal className="w-4 h-4" />
                   <span>{t('lab.executing')}</span>
                 </div>

                 <div className="space-y-4 text-[#8c8a84]">
                   {/* Web search step */}
                   <div className="flex items-center gap-3">
                     {searchStatus === 'found' ? (
                       <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
                     ) : searchStatus === 'fallback' ? (
                       <AlertTriangle className="w-4 h-4 text-[#eab308]" />
                     ) : searchStatus === 'searching' ? (
                       <Loader2 className="w-4 h-4 animate-spin text-[#C2410C]" />
                     ) : (
                       <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
                     )}
                     <span className={
                       searchStatus === 'found' ? "text-[#1a1a1a]" :
                       searchStatus === 'fallback' ? "text-[#a16207]" :
                       searchStatus === 'searching' ? "text-[#1a1a1a]" :
                       "text-[#5a5a54]"
                     }>
                       {searchStatus === 'searching' && t('lab.searching')}
                       {searchStatus === 'found' && t('lab.search_complete', { count: sourceCount })}
                       {searchStatus === 'fallback' && t('lab.search_fallback')}
                       {searchStatus === 'idle' &&
                         (aiConfig.metasoApiKey ? t('lab.search_preparing') : t('lab.search_offline_no_key'))}
                     </span>
                   </div>

                   <div className="flex items-center gap-3">
                     {researchExecStage === 'resolving_context' ? (
                       <Loader2 className="w-4 h-4 animate-spin text-[#C2410C] shrink-0" aria-hidden />
                     ) : (
                       <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" aria-hidden />
                     )}
                     <span
                       className={
                         researchExecStage === 'resolving_context' ? 'text-[#5a5a54]' : 'text-[#1a1a1a]'
                       }
                     >
                       {t('lab.stage_resolving_context')}
                     </span>
                   </div>

                   <div className="flex items-center gap-3">
                     {researchExecStage === 'generating_report' ? (
                       <Loader2 className="w-4 h-4 animate-spin text-[#C2410C] shrink-0" aria-hidden />
                     ) : (
                       <span
                         className="w-4 h-4 shrink-0 rounded-full border-2 border-[#E6E4DF]"
                         aria-hidden
                       />
                     )}
                     <span
                       className={
                         researchExecStage === 'generating_report'
                           ? 'text-[#1a1a1a]'
                           : 'text-[#8c8a84]'
                       }
                     >
                       {reportStreamText
                         ? t('lab.report_stream_status')
                         : t('lab.stage_generating_report')}
                     </span>
                   </div>
                   {reportStreamText ? (
                     <pre className="mt-4 max-h-[min(360px,50vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[#1a1a1a] bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg p-4">
                       {reportStreamText}
                     </pre>
                   ) : null}
                 </div>
              </div>
           </div>
         )}

         {phase === 'completed' && (
            <div className="flex-1 flex overflow-hidden">
               {/* Final Report */}
               <div className="flex-1 bg-[#FAF9F6] text-[#1a1a1a] overflow-y-auto relative paper-texture">
                     <div className="max-w-5xl mx-auto px-16 py-14">
                     {reportGenerationFailed && (
                       <div className="mb-8 rounded-xl border border-[#eab308]/40 bg-[#fffbeb] px-5 py-4 font-sans text-sm text-[#713f12] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                         <div className="flex gap-3 min-w-0">
                           <AlertTriangle className="w-5 h-5 shrink-0 text-[#b45309]" aria-hidden />
                           <p className="leading-relaxed">{t('lab.report_failed_banner')}</p>
                         </div>
                         <button
                           type="button"
                           data-testid="lab-retry-report"
                           onClick={() => void executeResearch()}
                           className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg bg-[#C2410C] px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-[#a0350a] transition-colors"
                         >
                           {t('lab.retry_generate_report')}
                         </button>
                       </div>
                     )}
                     <div className="mb-12 text-center">
                        <div className="text-[#C2410C] font-mono text-xs uppercase tracking-widest mb-4 flex items-center justify-center gap-2 font-bold">
                          <FileText className="w-4 h-4" /> {t('lab.report')}
                        </div>
                        <h1 className="font-serif text-[44px] font-bold leading-tight mb-4">{query || t('lab.report')}</h1>
                        <div className="h-0.5 w-20 bg-[#1a1a1a] mx-auto"></div>
                        {searchStatus === 'found' && (
                          <p className="text-xs text-[#8c8a84] mt-3 font-mono">{t('lab.report_footer_web', { count: sourceCount })}</p>
                        )}
                        {searchStatus === 'fallback' && (
                          <p className="text-xs text-[#a16207] mt-3 font-mono">{t('lab.report_footer_offline')}</p>
                        )}
                     </div>

                     <div className="font-serif text-[19px] leading-[1.9] text-[#1a1a1a] space-y-7">
                        <p>{researchReport.intro}</p>

                        {researchReport.points?.map((pt, idx) => (
                           <React.Fragment key={idx}>
                              <h3 className="font-sans font-bold text-[22px] mt-10 mb-4">{idx + 1}. {pt.title}</h3>
                              <p>{pt.text}</p>
                           </React.Fragment>
                        ))}

                        <div className="bg-[#fff9e6] border-l-4 border-[#C2410C] p-5 text-[#5a5a54] font-sans text-sm my-8 shadow-sm rounded-r">
                           <strong className="text-[#1a1a1a]">{t('lab.conclusion_label')}</strong> {researchReport.conclusion}
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         )}
      </div>

      {sourceDetail ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          data-testid="lab-source-detail-modal"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSourceDetail(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lab-source-detail-title"
            className="flex max-h-[min(560px,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[#E6E4DF] bg-[#FAF9F6] shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#E6E4DF] bg-white px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#C2410C]">{t('lab.source_detail_heading')}</p>
                <h2 id="lab-source-detail-title" className="mt-1 font-serif text-lg font-bold leading-snug text-[#1a1a1a]">
                  {sourceDetail.title?.trim() || sourceDetail.link || t('lab.source_untitled')}
                </h2>
              </div>
              <button
                type="button"
                aria-label={t('settings.close')}
                className="shrink-0 rounded-lg p-1.5 text-[#8c8a84] transition-colors hover:bg-[#F4F1ED] hover:text-[#1a1a1a]"
                onClick={() => setSourceDetail(null)}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <p className="text-xs leading-relaxed text-[#5a5a54]">{t('lab.source_modal_hint')}</p>
              {sourceDetail.snippet?.trim() ? (
                <p className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#1a1a1a]">{sourceDetail.snippet.trim()}</p>
              ) : null}
              {sourceDetail.link?.trim() ? (
                <p className="mt-4 break-all font-mono text-[11px] text-[#8c8a84]">{sourceDetail.link.trim()}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#E6E4DF] bg-white px-4 py-3">
              <button
                type="button"
                className="rounded-lg border border-[#E6E4DF] bg-white px-4 py-2 text-sm font-bold text-[#1a1a1a] shadow-sm hover:bg-[#FAF9F6]"
                onClick={() => setSourceDetail(null)}
              >
                {t('settings.close')}
              </button>
              {sourceDetail.link?.trim() && /^https?:\/\//i.test(sourceDetail.link.trim()) ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#C2410C] px-4 py-2 text-sm font-bold text-white shadow-md hover:bg-[#a0350a]"
                  onClick={() => {
                    void openExternalUrl(sourceDetail.link).catch((err) =>
                      console.error('[Scribe AI] openExternalUrl failed', err),
                    );
                  }}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  {t('lab.open_in_system_browser')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
