export type AuthMethod = 'supabase' | 'api_key' | 'widget';

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

/** Conversation channels — widget traffic must stay isolated from playground. */
export type ConversationChannel = 'playground' | 'website_widget';

export const WIDGET_CHANNEL: ConversationChannel = 'website_widget';
export const PLAYGROUND_CHANNEL: ConversationChannel = 'playground';

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

/** Public website widget — never carries a Supabase user JWT. */
export interface WidgetAuthContext {
  method: 'widget';
  workspaceId: string;
  agentId: string;
  agentPublicId: string;
  widgetKeyId: string;
  originHost: string;
}

export type AuthContext = SupabaseAuthContext | ApiKeyAuthContext | WidgetAuthContext;

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
  /**
   * Request retrieval debug on the response.
   * Honored only for workspace owner/admin on Supabase auth — never for widgets/API keys.
   */
  retrievalDebug?: boolean;
}

export interface WidgetChatRequest {
  /** Agent public id (agt_…). */
  agentId: string;
  conversationId?: string;
  message: string;
}

/** Slim citation for website embeds. */
export interface WidgetCitation {
  sourceName: string;
  similarity: number;
  page?: number;
  url?: string;
}

/** Lightweight widget chat response — no playground internals. */
export interface WidgetChatResponse {
  conversationId: string;
  message: { role: 'assistant'; content: string };
  citations: WidgetCitation[];
  credits?: CreditsBalance;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Public AI credits snapshot — no billing/Stripe internals. */
export interface CreditsBalance {
  remaining: number | null;
  used: number;
  limit: number | null;
}

/** Per-chunk retrieval details for admin prompt-engineering / debugging. */
export interface RetrievalDebugChunk {
  chunkId: string;
  content: string;
  similarity: number;
  knowledgeSource: string;
  sourceId: string;
  tokenCount: number;
  fileName?: string;
  page?: number;
}

/** Admin-only retrieval diagnostics (never for public widgets). */
export interface RetrievalDebug {
  chunksRetrieved: number;
  chunks: RetrievalDebugChunk[];
  retrievalTimeMs: number;
  embeddingModel: string;
  topK: number;
  threshold: number;
}

export interface DashboardChatResponse {
  requestId: string;
  conversationId: string;
  message: ChatMessage;
  model: string;
  provider: string;
  durationMs: number;
  usage?: TokenUsage;
  credits?: CreditsBalance;
  knowledge?: {
    used: boolean;
    sources: Array<{
      sourceId: string;
      sourceName: string;
      fileId?: string;
      fileName?: string;
      page?: number;
      sheet?: string;
      slide?: number;
      url?: string;
      chunkId: string;
      similarity: number;
    }>;
  };
  /** Admin-only retrieval diagnostics. Omitted for editors and all widget/API-key callers. */
  retrievalDebug?: RetrievalDebug;
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
    ollamaEmbeddings: ComponentHealth;
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
    widgetAgent?: AgentConfiguration;
    usageMeta?: {
      messageCount: number;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      startTime: number;
    };
    creditsMeta?: {
      workspaceId: string;
      credits: CreditsBalance;
      settled: boolean;
      creditsCharged?: number;
    };
  }
}
