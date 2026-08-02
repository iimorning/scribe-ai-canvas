import React from 'react';
import { openExternalUrl } from '../utils/openExternal';

type AnchorProps = React.ComponentPropsWithoutRef<'a'>;

/** react-markdown `components.a`: open http(s) in system browser / new tab, not this window. */
export function MarkdownExternalLink({ href, children, ...rest }: AnchorProps) {
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (href) {
          void openExternalUrl(href).catch((err) =>
            console.error('[Spoor] open markdown link failed', err),
          );
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}

export const markdownExternalLinkComponents = {
  a: MarkdownExternalLink,
};
