import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/index.js';
import { redis } from '../config/redis.js';

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    redis: redis as never,
    keyGenerator: (request) => {
      if (request.auth?.method === 'widget') {
        return `rl:widget:${request.auth.widgetKeyId}:${request.ip}`;
      }
      if (request.auth?.method === 'supabase' && request.auth.userId) {
        return `rl:user:${request.auth.userId}`;
      }
      const workspaceId =
        request.auth && 'workspaceId' in request.auth
          ? request.auth.workspaceId
          : undefined;
      if (workspaceId) return `rl:ws:${workspaceId}`;
      const widgetKey = request.headers['x-widget-key'];
      if (typeof widgetKey === 'string') return `rl:wpk:${widgetKey.slice(0, 16)}:${request.ip}`;
      const apiKey = request.headers['x-api-key'];
      if (typeof apiKey === 'string') return `rl:key:${apiKey.slice(0, 16)}`;
      return `rl:ip:${request.ip}`;
    },
    errorResponseBuilder: () => ({
      error: 'RATE_LIMITED',
      message: 'Too many requests. Please try again shortly.',
    }),
  });
}
