import { useTranslation } from 'react-i18next';
import { BookOpen, ExternalLink } from 'lucide-react';
import {
  ANTHROPIC_DOC_LINKS,
  CUSTOM_ENDPOINT_DOC_LINKS,
  DEEPSEEK_DOC_LINKS,
  GEMINI_DOC_LINKS,
  METASO_DOC_LINKS,
  DOUBAO_DOC_LINKS,
  MIMO_DOC_LINKS,
  MINIMAX_DOC_LINKS,
  OPENAI_DOC_LINKS,
  type DocLink,
} from '../constants/aiProviderDocs';
import { openExternalUrl } from '../utils/openExternal';

function linkListForProvider(provider: string): DocLink[] {
  switch (provider) {
    case 'gemini':
      return GEMINI_DOC_LINKS;
    case 'openai':
      return OPENAI_DOC_LINKS;
    case 'anthropic':
      return ANTHROPIC_DOC_LINKS;
    case 'mimo':
      return MIMO_DOC_LINKS;
    case 'doubao':
      return DOUBAO_DOC_LINKS;
    case 'deepseek':
      return DEEPSEEK_DOC_LINKS;
    case 'minimax':
      return MINIMAX_DOC_LINKS;
    case 'custom':
      return CUSTOM_ENDPOINT_DOC_LINKS;
    default:
      return [];
  }
}

function blurbKeyForProvider(provider: string): string {
  switch (provider) {
    case 'gemini':
      return 'settings.docs_blurb_gemini';
    case 'openai':
      return 'settings.docs_blurb_openai';
    case 'anthropic':
      return 'settings.docs_blurb_anthropic';
    case 'mimo':
      return 'settings.docs_blurb_mimo';
    case 'doubao':
      return 'settings.docs_blurb_doubao';
    case 'deepseek':
      return 'settings.docs_blurb_deepseek';
    case 'minimax':
      return 'settings.docs_blurb_minimax';
    case 'custom':
      return 'settings.docs_blurb_custom';
    case 'local_llama':
      return 'settings.docs_blurb_local_llama';
    default:
      return 'settings.docs_blurb_generic';
  }
}

function DocLinksList({ links, t }: { links: DocLink[]; t: (k: string) => string }) {
  if (links.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {links.map((l) => (
        <li key={l.href}>
          <a
            href={l.href}
            role="link"
            className="inline-flex items-center gap-1 text-[11px] text-[#1d4ed8] hover:underline break-all cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              void openExternalUrl(l.href);
            }}
          >
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
            {t(l.labelKey)}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function AISettingsDocsPanel({ provider }: { provider: string }) {
  const { t } = useTranslation();
  const links = linkListForProvider(provider);
  const blurbKey = blurbKeyForProvider(provider);

  return (
    <details className="rounded-xl border border-[#E6E4DF] bg-[#FAF9F6] overflow-hidden group">
      <summary className="cursor-pointer list-none flex items-center gap-2 px-4 py-3 text-[11px] font-bold text-[#5a5a54] select-none [&::-webkit-details-marker]:hidden">
        <BookOpen className="w-4 h-4 text-[#C2410C] shrink-0" aria-hidden />
        <span className="flex-1">{t('settings.docs_heading')}</span>
        <span className="text-[#8c8a84] font-mono font-normal text-[10px] uppercase tracking-wider group-open:hidden">
          {t('settings.docs_expand')}
        </span>
        <span className="text-[#8c8a84] font-mono font-normal text-[10px] uppercase tracking-wider hidden group-open:inline">
          {t('settings.docs_collapse')}
        </span>
      </summary>
      <div className="px-4 pb-4 pt-0 border-t border-[#ECEAE4] space-y-4 text-[11px] text-[#5a5a54] leading-relaxed">
        <p>{t('settings.docs_intro')}</p>
        <p>{t(blurbKey)}</p>
        {links.length > 0 && (
          <div>
            <p className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">
              {t('settings.docs_official_links')}
            </p>
            <DocLinksList links={links} t={t} />
          </div>
        )}
        {provider === 'local_llama' && (
          <div>
            <p className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">
              {t('settings.docs_official_links')}
            </p>
            <p className="mt-2">{t('settings.docs_local_llama_readme')}</p>
          </div>
        )}

        <div className="pt-2 border-t border-dashed border-[#E6E4DF] space-y-3">
          <p className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">
            {t('settings.docs_all_providers_heading')}
          </p>
          <p>{t('settings.docs_all_providers_intro')}</p>
          <div className="space-y-3 pl-0">
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_gemini')}</p>
              <DocLinksList links={GEMINI_DOC_LINKS} t={t} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_openai')}</p>
              <DocLinksList links={OPENAI_DOC_LINKS} t={t} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_anthropic')}</p>
              <DocLinksList links={ANTHROPIC_DOC_LINKS} t={t} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_mimo')}</p>
              <DocLinksList links={MIMO_DOC_LINKS} t={t} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_doubao')}</p>
              <DocLinksList links={DOUBAO_DOC_LINKS} t={t} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_deepseek')}</p>
              <DocLinksList links={DEEPSEEK_DOC_LINKS} t={t} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_minimax')}</p>
              <DocLinksList links={MINIMAX_DOC_LINKS} t={t} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_custom')}</p>
              <DocLinksList links={CUSTOM_ENDPOINT_DOC_LINKS} t={t} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#1a1a1a]">{t('settings.docs_provider_local_llama')}</p>
              <p className="mt-1.5">{t('settings.docs_local_llama_readme')}</p>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-dashed border-[#E6E4DF]">
          <p className="text-[10px] font-mono font-bold text-[#8c8a84] uppercase tracking-wider">
            {t('settings.docs_metaso_heading')}
          </p>
          <p className="mt-1.5">{t('settings.docs_metaso_blurb')}</p>
          <DocLinksList links={METASO_DOC_LINKS} t={t} />
        </div>

        <p className="text-[10px] text-[#8c8a84]">{t('settings.docs_security_note')}</p>
      </div>
    </details>
  );
}
