import React, { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { db } from '../../../db';
import type { CanvasNode } from '../../../db';
import { isContentBlurPersistenceDisabled } from '../../../config/persistence';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../../utils/canvasNodeContextText';

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

  /** 乐观值：onBlur 写库后立即生效，避开 db.nodes.update -> useLiveQuery 异步刷新之间的"老内容闪一下"间隙；
   *  当 props 上的 node.content 与乐观值一致（即 IndexedDB 已同步回组件），自动清空 */
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  useEffect(() => {
    if (pendingContent !== null && pendingContent === node.content) {
      setPendingContent(null);
    }
  }, [node.content, pendingContent]);

  // contentEditable keeps its own DOM; React children updates are ignored after mount.
  // Voice ASR (and other external writers) update IndexedDB → liveQuery → node.content;
  // sync that into the editor so transcripts appear while the note is focused.
  useEffect(() => {
    if (!isEditing) return;
    const el = editRef.current;
    if (!el) return;
    const next = node.content ?? '';
    if (el.innerText !== next) {
      el.innerText = next;
    }
  }, [isEditing, node.content]);

  const displayContent = pendingContent ?? node.content;

  return (
    <div className={scrollAreaClassName} {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}>
      {isEditing ? (
        <div
          ref={editRef}
          autoFocus
          className={editClassName}
          contentEditable
          suppressContentEditableWarning
          /** white-space: pre-wrap 保证 node.content 里的 \n 在编辑区视觉上换行；否则 HTML 默认会把 \n 折叠成空格 */
          style={{ whiteSpace: 'pre-wrap' }}
          onBlur={(e) => {
            const next = e.currentTarget.innerText;
            if (!isContentBlurPersistenceDisabled()) {
              db.nodes.update(node.id, { content: next });
              setPendingContent(next);
            }
            setEditingNodeId(null);
          }}
        >
          {node.content}
        </div>
      ) : (
        <div onClick={() => setEditingNodeId(node.id)} className={`cursor-text min-h-[50px] ${viewClassName}`}>
          <Markdown remarkPlugins={NOTE_REMARK_PLUGINS}>{displayContent || emptyNoteMarkdown}</Markdown>
        </div>
      )}
    </div>
  );
}
