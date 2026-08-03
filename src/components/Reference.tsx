import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import {
  Library,
  Plus,
  Search,
  Link2,
  BookOpen,
  X,
  Trash2,
  GripVertical,
  Pencil,
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
  Layers,
  Type,
} from 'lucide-react';
import { db } from '../db';
import type { Article, SourceCardSegment } from '../db';
import { isContentBlurPersistenceDisabled } from '../config/persistence';
import { useAppDialog } from './AppDialogProvider';

const REFERENCE_MARKDOWN_PLUGINS = [remarkBreaks];

function articleMatchesSearch(a: Article, q: string): boolean {
  if (!q.trim()) return true;
  const low = q.trim().toLowerCase();
  return (
    a.title.toLowerCase().includes(low) ||
    a.type.toLowerCase().includes(low) ||
    (a.content ?? '').toLowerCase().includes(low)
  );
}

/** 把卡片类型映射到侧栏图标 */
function CardKindIcon({ kind, className }: { kind: string; className?: string }) {
  switch (kind) {
    case 'image':
      return <ImageIcon className={className} />;
    case 'video':
      return <VideoIcon className={className} />;
    case 'book':
      return <BookOpen className={className} />;
    case 'theme':
      return <Layers className={className} />;
    case 'note':
    case 'text':
      return <Type className={className} />;
    default:
      return <FileText className={className} />;
  }
}

export interface ReferenceProps {
  articles: Article[];
  activeReferenceId: string;
  setActiveReferenceId: (id: string) => void;
  /** 从关联草稿跳转到素材库画布 */
  onOpenCanvas?: (canvasId: string) => void;
}

export function Reference({
  articles,
  activeReferenceId,
  setActiveReferenceId,
  onOpenCanvas,
}: ReferenceProps) {
  const { t } = useTranslation();
  const { confirm, alert: appAlert } = useAppDialog();
  const canvases = useLiveQuery(() => db.canvases.toArray(), []) ?? [];

  const [searchQuery, setSearchQuery] = useState('');
  /** 档案索引面板默认折叠，点击左上角按钮展开 */
  const [indexOpen, setIndexOpen] = useState(false);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [citationStatus, setCitationStatus] = useState('');
  /** 正文区作者 / 日期：本地草稿，避免 IndexedDB 回写节流时控件「弹回」或与 flex 挤压导致难以点击 */
  const [draftAuthor, setDraftAuthor] = useState('');
  const [draftDateField, setDraftDateField] = useState('');
  /** 正文区：当前正在逐段编辑的 segment 索引（仅 sourceCards 文章使用） */
  const [editingSegmentIdx, setEditingSegmentIdx] = useState<number | null>(null);
  /** 侧栏：当前正在内联编辑 segmentText 的卡片 nodeId */
  const [sidebarEditId, setSidebarEditId] = useState<string | null>(null);
  const [sidebarEditText, setSidebarEditText] = useState('');
  /** 拖拽排序 */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const authorMetaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateMetaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarEditDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredArticles = useMemo(() => {
    return articles.filter((a) => articleMatchesSearch(a, searchQuery));
  }, [articles, searchQuery]);

  const activeArticle = useMemo(() => {
    return articles.find((a) => a.id === activeReferenceId) ?? articles[0];
  }, [articles, activeReferenceId]);

  const sourceCards = activeArticle?.sourceCards ?? [];
  const hasSourceCards = sourceCards.length > 0;

  /** 派生正文：有 sourceCards 时按段拼接，否则用 content */
  const bodyText = useMemo(() => {
    if (hasSourceCards) return sourceCards.map((s) => s.segmentText).join('\n\n');
    return activeArticle?.content ?? '';
  }, [activeArticle?.id, hasSourceCards, sourceCards]);

  useEffect(() => {
    setIsEditingBody(false);
    setEditingSegmentIdx(null);
    setSidebarEditId(null);
    setDraftAuthor(activeArticle?.author ?? '');
    setDraftDateField(activeArticle?.date ?? '');
    if (authorMetaDebounceRef.current) {
      clearTimeout(authorMetaDebounceRef.current);
      authorMetaDebounceRef.current = null;
    }
    if (dateMetaDebounceRef.current) {
      clearTimeout(dateMetaDebounceRef.current);
      dateMetaDebounceRef.current = null;
    }
  }, [activeArticle?.id]);

  useEffect(() => {
    return () => {
      if (authorMetaDebounceRef.current) clearTimeout(authorMetaDebounceRef.current);
      if (dateMetaDebounceRef.current) clearTimeout(dateMetaDebounceRef.current);
      if (sidebarEditDebounceRef.current) clearTimeout(sidebarEditDebounceRef.current);
    };
  }, []);

  const handleAddArticle = async () => {
    const id = crypto.randomUUID();
    await db.articles.add({
      id,
      title: t('reference.new_article_title'),
      content: '',
      date: String(new Date().getFullYear()),
      type: 'REF',
      tags: [],
      linkedCanvasIds: [],
      author: '',
      privateNotes: '',
    });
    setActiveReferenceId(id);
  };

  const handleDeleteArticle = async (article: Article, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      message: t('reference.delete_confirm', { title: article.title }),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    await db.articles.delete(article.id);
    if (activeReferenceId === article.id) {
      const remaining = articles.filter((a) => a.id !== article.id);
      setActiveReferenceId(remaining[0]?.id ?? '');
    }
  };

  const copyCitation = async () => {
    if (!activeArticle) return;
    const authorForCitation = draftAuthor.trim() || activeArticle.author?.trim();
    const authorPart = authorForCitation ? `${authorForCitation}. ` : '';
    const dateForCitation = draftDateField.trim() || activeArticle.date;
    const line = `${authorPart}${activeArticle.title} (${dateForCitation}). ${activeArticle.type}.`;
    try {
      await navigator.clipboard.writeText(line);
      setCitationStatus('ok');
      setTimeout(() => setCitationStatus(''), 2500);
    } catch {
      void appAlert({ message: t('reference.citation_failed') });
    }
  };

  const linkedIds = activeArticle?.linkedCanvasIds ?? [];

  const markdownComponents = useMemo(() => {
    if (!activeArticle) return undefined;
    const mk =
      (Tag: 'h1' | 'h2' | 'h3') =>
      ({ children }: { children?: React.ReactNode }) => {
        const levelClass =
          Tag === 'h1'
            ? 'text-2xl font-bold mt-8 mb-4'
            : Tag === 'h2'
              ? 'text-xl font-bold mt-6 mb-3'
              : 'text-lg font-semibold mt-4 mb-2';
        return (
          <Tag className={levelClass}>
            {children}
          </Tag>
        );
      };
    return {
      h1: mk('h1'),
      h2: mk('h2'),
      h3: mk('h3'),
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="mb-4 last:mb-0">{children}</p>
      ),
    };
  }, [activeArticle?.id]);

  /** 持久化 sourceCards 变更，并同步 content（搜索/TOC/引用兼容） */
  const persistSourceCards = useCallback(
    async (next: SourceCardSegment[]) => {
      if (!activeArticle) return;
      const content = next.map((s) => s.segmentText).join('\n\n');
      await db.articles.update(activeArticle.id, { sourceCards: next, content });
    },
    [activeArticle],
  );

  /** 侧栏拖拽排序 */
  const handleDragStart = (idx: number) => setDragIndex(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };
  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);
    if (from === null || from === idx) return;
    const next = [...sourceCards];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    void persistSourceCards(next);
  };

  /** 侧栏删除某张来源卡片 */
  const handleDeleteSourceCard = async (nodeId: string) => {
    const ok = await confirm({
      message: t('reference.delete_card_confirm'),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    const next = sourceCards.filter((s) => s.nodeId !== nodeId);
    await persistSourceCards(next);
    if (sidebarEditId === nodeId) setSidebarEditId(null);
  };

  /** 侧栏内联编辑 segmentText */
  const startSidebarEdit = (seg: SourceCardSegment) => {
    setSidebarEditId(seg.nodeId);
    setSidebarEditText(seg.segmentText);
    if (sidebarEditDebounceRef.current) clearTimeout(sidebarEditDebounceRef.current);
  };

  const onSidebarEditTextChange = (v: string) => {
    setSidebarEditText(v);
    if (!activeArticle || !sidebarEditId) return;
    if (sidebarEditDebounceRef.current) clearTimeout(sidebarEditDebounceRef.current);
    sidebarEditDebounceRef.current = setTimeout(async () => {
      const next = sourceCards.map((s) =>
        s.nodeId === sidebarEditId ? { ...s, segmentText: v } : s,
      );
      await persistSourceCards(next);
    }, 500);
  };

  const commitSidebarEdit = async () => {
    if (sidebarEditDebounceRef.current) {
      clearTimeout(sidebarEditDebounceRef.current);
      sidebarEditDebounceRef.current = null;
    }
    if (activeArticle && sidebarEditId) {
      const next = sourceCards.map((s) =>
        s.nodeId === sidebarEditId ? { ...s, segmentText: sidebarEditText } : s,
      );
      await persistSourceCards(next);
    }
    setSidebarEditId(null);
  };

  /** 正文区逐段编辑：点击某段进入 contentEditable */
  const commitSegmentEdit = (idx: number, text: string) => {
    setEditingSegmentIdx(null);
    if (!activeArticle) return;
    const next = sourceCards.map((s, i) => (i === idx ? { ...s, segmentText: text } : s));
    void persistSourceCards(next);
  };

  return (
    <div className="flex-1 flex min-h-0 bg-[#FAF9F6] paper-texture overflow-hidden">
      {indexOpen && (
        <div className="w-64 border-r border-[#E6E4DF] bg-white flex flex-col z-10 shadow-sm relative shrink-0">
          <div className="p-4 border-b border-[#E6E4DF] bg-[#F4F1ED]/50 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm font-sans text-[#1a1a1a] flex items-center gap-2">
                <Library className="w-4 h-4" />
                {t('reference.index_title')}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleAddArticle()}
                  className="text-[#8c8a84] hover:text-[#1a1a1a] transition-colors p-1 rounded hover:bg-[#EAE7E2]"
                  title={t('reference.add_article')}
                  aria-label={t('reference.add_article')}
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIndexOpen(false)}
                  className="text-[#8c8a84] hover:text-[#1a1a1a] transition-colors p-1 rounded hover:bg-[#EAE7E2]"
                  title={t('settings.close')}
                  aria-label={t('settings.close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="mt-4 relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8c8a84]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('reference.search_refs')}
                className="w-full text-xs font-sans bg-white border border-[#E6E4DF] pl-9 pr-3 py-2 rounded-md focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all shadow-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {articles.length === 0 ? (
              <p className="text-xs text-[#8c8a84] px-1">{t('reference.empty_library')}</p>
            ) : filteredArticles.length === 0 ? (
              <p className="text-xs text-[#8c8a84] px-1">{t('reference.no_matches')}</p>
            ) : (
              filteredArticles.map((article) => (
                <div
                  key={article.id}
                  data-testid={`reference-list-item-${article.id}`}
                  onClick={() => setActiveReferenceId(article.id)}
                  className={`p-3 border rounded-md cursor-pointer transition-all relative overflow-hidden group ${
                    activeReferenceId === article.id
                      ? 'bg-[#F4F1ED] border-[#C2410C]/30'
                      : 'bg-white border-transparent hover:border-[#E6E4DF] hover:bg-[#FAF9F6] hover:shadow-sm'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1.5 gap-1">
                    <span
                      className={`min-w-0 truncate ${
                        activeReferenceId === article.id ? 'text-[#C2410C]' : 'text-[#8c8a84]'
                      } text-[10px] uppercase tracking-wider font-mono font-bold`}
                    >
                      {article.type}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[#8c8a84] text-[10px]">{article.date}</span>
                      <button
                        type="button"
                        data-testid={`reference-delete-${article.id}`}
                        title={t('reference.delete_article')}
                        aria-label={t('reference.delete_article')}
                        onClick={(e) => void handleDeleteArticle(article, e)}
                        className="rounded p-0.5 text-[#8c8a84] opacity-0 transition-all hover:bg-[#EAE7E2] hover:text-[#C2410C] group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#C2410C]/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <h3 className="font-bold text-sm leading-tight mb-1 font-serif pr-6 text-[#1a1a1a]">
                    {article.title}
                  </h3>
                  <p className="text-[#5a5a54] text-xs font-sans truncate">
                    {(article.content || '').slice(0, 50)}
                    {(article.content || '').length > 0 ? '…' : ''}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto relative bg-[#FAF9F6] border-r border-[#E6E4DF]">
        {/* 折叠时的左上角切换按钮 */}
        {!indexOpen && (
          <button
            type="button"
            onClick={() => setIndexOpen(true)}
            data-testid="reference-index-toggle"
            className="absolute top-4 left-4 z-20 inline-flex items-center gap-2 rounded-lg border border-[#E6E4DF] bg-white/90 px-3 py-2 text-xs font-sans font-bold text-[#5a5a54] shadow-sm backdrop-blur hover:bg-white hover:border-[#C2410C]/45 hover:text-[#1a1a1a] transition-colors"
            title={t('reference.index_title')}
            aria-label={t('reference.index_title')}
          >
            <Library className="w-4 h-4 text-[#C2410C]" aria-hidden />
            {t('reference.index_title')}
          </button>
        )}
        <div className="sticky top-0 w-full h-14 bg-white/80 backdrop-blur-md border-b border-[#E6E4DF] flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4 text-[#5a5a54]" />
          <div className="flex items-center gap-3">
            {citationStatus === 'ok' && (
              <span className="text-[10px] text-green-600 font-sans">{t('reference.citation_copied')}</span>
            )}
            <button
              type="button"
              onClick={() => void copyCitation()}
              disabled={!activeArticle}
              className="text-xs font-sans font-medium text-[#5a5a54] hover:text-[#1a1a1a] bg-white border border-[#E6E4DF] px-3 py-1.5 rounded shadow-sm flex items-center gap-2 disabled:opacity-40"
            >
              <Link2 className="w-3.5 h-3.5" />
              {t('reference.citation')}
            </button>
          </div>
        </div>

        {!activeArticle ? (
          <div className="max-w-2xl mx-auto my-24 px-6 text-center text-[#8c8a84] text-sm font-sans">
            {t('reference.empty_library')}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto my-12 bg-white border border-[#E6E4DF] shadow-md relative" key={activeArticle.id}>
            <div className="absolute -top-px -left-px -right-px h-1 bg-[#C2410C]" />

            <div className="p-16">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10 border-b-2 border-[#1a1a1a] pb-6 mb-10">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[#8c8a84] font-mono text-xs uppercase tracking-widest mb-3 flex flex-wrap items-center gap-x-1">
                    <span>{t('reference.document_prefix')}</span>
                    <input
                      className="bg-transparent border-0 border-b border-transparent focus:border-[#C2410C] outline-none min-w-[5rem] max-w-[12rem] font-mono text-[#8c8a84]"
                      value={activeArticle.type}
                      onChange={(e) => void db.articles.update(activeArticle.id, { type: e.target.value })}
                      aria-label={t('reference.document_prefix')}
                    />
                  </div>
                  <h1
                    className="font-serif text-4xl font-bold text-[#1a1a1a] leading-tight max-w-full focus:outline-none hover:bg-[#EAE7E2]/50 focus:bg-[#EAE7E2]/50 rounded px-2 -mx-2 transition-colors cursor-text"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      if (isContentBlurPersistenceDisabled()) return;
                      void db.articles.update(activeArticle.id, { title: e.currentTarget.innerText });
                    }}
                  >
                    {activeArticle.title}
                  </h1>
                </div>
                <div className="flex shrink-0 w-full flex-col gap-3 text-xs font-sans text-[#5a5a54] sm:w-auto sm:max-w-[11rem] md:items-end md:text-right">
                  <label className="flex flex-col gap-0.5 sm:items-stretch md:items-end">
                    <span className="shrink-0 font-bold">{t('reference.author_label')}:</span>
                    <input
                      type="text"
                      data-testid="reference-meta-author"
                      className="w-full shrink-0 min-w-0 border-0 bg-transparent px-0.5 py-1 text-[#5a5a54] outline-none rounded-sm hover:bg-[#F4F1ED]/80 focus-visible:bg-[#F4F1ED]/80 focus-visible:ring-1 focus-visible:ring-[#C2410C]/35 md:text-right"
                      value={draftAuthor}
                      aria-label={t('reference.author_label')}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraftAuthor(v);
                        const id = activeArticle.id;
                        if (authorMetaDebounceRef.current) clearTimeout(authorMetaDebounceRef.current);
                        authorMetaDebounceRef.current = setTimeout(() => {
                          authorMetaDebounceRef.current = null;
                          void db.articles.update(id, { author: v });
                        }, 450);
                      }}
                      onBlur={(e) => {
                        if (authorMetaDebounceRef.current) {
                          clearTimeout(authorMetaDebounceRef.current);
                          authorMetaDebounceRef.current = null;
                        }
                        void db.articles.update(activeArticle.id, { author: e.currentTarget.value });
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 sm:items-stretch md:items-end">
                    <span className="shrink-0 font-bold">{t('reference.published_label')}:</span>
                    <input
                      type="text"
                      data-testid="reference-meta-date"
                      className="w-full shrink-0 min-w-0 border-0 bg-transparent px-0.5 py-1 text-[#5a5a54] outline-none rounded-sm hover:bg-[#F4F1ED]/80 focus-visible:bg-[#F4F1ED]/80 focus-visible:ring-1 focus-visible:ring-[#C2410C]/35 md:text-right"
                      value={draftDateField}
                      aria-label={t('reference.published_label')}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraftDateField(v);
                        const id = activeArticle.id;
                        if (dateMetaDebounceRef.current) clearTimeout(dateMetaDebounceRef.current);
                        dateMetaDebounceRef.current = setTimeout(() => {
                          dateMetaDebounceRef.current = null;
                          void db.articles.update(id, { date: v });
                        }, 450);
                      }}
                      onBlur={(e) => {
                        if (dateMetaDebounceRef.current) {
                          clearTimeout(dateMetaDebounceRef.current);
                          dateMetaDebounceRef.current = null;
                        }
                        void db.articles.update(activeArticle.id, { date: e.currentTarget.value });
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="font-serif text-lg leading-relaxed tracking-[0.05em] text-[#1a1a1a]">
                {hasSourceCards ? (
                  <div className="space-y-6">
                    {sourceCards.map((seg, idx) => (
                      <div
                        key={seg.nodeId}
                        data-testid={`reference-segment-${idx}`}
                        className="rounded px-2 -mx-2 transition-colors"
                      >
                        {editingSegmentIdx === idx ? (
                          <div
                            className="min-h-[6rem] whitespace-pre-wrap focus:outline-none hover:bg-[#EAE7E2]/50 focus:bg-[#EAE7E2]/50 rounded transition-colors cursor-text"
                            contentEditable
                            suppressContentEditableWarning
                            data-testid={`reference-segment-edit-${idx}`}
                            onBlur={(e) => {
                              if (!isContentBlurPersistenceDisabled()) {
                                commitSegmentEdit(idx, e.currentTarget.innerText);
                              } else {
                                setEditingSegmentIdx(null);
                              }
                            }}
                          >
                            {seg.segmentText}
                          </div>
                        ) : (
                          <div
                            className="markdown-body min-h-[4rem] cursor-text rounded transition-colors hover:bg-[#EAE7E2]/30"
                            onClick={() => setEditingSegmentIdx(idx)}
                          >
                            <Markdown remarkPlugins={REFERENCE_MARKDOWN_PLUGINS} components={markdownComponents}>
                              {seg.segmentText || `_${t('reference.empty_body')}_`}
                            </Markdown>
                          </div>
                        )}
                        {idx < sourceCards.length - 1 && (
                          <div className="mt-6 border-t border-dashed border-[#E6E4DF]" />
                        )}
                      </div>
                    ))}
                  </div>
                ) : isEditingBody ? (
                  <div
                    className="min-h-[12rem] whitespace-pre-wrap focus:outline-none hover:bg-[#EAE7E2]/50 focus:bg-[#EAE7E2]/50 rounded px-2 -mx-2 transition-colors cursor-text"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      if (!isContentBlurPersistenceDisabled()) {
                        void db.articles.update(activeArticle.id, {
                          content: e.currentTarget.innerText,
                        });
                      }
                      setIsEditingBody(false);
                    }}
                  >
                    {activeArticle.content}
                  </div>
                ) : (
                  <div
                    className="markdown-body min-h-[12rem] cursor-text rounded px-2 -mx-2 transition-colors hover:bg-[#EAE7E2]/30"
                    onClick={() => setIsEditingBody(true)}
                  >
                    <Markdown remarkPlugins={REFERENCE_MARKDOWN_PLUGINS} components={markdownComponents}>
                      {activeArticle.content || `_${t('reference.empty_body')}_`}
                    </Markdown>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="w-72 bg-white flex-shrink-0 flex flex-col font-sans text-xs">
          <div className="p-4 border-b border-[#E6E4DF] font-bold text-[#1a1a1a] h-14 flex items-center bg-[#F4F1ED]/50">
            {t('reference.linked_drafts')}
          </div>
          <div className="p-6 space-y-4 overflow-y-auto">
            {hasSourceCards ? (
              <div className="space-y-2">
                {sourceCards.map((seg, idx) => {
                  const isEditing = sidebarEditId === seg.nodeId;
                  const isDragOver = dragOverIndex === idx && dragIndex !== null && dragIndex !== idx;
                  return (
                    <div
                      key={seg.nodeId}
                      data-testid={`reference-source-card-${idx}`}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      className={`flex items-start gap-2 p-3 bg-[#FAF9F6] border rounded transition-all ${
                        isDragOver
                          ? 'border-[#C2410C] bg-[#F4F1ED] shadow-sm'
                          : 'border-[#E6E4DF]'
                      } ${dragIndex === idx ? 'opacity-50' : ''}`}
                    >
                      <GripVertical
                        className="w-4 h-4 text-[#8c8a84] mt-0.5 shrink-0 cursor-grab"
                        aria-label={t('reference.drag_card')}
                      />
                      <CardKindIcon kind={seg.kind} className="w-4 h-4 text-[#C2410C] mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenCanvas?.(seg.canvasId)}
                            className="font-semibold text-[#1a1a1a] text-[11px] text-left hover:text-[#C2410C] hover:underline min-w-0 truncate"
                            disabled={!onOpenCanvas}
                            title={seg.title}
                          >
                            {seg.title || t('reference.untitled_card')}
                          </button>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              data-testid={`reference-source-card-edit-${idx}`}
                              onClick={() =>
                                isEditing ? void commitSidebarEdit() : startSidebarEdit(seg)
                              }
                              className="rounded p-0.5 text-[#8c8a84] hover:bg-[#EAE7E2] hover:text-[#1a1a1a]"
                              title={t('reference.edit_card')}
                              aria-label={t('reference.edit_card')}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              data-testid={`reference-source-card-delete-${idx}`}
                              onClick={() => void handleDeleteSourceCard(seg.nodeId)}
                              className="rounded p-0.5 text-[#8c8a84] hover:bg-[#EAE7E2] hover:text-[#C2410C]"
                              title={t('reference.delete_card')}
                              aria-label={t('reference.delete_card')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {isEditing && (
                          <textarea
                            data-testid={`reference-source-card-textarea-${idx}`}
                            value={sidebarEditText}
                            onChange={(e) => onSidebarEditTextChange(e.target.value)}
                            onBlur={() => void commitSidebarEdit()}
                            autoFocus
                            className="mt-2 w-full h-32 bg-white border border-[#E6E4DF] rounded-md p-2 text-[#5a5a54] resize-none focus:outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] shadow-sm font-sans text-[11px]"
                            placeholder={t('reference.edit_card_placeholder')}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : linkedIds.length === 0 ? (
              <p className="text-[11px] text-[#8c8a84]">{t('reference.linked_empty')}</p>
            ) : (
              <div className="space-y-2">
                {linkedIds.map((cid) => {
                  const c = canvases.find((x) => x.id === cid);
                  return (
                    <div key={cid} className="flex items-start gap-2 p-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded">
                      <BookOpen className="w-4 h-4 text-[#C2410C] mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onOpenCanvas?.(cid)}
                          className="font-semibold text-[#1a1a1a] text-[11px] text-left hover:text-[#C2410C] hover:underline"
                          disabled={!onOpenCanvas}
                        >
                          {c?.name ?? cid}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
