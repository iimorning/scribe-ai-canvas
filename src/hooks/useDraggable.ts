import React, { useState, useRef, useEffect } from 'react';

let maxZIndex = 10;

export type DragDelta = { dx: number; dy: number };

export function useDraggable(
  initialX: number,
  initialY: number,
  scale: number = 1,
  onDragEnd?: (pos: { x: number; y: number }, delta: DragDelta) => void,
  onDragMove?: (pos: { x: number; y: number }, delta: DragDelta) => void,
) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  // Claim a fresh top z so newly spawned cards aren't trapped under an already-dragged node.
  const [zIndex, setZIndex] = useState(() => {
    maxZIndex += 1;
    return maxZIndex;
  });
  const scaleRef = useRef(scale);
  const posRef = useRef(pos);
  const draggingRef = useRef(false);
  const onDragEndRef = useRef(onDragEnd);
  const onDragMoveRef = useRef(onDragMove);
  scaleRef.current = scale;
  onDragEndRef.current = onDragEnd;
  onDragMoveRef.current = onDragMove;

  // Keep posRef up to date so we can send the latest pos on up
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // Follow Dexie-driven moves (e.g. web-search source collapse/expand) without
  // fighting an in-progress drag.
  useEffect(() => {
    if (draggingRef.current) return;
    setPos((prev) => (prev.x === initialX && prev.y === initialY ? prev : { x: initialX, y: initialY }));
  }, [initialX, initialY]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Middle button is reserved for canvas panning.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.isContentEditable ||
      target.closest('[contenteditable="true"]') ||
      target.closest('[data-no-drag]') ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'VIDEO' ||
      target.closest('button')
    ) {
      return;
    }

    draggingRef.current = true;
    maxZIndex += 1;
    setZIndex(maxZIndex);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = { ...posRef.current };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / scaleRef.current;
      const dy = (moveEvent.clientY - startY) / scaleRef.current;
      const next = { x: initialPos.x + dx, y: initialPos.y + dy };
      setPos(next);
      onDragMoveRef.current?.(next, { dx, dy });
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      draggingRef.current = false;
      const finalPos = posRef.current;
      const delta = {
        dx: finalPos.x - initialPos.x,
        dy: finalPos.y - initialPos.y,
      };
      if (onDragEndRef.current) {
        // use a small timeout to let state settle
        setTimeout(() => {
          onDragEndRef.current?.(finalPos, delta);
        }, 0);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return { pos, onPointerDown, zIndex };
}
