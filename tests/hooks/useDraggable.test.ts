import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraggable } from '../../src/hooks/useDraggable';

describe('useDraggable', () => {
  it('reports move delta and end position for group-drag consumers', () => {
    const onEnd = vi.fn();
    const onMove = vi.fn();
    const { result } = renderHook(() => useDraggable(100, 200, 1, onEnd, onMove));

    const pointerDown = {
      button: 0,
      clientX: 50,
      clientY: 50,
      target: document.createElement('div'),
    } as unknown as React.PointerEvent<HTMLDivElement>;

    act(() => {
      result.current.onPointerDown(pointerDown);
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 80, clientY: 90 }),
      );
    });

    expect(onMove).toHaveBeenCalled();
    const lastMove = onMove.mock.calls.at(-1)!;
    expect(lastMove[0]).toEqual({ x: 130, y: 240 });
    expect(lastMove[1]).toEqual({ dx: 30, dy: 40 });

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(onEnd).toHaveBeenCalledWith({ x: 130, y: 240 }, { dx: 30, dy: 40 });
        resolve();
      }, 5);
    });
  });
});
