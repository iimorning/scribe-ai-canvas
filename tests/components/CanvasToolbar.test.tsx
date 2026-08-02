import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CanvasToolbar } from '../../src/components/CanvasToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../../src/db', () => ({
  db: { nodes: { add: vi.fn() } },
}));

vi.mock('../../src/utils/aiI18n', () => ({
  resolveAgentLocalizedName: (a: { name: string }) => a.name,
}));

vi.mock('../../src/utils/canvas', () => ({
  getCanvasCenterPosition: () => ({ x: 0, y: 0 }),
}));

vi.mock('lucide-react', () => {
  const names = ['Plus', 'Sparkles', 'Bot', 'Wand2', 'Send', 'ZoomIn', 'FileText', 'Loader2', 'Check', 'ChevronDown', 'ChevronUp', 'X', 'Mic', 'MicOff', 'Square'] as const;
  const icons: Record<string, React.FC> = {};
  for (const name of names) {
    icons[name] = (props: Record<string, unknown>) => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}`, ...props });
    };
  }
  return icons;
});

const defaultProps = () => ({
  isToolbarAiLoading: false,
  isInputDisabled: false,
  aiPrompt: '',
  setAiPrompt: vi.fn(),
  handleAiSubmit: vi.fn(),
  addTextNode: vi.fn(),
  addThemeNode: vi.fn(),
  addFileNode: vi.fn(),
  agentConfigs: [],
  canvasTransform: { x: 0, y: 0, scale: 1 },
  setCanvasTransform: vi.fn(),
  transformRef: { current: { x: 0, y: 0, scale: 1 } },
  activeCanvasId: 'default',
});

describe('CanvasToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('提交按钮使用 Wand2，不使用 Send（纸飞机）', () => {
    const { container } = render(<CanvasToolbar {...defaultProps()} />);
    expect(screen.getByTestId('icon-Wand2')).toBeInTheDocument();
    const sendIcons = container.querySelectorAll('[data-testid="icon-Send"]');
    expect(sendIcons.length).toBe(0);
  });

  it('输入框左侧不再单独显示装饰性 Wand2', () => {
    const { container } = render(<CanvasToolbar {...defaultProps()} />);
    const wandIcons = container.querySelectorAll('[data-testid="icon-Wand2"]');
    expect(wandIcons.length).toBe(1);
  });

  it('加载中时提交按钮显示 Loader2', () => {
    render(<CanvasToolbar {...defaultProps()} isToolbarAiLoading />);
    expect(screen.getByTestId('icon-Loader2')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-Wand2')).toBeNull();
  });

  it('Enter 与点击提交按钮均调用 handleAiSubmit', async () => {
    const user = userEvent.setup();
    const handleAiSubmit = vi.fn();
    const setAiPrompt = vi.fn();

    render(
      <CanvasToolbar
        {...defaultProps()}
        aiPrompt="写一段引言"
        setAiPrompt={setAiPrompt}
        handleAiSubmit={handleAiSubmit}
      />
    );

    const input = screen.getByPlaceholderText('ai.input_placeholder');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handleAiSubmit).toHaveBeenCalledTimes(1);

    const submitBtn = screen.getByTestId('icon-Wand2').closest('button');
    expect(submitBtn).toBeTruthy();
    await user.click(submitBtn!);
    expect(handleAiSubmit).toHaveBeenCalledTimes(2);
  });

  it('禁用时输入框为 disabled（不可编辑）', () => {
    render(<CanvasToolbar {...defaultProps()} isInputDisabled />);
    expect(screen.getByPlaceholderText('ai.input_placeholder')).toBeDisabled();
  });

  it('语音模式阶段胶囊显示停止按钮，点击调用 onStopVoiceActivity', async () => {
    const user = userEvent.setup();
    const onStopVoiceActivity = vi.fn();
    render(
      <CanvasToolbar
        {...defaultProps()}
        voiceModeActive
        voicePhase="speaking"
        onStopVoiceActivity={onStopVoiceActivity}
      />,
    );
    expect(screen.getByText('voice.phase_speaking')).toBeInTheDocument();
    const stopBtn = screen.getByTitle('voice.stop_speaking');
    await user.click(stopBtn);
    expect(onStopVoiceActivity).toHaveBeenCalledTimes(1);
  });

  it('听写阶段停止按钮文案为 stop_listening', () => {
    render(
      <CanvasToolbar {...defaultProps()} voiceModeActive voicePhase="listening" />,
    );
    expect(screen.getByTitle('voice.stop_listening')).toBeInTheDocument();
  });
});
