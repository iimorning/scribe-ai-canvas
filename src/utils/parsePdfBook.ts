import * as pdfjs from 'pdfjs-dist';
import type { BookPayload, BookUnit } from './bookPayload';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

function textFromPageItems(items: unknown[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item && typeof item === 'object' && 'str' in item) {
      const str = (item as { str: unknown }).str;
      if (typeof str === 'string' && str) parts.push(str);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export async function parsePdfBook(arrayBuffer: ArrayBuffer, fileName: string): Promise<BookPayload> {
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const units: BookUnit[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = textFromPageItems(content.items as unknown[]);
    units.push({
      title: String(i),
      text: text || '',
    });
  }

  return {
    format: 'pdf',
    title: fileName.replace(/\.pdf$/i, '') || fileName,
    units,
  };
}
