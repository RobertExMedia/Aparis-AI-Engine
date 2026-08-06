import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../config/index.js';
import { knowledgeProcessingService } from '../services/knowledge-processing.service.js';
import { knowledgeJobProgressStore } from '../services/knowledge-job-progress.service.js';
import { logger } from '../utils/logger.js';
import type { ProcessingSettings } from '../knowledge/types.js';

const connection = { url: config.redisUrl };

export const knowledgeQueue = new Queue('knowledge-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    // Keep completed/failed jobs so GET /jobs/:id still works after restart.
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
    removeOnFail: { age: 60 * 60 * 24 * 14, count: 1000 },
  },
});

export type KnowledgeJobName = 'process-source';

export interface ProcessSourceJobData {
  accessToken: string;
  workspaceId: string;
  sourceId: string;
  processing?: Partial<ProcessingSettings>;
  reprocess?: boolean;
  actorId?: string;
  /** Stable idempotency / BullMQ job id. */
  idempotencyKey: string;
}

export async function enqueueKnowledgeProcess(
  data: ProcessSourceJobData,
): Promise<{ jobId: string }> {
  const jobId = data.idempotencyKey;

  const existing = await knowledgeQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    // Active/waiting jobs survive restarts — do not reset Redis progress.
    if (state !== 'completed' && state !== 'failed') {
      const snapshot = await knowledgeJobProgressStore.get(jobId);
      if (!snapshot) {
        await knowledgeJobProgressStore.createQueued({
          jobId,
          workspaceId: data.workspaceId,
          sourceId: data.sourceId,
          accessToken: data.accessToken,
          actorId: data.actorId,
        });
      }
      return { jobId };
    }
    await existing.remove();
  }

  await knowledgeJobProgressStore.createQueued({
    jobId,
    workspaceId: data.workspaceId,
    sourceId: data.sourceId,
    accessToken: data.accessToken,
    actorId: data.actorId,
  });

  await knowledgeQueue.add('process-source', data, { jobId });

  return { jobId };
}

let workerStarted = false;

export function startKnowledgeWorker(): Worker | null {
  if (workerStarted) return null;
  workerStarted = true;

  const worker = new Worker<ProcessSourceJobData>(
    'knowledge-processing',
    async (job: Job<ProcessSourceJobData>) => {
      logger.info(
        {
          jobId: job.id,
          sourceId: job.data.sourceId,
          workspaceId: job.data.workspaceId,
          attempt: job.attemptsMade + 1,
        },
        'Knowledge process job started',
      );

      return knowledgeProcessingService.processSourceJob({
        ...job.data,
        jobId: String(job.id),
        bullmqJob: job,
      });
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, sourceId: job?.data.sourceId, err: err.message },
      'Knowledge process job failed',
    );
    if (job?.id) {
      void knowledgeJobProgressStore
        .markFailed({
          jobId: String(job.id),
          error: err.message,
          accessToken: job.data.accessToken,
          actorId: job.data.actorId,
        })
        .catch(() => undefined);
    }
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, sourceId: job.data.sourceId }, 'Knowledge process job completed');
  });

  logger.info('Knowledge processing worker started');
  return worker;
}
