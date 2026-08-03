import { useState, useRef, useEffect, type RefObject } from 'react';
import { loadCanvasViewport, saveCanvasViewport } from '../utils/canvasViewport';

export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

/**
 * Layout (world) center of a node relative to the transformed canvas container.
 * Uses offsetLeft/Top/Width/Height so parent CSS scale cannot inject subpixel
 * jitter the way getBoundingClientRect → ÷ scale does during zoom.
 */
function getNodeLayoutBox(el: HTMLElement, container: HTMLElement) {
  let left = 0;
  let top = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== container) {
    left += cur.offsetLeft;
    top += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    right: left + width,
  };
}

export function useCanvasInteraction(
  mainRef: RefObject<HTMLDivElement | null>,
  contentContainerRef: RefObject<HTMLDivElement | null>,
  svgRef: RefObject<SVGSVGElement | null>,
  edgeLabelsRef: RefObject<HTMLDivElement | null>,
  nodesRef: RefObject<Record<string, HTMLElement | null>>,
  connectingFrom: string | null,
  setConnectingFrom: (v: string | null) => void,
  canvasId: string = 'default',
) {
  const [canvasTransform, setCanvasTransformState] = useState<CanvasTransform>(() =>
    loadCanvasViewport(canvasId),
  );
  const transformRef = useRef<CanvasTransform>(canvasTransform);
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Keep transformRef in lockstep with state (including inside the updater) so
  // edge math never reads a one-frame-stale scale during zoom/pan.
  const setCanvasTransform = (
    update: CanvasTransform | ((prev: CanvasTransform) => CanvasTransform),
  ) => {
    setCanvasTransformState((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      transformRef.current = next;
      return next;
    });
  };

  // Restore per-canvas viewport when switching canvases; flush previous on change/unmount.
  useEffect(() => {
    const loaded = loadCanvasViewport(canvasId);
    setCanvasTransform(loaded);
    transformRef.current = loaded;
    return () => {
      saveCanvasViewport(canvasId, transformRef.current);
    };
  }, [canvasId]);

  // Debounced persist while panning / zooming.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveCanvasViewport(canvasId, canvasTransform);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [canvasId, canvasTransform]);

  useEffect(() => {
    const flush = () => saveCanvasViewport(canvasId, transformRef.current);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [canvasId]);

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Wheel zoom & scroll
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onWheel = (e: WheelEvent) => {
      // 缩放手势仍始终由画布处理；普通滚轮在可滚动子区域内交给浏览器默认滚动
      if (!e.ctrlKey && !e.metaKey) {
        let node: HTMLElement | null = e.target as HTMLElement;
        if (node && node.nodeType !== Node.ELEMENT_NODE) {
          node = node.parentElement;
        }
        let insideScrollable = false;
        while (node && main.contains(node) && node !== main) {
          const { overflowY } = window.getComputedStyle(node);
          const canScrollY =
            (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
            node.scrollHeight > node.clientHeight;
          if (canScrollY) {
            insideScrollable = true;
            const dy = e.deltaY;
            const atTop = node.scrollTop <= 0;
            const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
            // 内容未滚到边界时，交给浏览器默认滚动
            if ((dy < 0 && !atTop) || (dy > 0 && !atBottom)) {
              return;
            }
          }
          node = node.parentElement;
        }
        // 如果目标位于任何可滚动子区域内（即使已到顶/底），也不触发画布滚动
        if (insideScrollable) {
          return;
        }
      }

      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCanvasTransform(prev => {
          const zoomBase = 1.05;
          const factor = e.deltaY < 0 ? zoomBase : 1 / zoomBase;
          const newScale = Math.min(Math.max(0.1, prev.scale * factor), 5);

          const mainRect = main.getBoundingClientRect();
          const clientX = e.clientX - mainRect.left;
          const clientY = e.clientY - mainRect.top;

          const mouseXInCanvas = (clientX - prev.x) / prev.scale;
          const mouseYInCanvas = (clientY - prev.y) / prev.scale;

          const newX = clientX - mouseXInCanvas * newScale;
          const newY = clientY - mouseYInCanvas * newScale;

          return { x: newX, y: newY, scale: newScale };
        });
      } else {
        setCanvasTransform(prev => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };
    main.addEventListener('wheel', onWheel, { passive: false });
    return () => main.removeEventListener('wheel', onWheel);
  }, [mainRef]);

  // Pan start handler
  const handlePanStart = (e: React.PointerEvent) => {
    if (e.target === e.currentTarget || e.button === 1 || e.button === 0) {
      if (connectingFrom) setConnectingFrom(null);
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startTransform = transformRef.current;

      const onPointerMove = (moveEv: PointerEvent) => {
        setCanvasTransform({
          ...startTransform,
          x: startTransform.x + (moveEv.clientX - startX),
          y: startTransform.y + (moveEv.clientY - startY),
        });
      };
      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    }
  };

  // Edge line animation loop
  useEffect(() => {
    let animationFrameId: number;
    const updateLines = () => {
      const svg = svgRef.current;
      const container = contentContainerRef.current;
      const edgeLabelsContainer = edgeLabelsRef.current;

      // Always reschedule: after HMR or strict-mode remount, refs can be null for a frame.
      // Early-return without rAF would permanently stop edge updates until a full reload.
      if (svg && container) {
        const edgeGroups = Array.from(svg.querySelectorAll('g[data-edge-id]')) as SVGGElement[];

        edgeGroups.forEach((g: SVGGElement) => {
          const fromId = g.getAttribute('data-edge-from');
          const toId = g.getAttribute('data-edge-to');
          const edgeId = g.getAttribute('data-edge-id');
          if (!fromId || !toId || !edgeId) return;

          const fromNode = nodesRef.current[fromId];
          const toNode = nodesRef.current[toId];
          if (fromNode && toNode) {
            const fromBox = getNodeLayoutBox(fromNode, container);
            const toBox = getNodeLayoutBox(toNode, container);
            const x1 = fromBox.centerX;
            const y1 = fromBox.centerY;
            const x2 = toBox.centerX;
            const y2 = toBox.centerY;

            g.querySelectorAll('line').forEach((line: SVGLineElement) => {
              line.setAttribute('x1', x1.toString());
              line.setAttribute('y1', y1.toString());
              line.setAttribute('x2', x2.toString());
              line.setAttribute('y2', y2.toString());
            });

            if (edgeLabelsContainer) {
              const btn = edgeLabelsContainer.querySelector(`[data-edge-btn="${edgeId}"]`) as HTMLButtonElement;
              if (btn) {
                btn.style.left = `${(x1 + x2) / 2}px`;
                btn.style.top = `${(y1 + y2) / 2}px`;
              }
            }
          }
        });

        const tempEdge = svg.querySelector('#temp-edge') as SVGLineElement;
        const connFrom = svg.getAttribute('data-connecting-from');
        if (tempEdge) {
          if (connFrom && nodesRef.current[connFrom]) {
            const fromNode = nodesRef.current[connFrom]!;
            const fromBox = getNodeLayoutBox(fromNode, container);
            // Cursor is screen-space; convert once into the scaled container's world space.
            const containerRect = container.getBoundingClientRect();
            const currentScale = transformRef.current.scale || 1;
            const x1 = fromBox.right;
            const y1 = fromBox.centerY;
            const x2 = (mousePosRef.current.x - containerRect.left) / currentScale;
            const y2 = (mousePosRef.current.y - containerRect.top) / currentScale;

            tempEdge.style.display = 'block';
            tempEdge.setAttribute('x1', x1.toString());
            tempEdge.setAttribute('y1', y1.toString());
            tempEdge.setAttribute('x2', x2.toString());
            tempEdge.setAttribute('y2', y2.toString());
          } else {
            tempEdge.style.display = 'none';
          }
        }
      }

      animationFrameId = requestAnimationFrame(updateLines);
    };
    updateLines();
    return () => cancelAnimationFrame(animationFrameId);
  }, [svgRef, contentContainerRef, edgeLabelsRef, nodesRef]);

  return { canvasTransform, setCanvasTransform, transformRef, handlePanStart, mousePosRef };
}
