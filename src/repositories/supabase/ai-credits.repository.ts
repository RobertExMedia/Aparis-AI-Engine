import {
  createUserSupabaseClient,
  getServiceSupabaseClient,
  hasServiceRoleKey,
  type AppSupabaseClient,
} from '../../supabase/client.js';
import type { Json } from '../../supabase/database.types.js';
import { logger } from '../../utils/logger.js';
import { CreditsExhaustedError, AppError } from '../../utils/errors.js';
import { toCreditsSnapshot, type CreditsSnapshot } from '../../credits/conversion.js';

export interface WorkspaceCreditsRow {
  monthly_credits: number | null;
  used_credits: number;
  remaining_credits: number | null;
  reset_date: string;
}

export interface ConsumeCreditsParams {
  accessToken?: string;
  useServiceRole?: boolean;
  workspaceId: string;
  credits: number;
  promptTokens: number;
  completionTokens: number;
  endpoint: string;
  requestId?: string;
  agentId?: string;
  conversationId?: string;
  model?: string;
  status?: 'success' | 'failed' | 'rejected';
  metadata?: Record<string, unknown>;
}

export interface ConsumeCreditsResult {
  ok: boolean;
  credits: CreditsSnapshot;
  creditsCharged: number;
  resetDate: string | null;
}

function parseCreditsPayload(data: unknown): WorkspaceCreditsRow | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return {
    monthly_credits:
      row.monthly_credits === null || row.monthly_credits === undefined
        ? null
        : Number(row.monthly_credits),
    used_credits: Number(row.used_credits ?? 0),
    remaining_credits:
      row.remaining_credits === null || row.remaining_credits === undefined
        ? null
        : Number(row.remaining_credits),
    reset_date: String(row.reset_date ?? ''),
  };
}

function resolveCreditsClient(params: {
  accessToken?: string;
  useServiceRole?: boolean;
}): AppSupabaseClient {
  if (params.useServiceRole) {
    if (!hasServiceRoleKey()) {
      throw new AppError(
        'Unable to verify AI credits for this workspace.',
        503,
        'CREDITS_UNAVAILABLE',
      );
    }
    return getServiceSupabaseClient();
  }
  if (!params.accessToken) {
    throw new AppError(
      'Unable to verify AI credits for this workspace.',
      503,
      'CREDITS_UNAVAILABLE',
    );
  }
  return createUserSupabaseClient(params.accessToken);
}

export class AiCreditsRepository {
  async getBalance(
    accessToken: string | undefined,
    workspaceId: string,
    useServiceRole = false,
  ): Promise<WorkspaceCreditsRow> {
    const client = resolveCreditsClient({ accessToken, useServiceRole });
    const { data, error } = await client.rpc('get_workspace_credits', {
      _workspace_id: workspaceId,
    });

    if (error) {
      logger.error(
        { code: error.code, message: error.message, workspaceId },
        'Failed to load workspace credits',
      );
      throw new AppError(
        'Unable to verify AI credits for this workspace.',
        503,
        'CREDITS_UNAVAILABLE',
      );
    }

    const row = parseCreditsPayload(data);
    if (!row) {
      throw new AppError(
        'Unable to verify AI credits for this workspace.',
        503,
        'CREDITS_UNAVAILABLE',
      );
    }
    return row;
  }

  async assertAvailable(
    accessToken: string | undefined,
    workspaceId: string,
    useServiceRole = false,
  ): Promise<CreditsSnapshot> {
    const row = await this.getBalance(accessToken, workspaceId, useServiceRole);
    const snapshot = toCreditsSnapshot(row);

    if (row.monthly_credits === null || row.remaining_credits === null) {
      return snapshot;
    }

    if (row.remaining_credits <= 0) {
      throw new CreditsExhaustedError(
        'This workspace has reached its current usage limit.',
        snapshot,
      );
    }

    return snapshot;
  }

  async consume(params: ConsumeCreditsParams): Promise<ConsumeCreditsResult> {
    const client = resolveCreditsClient({
      accessToken: params.accessToken,
      useServiceRole: params.useServiceRole,
    });
    const { data, error } = await client.rpc('consume_workspace_credits', {
      _workspace_id: params.workspaceId,
      _credits: params.credits,
      _prompt_tokens: params.promptTokens,
      _completion_tokens: params.completionTokens,
      _endpoint: params.endpoint,
      _request_id: params.requestId,
      _agent_id: params.agentId,
      _conversation_id: params.conversationId,
      _model: params.model,
      _status: params.status ?? 'success',
      _metadata: (params.metadata ?? {}) as Json,
    });

    if (error) {
      logger.error(
        { code: error.code, message: error.message, workspaceId: params.workspaceId },
        'Failed to consume workspace credits',
      );
      throw new AppError(
        'Unable to record AI credit usage.',
        503,
        'CREDITS_UNAVAILABLE',
      );
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    const row = parseCreditsPayload(payload);
    if (!row) {
      throw new AppError(
        'Unable to record AI credit usage.',
        503,
        'CREDITS_UNAVAILABLE',
      );
    }

    const snapshot = toCreditsSnapshot(row);
    const ok = payload.ok !== false;

    if (!ok) {
      throw new CreditsExhaustedError(
        'This workspace has reached its current usage limit.',
        snapshot,
      );
    }

    return {
      ok: true,
      credits: snapshot,
      creditsCharged: Number(payload.credits_charged ?? params.credits),
      resetDate: row.reset_date || null,
    };
  }
}

export const aiCreditsRepository = new AiCreditsRepository();
