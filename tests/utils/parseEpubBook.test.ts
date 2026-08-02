import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseEpubBook, xhtmlToPlainText } from '../../src/utils/parseEpubBook';

describe('xhtmlToPlainText', () => {
  it('strips tags and keeps paragraph breaks', () => {
    const text = xhtmlToPlainText('<p>Hello <b>world</b></p><p>Next</p>');
    expect(text).toContain('Hello world');
    expect(text).toContain('Next');
  });
});

describe('parseEpubBook', () => {
  it('extracts spine chapters as units', async () => {
    const zip = new JSZip();
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
    );
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?>
      <package>
        <metadata><dc:title>Sample Book</dc:title></metadata>
        <manifest>
          <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="c1"/>
          <itemref idref="c2"/>
        </spine>
      </package>`,
    );
    zip.file('OEBPS/c1.xhtml', '<html><body><h1>One</h1><p>First chapter text.</p></body></html>');
    zip.file('OEBPS/c2.xhtml', '<html><body><h1>Two</h1><p>Second chapter text.</p></body></html>');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const book = await parseEpubBook(buf, 'sample.epub');
    expect(book.format).toBe('epub');
    expect(book.title).toBe('Sample Book');
    expect(book.units).toHaveLength(2);
    expect(book.units[0].text).toContain('First chapter text');
    expect(book.units[1].text).toContain('Second chapter text');
  });
});
