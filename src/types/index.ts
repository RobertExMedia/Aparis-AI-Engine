export type AuthMethod = 'supabase' | 'api_key';

export type AuthRole = 'USER' | 'ADMIN' | 'SERVICE';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type AgentStatus = 'draft' | 'published' | 'archived';

export type AgentTone =
  | 'professional'
  | 'friendly'
  | 'concise'
  | 'enthusiastic'
  | 'empathetic'
  | 'technical';

/** Supabase user identity attached by authenticateSupabaseUser */
export interface SupabaseAuthContext {
  method: 'supabase';
  userId: string;
  email?: string;
  accessToken: string;
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
  isAdmin?: boolean;
}

/** Trusted server-to-server API key context (not used for Hub playground). */
export interface ApiKeyAuthContext {
  method: 'api_key';
  userId?: string;
  email?: string;
  accessToken?: string;
  workspaceId: string;
  apiKeyId?: string;
  isAdmin: boolean;
  role?: string;
}

export type AuthContext = SupabaseAuthContext | ApiKeyAuthContext;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface DashboardChatRequest {
  workspaceId: string;
  agentId: string;
  conversationId?: string;
  message: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface DashboardChatResponse {
  requestId: string;
  conversationId: string;
  message: ChatMessage;
  model: string;
  provider: string;
  durationMs: number;
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
    supabase: ComponentHealth;
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

export interface AgentConfiguration {
  id: string;
  workspace_id: string;
  public_id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  system_prompt: string;
  greeting: string;
  fallback_message: string;
  language: string;
  tone: AgentTone;
  temperature: number;
  max_tokens: number;
  settings: Record<string, unknown>;
  archived_at: string | null;
  published_at: string | null;
  avatar_url: string | null;
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
