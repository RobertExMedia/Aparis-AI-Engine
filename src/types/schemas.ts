import { z } from 'zod';

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().min(1),
  name: z.string().optional(),
});

export const chatBodySchema = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().optional(),
  conversationId: z.string().optional(),
  messages: z.array(chatMessageSchema).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
});

export type ChatBody = z.infer<typeof chatBodySchema>;

/** Fastify JSON Schema for Swagger documentation */
export const chatBodyJsonSchema = {
  type: 'object',
  required: ['workspaceId', 'messages'],
  properties: {
    workspaceId: { type: 'string', description: 'Tenant workspace ID' },
    agentId: { type: 'string', description: 'Optional agent ID' },
    conversationId: { type: 'string', description: 'Optional existing conversation ID' },
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
          content: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
    model: { type: 'string', description: 'Override model (defaults to OLLAMA_CHAT_MODEL)' },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    maxTokens: { type: 'integer', minimum: 1 },
    systemPrompt: { type: 'string' },
  },
} as const;

export const chatResponseJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    conversationId: { type: 'string' },
    message: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        content: { type: 'string' },
      },
    },
    model: { type: 'string' },
    usage: {
      type: 'object',
      properties: {
        promptTokens: { type: 'integer' },
        completionTokens: { type: 'integer' },
        totalTokens: { type: 'integer' },
      },
    },
    finishReason: { type: 'string' },
  },
} as const;

export const errorResponseJsonSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
} as const;
