import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { aiCreditsService } from '../services/ai-credits.service.js';
import { requireSupabaseAuth } from './auth.js';
import { ValidationError } from '../utils/errors.js';
import type { CreditsSnapshot } from '../credits/conversion.js';

export type ResolveWorkspaceId = (request: FastifyRequest) => string | undefined;

function defaultResolveWorkspaceId(request: FastifyRequest): string | undefined {
  if (request.auth && 'workspaceId' in request.auth && request.auth.workspaceId) {
    return request.auth.workspaceId;
  }
  const body = request.body as { workspaceId?: string } | undefined;
  return body?.workspaceId;
}

export interface AiCreditsGuardOptions {
  /** Extract workspace id (default: body.workspaceId or auth.workspaceId). */
  resolveWorkspaceId?: ResolveWorkspaceId;
  /**
   * When true (default), reject with CREDITS_EXHAUSTED if remaining <= 0.
   * Set false for read-only endpoints that only attach balance.
   */
  rejectIfExhausted?: boolean;
}

/**
 * Reusable preHandler: verifies the workspace still has AI credits.
 * Attach after authenticateSupabaseUser. Does not expose billing internals.
 *
 * Usage:
 *   preHandler: [authenticateSupabaseUser, requireAiCredits(), usageTracker]
 */
export function requireAiCredits(
  options: AiCreditsGuardOptions = {},
): preHandlerHookHandler {
  const resolve = options.resolveWorkspaceId ?? defaultResolveWorkspaceId;
  const rejectIfExhausted = options.rejectIfExhausted !== false;

  return async function aiCreditsGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    requireSupabaseAuth(request.auth);
    const workspaceId = resolve(request);
    if (!workspaceId) {
      throw new ValidationError('workspaceId is required');
    }

    const credits = rejectIfExhausted
      ? await aiCreditsService.assertAvailable(request.auth.accessToken, workspaceId)
      : await aiCreditsService.getBalance(request.auth.accessToken, workspaceId);

    request.creditsMeta = {
      workspaceId,
      credits,
      settled: false,
    };
  };
}

/**
 * Deduct credits after an AI call and attach the public snapshot for the response.
 */
export async function settleRequestCredits(
  request: FastifyRequest,
  params: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    promptText?: string;
    completionText?: string;
    endpoint: string;
    requestId?: string;
    agentId?: string;
    conversationId?: string;
    model?: string;
    status?: 'success' | 'failed' | 'rejected';
  },
): Promise<CreditsSnapshot> {
  requireSupabaseAuth(request.auth);
  const workspaceId =
    request.creditsMeta?.workspaceId ??
    defaultResolveWorkspaceId(request);
  if (!workspaceId) {
    throw new ValidationError('workspaceId is required');
  }

  const settled = await aiCreditsService.settle({
    accessToken: request.auth.accessToken,
    workspaceId,
    ...params,
  });

  request.creditsMeta = {
    workspaceId,
    credits: settled.credits,
    settled: true,
    creditsCharged: settled.creditsCharged,
  };

  return settled.credits;
}

export function getRequestCredits(request: FastifyRequest): CreditsSnapshot | undefined {
  return request.creditsMeta?.credits;
}
