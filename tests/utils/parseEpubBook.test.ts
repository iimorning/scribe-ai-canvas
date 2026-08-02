import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseEpubBook, xhtmlToInlineParts, xhtmlToPlainText } from '../../src/utils/parseEpubBook';

describe('xhtmlToPlainText', () => {
  it('strips tags and keeps paragraph breaks', () => {
    const text = xhtmlToPlainText('<p>Hello <b>world</b></p><p>Next</p>');
    expect(text).toContain('Hello world');
    expect(text).toContain('Next');
  });
});

describe('xhtmlToInlineParts', () => {
  it('keeps images in document order with surrounding text', () => {
    const parts = xhtmlToInlineParts(
      '<p>Before</p><img src="../images/a.png" alt="Chart A"/><p>After</p>',
    );
    expect(parts).toEqual([
      { type: 'text', text: 'Before' },
      { type: 'image', href: '../images/a.png', alt: 'Chart A' },
      { type: 'text', text: 'After' },
    ]);
  });

  it('extracts heading levels separately from body text', () => {
    const parts = xhtmlToInlineParts(
      '<h1>第三章 留在城市还是返乡的选择</h1><h2>—— 回顾日本返乡就业潮</h2><p>正文段落。</p>',
    );
    expect(parts).toEqual([
      { type: 'heading', level: 1, text: '第三章 留在城市还是返乡的选择' },
      { type: 'heading', level: 2, text: '—— 回顾日本返乡就业潮' },
      { type: 'text', text: '正文段落。' },
    ]);
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

  it('embeds chapter images as data URL blocks', async () => {
    const zip = new JSZip();
    // 1x1 PNG
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
    );
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?>
      <package>
        <metadata><dc:title>Illustrated</dc:title></metadata>
        <manifest>
          <item id="c1" href="chap/c1.xhtml" media-type="application/xhtml+xml"/>
          <item id="img1" href="images/fig.png" media-type="image/png"/>
        </manifest>
        <spine>
          <itemref idref="c1"/>
        </spine>
      </package>`,
    );
    zip.file(
      'OEBPS/chap/c1.xhtml',
      `<html><body><h1>Chart</h1><p>See figure.</p><img src="../images/fig.png" alt="Sales"/><p>Done.</p></body></html>`,
    );
    zip.file('OEBPS/images/fig.png', png);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const book = await parseEpubBook(buf, 'illustrated.epub');
    expect(book.units).toHaveLength(1);
    const unit = book.units[0];
    expect(unit.text).toContain('See figure');
    expect(unit.text).toContain('[图: Sales]');
    expect(unit.blocks?.some((b) => b.type === 'image')).toBe(true);
    const image = unit.blocks?.find((b) => b.type === 'image');
    expect(image && image.type === 'image' && image.src.startsWith('data:image/png;base64,')).toBe(
      true,
    );
    expect(image && image.type === 'image' && image.alt).toBe('Sales');
  });

  it('keeps image-only chapters', async () => {
    const zip = new JSZip();
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
    );
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?>
      <package>
        <metadata><dc:title>Pics</dc:title></metadata>
        <manifest>
          <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
          <item id="img1" href="a.png" media-type="image/png"/>
        </manifest>
        <spine><itemref idref="c1"/></spine>
      </package>`,
    );
    zip.file('OEBPS/c1.xhtml', '<html><body><img src="a.png"/></body></html>');
    zip.file('OEBPS/a.png', png);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const book = await parseEpubBook(buf, 'pics.epub');
    expect(book.units).toHaveLength(1);
    expect(book.units[0].blocks?.[0]).toMatchObject({ type: 'image' });
  });
});
