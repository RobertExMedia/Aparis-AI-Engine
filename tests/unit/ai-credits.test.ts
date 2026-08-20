import { describe, expect, it } from 'vitest';
import {
  tokensToCredits,
  toCreditsSnapshot,
  DEFAULT_CREDITS_CONVERSION,
} from '../../src/credits/conversion.js';

describe('AI credits conversion', () => {
  it('charges minimum credit for any non-zero token usage', () => {
    expect(
      tokensToCredits({ promptTokens: 1, completionTokens: 0 }),
    ).toBe(DEFAULT_CREDITS_CONVERSION.minCreditsPerRequest);
  });

  it('converts tokens using ceil(weighted / tokensPerCredit)', () => {
    expect(
      tokensToCredits({ promptTokens: 1000, completionTokens: 0 }),
    ).toBe(1);
    expect(
      tokensToCredits({ promptTokens: 1001, completionTokens: 0 }),
    ).toBe(2);
    expect(
      tokensToCredits({ promptTokens: 500, completionTokens: 500 }),
    ).toBe(1);
    expect(
      tokensToCredits({ promptTokens: 2000, completionTokens: 1000 }),
    ).toBe(3);
  });

  it('returns 0 when both token counts are zero', () => {
    expect(tokensToCredits({ promptTokens: 0, completionTokens: 0 })).toBe(0);
  });

  it('applies completion weight without inventing tokens', () => {
    expect(
      tokensToCredits(
        { promptTokens: 0, completionTokens: 1000 },
        { ...DEFAULT_CREDITS_CONVERSION, completionWeight: 2 },
      ),
    ).toBe(2);
  });

  it('maps ledger rows to a public snapshot only', () => {
    expect(
      toCreditsSnapshot({
        remaining_credits: 42,
        used_credits: 8,
        monthly_credits: 50,
      }),
    ).toEqual({ remaining: 42, used: 8, limit: 50 });

    expect(
      toCreditsSnapshot({
        remaining_credits: null,
        used_credits: 100,
        monthly_credits: null,
      }),
    ).toEqual({ remaining: null, used: 100, limit: null });
  });
});
