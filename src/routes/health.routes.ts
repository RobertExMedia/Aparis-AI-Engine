import type { FastifyInstance } from 'fastify';
import { healthController } from '../controllers/health.controller.js';

const healthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
    checks: { type: 'object', additionalProperties: true },
    timestamp: { type: 'string' },
    version: { type: 'string' },
  },
} as const;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'System health check',
        description: 'Checks Database, Redis, Ollama, Disk, and Memory.',
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    (req, reply) => healthController.check(req, reply),
  );
}
