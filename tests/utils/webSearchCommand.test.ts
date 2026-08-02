import { describe, it, expect } from 'vitest';
import {
  parseThreadWebSearchIntent,
  parseVoiceWebSearchIntent,
} from '../../src/utils/webSearchCommand';

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

  it('does not treat mid-sentence mention as a typed command', () => {
    expect(
      parseThreadWebSearchIntent(
        '最近 Kimi K3 的表现怎么样？能帮我联网搜索功能看它最强大的地方在哪里吗',
      ),
    ).toBeNull();
  });
});

describe('parseVoiceWebSearchIntent', () => {
  it('keeps prefix behavior', () => {
    expect(parseVoiceWebSearchIntent('联网搜索 Kimi K3')?.explicitQuery).toBe('Kimi K3');
  });

  it('detects mid-sentence 联网搜索 from natural speech', () => {
    const intent = parseVoiceWebSearchIntent(
      '最近 Kimi K3 的表现怎么样？能帮我联网搜索功能看它最强大的地方在哪里吗',
    );
    expect(intent).not.toBeNull();
    expect(intent!.explicitQuery).toMatch(/Kimi|强大|表现/);
    expect(intent!.explicitQuery).not.toMatch(/联网搜索/);
  });

  it('uses trailing keywords when the command is embedded but followed by a query', () => {
    expect(parseVoiceWebSearchIntent('帮我联网搜索一下 OpenAI 和 Hugging Face')?.explicitQuery).toMatch(
      /OpenAI/,
    );
  });

  it('detects casual 搜索一下 without 联网', () => {
    const intent = parseVoiceWebSearchIntent('最近 Kimi K3 的表现怎么样？你能帮我搜索一下');
    expect(intent).not.toBeNull();
    expect(intent!.explicitQuery).toMatch(/Kimi/);
    expect(intent!.explicitQuery).toMatch(/表现/);
  });

  it('detects 帮我搜索 / 查一下', () => {
    expect(parseVoiceWebSearchIntent('帮我搜索 OpenAI')?.explicitQuery).toMatch(/OpenAI/);
    expect(parseVoiceWebSearchIntent('查一下佛山天气')?.explicitQuery).toMatch(/佛山/);
  });

  it('returns null when there is no search trigger', () => {
    expect(parseVoiceWebSearchIntent('今天天气不错')).toBeNull();
    expect(parseVoiceWebSearchIntent('我在思考搜索算法')).toBeNull();
  });
});
