import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  estimateNodeRect,
  findOpenCanvasPosition,
  getCanvasCenterPosition,
  NEW_AI_NODE_SIZE,
  positionBesideRect,
  rectsOverlap,
} from '../../src/utils/canvas';

describe('getCanvasCenterPosition', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('默认 transform 返回视口中心附近的坐标', () => {
    const result = getCanvasCenterPosition({ x: 0, y: 0, scale: 1 });
    // jsdom innerWidth=1024, innerHeight=768
    // x = (512 - 0) / 1 - 150 + 0.5*50 = 387
    // y = (384 - 0) / 1 - 100 + 0.5*50 = 309
    expect(result.x).toBe(387);
    expect(result.y).toBe(309);
  });

  it('缩放后坐标正确换算', () => {
    const result = getCanvasCenterPosition({ x: 0, y: 0, scale: 2 });
    // x = (512 - 0) / 2 - 150 + 25 = 131
    // y = (384 - 0) / 2 - 100 + 25 = 117
    expect(result.x).toBe(131);
    expect(result.y).toBe(117);
  });

  it('平移后坐标正确换算', () => {
    const result = getCanvasCenterPosition({ x: 100, y: 200, scale: 1 });
    // x = (512 - 100) / 1 - 150 + 25 = 287
    // y = (384 - 200) / 1 - 100 + 25 = 109
    expect(result.x).toBe(287);
    expect(result.y).toBe(109);
  });

  it('极小 scale 值不会出错', () => {
    const result = getCanvasCenterPosition({ x: 0, y: 0, scale: 0.1 });
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it('极大 scale 值坐标变小', () => {
    const result = getCanvasCenterPosition({ x: 0, y: 0, scale: 10 });
    expect(result.x).toBeLessThan(100);
    expect(result.y).toBeLessThan(100);
  });
});

describe('estimateNodeRect / rectsOverlap', () => {
  it('book 未写宽高时用 380×520', () => {
    expect(estimateNodeRect({ type: 'book', x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 380,
      height: 520,
    });
  });

  it('普通节点未写宽高时用 320×200', () => {
    expect(estimateNodeRect({ type: 'ai', x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 200,
    });
  });

  it('带 gap 时重叠判定正确', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 110, y: 0, width: 100, height: 100 };
    expect(rectsOverlap(a, b, 0)).toBe(false);
    expect(rectsOverlap(a, b, 20)).toBe(true);
  });
});

describe('findOpenCanvasPosition', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('中心空闲时落在视口中心附近', () => {
    const pos = findOpenCanvasPosition({
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [],
    });
    expect(pos).toEqual({ x: 387, y: 309 });
  });

  it('中心被书籍占满时向旁侧避让', () => {
    const book = { type: 'book', x: 200, y: 100, width: 380, height: 520 };
    const pos = findOpenCanvasPosition({
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [book],
      size: NEW_AI_NODE_SIZE,
    });
    const placed = { ...pos, ...NEW_AI_NODE_SIZE };
    const bookRect = estimateNodeRect(book);
    expect(rectsOverlap(placed, bookRect, 28)).toBe(false);
  });

  it('有 preferBeside 时优先放在锚点右侧', () => {
    const book = { type: 'book', x: 100, y: 80, width: 380, height: 520 };
    const expected = positionBesideRect(estimateNodeRect(book), NEW_AI_NODE_SIZE, 28);
    const pos = findOpenCanvasPosition({
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [book],
      size: NEW_AI_NODE_SIZE,
      preferBeside: book,
    });
    expect(pos).toEqual(expected);
  });

  it('右侧也被占用时继续螺旋寻找空位', () => {
    const book = { type: 'book', x: 100, y: 80, width: 380, height: 520 };
    const beside = positionBesideRect(estimateNodeRect(book), NEW_AI_NODE_SIZE, 28);
    const blocker = {
      type: 'ai',
      x: beside.x,
      y: beside.y,
      width: NEW_AI_NODE_SIZE.width,
      height: NEW_AI_NODE_SIZE.height,
    };
    const pos = findOpenCanvasPosition({
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [book, blocker],
      size: NEW_AI_NODE_SIZE,
      preferBeside: book,
    });
    const placed = { ...pos, ...NEW_AI_NODE_SIZE };
    expect(rectsOverlap(placed, estimateNodeRect(book), 28)).toBe(false);
    expect(rectsOverlap(placed, estimateNodeRect(blocker), 28)).toBe(false);
  });

  it('大面积占位时用小步长螺旋，避免一次跳开一整簇宽高', () => {
    const book = { type: 'book', x: 100, y: 80, width: 380, height: 520 };
    const cluster = { width: 900, height: 1180 };
    const beside = positionBesideRect(estimateNodeRect(book), cluster, 36);
    const blocker = {
      type: 'note',
      x: beside.x + 40,
      y: beside.y + 40,
      width: 200,
      height: 160,
    };
    const pos = findOpenCanvasPosition({
      transform: { x: 0, y: 0, scale: 1 },
      obstacles: [book, blocker],
      size: cluster,
      preferBeside: book,
      gap: 36,
      step: { width: 280 + 36, height: 160 + 36 },
      maxRings: 24,
    });
    const placed = { ...pos, ...cluster };
    expect(rectsOverlap(placed, estimateNodeRect(book), 36)).toBe(false);
    expect(rectsOverlap(placed, estimateNodeRect(blocker), 36)).toBe(false);
    // Should stay near the preferred seed — not a full-cluster jump.
    expect(Math.abs(pos.x - beside.x)).toBeLessThan(cluster.width);
    expect(Math.abs(pos.y - beside.y)).toBeLessThan(cluster.height);
  });
});
