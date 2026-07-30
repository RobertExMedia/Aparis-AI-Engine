import type {
  AIModelInfo,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
  TokenUsage,
} from '../types/index.js';

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface ChatResult {
  message: ChatMessage;
  model: string;
  usage?: TokenUsage;
  finishReason?: string;
  raw?: unknown;
}

export interface StreamChatOptions extends ChatOptions {
  onChunk?: (delta: string) => void;
}

export interface StreamChatResult {
  message: ChatMessage;
  model: string;
  usage?: TokenUsage;
  finishReason?: string;
}

export interface AIProvider {
  readonly name: string;

  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;

  streamChat(
    messages: ChatMessage[],
    options?: StreamChatOptions,
  ): AsyncGenerator<string, StreamChatResult, unknown>;

  embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  models(): Promise<AIModelInfo[]>;

  health(): Promise<{ ok: boolean; latencyMs: number; message?: string }>;
}
