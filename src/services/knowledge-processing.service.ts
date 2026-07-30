import { config } from '../config/index.js';
import { getAIProvider } from '../providers/index.js';
import { chunkText, estimateTokens } from '../knowledge/chunker.js';
import { resolveParser } from '../knowledge/parsers/index.js';
import type { ProcessingSettings } from '../knowledge/types.js';
import { NOMIC_EMBED_DIMENSIONS } from '../knowledge/types.js';
import { supabaseKnowledgeRepository } from '../repositories/supabase/knowledge.repository.js';
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

export class KnowledgeProcessingService {
  async processSource(params: {
    accessToken: string;
    workspaceId: string;
    sourceId: string;
    processing?: Partial<ProcessingSettings>;
    reprocess?: boolean;
    actorId?: string;
  }): Promise<{ status: string; chunkCount: number }> {
    const { accessToken, workspaceId, sourceId } = params;
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

    await supabaseKnowledgeRepository.addEvent(accessToken, {
      workspaceId,
      sourceId,
      eventType: params.reprocess ? 'reprocess_started' : 'process_started',
      message: params.reprocess ? 'Reprocessing started' : 'Processing started',
      actorId: params.actorId,
    });

    try {
      if (params.reprocess) {
        await supabaseKnowledgeRepository.deleteChunksForSource(accessToken, sourceId, workspaceId);
      }

      const files = await supabaseKnowledgeRepository.listFiles(accessToken, sourceId);
      const prepared: Array<{
        content: string;
        token_count: number;
        source_page: number | null;
        knowledge_file_id: string | null;
        metadata: Record<string, unknown>;
      }> = [];

      // Manual text sources may have body in settings with zero files.
      const textBody = (source.settings as { text?: { body?: string; title?: string } })?.text;
      if (textBody?.body?.trim()) {
        const chunks = chunkText(
          textBody.body,
          {
            filename: textBody.title || source.name,
            sourceType: 'text',
          },
          {
            chunkSizeTokens: processing.chunkSize,
            overlapTokens: processing.chunkOverlap,
            removeDuplicates: processing.removeDuplicates,
          },
        );
        for (const c of chunks) {
          prepared.push({
            content: c.content,
            token_count: c.tokenCount,
            source_page: null,
            knowledge_file_id: null,
            metadata: c.metadata,
          });
        }
      }

      const maxFiles = config.knowledge.maxFilesPerSource;
      const maxChars = config.knowledge.maxExtractedCharacters;
      const maxChunks = config.knowledge.maxChunksPerSource;
      let extractedChars = 0;

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
            const chunks = chunkText(segment.content, segment.metadata, {
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
                  typeof segment.metadata.page === 'number'
                    ? segment.metadata.page
                    : typeof c.metadata.page === 'number'
                      ? (c.metadata.page as number)
                      : null,
                knowledge_file_id: file.id,
                metadata: c.metadata,
              });
            }
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

      if (prepared.length === 0) {
        throw new ValidationError('No content available to process for this knowledge source');
      }

      const provider = getAIProvider();
      const embedModel = processing.embeddingModel || config.ollama.embedModel;
      const rows: Array<{
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
      }> = [];

      // Batch embeddings in small groups to avoid oversized payloads.
      const batchSize = 8;
      for (let i = 0; i < prepared.length; i += batchSize) {
        const batch = prepared.slice(i, i + batchSize);
        const embedded = await provider.embeddings({
          input: batch.map((b) => b.content),
          model: embedModel,
        });
        batch.forEach((item, idx) => {
          const vector = embedded.embeddings[idx];
          if (!vector) {
            throw new ValidationError('Embedding provider returned incomplete results');
          }
          rows.push({
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
      }

      await supabaseKnowledgeRepository.insertChunks(accessToken, rows);

      const wordCount = rows.reduce((n, r) => n + r.content.split(/\s+/).filter(Boolean).length, 0);
      const characterCount = rows.reduce((n, r) => n + r.content.length, 0);
      const storageBytes = files.reduce((n, f) => n + (f.file_size || 0), 0);

      await supabaseKnowledgeRepository.updateSource(accessToken, sourceId, workspaceId, {
        status: 'ready',
        chunk_count: rows.length,
        word_count: wordCount,
        character_count: characterCount,
        storage_bytes: storageBytes,
        last_processed_at: new Date().toISOString(),
        error_message: null,
      });

      await supabaseKnowledgeRepository.addEvent(accessToken, {
        workspaceId,
        sourceId,
        eventType: 'process_completed',
        message: `Processed ${rows.length} chunks`,
        actorId: params.actorId,
        metadata: { chunkCount: rows.length },
      });

      logger.info(
        { sourceId, workspaceId, chunkCount: rows.length },
        'Knowledge source processed',
      );

      return { status: 'ready', chunkCount: rows.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Processing failed';
      await supabaseKnowledgeRepository
        .updateSource(accessToken, sourceId, workspaceId, {
          status: 'failed',
          error_message: message.slice(0, 1000),
        })
        .catch(() => undefined);

      await supabaseKnowledgeRepository
        .addEvent(accessToken, {
          workspaceId,
          sourceId,
          eventType: 'process_failed',
          message: message.slice(0, 500),
          level: 'error',
          actorId: params.actorId,
        })
        .catch(() => undefined);

      throw err;
    }
  }

  /** Used by queue workers — same path as HTTP process. */
  async processSourceJob(payload: {
    accessToken: string;
    workspaceId: string;
    sourceId: string;
    processing?: Partial<ProcessingSettings>;
    reprocess?: boolean;
    actorId?: string;
  }): Promise<{ status: string; chunkCount: number }> {
    return this.processSource(payload);
  }
}

export const knowledgeProcessingService = new KnowledgeProcessingService();

export { estimateTokens };
