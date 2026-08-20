import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** Mirror of production preprocess — empty/whitespace → undefined */
function emptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const optionalEnvString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const schema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: optionalEnvString,
});

describe('SUPABASE_SERVICE_ROLE_KEY optional env', () => {
  it('accepts omitted / undefined', () => {
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    }
  });

  it('accepts empty string from Docker Compose', () => {
    const parsed = schema.safeParse({ SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    }
  });

  it('accepts whitespace-only', () => {
    const parsed = schema.safeParse({ SUPABASE_SERVICE_ROLE_KEY: '   ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    }
  });

  it('keeps a real key', () => {
    const parsed = schema.safeParse({ SUPABASE_SERVICE_ROLE_KEY: ' sb_secret_abc ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.SUPABASE_SERVICE_ROLE_KEY).toBe('sb_secret_abc');
    }
  });
});
