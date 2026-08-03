import { describe, expect, it } from 'vitest';
import { parseVoiceDrawIntent } from '../../src/utils/voiceDrawIntent';

describe('parseVoiceDrawIntent', () => {
  it('extracts Chinese draw prompts', () => {
    expect(parseVoiceDrawIntent('画一张教室里的对比图')?.prompt).toBe('教室里的对比图');
    expect(parseVoiceDrawIntent('帮我画：海边的灯塔')?.prompt).toBe('海边的灯塔');
  });

  it('extracts English draw prompts', () => {
    expect(parseVoiceDrawIntent('draw a foggy mountain path')?.prompt).toBe('a foggy mountain path');
  });

  it('returns null for unrelated speech', () => {
    expect(parseVoiceDrawIntent('继续讲注意力经济')).toBeNull();
  });
});
