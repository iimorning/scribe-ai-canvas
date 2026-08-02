import React from 'react';
import type { NoteNodeProps } from './types';
import { NoteLayoutReceipt } from './note/layouts/NoteLayoutReceipt';
import { NoteLayoutStandard, type NoteChromeLayout } from './note/layouts/NoteLayoutStandard';

export function NoteNode({
  node,
  editingNodeId,
  setEditingNodeId,
  webSearchSourceCount,
  webSearchSourcesCollapsed,
  onToggleWebSearchSources,
}: NoteNodeProps) {
  const layout = node.layout ?? 0;
  const stackProps = {
    webSearchSourceCount,
    webSearchSourcesCollapsed,
    onToggleWebSearchSources,
  };

  if (layout === 4) {
    return (
      <NoteLayoutReceipt
        node={node}
        editingNodeId={editingNodeId}
        setEditingNodeId={setEditingNodeId}
        {...stackProps}
      />
    );
  }

  return (
    <NoteLayoutStandard
      node={node}
      editingNodeId={editingNodeId}
      setEditingNodeId={setEditingNodeId}
      layout={layout as NoteChromeLayout}
      {...stackProps}
    />
  );
}
