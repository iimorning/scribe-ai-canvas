import { describe, it, expect } from 'vitest';
import { bilibiliEmbedUrl, resolveMediaPlayback, youtubeEmbedUrl } from '../../src/utils/mediaEmbed';

describe('mediaEmbed', () => {
  it('resolves YouTube watch URLs to embed', () => {
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
    );
    expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
    );
  });

  it('resolves Bilibili BV pages to player embed', () => {
    expect(bilibiliEmbedUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toContain(
      'bvid=BV1xx411c7mD',
    );
  });

  it('prefers podcast audioUrl for in-card audio', () => {
    expect(
      resolveMediaPlayback({
        kind: 'podcast',
        link: 'https://www.xiaoyuzhoufm.com/episode/1',
        audioUrl: 'https://cdn.example/ep.mp3',
      }),
    ).toEqual({ mode: 'audio', src: 'https://cdn.example/ep.mp3' });
  });

  it('falls back to none when podcast has only a closed page link', () => {
    expect(
      resolveMediaPlayback({
        kind: 'podcast',
        link: 'https://www.xiaoyuzhoufm.com/episode/1',
      }),
    ).toEqual({ mode: 'none' });
  });
});
