import type { FastifyInstance } from 'fastify';
import { widgetController, authenticateWidget } from '../controllers/widget.controller.js';
import { usageTracker } from '../middleware/usage.js';
import {
  widgetChatBodyJsonSchema,
  widgetChatResponseJsonSchema,
} from '../middleware/widget-auth.js';
import { errorResponseJsonSchema } from '../types/schemas.js';

export async function widgetRoutes(app: FastifyInstance): Promise<void> {
  const widgetAuth = {
    preHandler: [authenticateWidget, usageTracker],
  };

  app.post(
    '/widget/chat',
    {
      ...widgetAuth,
      schema: {
        tags: ['Widget'],
        summary: 'Public website widget chat',
        description:
          'Authenticated with X-Widget-Key + Origin domain whitelist. Never accepts a Supabase JWT. Conversations use channel=website_widget (isolated from playground).',
        security: [{ widgetKeyAuth: [] }],
        body: widgetChatBodyJsonSchema,
        response: {
          200: widgetChatResponseJsonSchema,
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          429: errorResponseJsonSchema,
          503: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => widgetController.chat(req, reply),
  );

  app.post(
    '/widget/chat/stream',
    {
      ...widgetAuth,
      schema: {
        tags: ['Widget'],
        summary: 'Public website widget streaming chat (SSE)',
        description:
          'Same auth as /widget/chat. Emits start, token, done, error. Lightweight payloads for embeds.',
        security: [{ widgetKeyAuth: [] }],
        body: widgetChatBodyJsonSchema,
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          429: errorResponseJsonSchema,
          503: errorResponseJsonSchema,
        },
      },
    },
    (req, reply) => widgetController.stream(req, reply),
  );
}
