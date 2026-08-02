import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeNoteSearchQueries, deriveNoteSearchQueries } from '../../src/services/deriveNoteSearchQueries';
import { callUniversalAI } from '../../src/services/ai';
import type { AIConfig } from '../../src/components/AISettingsModal';

vi.mock('../../src/services/ai', () => ({
  callUniversalAI: vi.fn(),
}));

const t = ((key: string, opts?: Record<string, string>) => {
  if (key === 'ai.prompts.noteSearchQueryUser') return `NOTE:${opts?.note ?? ''}`;
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
