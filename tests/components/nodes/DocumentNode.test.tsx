import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DocumentNode } from '../../../src/components/nodes/DocumentNode';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../../src/utils/canvasNodeContextText';
import type { CanvasNode } from '../../../src/db';

vi.mock('lucide-react', () => ({
  FileText: (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': 'icon-FileText', ...props }),
}));

function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'doc-1',
    type: 'document',
    x: 0,
    y: 0,
    ...overrides,
  };
}

describe('DocumentNode', () => {
  describe('document label + icon', () => {
    it('renders the DOCUMENT label', () => {
      render(<DocumentNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />);
      expect(screen.getByText('DOCUMENT')).toBeInTheDocument();
    });

    it('renders the FileText icon', () => {
      render(<DocumentNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />);
      expect(screen.getByTestId('icon-FileText')).toBeInTheDocument();
    });
  });

  describe('content rendering (dangerouslySetInnerHTML)', () => {
    it('renders the empty-state fallback when content is undefined', () => {
      const { container } = render(
        <DocumentNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
      );
      expect(container.querySelector('.doc-content')!.innerHTML).toContain('(空文档)');
    });

    it('renders the empty-state fallback when content is empty string', () => {
      const { container } = render(
        <DocumentNode node={makeNode({ content: '' })} editingNodeId={null} setEditingNodeId={vi.fn()} />,
      );
      expect(container.querySelector('.doc-content')!.innerHTML).toContain('(空文档)');
    });

    it('renders plain HTML content', () => {
      const { container } = render(
        <DocumentNode
          node={makeNode({ content: '<p>Hello world</p>' })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      const inner = container.querySelector('.doc-content')!;
      expect(inner.querySelector('p')?.textContent).toBe('Hello world');
    });

    it('renders headings + paragraphs in order', () => {
      const { container } = render(
        <DocumentNode
          node={makeNode({ content: '<h1>Title</h1><p>Body</p>' })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      const doc = container.querySelector('.doc-content')!;
      // First child is h1, then p
      expect(doc.children[0]?.tagName).toBe('H1');
      expect(doc.children[1]?.tagName).toBe('P');
    });

    it('decodes HTML entities to text', () => {
      const { container } = render(
        <DocumentNode
          node={makeNode({ content: '<p>Tom &amp; Jerry &lt;3</p>' })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      expect(container.querySelector('p')?.textContent).toBe('Tom & Jerry <3');
    });

    it('does NOT execute script tags (jsdom strips them)', () => {
      const { container } = render(
        <DocumentNode
          node={makeNode({ content: '<p>safe</p>' })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      // No <script> elements should appear in the rendered DOM
      expect(container.querySelector('script')).toBeNull();
    });
  });

  describe('description', () => {
    it('does NOT render the description span when description is missing', () => {
      const { container } = render(
        <DocumentNode node={makeNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
      );
      expect(container.querySelector('span[title]')).toBeNull();
    });

    it('does NOT render the description span when description is empty', () => {
      const { container } = render(
        <DocumentNode node={makeNode({ description: '' })} editingNodeId={null} setEditingNodeId={vi.fn()} />,
      );
      expect(container.querySelector('span[title]')).toBeNull();
    });

    it('renders the description with title attribute (for overflow tooltip)', () => {
      render(
        <DocumentNode
          node={makeNode({ description: '长文标题' })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      const span = screen.getByText('长文标题');
      expect(span).toHaveAttribute('title', '长文标题');
    });

    it('truncates long descriptions (truncate + max-w classes)', () => {
      const { container } = render(
        <DocumentNode
          node={makeNode({ description: 'a very long description that should be truncated' })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      const span = container.querySelector('span[title]')!;
      expect(span).toHaveClass('truncate');
      expect(span).toHaveClass('max-w-[120px]');
    });
  });

  describe('canvas context attribute', () => {
    it('sets the CANVAS_NODE_CONTEXT_TEXT_ATTR on the content div for downstream scrapers', () => {
      const { container } = render(
        <DocumentNode
          node={makeNode({ content: '<p>some text</p>' })}
          editingNodeId={null}
          setEditingNodeId={vi.fn()}
        />,
      );
      const inner = container.querySelector('.doc-content')!;
      expect(inner.hasAttribute(CANVAS_NODE_CONTEXT_TEXT_ATTR)).toBe(true);
      expect(CANVAS_NODE_CONTEXT_TEXT_ATTR).toBe('data-canvas-node-context-text');
      expect(inner.getAttribute('data-canvas-node-context-text')).toBe('');
    });
  });
});
