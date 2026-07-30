/**
 * Knowledge service interface — Supabase integration deferred.
 * Implementations will connect to vector store / Supabase later.
 */

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
}

export interface KnowledgeIndexParams {
  workspaceId: string;
  documents: Array<{
    id?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface KnowledgeDeleteParams {
  workspaceId: string;
  documentIds: string[];
}

export interface KnowledgeService {
  search(params: KnowledgeSearchParams): Promise<KnowledgeDocument[]>;
  index(params: KnowledgeIndexParams): Promise<{ indexed: number }>;
  delete(params: KnowledgeDeleteParams): Promise<{ deleted: number }>;
}

/**
 * Stub implementation — returns empty results until Supabase is wired.
 */
export class StubKnowledgeService implements KnowledgeService {
  async search(_params: KnowledgeSearchParams): Promise<KnowledgeDocument[]> {
    return [];
  }

  async index(params: KnowledgeIndexParams): Promise<{ indexed: number }> {
    return { indexed: params.documents.length };
  }

  async delete(params: KnowledgeDeleteParams): Promise<{ deleted: number }> {
    return { deleted: params.documentIds.length };
  }
}

export const knowledgeService: KnowledgeService = new StubKnowledgeService();
