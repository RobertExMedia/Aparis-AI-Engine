import { z } from 'zod';

export const dashboardChatBodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    agentId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    message: z.string().min(1).max(32_000),
  })
  .strict();

export type DashboardChatBody = z.infer<typeof dashboardChatBodySchema>;

export const dashboardChatBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['workspaceId', 'agentId', 'message'],
  properties: {
    workspaceId: {
      type: 'string',
      format: 'uuid',
      description: 'Workspace UUID. Membership is verified server-side.',
    },
    agentId: {
      type: 'string',
      format: 'uuid',
      description: 'Agent UUID. Must belong to the workspace.',
    },
    conversationId: {
      type: 'string',
      format: 'uuid',
      description: 'Optional existing conversation UUID',
    },
    message: {
      type: 'string',
      description: 'User message. systemPrompt is never accepted from the client.',
    },
  },
} as const;

export const dashboardChatResponseJsonSchema = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    conversationId: { type: 'string' },
    message: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        content: { type: 'string' },
      },
    },
    model: { type: 'string' },
    provider: { type: 'string' },
    durationMs: { type: 'integer' },
    usage: {
      type: 'object',
      properties: {
        promptTokens: { type: 'integer' },
        completionTokens: { type: 'integer' },
        totalTokens: { type: 'integer' },
      },
    },
  },
} as const;

export const errorResponseJsonSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
} as const;
