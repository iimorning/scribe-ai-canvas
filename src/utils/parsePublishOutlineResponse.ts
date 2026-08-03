import { parseLenientLlmJson } from './llmJson';

export interface PublishOutlineSection {
  /** 对齐来源卡片；用户新增的条目可为空字符串 */
  cardId: string;
  /** 该段小标题 */
  heading: string;
  /** 该段要写什么（一两句） */
  summary: string;
}

export interface PublishOutline {
  title: string;
  sections: PublishOutlineSection[];
}

/** 从模型输出解析大纲；失败时回退为按行拆分的单段大纲 */
export function parsePublishOutlineResponse(raw: string, fallbackTitle: string): PublishOutline | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  try {
    const data = parseLenientLlmJson(trimmed) as {
      title?: unknown;
      sections?: unknown;
    };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const sectionsRaw = Array.isArray(data.sections) ? data.sections : null;
      if (sectionsRaw) {
        const sections: PublishOutlineSection[] = [];
        for (const seg of sectionsRaw) {
          if (!seg || typeof seg !== 'object' || Array.isArray(seg)) continue;
          const s = seg as { cardId?: unknown; heading?: unknown; summary?: unknown };
          const cardId = typeof s.cardId === 'string' ? s.cardId.trim() : '';
          const heading = typeof s.heading === 'string' ? s.heading.trim() : '';
          const summary = typeof s.summary === 'string' ? s.summary.trim() : '';
          if (heading || summary) {
            sections.push({ cardId, heading, summary });
          }
        }
        if (sections.length > 0) {
          return { title: title || fallbackTitle, sections };
        }
      }
    }
  } catch {
    /* 非 JSON：走 Markdown 回退 */
  }

  // Markdown 回退：把首行 # 当标题，其余非空行当无标题条目
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  let title = fallbackTitle;
  let startIdx = 0;
  const h1 = lines.findIndex((l) => /^#(?!#)\s+/.test(l));
  if (h1 >= 0) {
    title = lines[h1].replace(/^#+\s+/, '').trim() || fallbackTitle;
    lines.splice(h1, 1);
  }
  const sections = lines
    .map((l) => l.replace(/^[-*+]\s+/, '').replace(/^#{2,}\s+/, '').trim())
    .filter(Boolean)
    .map((text) => ({ cardId: '', heading: text, summary: '' }));
  if (sections.length === 0) return null;
  return { title, sections };
}

/** 把大纲序列化成给 AI 看的紧凑文本（带 cardId 标注，便于修订时保持对齐） */
export function serializeOutlineForPrompt(outline: PublishOutline): string {
  const head = `# ${outline.title}`;
  const body = outline.sections
    .map((s, i) => {
      const card = s.cardId ? `【cardId:${s.cardId}】` : '';
      return `${card}${i + 1}. ${s.heading}${s.summary ? `\n   ${s.summary}` : ''}`;
    })
    .join('\n');
  return `${head}\n${body}`;
}
