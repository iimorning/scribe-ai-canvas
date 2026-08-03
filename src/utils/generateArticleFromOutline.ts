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

  // 仅保留大纲中出现的 cardId（用户删除的条目不写入 sourceCards）
  const outlineCardIds = new Set(outline.sections.map((s) => s.cardId).filter(Boolean));

  // 按 cards 顺序对齐 segments：以 cards 为准，匹配 cardId；缺失段补空；多余段忽略
  const segByCardId = new Map<string, string>();
  for (const seg of parsed.segments) {
    if (seg.cardId) segByCardId.set(seg.cardId, seg.text);
  }
  let sourceCards: SourceCardSegment[] | undefined;
  if (segByCardId.size > 0) {
    const eligibleCards = outlineCardIds.size > 0 ? cards.filter((c) => outlineCardIds.has(c.nodeId)) : cards;
    sourceCards = eligibleCards.map((c) => ({
      nodeId: c.nodeId,
      canvasId: c.canvasId,
      kind: c.kind,
      title: c.title,
      segmentText: segByCardId.get(c.nodeId) ?? '',
    }));
  }

  // 媒体兜底：把模型遗漏的媒体追加到对应卡片段（按 nodeId 匹配），否则追加到末尾段
  const missingMedia = mediaAssets.filter((asset) => {
    // 若大纲删掉了该媒体所属卡片，则不再兜底（用户已主动剔除）
    if (outlineCardIds.size > 0 && !outlineCardIds.has(asset.nodeId)) return false;
    const md = asset.articleMarkdown;
    const urls = [...md.matchAll(/\(([^)\s]+)\)/g)].map((m) => m[1]!);
    if (urls.length === 0) {
      const title = md.replace(/[*\[\]]/g, '').trim();
      return title.length > 0 && !parsed.body.includes(title);
    }
    return urls.some((u) => u && !parsed.body.includes(u));
  });

  let body = parsed.body;
  if (sourceCards && missingMedia.length > 0) {
    const relatedHeading = t('ai.publish_related_media');
    const heading = relatedHeading.replace(/\s+/g, ' ').trim() || 'Related media';
    for (const asset of missingMedia) {
      const idx = sourceCards.findIndex((sc) => sc.nodeId === asset.nodeId);
      const attach = `\n\n## ${heading}\n\n${asset.articleMarkdown}`;
      if (idx >= 0) {
        sourceCards[idx] = {
          ...sourceCards[idx],
          segmentText: `${sourceCards[idx].segmentText}${attach}`.trim(),
        };
      } else {
        const last = sourceCards.length - 1;
        if (last >= 0) {
          sourceCards[last] = {
            ...sourceCards[last],
            segmentText: `${sourceCards[last].segmentText}${attach}`.trim(),
          };
        }
      }
    }
    body = sourceCards.map((s) => s.segmentText).join('\n\n');
  } else {
    body = ensurePublishMediaInBody(parsed.body, mediaAssets, t('ai.publish_related_media'));
    if (sourceCards) {
      body = sourceCards.map((s) => s.segmentText).join('\n\n');
    }
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
