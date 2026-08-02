import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { DraggableNode } from '../../src/components/canvas/DraggableNode';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'canvas.link_note': 'Link',
        'canvas.delete_note': 'Delete',
        'canvas.cycle_layout': 'Layout',
        'canvas.select_note': 'Select',
        'nodes.search_while_writing': 'Web search',
      }[key] ?? key),
  }),
}));

function renderNode(props: Partial<React.ComponentProps<typeof DraggableNode>> = {}) {
  const nodesRef = createRef<Record<string, HTMLElement | null>>();
  nodesRef.current = {};
  return render(
    <DraggableNode
      id="n1"
      nodesRef={nodesRef as React.MutableRefObject<Record<string, HTMLElement | null>>}
      isConnecting={false}
      onLink={vi.fn()}
      onDelete={vi.fn()}
      onCycleLayout={vi.fn()}
      onToggleSelect={vi.fn()}
      isSelected
      {...props}
    >
      <div>Note body</div>
    </DraggableNode>
  );
}

describe('DraggableNode', () => {
  it('编辑态隐藏外链、布局、删除、缩放手柄与选择圈（避免 group-hover 再次点亮）', () => {
    renderNode({ isEditing: true, isSelected: true });

    const rightChrome = screen.getByTitle('Link').parentElement;
    expect(rightChrome).toHaveClass('pointer-events-none');
    expect(rightChrome).toHaveClass('!opacity-0');
    const bottomBar = screen.getByTitle('Layout').parentElement;
    expect(bottomBar).toHaveClass('pointer-events-none');
    expect(bottomBar).toHaveClass('!opacity-0');
    expect(screen.getByTitle('Delete').parentElement).toBe(bottomBar);
    expect(screen.getByTitle('Select')).toHaveClass('pointer-events-none');

    const resize = document.querySelector('.cursor-nwse-resize');
    expect(resize).toBeTruthy();
    expect(resize).toHaveClass('pointer-events-none');
    expect(resize).toHaveClass('!opacity-0');
  });

  it('非编辑且选中时外链按钮常态可见', () => {
    renderNode({ isEditing: false, isSelected: true });
    const rightChrome = screen.getByTitle('Link').parentElement;
    expect(rightChrome).toHaveClass('opacity-100');
    expect(rightChrome).not.toHaveClass('pointer-events-none');
  });

  it('提供 onWebSearch 时显示右侧联网搜索按钮', () => {
    const onWebSearch = vi.fn();
    renderNode({ isEditing: false, isSelected: true, onWebSearch });
    expect(screen.getByTestId('note-web-search')).toBeInTheDocument();
    screen.getByTestId('note-web-search').click();
    expect(onWebSearch).toHaveBeenCalledTimes(1);
  });

  it('编辑态不显示选中描边 ring', () => {
    const { container } = renderNode({ isEditing: true, isSelected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('ring-2');
  });

  it('非编辑且选中时显示 ring', () => {
    const { container } = renderNode({ isEditing: false, isSelected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-2');
  });
});
