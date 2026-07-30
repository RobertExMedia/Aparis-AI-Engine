import { createUserSupabaseClient } from '../../supabase/client.js';
import { ForbiddenError, NotFoundError, AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { ChatMessage } from '../../types/index.js';
import type { Tables } from '../../supabase/database.types.js';

type ConversationRow = Tables<'conversations'>;
type MessageRow = Tables<'conversation_messages'>;

/** Log PostgREST/Supabase errors without JWTs or secrets. */
function logSupabaseError(
  context: string,
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined,
): void {
  logger.error(
    {
      context,
      code: error?.code ?? null,
      message: error?.message ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    },
    context,
  );
}

function throwSupabaseError(
  context: string,
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined,
): never {
  logSupabaseError(context, error);
  throw new AppError(
    error?.message ?? context,
    502,
    error?.code ?? 'SUPABASE_ERROR',
    {
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    },
  );
}

/**
 * Conversation storage via the caller's Supabase JWT under RLS.
 * Schema must match aparis-ai-hub `conversations` / `conversation_messages`
 * (migration 20260730101432_…).
 */
export class SupabaseConversationRepository {
  async createConversation(params: {
    accessToken: string;
    workspaceId: string;
    agentId: string;
    startedBy: string;
    channel?: string;
    title?: string | null;
    /** Client-generated UUID for first-message create-if-absent flows. */
    id?: string;
  }): Promise<ConversationRow> {
    const client = createUserSupabaseClient(params.accessToken);
    const { data, error } = await client
      .from('conversations')
      .insert({
        ...(params.id ? { id: params.id } : {}),
        workspace_id: params.workspaceId,
        agent_id: params.agentId,
        started_by: params.startedBy,
        channel: params.channel ?? 'playground',
        title: params.title?.trim() || 'New conversation',
      })
      .select('*')
      .single();

    if (error || !data) {
      throwSupabaseError('Failed to create conversation', error);
    }
    return data;
  }

  async findConversation(params: {
    accessToken: string;
    conversationId: string;
    workspaceId: string;
    agentId?: string;
  }): Promise<ConversationRow | null> {
    const client = createUserSupabaseClient(params.accessToken);
    let query = client
      .from('conversations')
      .select('*')
      .eq('id', params.conversationId)
      .eq('workspace_id', params.workspaceId);

    if (params.agentId) {
      query = query.eq('agent_id', params.agentId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      logSupabaseError('Failed to find conversation', error);
      return null;
    }
    return data;
  }

  async verifyConversationAccess(params: {
    accessToken: string;
    conversationId: string;
    workspaceId: string;
    agentId: string;
  }): Promise<ConversationRow> {
    const conversation = await this.findConversation(params);
    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }
    if (conversation.workspace_id !== params.workspaceId) {
      throw new ForbiddenError();
    }
    if (conversation.agent_id !== params.agentId) {
      throw new ForbiddenError();
    }
    return conversation;
  }

  async listMessages(params: {
    accessToken: string;
    conversationId: string;
    workspaceId: string;
    limit?: number;
  }): Promise<ChatMessage[]> {
    const client = createUserSupabaseClient(params.accessToken);
    const { data, error } = await client
      .from('conversation_messages')
      .select('role, content')
      .eq('conversation_id', params.conversationId)
      .eq('workspace_id', params.workspaceId)
      .order('created_at', { ascending: true })
      .limit(params.limit ?? 100);

    if (error || !data) {
      if (error) logSupabaseError('Failed to list messages', error);
      return [];
    }
    return data.map((m) => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
    }));
  }

  async saveUserMessage(params: {
    accessToken: string;
    workspaceId: string;
    conversationId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<MessageRow> {
    const { accessToken, workspaceId, conversationId, content } = params;
    const client = createUserSupabaseClient(accessToken);
    const { data, error } = await client
      .from('conversation_messages')
      .insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        role: 'user',
        content,
        is_error: false,
      })
      .select('*')
      .single();

    if (error || !data) {
      throwSupabaseError('Failed to save user message', error);
    }
    await this.touchConversation(accessToken, conversationId, workspaceId);
    return data;
  }

  async saveAssistantMessage(params: {
    accessToken: string;
    workspaceId: string;
    conversationId: string;
    content: string;
    model?: string;
    provider?: string;
    responseTimeMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<MessageRow> {
    const { accessToken, workspaceId, conversationId, content } = params;
    const client = createUserSupabaseClient(accessToken);
    const { data, error } = await client
      .from('conversation_messages')
      .insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        role: 'assistant',
        content,
        is_error: false,
      })
      .select('*')
      .single();

    if (error || !data) {
      throwSupabaseError('Failed to save assistant message', error);
    }
    await this.touchConversation(accessToken, conversationId, workspaceId);
    return data;
  }

  async markGenerationFailed(params: {
    accessToken: string;
    conversationId: string;
    workspaceId: string;
    errorCode?: string;
  }): Promise<void> {
    const client = createUserSupabaseClient(params.accessToken);
    const { error } = await client.from('conversation_messages').insert({
      workspace_id: params.workspaceId,
      conversation_id: params.conversationId,
      role: 'system',
      content: params.errorCode
        ? `Generation failed (${params.errorCode})`
        : 'Generation failed',
      is_error: true,
    });

    if (error) {
      logSupabaseError('Failed to mark generation failed', error);
    }

    await this.touchConversation(
      params.accessToken,
      params.conversationId,
      params.workspaceId,
    );
  }

  /** Hub uses last_message_at (not status / soft-delete). */
  async touchConversation(
    accessToken: string,
    conversationId: string,
    workspaceId: string,
  ): Promise<void> {
    const client = createUserSupabaseClient(accessToken);
    const now = new Date().toISOString();
    const { error } = await client
      .from('conversations')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId);

    if (error) {
      logSupabaseError('Failed to touch conversation', error);
    }
  }

  /** @deprecated Prefer touchConversation — kept for call-site compatibility. */
  async updateConversationTimestamp(
    accessToken: string,
    conversationId: string,
    workspaceId: string,
  ): Promise<void> {
    return this.touchConversation(accessToken, conversationId, workspaceId);
  }

  async generateConversationTitle(params: {
    accessToken: string;
    conversationId: string;
    workspaceId: string;
    firstMessage: string;
  }): Promise<string> {
    const title = params.firstMessage.trim().slice(0, 80) || 'New conversation';
    const client = createUserSupabaseClient(params.accessToken);
    const { error } = await client
      .from('conversations')
      .update({ title })
      .eq('id', params.conversationId)
      .eq('workspace_id', params.workspaceId)
      .eq('title', 'New conversation');

    if (error) {
      logSupabaseError('Failed to generate conversation title', error);
    }
    return title;
  }
}

export const supabaseConversationRepository = new SupabaseConversationRepository();
