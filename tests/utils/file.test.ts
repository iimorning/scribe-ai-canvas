import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFileToNode, readFileAsDataURL } from '../../src/utils/file';
import { BOOK_CONTENT_PREFIX } from '../../src/utils/bookPayload';

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn().mockResolvedValue({
      value: '<h1>Test Doc</h1><p>Hello World</p>',
      messages: [],
    }),
  },
}));

vi.mock('../../src/utils/parsePdfBook', () => ({
  parsePdfBook: vi.fn().mockResolvedValue({
    format: 'pdf',
    title: 'Paper',
    units: [{ title: '1', text: 'PDF page one' }],
  }),
}));

vi.mock('../../src/utils/parseEpubBook', () => ({
  parseEpubBook: vi.fn().mockResolvedValue({
    format: 'epub',
    title: 'Novel',
    units: [{ title: 'Ch1', text: 'Once upon a time' }],
  }),
}));

function createFile(name: string, type: string, content: string | ArrayBuffer): File {
  if (content instanceof ArrayBuffer) {
    return new File([content], name, { type });
  }
  return new File([content], name, { type });
}

describe('readFileAsDataURL', () => {
  it('reads a file as data URL', async () => {
    const file = createFile('test.txt', 'text/plain', 'hello');
    const result = await readFileAsDataURL(file);
    expect(result).toContain('data:text/plain');
    // base64 encoding of "hello"
    expect(result).toContain('aGVsbG8=');
  });
});

describe('processFileToNode', () => {
  it('processes image files', async () => {
    const file = createFile('photo.png', 'image/png', 'binary-data');
    const result = await processFileToNode(file);
    expect(result.type).toBe('image');
    expect(result.content).toContain('data:image/png');
    expect(result.fileType).toBe('image/png');
  });

  it('processes video files', async () => {
    const file = createFile('clip.mp4', 'video/mp4', 'binary-data');
    const result = await processFileToNode(file);
    expect(result.type).toBe('video');
    expect(result.content).toContain('data:video/mp4');
    expect(result.fileType).toBe('video/mp4');
  });

  it('processes .docx files by name', async () => {
    const file = createFile('report.docx', 'application/octet-stream', new ArrayBuffer(100));
    const result = await processFileToNode(file);
    expect(result.type).toBe('document');
    expect(result.content).toBe('<h1>Test Doc</h1><p>Hello World</p>');
    expect(result.description).toBe('report.docx');
    expect(result.fileType).toBe('docx');
  });

  it('processes .docx files by mime type', async () => {
    const file = createFile('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', new ArrayBuffer(100));
    const result = await processFileToNode(file);
    expect(result.type).toBe('document');
    expect(result.fileType).toBe('docx');
  });

  it('processes .txt files', async () => {
    const file = createFile('notes.txt', 'text/plain', 'plain text content');
    const result = await processFileToNode(file);
    expect(result.type).toBe('text');
    expect(result.content).toBe('plain text content');
    expect(result.description).toBe('notes.txt');
    expect(result.fileType).toBe('text/plain');
  });

  it('processes .md files', async () => {
    const file = createFile('readme.md', 'text/markdown', '# Hello');
    const result = await processFileToNode(file);
    expect(result.type).toBe('text');
    expect(result.content).toBe('# Hello');
    expect(result.description).toBe('readme.md');
    expect(result.fileType).toBe('text/markdown');
  });

  it('processes .pdf files into book nodes', async () => {
    const file = createFile('paper.pdf', 'application/pdf', new ArrayBuffer(32));
    const result = await processFileToNode(file);
    expect(result.type).toBe('book');
    expect(result.fileType).toBe('pdf');
    expect(result.description).toBe('paper.pdf');
    expect(result.content.startsWith(BOOK_CONTENT_PREFIX)).toBe(true);
    expect(result.width).toBe(380);
    expect(result.height).toBe(520);
  });

  it('processes .epub files into book nodes', async () => {
    const file = createFile('novel.epub', 'application/epub+zip', new ArrayBuffer(32));
    const result = await processFileToNode(file);
    expect(result.type).toBe('book');
    expect(result.fileType).toBe('epub');
    expect(result.description).toBe('novel.epub');
    expect(result.content.startsWith(BOOK_CONTENT_PREFIX)).toBe(true);
  });

  it('throws for unsupported file types', async () => {
    const file = createFile('data.csv', 'text/csv', 'a,b,c');
    await expect(processFileToNode(file)).rejects.toThrow('Unsupported file type');
  });
});
