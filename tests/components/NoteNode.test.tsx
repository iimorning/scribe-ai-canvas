import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { NoteNode } from '../../src/components/nodes/NoteNode';
import { db } from '../../src/db';
import type { CanvasNode } from '../../src/db';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../../src/db', () => ({
  db: {
    nodes: { update: vi.fn() },
  },
}));

vi.mock('../../src/config/persistence', () => ({
  isContentBlurPersistenceDisabled: () => false,
}));

vi.mock('lucide-react', () => {
  const iconNames = [
    'MessageSquare', 'Terminal', 'Network', 'Search', 'Bell', 'Settings', 'Plus',
    'BookOpen', 'Users', 'Library', 'Microscope', 'Sparkles', 'Maximize2', 'Minimize2',
    'Quote', 'Brain', 'Bot', 'Coffee', 'Wand2', 'Send', 'SlidersHorizontal', 'History', 'ZoomIn',
    'Focus', 'Image', 'FilePlus', 'Trash2', 'Link2', 'X', 'Camera', 'ChevronLeft',
    'ChevronRight', 'Check', 'Cpu', 'ArrowRight', 'ListChecks', 'CheckCircle2',
    'Loader2', 'PenLine', 'Edit3', 'FileText', 'Play',
  ];
  const icons: Record<string, React.FC> = {};
  for (const name of iconNames) {
    icons[name] = (props: Record<string, unknown>) => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}`, ...props });
    };
  }
  return icons;
});

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement } = require('react');
    return createElement('div', { 'data-testid': 'markdown' }, children);
  },
}));

const makeNode = (overrides?: Partial<CanvasNode>): CanvasNode => ({
  id: 'n1',
  canvasId: 'c1',
  type: 'note',
  content: 'Test content',
  x: 0,
  y: 0,
  ...overrides,
});

describe('NoteNode', () => {
  beforeEach(() => {
    vi.mocked(db.nodes.update).mockClear();
  });

  it.each([0, 1, 2, 3, 4] as const)('layout %i 渲染 Markdown 正文', (layout) => {
    render(<NoteNode node={makeNode({ layout })} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
  });

  it('layout 1 显示毛玻璃标题文案键', () => {
    render(<NoteNode node={makeNode({ layout: 1 })} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    expect(screen.getByText('nodes.thought_node')).toBeInTheDocument();
  });

  it('layout 4 显示票根结构与条码区', () => {
    const { container } = render(
      <NoteNode node={makeNode({ layout: 4 })} editingNodeId={null} setEditingNodeId={vi.fn()} />
    );
    expect(screen.getByText('nodes.receipt_title')).toBeInTheDocument();
    expect(screen.getByText(/nodes.receipt_date/)).toBeInTheDocument();
    expect(container.querySelector('.receipt-barcode')).toBeTruthy();
    expect(container.querySelector('.receipt-jagged-top')).toBeTruthy();
    expect(container.querySelector('.receipt-jagged-bottom')).toBeTruthy();
    expect(container.querySelector('.note-surface-receipt')).toBeTruthy();
  });

  it('调色板 CSS 变量存在时 layout 1 保留毛玻璃表面类名', () => {
    const { container } = render(
      <div
        style={
          {
            '--node-bg': '#1a1a1a',
            '--node-text': '#ffffff',
            '--node-border': '#333333',
          } as React.CSSProperties
        }
      >
        <NoteNode node={makeNode({ layout: 1 })} editingNodeId={null} setEditingNodeId={vi.fn()} />
      </div>
    );
    expect(container.querySelector('.note-surface-glass')).toBeTruthy();
    expect(container.querySelector('.note-glass-wash')).toBeTruthy();
  });

  it('layout 0/3 不显示笔记类型标签，正文从顶部起排', () => {
    const { rerender } = render(
      <NoteNode node={makeNode({ layout: 0 })} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    expect(screen.queryByText('nodes.note')).not.toBeInTheDocument();
    expect(screen.queryByText('nodes.observation')).not.toBeInTheDocument();
    rerender(<NoteNode node={makeNode({ layout: 3 })} editingNodeId={null} setEditingNodeId={vi.fn()} />);
    expect(screen.queryByText('nodes.note')).not.toBeInTheDocument();
    expect(screen.queryByText('nodes.observation')).not.toBeInTheDocument();
  });

  it('连续 rerender 切换 layout 时 Markdown 正文仍可见（NoteBody 稳定）', () => {
    const setEditing = vi.fn();
    const { rerender } = render(
      <NoteNode node={makeNode({ layout: 0 })} editingNodeId={null} setEditingNodeId={setEditing} />,
    );
    expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
    rerender(<NoteNode node={makeNode({ layout: 1 })} editingNodeId={null} setEditingNodeId={setEditing} />);
    expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
    rerender(<NoteNode node={makeNode({ layout: 3 })} editingNodeId={null} setEditingNodeId={setEditing} />);
    expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
  });

  it('非法 layout（非 4）走合并壳：仍渲染笔记 Markdown，不出现票根', () => {
    const { container } = render(
      <NoteNode
        node={makeNode({ layout: 99 as unknown as number })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(screen.getByTestId('markdown')).toHaveTextContent('Test content');
    expect(container.querySelector('.receipt-barcode')).toBeFalsy();
    expect(container.querySelector('.note-surface-receipt')).toBeFalsy();
  });

  it('editingNodeId 匹配时出现 contentEditable 且内容为 node.content', () => {
    render(<NoteNode node={makeNode({ layout: 0 })} editingNodeId="n1" setEditingNodeId={vi.fn()} />);
    const el = document.querySelector('[contenteditable="true"]');
    expect(el).toBeTruthy();
    expect(el).toHaveTextContent('Test content');
  });

  it('失焦且允许持久化时调用 db.nodes.update 并退出编辑', () => {
    const setEditing = vi.fn();
    render(<NoteNode node={makeNode({ layout: 0 })} editingNodeId="n1" setEditingNodeId={setEditing} />);
    const el = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(el).toBeTruthy();
    el.innerText = 'Updated body';
    fireEvent.blur(el);
    expect(db.nodes.update).toHaveBeenCalledWith('n1', { content: 'Updated body' });
    expect(setEditing).toHaveBeenCalledWith(null);
  });
});
