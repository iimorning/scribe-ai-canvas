import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeNoteSearchQueries, deriveNoteSearchQueries } from '../../src/services/deriveNoteSearchQueries';
import { callUniversalAI } from '../../src/services/ai';
import type { AIConfig } from '../../src/components/AISettingsModal';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

const t = ((key: string, opts?: Record<string, string>) => {
  if (key === 'ai.prompts.noteSearchQueryUser') {
    return `NOTE:${opts?.note ?? ''}|LINKED:${opts?.linked ?? ''}`;
  }
  return key;
}) as unknown as import('i18next').TFunction<'translation', undefined>;

const aiConfig: AIConfig = {
  provider: 'gemini',
  apiKey: 'k',
  baseUrl: '',
  model: 'm',
  metasoApiKey: '',
};

describe('normalizeNoteSearchQueries', () => {
  it('prefers body topic over a short conflicting title via AI JSON', () => {
    const note = '**词源与定义边界**\n\n古着指有三十年以上历史的二手衣物。';
    const plan = normalizeNoteSearchQueries(
      {
        topic: '古着',
        webQuery: '古着 词源 定义',
        imageQuery: '古着 vintage clothing',
      },
      note,
    );
    expect(plan?.webQuery).toContain('古着');
    expect(plan?.imageQuery).toMatch(/古着|vintage/i);
    expect(plan?.topic).toBe('古着');
  });

  it('falls back to a later body line when first line is a short title', () => {
    const note = '**词源与定义边界**\n\n古着指有三十年以上历史的二手衣物。';
    const plan = normalizeNoteSearchQueries(null, note);
    expect(plan?.webQuery).toMatch(/古着/);
  });
});

describe('deriveNoteSearchQueries', () => {
  beforeEach(() => {
    vi.mocked(callUniversalAI).mockReset();
  });

  it('uses model JSON when available', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        topic: '古着',
        webQuery: '古着 日本 定义',
        imageQuery: '古着 店铺',
      }),
    );
    const plan = await deriveNoteSearchQueries(
      '**词源与定义边界**\n\n古着指有三十年以上历史的二手衣物。',
      aiConfig,
      t,
    );
    expect(plan?.webQuery).toBe('古着 日本 定义');
    expect(plan?.imageQuery).toBe('古着 店铺');
  });

  it('passes linked card context into the user prompt', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        topic: '日本教师',
        webQuery: '日本 1980年代 教师 社会地位',
        imageQuery: '日本 80年代 教师',
      }),
    );
    await deriveNoteSearchQueries('80年代荣光\n教师被尊称为先生', aiConfig, t, {
      linkedContext: '误判婴儿潮埋雷\n1985年日本政府多招教师',
    });
    expect(callUniversalAI).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('日本政府'),
      }),
    );
    expect(callUniversalAI).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('80年代荣光'),
      }),
    );
  });

  it('enriches AI queries with place tokens from linked texts', async () => {
    vi.mocked(callUniversalAI).mockResolvedValueOnce(
      JSON.stringify({
        topic: '教师',
        webQuery: '80年代 教师 社会地位',
        imageQuery: '80年代 教师',
      }),
    );
    const plan = await deriveNoteSearchQueries('80年代荣光\n教师被尊称为先生', aiConfig, t, {
      linkedTexts: ['误判婴儿潮埋雷\n1985年日本政府多招教师'],
    });
    expect(plan?.webQuery).toMatch(/^日本/);
    expect(plan?.imageQuery).toMatch(/^日本/);
  });

  it('falls back when model fails', async () => {
    vi.mocked(callUniversalAI).mockRejectedValueOnce(new Error('network'));
    const plan = await deriveNoteSearchQueries(
      '**词源与定义边界**\n\n古着指有三十年以上历史的二手衣物。',
      aiConfig,
      t,
    );
    expect(plan?.webQuery).toMatch(/古着/);
  });
});
