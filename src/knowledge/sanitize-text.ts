/**
 * PostgreSQL JSON/text parsing rejects lone UTF-16 surrogate code units
 * (error: "unsupported Unicode escape sequence"). PDF extraction often leaves these behind.
 */

export function sanitizeTextForPostgres(input: string): string {
  if (!input) return input;

  let result = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += input[i] + input[i + 1];
        i++;
      } else {
        result += '\uFFFD';
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\uFFFD';
      continue;
    }

    result += input[i];
  }

  return result;
}

export function sanitizeJsonForPostgres(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeTextForPostgres(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonForPostgres);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeJsonForPostgres(nested);
    }
    return out;
  }
  return value;
}
