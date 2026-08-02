import { describe, it, expect } from 'vitest';
import type { CanvasNode } from '../../src/db';
import {
  buildPublishSourceMaterial,
  ensurePublishMediaInBody,
  mediaMarkdownFromNode,
} from '../../src/utils/publishSourceMaterial';

const base = { x: 0, y: 0, canvasId: 'c1' };

describe('mediaMarkdownFromNode', () => {
  it('builds image markdown with optional source link', () => {
    const node = {
      ...base,
      id: 'img1',
      type: 'image',
      content: 'https://cdn.example/a.jpg',
      description: 'Vintage dress',
      sourceUrl: 'https://page.example/a',
    } satisfies CanvasNode;
    const asset = mediaMarkdownFromNode(node);
    expect(asset?.articleMarkdown).toContain('![Vintage dress](https://cdn.example/a.jpg)');
    expect(asset?.articleMarkdown).toContain('https://page.example/a');
  });

  it('builds video link markdown from sourceUrl', () => {
    const node = {
      ...base,
      id: 'v1',
      type: 'video',
      content: 'https://www.youtube.com/embed/abc',
      description: 'Haul · Style',
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
      fileType: 'iframe',
    } satisfies CanvasNode;
    expect(mediaMarkdownFromNode(node)?.articleMarkdown).toBe(
      '[▶ Haul · Style](https://www.youtube.com/watch?v=abc)',
    );
  });
});

describe('buildPublishSourceMaterial', () => {
  it('mixes note text with media blocks', () => {
    const nodes: CanvasNode[] = [
      { ...base, id: 'n1', type: 'note', content: 'note body' },
      {
        ...base,
        id: 'img1',
        type: 'image',
        content: 'https://cdn.example/a.jpg',
        description: 'Pic',
      },
    ];
    const material = buildPublishSourceMaterial(['n1', 'img1'], nodes, (id) =>
      id === 'n1' ? 'note body from dom' : '',
    );
    expect(material.promptContent).toContain('note body from dom');
    expect(material.promptContent).toContain('![Pic](https://cdn.example/a.jpg)');
    expect(material.mediaAssets).toHaveLength(1);
  });
});

describe('ensurePublishMediaInBody', () => {
  it('appends missing media under related heading', () => {
    const body = ensurePublishMediaInBody(
      'Hello world.',
      [
        {
          nodeId: 'img1',
          articleMarkdown: '![Pic](https://cdn.example/a.jpg)',
          promptMarkdown: '![Pic](https://cdn.example/a.jpg)',
        },
      ],
      '相关媒体',
    );
    expect(body).toContain('Hello world.');
    expect(body).toContain('## 相关媒体');
    expect(body).toContain('![Pic](https://cdn.example/a.jpg)');
  });

  it('does not duplicate media already present', () => {
    const md = '![Pic](https://cdn.example/a.jpg)';
    const body = ensurePublishMediaInBody(`Intro\n\n${md}\n`, [
      { nodeId: 'img1', articleMarkdown: md, promptMarkdown: md },
    ], 'Related media');
    expect(body.match(/cdn\.example\/a\.jpg/g)).toHaveLength(1);
  });
});
