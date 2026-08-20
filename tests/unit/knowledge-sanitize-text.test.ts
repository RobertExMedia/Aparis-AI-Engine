import { describe, expect, it } from 'vitest';
import {
  sanitizeJsonForPostgres,
  sanitizeTextForPostgres,
} from '../../src/knowledge/sanitize-text.js';

describe('sanitizeTextForPostgres', () => {
  it('passes through normal text', () => {
    expect(sanitizeTextForPostgres('Hello Čšž and 123')).toBe('Hello Čšž and 123');
  });

  it('replaces lone high surrogate', () => {
    expect(sanitizeTextForPostgres('before\ud800after')).toBe('before\uFFFDafter');
  });

  it('replaces lone low surrogate', () => {
    expect(sanitizeTextForPostgres('before\udc00after')).toBe('before\uFFFDafter');
  });

  it('keeps valid surrogate pairs', () => {
    expect(sanitizeTextForPostgres('\uD83D\uDE00')).toBe('\uD83D\uDE00');
  });

  it('sanitizes nested metadata strings', () => {
    const out = sanitizeJsonForPostgres({
      filename: 'doc.pdf',
      note: 'bad\ud800char',
      nested: { x: 'a\udc00b' },
    }) as Record<string, unknown>;
    expect(out.note).toBe('bad\uFFFDchar');
    expect((out.nested as Record<string, unknown>).x).toBe('a\uFFFDb');
  });
});
