import type { AgentConfig, CanvasNode } from '../../db';

export interface NodeContentProps {
  node: CanvasNode;
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
}

export interface NoteNodeProps extends NodeContentProps {
  /** Linked web-search image/source cards exist beside this note. */
  webSearchSourceCount?: number;
  webSearchSourcesCollapsed?: boolean;
  onToggleWebSearchSources?: () => void;
}

export interface ThemeNodeProps extends NodeContentProps {
  /** Book-expand branch cards linked from this theme hub. */
  bookExpandBranchCount?: number;
  bookExpandBranchesCollapsed?: boolean;
  onToggleBookExpandBranches?: () => void;
}

export interface AgentNodeProps extends NodeContentProps {
  agentConfigs: AgentConfig[];
  isAnalyzing?: boolean;
  onRunAnalysis?: () => void;
  /** When true, Run analysis is disabled (e.g. another AI task is in progress). */
  isAgentAnalysisActionDisabled?: boolean;
}

export interface AiNodeProps extends NodeContentProps {
  onSubmitFollowUp?: (message: string) => void;
  isFollowUpLoading?: boolean;
  isFollowUpDisabled?: boolean;
  /** While model output is streaming into this card, render plain text (not Markdown). */
  isContentStreaming?: boolean;
  /** Linked web-search source cards exist beside this answer. */
  webSearchSourceCount?: number;
  webSearchSourcesCollapsed?: boolean;
  onToggleWebSearchSources?: () => void;
  /** Sentence currently being read aloud (voice mode TTS follow-along). */
  ttsHighlightSentence?: string | null;
}

export interface BookNodeProps extends NodeContentProps {
  /** Quote selected text into the toolbar AI context. */
  onAskAboutSelection?: (quote: string, sourceLabel?: string, sourceNodeId?: string) => void;
  /** Expand selected text into a theme hub + linked note cards. */
  onExpandSelection?: (quote: string, sourceLabel?: string) => void;
  isExpanding?: boolean;
}
