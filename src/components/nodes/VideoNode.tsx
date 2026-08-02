import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Headphones, Video } from 'lucide-react';
import type { NodeContentProps } from './types';
import { openExternalUrl } from '../../utils/openExternal';
import type { MediaPlaybackMode } from '../../utils/mediaEmbed';

function asHttpUrl(raw: string | undefined): string {
  const s = (raw || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function playbackMode(node: NodeContentProps['node']): MediaPlaybackMode | 'none' {
  const ft = (node.fileType || '').trim();
  if (ft === 'iframe' || ft === 'video' || ft === 'audio') return ft;
  // Local uploads / legacy: treat content as a direct video file.
  if (asHttpUrl(node.content) || (node.content || '').startsWith('data:video/')) return 'video';
  return 'none';
}

export function VideoNode({ node }: NodeContentProps) {
  const { t } = useTranslation();
  const title = (node.description || '').trim();
  const href = asHttpUrl(node.sourceUrl) || asHttpUrl(node.content);
  const mode = playbackMode(node);
  const src = (node.content || '').trim();
  const isSearchCard = Boolean(node.webSearchParentId) || typeof node.webSearchIndex === 'number';

  const openSource = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    if (!href) return;
    void openExternalUrl(href).catch((err) =>
      console.error('[Spoor] open media source failed', err),
    );
  };

  return (
    <div
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div
        className="relative w-full bg-[#1a1a1a] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden flex-1 min-h-0"
        onPointerDown={(e) => {
          // Keep scrubbing/controls from starting a canvas drag.
          if (mode !== 'none') e.stopPropagation();
        }}
      >
        {mode === 'iframe' && src ? (
          <iframe
            title={title || t('nodes.video')}
            src={src}
            className="h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : mode === 'audio' && src ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-3">
            <Headphones className="h-8 w-8 text-white/50" aria-hidden />
            <audio className="w-full" controls preload="metadata" src={src} />
          </div>
        ) : mode === 'video' && src ? (
          <video className="h-full w-full object-contain" controls preload="metadata" src={src} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Video className="h-8 w-8 text-white/40" aria-hidden />
            <p className="text-[11px] font-sans text-white/55 leading-snug">
              {t('nodes.media_play_unavailable')}
            </p>
            {href ? (
              <button
                type="button"
                onClick={openSource}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-sans font-medium text-[#FDBA74] hover:bg-white/10"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t('nodes.image_open_source_short')}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {(title || (isSearchCard && href && mode !== 'none')) && (
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
              onClick={openSource}
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
      )}
    </div>
  );
}
