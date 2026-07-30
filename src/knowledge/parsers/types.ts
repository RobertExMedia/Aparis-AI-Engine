import type { ExtractedSegment } from '../types.js';

export interface DocumentParser {
  readonly id: string;
  readonly extensions: string[];
  canParse(fileName: string, mimeType?: string): boolean;
  parse(buffer: Buffer, meta: { fileName: string; mimeType?: string }): Promise<ExtractedSegment[]>;
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : '';
}
