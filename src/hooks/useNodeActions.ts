import type { RefObject } from 'react';
import type { CanvasTransform } from './useCanvasInteraction';
import { db } from '../db';
import i18n from '../i18n';
import { getCanvasCenterPosition } from '../utils/canvas';
import { processFileToNode } from '../utils/file';

interface UseNodeActionsParams {
  activeCanvasId: string;
  nodesRef: RefObject<Record<string, HTMLElement | null>>;
  connectingFrom: string | null;
  setConnectingFrom: (v: string | null) => void;
  edges: { from: string; to: string }[];
  selectedNodes: Set<string>;
  setSelectedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  transformRef: RefObject<CanvasTransform>;
}

export function useNodeActions({
  activeCanvasId,
  nodesRef,
  connectingFrom,
  setConnectingFrom,
  edges,
  selectedNodes,
  setSelectedNodes,
  transformRef,
}: UseNodeActionsParams) {
  const toggleNodeSelection = (id: string) => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLink = (id: string) => {
    if (connectingFrom) {
      if (connectingFrom !== id && !edges.find(e => (e.from === connectingFrom && e.to === id) || (e.from === id && e.to === connectingFrom))) {
        db.edges.add({ id: crypto.randomUUID(), canvasId: activeCanvasId, from: connectingFrom, to: id });
      }
      setConnectingFrom(null);
    } else {
      setConnectingFrom(id);
    }
  };

  const deleteEdge = (id: string) => {
    db.edges.delete(id);
  };

  const removeNodeId = (id: string) => {
    db.nodes.delete(id);
    db.edges.where('from').equals(id).or('to').equals(id).delete();
  };

  const removeNodeIds = async (ids: Iterable<string>) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    await db.transaction('rw', db.nodes, db.edges, async () => {
      await db.nodes.bulkDelete(uniqueIds);
      for (const id of uniqueIds) {
        await db.edges.where('from').equals(id).or('to').equals(id).delete();
      }
    });
    setSelectedNodes(new Set());
  };

  const addTextNode = async () => {
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    await db.nodes.add({ id: crypto.randomUUID(), canvasId: activeCanvasId, type: 'text', content: '', x, y });
  };

  const addThemeNode = async () => {
    const { x, y } = getCanvasCenterPosition(transformRef.current);
    await db.nodes.add({
      id: crypto.randomUUID(),
      canvasId: activeCanvasId,
      type: 'theme',
      content: i18n.t('nodes.new_theme_title'),
      x,
      y,
    });
  };

  const addFileNode = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const { x, y } = getCanvasCenterPosition(transformRef.current);
        const data = await processFileToNode(file);
        await db.nodes.add({
          id: crypto.randomUUID(),
          canvasId: activeCanvasId,
          ...data,
          x, y,
        });
      } catch (err) {
        console.error('Failed to process file:', file.name, err);
      }
      e.target.value = '';
    }
  };

  return { toggleNodeSelection, handleLink, deleteEdge, removeNodeId, removeNodeIds, addTextNode, addThemeNode, addFileNode };
}
