import { getServiceSupabaseClient } from '../../supabase/client.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import type { ChatMessage } from '../../types/index.js';
import type { Tables, Json } from '../../supabase/database.types.js';

type ConversationRow = Tables<'conversations'>;
type MessageRow = Tables<'conversation_messages'>;

export class SupabaseConversationRepository {
  async createConversation(params: {
    workspaceId: string;
    agentId: string;
    createdBy: string;
    channel?: string;
    title?: string | null;
  }): Promise<ConversationRow> {
    const admin = getServiceSupabaseClient();
    const { data, error } = await admin
      .from('conversations')
      .insert({
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
      throw new Error('Failed to create conversation');
    }
    return data;
  }

  async findConversation(params: {
    conversationId: string;
    workspaceId: string;
    agentId?: string;
  }): Promise<ConversationRow | null> {
    const admin = getServiceSupabaseClient();
    let query = admin
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
    conversationId: string;
    workspaceId: string;
    limit?: number;
  }): Promise<ChatMessage[]> {
    const admin = getServiceSupabaseClient();
    const { data, error } = await admin
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
    workspaceId: string;
    conversationId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<MessageRow> {
    const admin = getServiceSupabaseClient();
    const { data, error } = await admin
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

    if (error || !data) throw new Error('Failed to save user message');
    await this.updateConversationTimestamp(params.conversationId, params.workspaceId);
    return data;
  }

  async saveAssistantMessage(params: {
    workspaceId: string;
    conversationId: string;
    content: string;
    model?: string;
    provider?: string;
    responseTimeMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<MessageRow> {
    const admin = getServiceSupabaseClient();
    const { data, error } = await admin
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

    if (error || !data) throw new Error('Failed to save assistant message');
    await this.updateConversationTimestamp(params.conversationId, params.workspaceId);
    return data;
  }

  async markGenerationFailed(params: {
    conversationId: string;
    workspaceId: string;
    errorCode?: string;
  }): Promise<void> {
    const admin = getServiceSupabaseClient();
    await admin
      .from('conversations')
      .update({
        status: 'error',
      })
      .eq('id', params.conversationId)
      .eq('workspace_id', params.workspaceId);

    await admin.from('conversation_messages').insert({
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
    conversationId: string,
    workspaceId: string,
  ): Promise<void> {
    const admin = getServiceSupabaseClient();
    await admin
      .from('conversations')
      .update({ updated_at: new Date().toISOString(), status: 'active' })
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId);
  }

  /** Placeholder — titles can be generated by a later summarization job. */
  async generateConversationTitle(params: {
    conversationId: string;
    workspaceId: string;
    firstMessage: string;
  }): Promise<string> {
    const title =
      params.firstMessage.trim().slice(0, 80) || 'New conversation';
    const admin = getServiceSupabaseClient();
    await admin
      .from('conversations')
      .update({ title })
      .eq('id', params.conversationId)
      .eq('workspace_id', params.workspaceId)
      .is('title', null);
    return title;
  }
}

export const supabaseConversationRepository = new SupabaseConversationRepository();
