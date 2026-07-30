/**
 * Knowledge facade — retrieval for chat uses KnowledgeRetrievalService.
 * Indexing/deletion of arbitrary docs is handled by knowledge processing + Hub tables.
 */
import { knowledgeRetrievalService } from './knowledge-retrieval.service.js';

export interface KnowledgeDocument {
  id: string;
  workspaceId: string;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

export interface KnowledgeSearchParams {
  workspaceId: string;
  query: string;
  limit?: number;
  agentId?: string;
  accessToken?: string;
}

export interface KnowledgeService {
  search(params: KnowledgeSearchParams): Promise<KnowledgeDocument[]>;
}

export class SupabaseKnowledgeService implements KnowledgeService {
  async search(params: KnowledgeSearchParams): Promise<KnowledgeDocument[]> {
    if (!params.accessToken || !params.agentId) return [];
    const result = await knowledgeRetrievalService.retrieve({
      accessToken: params.accessToken,
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      query: params.query,
      topK: params.limit,
    });
    return result.citations.map((c, i) => ({
      id: c.chunkId,
      workspaceId: params.workspaceId,
      content: result.texts[i] ?? '',
      score: c.similarity,
      metadata: { ...c },
    }));
  }
}

export const knowledgeService: KnowledgeService = new SupabaseKnowledgeService();
