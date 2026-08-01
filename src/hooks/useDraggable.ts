import React, { useState, useRef, useEffect } from 'react';

let maxZIndex = 10;

export function useDraggable(initialX: number, initialY: number, scale: number = 1, onDragEnd?: (pos: {x: number, y: number}) => void) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [zIndex, setZIndex] = useState(maxZIndex);
  const scaleRef = useRef(scale);
  const posRef = useRef(pos);
  scaleRef.current = scale;
  
  // Keep posRef up to date so we can send the latest pos on up
  useEffect(() => {
     posRef.current = pos;
  }, [pos]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Middle button is reserved for canvas panning.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.isContentEditable ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'VIDEO' ||
      target.closest('button')
    ) {
      return;
    }
    
    maxZIndex += 1;
    setZIndex(maxZIndex); 
    
    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = { ...pos };

    const onPointerMove = (moveEvent: PointerEvent) => {
      setPos({
        x: initialPos.x + (moveEvent.clientX - startX) / scaleRef.current,
        y: initialPos.y + (moveEvent.clientY - startY) / scaleRef.current,
      });
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (onDragEnd) {
        // use a small timeout to let state settle
        setTimeout(() => {
          onDragEnd(posRef.current);
        }, 0);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return { pos, onPointerDown, zIndex };
}
