import { ValidationError } from '../../utils/errors.js';
import { PdfParser } from './pdf.parser.js';
import { TxtMarkdownParser } from './txt.parser.js';
import type { DocumentParser } from './types.js';
import { extensionOf } from './types.js';

const UNSUPPORTED_LEGACY = new Set(['doc', 'xls', 'ppt', 'rtf']);

const parsers: DocumentParser[] = [new TxtMarkdownParser(), new PdfParser()];

export function resolveParser(fileName: string, mimeType?: string): DocumentParser {
  const ext = extensionOf(fileName);
  if (UNSUPPORTED_LEGACY.has(ext)) {
    throw new ValidationError(
      `Format .${ext} is not supported yet. Convert to PDF, DOCX, XLSX, PPTX, TXT, or Markdown.`,
    );
  }

  const parser = parsers.find((p) => p.canParse(fileName, mimeType));
  if (!parser) {
    throw new ValidationError(
      `Unsupported file type for "${fileName}". Supported in this release: TXT, MD, CSV, PDF.`,
    );
  }
  return parser;
}

export { parsers };
