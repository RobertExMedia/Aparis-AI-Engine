import axios, { type AxiosInstance } from 'axios';
import { config } from '../../config/index.js';
import { AiUnavailableError } from '../../utils/errors.js';
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  private readonly client: AxiosInstance;
  private readonly defaultChatModel: string;
  private readonly defaultEmbedModel: string;
  private readonly chatEndpoint: string;
  private readonly modelsEndpoint: string;
  private readonly embedEndpoint: string;
  private readonly embeddingsEndpoint: string;
  private configurationOk = true;

  constructor(
    baseUrl = config.ollama.baseUrl,
    chatModel = config.ollama.chatModel,
    embedModel = config.ollama.embedModel,
    timeoutMs = config.ollama.timeoutMs,
  ) {
    this.defaultChatModel = chatModel;
    this.defaultEmbedModel = embedModel;
    this.chatEndpoint = config.ollama.chatEndpoint;
    this.modelsEndpoint = config.ollama.modelsEndpoint;
    this.embedEndpoint = config.ollama.embedEndpoint;
    this.embeddingsEndpoint = config.ollama.embeddingsEndpoint;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: (s) => s >= 200 && s < 300,
    });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const model = options.model ?? this.defaultChatModel;
    const payloadMessages = this.prepareMessages(messages, options.systemPrompt);

    try {
      const { data } = await this.withRetry(() =>
        this.client.post<OllamaChatResponse>(
          this.chatEndpoint,
          {
            model,
            messages: payloadMessages,
            stream: false,
            options: {
              temperature: options.temperature,
              num_predict: options.maxTokens,
            },
          },
          { signal: options.signal },
        ),
      );

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
        this.chatEndpoint,
        {
          model,
          messages: payloadMessages,
          stream: true,
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens,
          },
        },
        { responseType: 'stream', signal: options.signal },
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

    const onAbort = () => {
      const destroyable = stream as unknown as { destroy?: () => void };
      destroyable.destroy?.();
    };
    options.signal?.addEventListener('abort', onAbort);

    try {
      for await (const chunk of stream) {
        if (options.signal?.aborted) break;
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
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
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
    const requestedModel = request.model ?? this.defaultEmbedModel;
    const inputs = Array.isArray(request.input) ? request.input : [request.input];

    try {
      const model = await this.resolveEmbedModel(requestedModel);
      return await this.withRetry(
        async () => {
          const vectors = await this.requestEmbeddings(model, inputs);
          if (vectors.length !== inputs.length) {
            throw new AiUnavailableError(
              'Embedding generation failed. The AI service returned an incomplete result.',
            );
          }
          return { embeddings: vectors, model };
        },
        3,
        [1_000, 2_000, 4_000],
      );
    } catch (err) {
      if (err instanceof AiUnavailableError) throw err;
      throw this.wrapError(err, 'embeddings', requestedModel);
    }
  }

  /** Verifies the embed model responds — tags-only health is not enough for knowledge jobs. */
  async embeddingHealth(
    model = this.defaultEmbedModel,
  ): Promise<{ ok: boolean; latencyMs: number; message?: string; model?: string }> {
    const start = Date.now();
    try {
      const resolved = await this.resolveEmbedModel(model);
      const vectors = await this.requestEmbeddings(resolved, ['health-check']);
      if (!vectors[0]?.length) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          message: 'Embedding probe returned empty vectors',
          model: resolved,
        };
      }
      return { ok: true, latencyMs: Date.now() - start, model: resolved };
    } catch (err) {
      const wrapped =
        err instanceof AiUnavailableError
          ? err
          : this.wrapError(err, 'embeddings', model);
      logger.error(
        {
          operation: 'embeddingHealth',
          model,
          message: wrapped.message.replace(/https?:\/\/[^\s]+/gi, '[redacted-host]'),
        },
        'Ollama embedding health check failed',
      );
      return { ok: false, latencyMs: Date.now() - start, message: wrapped.message, model };
    }
  }

  /**
   * Ollama hosts may expose different embed APIs. Prefer sequential /api/embed
   * (works through stricter proxies) before batched calls.
   */
  private async requestEmbeddings(model: string, inputs: string[]): Promise<number[][]> {
    const strategies: Array<{ name: string; run: () => Promise<number[][] | null> }> = [
      {
        name: 'embed_sequential',
        run: () => this.postEmbedSequential(this.embedEndpoint, model, inputs),
      },
      {
        name: 'embed_batch',
        run: () => this.postEmbedBatch(this.embedEndpoint, { model, input: inputs }),
      },
      {
        name: 'openai_embeddings',
        run: () => this.postOpenAiEmbeddings(model, inputs),
      },
      {
        name: 'legacy_prompt',
        run: () => this.postLegacyPromptEmbeddings(model, inputs),
      },
      {
        name: 'embeddings_batch',
        run: () => this.postEmbedBatch(this.embeddingsEndpoint, { model, input: inputs }),
      },
      {
        name: 'embeddings_sequential',
        run: () => this.postEmbedSequential(this.embeddingsEndpoint, model, inputs),
      },
    ];

    let lastErr: unknown;
    for (const strategy of strategies) {
      try {
        const vectors = await strategy.run();
        if (vectors?.length === inputs.length && vectors.every((v) => v.length > 0)) {
          logger.debug({ strategy: strategy.name, count: vectors.length }, 'Embedding strategy ok');
          return vectors;
        }
        logger.warn(
          { strategy: strategy.name, got: vectors?.length ?? 0, expected: inputs.length },
          'Embedding strategy returned incomplete vectors',
        );
      } catch (err) {
        lastErr = err;
        logger.warn(
          {
            strategy: strategy.name,
            status: axios.isAxiosError(err) ? err.response?.status : undefined,
            code: axios.isAxiosError(err) ? err.code : undefined,
          },
          'Embedding strategy failed',
        );
      }
    }

    if (lastErr) {
      if (axios.isAxiosError(lastErr) && lastErr.response?.status === 404) {
        throw new AiUnavailableError(
          `Embedding endpoint returned 404 for model "${model}". On the AI host: (1) run "ollama pull ${model}", (2) ensure nginx proxies /api/embed and /api/embeddings to Ollama (not only /api/chat and /api/tags).`,
        );
      }
      throw lastErr;
    }
    throw new AiUnavailableError(
      'Embedding generation failed. The AI service returned an empty result.',
    );
  }

  private async resolveEmbedModel(requested: string): Promise<string> {
    try {
      const available = (await this.models()).map((m) => m.name);
      if (available.length === 0) return requested;
      if (available.includes(requested)) return requested;
      const withLatest = `${requested}:latest`;
      if (available.includes(withLatest)) return withLatest;
      const prefix = available.find(
        (name) => name === requested || name.startsWith(`${requested}:`),
      );
      if (prefix) return prefix;
      logger.warn(
        { requested, availableCount: available.length },
        'Requested embedding model not listed in Ollama tags; attempting anyway',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, requested },
        'Could not resolve embedding model from tags',
      );
    }
    return requested;
  }

  private async postEmbedSequential(
    endpoint: string,
    model: string,
    inputs: string[],
  ): Promise<number[][] | null> {
    const embeddings: number[][] = [];
    for (const input of inputs) {
      const { data } = await this.client.post<OllamaEmbedResponse>(endpoint, { model, input });
      const vector = data.embeddings?.[0] ?? data.embedding;
      if (!vector?.length) return null;
      embeddings.push(vector);
    }
    return embeddings;
  }

  private async postEmbedBatch(
    endpoint: string,
    body: { model: string; input: string[] },
  ): Promise<number[][] | null> {
    const { data } = await this.client.post<OllamaEmbedResponse>(endpoint, body);
    const embeddings = data.embeddings ?? (data.embedding ? [data.embedding] : []);
    return embeddings.length > 0 ? embeddings : null;
  }

  private async postOpenAiEmbeddings(model: string, inputs: string[]): Promise<number[][] | null> {
    const { data } = await this.client.post<{
      data?: Array<{ embedding?: number[] }>;
    }>('/v1/embeddings', { model, input: inputs });
    const embeddings = (data.data ?? [])
      .map((row) => row.embedding)
      .filter((v): v is number[] => Array.isArray(v) && v.length > 0);
    return embeddings.length > 0 ? embeddings : null;
  }

  private async postLegacyPromptEmbeddings(
    model: string,
    inputs: string[],
  ): Promise<number[][] | null> {
    const embeddings: number[][] = [];
    for (const input of inputs) {
      const { data } = await this.client.post<{ embedding: number[] }>(this.embeddingsEndpoint, {
        model,
        prompt: input,
      });
      if (!data.embedding?.length) return null;
      embeddings.push(data.embedding);
    }
    return embeddings;
  }

  async models(): Promise<AIModelInfo[]> {
    try {
      const { data } = await this.client.get<OllamaTagsResponse>(this.modelsEndpoint);
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
      await this.client.get(this.modelsEndpoint, { timeout: 5_000 });
      this.configurationOk = true;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      this.configurationOk = false;
      const message = axios.isAxiosError(err)
        ? err.code === 'ECONNABORTED'
          ? 'timeout'
          : err.response?.status
            ? `http_${err.response.status}`
            : 'unreachable'
        : 'unreachable';

      // Clear config error in logs — never expose infrastructure URLs to API clients
      logger.error(
        {
          operation: 'health',
          reason: message,
          endpointConfigured: true,
        },
        'Ollama health check failed. Verify OLLAMA_BASE_URL and that the AI host exposes the API paths. Do not expose the upstream URL to clients.',
      );

      return { ok: false, latencyMs: Date.now() - start, message: 'AI provider unreachable' };
    }
  }

  get isConfiguredHealthy(): boolean {
    return this.configurationOk;
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    attempts = 2,
    backoffMs: number[] = [200, 400],
  ): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const retryable =
          axios.isAxiosError(err) &&
          (!err.response ||
            err.response.status >= 500 ||
            err.response.status === 429 ||
            err.code === 'ECONNRESET' ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'ECONNABORTED');
        if (!retryable || i === attempts - 1) throw err;
        await sleep(backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 500);
      }
    }
    throw lastErr;
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

  private wrapError(err: unknown, operation: string, embedModel?: string): AiUnavailableError {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
      const body =
        typeof err.response?.data === 'object' && err.response.data !== null
          ? JSON.stringify(err.response.data).slice(0, 200)
          : undefined;
      logger.error(
        {
          operation,
          status,
          code: err.code,
          body,
          // never log full URL with secrets; axios may include baseURL — redact
          message: err.message?.replace(/https?:\/\/[^\s]+/gi, '[redacted-host]'),
        },
        'Ollama provider error',
      );
      if (operation === 'embeddings') {
        const modelName = embedModel ?? this.defaultEmbedModel;
        if (status === 404 || (body && /model/i.test(body) && /not found/i.test(body))) {
          return new AiUnavailableError(
            `Embedding returned 404 for "${modelName}". On the AI host run "ollama pull ${modelName}" and proxy /api/embed (and /api/embeddings) to Ollama.`,
          );
        }
        if (status === 403) {
          return new AiUnavailableError(
            'Embedding endpoint is blocked on the AI host. Ensure /api/embed is exposed alongside /api/chat.',
          );
        }
        return new AiUnavailableError(
          timedOut
            ? 'Embedding timed out. The AI service is busy — please try again shortly.'
            : 'Embedding failed. The AI service is temporarily unavailable. Please try again shortly.',
        );
      }
      return new AiUnavailableError();
    }
    logger.error({ err, operation }, 'Ollama provider unexpected error');
    return new AiUnavailableError();
  }
}
