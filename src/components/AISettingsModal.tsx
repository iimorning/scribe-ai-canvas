import { useTranslation } from 'react-i18next';
import { Download, Monitor, Settings, X, Sparkles } from 'lucide-react';
import {
  BUILTIN_MIMO_API_EXPIRES_AT,
  hasBuiltinMimoApiKey,
  MIMO_TOKEN_PLAN_BASE_URL,
} from '../constants/mimo';
import {
  DOUBAO_ARK_BASE_URL,
  DOUBAO_DEFAULT_MODEL,
  hasBuiltinDoubaoApiKey,
} from '../constants/doubao';
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '../constants/deepseek';
import { MINIMAX_BASE_URL, MINIMAX_DEFAULT_MODEL } from '../constants/minimax';
import { DESKTOP_RELEASE_URL } from '../constants/desktopRelease';
import { openExternalUrl } from '../utils/openExternal';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { AISettingsDocsPanel } from './AISettingsDocsPanel';

export interface AIConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Tauri 本地 GGUF 绝对路径；provider 为 local_llama 时使用 */
  localGgufPath?: string;
  /** 可选：Thinking 变体需套用带思考块的模板时设为 true */
  localEnableThinking?: boolean;
  metasoApiKey?: string;
  /** 火山 ASR：新版控制台 API Key（优先） */
  volcAsrApiKey?: string;
  /** 火山 ASR：旧版 APP ID */
  volcAsrAppId?: string;
  /** 火山 ASR：旧版 Access Token */
  volcAsrAccessToken?: string;
  /** 火山 ASR resource id，默认小时版 */
  volcAsrResourceId?: string;
  /** MiniMax TTS API Key */
  minimaxApiKey?: string;
  /** MiniMax 音色 ID */
  minimaxVoiceId?: string;
  /** MiniMax TTS 模型 */
  minimaxTtsModel?: string;
}

export interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIConfig;
  setConfig: React.Dispatch<React.SetStateAction<AIConfig>>;
}

export function AISettingsModal({ isOpen, onClose, config, setConfig }: AISettingsModalProps) {
  const { t, i18n } = useTranslation();
  const inDesktopApp = isTauriRuntime();
  const hostedMimo = config.provider === 'mimo' && hasBuiltinMimoApiKey();
  const hostedDoubao = config.provider === 'doubao' && hasBuiltinDoubaoApiKey();
  const hostedMimoExpiryLabel =
    i18n.language === 'zh'
      ? '2026年6月1日'
      : new Date(BUILTIN_MIMO_API_EXPIRES_AT).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-[#E6E4DF] flex items-center justify-between bg-[#F4F1ED]/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#C2410C]/10 border border-[#C2410C]/20 flex items-center justify-center text-[#C2410C]">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-xl font-bold text-[#1a1a1a]">{t('settings.title')}</h2>
              <p className="text-[10px] text-[#8c8a84] uppercase tracking-widest font-mono">{t('settings.ai_config')}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('settings.close')}
            onClick={onClose}
            className="p-2 hover:bg-[#EAE7E2] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-[#8c8a84]" />
          </button>
        </div>

        <div className="p-8 space-y-6 overflow-y-auto max-h-[70vh]">
          {/* Language selection */}
          <div className="space-y-3">
            <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.language')}</label>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => { i18n.changeLanguage('en'); localStorage.setItem('app_language', 'en'); }}
                className={`flex items-center justify-center gap-2 h-10 px-4 rounded-lg border transition-all text-sm font-bold ${i18n.language === 'en' ? 'border-[#C2410C] bg-[#C2410C]/5 text-[#C2410C]' : 'border-[#E6E4DF] text-[#5a5a54] hover:border-[#C2410C]/30'}`}
              >
                English
              </button>
              <button 
                onClick={() => { i18n.changeLanguage('zh'); localStorage.setItem('app_language', 'zh'); }}
                className={`flex items-center justify-center gap-2 h-10 px-4 rounded-lg border transition-all text-sm font-bold ${i18n.language === 'zh' ? 'border-[#C2410C] bg-[#C2410C]/5 text-[#C2410C]' : 'border-[#E6E4DF] text-[#5a5a54] hover:border-[#C2410C]/30'}`}
              >
                中文
              </button>
            </div>
          </div>

          <div className="h-px bg-[#F4F1ED]" />
          <div className="p-4 rounded-xl border border-[#E6E4DF] bg-[#FAF9F6] space-y-3">
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#C2410C]/10 border border-[#C2410C]/20 flex items-center justify-center text-[#C2410C] flex-shrink-0">
                <Monitor className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#1a1a1a]">
                  {inDesktopApp ? t('settings.desktop_installed_title') : t('settings.desktop_download_title')}
                </p>
                <p className="text-[11px] text-[#5a5a54] leading-relaxed mt-1">
                  {inDesktopApp ? t('settings.desktop_installed_blurb') : t('settings.desktop_download_blurb')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void openExternalUrl(DESKTOP_RELEASE_URL)}
              className="w-full flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-[#C2410C]/40 bg-[#C2410C]/5 text-[#C2410C] text-sm font-bold hover:bg-[#C2410C]/10 transition-colors"
            >
              <Download className="w-4 h-4" />
              {inDesktopApp ? t('settings.desktop_releases_button') : t('settings.desktop_download_button')}
            </button>
          </div>

          <div className="h-px bg-[#F4F1ED]"></div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                 <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.provider')}</label>
                 <select 
                   className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                   value={config.provider}
                   onChange={e => {
                     const newProvider = e.target.value;
                     const defaults: Record<string, { model: string; baseUrl: string }> = {
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
                     const d = defaults[newProvider] || { model: '', baseUrl: '' };
                     // Local convenience: reuse TTS MiniMax key when switching chat provider to MiniMax.
                     const reuseMinimaxKey =
                       newProvider === 'minimax' &&
                       !(config.apiKey ?? '').trim() &&
                       !!(config.minimaxApiKey ?? '').trim();
                     setConfig({
                       ...config,
                       provider: newProvider,
                       model: d.model,
                       baseUrl: d.baseUrl,
                       ...(newProvider === 'local_llama'
                         ? { apiKey: '', localGgufPath: config.localGgufPath ?? '' }
                         : reuseMinimaxKey
                           ? { apiKey: (config.minimaxApiKey ?? '').trim() }
                           : {}),
                     });
                   }}
                 >
                   <option value="gemini">Google Gemini</option>
                   <option value="openai">OpenAI (GPT)</option>
                   <option value="anthropic">Anthropic (Claude)</option>
                   <option value="mimo">MiMo (小米大模型)</option>
                   <option value="doubao">{t('settings.provider_doubao')}</option>
                   <option value="deepseek">DeepSeek</option>
                   <option value="minimax">{t('settings.provider_minimax')}</option>
                   <option value="custom">Custom Endpoint</option>
                   <option value="local_llama">{t('settings.provider_local_llama')}</option>
                 </select>
               </div>
               <div className="space-y-2">
                 <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.model')}</label>
                 <input 
                   type="text"
                   className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                   placeholder={
                     config.provider === 'local_llama'
                       ? t('settings.model_local_placeholder')
                       : config.provider === 'gemini'
                         ? 'gemini-1.5-flash'
                         : config.provider === 'mimo'
                           ? 'mimo-v2.5-pro'
                           : config.provider === 'doubao'
                             ? DOUBAO_DEFAULT_MODEL
                             : config.provider === 'deepseek'
                               ? DEEPSEEK_DEFAULT_MODEL
                               : config.provider === 'minimax'
                                 ? MINIMAX_DEFAULT_MODEL
                                 : 'gpt-4o'
                   }
                   value={config.model}
                   onChange={e => setConfig({ ...config, model: e.target.value })}
                 />
               </div>
            </div>

            {config.provider === 'local_llama' ? (
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.local_gguf_path')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all font-mono"
                  placeholder={t('settings.local_gguf_placeholder')}
                  value={config.localGgufPath ?? ''}
                  onChange={e => setConfig({ ...config, localGgufPath: e.target.value })}
                />
                <label className="flex items-center gap-2 text-[11px] text-[#5a5a54] cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-[#E6E4DF]"
                    checked={config.localEnableThinking ?? false}
                    onChange={e => setConfig({ ...config, localEnableThinking: e.target.checked })}
                  />
                  {t('settings.local_enable_thinking')}
                </label>
                <p className="text-[10px] text-[#8c8a84] leading-relaxed">{t('settings.local_llama_hint')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.api_key')}</label>
                {hostedMimo && (
                  <div className="space-y-2">
                    <p
                      role="alert"
                      className="text-[11px] leading-relaxed px-3 py-2 rounded-lg border border-amber-300/80 bg-amber-50 text-amber-950"
                    >
                      {t('settings.builtin_mimo_expiry', { date: hostedMimoExpiryLabel })}
                    </p>
                    <p className="text-[11px] text-[#8c8a84] leading-relaxed">{t('settings.builtin_mimo_hint')}</p>
                  </div>
                )}
                {hostedDoubao && (
                  <p className="text-[11px] text-[#8c8a84] leading-relaxed">{t('settings.builtin_doubao_hint')}</p>
                )}
                <input
                  type="password"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                  placeholder={
                    hostedDoubao
                      ? t('settings.api_key_optional_doubao')
                      : hostedMimo
                        ? t('settings.api_key_optional_mimo')
                        : config.provider === 'doubao'
                          ? 'ark-...'
                          : config.provider === 'minimax'
                            ? 'sk-cp-...'
                            : 'tp-...'
                  }
                  value={config.apiKey}
                  onChange={e => setConfig({ ...config, apiKey: e.target.value })}
                />
              </div>
            )}

            {(config.provider === 'custom' || config.provider === 'openai' || config.provider === 'mimo' || config.provider === 'doubao' || config.provider === 'deepseek' || config.provider === 'minimax') && (
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.base_url')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                  placeholder={
                    config.provider === 'mimo'
                      ? MIMO_TOKEN_PLAN_BASE_URL
                      : config.provider === 'doubao'
                        ? DOUBAO_ARK_BASE_URL
                        : config.provider === 'deepseek'
                          ? DEEPSEEK_BASE_URL
                          : config.provider === 'minimax'
                            ? MINIMAX_BASE_URL
                            : 'https://api.openai.com/v1'
                  }
                  value={config.baseUrl}
                  onChange={e => setConfig({ ...config, baseUrl: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-[#F4F1ED]"></div>

          {/* Metaso Search API Key (optional) */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.metaso_key')}</label>
            <input
              type="password"
              className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
              placeholder="sk-metaso-..."
              value={config.metasoApiKey ?? ''}
              onChange={e => setConfig({ ...config, metasoApiKey: e.target.value })}
            />
            <p className="text-[10px] text-[#8c8a84] leading-relaxed">{t('settings.metaso_key_hint')}</p>
          </div>

          <div className="h-px bg-[#F4F1ED]" />

          {/* Voice writing: Volc ASR + MiniMax TTS */}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.voice_section')}</label>
              <p className="text-[10px] text-[#8c8a84] leading-relaxed mt-1">{t('settings.voice_section_hint')}</p>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.volc_asr_api_key')}</label>
              <input
                type="password"
                className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                placeholder={t('settings.volc_asr_api_key_placeholder')}
                value={config.volcAsrApiKey ?? ''}
                onChange={e => setConfig({ ...config, volcAsrApiKey: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.volc_asr_app_id')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                  value={config.volcAsrAppId ?? ''}
                  onChange={e => setConfig({ ...config, volcAsrAppId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.volc_asr_access_token')}</label>
                <input
                  type="password"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                  value={config.volcAsrAccessToken ?? ''}
                  onChange={e => setConfig({ ...config, volcAsrAccessToken: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.volc_asr_resource_id')}</label>
              <input
                type="text"
                className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all font-mono text-xs"
                placeholder="volc.seedasr.sauc.duration"
                value={config.volcAsrResourceId ?? ''}
                onChange={e => setConfig({ ...config, volcAsrResourceId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.minimax_api_key')}</label>
              <input
                type="password"
                className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all"
                value={config.minimaxApiKey ?? ''}
                onChange={e => setConfig({ ...config, minimaxApiKey: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.minimax_voice_id')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all font-mono text-xs"
                  placeholder="Chinese (Mandarin)_Gentle_Senior"
                  value={config.minimaxVoiceId ?? ''}
                  onChange={e => setConfig({ ...config, minimaxVoiceId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">{t('settings.minimax_tts_model')}</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-sm outline-none focus:border-[#C2410C] focus:ring-1 focus:ring-[#C2410C] transition-all font-mono text-xs"
                  placeholder="speech-2.6-turbo"
                  value={config.minimaxTtsModel ?? ''}
                  onChange={e => setConfig({ ...config, minimaxTtsModel: e.target.value })}
                />
              </div>
            </div>
          </div>

          <AISettingsDocsPanel provider={config.provider} />

          <div className="p-4 bg-[#F4F1ED] rounded-xl border border-[#E6E4DF] border-dashed">
            <div className="flex gap-3">
              <Sparkles className="w-4 h-4 text-[#C2410C] flex-shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed text-[#5a5a54]">
                {t('settings.save_success')}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[#E6E4DF] bg-white flex justify-end">
          <button
            onClick={onClose}
            className="px-8 py-2.5 bg-[#C2410C] text-white rounded-xl font-sans font-bold hover:bg-[#9A3412] transition-all text-sm shadow-sm shadow-[#C2410C]/20"
          >
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
