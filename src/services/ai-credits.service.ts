import { config } from '../config/index.js';
import {
  tokensToCredits,
  type CreditsSnapshot,
} from '../credits/conversion.js';
import { estimateTokens } from '../utils/crypto.js';
import { aiCreditsRepository } from '../repositories/supabase/ai-credits.repository.js';
import { logger } from '../utils/logger.js';

export interface SettleAiCreditsParams {
  accessToken: string;
  workspaceId: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  /** Fallback texts when provider did not return token counts. */
  promptText?: string;
  completionText?: string;
  endpoint: string;
  requestId?: string;
  agentId?: string;
  conversationId?: string;
  model?: string;
  status?: 'success' | 'failed' | 'rejected';
  metadata?: Record<string, unknown>;
}

export interface SettleAiCreditsResult {
  credits: CreditsSnapshot;
  creditsCharged: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * AI Credits service — conversion + ledger. Billing/Stripe stay out of this layer.
 */
export class AiCreditsService {
  async assertAvailable(accessToken: string, workspaceId: string): Promise<CreditsSnapshot> {
    return aiCreditsRepository.assertAvailable(accessToken, workspaceId);
  }

  async getBalance(accessToken: string, workspaceId: string): Promise<CreditsSnapshot> {
    const row = await aiCreditsRepository.getBalance(accessToken, workspaceId);
    return {
      remaining: row.remaining_credits,
      used: row.used_credits,
      limit: row.monthly_credits,
    };
  }

  resolveTokenCounts(params: SettleAiCreditsParams): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } {
    let promptTokens =
      typeof params.promptTokens === 'number' && Number.isFinite(params.promptTokens)
        ? Math.max(0, Math.floor(params.promptTokens))
        : null;
    let completionTokens =
      typeof params.completionTokens === 'number' && Number.isFinite(params.completionTokens)
        ? Math.max(0, Math.floor(params.completionTokens))
        : null;

    if (promptTokens === null && params.promptText) {
      promptTokens = estimateTokens(params.promptText);
    }
    if (completionTokens === null && params.completionText) {
      completionTokens = estimateTokens(params.completionText);
    }

    promptTokens = promptTokens ?? 0;
    completionTokens = completionTokens ?? 0;

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  /**
   * Convert tokens → credits, deduct, and store usage_events.
   * Call after a successful AI response (or to record rejected/failed attempts).
   */
  async settle(params: SettleAiCreditsParams): Promise<SettleAiCreditsResult> {
    const tokens = this.resolveTokenCounts(params);
    const credits = tokensToCredits(
      {
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
      },
      {
        tokensPerCredit: config.aiCredits.tokensPerCredit,
        completionWeight: config.aiCredits.completionWeight,
        minCreditsPerRequest: config.aiCredits.minCreditsPerRequest,
      },
    );

    // Failed/rejected with zero tokens: still record history at 0 charge when requested.
    const charge = params.status === 'failed' || params.status === 'rejected' ? 0 : credits;

    const result = await aiCreditsRepository.consume({
      accessToken: params.accessToken,
      workspaceId: params.workspaceId,
      credits: charge,
      promptTokens: tokens.promptTokens,
      completionTokens: tokens.completionTokens,
      endpoint: params.endpoint,
      requestId: params.requestId,
      agentId: params.agentId,
      conversationId: params.conversationId,
      model: params.model,
      status: params.status ?? 'success',
      metadata: params.metadata ?? {},
    });

    logger.info(
      {
        workspaceId: params.workspaceId,
        endpoint: params.endpoint,
        requestId: params.requestId,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        creditsCharged: result.creditsCharged,
        remaining: result.credits.remaining,
      },
      'AI credits settled',
    );

    return {
      credits: result.credits,
      creditsCharged: result.creditsCharged,
      promptTokens: tokens.promptTokens,
      completionTokens: tokens.completionTokens,
      totalTokens: tokens.totalTokens,
    };
  }
}

export const aiCreditsService = new AiCreditsService();
