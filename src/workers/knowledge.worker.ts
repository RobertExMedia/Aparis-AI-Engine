import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../config/index.js';
import { knowledgeProcessingService } from '../services/knowledge-processing.service.js';
import { logger } from '../utils/logger.js';
import type { ProcessingSettings } from '../knowledge/types.js';

const connection = { url: config.redisUrl };

export const knowledgeQueue = new Queue('knowledge-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
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
  /** Idempotency key (sourceId + reprocess flag + settings hash). */
  idempotencyKey: string;
}

export async function enqueueKnowledgeProcess(
  data: ProcessSourceJobData,
): Promise<{ jobId: string }> {
  const job = await knowledgeQueue.add('process-source', data, {
    jobId: data.idempotencyKey,
  });
  return { jobId: String(job.id) };
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
      return knowledgeProcessingService.processSourceJob(job.data);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, sourceId: job?.data.sourceId, err: err.message },
      'Knowledge process job failed',
    );
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, sourceId: job.data.sourceId }, 'Knowledge process job completed');
  });

  logger.info('Knowledge processing worker started');
  return worker;
}
