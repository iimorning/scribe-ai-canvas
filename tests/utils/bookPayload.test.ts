import { describe, it, expect } from 'vitest';
import { encodeBookContent, tryParseBookContent, BOOK_CONTENT_PREFIX } from '../../src/utils/bookPayload';

describe('bookPayload', () => {
  it('round-trips encode/parse', () => {
    const encoded = encodeBookContent({
      format: 'pdf',
      title: 'Demo',
      units: [{ title: '1', text: 'Hello' }],
    });
    expect(encoded.startsWith(BOOK_CONTENT_PREFIX)).toBe(true);
    expect(tryParseBookContent(encoded)).toEqual({
      format: 'pdf',
      title: 'Demo',
      units: [{ title: '1', text: 'Hello' }],
    });
  });

  it('returns null for non-book content', () => {
    expect(tryParseBookContent('<p>doc</p>')).toBeNull();
    expect(tryParseBookContent(undefined)).toBeNull();
    expect(tryParseBookContent(BOOK_CONTENT_PREFIX + '{bad')).toBeNull();
  });

  it('preserves image and heading blocks on round-trip', () => {
    const encoded = encodeBookContent({
      format: 'epub',
      title: 'With Art',
      units: [
        {
          title: '1',
          text: 'Chapter\n\nHello\n\n[图: Chart]',
          blocks: [
            { type: 'heading', level: 1, text: 'Chapter' },
            { type: 'text', text: 'Hello' },
            { type: 'image', src: 'data:image/png;base64,abc', alt: 'Chart' },
          ],
        },
      ],
    });
    expect(tryParseBookContent(encoded)).toEqual({
      format: 'epub',
      title: 'With Art',
      units: [
        {
          title: '1',
          text: 'Chapter\n\nHello\n\n[图: Chart]',
          blocks: [
            { type: 'heading', level: 1, text: 'Chapter' },
            { type: 'text', text: 'Hello' },
            { type: 'image', src: 'data:image/png;base64,abc', alt: 'Chart' },
          ],
        },
      ],
    });
  });
});
