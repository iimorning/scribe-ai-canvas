import { parseLenientLlmJson } from './llmJson';

export interface ParsedPublishSegment {
  cardId: string;
  text: string;
}

export interface ParsedPublishArticle {
  title: string;
  body: string;
  /** 按卡片分段的正文；旧模型只返回 {title,body} 时回退为单段（cardId 为空） */
  segments: ParsedPublishSegment[];
}

/** 从合成长文模型输出解析标题与分段 Markdown 正文；失败时回退为整段正文 + 默认标题 */
export function parsePublishArticleResponse(raw: string, fallbackTitle: string): ParsedPublishArticle {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { title: fallbackTitle, body: '', segments: [] };

  try {
    const data = parseLenientLlmJson(trimmed) as {
      title?: unknown;
      body?: unknown;
      segments?: unknown;
    };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const segmentsRaw = Array.isArray(data.segments) ? data.segments : null;

      if (segmentsRaw) {
        const segments: ParsedPublishSegment[] = [];
        for (const seg of segmentsRaw) {
          if (!seg || typeof seg !== 'object' || Array.isArray(seg)) continue;
          const s = seg as { cardId?: unknown; text?: unknown };
          const cardId = typeof s.cardId === 'string' ? s.cardId.trim() : '';
          const text = typeof s.text === 'string' ? s.text.trim() : '';
          segments.push({ cardId, text });
        }
        if (segments.length > 0) {
          const body = segments.map((s) => s.text).join('\n\n');
          return { title: title || fallbackTitle, body, segments };
        }
      }

      // 旧格式 {title, body}
      const body = typeof data.body === 'string' ? data.body.trim() : '';
      if (title && body) return { title, body, segments: [{ cardId: '', text: body }] };
      if (body) return { title: title || fallbackTitle, body, segments: [{ cardId: '', text: body }] };
    }
  } catch {
    /* 非 JSON：走 Markdown 标题回退 */
  }

  const lines = trimmed.split('\n');
  const h1Idx = lines.findIndex((l) => /^#(?!#)\s+/.test(l.trim()));
  if (h1Idx >= 0) {
    const title = lines[h1Idx].trim().replace(/^#+\s+/, '').trim();
    const body = [...lines.slice(0, h1Idx), ...lines.slice(h1Idx + 1)].join('\n').trim();
    return {
      title: title || fallbackTitle,
      body: body || trimmed,
      segments: [{ cardId: '', text: body || trimmed }],
    };
  }

  return {
    title: fallbackTitle,
    body: trimmed,
    segments: [{ cardId: '', text: trimmed }],
  };
}
