import React from 'react';
import type { AgentConfig, CanvasNode } from '../../db';
import { ThemeNode } from './ThemeNode';
import { NoteNode } from './NoteNode';
import { AiNode } from './AiNode';
import { ImageNode } from './ImageNode';
import { VideoNode } from './VideoNode';
import { DocumentNode } from './DocumentNode';
import { BookNode } from './BookNode';
import { AgentNode } from './AgentNode';

/** 画布对某些 `type` 挂载的控件与各分支对应关系见 `src/constants/nodeCapabilities.ts`。 */
interface NodeRendererProps {
  node: CanvasNode;
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
  agentConfigs: AgentConfig[];
  analyzingAgentNodeId: string | null;
  /** Invoked when user clicks Run analysis on an agent card (linked notes only). */
  onAgentRunAnalysis?: (agentNodeId: string) => void;
  isAgentAnalysisActionDisabled?: boolean;
  onAiFollowUp?: (nodeId: string, message: string) => void;
  followUpLoadingNodeId?: string | null;
  streamingAiNodeId?: string | null;
  isFollowUpGloballyDisabled?: boolean;
  webSearchSourceCount?: number;
  webSearchSourcesCollapsed?: boolean;
  onToggleWebSearchSources?: (nodeId: string) => void;
  ttsHighlightSentence?: string | null;
  onAskAboutBookSelection?: (quote: string, sourceLabel?: string) => void;
}

export function NodeRenderer({
  node,
  editingNodeId,
  setEditingNodeId,
  agentConfigs,
  analyzingAgentNodeId,
  onAgentRunAnalysis,
  isAgentAnalysisActionDisabled,
  onAiFollowUp,
  followUpLoadingNodeId,
  streamingAiNodeId,
  isFollowUpGloballyDisabled,
  webSearchSourceCount,
  webSearchSourcesCollapsed,
  onToggleWebSearchSources,
  ttsHighlightSentence,
  onAskAboutBookSelection,
}: NodeRendererProps) {
  switch (node.type) {
    case 'theme':
      return <ThemeNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'note':
    case 'text':
      return (
        <NoteNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
        />
      );
    case 'ai':
      return (
        <AiNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          onSubmitFollowUp={onAiFollowUp ? (msg) => onAiFollowUp(node.id, msg) : undefined}
          isFollowUpLoading={followUpLoadingNodeId === node.id}
          isContentStreaming={streamingAiNodeId === node.id}
          isFollowUpDisabled={isFollowUpGloballyDisabled}
          webSearchSourceCount={webSearchSourceCount}
          webSearchSourcesCollapsed={webSearchSourcesCollapsed}
          onToggleWebSearchSources={
            onToggleWebSearchSources ? () => onToggleWebSearchSources(node.id) : undefined
          }
          ttsHighlightSentence={ttsHighlightSentence}
        />
      );
    case 'image':
      return <ImageNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'video':
      return <VideoNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'document':
      return <DocumentNode node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
    case 'book':
      return (
        <BookNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          onAskAboutSelection={onAskAboutBookSelection}
        />
      );
    case 'agent':
      return (
        <AgentNode
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          agentConfigs={agentConfigs}
          isAnalyzing={analyzingAgentNodeId === node.id}
          onRunAnalysis={onAgentRunAnalysis ? () => onAgentRunAnalysis(node.id) : undefined}
          isAgentAnalysisActionDisabled={isAgentAnalysisActionDisabled}
        />
      );
    default:
      return null;
  }
}
