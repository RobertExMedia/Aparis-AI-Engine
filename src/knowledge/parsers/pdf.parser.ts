import { PDFParse } from 'pdf-parse';
import { ValidationError } from '../../utils/errors.js';
import type { DocumentParser } from './types.js';
import { extensionOf, normalizeWhitespace } from './types.js';
import { config } from '../../config/index.js';

export class PdfParser implements DocumentParser {
  readonly id = 'pdf';
  readonly extensions = ['pdf'];

  canParse(fileName: string, mimeType?: string): boolean {
    return extensionOf(fileName) === 'pdf' || mimeType === 'application/pdf';
  }

  async parse(buffer: Buffer, meta: { fileName: string; mimeType?: string }) {
    const maxPages = config.knowledge.maxPdfPages;
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText({
        first: 1,
        last: maxPages > 0 ? maxPages : undefined,
      });
      const text = normalizeWhitespace(result.text ?? '');
      if (!text) {
        throw new ValidationError('No extractable text found in PDF');
      }

      const pageCount = result.pages?.length ?? result.total ?? null;
      return [
        {
          content: text,
          metadata: {
            filename: meta.fileName,
            sourceType: 'pdf',
            pageCount,
          },
        },
      ];
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
}
