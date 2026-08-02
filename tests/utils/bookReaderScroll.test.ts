import { describe, it, expect } from 'vitest';
import {
  bookChapterFlipFromWheel,
  bookReaderScrollStep,
  isDiscreteReaderWheel,
  nextBookReaderScrollTop,
} from '../../src/utils/bookReaderScroll';

describe('isDiscreteReaderWheel', () => {
  it('LINE / PAGE mode 视为离散滚轮', () => {
    expect(isDiscreteReaderWheel({ deltaMode: 1, deltaY: 3 })).toBe(true);
    expect(isDiscreteReaderWheel({ deltaMode: 2, deltaY: 1 })).toBe(true);
  });

  it('像素模式下典型鼠标一格（~100）视为离散', () => {
    expect(isDiscreteReaderWheel({ deltaMode: 0, deltaY: 100 })).toBe(true);
    expect(isDiscreteReaderWheel({ deltaMode: 0, deltaY: -120 })).toBe(true);
  });

  it('触控板小增量不视为离散翻页', () => {
    expect(isDiscreteReaderWheel({ deltaMode: 0, deltaY: 12 })).toBe(false);
    expect(isDiscreteReaderWheel({ deltaMode: 0, deltaY: -4 })).toBe(false);
  });

  it('过大的像素增量（惯性甩动）不强制翻页', () => {
    expect(isDiscreteReaderWheel({ deltaMode: 0, deltaY: 400 })).toBe(false);
  });
});

describe('bookReaderScrollStep / nextBookReaderScrollTop', () => {
  it('默认无重叠：步进等于整屏高度', () => {
    expect(bookReaderScrollStep(400)).toBe(400);
    expect(bookReaderScrollStep(400, 0)).toBe(400);
  });

  it('显式 overlap 时仍为视口减去衔接', () => {
    expect(bookReaderScrollStep(400, 56)).toBe(344);
  });

  it('视口很矮时 overlap 不会超过一半', () => {
    expect(bookReaderScrollStep(80, 56)).toBe(40);
  });

  it('向下翻页并在底部夹紧', () => {
    expect(
      nextBookReaderScrollTop({
        scrollTop: 0,
        clientHeight: 400,
        scrollHeight: 1000,
        direction: 1,
      }),
    ).toBe(400);

    expect(
      nextBookReaderScrollTop({
        scrollTop: 700,
        clientHeight: 400,
        scrollHeight: 1000,
        direction: 1,
      }),
    ).toBe(600);
  });

  it('向上翻页并在顶部夹紧', () => {
    expect(
      nextBookReaderScrollTop({
        scrollTop: 100,
        clientHeight: 400,
        scrollHeight: 1000,
        direction: -1,
      }),
    ).toBe(0);
  });
});

describe('bookChapterFlipFromWheel', () => {
  it('页内无法再滚且向下 → 下一章', () => {
    expect(
      bookChapterFlipFromWheel({
        canScrollFurther: false,
        direction: 1,
        pageIndex: 0,
        pageCount: 3,
      }),
    ).toBe('next');
  });

  it('页内无法再滚且向上 → 上一章', () => {
    expect(
      bookChapterFlipFromWheel({
        canScrollFurther: false,
        direction: -1,
        pageIndex: 2,
        pageCount: 3,
      }),
    ).toBe('prev');
  });

  it('页内还能继续滚时不翻章', () => {
    expect(
      bookChapterFlipFromWheel({
        canScrollFurther: true,
        direction: 1,
        pageIndex: 0,
        pageCount: 3,
      }),
    ).toBeNull();
  });

  it('已在首末章边界时不再翻章', () => {
    expect(
      bookChapterFlipFromWheel({
        canScrollFurther: false,
        direction: 1,
        pageIndex: 2,
        pageCount: 3,
      }),
    ).toBeNull();
    expect(
      bookChapterFlipFromWheel({
        canScrollFurther: false,
        direction: -1,
        pageIndex: 0,
        pageCount: 3,
      }),
    ).toBeNull();
  });
});
