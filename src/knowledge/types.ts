export type KnowledgeType =
  | 'documents'
  | 'website'
  | 'sitemap'
  | 'urls'
  | 'faq'
  | 'table'
  | 'text'
  | 'catalog'
  | 'policies'
  | 'internal_docs';

export type KnowledgeStatus =
  | 'draft'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'archived';

export type KnowledgeFileStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'failed';

export type EmbeddingStatus = 'pending' | 'processing' | 'embedded' | 'failed';

export interface ProcessingSettings {
  chunkSize: number;
  chunkOverlap: number;
  detectLanguage: boolean;
  removeHeadersFooters: boolean;
  removeDuplicates: boolean;
  preserveTables: boolean;
  extractImageCaptions: boolean;
  ocr: boolean;
  extractMetadata: boolean;
  embeddingModel: string;
  priority: 'low' | 'normal' | 'high';
}

export const DEFAULT_PROCESSING_SETTINGS: ProcessingSettings = {
  chunkSize: 800,
  chunkOverlap: 120,
  detectLanguage: true,
  removeHeadersFooters: true,
  removeDuplicates: true,
  preserveTables: true,
  extractImageCaptions: false,
  ocr: false,
  extractMetadata: true,
  embeddingModel: 'nomic-embed-text',
  priority: 'normal',
};

export interface ExtractedSegment {
  content: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeCitation {
  sourceId: string;
  sourceName: string;
  fileId?: string;
  fileName?: string;
  page?: number;
  sheet?: string;
  slide?: number;
  url?: string;
  chunkId: string;
  similarity: number;
}

export interface ChatKnowledgePayload {
  used: boolean;
  sources: KnowledgeCitation[];
}

export const KNOWLEDGE_BUCKET = 'knowledge-files';
export const NOMIC_EMBED_DIMENSIONS = 768;
