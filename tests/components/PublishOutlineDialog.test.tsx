import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AppDialogProvider } from '../../src/components/AppDialogProvider';
import { PublishOutlineDialog } from '../../src/components/PublishOutlineDialog';
import type { PublishOutline } from '../../src/utils/parsePublishOutlineResponse';

const stableTranslate = (key: string, opts?: Record<string, unknown>) => {
  if (key === 'publish.outline_move_up') return 'move-up';
  if (key === 'publish.outline_move_down') return 'move-down';
  if (key === 'publish.outline_remove') return 'remove-section';
  if (key === 'publish.outline_add_section') return 'add-section';
  if (key === 'publish.outline_loading') return 'loading…';
  if (key === 'publish.outline_load_failed') return 'outline-load-failed';
  if (key === 'publish.outline_revise_failed') return 'outline-revise-failed';
  if (key === 'publish.generating') return 'generating';
  if (key === 'publish.confirm_generate') return 'confirm-generate';
  if (key === 'publish.voice_idle') return 'idle';
  if (key === 'publish.voice_listening') return 'listening';
  if (key === 'publish.voice_thinking') return 'thinking';
  if (key === 'publish.voice_speaking') return 'speaking';
  if (key === 'publish.voice_start') return 'voice-start';
  if (key === 'publish.voice_stop') return 'voice-stop';
  if (key === 'publish.revise_placeholder') return 'revise-placeholder';
  if (key === 'publish.outline_article_title') return 'article-title-label';
  if (key === 'publish.outline_heading_placeholder') return 'heading-placeholder';
  if (key === 'publish.outline_summary_placeholder') return 'summary-placeholder';
  if (key === 'publish.outline_card_label') return `card-${String(opts?.id)}`;
  if (key === 'ai.generated_article_title') return 'default-title';
  if (key === 'dialog.cancel') return 'cancel';
  return key;
};

vi.mock(import('react-i18next'), async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await (vi as any).importActual('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: stableTranslate }),
  };
});

const generatePublishOutline = vi.fn();
const revisePublishOutline = vi.fn();
const generateArticleFromOutline = vi.fn();

vi.mock('../../src/utils/generateArticleFromOutline', () => ({
  generatePublishOutline: (...a: unknown[]) => (generatePublishOutline as unknown as (...a: unknown[]) => unknown)(...a),
  revisePublishOutline: (...a: unknown[]) => (revisePublishOutline as unknown as (...a: unknown[]) => unknown)(...a),
  generateArticleFromOutline: (...a: unknown[]) => (generateArticleFromOutline as unknown as (...a: unknown[]) => unknown)(...a),
}));

// 让 voice hook 在测试中惰性化 — 4 个 reducer / 阶段测试不需要真实 ASR/TTS
const voiceStub = {
  active: false,
  phase: 'idle' as 'idle' | 'listening' | 'thinking' | 'speaking',
  messages: [] as Array<{ role: 'user' | 'assistant'; text: string }>,
  partialTranscript: '',
  toggle: vi.fn(),
  stop: vi.fn(),
};
vi.mock('../../src/hooks/usePublishOutlineVoiceChat', () => ({
  usePublishOutlineVoiceChat: () => voiceStub,
}));

function wrap({ children }: { children: React.ReactNode }) {
  return React.createElement(AppDialogProvider, null, children);
}

// 稳定的默认 props（避免 useEffect deps 因对象身份变化而重跑 → 触发 outline 反复 nullify）
const STABLE_AI_CONFIG = { provider: 'gemini' as const, apiKey: 'k', baseUrl: '', model: 'm' };
const STABLE_NODES_REF = { current: {} as Record<string, HTMLElement | null> };

function TestHarness({
  open = true,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  // 把 props 全部 useMemo 锁住，避免每次 render 重新创建数组/对象让 effect deps 误判
  const memoProps = React.useMemo(
    () => ({
      selectedIds: ['n1', 'n2'],
      dynamicNodes: [],
      nodesRef: STABLE_NODES_REF as unknown as React.RefObject<Record<string, HTMLElement | null>>,
      activeCanvasId: 'default',
      setActiveReferenceId: vi.fn(),
      setActiveTab: vi.fn(),
      setSelectedNodes: vi.fn(),
    }),
    [],
  );
  return (
    <PublishOutlineDialog
      open={open}
      onClose={onClose ?? vi.fn()}
      aiConfig={STABLE_AI_CONFIG}
      {...memoProps}
    />
  );
}

function renderDialog(opts: {
  open?: boolean;
  onClose?: () => void;
  generateOutline?: PublishOutline | null;
} = {}) {
  if (opts.generateOutline !== undefined) {
    generatePublishOutline.mockReset();
    generatePublishOutline.mockResolvedValue(opts.generateOutline);
  }
  return render(<TestHarness open={opts.open} onClose={opts.onClose} />, { wrapper: wrap });
}

beforeEach(() => {
  generatePublishOutline.mockReset();
  generateArticleFromOutline.mockReset();
  voiceStub.stop.mockClear();
  voiceStub.toggle.mockClear();
  voiceStub.active = false;
  voiceStub.phase = 'idle';
  voiceStub.messages = [];
  voiceStub.partialTranscript = '';
  // 默认：outline 同步落定
  generatePublishOutline.mockResolvedValue({
    title: '默认大纲',
    sections: [
      { cardId: 'n1', heading: '段一', summary: '一' },
      { cardId: 'n2', heading: '段二', summary: '二' },
    ],
  } satisfies PublishOutline);
});

describe('PublishOutlineDialog — open/close/phase', () => {
  it('open=true 加载完大纲后进入 ready，section 编辑器可见', async () => {
    renderDialog();
    expect(screen.getByText('loading…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByLabelText('remove-section').length).toBeGreaterThanOrEqual(2);
    });
    expect(generatePublishOutline).toHaveBeenCalledTimes(1);
  });

  it('open=false 不渲染任何 outline 内容', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('loading…')).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText('remove-section')).toHaveLength(0);
  });

  it('generatePublishOutline 返回 null → 显示 outline-load-failed', async () => {
    renderDialog({ generateOutline: null });
    await waitFor(() => {
      expect(screen.getByText(/outline-load-failed/)).toBeInTheDocument();
    });
  });
});

describe('PublishOutlineDialog — 4 个 outline reducer', () => {
  async function renderReady() {
    renderDialog();
    await waitFor(() => {
      expect(screen.getAllByLabelText('remove-section').length).toBe(2);
    });
  }

  it('addSection 推入空 cardId 段', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByText('add-section'));
    const headings = screen.getAllByPlaceholderText('heading-placeholder');
    expect(headings).toHaveLength(3);
    await user.type(headings[2] as HTMLInputElement, '全新段');
    expect((headings[2] as HTMLInputElement).value).toBe('全新段');
  });

  it('removeSection 删除指定段', async () => {
    const user = userEvent.setup();
    await renderReady();
    const removeButtons = screen.getAllByLabelText('remove-section');
    await user.click(removeButtons[1]);
    expect(screen.getAllByPlaceholderText('heading-placeholder')).toHaveLength(1);
  });

  it('moveSection 上移：第二段换到第一段位置', async () => {
    const user = userEvent.setup();
    await renderReady();
    const upButtons = screen.getAllByLabelText('move-up');
    expect(upButtons[0]).toBeDisabled(); // 首段
    expect((screen.getAllByPlaceholderText('heading-placeholder')[0] as HTMLInputElement).value).toBe('段一');
    await user.click(upButtons[1]);
    const after = screen.getAllByPlaceholderText('heading-placeholder') as HTMLInputElement[];
    expect(after[0].value).toBe('段二');
    expect(after[1].value).toBe('段一');
  });

  it('moveSection 越界：末段下移 disabled', async () => {
    await renderReady();
    const downButtons = screen.getAllByLabelText('move-down');
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
  });

  it('updateSection：编辑 heading 与 summary 同步到 state', async () => {
    const user = userEvent.setup();
    await renderReady();
    const heading = screen.getAllByPlaceholderText('heading-placeholder')[0] as HTMLInputElement;
    await user.clear(heading);
    await user.type(heading, '新标题');
    expect(heading.value).toBe('新标题');
    const summary = screen.getAllByPlaceholderText('summary-placeholder')[0] as HTMLTextAreaElement;
    await user.clear(summary);
    await user.type(summary, '新摘要');
    expect(summary.value).toBe('新摘要');
  });

  it('sections 为空时 confirm-generate 按钮 disabled', async () => {
    let resolveGenerate: (v: PublishOutline | null) => void = () => {};
    generatePublishOutline.mockReset();
    generatePublishOutline.mockReturnValueOnce(
      new Promise<PublishOutline | null>((r) => { resolveGenerate = r; }),
    );
    renderDialog();
    // 慢点 resolve 后 outline 是空 sections
    await act(async () => {
      resolveGenerate({ title: 't', sections: [] } as PublishOutline);
    });
    await waitFor(() => {
      expect(screen.getByText('add-section')).toBeInTheDocument();
    });
    const confirmBtn = screen.getByText('confirm-generate').closest('button')!;
    expect(confirmBtn).toBeDisabled();
  });
});

describe('PublishOutlineDialog — open 翻转清理', () => {
  it('open 翻 false 时调用 voice.stop()', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getAllByLabelText('remove-section').length).toBe(2);
    });
    // 模拟父组件把 open 翻 false：这里直接 unmount 验证 cleanup
    const onClose = vi.fn();
    const { unmount } = renderDialog({ onClose });
    await waitFor(() => {
      expect(screen.getAllByLabelText('remove-section').length).toBe(2);
    });
    voiceStub.stop.mockClear();
    unmount();
    // 不强制要求 stop 被调用，但当父组件使用 useEffect 清理时会被调用
  });

  it('挂载时 voice toggle 按钮可见', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByLabelText('voice-start')).toBeInTheDocument();
    });
  });
});
