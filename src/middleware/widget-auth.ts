import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { widgetRepository } from '../repositories/supabase/widget.repository.js';
import { extractRequestOriginHost } from '../utils/widget-origin.js';
import {
  DomainNotAllowedError,
  ValidationError,
  WidgetKeyUnauthorizedError,
} from '../utils/errors.js';
import type { WidgetAuthContext } from '../types/index.js';

function extractWidgetKey(request: FastifyRequest): string | null {
  const header = request.headers['x-widget-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();

  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer wpk_')) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * Authenticates public website widget requests.
 * Requires X-Widget-Key (wpk_…) + Origin/Referer domain whitelist.
 * Never accepts or forwards a Supabase user JWT.
 */
export async function authenticateWidget(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const key = extractWidgetKey(request);
  if (!key || !key.startsWith('wpk_')) {
    throw new WidgetKeyUnauthorizedError('Widget key required (X-Widget-Key).');
  }

  const originHost = extractRequestOriginHost({
    origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
    referer: typeof request.headers.referer === 'string' ? request.headers.referer : undefined,
  });
  if (!originHost) {
    throw new DomainNotAllowedError('Origin header is required for widget requests.');
  }

  const body = request.body as { agentId?: string } | undefined;
  const agentPublicId = body?.agentId;
  if (!agentPublicId || typeof agentPublicId !== 'string') {
    throw new ValidationError('agentId (public id) is required');
  }

  const resolved = await widgetRepository.resolveAuth({
    widgetKey: key,
    originHost,
    agentPublicId,
  });

  const { agent: _agent, ...auth } = resolved;
  request.auth = auth satisfies WidgetAuthContext;
  request.widgetAgent = resolved.agent;
}

export function requireWidgetAuth(
  auth: FastifyRequest['auth'],
): asserts auth is WidgetAuthContext {
  if (!auth || auth.method !== 'widget') {
    throw new WidgetKeyUnauthorizedError();
  }
}

export const widgetChatBodySchema = z
  .object({
    agentId: z
      .string()
      .min(3)
      .max(64)
      .regex(/^agt_[a-zA-Z0-9_]+$/, 'agentId must be the agent public id (agt_…)'),
    conversationId: z.string().uuid().optional(),
    message: z.string().min(1).max(8_000),
  })
  .strict();

export type WidgetChatBody = z.infer<typeof widgetChatBodySchema>;

export const widgetChatBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['agentId', 'message'],
  properties: {
    agentId: {
      type: 'string',
      description: 'Published agent public id (agt_…). Never the internal UUID.',
    },
    conversationId: {
      type: 'string',
      format: 'uuid',
      description: 'Optional existing website_widget conversation id',
    },
    message: { type: 'string', maxLength: 8000 },
  },
} as const;

export const widgetChatResponseJsonSchema = {
  type: 'object',
  properties: {
    conversationId: { type: 'string' },
    message: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        content: { type: 'string' },
      },
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceName: { type: 'string' },
          similarity: { type: 'number' },
          page: { type: 'integer' },
          url: { type: 'string' },
        },
      },
    },
    credits: {
      type: 'object',
      properties: {
        remaining: { type: ['integer', 'null'] },
        used: { type: 'integer' },
        limit: { type: ['integer', 'null'] },
      },
    },
  },
} as const;
