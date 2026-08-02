export type MediaPlaybackMode = 'iframe' | 'video' | 'audio';

export type MediaPlayback =
  | { mode: MediaPlaybackMode; src: string }
  | { mode: 'none' };

function asHttpUrl(raw: string | undefined): string {
  const s = (raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function looksLikeDirectVideo(url: string): boolean {
  const path = url.split('?')[0]?.split('#')[0] ?? url;
  return /\.(mp4|webm|ogg|mov|m4v)(\b|$)/i.test(path);
}

function looksLikeDirectAudio(url: string): boolean {
  const path = url.split('?')[0]?.split('#')[0] ?? url;
  return /\.(mp3|m4a|aac|wav|ogg|opus|flac)(\b|$)/i.test(path);
}

/** YouTube watch / youtu.be / shorts → embed URL */
export function youtubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') {
      id = u.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname.startsWith('/embed/')) {
        return `https://www.youtube.com/embed/${u.pathname.split('/')[2] || ''}?rel=0`;
      }
      if (u.pathname.startsWith('/shorts/')) {
        id = u.pathname.split('/')[2] || '';
      } else {
        id = u.searchParams.get('v') || '';
      }
    }
    if (!id || !/^[\w-]{6,}$/.test(id)) return null;
    return `https://www.youtube.com/embed/${id}?rel=0`;
  } catch {
    return null;
  }
}

/** Bilibili BV / av page → player embed */
export function bilibiliEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (!host.endsWith('bilibili.com')) return null;
    const bv = u.pathname.match(/\/video\/(BV[\w]+)/i)?.[1];
    if (bv) {
      return `https://player.bilibili.com/player.html?bvid=${bv}&autoplay=0&high_quality=1`;
    }
    const aid = u.pathname.match(/\/video\/av(\d+)/i)?.[1] || u.searchParams.get('aid');
    if (aid) {
      return `https://player.bilibili.com/player.html?aid=${aid}&autoplay=0&high_quality=1`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pick the best in-card playback strategy for a Metaso video/podcast hit.
 * Page links on closed platforms fall back to `none` (open externally).
 */
export function resolveMediaPlayback(input: {
  kind: 'video' | 'podcast';
  link?: string;
  audioUrl?: string;
}): MediaPlayback {
  const page = asHttpUrl(input.link);
  const audio = asHttpUrl(input.audioUrl);

  if (input.kind === 'podcast') {
    if (audio) return { mode: 'audio', src: audio };
    if (page && looksLikeDirectAudio(page)) return { mode: 'audio', src: page };
    return { mode: 'none' };
  }

  // video
  if (page) {
    const yt = youtubeEmbedUrl(page);
    if (yt) return { mode: 'iframe', src: yt };
    const bili = bilibiliEmbedUrl(page);
    if (bili) return { mode: 'iframe', src: bili };
    if (looksLikeDirectVideo(page)) return { mode: 'video', src: page };
  }
  if (audio && looksLikeDirectVideo(audio)) return { mode: 'video', src: audio };
  return { mode: 'none' };
}
