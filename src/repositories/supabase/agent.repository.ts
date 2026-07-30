import { getServiceSupabaseClient, createUserSupabaseClient } from '../../supabase/client.js';
import {
  AgentNotFoundError,
  AgentUnavailableError,
} from '../../utils/errors.js';
import type { AgentConfiguration, AgentStatus } from '../../types/index.js';
import type { Tables } from '../../supabase/database.types.js';

type AgentRow = Tables<'agents'>;

function toConfig(row: AgentRow): AgentConfiguration {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    public_id: row.public_id,
    name: row.name,
    description: row.description,
    status: row.status as AgentStatus,
    system_prompt: row.system_prompt,
    greeting: row.greeting,
    fallback_message: row.fallback_message,
    language: row.language,
    tone: row.tone,
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

const AGENT_SELECT =
  'id, workspace_id, public_id, name, description, status, system_prompt, greeting, fallback_message, language, tone, temperature, max_tokens, settings, archived_at, published_at, avatar_url' as const;

/**
 * Loads agents from the real aparis-ai-hub `agents` table.
 */
export class SupabaseAgentRepository {
  async findById(agentId: string): Promise<AgentConfiguration | null> {
    const admin = getServiceSupabaseClient();
    const { data, error } = await admin
      .from('agents')
      .select(AGENT_SELECT)
      .eq('id', agentId)
      .maybeSingle();
    if (error || !data) return null;
    return toConfig(data as AgentRow);
  }

  async findByIdAndWorkspace(
    agentId: string,
    workspaceId: string,
  ): Promise<AgentConfiguration | null> {
    const admin = getServiceSupabaseClient();
    const { data, error } = await admin
      .from('agents')
      .select(AGENT_SELECT)
      .eq('id', agentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error || !data) return null;
    return toConfig(data as AgentRow);
  }

  async findPublishedByPublicId(publicId: string): Promise<AgentConfiguration | null> {
    const admin = getServiceSupabaseClient();
    const { data, error } = await admin
      .from('agents')
      .select(AGENT_SELECT)
      .eq('public_id', publicId)
      .eq('status', 'published')
      .maybeSingle();
    if (error || !data) return null;
    return toConfig(data as AgentRow);
  }

  async verifyWorkspaceOwnership(agentId: string, workspaceId: string): Promise<boolean> {
    const agent = await this.findByIdAndWorkspace(agentId, workspaceId);
    return Boolean(agent);
  }

  /**
   * Loads agent config for chat after membership is verified.
   * Rejects missing agents and archived agents.
   */
  async loadAgentConfiguration(
    agentId: string,
    workspaceId: string,
    accessToken?: string,
  ): Promise<AgentConfiguration> {
    let row: AgentRow | null = null;

    if (accessToken) {
      const userClient = createUserSupabaseClient(accessToken);
      const { data } = await userClient
        .from('agents')
        .select(AGENT_SELECT)
        .eq('id', agentId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      row = (data as AgentRow | null) ?? null;
    }

    if (!row) {
      const found = await this.findByIdAndWorkspace(agentId, workspaceId);
      if (!found) throw new AgentNotFoundError();
      this.assertAvailable(found);
      return found;
    }

    const config = toConfig(row);
    this.assertAvailable(config);
    return config;
  }

  private assertAvailable(agent: AgentConfiguration): void {
    if (agent.status === 'archived' || agent.archived_at) {
      throw new AgentUnavailableError();
    }
  }
}

export const supabaseAgentRepository = new SupabaseAgentRepository();
