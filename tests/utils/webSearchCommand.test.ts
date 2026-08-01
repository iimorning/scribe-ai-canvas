import { describe, it, expect } from 'vitest';
import { parseThreadWebSearchIntent } from '../../src/utils/webSearchCommand';

describe('parseThreadWebSearchIntent', () => {
  it('returns null for normal follow-up', () => {
    expect(parseThreadWebSearchIntent('你好，请展开说说')).toBeNull();
  });

  it('detects 联网搜索 with optional remainder', () => {
    expect(parseThreadWebSearchIntent('联网搜索')?.explicitQuery).toBe('');
    expect(parseThreadWebSearchIntent('联网搜索 量子计算')?.explicitQuery).toBe('量子计算');
  });

  it('detects 联网检索', () => {
    expect(parseThreadWebSearchIntent('联网检索  foo ')?.explicitQuery).toBe('foo');
  });

  it('detects common voice-transcription variants', () => {
    expect(parseThreadWebSearchIntent('全网搜索佛山的天气')?.explicitQuery).toBe('佛山的天气');
    expect(parseThreadWebSearchIntent('网上搜索 AI 新闻')?.explicitQuery).toBe('AI 新闻');
    expect(parseThreadWebSearchIntent('网络搜索 量子计算')?.explicitQuery).toBe('量子计算');
  });

  it('detects web search (case insensitive)', () => {
    expect(parseThreadWebSearchIntent('Web Search climate')?.explicitQuery).toBe('climate');
  });
});
