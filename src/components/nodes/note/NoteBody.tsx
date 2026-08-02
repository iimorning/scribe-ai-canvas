import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { db } from '../../../db';
import type { CanvasNode } from '../../../db';
import { isContentBlurPersistenceDisabled } from '../../../config/persistence';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../../utils/canvasNodeContextText';
import { markdownExternalLinkComponents } from '../../MarkdownExternalLink';

/** 让单个 \n 渲染为 <br>，避免用户在便签里手敲的回车被 Markdown 默认行为吞掉（双 \n 仍是段落，列表/标题不受影响） */
const NOTE_REMARK_PLUGINS = [remarkBreaks];

export interface NoteBodyProps {
  node: CanvasNode;
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
  editClassName: string;
  viewClassName: string;
  emptyNoteMarkdown: string;
  scrollAreaClassName?: string;
}

/**
 * View: live DB content (ASR can update freely).
 * Edit: uncontrolled contentEditable — seed once on enter, save only on blur.
 * Never push props into the editor while typing (that resets the caret).
 */
export function NoteBody({
  node,
  editingNodeId,
  setEditingNodeId,
  editClassName,
  viewClassName,
  emptyNoteMarkdown,
  scrollAreaClassName = 'flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar',
}: NoteBodyProps) {
  const isEditing = editingNodeId === node.id;
  const editRef = useRef<HTMLDivElement>(null);
  const seededForEditRef = useRef(false);

  /** 乐观值：blur 写库后立刻显示，避开 liveQuery 异步刷新的空档闪烁 */
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const blurBaselineRef = useRef<string | null>(null);

  useEffect(() => {
    if (pendingContent === null) return;
    if (node.content === pendingContent) {
      setPendingContent(null);
      blurBaselineRef.current = null;
      return;
    }
    // Content moved away from both baseline and pending → external write (ASR etc.)
    const baseline = blurBaselineRef.current;
    if (baseline !== null && node.content !== baseline && node.content !== pendingContent) {
      setPendingContent(null);
      blurBaselineRef.current = null;
    }
  }, [node.content, pendingContent]);

  // Seed + focus once when entering edit (layout phase so first paint already has text).
  useLayoutEffect(() => {
    if (!isEditing) {
      seededForEditRef.current = false;
      return;
    }
    if (seededForEditRef.current) return;
    const el = editRef.current;
    if (!el) return;
    // textContent: jsdom's innerText is unreliable; browsers treat both fine for plain notes.
    el.textContent = node.content ?? '';
    seededForEditRef.current = true;
    el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed from content at edit-enter only
  }, [isEditing, node.id]);

  const displayContent = pendingContent ?? node.content;

  return (
    <div className={scrollAreaClassName} {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}>
      {isEditing ? (
        <div
          key="note-edit"
          ref={editRef}
          className={editClassName}
          contentEditable
          suppressContentEditableWarning
          style={{ whiteSpace: 'pre-wrap' }}
          onBlur={(e) => {
            const next = e.currentTarget.innerText ?? e.currentTarget.textContent ?? '';
            if (!isContentBlurPersistenceDisabled()) {
              blurBaselineRef.current = node.content ?? '';
              void db.nodes.update(node.id, { content: next });
              setPendingContent(next);
            }
            setEditingNodeId(null);
          }}
        />
      ) : (
        <div
          key="note-view"
          onClick={() => setEditingNodeId(node.id)}
          className={`cursor-text min-h-[50px] ${viewClassName}`}
        >
          <Markdown
            remarkPlugins={NOTE_REMARK_PLUGINS}
            components={markdownExternalLinkComponents}
          >
            {displayContent || emptyNoteMarkdown}
          </Markdown>
        </div>
      )}
    </div>
  );
}
