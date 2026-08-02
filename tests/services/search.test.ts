import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  metasoSearch,
  buildSearchContext,
  resolveMetasoImageUrl,
  normalizeMetasoSearchResponse,
} from '../../src/services/search';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('metasoSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSearchContext', () => {
    it('empty webpages returns empty string', () => {
      const result = buildSearchContext({ credits: 0, total: 0, webpages: [] });
      expect(result).toBe('');
    });

    it('formats webpages into context block', () => {
      const result = buildSearchContext({
        credits: 1,
        total: 2,
        webpages: [
          { title: 'Article A', link: 'https://a.com', snippet: 'Snippet A', score: 'high', date: '2026-01-01' },
          { title: 'Article B', link: 'https://b.com', snippet: 'Snippet B', score: 'medium', date: '2026-02-01' },
        ],
      });
      expect(result).toContain('[Source 1: Article A](https://a.com)');
      expect(result).toContain('Snippet A');
      expect(result).toContain('[Source 2: Article B](https://b.com)');
      expect(result).toContain('Snippet B');
      expect(result).toContain('--- Web search results ---');
      expect(result).toContain('--- End of search results ---');
    });

    it('handles missing webpages array gracefully', () => {
      const result = buildSearchContext({ credits: 0, total: 0 } as any);
      expect(result).toBe('');
    });

    it('formats image results into context block', () => {
      const result = buildSearchContext({
        credits: 1,
        total: 1,
        webpages: [],
        images: [{ title: 'Mt Fuji', link: 'https://page.example/fuji', thumbnail: 'https://cdn.example/fuji.jpg' }],
      });
      expect(result).toContain('[Image 1: Mt Fuji](https://cdn.example/fuji.jpg)');
      expect(result).toContain('Page: https://page.example/fuji');
    });
  });

  describe('resolveMetasoImageUrl', () => {
    it('prefers Metaso imageUrl over thumbnail/link', () => {
      expect(
        resolveMetasoImageUrl({
          imageUrl: 'https://cdn.example/real.jpg',
          thumbnail: 'https://cdn.example/thumb.jpg',
          link: 'https://page.example',
        }),
      ).toBe('https://cdn.example/real.jpg');
    });

    it('prefers thumbnail over bare page link', () => {
      expect(
        resolveMetasoImageUrl({
          link: 'https://page.example',
          thumbnail: 'https://cdn.example/a.jpg',
        }),
      ).toBe('https://cdn.example/a.jpg');
    });
  });

  describe('normalizeMetasoSearchResponse', () => {
    it('maps imageUrl / sourceUrl from Metaso image payloads', () => {
      const normalized = normalizeMetasoSearchResponse({
        credits: 1,
        total: 1,
        images: [
          {
            title: '古着',
            imageUrl: 'https://img.example/vintage.jpg',
            sourceUrl: 'https://page.example/article',
          },
        ],
      });
      expect(normalized.images).toHaveLength(1);
      expect(resolveMetasoImageUrl(normalized.images![0]!)).toBe('https://img.example/vintage.jpg');
      expect(normalized.images![0]!.link).toBe('https://page.example/article');
    });
  });

  describe('metasoSearch - browser path', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('throws on empty API key', async () => {
      await expect(
        metasoSearch('test query', { apiKey: '' })
      ).rejects.toThrow('Metaso API key is empty');
    });

    it('throws on whitespace-only API key', async () => {
      await expect(
        metasoSearch('test query', { apiKey: '   ' })
      ).rejects.toThrow('Metaso API key is empty');
    });

    it('calls Vite proxy endpoint with correct params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          credits: 1,
          total: 1,
          webpages: [{ title: 'Test', link: 'https://test.com', snippet: 'Hello', score: 'high', date: '2026-01-01' }],
        }),
      });

      const result = await metasoSearch('AI research', { apiKey: 'sk-metaso-test' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/metaso/api/v1/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-metaso-test',
          }),
          body: JSON.stringify({ q: 'AI research', scope: 'webpage', size: 5 }),
        })
      );
      expect(result.webpages).toHaveLength(1);
      expect(result.webpages[0].title).toBe('Test');
    });

    it('calls proxy with image scope when requested', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          credits: 1,
          total: 1,
          images: [{ title: 'Cat', link: 'https://img.example/cat.jpg', thumbnail: 'https://img.example/cat-t.jpg' }],
        }),
      });

      const result = await metasoSearch('cat', { apiKey: 'sk-metaso-test', scope: 'image', size: 8 });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/metaso/api/v1/search',
        expect.objectContaining({
          body: JSON.stringify({ q: 'cat', scope: 'image', size: 8 }),
        }),
      );
      expect(result.images).toHaveLength(1);
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(
        metasoSearch('test', { apiKey: 'bad-key' })
      ).rejects.toThrow('Metaso search HTTP 401');
    });
  });
});
