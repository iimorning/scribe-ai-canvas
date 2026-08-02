import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { NodeRenderer } from '../../src/components/nodes/NodeRenderer';
import type { CanvasNode, AgentConfig } from '../../src/db';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'zh', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('lucide-react', () => {
  const iconNames = [
    'MessageSquare', 'Terminal', 'Network', 'Search', 'Bell', 'Settings', 'Plus',
    'BookOpen', 'Users', 'Library', 'Microscope', 'Sparkles', 'Maximize2', 'Minimize2',
    'Quote', 'Brain', 'Bot', 'Coffee', 'Wand2', 'Send', 'SlidersHorizontal', 'History', 'ZoomIn',
    'Focus', 'Image', 'FilePlus', 'Trash2', 'Link2', 'X', 'Camera', 'ChevronLeft',
    'ChevronRight', 'Check', 'Cpu', 'ArrowRight', 'ListChecks', 'CheckCircle2',
    'Loader2', 'PenLine', 'Edit3', 'FileText', 'Play', 'GitBranch', 'Layers2',
    'ExternalLink', 'StickyNote', 'Square', 'Mic', 'MicOff',
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

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => undefined,
}));

const mockAgentConfigs: AgentConfig[] = [
  { id: 'a1', name: 'Test Agent', role: 'Tester', prompt: 'Test prompt', temperature: 0.7, creativity: 0.5 },
];

const makeNode = (type: string, overrides?: Partial<CanvasNode>): CanvasNode => ({
  id: 'node-1',
  canvasId: 'default',
  type,
  content: 'Test content',
  x: 100,
  y: 100,
  ...overrides,
});

describe('NodeRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('type="theme" 渲染 ThemeNode', () => {
    const { getByText } = render(
      <NodeRenderer
        node={makeNode('theme')}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(getByText('Test content')).toBeInTheDocument();
  });

  it('theme 节点显示自定义 themeTag', () => {
    const { getByText } = render(
      <NodeRenderer
        node={makeNode('theme', { themeTag: 'My Theme Label' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(getByText('My Theme Label')).toBeInTheDocument();
  });

  it('theme 节点显示已持久化的 description 正文', () => {
    const { getByText } = render(
      <NodeRenderer
        node={makeNode('theme', { description: '围绕创业意义展开研究' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(getByText('围绕创业意义展开研究')).toBeInTheDocument();
  });

  it('theme 节点 layout=3 时默认页脚为 LATENT_SPACE', () => {
    const { getByText } = render(
      <NodeRenderer
        node={makeNode('theme', { layout: 3 })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(getByText('LATENT_SPACE')).toBeInTheDocument();
  });

  it('type="note" 渲染 NoteNode', () => {
    const { getByText } = render(
      <NodeRenderer
        node={makeNode('note')}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(getByText('Test content')).toBeInTheDocument();
  });

  it('type="text" 渲染 NoteNode', () => {
    const { getByText } = render(
      <NodeRenderer
        node={makeNode('text')}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(getByText('Test content')).toBeInTheDocument();
  });

  it('type="ai" 渲染 AiNode', () => {
    const { getByTestId } = render(
      <NodeRenderer
        node={makeNode('ai')}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(getByTestId('markdown')).toBeInTheDocument();
  });

  it('type="ai" 且含 userTurn 时展示用户追问与 AI 正文', () => {
    const { getByTestId, getByText } = render(
      <NodeRenderer
        node={makeNode('ai', { userTurn: '追问内容', content: 'AI 回复' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(getByText('追问内容')).toBeInTheDocument();
    expect(getByTestId('markdown')).toHaveTextContent('AI 回复');
  });

  it('type="ai" 已 followUpSent 时不渲染追问输入', () => {
    const { container } = render(
      <NodeRenderer
        node={makeNode('ai', { followUpSent: true })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
        onAiFollowUp={vi.fn()}
      />
    );
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('type="image" 渲染 ImageNode', () => {
    const { container } = render(
      <NodeRenderer
        node={makeNode('image', { content: 'https://example.com/img.png' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.src).toContain('img.png');
  });

  it('type="video" 渲染 VideoNode', () => {
    const { container } = render(
      <NodeRenderer
        node={makeNode('video', { content: 'https://example.com/vid.mp4' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
  });

  it('type="document" 渲染 DocumentNode', () => {
    const { container } = render(
      <NodeRenderer
        node={makeNode('document', { content: '<p>Hello</p>', description: 'test.docx', fileType: 'docx' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(container.querySelector('.doc-content')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="icon-FileText"]')).toBeInTheDocument();
  });

  it('type="book" 渲染 BookNode', () => {
    const content =
      'spoor-book:v1:' +
      JSON.stringify({
        format: 'pdf',
        title: 'Demo',
        units: [{ title: '1', text: 'Page body' }],
      });
    const { container, getByText } = render(
      <NodeRenderer
        node={makeNode('book', { content, description: 'demo.pdf', fileType: 'pdf' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    expect(container.querySelector('[data-testid="icon-BookOpen"]')).toBeInTheDocument();
    expect(getByText('Page body')).toBeInTheDocument();
  });

  it('type="agent" 渲染 AgentNode', () => {
    const { getByText, queryByTestId } = render(
      <NodeRenderer
        node={makeNode('agent', { agentConfigId: 'a1' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
        onAgentRunAnalysis={vi.fn()}
      />
    );
    expect(getByText('Test Agent')).toBeInTheDocument();
    expect(queryByTestId('agent-analyzing-overlay')).toBeNull();
    expect(queryByTestId('agent-run-analysis')).toBeInTheDocument();
  });

  it('type="agent" 且 analyzingAgentNodeId 匹配时显示分析遮罩', () => {
    const { getByTestId } = render(
      <NodeRenderer
        node={makeNode('agent', { id: 'agent-1', agentConfigId: 'a1' })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId="agent-1"
        onAgentRunAnalysis={vi.fn()}
      />
    );
    expect(getByTestId('agent-analyzing-overlay')).toBeInTheDocument();
  });

  it('未知 type 返回 null', () => {
    const { container } = render(
      <NodeRenderer
        node={makeNode('unknown_type')}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        agentConfigs={mockAgentConfigs}
        analyzingAgentNodeId={null}
      />
    );
    // 容器内不应有内容
    expect(container.innerHTML).toBe('');
  });
});
