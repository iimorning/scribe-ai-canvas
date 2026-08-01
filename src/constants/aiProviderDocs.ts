/**
 * Official / canonical documentation URLs for AI settings onboarding.
 * Keep in sync with {@link AISettingsModal} provider values.
 */
export interface DocLink {
  href: string;
  /** i18n key under settings.docs_link_* or settings.docs_* */
  labelKey: string;
}

export const GEMINI_DOC_LINKS: DocLink[] = [
  { href: 'https://aistudio.google.com/app/apikey', labelKey: 'settings.docs_link_gemini_console_key' },
  { href: 'https://ai.google.dev/gemini-api/docs/quickstart', labelKey: 'settings.docs_link_gemini_quickstart' },
  { href: 'https://ai.google.dev/gemini-api/docs/api-key', labelKey: 'settings.docs_link_gemini_api_key_guide' },
  { href: 'https://ai.google.dev/gemini-api/docs/models', labelKey: 'settings.docs_link_model_list' },
];

/** OpenAI reorganized docs: legacy /docs/quickstart & /docs/api-reference/auth often 404; use /api/docs/* & Help Center. */
export const OPENAI_DOC_LINKS: DocLink[] = [
  { href: 'https://platform.openai.com/api-keys', labelKey: 'settings.docs_link_openai_keys' },
  { href: 'https://platform.openai.com/api/docs/guides/chat', labelKey: 'settings.docs_link_openai_quickstart' },
  {
    href: 'https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety',
    labelKey: 'settings.docs_link_openai_auth',
  },
];

export const ANTHROPIC_DOC_LINKS: DocLink[] = [
  { href: 'https://platform.claude.com/settings/keys', labelKey: 'settings.docs_link_anthropic_keys' },
  { href: 'https://docs.anthropic.com/en/docs/get-started', labelKey: 'settings.docs_link_anthropic_get_started' },
  { href: 'https://docs.anthropic.com/en/api/getting-started', labelKey: 'settings.docs_link_anthropic_api' },
];

/** Xiaomi MiMo — links from https://mimo.mi.com/ */
export const MIMO_DOC_LINKS: DocLink[] = [
  { href: 'https://platform.xiaomimimo.com/', labelKey: 'settings.docs_link_mimo_platform' },
  { href: 'https://aistudio.xiaomimimo.com/#/', labelKey: 'settings.docs_link_mimo_aistudio' },
];

/** Volcengine Ark / Doubao — https://www.volcengine.com/product/ark */
export const DOUBAO_DOC_LINKS: DocLink[] = [
  { href: 'https://console.volcengine.com/ark', labelKey: 'settings.docs_link_doubao_console' },
  { href: 'https://www.volcengine.com/docs/82379', labelKey: 'settings.docs_link_doubao_docs' },
];

export const DEEPSEEK_DOC_LINKS: DocLink[] = [
  { href: 'https://platform.deepseek.com/api_keys', labelKey: 'settings.docs_link_deepseek_keys' },
  { href: 'https://api-docs.deepseek.com/', labelKey: 'settings.docs_link_deepseek_docs' },
  { href: 'https://api-docs.deepseek.com/quick_start/pricing', labelKey: 'settings.docs_link_deepseek_pricing' },
];

/** MiniMax China — Token Plan / OpenAI-compatible chat */
export const MINIMAX_DOC_LINKS: DocLink[] = [
  { href: 'https://platform.minimaxi.com/console/plan', labelKey: 'settings.docs_link_minimax_plan' },
  { href: 'https://platform.minimaxi.com/docs/api-reference/text-openai-api', labelKey: 'settings.docs_link_minimax_openai' },
];

/** App calls OpenAI-style POST /v1/chat/completions — avoid dead /docs/api-reference/chat/* URLs. */
export const CUSTOM_ENDPOINT_DOC_LINKS: DocLink[] = [
  { href: 'https://platform.openai.com/api/docs/guides/chat', labelKey: 'settings.docs_link_openai_chat_completions' },
];

export const METASO_DOC_LINKS: DocLink[] = [
  { href: 'https://metaso.cn/search-api/api-keys', labelKey: 'settings.docs_link_metaso_keys_page' },
  { href: 'https://metaso.cn/search-api/playground', labelKey: 'settings.docs_link_metaso_playground' },
];
