/**
 * BullMQ workers placeholder.
 * Future: async embedding jobs, knowledge indexing, usage aggregation.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const connection = { url: config.redisUrl };

export const aiJobsQueue = new Queue('ai-jobs', { connection });

export type AiJobName = 'embed' | 'index-knowledge' | 'usage-aggregate';

export interface AiJobPayload {
  workspaceId: string;
  [key: string]: unknown;
}

export function startWorkers(): Worker {
  const worker = new Worker(
    'ai-jobs',
    async (job: Job<AiJobPayload, unknown, AiJobName>) => {
      logger.info({ jobId: job.id, name: job.name, workspaceId: job.data.workspaceId }, 'Processing job');
      switch (job.name) {
        case 'embed':
        case 'index-knowledge':
        case 'usage-aggregate':
          // Intentionally no-op until features land
          return { ok: true };
        default:
          logger.warn({ name: job.name }, 'Unknown job type');
          return { ok: false };
      }
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job failed');
  });

  logger.info('BullMQ workers started');
  return worker;
}
