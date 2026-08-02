import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NoteBody } from '../../src/components/nodes/note/NoteBody';

const updateMock = vi.fn();

vi.mock('../../src/db', () => ({
  db: {
    nodes: {
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

const persistenceDisabled = vi.fn(() => true);

vi.mock('../../src/config/persistence', () => ({
  isContentBlurPersistenceDisabled: () => persistenceDisabled(),
}));

const baseNode = {
  id: 'n1',
  type: 'text' as const,
  content: '',
  x: 0,
  y: 0,
};

describe('NoteBody', () => {
  beforeEach(() => {
    updateMock.mockClear();
    persistenceDisabled.mockReturnValue(true);
  });

  it('启用 blur 持久化时 onBlur 将 innerText 写入数据库并清空编辑态', () => {
    persistenceDisabled.mockReturnValue(false);
    const setEditing = vi.fn();

    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: 'initial' }}
        editingNodeId="n1"
        setEditingNodeId={setEditing}
        editClassName="edit"
        viewClassName="view"
        emptyNoteMarkdown="_empty_"
      />
    );

    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editable).toBeTruthy();

    editable.innerText = 'persisted line';
    fireEvent.blur(editable);

    expect(updateMock).toHaveBeenCalledWith('n1', { content: 'persisted line' });
    expect(setEditing).toHaveBeenCalledWith(null);
  });

  it('禁用 blur 持久化时 onBlur 仍会清空编辑态但不写库', () => {
    persistenceDisabled.mockReturnValue(true);
    const setEditing = vi.fn();

    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: 'whatever' }}
        editingNodeId="n1"
        setEditingNodeId={setEditing}
        editClassName="edit"
        viewClassName="view"
        emptyNoteMarkdown="_empty_"
      />
    );

    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    fireEvent.blur(editable);

    expect(updateMock).not.toHaveBeenCalled();
    expect(setEditing).toHaveBeenCalledWith(null);
  });

  it('预览区把单 \\n 渲染为 <br>（remark-breaks 防回归，避免用户回车被吞）', () => {
    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: '我\n要么\n这样的？' }}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNoteMarkdown="_empty_"
      />
    );

    const preview = container.querySelector('.cursor-text') as HTMLElement;
    expect(preview).toBeTruthy();
    expect(preview.querySelectorAll('br').length).toBeGreaterThanOrEqual(2);
  });

  it('从编辑切到预览后，预览区只剩 Markdown（编辑用 contentEditable 已卸载）', () => {
    const setEditing = vi.fn();

    function Harness({ editingId, content }: { editingId: string | null; content: string }) {
      return (
        <NoteBody
          node={{ ...baseNode, content }}
          editingNodeId={editingId}
          setEditingNodeId={setEditing}
          editClassName="edit"
          viewClassName="view"
          emptyNoteMarkdown="_empty_"
        />
      );
    }

    const typed = 'unique-note-body-preview-once';
    const { container, rerender } = render(<Harness editingId="n1" content={typed} />);
    expect(container.querySelector('[contenteditable="true"]')).toBeTruthy();

    rerender(<Harness editingId={null} content={typed} />);

    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    const preview = container.querySelector('.cursor-text') as HTMLElement;
    expect(preview).toBeTruthy();
    expect(preview.textContent ?? '').toContain(typed);
    expect((preview.textContent ?? '').split(typed).length - 1).toBe(1);
  });

  it('编辑态显式设置 white-space: pre-wrap（避免 node.content 里的 \\n 在 contentEditable 中被折叠成空格）', () => {
    const { container } = render(
      <NoteBody
        node={{ ...baseNode, content: '我\n要么\n这样的？' }}
        editingNodeId="n1"
        setEditingNodeId={vi.fn()}
        editClassName="edit"
        viewClassName="view"
        emptyNoteMarkdown="_empty_"
      />
    );
    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable.style.whiteSpace).toBe('pre-wrap');
  });

  it('onBlur 后预览立即用乐观值，避免「db 异步 + useLiveQuery 同步」之间的内容回退闪烁', () => {
    persistenceDisabled.mockReturnValue(false);
    const setEditing = vi.fn();

    function Harness({ editingId, content }: { editingId: string | null; content: string }) {
      return (
        <NoteBody
          node={{ ...baseNode, content }}
          editingNodeId={editingId}
          setEditingNodeId={setEditing}
          editClassName="edit"
          viewClassName="view"
          emptyNoteMarkdown="_empty_"
        />
      );
    }

    const { container, rerender } = render(<Harness editingId="n1" content="" />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    editable.innerText = 'fresh\nlines';
    fireEvent.blur(editable);

    /** 模拟 React 在 db 写完之前先完成 isEditing→false 的 rerender；node.content 仍是旧值 "" */
    rerender(<Harness editingId={null} content="" />);

    const preview = container.querySelector('.cursor-text') as HTMLElement;
    expect(preview).toBeTruthy();
    /** 没有乐观值时这里会是 emptyMarkdown；有乐观值则立即显示用户刚保存的内容 */
    expect(preview.textContent ?? '').toContain('fresh');
    expect(preview.textContent ?? '').toContain('lines');
  });

  it('非受控编辑：父组件重渲染或 props.content 变化时，不覆盖用户已输入的内容（避免光标乱跳/重复字）', () => {
    function Harness({ flag, content }: { flag: number; content: string }) {
      return (
        <div>
          <span data-testid="flag">{flag}</span>
          <NoteBody
            node={{ ...baseNode, content }}
            editingNodeId="n1"
            setEditingNodeId={vi.fn()}
            editClassName="edit"
            viewClassName="view"
            emptyNoteMarkdown="_empty_"
          />
        </div>
      );
    }

    const { container, rerender } = render(<Harness flag={0} content="hello" />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable.textContent).toBe('hello');
    editable.textContent = 'hello typed';

    rerender(<Harness flag={1} content="hello from asr" />);

    const editableAfter = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editableAfter.textContent).toBe('hello typed');
  });
});

