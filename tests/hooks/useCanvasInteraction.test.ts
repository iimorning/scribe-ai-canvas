import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useCanvasInteraction } from '../../src/hooks/useCanvasInteraction';
import { CANVAS_VIEWPORTS_KEY } from '../../src/utils/canvasViewport';

describe('useCanvasInteraction', () => {
  let mainEl: HTMLDivElement;

  beforeEach(() => {
    localStorage.removeItem(CANVAS_VIEWPORTS_KEY);
    mainEl = document.createElement('div');
    vi.spyOn(mainEl, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    vi.spyOn(mainEl, 'addEventListener');
    vi.spyOn(mainEl, 'removeEventListener');
  });

  const setupHook = () => {
    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const contentContainerRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const svgRef = createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>;
    const edgeLabelsRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const nodesRef = { current: {} } as React.RefObject<Record<string, HTMLElement | null>>;
    const setConnectingFrom = vi.fn();

    return renderHook(() =>
      useCanvasInteraction(
        mainRef,
        contentContainerRef,
        svgRef,
        edgeLabelsRef,
        nodesRef,
        null,
        setConnectingFrom,
        'test-canvas',
      ),
    );
  };

  it('初始 transform 为已保存视窗或默认 {x:0, y:0, scale:1}', () => {
    const { result } = setupHook();
    expect(result.current.canvasTransform).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('setCanvasTransform 更新 transform', () => {
    const { result } = setupHook();
    act(() => {
      result.current.setCanvasTransform({ x: 100, y: 200, scale: 1.5 });
    });
    expect(result.current.canvasTransform).toEqual({ x: 100, y: 200, scale: 1.5 });
  });

  it('transformRef 同步更新', () => {
    const { result } = setupHook();
    act(() => {
      result.current.setCanvasTransform({ x: 50, y: 60, scale: 2 });
    });
    expect(result.current.transformRef.current).toEqual({ x: 50, y: 60, scale: 2 });
  });

  it('wheel 事件注册到 mainRef 元素', () => {
    setupHook();
    expect(mainEl.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
  });

  it('enabled 从 false→true 时会重新绑定 wheel 监听（避免切回画布后 Ctrl+滚轮变成整页缩放）', () => {
    const mainRef = { current: mainEl } as React.RefObject<HTMLDivElement | null>;
    const contentContainerRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const svgRef = createRef<SVGSVGElement>() as React.RefObject<SVGSVGElement | null>;
    const edgeLabelsRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement | null>;
    const nodesRef = { current: {} } as React.RefObject<Record<string, HTMLElement | null>>;
    const setConnectingFrom = vi.fn();

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCanvasInteraction(
          mainRef,
          contentContainerRef,
          svgRef,
          edgeLabelsRef,
          nodesRef,
          null,
          setConnectingFrom,
          'test-canvas',
          enabled,
        ),
      { initialProps: { enabled: false } },
    );

    expect(mainEl.addEventListener).not.toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      { passive: false },
    );

    rerender({ enabled: true });
    expect(mainEl.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
  });

  it('wheel 在仍可纵向滚动的子元素内时提前返回，不触发画布平移', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
    expect(onWheel).toBeDefined();

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 0, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const before = { ...result.current.canvasTransform };
    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform).toEqual(before);
    gcs.mockRestore();
  });

  it('wheel 在可滚动子元素已触底时仍不触发画布平移（避免穿透滚动）', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;
    expect(onWheel).toBeDefined();

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      // 已滚到底：scrollTop + clientHeight >= scrollHeight - 1
      scrollTop: { get: () => 150, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const before = { ...result.current.canvasTransform };
    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform).toEqual(before);
    gcs.mockRestore();
  });

  it('wheel 在可滚动子元素已触顶时仍不触发画布平移', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 0, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const before = { ...result.current.canvasTransform };
    const e = new WheelEvent('wheel', { deltaY: -40, bubbles: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform).toEqual(before);
    gcs.mockRestore();
  });

  it('在可滚动区域内按住 Ctrl 滚轮仍可缩放画布（不因子区域提前 return）', () => {
    const { result } = setupHook();
    const wheelEntry = vi.mocked(mainEl.addEventListener).mock.calls.find((c) => c[0] === 'wheel');
    const onWheel = wheelEntry?.[1] as (e: WheelEvent) => void;

    const scrollEl = document.createElement('div');
    const inner = document.createElement('span');
    scrollEl.appendChild(inner);
    mainEl.appendChild(scrollEl);

    Object.defineProperties(scrollEl, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 50, configurable: true },
      scrollTop: { get: () => 150, configurable: true },
    });

    const gcs = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt: Element) => {
      if (elt === scrollEl) {
        return { overflowY: 'auto' } as unknown as CSSStyleDeclaration;
      }
      return { overflowY: 'visible' } as unknown as CSSStyleDeclaration;
    });

    const e = new WheelEvent('wheel', { deltaY: -40, bubbles: true, ctrlKey: true });
    Object.defineProperty(e, 'target', { value: inner, enumerable: true });

    act(() => {
      onWheel(e);
    });

    expect(result.current.canvasTransform.scale).not.toBe(1);
    gcs.mockRestore();
  });

  it('handlePanStart 消费 pointerdown 事件后注册 pointermove/pointerup', () => {
    const { result } = setupHook();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const mockPointerDown = {
      target: mainEl,
      currentTarget: mainEl,
      button: 0,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    } as unknown as React.PointerEvent;

    act(() => {
      result.current.handlePanStart(mockPointerDown);
    });

    expect(mockPointerDown.preventDefault).toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
  });
});
