import type { FastifyInstance } from 'fastify';
import { chatController } from '../controllers/chat.controller.js';
import { authenticate } from '../middleware/auth.js';
import { usageTracker } from '../middleware/usage.js';
import {
  chatBodyJsonSchema,
  chatResponseJsonSchema,
  errorResponseJsonSchema,
} from '../types/schemas.js';

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/chat',
    {
      preHandler: [authenticate, usageTracker],
      schema: {
        tags: ['Chat'],
        summary: 'Send a chat completion request',
        description:
          'Processes a multi-tenant chat request through the AI provider (Ollama). Requires JWT or API key authentication.',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        body: chatBodyJsonSchema,
        response: {
          200: chatResponseJsonSchema,
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => chatController.chat(req, reply),
  );

  app.post(
    '/chat/stream',
    {
      preHandler: [authenticate, usageTracker],
      schema: {
        tags: ['Chat'],
        summary: 'Stream a chat completion (SSE)',
        description:
          'Returns Server-Sent Events with incremental tokens. Final event includes usage stats; stream ends with data: [DONE].',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        body: chatBodyJsonSchema,
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => chatController.stream(req, reply),
  );
}
