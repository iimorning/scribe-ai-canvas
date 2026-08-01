import { describe, it, expect } from 'vitest';
import { stripThinking } from '../../src/utils/stripThinking';

// Build tags from parts so the literal sequences survive being written to disk.
const LT = '<';
const GT = '>';
const SL = '/';
const TO = LT + 'think' + GT;
const TC = LT + SL + 'think' + GT;
const WO = LT + 'thought' + GT;
const WC = LT + SL + 'thought' + GT;

describe('stripThinking', () => {
  it('returns text unchanged when no thinking tag present', () => {
    expect(stripThinking('你好，世界')).toBe('你好，世界');
  });

  it('returns empty while inside an open think block', () => {
    expect(stripThinking(TO + '让我想想')).toBe('');
  });

  it('returns content after think closes', () => {
    expect(stripThinking(TO + '思考' + TC + '答案是42')).toBe('答案是42');
  });

  it('handles thought / close-thought style', () => {
    expect(stripThinking(WO + '思考结束' + WC + '最终答案')).toBe('最终答案');
  });

  it('handles multiple think blocks', () => {
    expect(stripThinking(TO + '一' + TC + TO + '二' + TC + '第二段回答')).toBe('第二段回答');
  });

  it('preserves leading whitespace after close', () => {
    expect(stripThinking(TO + 'x' + TC + '  你好')).toBe('  你好');
  });

  it('returns empty for empty input', () => {
    expect(stripThinking('')).toBe('');
  });

  it('passes plain answer through unchanged', () => {
    expect(stripThinking('普通回答')).toBe('普通回答');
  });
});
