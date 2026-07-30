import { createUserSupabaseClient } from '../../supabase/client.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { throwSupabaseError } from '../../utils/supabase-error.js';
import { KNOWLEDGE_BUCKET } from '../../knowledge/types.js';
import type {
  KnowledgeStatus,
  KnowledgeType,
  ProcessingSettings,
} from '../../knowledge/types.js';
import { DEFAULT_PROCESSING_SETTINGS } from '../../knowledge/types.js';

/** Untyped client until Database types are fully regenerated from Hub. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KbClient = any;

function kb(accessToken: string): KbClient {
  return createUserSupabaseClient(accessToken);
}

export type KnowledgeSourceRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  type: KnowledgeType;
  status: KnowledgeStatus;
  language: string;
  category: string | null;
  tags: string[];
  visibility: string;
  settings: Record<string, unknown>;
  storage_bytes: number;
  chunk_count: number;
  word_count: number;
  character_count: number;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_processed_at: string | null;
  last_synced_at: string | null;
};

export type KnowledgeFileRow = {
  id: string;
  knowledge_source_id: string;
  workspace_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string | null;
  source_url: string | null;
  status: string;
  page_count: number | null;
  row_count: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type KnowledgeChunkRow = {
  id: string;
  knowledge_source_id: string;
  knowledge_file_id: string | null;
  workspace_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  source_page: number | null;
  embedding_status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AgentKnowledgeRow = {
  id: string;
  workspace_id: string;
  agent_id: string;
  knowledge_source_id: string;
  enabled: boolean;
  priority: number;
  required: boolean;
  created_at: string;
  updated_at: string;
};

export class SupabaseKnowledgeRepository {
  async listSources(accessToken: string, workspaceId: string): Promise<KnowledgeSourceRow[]> {
    const { data, error } = await kb(accessToken)
      .from('knowledge_sources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) throwSupabaseError('Failed to list knowledge sources', error);
    return (data ?? []) as KnowledgeSourceRow[];
  }

  async getSource(
    accessToken: string,
    sourceId: string,
    workspaceId?: string,
  ): Promise<KnowledgeSourceRow> {
    let query = kb(accessToken).from('knowledge_sources').select('*').eq('id', sourceId);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);
    const { data, error } = await query.maybeSingle();
    if (error) throwSupabaseError('Failed to load knowledge source', error);
    if (!data) throw new NotFoundError('Knowledge source not found');
    return data as KnowledgeSourceRow;
  }

  async assertSourceInWorkspace(
    accessToken: string,
    sourceId: string,
    workspaceId: string,
  ): Promise<KnowledgeSourceRow> {
    const source = await this.getSource(accessToken, sourceId, workspaceId);
    if (source.workspace_id !== workspaceId) throw new ForbiddenError();
    return source;
  }

  async createSource(
    accessToken: string,
    input: {
      workspaceId: string;
      createdBy: string;
      name: string;
      description?: string | null;
      type: KnowledgeType;
      language?: string;
      category?: string | null;
      tags?: string[];
      settings?: Record<string, unknown>;
      status?: KnowledgeStatus;
    },
  ): Promise<KnowledgeSourceRow> {
    const { data, error } = await kb(accessToken)
      .from('knowledge_sources')
      .insert({
        workspace_id: input.workspaceId,
        created_by: input.createdBy,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        type: input.type,
        status: input.status ?? 'draft',
        language: input.language ?? 'en',
        category: input.category?.trim() || null,
        tags: input.tags ?? [],
        settings: input.settings ?? {},
      })
      .select('*')
      .single();
    if (error || !data) throwSupabaseError('Failed to create knowledge source', error);
    return data as KnowledgeSourceRow;
  }

  async updateSource(
    accessToken: string,
    sourceId: string,
    workspaceId: string,
    patch: Record<string, unknown>,
  ): Promise<KnowledgeSourceRow> {
    await this.assertSourceInWorkspace(accessToken, sourceId, workspaceId);
    const { data, error } = await kb(accessToken)
      .from('knowledge_sources')
      .update(patch)
      .eq('id', sourceId)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single();
    if (error || !data) throwSupabaseError('Failed to update knowledge source', error);
    return data as KnowledgeSourceRow;
  }

  async deleteSource(accessToken: string, sourceId: string, workspaceId: string): Promise<void> {
    await this.assertSourceInWorkspace(accessToken, sourceId, workspaceId);
    const { error } = await kb(accessToken)
      .from('knowledge_sources')
      .delete()
      .eq('id', sourceId)
      .eq('workspace_id', workspaceId);
    if (error) throwSupabaseError('Failed to delete knowledge source', error);
  }

  async listFiles(accessToken: string, sourceId: string): Promise<KnowledgeFileRow[]> {
    const { data, error } = await kb(accessToken)
      .from('knowledge_files')
      .select('*')
      .eq('knowledge_source_id', sourceId)
      .order('created_at', { ascending: true });
    if (error) throwSupabaseError('Failed to list knowledge files', error);
    return (data ?? []) as KnowledgeFileRow[];
  }

  async updateFile(
    accessToken: string,
    fileId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await kb(accessToken).from('knowledge_files').update(patch).eq('id', fileId);
    if (error) throwSupabaseError('Failed to update knowledge file', error);
  }

  async downloadFile(
    accessToken: string,
    storagePath: string,
  ): Promise<Buffer> {
    const { data, error } = await kb(accessToken).storage.from(KNOWLEDGE_BUCKET).download(storagePath);
    if (error || !data) throwSupabaseError('Failed to download knowledge file', error);
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  }

  async deleteChunksForSource(accessToken: string, sourceId: string, workspaceId: string): Promise<void> {
    const { error } = await kb(accessToken)
      .from('knowledge_chunks')
      .delete()
      .eq('knowledge_source_id', sourceId)
      .eq('workspace_id', workspaceId);
    if (error) throwSupabaseError('Failed to delete knowledge chunks', error);
  }

  async insertChunks(
    accessToken: string,
    rows: Array<{
      knowledge_source_id: string;
      knowledge_file_id: string | null;
      workspace_id: string;
      chunk_index: number;
      content: string;
      token_count: number;
      source_page: number | null;
      embedding_status: string;
      metadata: Record<string, unknown>;
      embedding?: string | null;
    }>,
  ): Promise<KnowledgeChunkRow[]> {
    if (rows.length === 0) return [];
    const { data, error } = await kb(accessToken).from('knowledge_chunks').insert(rows).select('*');
    if (error) throwSupabaseError('Failed to insert knowledge chunks', error);
    return (data ?? []) as KnowledgeChunkRow[];
  }

  async listChunks(accessToken: string, sourceId: string): Promise<KnowledgeChunkRow[]> {
    const { data, error } = await kb(accessToken)
      .from('knowledge_chunks')
      .select('*')
      .eq('knowledge_source_id', sourceId)
      .order('chunk_index', { ascending: true })
      .limit(500);
    if (error) throwSupabaseError('Failed to list knowledge chunks', error);
    return (data ?? []) as KnowledgeChunkRow[];
  }

  async updateChunk(
    accessToken: string,
    chunkId: string,
    workspaceId: string,
    patch: { content?: string },
  ): Promise<KnowledgeChunkRow> {
    const { data, error } = await kb(accessToken)
      .from('knowledge_chunks')
      .update({
        ...patch,
        embedding_status: patch.content !== undefined ? 'pending' : undefined,
      })
      .eq('id', chunkId)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single();
    if (error || !data) throwSupabaseError('Failed to update knowledge chunk', error);
    return data as KnowledgeChunkRow;
  }

  async deleteChunk(accessToken: string, chunkId: string, workspaceId: string): Promise<void> {
    const { error } = await kb(accessToken)
      .from('knowledge_chunks')
      .delete()
      .eq('id', chunkId)
      .eq('workspace_id', workspaceId);
    if (error) throwSupabaseError('Failed to delete knowledge chunk', error);
  }

  async attachToAgent(
    accessToken: string,
    input: {
      workspaceId: string;
      agentId: string;
      sourceId: string;
      enabled?: boolean;
      priority?: number;
      required?: boolean;
    },
  ): Promise<AgentKnowledgeRow> {
    const { data, error } = await kb(accessToken)
      .from('agent_knowledge_sources')
      .upsert(
        {
          workspace_id: input.workspaceId,
          agent_id: input.agentId,
          knowledge_source_id: input.sourceId,
          enabled: input.enabled ?? true,
          priority: input.priority ?? 1,
          required: input.required ?? false,
        },
        { onConflict: 'agent_id,knowledge_source_id' },
      )
      .select('*')
      .single();
    if (error || !data) throwSupabaseError('Failed to attach knowledge to agent', error);
    return data as AgentKnowledgeRow;
  }

  async patchAgentSource(
    accessToken: string,
    agentId: string,
    sourceId: string,
    workspaceId: string,
    patch: { enabled?: boolean; priority?: number; required?: boolean },
  ): Promise<AgentKnowledgeRow> {
    const { data, error } = await kb(accessToken)
      .from('agent_knowledge_sources')
      .update(patch)
      .eq('agent_id', agentId)
      .eq('knowledge_source_id', sourceId)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single();
    if (error || !data) throwSupabaseError('Failed to update agent knowledge assignment', error);
    return data as AgentKnowledgeRow;
  }

  async detachFromAgent(
    accessToken: string,
    agentId: string,
    sourceId: string,
    workspaceId: string,
  ): Promise<void> {
    const { error } = await kb(accessToken)
      .from('agent_knowledge_sources')
      .delete()
      .eq('agent_id', agentId)
      .eq('knowledge_source_id', sourceId)
      .eq('workspace_id', workspaceId);
    if (error) throwSupabaseError('Failed to detach knowledge from agent', error);
  }

  async matchChunks(
    accessToken: string,
    params: {
      embedding: number[];
      workspaceId: string;
      agentId: string;
      topK: number;
      threshold: number;
    },
  ): Promise<
    Array<{
      id: string;
      knowledge_source_id: string;
      knowledge_file_id: string | null;
      content: string;
      metadata: Record<string, unknown>;
      source_page: number | null;
      similarity: number;
      source_name: string;
      file_name: string | null;
      source_url: string | null;
      priority: number;
      required: boolean;
    }>
  > {
    const { data, error } = await kb(accessToken).rpc('match_knowledge_chunks', {
      query_embedding: JSON.stringify(params.embedding),
      match_workspace_id: params.workspaceId,
      match_agent_id: params.agentId,
      match_count: params.topK,
      match_threshold: params.threshold,
    });
    if (error) throwSupabaseError('Failed to retrieve knowledge chunks', error);
    return (data ?? []) as Array<{
      id: string;
      knowledge_source_id: string;
      knowledge_file_id: string | null;
      content: string;
      metadata: Record<string, unknown>;
      source_page: number | null;
      similarity: number;
      source_name: string;
      file_name: string | null;
      source_url: string | null;
      priority: number;
      required: boolean;
    }>;
  }

  async addEvent(
    accessToken: string,
    input: {
      workspaceId: string;
      sourceId: string;
      eventType: string;
      message: string;
      level?: string;
      actorId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const { error } = await kb(accessToken).from('knowledge_events').insert({
      workspace_id: input.workspaceId,
      knowledge_source_id: input.sourceId,
      event_type: input.eventType,
      message: input.message,
      level: input.level ?? 'info',
      actor_id: input.actorId ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) throwSupabaseError('Failed to write knowledge event', error);
  }

  readProcessingSettings(source: KnowledgeSourceRow): ProcessingSettings {
    const settings = (source.settings ?? {}) as { processing?: Partial<ProcessingSettings> };
    return { ...DEFAULT_PROCESSING_SETTINGS, ...(settings.processing ?? {}) };
  }
}

export const supabaseKnowledgeRepository = new SupabaseKnowledgeRepository();
