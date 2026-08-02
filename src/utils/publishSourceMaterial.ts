import type { CanvasNode } from '../db';

/** Keep huge data-URLs out of the LLM prompt; still inject them into the final article. */
const MAX_PROMPT_MEDIA_URL_CHARS = 2_000;

export interface PublishMediaAsset {
  nodeId: string;
  /** Markdown that must appear in the finished article */
  articleMarkdown: string;
  /** Shorter / placeholder form for the model prompt when the real URL is huge */
  promptMarkdown: string;
}

function asHttpUrl(raw: string | undefined): string {
  const s = (raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function escapeMdAlt(s: string): string {
  return s.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/** Build markdown for a selected image/video node to embed in a long-form article. */
export function mediaMarkdownFromNode(node: CanvasNode): PublishMediaAsset | null {
  if (node.type === 'image') {
    const src = (node.content || '').trim();
    if (!src) return null;
    if (!/^https?:\/\//i.test(src) && !src.startsWith('data:image/')) return null;
    const alt = escapeMdAlt(node.description || 'Image') || 'Image';
    const articleMarkdown = `![${alt}](${src})`;
    const source = asHttpUrl(node.sourceUrl);
    const withSource =
      source && source !== src ? `${articleMarkdown}\n\n[${source}](${source})` : articleMarkdown;
    const promptMarkdown =
      src.length > MAX_PROMPT_MEDIA_URL_CHARS
        ? `![${alt}](media://image/${node.id})`
        : withSource;
    return { nodeId: node.id, articleMarkdown: withSource, promptMarkdown };
  }

  if (node.type === 'video') {
    const page = asHttpUrl(node.sourceUrl) || asHttpUrl(node.content) || (node.content || '').trim();
    if (!page && !(node.content || '').startsWith('data:video/')) return null;
    const title = escapeMdAlt(node.description || 'Video') || 'Video';
    const href = asHttpUrl(node.sourceUrl) || asHttpUrl(node.content) || page;
    if (!href && (node.content || '').startsWith('data:video/')) {
      // Local uploaded video: keep as a named placeholder link is useless; skip data:video in md
      const articleMarkdown = `*[${title}]*`;
      return {
        nodeId: node.id,
        articleMarkdown,
        promptMarkdown: `[Video: ${title}] (local upload — mention in prose; no public URL)`,
      };
    }
    if (!href) return null;
    const articleMarkdown = `[▶ ${title}](${href})`;
    return { nodeId: node.id, articleMarkdown, promptMarkdown: articleMarkdown };
  }

  return null;
}

export interface PublishSourceMaterial {
  /** Text + media descriptors sent to the model */
  promptContent: string;
  /** Canonical media markdown to guarantee in the final article */
  mediaAssets: PublishMediaAsset[];
}

/**
 * Assemble publish source material from selected canvas nodes.
 * Text/note/theme/ai → DOM or node text; image/video → markdown media blocks.
 */
export function buildPublishSourceMaterial(
  selectedIds: string[],
  nodes: CanvasNode[],
  getText: (nodeId: string) => string,
): PublishSourceMaterial {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const textParts: string[] = [];
  const mediaAssets: PublishMediaAsset[] = [];

  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) {
      const t = getText(id).trim();
      if (t) textParts.push(t);
      continue;
    }

    const media = mediaMarkdownFromNode(node);
    if (media) {
      mediaAssets.push(media);
      textParts.push(`Media asset (include this markdown in the article body):\n${media.promptMarkdown}`);
      continue;
    }

    const fromDom = getText(id).trim();
    const fromNode = (node.content || '').trim();
    const chunk = fromDom || fromNode;
    if (chunk) textParts.push(chunk);
  }

  return {
    promptContent: textParts.join('\n\n'),
    mediaAssets,
  };
}

/** If the model omitted any selected media URLs, append them under a section heading. */
export function ensurePublishMediaInBody(
  body: string,
  mediaAssets: PublishMediaAsset[],
  relatedHeading: string,
): string {
  if (mediaAssets.length === 0) return body;
  const missing = mediaAssets.filter((asset) => {
    const urls = [...asset.articleMarkdown.matchAll(/\(([^)\s]+)\)/g)].map((m) => m[1]!);
    if (urls.length === 0) {
      // Local / prose-only assets: treat as present if title fragment appears
      const title = asset.articleMarkdown.replace(/[*\[\]]/g, '').trim();
      return title.length > 0 && !body.includes(title);
    }
    return urls.some((u) => u && !body.includes(u));
  });
  if (missing.length === 0) return body;
  const block = missing.map((m) => m.articleMarkdown).join('\n\n');
  const heading = relatedHeading.replace(/\s+/g, ' ').trim() || 'Related media';
  return `${body.trim()}\n\n## ${heading}\n\n${block}\n`;
}
