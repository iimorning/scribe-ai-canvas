import mammoth from 'mammoth';
import { encodeBookContent } from './bookPayload';
import { parseEpubBook } from './parseEpubBook';
import { parsePdfBook } from './parsePdfBook';

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export interface FileNodeData {
  type: string;
  content: string;
  description?: string;
  fileType: string;
  width?: number;
  height?: number;
}

const BOOK_NODE_SIZE = { width: 380, height: 520 };

function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
}

function isEpubFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.epub') ||
    file.type === 'application/epub+zip' ||
    file.type === 'application/epub'
  );
}

export async function processFileToNode(file: File): Promise<FileNodeData> {
  if (file.type.startsWith('video/')) {
    return {
      type: 'video',
      content: await readFileAsDataURL(file),
      fileType: file.type,
    };
  }

  if (file.type.startsWith('image/')) {
    return {
      type: 'image',
      content: await readFileAsDataURL(file),
      fileType: file.type,
    };
  }

  if (isPdfFile(file)) {
    const arrayBuffer = await file.arrayBuffer();
    const book = await parsePdfBook(arrayBuffer, file.name);
    return {
      type: 'book',
      content: encodeBookContent(book),
      description: file.name,
      fileType: 'pdf',
      ...BOOK_NODE_SIZE,
    };
  }

  if (isEpubFile(file)) {
    const arrayBuffer = await file.arrayBuffer();
    const book = await parseEpubBook(arrayBuffer, file.name);
    return {
      type: 'book',
      content: encodeBookContent(book),
      description: file.name,
      fileType: 'epub',
      ...BOOK_NODE_SIZE,
    };
  }

  if (file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return {
      type: 'document',
      content: result.value || '<p>(空文档)</p>',
      description: file.name,
      fileType: 'docx',
    };
  }

  if (file.name.endsWith('.txt') || file.type === 'text/plain') {
    const text = await readFileAsText(file);
    return {
      type: 'text',
      content: text,
      description: file.name,
      fileType: 'text/plain',
    };
  }

  if (file.name.endsWith('.md') || file.type === 'text/markdown') {
    const text = await readFileAsText(file);
    return {
      type: 'text',
      content: text,
      description: file.name,
      fileType: 'text/markdown',
    };
  }

  throw new Error(`Unsupported file type: ${file.type || file.name}`);
}
