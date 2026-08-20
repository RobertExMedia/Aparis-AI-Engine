import type { Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { supabaseKnowledgeRepository } from '../repositories/supabase/knowledge.repository.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import {
  estimateRemainingMs,
  STAGE_PROGRESS_END,
  STAGE_PROGRESS_START,
  type KnowledgeJobProgress,
  type KnowledgeJobStatus,
  type KnowledgeProcessingStage,
} from '../knowledge/processing-stages.js';

const JOB_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function redisKey(jobId: string): string {
  return `knowledge:job:${jobId}`;
}

function getRedis() {
  return redis;
}

export async function closeKnowledgeJobStore(): Promise<void> {
  // Shared Redis client is closed via disconnectRedis() on shutdown.
}

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.floor(value)));
}

export class KnowledgeJobProgressStore {
  async createQueued(params: {
    jobId: string;
    workspaceId: string;
    sourceId: string;
    accessToken: string;
    actorId?: string;
  }): Promise<KnowledgeJobProgress> {
    const now = new Date().toISOString();
    const record: KnowledgeJobProgress = {
      id: params.jobId,
      workspaceId: params.workspaceId,
      sourceId: params.sourceId,
      status: 'queued',
      progress: STAGE_PROGRESS_START.queued,
      currentStage: 'queued',
      startedAt: null,
      finishedAt: null,
      estimatedRemainingMs: null,
      processedChunks: 0,
      totalChunks: null,
      errors: [],
      updatedAt: now,
    };
    await this.persist(record);

    await this.syncSourceJobSnapshot(params.accessToken, record).catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'Failed to sync job to source');
    });

    await supabaseKnowledgeRepository
      .addEvent(params.accessToken, {
        workspaceId: params.workspaceId,
        sourceId: params.sourceId,
        eventType: 'job_queued',
        message: `Processing job ${params.jobId} queued`,
        actorId: params.actorId,
        metadata: { jobId: params.jobId, stage: 'queued', progress: 0 },
      })
      .catch(() => undefined);

    return record;
  }

  async get(jobId: string): Promise<KnowledgeJobProgress | null> {
    const raw = await getRedis().get(redisKey(jobId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as KnowledgeJobProgress;
      return {
        ...parsed,
        estimatedRemainingMs: estimateRemainingMs(parsed.startedAt, parsed.progress),
      };
    } catch {
      return null;
    }
  }

  async require(jobId: string): Promise<KnowledgeJobProgress> {
    const job = await this.get(jobId);
    if (!job) throw new NotFoundError('Processing job not found');
    return job;
  }

  async update(
    jobId: string,
    patch: Partial<Omit<KnowledgeJobProgress, 'id'>> & {
      bullmqJob?: Job;
      accessToken?: string;
      actorId?: string;
      writeEvent?: boolean;
    },
  ): Promise<KnowledgeJobProgress> {
    const current = (await this.get(jobId)) ?? {
      id: jobId,
      workspaceId: patch.workspaceId ?? '',
      sourceId: patch.sourceId ?? '',
      status: 'queued' as KnowledgeJobStatus,
      progress: 0,
      currentStage: 'queued' as KnowledgeProcessingStage,
      startedAt: null,
      finishedAt: null,
      estimatedRemainingMs: null,
      processedChunks: 0,
      totalChunks: null,
      errors: [],
      updatedAt: new Date().toISOString(),
    };

    const { bullmqJob, accessToken, actorId, writeEvent, ...fields } = patch;
    const next: KnowledgeJobProgress = {
      ...current,
      ...fields,
      id: jobId,
      progress: clampProgress(fields.progress ?? current.progress),
      errors: fields.errors ?? current.errors,
      updatedAt: new Date().toISOString(),
    };
    next.estimatedRemainingMs = estimateRemainingMs(next.startedAt, next.progress);

    await this.persist(next);

    if (bullmqJob) {
      await bullmqJob.updateProgress({
        status: next.status,
        progress: next.progress,
        currentStage: next.currentStage,
        processedChunks: next.processedChunks,
        totalChunks: next.totalChunks,
        errors: next.errors,
        startedAt: next.startedAt,
        finishedAt: next.finishedAt,
        estimatedRemainingMs: next.estimatedRemainingMs,
      });
    }

    if (accessToken && next.workspaceId && next.sourceId) {
      await this.syncSourceJobSnapshot(accessToken, next).catch(() => undefined);
      if (writeEvent !== false && fields.currentStage && fields.currentStage !== current.currentStage) {
        await supabaseKnowledgeRepository
          .addEvent(accessToken, {
            workspaceId: next.workspaceId,
            sourceId: next.sourceId,
            eventType: `stage_${next.currentStage}`,
            message: `Stage: ${next.currentStage} (${next.progress}%)`,
            actorId,
            level: next.status === 'failed' ? 'error' : 'info',
            metadata: {
              jobId,
              stage: next.currentStage,
              progress: next.progress,
              processedChunks: next.processedChunks,
              totalChunks: next.totalChunks,
            },
          })
          .catch(() => undefined);
      }
    }

    return next;
  }

  async enterStage(params: {
    jobId: string;
    stage: KnowledgeProcessingStage;
    bullmqJob?: Job;
    accessToken: string;
    actorId?: string;
    processedChunks?: number;
    totalChunks?: number | null;
    status?: KnowledgeJobStatus;
  }): Promise<KnowledgeJobProgress> {
    const current = await this.require(params.jobId);
    const startedAt = current.startedAt ?? (params.stage === 'queued' ? null : new Date().toISOString());
    return this.update(params.jobId, {
      currentStage: params.stage,
      progress: STAGE_PROGRESS_START[params.stage],
      status: params.status ?? (params.stage === 'queued' ? 'queued' : 'active'),
      startedAt: params.stage === 'failed' || params.stage === 'completed' ? current.startedAt : startedAt,
      processedChunks: params.processedChunks ?? current.processedChunks,
      totalChunks: params.totalChunks === undefined ? current.totalChunks : params.totalChunks,
      workspaceId: current.workspaceId,
      sourceId: current.sourceId,
      bullmqJob: params.bullmqJob,
      accessToken: params.accessToken,
      actorId: params.actorId,
      writeEvent: true,
    });
  }

  async completeStage(params: {
    jobId: string;
    stage: Exclude<KnowledgeProcessingStage, 'completed' | 'failed' | 'queued'>;
    bullmqJob?: Job;
    accessToken: string;
    actorId?: string;
    processedChunks?: number;
    totalChunks?: number | null;
  }): Promise<KnowledgeJobProgress> {
    const current = await this.require(params.jobId);
    return this.update(params.jobId, {
      currentStage: params.stage,
      progress: STAGE_PROGRESS_END[params.stage],
      status: 'active',
      processedChunks: params.processedChunks ?? current.processedChunks,
      totalChunks: params.totalChunks === undefined ? current.totalChunks : params.totalChunks,
      workspaceId: current.workspaceId,
      sourceId: current.sourceId,
      bullmqJob: params.bullmqJob,
      accessToken: params.accessToken,
      actorId: params.actorId,
      writeEvent: false,
    });
  }

  async setEmbeddingProgress(params: {
    jobId: string;
    processedChunks: number;
    totalChunks: number;
    progress: number;
    bullmqJob?: Job;
    accessToken: string;
  }): Promise<KnowledgeJobProgress> {
    const current = await this.require(params.jobId);
    return this.update(params.jobId, {
      currentStage: 'generating_embeddings',
      status: 'active',
      progress: params.progress,
      processedChunks: params.processedChunks,
      totalChunks: params.totalChunks,
      workspaceId: current.workspaceId,
      sourceId: current.sourceId,
      bullmqJob: params.bullmqJob,
      accessToken: params.accessToken,
      writeEvent: false,
    });
  }

  async markCompleted(params: {
    jobId: string;
    bullmqJob?: Job;
    accessToken: string;
    actorId?: string;
    processedChunks: number;
    totalChunks: number;
  }): Promise<KnowledgeJobProgress> {
    return this.update(params.jobId, {
      status: 'completed',
      currentStage: 'completed',
      progress: 100,
      finishedAt: new Date().toISOString(),
      estimatedRemainingMs: 0,
      processedChunks: params.processedChunks,
      totalChunks: params.totalChunks,
      bullmqJob: params.bullmqJob,
      accessToken: params.accessToken,
      actorId: params.actorId,
      writeEvent: true,
    });
  }

  async markFailed(params: {
    jobId: string;
    error: string;
    bullmqJob?: Job;
    accessToken?: string;
    actorId?: string;
  }): Promise<KnowledgeJobProgress> {
    const current = await this.get(params.jobId);
    const errors = [...(current?.errors ?? [])];
    if (params.error && !errors.includes(params.error)) {
      errors.push(params.error.slice(0, 1000));
    }
    const lastStage = current?.currentStage;
    const failedStage =
      lastStage && lastStage !== 'failed' && lastStage !== 'completed'
        ? lastStage
        : (current?.failedStage ?? null);
    return this.update(params.jobId, {
      status: 'failed',
      currentStage: 'failed',
      failedStage,
      // Keep last real progress; do not invent 100 on failure.
      progress: current?.progress ?? 0,
      finishedAt: new Date().toISOString(),
      estimatedRemainingMs: null,
      errors,
      workspaceId: current?.workspaceId,
      sourceId: current?.sourceId,
      processedChunks: current?.processedChunks,
      totalChunks: current?.totalChunks,
      startedAt: current?.startedAt,
      bullmqJob: params.bullmqJob,
      accessToken: params.accessToken,
      actorId: params.actorId,
      writeEvent: true,
    });
  }

  private async persist(record: KnowledgeJobProgress): Promise<void> {
    await getRedis().set(redisKey(record.id), JSON.stringify(record), 'EX', JOB_TTL_SECONDS);
  }

  private async syncSourceJobSnapshot(
    accessToken: string,
    record: KnowledgeJobProgress,
  ): Promise<void> {
    const source = await supabaseKnowledgeRepository.getSource(
      accessToken,
      record.sourceId,
      record.workspaceId,
    );
    await supabaseKnowledgeRepository.updateSource(
      accessToken,
      record.sourceId,
      record.workspaceId,
      {
        settings: {
          ...(source.settings ?? {}),
          currentJob: {
            id: record.id,
            status: record.status,
            progress: record.progress,
            currentStage: record.currentStage,
            failedStage: record.failedStage ?? null,
            startedAt: record.startedAt,
            finishedAt: record.finishedAt,
            estimatedRemainingMs: record.estimatedRemainingMs,
            processedChunks: record.processedChunks,
            totalChunks: record.totalChunks,
            errors: record.errors,
            updatedAt: record.updatedAt,
          },
        },
      },
    );
  }
}

export const knowledgeJobProgressStore = new KnowledgeJobProgressStore();

/** Poll response shape for GET /knowledge/jobs/:id (snake_case + camelCase aliases). */
export function toJobApiResponse(job: KnowledgeJobProgress) {
  const estimatedRemainingMs = estimateRemainingMs(job.startedAt, job.progress);
  const failedStage = job.failedStage ?? null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    current_stage: job.currentStage,
    failed_stage: failedStage,
    current_stage_label: undefined as string | undefined,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    estimated_remaining_ms: estimatedRemainingMs,
    processed_chunks: job.processedChunks,
    total_chunks: job.totalChunks,
    errors: job.errors,
    workspace_id: job.workspaceId,
    source_id: job.sourceId,
    // camelCase aliases for clients already wired that way
    currentStage: job.currentStage,
    failedStage,
    stageLabel: undefined as string | undefined,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    estimatedRemainingMs,
    processedChunks: job.processedChunks,
    totalChunks: job.totalChunks,
    workspaceId: job.workspaceId,
    sourceId: job.sourceId,
  };
}
