import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AISettingsModal } from '../../src/components/AISettingsModal';
import {
  DOUBAO_ARK_BASE_URL,
  DOUBAO_DEFAULT_MODEL,
} from '../../src/constants/doubao';
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '../../src/constants/deepseek';
import { MINIMAX_BASE_URL, MINIMAX_DEFAULT_MODEL } from '../../src/constants/minimax';
import { MIMO_TOKEN_PLAN_BASE_URL } from '../../src/constants/mimo';
import { DESKTOP_RELEASE_URL } from '../../src/constants/desktopRelease';
import type { AIConfig } from '../../src/components/AISettingsModal';

const openExternalUrlMock = vi.hoisted(() => vi.fn());
const isTauriRuntimeMock = vi.hoisted(() => vi.fn(() => false));
const hasBuiltinMimoMock = vi.hoisted(() => vi.fn(() => true));
const hasBuiltinDoubaoMock = vi.hoisted(() => vi.fn(() => false));
const themeMock = vi.hoisted(() => ({ mode: 'light' as 'light' | 'dark' | 'system', setMode: vi.fn() }));
const i18nMock = vi.hoisted(() => ({
  language: 'en',
  changeLanguage: vi.fn(),
}));

vi.mock('../../src/utils/openExternal', () => ({ openExternalUrl: openExternalUrlMock }));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime: isTauriRuntimeMock }));
vi.mock('../../src/constants/mimo', async () => {
  const actual = await vi.importActual<typeof import('../../src/constants/mimo')>('../../src/constants/mimo');
  return { ...actual, hasBuiltinMimoApiKey: hasBuiltinMimoMock };
});
vi.mock('../../src/constants/doubao', async () => {
  const actual = await vi.importActual<typeof import('../../src/constants/doubao')>('../../src/constants/doubao');
  return { ...actual, hasBuiltinDoubaoApiKey: hasBuiltinDoubaoMock };
});
vi.mock('../../src/hooks/useTheme', () => ({ useTheme: () => themeMock }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Mirror the special-case in the component for the mimo expiry
      if (key === 'settings.builtin_mimo_expiry' && opts?.date) return `米莫到期：${opts.date}`;
      return key;
    },
    i18n: i18nMock,
  }),
}));

vi.mock('lucide-react', () => {
  const make = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    Download: make('Download'),
    Monitor: make('Monitor'),
    X: make('X'),
  };
});

vi.mock('../../src/components/AISettingsDocsPanel', () => ({
  AISettingsDocsPanel: ({ provider }: { provider: string }) =>
    React.createElement('div', { 'data-testid': 'docs-panel', 'data-provider': provider }),
}));

const baseConfig: AIConfig = {
  provider: 'gemini',
  apiKey: '',
  baseUrl: '',
  model: 'gemini-1.5-flash',
};

function renderModal(props: Partial<React.ComponentProps<typeof AISettingsModal>> = {}) {
  const setConfig = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <AISettingsModal
      isOpen
      onClose={props.onClose ?? onClose}
      config={{ ...baseConfig, ...(props.config ?? {}) }}
      setConfig={props.setConfig ?? setConfig}
    />,
  );
  return { ...result, setConfig: props.setConfig ?? setConfig, onClose: props.onClose ?? onClose };
}

describe('AISettingsModal', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
    isTauriRuntimeMock.mockReturnValue(false);
    hasBuiltinMimoMock.mockReturnValue(true);
    hasBuiltinDoubaoMock.mockReturnValue(false);
    themeMock.mode = 'light';
    themeMock.setMode.mockClear();
    i18nMock.language = 'en';
    i18nMock.changeLanguage.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('open/close', () => {
    it('returns null when isOpen is false', () => {
      const { container } = render(
        <AISettingsModal isOpen={false} onClose={vi.fn()} config={baseConfig} setConfig={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the modal when isOpen is true', () => {
      renderModal();
      expect(screen.getByLabelText('settings.close')).toBeInTheDocument();
    });

    it('clicking the close (X) button calls onClose', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();
      await user.click(screen.getByLabelText('settings.close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking the Save button at the bottom calls onClose', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();
      await user.click(screen.getByText('settings.save'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('language switch', () => {
    it('English button calls i18n.changeLanguage("en") and writes "en" to localStorage', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByText('English'));
      expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en');
      expect(localStorage.getItem('app_language')).toBe('en');
    });

    it('Chinese button calls i18n.changeLanguage("zh") and writes "zh" to localStorage', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByText('中文'));
      expect(i18nMock.changeLanguage).toHaveBeenCalledWith('zh');
      expect(localStorage.getItem('app_language')).toBe('zh');
    });

    it('English button is marked active when i18n.language === "en"', () => {
      i18nMock.language = 'en';
      renderModal();
      const enBtn = screen.getByText('English').closest('button')!;
      expect(enBtn.className).toContain('border-[#C2410C]');
    });

    it('Chinese button is marked active when i18n.language === "zh"', () => {
      i18nMock.language = 'zh';
      renderModal();
      const zhBtn = screen.getByText('中文').closest('button')!;
      expect(zhBtn.className).toContain('border-[#C2410C]');
    });
  });

  describe('theme switch', () => {
    it.each(['light', 'dark', 'system'] as const)('clicking %s calls setMode(%s)', async (m) => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByText(`settings.theme_${m}`));
      expect(themeMock.setMode).toHaveBeenCalledWith(m);
    });

    it('highlights the current theme mode button', () => {
      themeMock.mode = 'dark';
      renderModal();
      const darkBtn = screen.getByText('settings.theme_dark').closest('button')!;
      expect(darkBtn.className).toContain('border-[#C2410C]');
    });
  });

  describe('provider select', () => {
    const expectedDefaults: Record<string, { model: string; baseUrl: string }> = {
      gemini: { model: 'gemini-1.5-flash', baseUrl: '' },
      openai: { model: 'gpt-4o', baseUrl: '' },
      anthropic: { model: 'claude-3-5-sonnet-20240620', baseUrl: '' },
      mimo: { model: 'mimo-v2.5-pro', baseUrl: MIMO_TOKEN_PLAN_BASE_URL },
      doubao: { model: DOUBAO_DEFAULT_MODEL, baseUrl: DOUBAO_ARK_BASE_URL },
      deepseek: { model: DEEPSEEK_DEFAULT_MODEL, baseUrl: DEEPSEEK_BASE_URL },
      minimax: { model: MINIMAX_DEFAULT_MODEL, baseUrl: MINIMAX_BASE_URL },
      custom: { model: 'gpt-4o', baseUrl: '' },
      local_llama: { model: 'gemma-4-e4b-it', baseUrl: '' },
    };

    it.each(Object.keys(expectedDefaults))('selecting %s writes the correct defaults to setConfig', async (provider) => {
      const user = userEvent.setup();
      const { setConfig } = renderModal({ config: { ...baseConfig, provider: 'openai' } });
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, provider);
      expect(setConfig).toHaveBeenCalled();
      const lastCallArg = setConfig.mock.calls[setConfig.mock.calls.length - 1][0];
      const d = expectedDefaults[provider];
      if (provider === 'local_llama') {
        // local_llama also resets apiKey to '' and preserves localGgufPath
        expect(lastCallArg.provider).toBe('local_llama');
        expect(lastCallArg.model).toBe(d.model);
        expect(lastCallArg.baseUrl).toBe(d.baseUrl);
        expect(lastCallArg.apiKey).toBe('');
      } else {
        expect(lastCallArg.provider).toBe(provider);
        expect(lastCallArg.model).toBe(d.model);
        expect(lastCallArg.baseUrl).toBe(d.baseUrl);
      }
    });

    it('switching to local_llama preserves any existing localGgufPath', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal({
        config: { ...baseConfig, provider: 'openai', localGgufPath: '/old/path.gguf' },
      });
      await user.selectOptions(screen.getByRole('combobox'), 'local_llama');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.localGgufPath).toBe('/old/path.gguf');
    });

    it('switching to minimax reuses minimaxApiKey as apiKey when apiKey is empty', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal({
        config: { ...baseConfig, provider: 'openai', apiKey: '', minimaxApiKey: 'mm-key' },
      });
      await user.selectOptions(screen.getByRole('combobox'), 'minimax');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.apiKey).toBe('mm-key');
    });

    it('switching to minimax does NOT overwrite apiKey when apiKey is already set', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal({
        config: { ...baseConfig, provider: 'openai', apiKey: 'existing', minimaxApiKey: 'mm-key' },
      });
      await user.selectOptions(screen.getByRole('combobox'), 'minimax');
      const arg = setConfig.mock.calls.at(-1)![0];
      // apiKey should be preserved as 'existing' (the source config's apiKey is
      // not in the override list, so setConfig receives ...config which includes it)
      expect(arg.apiKey).toBe('existing');
    });
  });

  describe('local_llama fields', () => {
    it('renders the localGgufPath input + thinking checkbox when provider is local_llama', () => {
      renderModal({ config: { ...baseConfig, provider: 'local_llama' } });
      expect(screen.getByText('settings.local_gguf_path')).toBeInTheDocument();
      expect(screen.getByText('settings.local_enable_thinking')).toBeInTheDocument();
    });

    it('hides the local_llama fields for non-local_llama providers', () => {
      renderModal({ config: { ...baseConfig, provider: 'gemini' } });
      expect(screen.queryByText('settings.local_gguf_path')).not.toBeInTheDocument();
    });

    it('typing in the gguf path input calls setConfig with localGgufPath', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal({ config: { ...baseConfig, provider: 'local_llama' } });
      const ggufInput = screen.getByPlaceholderText('settings.local_gguf_placeholder');
      await user.type(ggufInput, '/');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.localGgufPath).toBe('/');
    });

    it('toggling the thinking checkbox calls setConfig with localEnableThinking', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal({
        config: { ...baseConfig, provider: 'local_llama', localEnableThinking: false },
      });
      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.localEnableThinking).toBe(true);
    });
  });

  describe('API key field', () => {
    it('shows the apiKey password input for non-local_llama providers', () => {
      renderModal({ config: { ...baseConfig, provider: 'gemini' } });
      const inputs = document.querySelectorAll('input[type="password"]');
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('hides the apiKey input for local_llama', () => {
      const { container } = renderModal({ config: { ...baseConfig, provider: 'local_llama' } });
      // The metaso + 302.AI fields are also password, so check that none of them is bound to config.apiKey
      // The easiest check is: no password input has the apiKey placeholder
      const inputs = container.querySelectorAll('input[type="password"]');
      const apiKeyInput = Array.from(inputs).find(
        (el) => (el as HTMLInputElement).placeholder === 'tp-...',
      );
      expect(apiKeyInput).toBeUndefined();
    });

    it('shows the hosted mimo expiry alert when provider=mimo and built-in key is present', () => {
      hasBuiltinMimoMock.mockReturnValue(true);
      renderModal({ config: { ...baseConfig, provider: 'mimo' } });
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/米莫到期|2026/);
    });

    it('does NOT show the hosted mimo alert when built-in key is missing', () => {
      hasBuiltinMimoMock.mockReturnValue(false);
      renderModal({ config: { ...baseConfig, provider: 'mimo' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the hosted doubao hint when provider=doubao and built-in key is present', () => {
      hasBuiltinDoubaoMock.mockReturnValue(true);
      renderModal({ config: { ...baseConfig, provider: 'doubao' } });
      expect(screen.getByText('settings.builtin_doubao_hint')).toBeInTheDocument();
    });

    it('typing in the apiKey input calls setConfig with apiKey', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal({ config: { ...baseConfig, provider: 'openai' } });
      // The first password input (visible) is the apiKey field
      const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
      await user.type(apiKeyInput, 'k');
      // userEvent.type fires one onChange per char; each call has the latest apiKey
      const lastArg = setConfig.mock.calls.at(-1)![0];
      expect(lastArg.apiKey).toBe('k');
    });
  });

  describe('base URL field', () => {
    it.each(['custom', 'openai', 'mimo', 'doubao', 'deepseek', 'minimax'])(
      'shows the base URL field for provider=%s',
      (provider) => {
        renderModal({ config: { ...baseConfig, provider: provider as AIConfig['provider'] } });
        expect(screen.getByText('settings.base_url')).toBeInTheDocument();
      },
    );

    it.each(['gemini', 'anthropic', 'local_llama'])(
      'hides the base URL field for provider=%s',
      (provider) => {
        renderModal({ config: { ...baseConfig, provider: provider as AIConfig['provider'] } });
        expect(screen.queryByText('settings.base_url')).not.toBeInTheDocument();
      },
    );
  });

  describe('voice writing section', () => {
    it('typing in Volc ASR api key calls setConfig with volcAsrApiKey', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal();
      // The Volc api key input has a specific placeholder
      const input = screen.getByPlaceholderText('settings.volc_asr_api_key_placeholder');
      await user.type(input, 'v');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.volcAsrApiKey).toBe('v');
    });

    it('typing in Volc app id calls setConfig with volcAsrAppId', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal();
      // The label is not htmlFor-linked to the input; query by label text
      const appIdInput = screen.getByText('settings.volc_asr_app_id')
        .closest('div')!
        .querySelector('input') as HTMLInputElement;
      await user.type(appIdInput, 'a');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.volcAsrAppId).toBe('a');
    });

    it('Volc resource id has the documented placeholder', () => {
      renderModal();
      const resource = Array.from(document.querySelectorAll('input')).find(
        (el) => (el as HTMLInputElement).placeholder === 'volc.seedasr.sauc.duration',
      );
      expect(resource).toBeDefined();
    });

    it('typing in MiniMax voice id calls setConfig with minimaxVoiceId', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal();
      const voiceInput = Array.from(document.querySelectorAll('input')).find(
        (el) => (el as HTMLInputElement).placeholder === 'Chinese (Mandarin)_Gentle_Senior',
      )!;
      await user.type(voiceInput, 'm');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.minimaxVoiceId).toBe('m');
    });

    it('MiniMax tts model has the documented placeholder', () => {
      renderModal();
      const ttsModel = Array.from(document.querySelectorAll('input')).find(
        (el) => (el as HTMLInputElement).placeholder === 'speech-2.6-turbo',
      );
      expect(ttsModel).toBeDefined();
    });
  });

  describe('metaso + 302.AI keys', () => {
    it('typing in metaso input calls setConfig with metasoApiKey', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal();
      const metaso = screen.getByPlaceholderText('sk-metaso-...');
      await user.type(metaso, 'm');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.metasoApiKey).toBe('m');
    });

    it('typing in 302.AI input calls setConfig with api302Key', async () => {
      const user = userEvent.setup();
      const { setConfig } = renderModal();
      const api302 = screen.getByPlaceholderText('sk-...');
      await user.type(api302, 'a');
      const arg = setConfig.mock.calls.at(-1)![0];
      expect(arg.api302Key).toBe('a');
    });
  });

  describe('desktop install panel', () => {
    it('shows the download title when not running in Tauri', () => {
      isTauriRuntimeMock.mockReturnValue(false);
      renderModal();
      expect(screen.getByText('settings.desktop_download_title')).toBeInTheDocument();
    });

    it('shows the installed title when running in Tauri', () => {
      isTauriRuntimeMock.mockReturnValue(true);
      renderModal();
      expect(screen.getByText('settings.desktop_installed_title')).toBeInTheDocument();
    });

    it('clicking the desktop button calls openExternalUrl with DESKTOP_RELEASE_URL', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByText('settings.desktop_download_button'));
      expect(openExternalUrlMock).toHaveBeenCalledWith(DESKTOP_RELEASE_URL);
    });
  });

  describe('docs panel', () => {
    it('passes the current provider to AISettingsDocsPanel', () => {
      renderModal({ config: { ...baseConfig, provider: 'deepseek' } });
      const panel = screen.getByTestId('docs-panel');
      expect(panel).toHaveAttribute('data-provider', 'deepseek');
    });
  });
});
