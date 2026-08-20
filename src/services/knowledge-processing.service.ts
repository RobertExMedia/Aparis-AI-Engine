import type { Job } from 'bullmq';
import { config } from '../config/index.js';
import { getAIProvider } from '../providers/index.js';
import { chunkText, estimateTokens } from '../knowledge/chunker.js';
import { resolveParser } from '../knowledge/parsers/index.js';
import { normalizeWhitespace } from '../knowledge/parsers/types.js';
import type { ProcessingSettings } from '../knowledge/types.js';
import { NOMIC_EMBED_DIMENSIONS } from '../knowledge/types.js';
import {
  progressForEmbeddingWork,
  type KnowledgeProcessingStage,
} from '../knowledge/processing-stages.js';
import { supabaseKnowledgeRepository } from '../repositories/supabase/knowledge.repository.js';
import { knowledgeJobProgressStore } from './knowledge-job-progress.service.js';
import { aiCreditsService } from './ai-credits.service.js';
import { ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function embeddingToPgVector(values: number[]): string {
  if (values.length !== NOMIC_EMBED_DIMENSIONS) {
    throw new ValidationError(
      `Unexpected embedding dimension ${values.length}; expected ${NOMIC_EMBED_DIMENSIONS} for nomic-embed-text`,
    );
  }
  return `[${values.join(',')}]`;
}

/** True when this BullMQ attempt is the last one (no further automatic retries). */
export function isFinalKnowledgeAttempt(bullmqJob?: Job): boolean {
  if (!bullmqJob) return true;
  const maxAttempts = bullmqJob.opts.attempts ?? 1;
  return bullmqJob.attemptsMade + 1 >= maxAttempts;
}

export interface ProcessSourceParams {
  accessToken: string;
  workspaceId: string;
  sourceId: string;
  processing?: Partial<ProcessingSettings>;
  reprocess?: boolean;
  actorId?: string;
  jobId: string;
  bullmqJob?: Job;
}

type Prepared = {
  content: string;
  token_count: number;
  source_page: number | null;
  knowledge_file_id: string | null;
  metadata: Record<string, unknown>;
};

type ChunkRow = {
  knowledge_source_id: string;
  knowledge_file_id: string | null;
  workspace_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  source_page: number | null;
  embedding_status: string;
  metadata: Record<string, unknown>;
  embedding: string;
};

/**
 * Real multi-stage knowledge processing pipeline.
 * Each stage updates Redis + BullMQ progress + Supabase (source settings / events).
 *
 * Embeddings are persisted per batch so a mid-run AI outage keeps partial chunks
 * instead of discarding the whole job.
 */
export class KnowledgeProcessingService {
  async processSource(params: ProcessSourceParams): Promise<{ status: string; chunkCount: number }> {
    const { accessToken, workspaceId, sourceId, jobId, bullmqJob, actorId } = params;
    let savedChunkCount = 0;
    const ctx: { lastStage: KnowledgeProcessingStage } = { lastStage: 'uploading' };

    const stage = async (
      name: Parameters<typeof knowledgeJobProgressStore.enterStage>[0]['stage'],
      extra?: { processedChunks?: number; totalChunks?: number | null },
    ) => {
      ctx.lastStage = name;
      await knowledgeJobProgressStore.enterStage({
        jobId,
        stage: name,
        bullmqJob,
        accessToken,
        actorId,
        ...extra,
      });
    };

    const complete = async (
      name: Parameters<typeof knowledgeJobProgressStore.completeStage>[0]['stage'],
      extra?: { processedChunks?: number; totalChunks?: number | null },
    ) => {
      ctx.lastStage = name;
      await knowledgeJobProgressStore.completeStage({
        jobId,
        stage: name,
        bullmqJob,
        accessToken,
        actorId,
        ...extra,
      });
    };

    try {
      await stage('uploading');

      const source = await supabaseKnowledgeRepository.assertSourceInWorkspace(
        accessToken,
        sourceId,
        workspaceId,
      );

      const processing = {
        ...supabaseKnowledgeRepository.readProcessingSettings(source),
        ...(params.processing ?? {}),
      };

      await supabaseKnowledgeRepository.updateSource(accessToken, sourceId, workspaceId, {
        status: 'processing',
        error_message: null,
        settings: {
          ...(source.settings ?? {}),
          processing,
        },
      });

      const files = await supabaseKnowledgeRepository.listFiles(accessToken, sourceId);
      // Uploading stage = verify / account for uploaded files (Hub uploads before process).
      await complete('uploading');

      // Always clear prior chunks so retries / reprocess never duplicate rows.
      // Within a single attempt, batches are saved incrementally (kept on final failure).
      await supabaseKnowledgeRepository.deleteChunksForSource(accessToken, sourceId, workspaceId);

      await stage('extracting_text');

      const extracted: Prepared[] = [];
      const maxFiles = config.knowledge.maxFilesPerSource;
      const maxChars = config.knowledge.maxExtractedCharacters;
      const maxChunks = config.knowledge.maxChunksPerSource;
      let extractedChars = 0;

      const textBody = (source.settings as { text?: { body?: string; title?: string } })?.text;
      if (textBody?.body?.trim()) {
        extracted.push({
          content: textBody.body,
          token_count: estimateTokens(textBody.body),
          source_page: null,
          knowledge_file_id: null,
          metadata: {
            filename: textBody.title || source.name,
            sourceType: 'text',
          },
        });
        extractedChars += textBody.body.length;
      }

      for (const file of files.slice(0, maxFiles)) {
        if (!file.storage_path) continue;
        if (file.file_size > config.knowledge.maxFileSizeBytes) {
          await supabaseKnowledgeRepository.updateFile(accessToken, file.id, {
            status: 'failed',
            error_message: 'File exceeds maximum size',
          });
          continue;
        }

        await supabaseKnowledgeRepository.updateFile(accessToken, file.id, {
          status: 'processing',
          error_message: null,
        });

        try {
          const buffer = await supabaseKnowledgeRepository.downloadFile(
            accessToken,
            file.storage_path,
          );
          const parser = resolveParser(file.file_name, file.file_type);
          const segments = await parser.parse(buffer, {
            fileName: file.file_name,
            mimeType: file.file_type,
          });

          for (const segment of segments) {
            extractedChars += segment.content.length;
            if (extractedChars > maxChars) {
              throw new ValidationError('Extracted content exceeds maximum allowed size');
            }
            extracted.push({
              content: segment.content,
              token_count: estimateTokens(segment.content),
              source_page:
                typeof segment.metadata.page === 'number' ? segment.metadata.page : null,
              knowledge_file_id: file.id,
              metadata: segment.metadata,
            });
          }

          await supabaseKnowledgeRepository.updateFile(accessToken, file.id, {
            status: 'ready',
            page_count:
              typeof segments[0]?.metadata.pageCount === 'number'
                ? segments[0].metadata.pageCount
                : null,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'File processing failed';
          await supabaseKnowledgeRepository.updateFile(accessToken, file.id, {
            status: 'failed',
            error_message: message.slice(0, 500),
          });
          throw err;
        }
      }

      if (extracted.length === 0) {
        throw new ValidationError('No content available to process for this knowledge source');
      }
      await complete('extracting_text');

      await stage('cleaning_content');
      const cleaned = extracted.map((item) => ({
        ...item,
        content: normalizeWhitespace(item.content),
      })).filter((item) => item.content.length > 0);
      if (cleaned.length === 0) {
        throw new ValidationError('No content remained after cleaning');
      }
      await complete('cleaning_content');

      await stage('chunking');
      const prepared: Prepared[] = [];
      for (const item of cleaned) {
        const chunks = chunkText(item.content, item.metadata, {
          chunkSizeTokens: processing.chunkSize,
          overlapTokens: processing.chunkOverlap,
          removeDuplicates: processing.removeDuplicates,
        });
        for (const c of chunks) {
          if (prepared.length >= maxChunks) break;
          prepared.push({
            content: c.content,
            token_count: c.tokenCount,
            source_page:
              item.source_page ??
              (typeof c.metadata.page === 'number' ? (c.metadata.page as number) : null),
            knowledge_file_id: item.knowledge_file_id,
            metadata: c.metadata,
          });
        }
        if (prepared.length >= maxChunks) break;
      }
      if (prepared.length === 0) {
        throw new ValidationError('Chunking produced no content');
      }
      await complete('chunking', {
        processedChunks: 0,
        totalChunks: prepared.length,
      });

      await stage('generating_embeddings', {
        processedChunks: 0,
        totalChunks: prepared.length,
      });

      await aiCreditsService.assertAvailable(accessToken, workspaceId);

      const provider = getAIProvider();
      const embedModel = processing.embeddingModel || config.ollama.embedModel;
      // Smaller batches reduce Ollama timeouts / OOM on larger customer docs.
      const batchSize = 4;
      let wordCount = 0;
      let characterCount = 0;

      for (let i = 0; i < prepared.length; i += batchSize) {
        const batch = prepared.slice(i, i + batchSize);
        const embedded = await provider.embeddings({
          input: batch.map((b) => b.content),
          model: embedModel,
        });

        const batchRows: ChunkRow[] = [];
        batch.forEach((item, idx) => {
          const vector = embedded.embeddings[idx];
          if (!vector) {
            throw new ValidationError('Embedding provider returned incomplete results');
          }
          wordCount += item.content.split(/\s+/).filter(Boolean).length;
          characterCount += item.content.length;
          batchRows.push({
            knowledge_source_id: sourceId,
            knowledge_file_id: item.knowledge_file_id,
            workspace_id: workspaceId,
            chunk_index: i + idx,
            content: item.content,
            token_count: item.token_count,
            source_page: item.source_page,
            embedding_status: 'embedded',
            metadata: item.metadata,
            embedding: embeddingToPgVector(vector),
          });
        });

        // Persist each batch immediately so a later AI outage keeps partial work.
        await supabaseKnowledgeRepository.insertChunks(accessToken, batchRows);
        savedChunkCount += batchRows.length;

        const processed = Math.min(i + batch.length, prepared.length);
        await knowledgeJobProgressStore.setEmbeddingProgress({
          jobId,
          processedChunks: processed,
          totalChunks: prepared.length,
          progress: progressForEmbeddingWork(processed, prepared.length),
          bullmqJob,
          accessToken,
        });
      }
      await complete('generating_embeddings', {
        processedChunks: savedChunkCount,
        totalChunks: prepared.length,
      });

      const embedPromptTokens = prepared.reduce((n, p) => n + (p.token_count || 0), 0);
      await aiCreditsService.settle({
        accessToken,
        workspaceId,
        promptTokens: embedPromptTokens,
        completionTokens: 0,
        endpoint: 'knowledge/embeddings',
        requestId: jobId,
        model: embedModel,
        status: 'success',
        metadata: { sourceId, chunkCount: savedChunkCount },
      });

      await stage('saving_chunks', {
        processedChunks: savedChunkCount,
        totalChunks: savedChunkCount,
      });
      // Chunks already written per batch; this stage finalizes counts for the UI.
      await complete('saving_chunks', {
        processedChunks: savedChunkCount,
        totalChunks: savedChunkCount,
      });

      await stage('indexing', {
        processedChunks: savedChunkCount,
        totalChunks: savedChunkCount,
      });

      const storageBytes = files.reduce((n, f) => n + (f.file_size || 0), 0);

      await supabaseKnowledgeRepository.updateSource(accessToken, sourceId, workspaceId, {
        status: 'ready',
        chunk_count: savedChunkCount,
        word_count: wordCount,
        character_count: characterCount,
        storage_bytes: storageBytes,
        last_processed_at: new Date().toISOString(),
        error_message: null,
      });
      await complete('indexing', {
        processedChunks: savedChunkCount,
        totalChunks: savedChunkCount,
      });

      await knowledgeJobProgressStore.markCompleted({
        jobId,
        bullmqJob,
        accessToken,
        actorId,
        processedChunks: savedChunkCount,
        totalChunks: savedChunkCount,
      });

      await supabaseKnowledgeRepository.addEvent(accessToken, {
        workspaceId,
        sourceId,
        eventType: 'process_completed',
        message: `Processed ${savedChunkCount} chunks`,
        actorId,
        metadata: { jobId, chunkCount: savedChunkCount },
      });

      logger.info(
        { sourceId, workspaceId, chunkCount: savedChunkCount, jobId },
        'Knowledge source processed',
      );

      return { status: 'ready', chunkCount: savedChunkCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Processing failed';
      const finalAttempt = isFinalKnowledgeAttempt(bullmqJob);

      if (finalAttempt) {
        await knowledgeJobProgressStore
          .markFailed({
            jobId,
            error: message,
            bullmqJob,
            accessToken,
            actorId,
          })
          .catch(() => undefined);

        // Keep any chunks already embedded in this attempt; surface partial counts.
        let partialWordCount = 0;
        let partialCharacterCount = 0;
        let chunkCount = savedChunkCount;
        try {
          const partial = await supabaseKnowledgeRepository.listChunks(accessToken, sourceId);
          chunkCount = partial.length;
          partialWordCount = partial.reduce(
            (n, r) => n + r.content.split(/\s+/).filter(Boolean).length,
            0,
          );
          partialCharacterCount = partial.reduce((n, r) => n + r.content.length, 0);
        } catch {
          // ignore — still mark failed below
        }

        const stageHint =
          ctx.lastStage === 'generating_embeddings'
            ? `Embedding interrupted (${savedChunkCount} chunk(s) saved). `
            : '';

        await supabaseKnowledgeRepository
          .updateSource(accessToken, sourceId, workspaceId, {
            status: 'failed',
            chunk_count: chunkCount,
            word_count: partialWordCount,
            character_count: partialCharacterCount,
            error_message: `${stageHint}${message}`.slice(0, 1000),
          })
          .catch(() => undefined);

        await supabaseKnowledgeRepository
          .addEvent(accessToken, {
            workspaceId,
            sourceId,
            eventType: 'process_failed',
            message: message.slice(0, 500),
            level: 'error',
            actorId,
            metadata: {
              jobId,
              failedStage: ctx.lastStage,
              savedChunkCount: chunkCount,
              finalAttempt: true,
            },
          })
          .catch(() => undefined);
      } else {
        // Intermediate BullMQ attempt — keep source "processing" so the UI does not
        // flash Failed while automatic retries are still running. Next attempt clears
        // and rebuilds chunks from scratch.
        logger.warn(
          {
            jobId,
            sourceId,
            workspaceId,
            attempt: (bullmqJob?.attemptsMade ?? 0) + 1,
            failedStage: ctx.lastStage,
            savedChunkCount,
            err: message,
          },
          'Knowledge process attempt failed; BullMQ will retry',
        );
      }

      throw err;
    }
  }

  async processSourceJob(
    payload: ProcessSourceParams,
  ): Promise<{ status: string; chunkCount: number }> {
    return this.processSource(payload);
  }
}

export const knowledgeProcessingService = new KnowledgeProcessingService();

export { estimateTokens };
