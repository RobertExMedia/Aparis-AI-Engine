import axios, { type AxiosInstance } from 'axios';
import { config } from '../../config/index.js';
import { ProviderError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type {
  AIModelInfo,
  ChatMessage,
  EmbeddingRequest,
  EmbeddingResponse,
} from '../../types/index.js';
import type {
  AIProvider,
  ChatOptions,
  ChatResult,
  StreamChatOptions,
  StreamChatResult,
} from '../ai.provider.js';

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    size?: number;
    digest?: string;
    modified_at?: string;
    details?: Record<string, unknown>;
  }>;
}

interface OllamaEmbedResponse {
  embedding?: number[];
  embeddings?: number[][];
}

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  private readonly client: AxiosInstance;
  private readonly defaultChatModel: string;
  private readonly defaultEmbedModel: string;

  constructor(
    baseUrl = config.ollama.baseUrl,
    chatModel = config.ollama.chatModel,
    embedModel = config.ollama.embedModel,
    timeoutMs = config.ollama.timeoutMs,
  ) {
    this.defaultChatModel = chatModel;
    this.defaultEmbedModel = embedModel;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const model = options.model ?? this.defaultChatModel;
    const payloadMessages = this.prepareMessages(messages, options.systemPrompt);

    try {
      const { data } = await this.client.post<OllamaChatResponse>('/api/chat', {
        model,
        messages: payloadMessages,
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
      });

      return {
        message: {
          role: (data.message.role as ChatMessage['role']) || 'assistant',
          content: data.message.content,
        },
        model: data.model || model,
        usage: this.extractUsage(data),
        finishReason: data.done_reason ?? (data.done ? 'stop' : undefined),
        raw: data,
      };
    } catch (err) {
      throw this.wrapError(err, 'chat');
    }
  }

  async *streamChat(
    messages: ChatMessage[],
    options: StreamChatOptions = {},
  ): AsyncGenerator<string, StreamChatResult, unknown> {
    const model = options.model ?? this.defaultChatModel;
    const payloadMessages = this.prepareMessages(messages, options.systemPrompt);

    let response;
    try {
      response = await this.client.post(
        '/api/chat',
        {
          model,
          messages: payloadMessages,
          stream: true,
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens,
          },
        },
        { responseType: 'stream' },
      );
    } catch (err) {
      throw this.wrapError(err, 'streamChat');
    }

    const stream = response.data as NodeJS.ReadableStream;
    let buffer = '';
    let fullContent = '';
    let finalModel = model;
    let promptTokens = 0;
    let completionTokens = 0;
    let finishReason: string | undefined;

    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: OllamaChatResponse;
        try {
          parsed = JSON.parse(trimmed) as OllamaChatResponse;
        } catch {
          logger.warn({ line: trimmed }, 'Failed to parse Ollama stream chunk');
          continue;
        }

        const delta = parsed.message?.content ?? '';
        if (delta) {
          fullContent += delta;
          options.onChunk?.(delta);
          yield delta;
        }

        if (parsed.model) finalModel = parsed.model;
        if (parsed.done) {
          promptTokens = parsed.prompt_eval_count ?? 0;
          completionTokens = parsed.eval_count ?? 0;
          finishReason = parsed.done_reason ?? 'stop';
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim()) as OllamaChatResponse;
        const delta = parsed.message?.content ?? '';
        if (delta) {
          fullContent += delta;
          options.onChunk?.(delta);
          yield delta;
        }
        if (parsed.done) {
          promptTokens = parsed.prompt_eval_count ?? 0;
          completionTokens = parsed.eval_count ?? 0;
          finishReason = parsed.done_reason ?? 'stop';
          if (parsed.model) finalModel = parsed.model;
        }
      } catch {
        // ignore trailing incomplete buffer
      }
    }

    return {
      message: { role: 'assistant', content: fullContent },
      model: finalModel,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason,
    };
  }

  async embeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? this.defaultEmbedModel;
    const inputs = Array.isArray(request.input) ? request.input : [request.input];

    try {
      // Prefer /api/embed (newer Ollama); fall back to /api/embeddings
      try {
        const { data } = await this.client.post<OllamaEmbedResponse>('/api/embed', {
          model,
          input: inputs,
        });

        const embeddings = data.embeddings ?? (data.embedding ? [data.embedding] : []);
        return { embeddings, model };
      } catch {
        const embeddings: number[][] = [];
        for (const input of inputs) {
          const { data } = await this.client.post<{ embedding: number[] }>('/api/embeddings', {
            model,
            prompt: input,
          });
          embeddings.push(data.embedding);
        }
        return { embeddings, model };
      }
    } catch (err) {
      throw this.wrapError(err, 'embeddings');
    }
  }

  async models(): Promise<AIModelInfo[]> {
    try {
      const { data } = await this.client.get<OllamaTagsResponse>('/api/tags');
      return (data.models ?? []).map((m) => ({
        name: m.name,
        size: m.size,
        digest: m.digest,
        modifiedAt: m.modified_at,
        details: m.details,
      }));
    } catch (err) {
      throw this.wrapError(err, 'models');
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      await this.client.get('/api/tags', { timeout: 5_000 });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown error';
      return { ok: false, latencyMs: Date.now() - start, message };
    }
  }

  private prepareMessages(messages: ChatMessage[], systemPrompt?: string): ChatMessage[] {
    const prepared = [...messages];
    if (systemPrompt) {
      const hasSystem = prepared.some((m) => m.role === 'system');
      if (!hasSystem) {
        prepared.unshift({ role: 'system', content: systemPrompt });
      }
    }
    return prepared;
  }

  private extractUsage(data: OllamaChatResponse) {
    const promptTokens = data.prompt_eval_count ?? 0;
    const completionTokens = data.eval_count ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  private wrapError(err: unknown, operation: string): ProviderError {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const detail = err.response?.data ?? err.message;
      logger.error({ err: detail, operation, status }, 'Ollama provider error');
      return new ProviderError(`Ollama ${operation} failed`, {
        status,
        // Never leak raw provider internals to clients — kept for logs only
      });
    }
    logger.error({ err, operation }, 'Ollama provider unexpected error');
    return new ProviderError(`Ollama ${operation} failed`);
  }
}
