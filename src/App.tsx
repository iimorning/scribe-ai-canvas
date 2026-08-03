import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db, type CanvasNode } from './db';
import {
  Maximize2,
  Minimize2,
  Loader2,
  PenLine,
} from 'lucide-react';
import { commitCanvasInlineEditing } from './utils/commitCanvasInlineEditing';
import { registerCanvasUnloadFlush } from './utils/registerCanvasUnloadFlush';
import { getCanvasNodeContextText } from './utils/canvasNodeContextText';
import { nodeSupportsCycleLayout } from './constants/nodeCapabilities';
import { NOTE_LAYOUT_COUNT } from './constants/noteLayouts';
import { CanvasEdgeLines } from './components/canvas/CanvasEdgeLines';
import { DraggableNode } from './components/canvas/DraggableNode';
import { AISettingsModal } from './components/AISettingsModal';
import { PublishOutlineDialog } from './components/PublishOutlineDialog';
import { Sidebar } from './components/Sidebar';
import { CanvasHistoryPopover } from './components/CanvasHistoryPopover';
import { CanvasNoteSearch } from './components/CanvasNoteSearch';
import { CanvasToolbar } from './components/CanvasToolbar';
import { transformToFocusNode } from './utils/voiceNoteLayout';
import type { AIConfig } from './components/AISettingsModal';
import { Reference } from './components/Reference';
import { ResearchLab } from './components/ResearchLab';
import { AgentsStudio } from './components/AgentsStudio';
import { callUniversalAI } from './services/ai';
import { MIMO_TOKEN_PLAN_BASE_URL } from './constants/mimo';
import { DOUBAO_ARK_BASE_URL, DOUBAO_DEFAULT_MODEL } from './constants/doubao';
import { NodeRenderer } from './components/nodes/NodeRenderer';
import { useSeedData } from './hooks/useSeedData';
import { useUserProfile } from './hooks/useUserProfile';
import { useFullscreen } from './hooks/useFullscreen';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useNodeActions } from './hooks/useNodeActions';
import { useAiActions } from './hooks/useAiActions';
import { useVoiceWritingMode } from './hooks/useVoiceWritingMode';
import { useAppDialog } from './components/AppDialogProvider';
import { processFileToNode } from './utils/file';
import { dataTransferHasFiles, preventDefaultIfFileDrag } from './utils/dnd';
import {
  buildCanvasClipboardPayload,
  isTextEditingTarget,
  materializeCanvasPaste,
  parseCanvasClipboardPayload,
  snapshotNodesAndTouchingEdges,
} from './utils/canvasClipboard';
import { shouldDeferToNativeClipboard } from './utils/noteClipboard';
import { applyCanvasUndo, createCanvasUndoStack } from './utils/canvasUndoStack';
import {
  listWebSearchSourcesForParent,
  setWebSearchSourcesCollapsed,
  sourceImageScatterTiltDeg,
  sourceStackTiltDeg,
  sourceStackZIndex,
  webSearchSourceIndex,
} from './services/spawnWebSearchNoteCards';
import {
  bookExpandBranchIndex,
  bookExpandStackZIndex,
  resolveBookExpandBranches,
  setBookExpandBranchesCollapsed,
} from './services/spawnBookExpandCards';
/** 控制台执行 localStorage.setItem('SCRIBE_DEBUG_DND','1') 并刷新；桌面打包版也可用（不设 DEV 门槛）。 */
const DEBUG_DND =
  typeof localStorage !== 'undefined' &&
  localStorage.getItem('SCRIBE_DEBUG_DND') === '1';

/** tp- Token 套餐密钥须走 token-plan-cn；旧版默认 api.xiaomimimo.com 会导致 401 */
function migrateStoredAiConfig(raw: unknown): AIConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  let p = raw as AIConfig;
  if (p.provider === 'mimo') {
    const b = (p.baseUrl ?? '').trim();
    if (!b || /api\.xiaomimimo\.com/i.test(b)) {
      p = { ...p, baseUrl: MIMO_TOKEN_PLAN_BASE_URL };
    }
    const keyEmpty = !(p.apiKey ?? '').trim();
    const defaultMimoModel = !p.model?.trim() || p.model === 'mimo-v2.5-pro';
    if (keyEmpty && defaultMimoModel) {
      return {
        ...p,
        provider: 'doubao',
        apiKey: '',
        baseUrl: DOUBAO_ARK_BASE_URL,
        model: DOUBAO_DEFAULT_MODEL,
      };
    }
    return p;
  }
  if (p.provider === 'doubao') {
    const b = (p.baseUrl ?? '').trim();
    const legacyModel =
      p.model === 'doubao-seed-2-0-lite-260428' || !p.model?.trim();
    if (!b || legacyModel) {
      return {
        ...p,
        baseUrl: b || DOUBAO_ARK_BASE_URL,
        ...(legacyModel ? { model: DOUBAO_DEFAULT_MODEL } : {}),
      };
    }
  }
  return p;
}
export default function App() {
  const { t, i18n } = useTranslation();
  const { alert: appAlert } = useAppDialog();
  const nodesRef = useRef<Record<string, HTMLElement | null>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const edgeLabelsRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);

  // Local-only UI states
  const [activeCanvasId, setActiveCanvasId] = useState<string>(() => localStorage.getItem('active_canvas_id') || 'default');

  // Database-backed states
  const articles = useLiveQuery(() => db.articles.toArray()) || [];
  const agentConfigs = useLiveQuery(() => db.agents.toArray()) || [];
  const dynamicNodes = useLiveQuery(() => 
    db.nodes.filter(node => (node.canvasId === activeCanvasId) || (!node.canvasId && activeCanvasId === 'default')).toArray()
  , [activeCanvasId]) || [];
  const edges = useLiveQuery(() => 
    db.edges.filter(edge => (edge.canvasId === activeCanvasId) || (!edge.canvasId && activeCanvasId === 'default')).toArray()
  , [activeCanvasId]) || [];
  const canvases = useLiveQuery(() => db.canvases.toArray()) || [];

  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  /** Live offset applied to non-primary cards while a multi-select group is dragged. */
  const [groupDragOffset, setGroupDragOffset] = useState<{
    peerIds: string[];
    dx: number;
    dy: number;
  } | null>(null);
  const selectedNodesRef = useRef(selectedNodes);
  selectedNodesRef.current = selectedNodes;
  const dynamicNodesRef = useRef(dynamicNodes);
  dynamicNodesRef.current = dynamicNodes;
  const [activeReferenceId, setActiveReferenceId] = useState<string>('');
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('personal');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // User Profile
  const { userName, setUserName, userRole, setUserRole, userAvatar, setUserAvatar } = useUserProfile();

  // Fullscreen
  const { isFullscreen, toggleFullscreen, enterFullscreen, exitFullscreen } = useFullscreen(mainRef);

  // Canvas interaction (transform, pan, zoom, edge lines)
  const { canvasTransform, setCanvasTransform, transformRef, handlePanStart } = useCanvasInteraction(
    mainRef,
    contentContainerRef,
    svgRef,
    edgeLabelsRef,
    nodesRef,
    connectingFrom,
    setConnectingFrom,
    activeCanvasId,
    activeTab === 'personal',
  );

  const focusCanvasRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const scale = transformRef.current.scale || 1;
      setCanvasTransform(
        transformToFocusNode(rect.x, rect.y, scale, rect.width, rect.height),
      );
    },
    [setCanvasTransform, transformRef],
  );

  const handleCanvasPanPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const nodeRow = editingNodeId ? dynamicNodes.find((n) => n.id === editingNodeId) : undefined;
      commitCanvasInlineEditing({
        editingNodeId,
        nodesRef,
        nodeType: nodeRow?.type,
      });
      if (e.button === 1) {
        handlePanStart(e);
        return;
      }
      if (e.button !== 0) return;

      if (connectingFrom) setConnectingFrom(null);
      e.preventDefault();
      const main = mainRef.current;
      if (!main) return;
      const bounds = main.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const additive = e.shiftKey;
      let dragged = false;

      const rectFrom = (clientX: number, clientY: number) => ({
        x: Math.min(startX, clientX) - bounds.left,
        y: Math.min(startY, clientY) - bounds.top,
        width: Math.abs(clientX - startX),
        height: Math.abs(clientY - startY),
      });
      const onPointerMove = (moveEvent: PointerEvent) => {
        const rect = rectFrom(moveEvent.clientX, moveEvent.clientY);
        if (rect.width > 4 || rect.height > 4) dragged = true;
        setMarqueeRect(rect);
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        const rect = rectFrom(upEvent.clientX, upEvent.clientY);
        setMarqueeRect(null);
        if (!dragged) {
          setSelectedNodes(new Set());
          return;
        }
        const left = bounds.left + rect.x;
        const top = bounds.top + rect.y;
        const right = left + rect.width;
        const bottom = top + rect.height;
        const ids = Object.entries(nodesRef.current)
          .filter(([, element]) => {
            if (!element) return false;
            const nodeRect = element.getBoundingClientRect();
            return nodeRect.right >= left && nodeRect.left <= right && nodeRect.bottom >= top && nodeRect.top <= bottom;
          })
          .map(([id]) => id);
        setSelectedNodes((previous) => additive ? new Set([...previous, ...ids]) : new Set(ids));
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [connectingFrom, dynamicNodes, editingNodeId, handlePanStart],
  );

  const handleCanvasPointerCapture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    handleCanvasPanPointerDown(e as React.PointerEvent<HTMLDivElement>);
  }, [handleCanvasPanPointerDown]);

  const [aiConfig, setAiConfig] = useState(() => {
    const saved = localStorage.getItem('ai_config');
    const parsed = saved ? migrateStoredAiConfig(JSON.parse(saved)) : null;
    if (!parsed || (parsed.provider === 'gemini' && !parsed.apiKey?.trim())) {
      return {
        provider: 'doubao',
        apiKey: '',
        baseUrl: DOUBAO_ARK_BASE_URL,
        model: DOUBAO_DEFAULT_MODEL,
      };
    }
    return parsed;
  });

  useEffect(() => {
    localStorage.setItem('ai_config', JSON.stringify(aiConfig));
  }, [aiConfig]);

  useEffect(() => {
    localStorage.setItem('active_canvas_id', activeCanvasId);
  }, [activeCanvasId]);

  useEffect(() => {
    if (articles.length === 0) {
      if (activeReferenceId !== '') setActiveReferenceId('');
      return;
    }
    if (!articles.some((a) => a.id === activeReferenceId)) {
      setActiveReferenceId(articles[0].id);
    }
  }, [articles, activeReferenceId, setActiveReferenceId]);

  useSeedData();

  useEffect(() => registerCanvasUnloadFlush(), []);

  const lastStickyClickIdRef = useRef<string | null>(null);
  const canvasUndoStackRef = useRef(createCanvasUndoStack());
  useEffect(() => {
    lastStickyClickIdRef.current = null;
    canvasUndoStackRef.current.clear();
  }, [activeCanvasId, activeTab]);

  /**
   * 捕获阶段放行文件拖放：子元素（连线粗命中区、video/img 等）若未调用 dragover.preventDefault，
   * 浏览器会禁止放置；在 main 上捕获可先放行整张画布。
   * Manual QA：Chrome vs Tauri；空白区 vs 连线附近 vs 节点上；参见 localStorage SCRIBE_DEBUG_DND='1'。
   */
  useLayoutEffect(() => {
    if (activeTab !== 'personal') return;
    const el = mainRef.current;
    if (!el) return;

    const handleCaptureDragEnter = (e: DragEvent) => {
      preventDefaultIfFileDrag(e);
      if (!DEBUG_DND || !dataTransferHasFiles(e.dataTransfer)) return;
      const t = e.target;
      const tag = t instanceof Element ? t.tagName : String(t);
      console.debug('[dnd:dragenter]', {
        tag,
        types: e.dataTransfer ? Array.from(e.dataTransfer.types) : [],
      });
    };

    const handleCaptureDragOver = (e: DragEvent) => {
      preventDefaultIfFileDrag(e);
    };

    el.addEventListener('dragenter', handleCaptureDragEnter, true);
    el.addEventListener('dragover', handleCaptureDragOver, true);
    return () => {
      el.removeEventListener('dragenter', handleCaptureDragEnter, true);
      el.removeEventListener('dragover', handleCaptureDragOver, true);
    };
  }, [activeTab]);

  // Node actions (CRUD, selection, linking)
  const { toggleNodeSelection, handleLink, deleteEdge, removeNodeId, removeNodeIds, addTextNode, addThemeNode, addFileNode } = useNodeActions({
    activeCanvasId, nodesRef, connectingFrom, setConnectingFrom, edges, selectedNodes, setSelectedNodes, transformRef,
  });

  const canvasClipboardRef = useRef({
    dynamicNodes,
    edges,
    activeCanvasId,
    selectedNodes,
    removeNodeIds,
  });
  canvasClipboardRef.current = {
    dynamicNodes,
    edges,
    activeCanvasId,
    selectedNodes,
    removeNodeIds,
  };

  useEffect(() => {
    if (activeTab !== 'personal') return;

    const resolveTargetNodes = () => {
      const { dynamicNodes: nodes, selectedNodes: selected } = canvasClipboardRef.current;
      if (selected.size > 0) {
        return nodes.filter((n) => selected.has(n.id));
      }
      const focusId = lastStickyClickIdRef.current;
      if (!focusId) return [];
      return nodes.filter((n) => n.id === focusId);
    };

    const writeClipboard = (e: ClipboardEvent) => {
      const picked = resolveTargetNodes();
      if (picked.length === 0) return false;
      const payload = buildCanvasClipboardPayload(picked, canvasClipboardRef.current.edges);
      if (!payload) return false;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', JSON.stringify(payload));
      return true;
    };

    const onCopy = (e: ClipboardEvent) => {
      // Book bodies use select-text (not contenteditable); don't steal Ctrl+C for card JSON.
      if (shouldDeferToNativeClipboard(e.target)) return;
      writeClipboard(e);
    };

    const onCut = (e: ClipboardEvent) => {
      if (shouldDeferToNativeClipboard(e.target)) return;
      if (!writeClipboard(e)) return;
      const picked = resolveTargetNodes();
      const ids = picked.map((n) => n.id);
      if (ids.length === 0) return;
      const snap = snapshotNodesAndTouchingEdges(
        ids,
        canvasClipboardRef.current.dynamicNodes,
        canvasClipboardRef.current.edges,
      );
      canvasUndoStackRef.current.push({ type: 'delete', nodes: snap.nodes, edges: snap.edges });
      if (editingNodeId && ids.includes(editingNodeId)) setEditingNodeId(null);
      void canvasClipboardRef.current.removeNodeIds(ids);
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const payload = parseCanvasClipboardPayload(text);
      if (!payload) return;
      e.preventDefault();
      const { activeCanvasId: canvasId } = canvasClipboardRef.current;
      void (async () => {
        const { nodes: rows, edges: newEdges } = materializeCanvasPaste(payload, canvasId);
        if (rows.length === 0) return;
        await db.transaction('rw', db.nodes, db.edges, async () => {
          await db.nodes.bulkAdd(rows);
          if (newEdges.length > 0) await db.edges.bulkAdd(newEdges);
        });
        canvasUndoStackRef.current.push({
          type: 'paste',
          nodeIds: rows.map((n) => n.id),
          edgeIds: newEdges.map((ed) => ed.id),
        });
        setSelectedNodes(new Set(rows.map((n) => n.id)));
      })();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'personal' || isTextEditingTarget(event.target)) return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && (event.key === 'z' || event.key === 'Z') && !event.shiftKey) {
        const entry = canvasUndoStackRef.current.pop();
        if (!entry) return;
        event.preventDefault();
        void applyCanvasUndo(entry).then(() => {
          if (entry.type === 'delete') {
            setSelectedNodes(new Set(entry.nodes.map((n) => n.id)));
          } else {
            setSelectedNodes(new Set());
          }
        });
        return;
      }

      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      const { selectedNodes: selected, dynamicNodes: nodes, edges: canvasEdges } =
        canvasClipboardRef.current;
      if (selected.size === 0) return;
      event.preventDefault();
      const ids = [...selected];
      const snap = snapshotNodesAndTouchingEdges(ids, nodes, canvasEdges);
      canvasUndoStackRef.current.push({ type: 'delete', nodes: snap.nodes, edges: snap.edges });
      if (editingNodeId && ids.includes(editingNodeId)) setEditingNodeId(null);
      void canvasClipboardRef.current.removeNodeIds(ids);
    };

    window.addEventListener('copy', onCopy, true);
    window.addEventListener('cut', onCut, true);
    window.addEventListener('paste', onPaste, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('copy', onCopy, true);
      window.removeEventListener('cut', onCut, true);
      window.removeEventListener('paste', onPaste, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeTab, editingNodeId]);

  // AI actions (publish, agent analysis, AI submit)
  const {
    publishOutlineOpen,
    publishOutlineSelectedIds,
    closePublishOutlineDialog,
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
  } = useAiActions({
    aiConfig, agentConfigs, activeCanvasId, nodesRef, transformRef,
    dynamicNodes, edges, selectedNodes, setSelectedNodes, setActiveReferenceId, setActiveTab,
  });

  const { voiceModeActive, voicePhase, ttsHighlight, toggleVoiceMode, stopVoiceActivity } = useVoiceWritingMode({
    aiConfig,
    activeCanvasId,
    transformRef,
    setCanvasTransform,
    editingNodeId,
    setStreamingAiNodeId,
    enterFullscreen,
    exitFullscreen,
    isAnyAiBusy,
  });

  const webSearchSourceCountByParent = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const node of dynamicNodes) {
      if (node.type !== 'ai' && node.type !== 'note' && node.type !== 'text') continue;
      const count = listWebSearchSourcesForParent(node.id, dynamicNodes, edges).length;
      if (count > 0) map.set(node.id, count);
    }
    return map;
  }, [dynamicNodes, edges]);

  const bookExpandBranchCountByHub = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const node of dynamicNodes) {
      if (node.type !== 'theme') continue;
      const linkedFromBook = edges.some(
        (e) => e.to === node.id && dynamicNodes.find((n) => n.id === e.from)?.type === 'book',
      );
      const isExpandHub =
        node.bookExpandBranchesCollapsed !== undefined ||
        dynamicNodes.some((n) => n.bookExpandParentId === node.id) ||
        linkedFromBook;
      if (!isExpandHub) continue;
      const count = resolveBookExpandBranches(node.id, dynamicNodes, edges).length;
      if (count > 0) map.set(node.id, count);
    }
    return map;
  }, [dynamicNodes, edges]);

  const toggleWebSearchSources = useCallback(
    (parentId: string) => {
      const parent = dynamicNodes.find((n) => n.id === parentId);
      if (!parent) return;
      const el = nodesRef.current[parentId];
      const anchorHeight = parent.height && parent.height > 0
        ? parent.height
        : el?.offsetHeight || undefined;
      void setWebSearchSourcesCollapsed(parentId, !parent.webSearchSourcesCollapsed, {
        nodes: dynamicNodes,
        edges,
        anchorHeight,
      });
    },
    [dynamicNodes, edges, nodesRef],
  );

  const toggleBookExpandBranches = useCallback(
    (hubId: string) => {
      const hub = dynamicNodes.find((n) => n.id === hubId);
      if (!hub || hub.type !== 'theme') return;
      const el = nodesRef.current[hubId];
      const hubHeight =
        hub.height && hub.height > 0 ? hub.height : el?.offsetHeight || undefined;
      void setBookExpandBranchesCollapsed(hubId, !hub.bookExpandBranchesCollapsed, {
        nodes: dynamicNodes,
        edges,
        hubHeight,
      });
    },
    [dynamicNodes, edges, nodesRef],
  );

  const runAgentAnalysisFromCard = (agentNodeId: string) => {
    if (isAnyAiBusy) return;
    const agentNode = dynamicNodes.find(n => n.id === agentNodeId && n.type === 'agent');
    if (!agentNode?.agentConfigId) return;

    const neighborIds: string[] = [];
    for (const edge of edges) {
      if (edge.from === agentNodeId) neighborIds.push(edge.to);
      else if (edge.to === agentNodeId) neighborIds.push(edge.from);
    }
    neighborIds.sort();

    for (const cid of neighborIds) {
      const n = dynamicNodes.find(x => x.id === cid);
      if (!n || n.type === 'agent') continue;
      const el = nodesRef.current[cid];
      if (!el) continue;
      const text = getCanvasNodeContextText(el);
      if (!text) continue;
      void triggerAgentAnalysis(agentNode.agentConfigId, agentNodeId, cid);
      return;
    }

    void appAlert({ message: t('nodes.agent_no_context') });
  };

  const handleNodeDragEnd = (
    draggedId: string,
    finalPos: { x: number; y: number },
    delta: { dx: number; dy: number } = { dx: 0, dy: 0 },
  ) => {
    const selected = selectedNodesRef.current;
    if (selected.size > 1 && selected.has(draggedId)) {
      const nodesSnapshot = dynamicNodesRef.current;
      // Defer clearing the group offset until after the transaction commits —
      // otherwise peers visually snap back to (x,y) (without dx/dy), then jump
      // forward to (x+dx, y+dy) once the DB write lands, producing a 1-frame
      // jank. Recompute each peer's final position up-front so we can release
      // the offset the instant the user releases the mouse.
      const updates: { id: string; x: number; y: number }[] = [];
      for (const id of selected) {
        if (id === draggedId) {
          updates.push({ id, x: finalPos.x, y: finalPos.y });
          continue;
        }
        const peer = nodesSnapshot.find((n) => n.id === id);
        if (!peer) continue;
        updates.push({ id, x: peer.x + delta.dx, y: peer.y + delta.dy });
      }
      setGroupDragOffset(null);
      void (async () => {
        await db.transaction('rw', db.nodes, async () => {
          for (const u of updates) {
            await db.nodes.update(u.id, { x: u.x, y: u.y });
          }
        });
      })();
      return;
    }

    // Update position in database
    db.nodes.update(draggedId, { x: finalPos.x, y: finalPos.y });

    const draggedEl = nodesRef.current[draggedId];
    if (!draggedEl) return;
    
    // Convert to screen coordinates for accurate distance measurement (ignoring scale/pan for now for simplicity, bounding rect includes it)
    const dRect = draggedEl.getBoundingClientRect();
    const dCenterX = dRect.left + dRect.width / 2;
    const dCenterY = dRect.top + dRect.height / 2;

    const SNAP_DISTANCE = 150; // pixels

    const isDraggedAgent = dynamicNodes.find(n => n.id === draggedId)?.type === 'agent';

    let snapped = false;

    Object.keys(nodesRef.current).forEach(otherId => {
      if (otherId === draggedId || snapped) return;
      const otherEl = nodesRef.current[otherId];
      if (!otherEl) return;

      const isOtherAgent = dynamicNodes.find(n => n.id === otherId)?.type === 'agent';

      // One must be agent, other must not be agent ideally (or both are, but whatever)
      if ((isDraggedAgent && !isOtherAgent) || (!isDraggedAgent && isOtherAgent)) {
        const oRect = otherEl.getBoundingClientRect();
        const oCenterX = oRect.left + oRect.width / 2;
        const oCenterY = oRect.top + oRect.height / 2;

        const dist = Math.hypot(dCenterX - oCenterX, dCenterY - oCenterY);
        
        if (dist < SNAP_DISTANCE) {
          const agentId = isDraggedAgent ? draggedId : otherId;
          const contextId = isDraggedAgent ? otherId : draggedId;
          const agentConfigId = dynamicNodes.find(n => n.id === agentId)?.agentConfigId;
          
          if (agentConfigId && agentId && contextId) {
            snapped = true;
            // Optionally add edge to visualize snap (analysis runs only from the agent card button).
            if (!edges.find(e => (e.from === agentId && e.to === contextId) || (e.from === contextId && e.to === agentId))) {
               db.edges.add({ id: crypto.randomUUID(), canvasId: activeCanvasId, from: agentId, to: contextId });
            }
          }
        }
      }
    });
  };

  return (
    <div className="bg-surface font-serif text-text h-screen max-h-screen overflow-hidden flex flex-col paper-texture">
      
      <div className="flex flex-1 min-h-0 overflow-hidden" onPointerDown={() => { if (connectingFrom) setConnectingFrom(null); }}>
        {/* SideNavBar */}
        <Sidebar 
          isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}
          activeTab={activeTab} setActiveTab={setActiveTab}
          userAvatar={userAvatar} setUserAvatar={setUserAvatar}
          userName={userName} setUserName={setUserName}
          userRole={userRole} setUserRole={setUserRole}
          setIsSettingsOpen={setIsSettingsOpen}
        />

        {activeTab === 'personal' && (
        <main 
          ref={mainRef} 
          className="flex-1 min-h-0 relative overflow-hidden bg-surface paper-texture"
          onPointerDownCapture={handleCanvasPointerCapture}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (DEBUG_DND) {
              const t = e.target;
              console.debug('[dnd:drop]', {
                tag: t instanceof Element ? t.tagName : String(t),
                types: Array.from(e.dataTransfer.types),
                filesLength: e.dataTransfer.files?.length ?? 0,
              });
            }
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              const t = canvasTransform;
              const rect = e.currentTarget.getBoundingClientRect();

              const ox = ((e.clientX - rect.left) - t.x) / t.scale;
              const oy = ((e.clientY - rect.top) - t.y) / t.scale;

              for (let index = 0; index < Array.from(e.dataTransfer.files).length; index++) {
                const file = e.dataTransfer.files[index];
                try {
                  const data = await processFileToNode(file);
                  await db.nodes.add({
                    id: crypto.randomUUID(),
                    canvasId: activeCanvasId,
                    ...data,
                    x: ox + (index * 20) - 100,
                    y: oy + (index * 20) - 100
                  });
                } catch (err) {
                  console.error('Failed to process file:', file.name, err);
                }
              }
            }
          }}
        >
          {/* Empty canvas: click clears selection; drag creates a marquee. Middle button pans. */}
          <div 
            className="absolute inset-0 cursor-default z-0" 
            onPointerDown={handleCanvasPanPointerDown}
          />
          {marqueeRect && (
            <div
              className="absolute z-20 pointer-events-none border border-[#C2410C] bg-[#C2410C]/10"
              style={{
                left: marqueeRect.x,
                top: marqueeRect.y,
                width: marqueeRect.width,
                height: marqueeRect.height,
              }}
            />
          )}

          {/* Symmetrical Controls */}
          <div className="absolute top-6 left-6 flex items-center z-40 gap-2">
            <CanvasHistoryPopover
              canvases={canvases}
              activeCanvasId={activeCanvasId}
              setActiveCanvasId={setActiveCanvasId}
            />
            <CanvasNoteSearch
              nodes={dynamicNodes}
              onFocusNode={(node) => {
                const scale = transformRef.current.scale;
                setCanvasTransform(
                  transformToFocusNode(
                    node.x,
                    node.y,
                    scale,
                    node.width ?? 320,
                    node.height ?? 200,
                  ),
                );
                setSelectedNodes(new Set([node.id]));
              }}
            />
          </div>

          {/* Transformed content container */}
          <div className="absolute top-6 right-6 flex items-center z-40 gap-3">
              <button 
                onClick={handlePublish}
                disabled={selectedNodes.size === 0 || isAnyAiBusy}
                className={`p-3 rounded-full shadow-md transition-all flex items-center justify-center border ${
                  selectedNodes.size > 0
                    ? 'bg-[#C2410C] text-white border-[#a0350a]/50 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100'
                    : 'bg-white text-[#1a1a1a] border-[#E6E4DF] hover:scale-105 hover:border-[#C2410C] hover:text-[#C2410C] disabled:opacity-50 disabled:hover:scale-100 disabled:hover:border-[#E6E4DF] disabled:hover:text-[#1a1a1a]'
                }`}
                title={`${t('sidebar.publish')} (${selectedNodes.size})`}
              >
                {publishOutlineOpen ? <Loader2 className="w-5 h-5 animate-spin" /> : <PenLine className="w-5 h-5" />}
              </button>
              
              <button
                onClick={toggleFullscreen}
                className="bg-white text-[#1a1a1a] p-3 rounded-full shadow-md hover:scale-105 transition-all border border-[#E6E4DF] flex items-center justify-center hover:border-[#C2410C] hover:text-[#C2410C]"
                title={isFullscreen ? t('canvas.full_screen') : t('canvas.full_screen')}
              >
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>
          </div>

          <div 
            ref={contentContainerRef}
            className="absolute inset-0 origin-top-left z-0 pointer-events-none"
            style={{ transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})` }}
          >
            <CanvasEdgeLines
              edges={edges} connectingFrom={connectingFrom}
              svgRef={svgRef} edgeLabelsRef={edgeLabelsRef}
              hoveredEdgeId={hoveredEdgeId} setHoveredEdgeId={setHoveredEdgeId}
              deleteEdge={deleteEdge}
            />

            <div className="absolute inset-0 z-30 w-[1px] h-[1px] pointer-events-none"> 
              {/* All Nodes from Database */}
              {dynamicNodes.map((node) => {
                const stackedParentId =
                  node.webSearchParentId ||
                  ((node.type === 'text' || node.type === 'note') && node.layout === 2
                    ? edges.find((e) => e.to === node.id)?.from
                    : undefined);
                const stackedParent = stackedParentId
                  ? dynamicNodes.find(
                      (n) =>
                        n.id === stackedParentId &&
                        (n.type === 'ai' || n.type === 'note' || n.type === 'text'),
                    )
                  : undefined;
                const webStacked =
                  !!stackedParent?.webSearchSourcesCollapsed &&
                  webSearchSourceCountByParent.has(stackedParent.id);
                const webImageScatter =
                  !webStacked &&
                  node.type === 'image' &&
                  !!stackedParent &&
                  webSearchSourceCountByParent.has(stackedParent.id);

                const bookHub = node.bookExpandParentId
                  ? dynamicNodes.find((n) => n.id === node.bookExpandParentId && n.type === 'theme')
                  : undefined;
                const bookStacked =
                  !!bookHub?.bookExpandBranchesCollapsed &&
                  bookExpandBranchCountByHub.has(bookHub.id);

                const stacked = webStacked || bookStacked;

                let rotation =
                  (node.type === 'note' || node.type === 'text') ? (node.layout === 0 || node.layout === undefined ? 1 : 0) :
                  (node.type === 'theme') ? (node.layout === 0 || node.layout === undefined ? -1 : 0) :
                  (node.type === 'image') ? -1 :
                  (node.type === 'video') ? 1 :
                  (node.type === 'document') ? 1 : 0;
                if (webStacked) {
                  rotation = sourceStackTiltDeg(webSearchSourceIndex(node));
                } else if (webImageScatter) {
                  rotation = sourceImageScatterTiltDeg(webSearchSourceIndex(node));
                } else if (bookStacked) {
                  rotation = 0;
                }

                const stackZ = webStacked || webImageScatter
                  ? sourceStackZIndex(webSearchSourceIndex(node))
                  : bookStacked
                    ? bookExpandStackZIndex(bookExpandBranchIndex(node))
                    : undefined;

                return (
                  <DraggableNode 
                    key={node.id} 
                    id={node.id} nodesRef={nodesRef} isConnecting={connectingFrom !== null} onLink={handleLink}
                    initialX={
                      node.x +
                      (groupDragOffset?.peerIds.includes(node.id) ? groupDragOffset.dx : 0)
                    }
                    initialY={
                      node.y +
                      (groupDragOffset?.peerIds.includes(node.id) ? groupDragOffset.dy : 0)
                    }
                    initialWidth={node.width} initialHeight={node.height}
                    onDelete={() => removeNodeId(node.id)} scale={canvasTransform.scale}
                    rotation={rotation}
                    zIndexOverride={stackZ}
                    onCycleLayout={
                      nodeSupportsCycleLayout(node.type)
                        ? () => {
                            const currentLayout = node.layout || 0;
                            const layoutCycleMod =
                              node.type === 'note' || node.type === 'text' ? NOTE_LAYOUT_COUNT : 4;
                            db.nodes.update(node.id, { layout: (currentLayout + 1) % layoutCycleMod });
                          }
                        : undefined
                    }
                    isSelected={selectedNodes.has(node.id)}
                    isEditing={editingNodeId === node.id}
                    onToggleSelect={() => toggleNodeSelection(node.id)}
                    allowPalette={true}
                    groupDragEnabled={selectedNodes.size > 1 && selectedNodes.has(node.id)}
                    onGroupDragMove={(delta) => {
                      const peerIds = [...selectedNodesRef.current].filter((id) => id !== node.id);
                      setGroupDragOffset({ peerIds, dx: delta.dx, dy: delta.dy });
                    }}
                    onDragEnd={handleNodeDragEnd}
                    onResizeEnd={(size) => {
                      db.nodes.update(node.id, size);
                    }}
                    glassSurface={
                      (node.type === 'note' || node.type === 'text') && (node.layout ?? 0) === 1
                    }
                    onStickyActivate={
                      node.type === 'note' || node.type === 'text'
                        ? (nid) => {
                            lastStickyClickIdRef.current = nid;
                          }
                        : undefined
                    }
                    onWebSearch={
                      node.type === 'note' || node.type === 'text'
                        ? () => {
                            void searchNoteWithMedia(node.id);
                          }
                        : undefined
                    }
                    isWebSearchLoading={searchingNoteNodeId === node.id}
                    isWebSearchDisabled={isAnyAiBusy && searchingNoteNodeId !== node.id}
                >
                  <NodeRenderer
                    node={node}
                    editingNodeId={editingNodeId}
                    setEditingNodeId={setEditingNodeId}
                    agentConfigs={agentConfigs}
                    analyzingAgentNodeId={analyzingAgentNodeId}
                    onAgentRunAnalysis={runAgentAnalysisFromCard}
                    isAgentAnalysisActionDisabled={isAnyAiBusy}
                    onAiFollowUp={submitAiThreadFollowUp}
                    followUpLoadingNodeId={followUpParentId}
                    streamingAiNodeId={streamingAiNodeId}
                    isFollowUpGloballyDisabled={isAnyAiBusy}
                    webSearchSourceCount={webSearchSourceCountByParent.get(node.id) ?? 0}
                    webSearchSourcesCollapsed={!!node.webSearchSourcesCollapsed}
                    onToggleWebSearchSources={toggleWebSearchSources}
                    bookExpandBranchCount={bookExpandBranchCountByHub.get(node.id) ?? 0}
                    onToggleBookExpandBranches={toggleBookExpandBranches}
                    ttsHighlightSentence={
                      ttsHighlight?.nodeId === node.id ? ttsHighlight.sentence : null
                    }
                    onExtractBookSelectionToCard={(quote, sourceLabel, sourceNodeId) => {
                      void extractBookSelectionToCard(
                        sourceNodeId || node.id,
                        quote,
                        sourceLabel,
                      );
                    }}
                    onAskAboutBookSelection={askAboutSelection}
                    onExpandBookSelection={(quote, sourceLabel) => {
                      void expandBookSelection(node.id, quote, sourceLabel);
                    }}
                    expandingBookNodeId={expandingBookNodeId}
                    aiConfig={aiConfig}
                    bookVoiceChatDisabled={voiceModeActive}
                    canvasTransform={canvasTransform}
                    canvasNodes={dynamicNodes}
                    onFocusCanvasRect={focusCanvasRect}
                  />
                </DraggableNode>
              );
            })}
            </div>

          </div>

        {/* AI Prompt Bar & Toolbar */}
        <CanvasToolbar
          isToolbarAiLoading={isToolbarAiLoading}
          isInputDisabled={isAnyAiBusy || voiceModeActive}
          aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
          handleAiSubmit={handleAiSubmit} addTextNode={addTextNode} addThemeNode={addThemeNode} addFileNode={addFileNode}
          agentConfigs={agentConfigs} canvasTransform={canvasTransform}
          setCanvasTransform={setCanvasTransform} transformRef={transformRef}
          activeCanvasId={activeCanvasId}
          voiceModeActive={voiceModeActive}
          voicePhase={voicePhase}
          onToggleVoiceMode={toggleVoiceMode}
          onStopVoiceActivity={stopVoiceActivity}
          pendingQuote={pendingQuote}
          onClearPendingQuote={clearPendingQuote}
        />
        </main>
        )}

        {activeTab === 'reference' && (
          <Reference
            articles={articles}
            activeReferenceId={activeReferenceId}
            setActiveReferenceId={setActiveReferenceId}
            onOpenCanvas={(canvasId) => {
              setActiveCanvasId(canvasId);
              setActiveTab('personal');
            }}
          />
        )}
        {activeTab === 'lab' && <ResearchLab aiConfig={aiConfig} callAI={callUniversalAI} />}
        {/* Agents in Agents Studio need consistent write access */}
        {activeTab === 'agents' && <AgentsStudio agentConfigs={agentConfigs} setAgentConfigs={async (newConfigs) => {
          const nextIds = new Set(newConfigs.map((c) => c.id));
          const existing = await db.agents.toArray();
          await Promise.all(existing.filter((row) => !nextIds.has(row.id)).map((row) => db.agents.delete(row.id)));
          await Promise.all(newConfigs.map((config) => db.agents.put(config)));
        }} aiConfig={aiConfig} callAI={callUniversalAI} />}
        <AISettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={aiConfig} setConfig={setAiConfig} />
        <PublishOutlineDialog
          open={publishOutlineOpen}
          onClose={closePublishOutlineDialog}
          aiConfig={aiConfig}
          selectedIds={publishOutlineSelectedIds}
          dynamicNodes={dynamicNodes}
          nodesRef={nodesRef}
          activeCanvasId={activeCanvasId}
          setActiveReferenceId={setActiveReferenceId}
          setActiveTab={setActiveTab}
          setSelectedNodes={setSelectedNodes}
        />
      </div>
    </div>
  );
}
