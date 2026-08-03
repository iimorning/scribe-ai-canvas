import type { Article, SourceCardSegment } from '../db';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from '../services/ai';
import { getLocaleDirective, combineSystemParts } from '../utils/aiI18n';
import { parsePublishArticleResponse } from './parsePublishArticleResponse';
import {
  ensurePublishMediaInBody,
  type PublishMediaAsset,
  type PublishSourceCardMeta,
} from './publishSourceMaterial';
import { serializeOutlineForPrompt, type PublishOutline } from './parsePublishOutlineResponse';

export interface GenerateArticleFromOutlineParams {
  aiConfig: AIConfig;
  outline: PublishOutline;
  /** 来自 buildPublishSourceMaterial 的素材 */
  promptContent: string;
  mediaAssets: PublishMediaAsset[];
  cards: PublishSourceCardMeta[];
  activeCanvasId: string;
  /** i18n 的 t 函数；用于取 prompt 模板与媒体兜底标题 */
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** 可选流式回调（用于 UI 显示生成进度） */
  onStreamChunk?: (accumulatedText: string) => void;
}

/**
 * 按定稿大纲 + 原素材生成正文，落库为新 Article，返回新文章对象。
 * 抽自原 useAiActions.handlePublish 的后半段，保持 segments 对齐与媒体兜底逻辑不变。
 */
export async function generateArticleFromOutline({
  aiConfig,
  outline,
  promptContent,
  mediaAssets,
  cards,
  activeCanvasId,
  t,
  onStreamChunk,
}: GenerateArticleFromOutlineParams): Promise<Article> {
  const outlineText = serializeOutlineForPrompt(outline);
  const text = await callUniversalAI({
    config: aiConfig,
    systemInstruction: getLocaleDirective(),
    prompt: t('ai.prompts.publishArticleFromOutline', {
      outline: outlineText,
      content: promptContent,
    }),
    onStreamChunk,
  });

  const parsed = parsePublishArticleResponse(text || '', t('ai.generated_article_title'));

  // 大纲中仍绑定来源卡的 cardId（按大纲顺序去重）。用户删段或清空 cardId 的不进侧栏。
  const outlineOrderedCardIds: string[] = [];
  const outlineCardIds = new Set<string>();
  for (const s of outline.sections) {
    const id = (s.cardId || '').trim();
    if (!id || outlineCardIds.has(id)) continue;
    outlineCardIds.add(id);
    outlineOrderedCardIds.push(id);
  }

  const cardById = new Map(cards.map((c) => [c.nodeId, c]));
  const eligibleCards = outlineOrderedCardIds
    .map((id) => cardById.get(id))
    .filter((c): c is PublishSourceCardMeta => c != null);

  const segByCardId = new Map<string, string>();
  for (const seg of parsed.segments) {
    if (seg.cardId) segByCardId.set(seg.cardId, seg.text);
  }

  // 模型未带回 cardId 时，按段顺序与大纲卡一一对应（常见于漏字段但仍按序输出）
  const orderedSegTexts: string[] = [];
  if (segByCardId.size === 0 && parsed.segments.length === eligibleCards.length) {
    for (let i = 0; i < parsed.segments.length; i++) {
      orderedSegTexts[i] = parsed.segments[i]?.text ?? '';
    }
  }

  // 只要大纲仍挂着来源卡，就写 sourceCards，保证 Reference 侧栏「关联画布」出现。
  // 不再要求模型 segments 必须带 cardId（否则 {title,body} 回退会把侧栏弄没）。
  let sourceCards: SourceCardSegment[] | undefined;
  if (eligibleCards.length > 0) {
    sourceCards = eligibleCards.map((c, i) => ({
      nodeId: c.nodeId,
      canvasId: c.canvasId,
      kind: c.kind,
      title: c.title,
      segmentText: segByCardId.get(c.nodeId) ?? orderedSegTexts[i] ?? '',
    }));
    const hasAnySegment = sourceCards.some((s) => s.segmentText.trim());
    if (!hasAnySegment && parsed.body.trim()) {
      // 整篇 body 回退：挂到第一张卡，侧栏卡片列表仍保留
      sourceCards[0] = { ...sourceCards[0], segmentText: parsed.body.trim() };
    }
  }

  // 媒体兜底：把模型遗漏的媒体追加到对应卡片段（按 nodeId 匹配），否则追加到末尾段
  const missingMedia = mediaAssets.filter((asset) => {
    // 若大纲明确删掉了该媒体所属卡片，则不再兜底（用户已主动剔除）
    if (outlineCardIds.size > 0 && !outlineCardIds.has(asset.nodeId)) return false;
    const md = asset.articleMarkdown;
    const urls = [...md.matchAll(/\(([^)\s]+)\)/g)].map((m) => m[1]!);
    if (urls.length === 0) {
      const title = md.replace(/[*\[\]]/g, '').trim();
      return title.length > 0 && !parsed.body.includes(title);
    }
    return urls.some((u) => u && !parsed.body.includes(u));
  });

  const relatedHeading = t('ai.publish_related_media').replace(/\s+/g, ' ').trim() || 'Related media';

  let body: string;
  if (sourceCards) {
    // sourceCards 链路：把 missingMedia 追加到对应段或末段，再按段拼成正文
    for (const asset of missingMedia) {
      const attach = `\n\n## ${relatedHeading}\n\n${asset.articleMarkdown}`;
      const idx = sourceCards.findIndex((sc) => sc.nodeId === asset.nodeId);
      const targetIdx = idx >= 0 ? idx : sourceCards.length - 1;
      if (targetIdx >= 0) {
        sourceCards[targetIdx] = {
          ...sourceCards[targetIdx],
          segmentText: `${sourceCards[targetIdx].segmentText}${attach}`.trim(),
        };
      }
    }
    body = sourceCards
      .map((s) => s.segmentText.trim())
      .filter(Boolean)
      .join('\n\n');
  } else {
    // 非 sourceCards 链路：用 ensurePublishMediaInBody 把遗漏媒体补到正文末尾
    body = ensurePublishMediaInBody(parsed.body, mediaAssets, relatedHeading);
  }

  const newArticle: Article = {
    id: `gen-${Date.now()}`,
    title: outline.title || parsed.title,
    content: body,
    date: new Date().getFullYear().toString(),
    type: 'GEN-' + Math.floor(Math.random() * 1000),
    tags: [],
    linkedCanvasIds: [activeCanvasId],
    author: '',
    ...(sourceCards ? { sourceCards } : {}),
  };

  return newArticle;
}

/** 生成大纲（弹窗进入时调用） */
export async function generatePublishOutline({
  aiConfig,
  promptContent,
  fallbackTitle,
  t,
  onStreamChunk,
}: {
  aiConfig: AIConfig;
  promptContent: string;
  fallbackTitle: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onStreamChunk?: (accumulatedText: string) => void;
}) {
  const text = await callUniversalAI({
    config: aiConfig,
    systemInstruction: combineSystemParts(
      t('ai.prompts.publishOutlineSystem'),
      getLocaleDirective(),
    ),
    prompt: t('ai.prompts.publishOutline', { content: promptContent }),
    onStreamChunk,
  });
  const { parsePublishOutlineResponse } = await import('./parsePublishOutlineResponse');
  return parsePublishOutlineResponse(text || '', fallbackTitle);
}

/** 按用户文字/语音指令修订大纲 */
export async function revisePublishOutline({
  aiConfig,
  outline,
  instruction,
  t,
  onStreamChunk,
}: {
  aiConfig: AIConfig;
  outline: PublishOutline;
  instruction: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onStreamChunk?: (accumulatedText: string) => void;
}) {
  const outlineText = serializeOutlineForPrompt(outline);
  const text = await callUniversalAI({
    config: aiConfig,
    systemInstruction: combineSystemParts(
      t('ai.prompts.publishOutlineSystem'),
      getLocaleDirective(),
    ),
    prompt: t('ai.prompts.publishOutlineRevise', {
      outline: outlineText,
      instruction,
    }),
    onStreamChunk,
  });
  const { parsePublishOutlineResponse } = await import('./parsePublishOutlineResponse');
  return parsePublishOutlineResponse(text || '', outline.title);
}
