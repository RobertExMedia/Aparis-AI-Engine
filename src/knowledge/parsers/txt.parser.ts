import type { DocumentParser } from './types.js';
import { extensionOf, normalizeWhitespace } from './types.js';

export class TxtMarkdownParser implements DocumentParser {
  readonly id = 'txt-markdown';
  readonly extensions = ['txt', 'md', 'markdown', 'csv'];

  canParse(fileName: string, mimeType?: string): boolean {
    const ext = extensionOf(fileName);
    if (this.extensions.includes(ext)) return true;
    return Boolean(
      mimeType &&
        (mimeType.startsWith('text/') ||
          mimeType === 'application/csv' ||
          mimeType === 'text/csv'),
    );
  }

  async parse(buffer: Buffer, meta: { fileName: string; mimeType?: string }) {
    const content = normalizeWhitespace(buffer.toString('utf8'));
    if (!content) return [];
    return [
      {
        content,
        metadata: {
          filename: meta.fileName,
          sourceType: extensionOf(meta.fileName) || 'text',
        },
      },
    ];
  }
}
