import type { FastifyInstance } from 'fastify';
import { chatController } from '../controllers/chat.controller.js';
import { authenticateSupabaseUser } from '../middleware/auth.js';
import { requireAiCredits } from '../middleware/ai-credits.js';
import { usageTracker } from '../middleware/usage.js';
import {
  dashboardChatBodyJsonSchema,
  dashboardChatResponseJsonSchema,
  errorResponseJsonSchema,
} from '../types/schemas.js';

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const chatAuth = {
    preHandler: [authenticateSupabaseUser, requireAiCredits(), usageTracker],
  };

  app.post(
    '/chat',
    {
      ...chatAuth,
      schema: {
        tags: ['Chat'],
        summary: 'Dashboard chat completion',
        description:
          'Authenticates a Supabase user, verifies workspace membership (owner/admin/editor), checks AI credits, loads the agent configuration from Supabase, calls Ollama, deducts credits, and stores the conversation. Never accepts systemPrompt from the client.',
        security: [{ supabaseBearer: [] }],
        body: dashboardChatBodyJsonSchema,
        response: {
          200: dashboardChatResponseJsonSchema,
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          429: errorResponseJsonSchema,
          503: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => chatController.chat(req, reply),
  );

  app.post(
    '/chat/stream',
    {
      ...chatAuth,
      schema: {
        tags: ['Chat'],
        summary: 'Dashboard streaming chat (SSE)',
        description:
          'Same authz and AI credits as /chat. Emits SSE events: start, token, done, error. Aborts Ollama when the client disconnects.',
        security: [{ supabaseBearer: [] }],
        body: dashboardChatBodyJsonSchema,
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          429: errorResponseJsonSchema,
          503: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => chatController.stream(req, reply),
  );
}
