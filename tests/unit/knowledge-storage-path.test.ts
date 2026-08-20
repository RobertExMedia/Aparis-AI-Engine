import { describe, expect, it } from 'vitest';
import {
  buildSanitizedStoragePath,
  isInvalidStorageKeyError,
  parseKnowledgeStoragePath,
  sanitizeStorageObjectName,
} from '../../src/knowledge/storage-path.js';

describe('knowledge storage paths', () => {
  const samplePath =
    '48cec6fd-3df8-4510-afa1-7245ecffb1a6/a6732e49-bf78-4e76-b6e3-0dfae856f202/e3aa08d3-f259-4759-abeb-fbe18771d017-APARIS POGODBA O RAZVOJU PROGRAMSKE OPREME, GOSTOVANJU IN OBROČNEM PLAČILU.pdf';

  it('parses workspace/source/object segments', () => {
    const parsed = parseKnowledgeStoragePath(samplePath);
    expect(parsed?.prefix).toBe(
      '48cec6fd-3df8-4510-afa1-7245ecffb1a6/a6732e49-bf78-4e76-b6e3-0dfae856f202',
    );
    expect(parsed?.uploadId).toBe('e3aa08d3-f259-4759-abeb-fbe18771d017');
  });

  it('sanitizes non-ASCII and punctuation in object names', () => {
    const objectName = samplePath.split('/').pop()!;
    const sanitized = sanitizeStorageObjectName(objectName);
    expect(sanitized).not.toContain(' ');
    expect(sanitized).not.toContain(',');
    expect(sanitized).not.toMatch(/[Čč]/);
    expect(sanitized).toContain('APARIS_POGODBA');
  });

  it('builds alternate sanitized storage path', () => {
    const alt = buildSanitizedStoragePath(samplePath);
    expect(alt).toBeTruthy();
    expect(alt).not.toContain(' ');
    expect(alt).not.toContain(',');
  });

  it('detects Supabase invalid key errors', () => {
    expect(isInvalidStorageKeyError('Invalid key: foo bar.pdf')).toBe(true);
    expect(isInvalidStorageKeyError('not found')).toBe(false);
  });
});
