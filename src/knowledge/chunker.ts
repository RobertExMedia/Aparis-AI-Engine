import { normalizeWhitespace } from './parsers/types.js';

/** Approximate tokens ≈ ceil(chars / 4). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface ChunkOptions {
  chunkSizeTokens?: number;
  overlapTokens?: number;
  removeDuplicates?: boolean;
}

export interface TextChunk {
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

/**
 * Character-window chunker sized by approximate token counts.
 * Overlap is applied in characters derived from token estimates.
 */
export function chunkText(
  text: string,
  baseMeta: Record<string, unknown>,
  options: ChunkOptions = {},
): TextChunk[] {
  const chunkSize = Math.max(100, options.chunkSizeTokens ?? 800);
  const overlap = Math.min(Math.max(0, options.overlapTokens ?? 120), chunkSize - 1);
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const maxChars = chunkSize * 4;
  const overlapChars = overlap * 4;
  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxChars);
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
      if (breakAt > maxChars * 0.4) {
        end = start + breakAt + 1;
      }
    }

    const content = normalizeWhitespace(normalized.slice(start, end));
    if (content) {
      chunks.push({
        content,
        tokenCount: estimateTokens(content),
        metadata: { ...baseMeta, chunkIndex: index },
      });
      index += 1;
    }

    if (end >= normalized.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }

  if (options.removeDuplicates !== false) {
    const seen = new Set<string>();
    return chunks.filter((c) => {
      const key = c.content.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return chunks;
}
