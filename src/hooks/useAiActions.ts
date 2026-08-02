import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentConfig, CanvasNode, Edge as DbEdge } from '../db';
import type { AIConfig } from '../components/AISettingsModal';
import type { CanvasTransform } from './useCanvasInteraction';
import { callUniversalAI, formatAiError, maskApiKeyForLog } from '../services/ai';
import { metasoSearch, resolveMetasoImageUrl } from '../services/search';
import { deriveNoteSearchQueries } from '../services/deriveNoteSearchQueries';
import { pickNoteSearchAvHits } from '../services/pickNoteSearchMediaHits';
import {
  deriveSearchQueryFromNoteText,
  spawnWebSearchCardsFromImages,
  spawnWebSearchCardsFromMedia,
  spawnWebSearchCardsFromPages,
} from '../services/spawnWebSearchNoteCards';
import { parseThreadWebSearchIntent, type WebSearchKind } from '../utils/webSearchCommand';
import { DEFAULT_NODE_SIZE, findOpenCanvasPosition, NEW_AI_NODE_SIZE } from '../utils/canvas';
import { buildAgentSystemInstruction, combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { collectAiThreadChain, formatAgentThreadDialogueHistory } from '../utils/agentThreadContext';
import {
  collectAgentContextImagePayload,
  resolveImageDataUrlsFromNodeIds,
} from '../utils/canvasContextImages';
import { getCanvasNodeContextText } from '../utils/canvasNodeContextText';
import { parsePublishArticleResponse } from '../utils/parsePublishArticleResponse';
import {
  buildPublishSourceMaterial,
  ensurePublishMediaInBody,
} from '../utils/publishSourceMaterial';
import { db } from '../db';
import { useAppDialog } from '../components/AppDialogProvider';
import { runCanvasStreamingAiCall } from '../utils/canvasStreamingAi';
import { parseBookExpandPlan, spawnBookExpandCards } from '../services/spawnBookExpandCards';

function formatAiFailureAlertMessage(msg: string, provider: string): string {
  const hostedDoubaoUnavailable =
    provider === 'doubao' && /托管豆包|VITE_BUILTIN_DOUBAO|无需自行配置/.test(msg);
  if (hostedDoubaoUnavailable) {
    return `AI 生成失败\n\n${msg}\n\nF12 → Console 查看 [Spoor] 日志。`;
  }
  return (
    `AI 生成失败\n\n${msg}\n\n请检查：1) 设置中 Provider / API Key / Base URL 2) 若用浏览器，需 npm run dev 且已重启（豆包 /api/doubao、MiMo /api/mimo、MiniMax /api/minimax 代理）；桌面端用 Tauri 可不依赖代理。\n\nF12 → Console 查看 [Spoor] 日志。`
  );
}

interface UseAiActionsParams {
  aiConfig: AIConfig;
  agentConfigs: AgentConfig[];
  activeCanvasId: string;
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  transformRef: RefObject<CanvasTransform>;
  dynamicNodes: CanvasNode[];
  edges: DbEdge[];
  selectedNodes: Set<string>;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveReferenceId: (id: string) => void;
  setActiveTab: (tab: string) => void;
}

export function useAiActions({
  aiConfig,
  agentConfigs,
  activeCanvasId,
  nodesRef,
  transformRef,
  dynamicNodes,
  edges,
  selectedNodes,
  setSelectedNodes,
  setActiveReferenceId,
  setActiveTab,
}: UseAiActionsParams) {
  const { t } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isToolbarAiLoading, setIsToolbarAiLoading] = useState(false);
  const [analyzingAgentNodeId, setAnalyzingAgentNodeId] = useState<string | null>(null);
  const [followUpParentId, setFollowUpParentId] = useState<string | null>(null);
  const [streamingAiNodeId, setStreamingAiNodeId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  /** Passage quoted from a book node (“Ask AI” on selection). */
  const [pendingQuote, setPendingQuote] = useState<{
    text: string;
    sourceLabel?: string;
    sourceNodeId?: string;
  } | null>(null);
  const [expandingBookNodeId, setExpandingBookNodeId] = useState<string | null>(null);
  const [searchingNoteNodeId, setSearchingNoteNodeId] = useState<string | null>(null);
  const followUpGuardRef = useRef(false);
  const expandGuardRef = useRef(false);
  const noteSearchGuardRef = useRef(false);

  const THREAD_GAP = 24;

  // streamingAiNodeId is intentionally included: voice-writing mode and follow-up threads both
  // mutate it without holding isToolbarAiLoading, so omitting it would let the toolbar launch a
  // second concurrent AI run that races on the same flag.
  const isAnyAiBusy =
    isPublishing ||
    isToolbarAiLoading ||
    analyzingAgentNodeId !== null ||
    followUpParentId !== null ||
    streamingAiNodeId !== null ||
    expandingBookNodeId !== null ||
    searchingNoteNodeId !== null;

  const handlePublish = async () => {
    if (selectedNodes.size === 0 || isAnyAiBusy) return;
    setIsPublishing(true);
    try {
      const selectedIds = Array.from(selectedNodes);
      const { promptContent, mediaAssets } = buildPublishSourceMaterial(
        selectedIds,
        dynamicNodes,
        (nodeId) => {
          const el = nodesRef.current[nodeId];
          return el ? getCanvasNodeContextText(el) : '';
        },
      );

      const text = await callUniversalAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: t('ai.prompts.publish', { content: promptContent }),
      });

      const parsed = parsePublishArticleResponse(text || '', t('ai.generated_article_title'));
      const body = ensurePublishMediaInBody(
        parsed.body,
        mediaAssets,
        t('ai.publish_related_media'),
      );

      const newArticle = {
        id: `gen-${Date.now()}`,
        title: parsed.title,
        content: body,
        date: new Date().getFullYear().toString(),
        type: 'GEN-' + Math.floor(Math.random() * 1000),
        tags: [] as string[],
        linkedCanvasIds: [activeCanvasId],
        author: '',
      };

      await db.articles.add(newArticle);
      setActiveReferenceId(newArticle.id);
      setActiveTab('reference');
      setSelectedNodes(new Set());
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] handlePublish failed', { error: msg, provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
      void appAlert({
        message: `合成失败\n\n${msg}\n\n打开开发者工具 (F12) → Console 查看 [Spoor] 日志。`,
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const triggerAgentAnalysis = async (agentConfigId: string, agentNodeId: string, contextNodeId: string) => {
    const agentConfig = agentConfigs.find(a => a.id === agentConfigId);
    if (!agentConfig) return;

    const contextEl = nodesRef.current[contextNodeId];
    if (!contextEl) return;

    const contextText = getCanvasNodeContextText(contextEl);
    if (!contextText.trim()) return;

    setAnalyzingAgentNodeId(agentNodeId);
    const agentNode = dynamicNodes.find(n => n.id === agentNodeId);
    const x = agentNode ? agentNode.x + 350 : window.innerWidth / 2;
    const y = agentNode ? agentNode.y : window.innerHeight / 2;
    const newNodeId = crypto.randomUUID();
    const edgeId = crypto.randomUUID();
    const { nodeIds: threadContextImageNodeIds, dataUrls: contextImageDataUrls } =
      collectAgentContextImagePayload(contextNodeId, agentNodeId, dynamicNodes, edges);

    await db.nodes.add({
      id: newNodeId,
      canvasId: activeCanvasId,
      type: 'ai',
      content: '',
      x,
      y,
      threadRootContextNodeId: contextNodeId,
      threadAgentConfigId: agentConfigId,
      ...(threadContextImageNodeIds.length > 0 ? { threadContextImageNodeIds } : {}),
    });
    await db.edges.add({ id: edgeId, canvasId: activeCanvasId, from: agentNodeId, to: newNodeId });
    setStreamingAiNodeId(newNodeId);

    try {
      const text = await runCanvasStreamingAiCall({
        nodeId: newNodeId,
        callAi: (onStreamChunk) =>
          callUniversalAI({
            config: aiConfig,
            prompt: t('ai.prompts.agentContext', { content: contextText }),
            systemInstruction: buildAgentSystemInstruction(agentConfig),
            temperature: agentConfig.temperature ?? 0.7,
            topP: agentConfig.creativity ?? 0.4,
            images: contextImageDataUrls.length > 0 ? contextImageDataUrls : undefined,
            onStreamChunk,
          }),
      });
      if (!text) {
        await db.edges.delete(edgeId);
      }
    } catch (e) {
      try {
        await db.edges.delete(edgeId);
      } catch {
        /* edge may be gone with node */
      }
      const msg = formatAiError(e);
      console.error('[Spoor] triggerAgentAnalysis failed', { error: msg, provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
      void appAlert({
        message: formatAiFailureAlertMessage(msg, aiConfig.provider),
      });
    } finally {
      setStreamingAiNodeId(null);
      setAnalyzingAgentNodeId(null);
    }
  };

  const askAboutSelection = (quote: string, sourceLabel?: string, sourceNodeId?: string) => {
    const text = quote.replace(/\s+/g, ' ').trim();
    if (!text) return;
    setPendingQuote({
      text,
      sourceLabel: sourceLabel?.trim() || undefined,
      sourceNodeId: sourceNodeId?.trim() || undefined,
    });
  };

  const clearPendingQuote = () => setPendingQuote(null);

  /**
   * Note chrome: AI-derive a topic, then search images plus video/podcast
   * (video+podcast combined ≤3; images keep their own count).
   */
  const searchNoteWithMedia = async (noteNodeId: string) => {
    if (noteSearchGuardRef.current || isAnyAiBusy) return;

    const note = dynamicNodes.find((n) => n.id === noteNodeId);
    if (!note || (note.type !== 'note' && note.type !== 'text')) return;

    const key = (aiConfig.metasoApiKey || '').trim();
    if (!key) {
      void appAlert({ message: t('nodes.search_no_metaso_key') });
      return;
    }

    const noteText = (note.content ?? '').trim();
    if (!noteText) {
      void appAlert({ message: t('nodes.search_need_note_text') });
      return;
    }

    noteSearchGuardRef.current = true;
    setSearchingNoteNodeId(noteNodeId);
    try {
      const queries = await deriveNoteSearchQueries(noteText, aiConfig, t);
      const imageQuery = queries?.imageQuery || queries?.webQuery || '';
      const mediaQuery = queries?.webQuery || queries?.imageQuery || imageQuery;
      if (!imageQuery && !mediaQuery) {
        void appAlert({ message: t('nodes.search_need_note_text') });
        return;
      }

      const [imgRes, videoRes, podcastRes] = await Promise.all([
        metasoSearch(imageQuery || mediaQuery, { apiKey: key, scope: 'image', size: 6 }),
        metasoSearch(mediaQuery || imageQuery, { apiKey: key, scope: 'video', size: 3 }),
        metasoSearch(mediaQuery || imageQuery, { apiKey: key, scope: 'podcast', size: 3 }),
      ]);

      const images = (imgRes.images ?? []).filter((img) => resolveMetasoImageUrl(img));
      const avHits = pickNoteSearchAvHits(videoRes.videos ?? [], podcastRes.podcasts ?? []);
      if (images.length === 0 && avHits.length === 0) {
        void appAlert({ message: t('nodes.search_no_media') });
        return;
      }

      const el = nodesRef.current[noteNodeId];
      const noteH = note.height && note.height > 0 ? note.height : el?.offsetHeight ?? 200;
      const base = { x: note.x, y: note.y };
      const videos = avHits.filter((h) => h.kind === 'video').map((h) => h.item);
      const podcasts = avHits.filter((h) => h.kind === 'podcast').map((h) => h.item);

      // Link media cards directly from the note (no intermediate AI ack card).
      if (images.length > 0) {
        await spawnWebSearchCardsFromImages(noteNodeId, base, images, activeCanvasId, {
          anchorHeight: noteH,
          laneCount: images.length,
          staggerMs: 160,
        });
      }
      if (videos.length > 0) {
        await spawnWebSearchCardsFromMedia(noteNodeId, base, videos, activeCanvasId, 'video', {
          anchorHeight: noteH,
          indexOffset: 0,
          laneCount: avHits.length,
          staggerMs: 160,
        });
      }
      if (podcasts.length > 0) {
        await spawnWebSearchCardsFromMedia(noteNodeId, base, podcasts, activeCanvasId, 'podcast', {
          anchorHeight: noteH,
          indexOffset: videos.length,
          laneCount: avHits.length,
          staggerMs: 160,
        });
      }
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] searchNoteWithMedia failed', { error: msg });
      void appAlert({ message: `${t('nodes.search_failed')}\n\n${msg}` });
    } finally {
      noteSearchGuardRef.current = false;
      setSearchingNoteNodeId(null);
    }
  };

  /** Turn a book selection into a plain text note linked to the book (no AI). */
  const extractBookSelectionToCard = async (
    bookNodeId: string,
    quote: string,
    _sourceLabel?: string,
  ) => {
    const passage = quote.replace(/\s+/g, ' ').trim();
    if (!passage) return;

    const bookNode = dynamicNodes.find((n) => n.id === bookNodeId);
    if (!bookNode || bookNode.type !== 'book') return;

    const { x, y } = findOpenCanvasPosition({
      transform: transformRef.current,
      obstacles: dynamicNodes,
      size: DEFAULT_NODE_SIZE,
      preferBeside: bookNode,
    });
    const noteId = crypto.randomUUID();
    await db.transaction('rw', db.nodes, db.edges, async () => {
      await db.nodes.add({
        id: noteId,
        canvasId: activeCanvasId,
        type: 'text',
        content: passage,
        x,
        y,
      });
      await db.edges.add({
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        from: bookNodeId,
        to: noteId,
      });
    });
  };

  const expandBookSelection = async (
    bookNodeId: string,
    quote: string,
    sourceLabel?: string,
  ) => {
    const passage = quote.replace(/\s+/g, ' ').trim();
    if (!passage || expandGuardRef.current || isAnyAiBusy) return;

    const bookNode = dynamicNodes.find((n) => n.id === bookNodeId);
    if (!bookNode || bookNode.type !== 'book') return;

    expandGuardRef.current = true;
    setExpandingBookNodeId(bookNodeId);
    try {
      const text = await callUniversalAI({
        config: aiConfig,
        systemInstruction: combineSystemParts(
          t('ai.prompts.bookExpandSystem'),
          getLocaleDirective(),
        ),
        prompt: t('ai.prompts.bookExpandUser', {
          source: sourceLabel?.trim() || bookNode.description || '',
          passage,
        }),
      });
      const plan = parseBookExpandPlan(text ?? '');
      if (!plan) {
        void appAlert({ message: t('nodes.book_expand_parse_failed') });
        return;
      }
      await spawnBookExpandCards({
        bookNodeId,
        canvasId: activeCanvasId,
        bookPos: {
          x: bookNode.x,
          y: bookNode.y,
          width: bookNode.width,
          height: bookNode.height,
        },
        plan,
      });
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] expandBookSelection failed', {
        error: msg,
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiKey: maskApiKeyForLog(aiConfig.apiKey),
      });
      void appAlert({
        message: formatAiFailureAlertMessage(msg, aiConfig.provider),
      });
    } finally {
      expandGuardRef.current = false;
      setExpandingBookNodeId(null);
    }
  };

  const runToolbarAiGeneration = async (request: string) => {
    const preferBeside = pendingQuote?.sourceNodeId
      ? dynamicNodes.find((n) => n.id === pendingQuote.sourceNodeId) ?? null
      : null;
    const { x, y } = findOpenCanvasPosition({
      transform: transformRef.current,
      obstacles: dynamicNodes,
      size: NEW_AI_NODE_SIZE,
      preferBeside,
    });
    const newNodeId = crypto.randomUUID();
    await db.nodes.add({
      id: newNodeId,
      canvasId: activeCanvasId,
      type: 'ai',
      content: '',
      userTurn: request,
      x,
      y,
    });

    // Link the reply card back to its book (or other source) when Ask AI was used on a selection.
    const linkFromId = pendingQuote?.sourceNodeId;
    if (linkFromId && dynamicNodes.some((n) => n.id === linkFromId)) {
      await db.edges.add({
        id: crypto.randomUUID(),
        canvasId: activeCanvasId,
        from: linkFromId,
        to: newNodeId,
      });
    }

    setStreamingAiNodeId(newNodeId);

    try {
      const fragmentLabel = t('ai.prompts.context_fragment_label');
      let contextText = '';

      if (pendingQuote?.text) {
        const src = pendingQuote.sourceLabel
          ? t('ai.prompts.quote_source_label', { source: pendingQuote.sourceLabel })
          : '';
        contextText = fragmentLabel + src + pendingQuote.text;
      } else if (selectedNodes.size > 0) {
        for (const id of Array.from(selectedNodes)) {
          const el = nodesRef.current[id];
          if (el) {
            contextText += fragmentLabel + getCanvasNodeContextText(el);
          }
        }
      }

      if (!contextText) {
        const text = await runCanvasStreamingAiCall({
          nodeId: newNodeId,
          callAi: (onStreamChunk) =>
            callUniversalAI({
              config: aiConfig,
              systemInstruction: combineSystemParts(
                t('ai.prompts.toolbarBarePersona'),
                getLocaleDirective(),
              ),
              prompt: request,
              onStreamChunk,
            }),
        });
        if (text) {
          setAiPrompt('');
          setPendingQuote(null);
        }
        return;
      }

      const text = await runCanvasStreamingAiCall({
        nodeId: newNodeId,
        callAi: (onStreamChunk) =>
          callUniversalAI({
            config: aiConfig,
            systemInstruction: combineSystemParts(
              t('ai.prompts.toolbarWithNotesSystem'),
              getLocaleDirective(),
            ),
            prompt: t('ai.prompts.toolbarWithNotesUser', { context: contextText, request }),
            onStreamChunk,
          }),
      });
      if (text) {
        setAiPrompt('');
        setPendingQuote(null);
      }
    } finally {
      setStreamingAiNodeId(null);
    }
  };

  const handleAiSubmit = async () => {
    const raw = aiPrompt.trim();
    if (
      !raw ||
      isPublishing ||
      isToolbarAiLoading ||
      analyzingAgentNodeId !== null ||
      followUpParentId !== null ||
      streamingAiNodeId !== null
    ) {
      return;
    }

    setIsToolbarAiLoading(true);
    try {
      await runToolbarAiGeneration(raw);
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Spoor] handleAiSubmit failed', { error: msg, provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
      void appAlert({
        message: formatAiFailureAlertMessage(msg, aiConfig.provider),
      });
    } finally {
      setIsToolbarAiLoading(false);
    }
  };

  const submitAiThreadFollowUp = async (parentNodeId: string, userMessage: string) => {
    const trimmed = userMessage.trim();
    if (!trimmed || followUpGuardRef.current) return;
    if (isPublishing || isToolbarAiLoading || analyzingAgentNodeId !== null || followUpParentId !== null || streamingAiNodeId !== null) return;

    const parent = dynamicNodes.find((n) => n.id === parentNodeId);
    if (!parent || parent.type !== 'ai') return;

    const previous = (parent.content ?? '').trim();
    const searchIntent = parseThreadWebSearchIntent(trimmed);

    if (searchIntent) {
      const key = (aiConfig.metasoApiKey || '').trim();
      if (!key) {
        void appAlert({ message: t('nodes.search_no_metaso_key') });
        return;
      }

      followUpGuardRef.current = true;
      setFollowUpParentId(parentNodeId);
      try {
        const kind: WebSearchKind = searchIntent.kind;
        let query = searchIntent.explicitQuery.trim();
        if (!query) {
          const derived = await deriveNoteSearchQueries(previous, aiConfig, t);
          query =
            kind === 'image'
              ? derived?.imageQuery || derived?.webQuery || ''
              : derived?.webQuery || derived?.imageQuery || '';
        }
        if (!query) {
          void appAlert({ message: t('nodes.search_need_text') });
          return;
        }

        const res = await metasoSearch(query, { apiKey: key, scope: kind });
        const pages = res.webpages ?? [];
        const images = res.images ?? [];
        const videos = res.videos ?? [];
        const podcasts = res.podcasts ?? [];
        const hitCount =
          kind === 'image'
            ? images.length
            : kind === 'video'
              ? videos.length
              : kind === 'podcast'
                ? podcasts.length
                : pages.length;
        if (hitCount === 0) {
          void appAlert({
            message:
              kind === 'image'
                ? t('nodes.search_no_images')
                : kind === 'video'
                  ? t('nodes.search_no_videos')
                  : kind === 'podcast'
                    ? t('nodes.search_no_podcasts')
                    : t('nodes.search_no_results'),
          });
          return;
        }

        const el = nodesRef.current[parentNodeId];
        const h = el?.offsetHeight ?? 200;
        const w = parent.width && parent.width > 0 ? parent.width : el?.offsetWidth ?? 320;
        const childY = parent.y + h + THREAD_GAP;
        const newNodeId = crypto.randomUUID();
        const ack =
          kind === 'image'
            ? t('nodes.search_image_follow_up_ack')
            : kind === 'video'
              ? t('nodes.search_video_follow_up_ack')
              : kind === 'podcast'
                ? t('nodes.search_podcast_follow_up_ack')
                : t('nodes.search_follow_up_ack');

        await db.nodes.add({
          id: newNodeId,
          canvasId: activeCanvasId,
          type: 'ai',
          userTurn: trimmed,
          content: ack,
          x: parent.x,
          y: childY,
          width: w,
          ...(parent.threadRootContextNodeId != null && parent.threadAgentConfigId != null
            ? {
                threadRootContextNodeId: parent.threadRootContextNodeId,
                threadAgentConfigId: parent.threadAgentConfigId,
                ...(parent.threadContextImageNodeIds != null
                  ? { threadContextImageNodeIds: parent.threadContextImageNodeIds }
                  : {}),
              }
            : {}),
        });
        await db.edges.add({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          from: parentNodeId,
          to: newNodeId,
        });
        const spawnBase = { x: parent.x, y: childY };
        if (kind === 'image') {
          await spawnWebSearchCardsFromImages(newNodeId, spawnBase, images, activeCanvasId, {
            anchorHeight: h,
          });
        } else if (kind === 'video') {
          await spawnWebSearchCardsFromMedia(newNodeId, spawnBase, videos, activeCanvasId, 'video', {
            anchorHeight: h,
          });
        } else if (kind === 'podcast') {
          await spawnWebSearchCardsFromMedia(newNodeId, spawnBase, podcasts, activeCanvasId, 'podcast', {
            anchorHeight: h,
          });
        } else {
          await spawnWebSearchCardsFromPages(newNodeId, spawnBase, pages, activeCanvasId, {
            // Center the source lane on the new answer card; fall back to measured parent height
            // when the fresh node has not laid out yet.
            anchorHeight: h,
          });
        }
        await db.nodes.update(parentNodeId, { followUpSent: true });
      } catch (e) {
        const msg = formatAiError(e);
        console.error('[Spoor] thread web search failed', {
          error: msg,
        });
        void appAlert({ message: `${t('nodes.search_failed')}\n\n${msg}` });
      } finally {
        followUpGuardRef.current = false;
        setFollowUpParentId(null);
      }
      return;
    }

    followUpGuardRef.current = true;
    setFollowUpParentId(parentNodeId);
    let followUpEdgeId: string | null = null;
    try {
      const agentConfig =
        parent.threadAgentConfigId != null
          ? agentConfigs.find((a) => a.id === parent.threadAgentConfigId)
          : undefined;
      const chain = collectAiThreadChain(dynamicNodes, edges, parentNodeId);
      const rootMatchesThread =
        chain[0]?.threadAgentConfigId != null &&
        chain[0].threadAgentConfigId === parent.threadAgentConfigId;
      const useAgentThread =
        agentConfig != null && parent.threadAgentConfigId != null && rootMatchesThread;

      const threadImageIds =
      parent.threadContextImageNodeIds ?? chain[0]?.threadContextImageNodeIds;
      const threadImageDataUrls = resolveImageDataUrlsFromNodeIds(
        threadImageIds,
        dynamicNodes,
      );

      const el = nodesRef.current[parentNodeId];
      const h = el?.offsetHeight ?? 200;
      const w = parent.width && parent.width > 0 ? parent.width : el?.offsetWidth ?? 320;
      const newNodeId = crypto.randomUUID();
      const edgeId = crypto.randomUUID();
      followUpEdgeId = edgeId;
      const threadMeta =
        parent.threadRootContextNodeId != null && parent.threadAgentConfigId != null
          ? {
              threadRootContextNodeId: parent.threadRootContextNodeId,
              threadAgentConfigId: parent.threadAgentConfigId,
              ...(parent.threadContextImageNodeIds != null
                ? { threadContextImageNodeIds: parent.threadContextImageNodeIds }
                : {}),
            }
          : {};

      await db.nodes.add({
        id: newNodeId,
        canvasId: activeCanvasId,
        type: 'ai',
        userTurn: trimmed,
        content: '',
        x: parent.x,
        y: parent.y + h + THREAD_GAP,
        width: w,
        ...threadMeta,
      });
      await db.edges.add({
        id: edgeId,
        canvasId: activeCanvasId,
        from: parentNodeId,
        to: newNodeId,
      });
      setStreamingAiNodeId(newNodeId);

      const text = useAgentThread
        ? await runCanvasStreamingAiCall({
            nodeId: newNodeId,
            callAi: (onStreamChunk) =>
              callUniversalAI({
                config: aiConfig,
                systemInstruction: buildAgentSystemInstruction(agentConfig!, {
                  fallbackPrompt: t('agents.studio.fallback_assistant'),
                }),
                prompt: t('ai.prompts.agentThreadFollowUp', {
                  initialContext: (() => {
                    const ctxId = parent.threadRootContextNodeId ?? chain[0]?.threadRootContextNodeId;
                    let initialContext = t('ai.prompts.agentThreadContextMissing');
                    if (ctxId) {
                      const ctxEl = nodesRef.current[ctxId];
                      if (ctxEl) {
                        const raw = getCanvasNodeContextText(ctxEl).trim();
                        if (raw) initialContext = raw;
                      }
                    }
                    return initialContext;
                  })(),
                  dialogueHistory: formatAgentThreadDialogueHistory(chain),
                  request: trimmed,
                }),
                temperature: agentConfig!.temperature ?? 0.7,
                topP: agentConfig!.creativity ?? 0.4,
                images: threadImageDataUrls.length > 0 ? threadImageDataUrls : undefined,
                onStreamChunk,
              }),
          })
        : await runCanvasStreamingAiCall({
            nodeId: newNodeId,
            callAi: (onStreamChunk) =>
              callUniversalAI({
                config: aiConfig,
                systemInstruction: getLocaleDirective(),
                prompt: t('ai.prompts.threadFollowUp', {
                  previous: previous || '—',
                  request: trimmed,
                }),
                onStreamChunk,
              }),
          });

      if (text) {
        await db.nodes.update(parentNodeId, { followUpSent: true });
      } else {
        await db.edges.delete(edgeId);
      }
    } catch (e) {
      if (followUpEdgeId) {
        try {
          await db.edges.delete(followUpEdgeId);
        } catch {
          /* edge may already be removed */
        }
      }
      const msg = formatAiError(e);
      console.error('[Spoor] submitAiThreadFollowUp failed', {
        error: msg,
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiKey: maskApiKeyForLog(aiConfig.apiKey),
      });
      void appAlert({
        message: formatAiFailureAlertMessage(msg, aiConfig.provider),
      });
    } finally {
      followUpGuardRef.current = false;
      setFollowUpParentId(null);
      setStreamingAiNodeId(null);
    }
  };

  return {
    isPublishing,
    isToolbarAiLoading,
    analyzingAgentNodeId,
    followUpParentId,
    streamingAiNodeId,
    setStreamingAiNodeId,
    isAnyAiBusy,
    aiPrompt,
    setAiPrompt,
    pendingQuote,
    askAboutSelection,
    clearPendingQuote,
    extractBookSelectionToCard,
    expandBookSelection,
    expandingBookNodeId,
    searchNoteWithMedia,
    searchingNoteNodeId,
    handlePublish,
    triggerAgentAnalysis,
    handleAiSubmit,
    submitAiThreadFollowUp,
  };
}
