import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/index.js';
import { redis } from '../config/redis.js';

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    // ioredis v5 instance is compatible at runtime
    redis: redis as never,
    keyGenerator: (request) => {
      const workspaceId = request.auth?.workspaceId;
      if (workspaceId) return `rl:ws:${workspaceId}`;
      const apiKey = request.headers['x-api-key'];
      if (typeof apiKey === 'string') return `rl:key:${apiKey.slice(0, 16)}`;
      return `rl:ip:${request.ip}`;
    },
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    }),
  });
}
