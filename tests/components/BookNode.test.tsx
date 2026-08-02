import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BookNode } from '../../src/components/nodes/BookNode';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { db, type CanvasNode } from '../../src/db';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'nodes.book_page') return `${opts?.current} / ${opts?.total}`;
      return key;
    },
  }),
}));

vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    BookOpen: icon('BookOpen'),
    ChevronLeft: icon('ChevronLeft'),
    ChevronRight: icon('ChevronRight'),
    Sparkles: icon('Sparkles'),
    GitBranch: icon('GitBranch'),
    Loader2: icon('Loader2'),
  };
});

function makeBookNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'b1',
    type: 'book',
    x: 0,
    y: 0,
    description: 'demo.epub',
    fileType: 'epub',
    content: encodeBookContent({
      format: 'epub',
      title: 'Demo',
      units: [
        { title: 'Ch1', text: 'First unit text' },
        { title: 'Ch2', text: 'Second unit text' },
      ],
    }),
    ...overrides,
  };
}

describe('BookNode', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.nodes.add(makeBookNode());
  });

  it('restores persisted page index', () => {
    const { getByText, queryByText } = render(
      <BookNode
        node={makeBookNode({ bookPageIndex: 1 })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(queryByText('First unit text')).not.toBeInTheDocument();
    expect(getByText('Second unit text')).toBeInTheDocument();
  });

  it('persists page index when navigating', async () => {
    const { getByLabelText } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    fireEvent.click(getByLabelText('nodes.book_next'));
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(1);
    });
  });

  it('marks current unit as AI context text', () => {
    const { container } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    expect(container.querySelector('[data-canvas-node-context-text]')).toHaveTextContent('First unit text');
  });
});
