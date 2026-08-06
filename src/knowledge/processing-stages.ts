/**
 * Real processing pipeline stages.
 * Progress % is derived from completed work — never simulated/faked.
 */

export const KNOWLEDGE_PROCESSING_STAGES = [
  'queued',
  'uploading',
  'extracting_text',
  'cleaning_content',
  'chunking',
  'generating_embeddings',
  'saving_chunks',
  'indexing',
  'completed',
  'failed',
] as const;

export type KnowledgeProcessingStage = (typeof KNOWLEDGE_PROCESSING_STAGES)[number];

/** Progress floor when a stage begins (before any within-stage work). */
export const STAGE_PROGRESS_START: Record<KnowledgeProcessingStage, number> = {
  queued: 0,
  uploading: 1,
  extracting_text: 8,
  cleaning_content: 22,
  chunking: 32,
  generating_embeddings: 45,
  saving_chunks: 86,
  indexing: 93,
  completed: 100,
  failed: 0,
};

/** Progress when a stage finishes (before moving to the next). */
export const STAGE_PROGRESS_END: Record<KnowledgeProcessingStage, number> = {
  queued: 0,
  uploading: 8,
  extracting_text: 22,
  cleaning_content: 32,
  chunking: 45,
  generating_embeddings: 86,
  saving_chunks: 93,
  indexing: 99,
  completed: 100,
  failed: 0,
};

export type KnowledgeJobStatus = 'queued' | 'active' | 'completed' | 'failed';

export interface KnowledgeJobProgress {
  id: string;
  workspaceId: string;
  sourceId: string;
  status: KnowledgeJobStatus;
  /** 0–100, based on completed stages / chunk work only. */
  progress: number;
  currentStage: KnowledgeProcessingStage;
  startedAt: string | null;
  finishedAt: string | null;
  /** Milliseconds; null when not enough real progress to estimate. */
  estimatedRemainingMs: number | null;
  processedChunks: number;
  totalChunks: number | null;
  errors: string[];
  updatedAt: string;
}

export function displayStageName(stage: KnowledgeProcessingStage): string {
  switch (stage) {
    case 'queued':
      return 'Queued';
    case 'uploading':
      return 'Uploading';
    case 'extracting_text':
      return 'Extracting Text';
    case 'cleaning_content':
      return 'Cleaning Content';
    case 'chunking':
      return 'Chunking';
    case 'generating_embeddings':
      return 'Generating Embeddings';
    case 'saving_chunks':
      return 'Saving Chunks';
    case 'indexing':
      return 'Indexing';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return stage;
  }
}

/**
 * Within-stage progress for embedding generation.
 * Uses actual processed/total chunk counts — never interpolates time.
 */
export function progressForEmbeddingWork(
  processedChunks: number,
  totalChunks: number,
): number {
  const start = STAGE_PROGRESS_START.generating_embeddings;
  const end = STAGE_PROGRESS_END.generating_embeddings;
  if (totalChunks <= 0) return start;
  const ratio = Math.min(1, Math.max(0, processedChunks / totalChunks));
  return Math.floor(start + ratio * (end - start));
}

/**
 * ETA from elapsed wall time and real progress only.
 * Returns null until progress is meaningful enough to avoid nonsense estimates.
 */
export function estimateRemainingMs(
  startedAt: string | null,
  progress: number,
  now = Date.now(),
): number | null {
  if (!startedAt || progress < 5 || progress >= 100) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || started > now) return null;
  const elapsed = now - started;
  if (elapsed < 1_000) return null;
  const remaining = Math.round((elapsed * (100 - progress)) / progress);
  return Math.max(0, remaining);
}
