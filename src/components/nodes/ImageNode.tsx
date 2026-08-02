import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import type { NodeContentProps } from './types';
import { openExternalUrl } from '../../utils/openExternal';

function asHttpUrl(raw: string | undefined): string {
  const s = (raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

export function ImageNode({ node }: NodeContentProps) {
  const { t } = useTranslation();
  const title = (node.description || '').trim();
  const href = asHttpUrl(node.sourceUrl) || asHttpUrl(node.content);

  return (
    <div
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div className="w-full bg-[#EAE7E2] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden flex-1 min-h-0">
        <img
          alt={title || 'Image'}
          className="w-full h-full object-cover shadow-inner pointer-events-none"
          src={node.content}
          referrerPolicy="no-referrer"
          draggable={false}
        />
      </div>
      {title || href ? (
        <div className="mt-1.5 flex items-center gap-1.5 min-w-0 px-0.5">
          {title ? (
            <p className="min-w-0 flex-1 text-[10px] font-sans text-[#8c8a84] truncate" title={title}>
              {title}
            </p>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {href ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void openExternalUrl(href).catch((err) =>
                  console.error('[Spoor] open image source failed', err),
                );
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={href}
              aria-label={t('nodes.image_open_source')}
              className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-sans font-medium text-[#C2410C] hover:bg-[#C2410C]/8 transition-colors"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              <span>{t('nodes.image_open_source_short')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
