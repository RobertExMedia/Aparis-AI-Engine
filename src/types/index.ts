export type AuthRole = 'USER' | 'ADMIN' | 'SERVICE';

export type AuthMethod = 'jwt' | 'api_key' | 'admin';

export interface AuthContext {
  workspaceId: string;
  userId?: string;
  role: AuthRole;
  method: AuthMethod;
  apiKeyId?: string;
  isAdmin: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatRequest {
  workspaceId: string;
  agentId?: string;
  conversationId?: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatResponse {
  id: string;
  conversationId: string;
  message: ChatMessage;
  model: string;
  usage?: TokenUsage;
  finishReason?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamChunk {
  id: string;
  conversationId?: string;
  delta: string;
  done: boolean;
  model?: string;
  usage?: TokenUsage;
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage?: TokenUsage;
}

export interface AIModelInfo {
  name: string;
  size?: number;
  digest?: string;
  modifiedAt?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  checks: {
    database: ComponentHealth;
    redis: ComponentHealth;
    ollama: ComponentHealth;
    disk: ComponentHealth;
    memory: ComponentHealth;
  };
  timestamp: string;
  version: string;
}

export interface ComponentHealth {
  status: 'ok' | 'error';
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface JwtPayload {
  sub: string;
  workspaceId: string;
  role: AuthRole;
  type?: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    usageMeta?: {
      messageCount: number;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      startTime: number;
    };
  }
}
