import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentConfig, CanvasNode, Edge as DbEdge } from '../db';
import type { AIConfig } from '../components/AISettingsModal';
import type { CanvasTransform } from './useCanvasInteraction';
import { callUniversalAI, formatAiError, maskApiKeyForLog } from '../services/ai';
import { metasoSearch } from '../services/search';
import { deriveSearchQueryFromNoteText, spawnWebSearchCardsFromPages } from '../services/spawnWebSearchNoteCards';
import { parseThreadWebSearchIntent } from '../utils/webSearchCommand';
import { shouldPreflightToolbarIntent } from '../utils/toolbarIntentGate';
import { analyzeToolbarIntentPreflight } from '../services/toolbarIntentClarification';
import { getCanvasCenterPosition } from '../utils/canvas';
import { buildAgentSystemInstruction, combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { collectAiThreadChain, formatAgentThreadDialogueHistory } from '../utils/agentThreadContext';
import {
  collectAgentContextImagePayload,
  resolveImageDataUrlsFromNodeIds,
} from '../utils/canvasContextImages';
import { getCanvasNodeContextText } from '../utils/canvasNodeContextText';
import { parsePublishArticleResponse } from '../utils/parsePublishArticleResponse';
import { db } from '../db';
import { useAppDialog } from '../components/AppDialogProvider';
import { runCanvasStreamingAiCall } from '../utils/canvasStreamingAi';

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
  const [intentClarification, setIntentClarification] = useState<{
    original: string;
    options: [string, string, string];
    hint?: string;
  } | null>(null);
  const [isToolbarIntentPreflight, setIsToolbarIntentPreflight] = useState(false);
  const followUpGuardRef = useRef(false);

  const THREAD_GAP = 24;

  // streamingAiNodeId is intentionally included: voice-writing mode and follow-up threads both
  // mutate it without holding isToolbarAiLoading, so omitting it would let the toolbar launch a
  // second concurrent AI run that races on the same flag.
  const isAnyAiBusy =
    isPublishing ||
    isToolbarAiLoading ||
    isToolbarIntentPreflight ||
    analyzingAgentNodeId !== null ||
    followUpParentId !== null ||
    streamingAiNodeId !== null ||
    intentClarification !== null;

  const handlePublish = async () => {
    if (selectedNodes.size === 0 || isAnyAiBusy) return;
    setIsPublishing(true);
    try {
      let combinedText = '';
      for (const id of Array.from(selectedNodes)) {
        const el = nodesRef.current[id];
        if (el) {
          combinedText += getCanvasNodeContextText(el) + '\n\n';
        }
      }

      const text = await callUniversalAI({
        config: aiConfig,
        systemInstruction: getLocaleDirective(),
        prompt: t('ai.prompts.publish', { content: combinedText }),
      });

      const { title, body } = parsePublishArticleResponse(text || '', t('ai.generated_article_title'));

      const newArticle = {
        id: `gen-${Date.now()}`,
        title,
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

  const runToolbarAiGeneration = async (request: string) => {
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    const newNodeId = crypto.randomUUID();
    await db.nodes.add({
      id: newNodeId,
      canvasId: activeCanvasId,
      type: 'ai',
      content: '',
      x,
      y,
    });
    setStreamingAiNodeId(newNodeId);

    try {
      if (selectedNodes.size === 0) {
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
        if (text) setAiPrompt('');
        return;
      }

      let contextText = '';
      const fragmentLabel = t('ai.prompts.context_fragment_label');
      for (const id of Array.from(selectedNodes)) {
        const el = nodesRef.current[id];
        if (el) {
          contextText += fragmentLabel + getCanvasNodeContextText(el);
        }
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
      if (text) setAiPrompt('');
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
      isToolbarIntentPreflight ||
      analyzingAgentNodeId !== null ||
      followUpParentId !== null ||
      streamingAiNodeId !== null ||
      intentClarification !== null
    ) {
      return;
    }

    const runWithLoading = async (request: string) => {
      setIsToolbarAiLoading(true);
      try {
        await runToolbarAiGeneration(request);
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

    if (!shouldPreflightToolbarIntent(raw)) {
      await runWithLoading(raw);
      return;
    }

    setIsToolbarIntentPreflight(true);
    let proceedWithOriginal = false;
    try {
      const analysis = await analyzeToolbarIntentPreflight(raw, aiConfig, t);
      if (analysis.ambiguous) {
        setIntentClarification({
          original: raw,
          options: analysis.options,
          hint: analysis.hint,
        });
      } else {
        proceedWithOriginal = true;
      }
    } catch (e) {
      const msg = formatAiError(e);
      console.error('[Spoor] toolbar intent preflight failed', msg);
      proceedWithOriginal = true;
    } finally {
      setIsToolbarIntentPreflight(false);
    }

    if (proceedWithOriginal) {
      await runWithLoading(raw);
    }
  };

  const cancelIntentClarification = () => setIntentClarification(null);

  const confirmIntentClarification = async (finalRequest: string) => {
    if (!intentClarification) return;
    setIntentClarification(null);
    setIsToolbarAiLoading(true);
    try {
      await runToolbarAiGeneration(finalRequest);
    } catch (error) {
      const msg = formatAiError(error);
      console.error('[Spoor] handleAiSubmit after intent clarify failed', { error: msg, provider: aiConfig.provider, model: aiConfig.model, apiKey: maskApiKeyForLog(aiConfig.apiKey) });
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

      const query =
        searchIntent.explicitQuery ||
        deriveSearchQueryFromNoteText(previous.replace(/#{1,6}\s+/g, ''));
      if (!query) {
        void appAlert({ message: t('nodes.search_need_text') });
        return;
      }

      followUpGuardRef.current = true;
      setFollowUpParentId(parentNodeId);
      try {
        const res = await metasoSearch(query, { apiKey: key });
        const pages = res.webpages ?? [];
        if (pages.length === 0) {
          void appAlert({ message: t('nodes.search_no_results') });
          return;
        }

        const el = nodesRef.current[parentNodeId];
        const h = el?.offsetHeight ?? 200;
        const w = parent.width && parent.width > 0 ? parent.width : el?.offsetWidth ?? 320;
        const childY = parent.y + h + THREAD_GAP;
        const newNodeId = crypto.randomUUID();

        await db.nodes.add({
          id: newNodeId,
          canvasId: activeCanvasId,
          type: 'ai',
          userTurn: trimmed,
          content: t('nodes.search_follow_up_ack'),
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
        await spawnWebSearchCardsFromPages(newNodeId, { x: parent.x, y: childY }, pages, activeCanvasId, {
          // Center the source lane on the new answer card; fall back to measured parent height
          // when the fresh node has not laid out yet.
          anchorHeight: h,
        });
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
    handlePublish,
    triggerAgentAnalysis,
    handleAiSubmit,
    submitAiThreadFollowUp,
    intentClarification,
    isToolbarIntentPreflight,
    cancelIntentClarification,
    confirmIntentClarification,
  };
}
