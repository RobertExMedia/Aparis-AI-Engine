import type { FastifyInstance } from 'fastify';
import { healthController } from '../controllers/health.controller.js';
import { errorResponseJsonSchema } from '../types/schemas.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'System health check',
        description: 'Checks Database, Redis, Ollama, Disk, and Memory.',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
              checks: { type: 'object', additionalProperties: true },
              timestamp: { type: 'string' },
              version: { type: 'string' },
            },
          },
          503: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => healthController.check(req, reply),
  );
}
