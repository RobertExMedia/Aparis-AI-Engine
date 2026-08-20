import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';

function resolveWorkspaceId(request: FastifyRequest): string | undefined {
  if (request.auth && 'workspaceId' in request.auth && request.auth.workspaceId) {
    return request.auth.workspaceId;
  }
  const body = request.body as { workspaceId?: string } | undefined;
  if (body?.workspaceId) return body.workspaceId;
  return undefined;
}

/**
 * Tracks message count, tokens, and response time per authenticated request.
 */
export async function usageTracker(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  request.usageMeta = {
    messageCount: 0,
    startTime: Date.now(),
  };

  reply.raw.on('finish', () => {
    const meta = request.usageMeta;
    const workspaceId = resolveWorkspaceId(request);
    if (!meta || !workspaceId) return;

    const responseTimeMs = Date.now() - meta.startTime;

    void prisma.usageLog
      .create({
        data: {
          workspaceId,
          endpoint: request.routeOptions.url ?? request.url,
          method: request.method,
          statusCode: reply.statusCode,
          messageCount: meta.messageCount,
          promptTokens: meta.promptTokens,
          completionTokens: meta.completionTokens,
          totalTokens: meta.totalTokens,
          responseTimeMs,
        },
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to persist usage log');
      });

    logger.info(
      {
        workspaceId,
        endpoint: request.url,
        method: request.method,
        statusCode: reply.statusCode,
        messageCount: meta.messageCount,
        totalTokens: meta.totalTokens,
        responseTimeMs,
      },
      'Usage tracked',
    );
  });
}

export function recordUsage(
  request: FastifyRequest,
  data: {
    messageCount?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  },
): void {
  if (!request.usageMeta) return;
  if (data.messageCount !== undefined) request.usageMeta.messageCount = data.messageCount;
  if (data.promptTokens !== undefined) request.usageMeta.promptTokens = data.promptTokens;
  if (data.completionTokens !== undefined) {
    request.usageMeta.completionTokens = data.completionTokens;
  }
  if (data.totalTokens !== undefined) request.usageMeta.totalTokens = data.totalTokens;
}
