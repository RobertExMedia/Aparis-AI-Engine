/**
 * Internal AI Credits conversion.
 * Rates stay server-side — never expose billing formulas to clients.
 */

export interface TokenUsageInput {
  promptTokens: number;
  completionTokens: number;
}

export interface CreditsConversionConfig {
  /** Tokens that cost 1 credit (after weighting). */
  tokensPerCredit: number;
  /** Completion tokens are multiplied by this before summing. */
  completionWeight: number;
  /** Minimum credits charged for a successful AI call with any tokens. */
  minCreditsPerRequest: number;
}

export const DEFAULT_CREDITS_CONVERSION: CreditsConversionConfig = {
  tokensPerCredit: 1_000,
  completionWeight: 1,
  minCreditsPerRequest: 1,
};

/**
 * Convert prompt + completion tokens into integer AI credits.
 * Never returns a fake value based on time — only token counts.
 */
export function tokensToCredits(
  usage: TokenUsageInput,
  cfg: CreditsConversionConfig = DEFAULT_CREDITS_CONVERSION,
): number {
  const prompt = Math.max(0, Math.floor(usage.promptTokens) || 0);
  const completion = Math.max(0, Math.floor(usage.completionTokens) || 0);
  const weighted = prompt + completion * cfg.completionWeight;
  if (weighted <= 0) return 0;
  const raw = Math.ceil(weighted / Math.max(1, cfg.tokensPerCredit));
  return Math.max(cfg.minCreditsPerRequest, raw);
}

/** Public snapshot returned on AI responses — no billing internals. */
export interface CreditsSnapshot {
  remaining: number | null;
  used: number;
  limit: number | null;
}

export function toCreditsSnapshot(row: {
  remaining_credits: number | null;
  used_credits: number;
  monthly_credits: number | null;
}): CreditsSnapshot {
  return {
    remaining: row.remaining_credits,
    used: row.used_credits,
    limit: row.monthly_credits,
  };
}
