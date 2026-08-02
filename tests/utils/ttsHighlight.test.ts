import { describe, it, expect } from 'vitest';
import { findSentenceRange } from '../../src/utils/ttsHighlight';

describe('findSentenceRange', () => {
  it('finds an exact sentence', () => {
    const content = '\u7b2c\u4e00\u53e5\u3002\u7b2c\u4e8c\u53e5\u3002\u7b2c\u4e09\u53e5\u3002';
    const needle = '\u7b2c\u4e8c\u53e5\u3002';
    expect(findSentenceRange(content, needle)).toEqual({ start: 4, end: 8 });
  });

  it('tolerates missing trailing punctuation on the spoken chunk', () => {
    const content = '\u4f60\u597d\u4e16\u754c\u3002\u7ee7\u7eed\u8bf4\u3002';
    const range = findSentenceRange(content, '\u4f60\u597d\u4e16\u754c');
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(content.slice(range!.start, range!.end)).toMatch(/^\u4f60\u597d\u4e16\u754c/);
    expect(range!.end).toBeGreaterThanOrEqual(4);
  });

  it('matches when whitespace differs', () => {
    const content = 'Hello   world. Next.';
    expect(findSentenceRange(content, 'Hello world.')).toEqual({ start: 0, end: 14 });
  });

  it('returns null when the sentence is absent', () => {
    expect(findSentenceRange('\u53ea\u6709\u8fd9\u4e00\u53e5\u3002', '\u53e6\u4e00\u53e5\u3002')).toBeNull();
  });
});
