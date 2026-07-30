import { createUserSupabaseClient } from '../../supabase/client.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { ChatMessage } from '../../types/index.js';
import type { Tables, Json } from '../../supabase/database.types.js';

type ConversationRow = Tables<'conversations'>;
type MessageRow = Tables<'conversation_messages'>;

/**
 * Conversation storage via the caller's Supabase JWT under RLS.
 * Editors+ can insert/update; members can read (per aparis-ai-hub policies).
 */
export class SupabaseConversationRepository {
  async createConversation(params: {
    accessToken: string;
    workspaceId: string;
    agentId: string;
    createdBy: string;
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
        created_by: params.createdBy,
        channel: params.channel ?? 'playground',
        status: 'active',
        title: params.title ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      logger.warn({ code: error?.code }, 'Failed to create conversation');
      throw new Error('Failed to create conversation');
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
      .eq('workspace_id', params.workspaceId)
      .is('deleted_at', null);

    if (params.agentId) {
      query = query.eq('agent_id', params.agentId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) return null;
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

    if (error || !data) return [];
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
    const client = createUserSupabaseClient(params.accessToken);
    const { data, error } = await client
      .from('conversation_messages')
      .insert({
        workspace_id: params.workspaceId,
        conversation_id: params.conversationId,
        role: 'user',
        content: params.content,
        metadata: (params.metadata ?? {}) as Json,
      })
      .select('*')
      .single();

    if (error || !data) {
      logger.warn({ code: error?.code }, 'Failed to save user message');
      throw new Error('Failed to save user message');
    }
    await this.updateConversationTimestamp(
      params.accessToken,
      params.conversationId,
      params.workspaceId,
    );
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
    const client = createUserSupabaseClient(params.accessToken);
    const { data, error } = await client
      .from('conversation_messages')
      .insert({
        workspace_id: params.workspaceId,
        conversation_id: params.conversationId,
        role: 'assistant',
        content: params.content,
        model: params.model ?? null,
        provider: params.provider ?? null,
        response_time_ms: params.responseTimeMs ?? null,
        metadata: (params.metadata ?? {}) as Json,
      })
      .select('*')
      .single();

    if (error || !data) {
      logger.warn({ code: error?.code }, 'Failed to save assistant message');
      throw new Error('Failed to save assistant message');
    }
    await this.updateConversationTimestamp(
      params.accessToken,
      params.conversationId,
      params.workspaceId,
    );
    return data;
  }

  async markGenerationFailed(params: {
    accessToken: string;
    conversationId: string;
    workspaceId: string;
    errorCode?: string;
  }): Promise<void> {
    const client = createUserSupabaseClient(params.accessToken);
    await client
      .from('conversations')
      .update({ status: 'error' })
      .eq('id', params.conversationId)
      .eq('workspace_id', params.workspaceId);

    await client.from('conversation_messages').insert({
      workspace_id: params.workspaceId,
      conversation_id: params.conversationId,
      role: 'system',
      content: 'Generation failed',
      metadata: {
        failed: true,
        errorCode: params.errorCode ?? 'AI_UNAVAILABLE',
      } as Json,
    });
  }

  async updateConversationTimestamp(
    accessToken: string,
    conversationId: string,
    workspaceId: string,
  ): Promise<void> {
    const client = createUserSupabaseClient(accessToken);
    await client
      .from('conversations')
      .update({ updated_at: new Date().toISOString(), status: 'active' })
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId);
  }

  async generateConversationTitle(params: {
    accessToken: string;
    conversationId: string;
    workspaceId: string;
    firstMessage: string;
  }): Promise<string> {
    const title = params.firstMessage.trim().slice(0, 80) || 'New conversation';
    const client = createUserSupabaseClient(params.accessToken);
    await client
      .from('conversations')
      .update({ title })
      .eq('id', params.conversationId)
      .eq('workspace_id', params.workspaceId)
      .is('title', null);
    return title;
  }
}

export const supabaseConversationRepository = new SupabaseConversationRepository();
