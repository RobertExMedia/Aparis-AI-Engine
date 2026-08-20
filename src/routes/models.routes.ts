import type { FastifyInstance } from 'fastify';
import { modelsController } from '../controllers/models.controller.js';
import { authenticateSupabaseOrApiKey } from '../middleware/auth.js';
import { errorResponseJsonSchema } from '../types/schemas.js';

export async function modelsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/models',
    {
      preHandler: [authenticateSupabaseOrApiKey],
      schema: {
        tags: ['Models'],
        summary: 'List installed Ollama models',
        description:
          'Accepts a Supabase Bearer JWT (any workspace member, including viewer) or a server-to-server X-API-Key. Same response for both auth methods.',
        security: [{ supabaseBearer: [] }, { apiKeyAuth: [] }],
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
          403: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => modelsController.list(req, reply),
  );
}
