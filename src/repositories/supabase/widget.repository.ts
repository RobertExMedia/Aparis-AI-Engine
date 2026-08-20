import {
  getServiceSupabaseClient,
  hasServiceRoleKey,
  type AppSupabaseClient,
} from '../../supabase/client.js';
import { hashApiKey } from '../../utils/crypto.js';
import {
  AgentNotFoundError,
  AgentUnavailableError,
  AppError,
  DomainNotAllowedError,
  WidgetKeyUnauthorizedError,
} from '../../utils/errors.js';
import { domainsMatch, normalizeWidgetDomain } from '../../utils/widget-origin.js';
import { logger } from '../../utils/logger.js';
import type { AgentConfiguration, AgentStatus, AgentTone, WidgetAuthContext } from '../../types/index.js';
import { WIDGET_CHANNEL } from '../../types/index.js';
import type { ChatMessage } from '../../types/index.js';
import type { Tables } from '../../supabase/database.types.js';

type ConversationRow = Tables<'conversations'>;
type MessageRow = Tables<'conversation_messages'>;

const AGENT_SELECT =
  'id, workspace_id, public_id, name, description, status, system_prompt, greeting, fallback_message, language, tone, temperature, max_tokens, settings, archived_at, published_at, avatar_url' as const;

function requireServiceClient(): AppSupabaseClient {
  if (!hasServiceRoleKey()) {
    throw new AppError(
      'Widget API requires SUPABASE_SERVICE_ROLE_KEY on the Engine.',
      503,
      'WIDGET_UNAVAILABLE',
    );
  }
  return getServiceSupabaseClient();
}

function toAgentConfig(row: {
  id: string;
  workspace_id: string;
  public_id: string;
  name: string;
  description: string | null;
  status: string;
  system_prompt: string;
  greeting: string | null;
  fallback_message: string | null;
  language: string;
  tone: string;
  temperature: number;
  max_tokens: number;
  settings: unknown;
  archived_at: string | null;
  published_at: string | null;
  avatar_url: string | null;
}): AgentConfiguration {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    public_id: row.public_id,
    name: row.name,
    description: row.description,
    status: row.status as AgentStatus,
    system_prompt: row.system_prompt,
    greeting: row.greeting ?? '',
    fallback_message: row.fallback_message ?? '',
    language: row.language,
    tone: row.tone as AgentTone,
    temperature: Number(row.temperature),
    max_tokens: row.max_tokens,
    settings:
      row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : {},
    archived_at: row.archived_at,
    published_at: row.published_at,
    avatar_url: row.avatar_url,
  };
}

/**
 * Service-role data access for the public website widget.
 * Never accepts or returns a Supabase user JWT.
 */
export class WidgetRepository {
  /**
   * Authenticate widget key + domain + published agent public id.
   */
  async resolveAuth(params: {
    widgetKey: string;
    originHost: string;
    agentPublicId: string;
  }): Promise<WidgetAuthContext & { agent: AgentConfiguration }> {
    const client = requireServiceClient();
    const keyHash = hashApiKey(params.widgetKey);

    const { data: keyRow, error: keyError } = await client
      .from('widget_keys')
      .select('id, workspace_id, agent_id, is_active')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (keyError || !keyRow || !keyRow.is_active) {
      throw new WidgetKeyUnauthorizedError();
    }

    const { data: agentRow, error: agentError } = await client
      .from('agents')
      .select(AGENT_SELECT)
      .eq('id', keyRow.agent_id)
      .eq('workspace_id', keyRow.workspace_id)
      .maybeSingle();

    if (agentError || !agentRow) {
      throw new AgentNotFoundError('This agent could not be found.');
    }

    const agent = toAgentConfig(agentRow);
    if (agent.public_id !== params.agentPublicId) {
      throw new WidgetKeyUnauthorizedError('Widget key does not match this agent.');
    }
    if (agent.status !== 'published' || agent.archived_at) {
      throw new AgentUnavailableError('This agent is not currently available.');
    }

    const { data: domains, error: domainError } = await client
      .from('agent_domains')
      .select('domain, status')
      .eq('agent_id', agent.id)
      .eq('workspace_id', agent.workspace_id)
      .eq('status', 'active');

    if (domainError) {
      logger.error({ message: domainError.message }, 'Failed to load agent domains');
      throw new AppError('Unable to verify widget domain.', 503, 'WIDGET_UNAVAILABLE');
    }

    const allowed = (domains ?? []).some((d) => domainsMatch(d.domain, params.originHost));
    if (!allowed) {
      throw new DomainNotAllowedError();
    }

    void client
      .from('widget_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRow.id)
      .then(() => undefined, () => undefined);

    return {
      method: 'widget',
      workspaceId: agent.workspace_id,
      agentId: agent.id,
      agentPublicId: agent.public_id,
      widgetKeyId: keyRow.id,
      originHost: normalizeWidgetDomain(params.originHost) ?? params.originHost,
      agent,
    };
  }

  async createConversation(params: {
    workspaceId: string;
    agentId: string;
    id?: string;
    title?: string;
  }): Promise<ConversationRow> {
    const client = requireServiceClient();
    const { data, error } = await client
      .from('conversations')
      .insert({
        ...(params.id ? { id: params.id } : {}),
        workspace_id: params.workspaceId,
        agent_id: params.agentId,
        started_by: null,
        channel: WIDGET_CHANNEL,
        title: params.title?.trim() || 'Website chat',
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new AppError(error?.message ?? 'Failed to create conversation', 502, 'SUPABASE_ERROR');
    }
    return data;
  }

  async findWidgetConversation(params: {
    conversationId: string;
    workspaceId: string;
    agentId: string;
  }): Promise<ConversationRow | null> {
    const client = requireServiceClient();
    const { data, error } = await client
      .from('conversations')
      .select('*')
      .eq('id', params.conversationId)
      .eq('workspace_id', params.workspaceId)
      .eq('agent_id', params.agentId)
      .eq('channel', WIDGET_CHANNEL)
      .maybeSingle();

    if (error) {
      logger.warn({ message: error.message }, 'Failed to find widget conversation');
      return null;
    }
    return data;
  }

  async listMessages(params: {
    conversationId: string;
    workspaceId: string;
    limit?: number;
  }): Promise<ChatMessage[]> {
    const client = requireServiceClient();
    const { data, error } = await client
      .from('conversation_messages')
      .select('role, content, created_at')
      .eq('conversation_id', params.conversationId)
      .eq('workspace_id', params.workspaceId)
      .order('created_at', { ascending: true })
      .limit(params.limit ?? 200);

    if (error) {
      throw new AppError(error.message, 502, 'SUPABASE_ERROR');
    }

    return (data ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      }));
  }

  async saveUserMessage(params: {
    workspaceId: string;
    conversationId: string;
    content: string;
  }): Promise<MessageRow> {
    const client = requireServiceClient();
    const { data, error } = await client
      .from('conversation_messages')
      .insert({
        workspace_id: params.workspaceId,
        conversation_id: params.conversationId,
        role: 'user',
        content: params.content,
        is_error: false,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new AppError(error?.message ?? 'Failed to save message', 502, 'SUPABASE_ERROR');
    }
    await this.touch(params.conversationId, params.workspaceId);
    return data;
  }

  async saveAssistantMessage(params: {
    workspaceId: string;
    conversationId: string;
    content: string;
  }): Promise<MessageRow> {
    const client = requireServiceClient();
    const { data, error } = await client
      .from('conversation_messages')
      .insert({
        workspace_id: params.workspaceId,
        conversation_id: params.conversationId,
        role: 'assistant',
        content: params.content,
        is_error: false,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new AppError(error?.message ?? 'Failed to save message', 502, 'SUPABASE_ERROR');
    }
    await this.touch(params.conversationId, params.workspaceId);
    return data;
  }

  private async touch(conversationId: string, workspaceId: string): Promise<void> {
    const client = requireServiceClient();
    await client
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId);
  }
}

export const widgetRepository = new WidgetRepository();
