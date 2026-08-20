import { z } from 'zod';

export const dashboardChatBodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    agentId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    message: z.string().min(1).max(32_000),
    /** Opt-in retrieval debug; only returned for workspace owner/admin. */
    retrievalDebug: z.boolean().optional(),
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
    retrievalDebug: {
      type: 'boolean',
      description:
        'When true, include retrieval diagnostics if the caller is a workspace owner/admin. Never returned for public widget users.',
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
    credits: {
      type: 'object',
      properties: {
        remaining: { type: ['integer', 'null'] },
        used: { type: 'integer' },
        limit: { type: ['integer', 'null'] },
      },
    },
    knowledge: {
      type: 'object',
      properties: {
        used: { type: 'boolean' },
        sources: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
    },
    retrievalDebug: {
      type: 'object',
      description: 'Workspace owner/admin only. Omitted for editors and public widgets.',
      properties: {
        chunksRetrieved: { type: 'integer' },
        chunks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunkId: { type: 'string' },
              content: { type: 'string' },
              similarity: { type: 'number' },
              knowledgeSource: { type: 'string' },
              sourceId: { type: 'string' },
              tokenCount: { type: 'integer' },
              fileName: { type: 'string' },
              page: { type: 'integer' },
            },
          },
        },
        retrievalTimeMs: { type: 'integer' },
        embeddingModel: { type: 'string' },
        topK: { type: 'integer' },
        threshold: { type: 'number' },
      },
    },
  },
} as const;

export const errorResponseJsonSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
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
