import type { FastifyInstance } from 'fastify';
import { modelsController } from '../controllers/models.controller.js';
import { authenticateApiKeyOnly } from '../middleware/auth.js';
import { errorResponseJsonSchema } from '../types/schemas.js';

export async function modelsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/models',
    {
      preHandler: [authenticateApiKeyOnly],
      schema: {
        tags: ['Models'],
        summary: 'List installed Ollama models (server-to-server)',
        security: [{ apiKeyAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              models: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    size: { type: 'number' },
                    digest: { type: 'string' },
                    modifiedAt: { type: 'string' },
                    details: { type: 'object', additionalProperties: true },
                  },
                },
              },
              defaultChatModel: { type: 'string' },
              defaultEmbedModel: { type: 'string' },
            },
          },
          401: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => modelsController.list(req, reply),
  );
}
