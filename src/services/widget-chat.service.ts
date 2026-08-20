import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { getAIProvider } from '../providers/index.js';
import { promptBuilder } from './prompt-builder.service.js';
import { knowledgeRetrievalService } from './knowledge-retrieval.service.js';
import { aiCreditsService } from './ai-credits.service.js';
import { widgetRepository } from '../repositories/supabase/widget.repository.js';
import { AiUnavailableError, NotFoundError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type {
  AgentConfiguration,
  WidgetAuthContext,
  WidgetChatRequest,
  WidgetChatResponse,
  WidgetCitation,
  ChatMessage,
} from '../types/index.js';

function resolveModel(agent: AgentConfiguration): string {
  const fromSettings = agent.settings?.model;
  if (typeof fromSettings === 'string' && fromSettings.trim()) {
    const candidate = fromSettings.trim();
    const allow = config.ollama.allowedModels;
    if (allow.length === 0 || allow.includes(candidate) || candidate === config.ollama.chatModel) {
      return candidate;
    }
  }
  return config.ollama.chatModel;
}

function toCitations(
  sources: Array<{
    sourceName: string;
    similarity: number;
    page?: number;
    url?: string;
  }>,
): WidgetCitation[] {
  return sources.slice(0, 5).map((s) => ({
    sourceName: s.sourceName,
    similarity: Math.round(s.similarity * 1000) / 1000,
    ...(s.page != null ? { page: s.page } : {}),
    ...(s.url ? { url: s.url } : {}),
  }));
}

/**
 * Public website widget chat — isolated channel, service-role Hub access, no user JWT.
 */
export class WidgetChatService {
  async chat(params: {
    request: WidgetChatRequest;
    auth: WidgetAuthContext;
    agent: AgentConfiguration;
    signal?: AbortSignal;
  }): Promise<WidgetChatResponse> {
    const { request, auth, agent, signal } = params;
    this.validate(request);

    await aiCreditsService.assertAvailable(undefined, auth.workspaceId, true);

    const conversation = await this.resolveConversation(auth, agent, request.conversationId);
    const built = await this.buildMessages({
      auth,
      agent,
      conversationId: conversation.id,
      message: request.message,
    });

    const model = resolveModel(agent);
    const provider = getAIProvider();
    const requestId = uuidv4();

    try {
      const result = await provider.chat(built.messages, {
        model,
        temperature: agent.temperature,
        maxTokens: agent.max_tokens,
        signal,
      });

      await widgetRepository.saveUserMessage({
        workspaceId: auth.workspaceId,
        conversationId: conversation.id,
        content: request.message,
      });
      await widgetRepository.saveAssistantMessage({
        workspaceId: auth.workspaceId,
        conversationId: conversation.id,
        content: result.message.content,
      });

      const settled = await aiCreditsService.settle({
        useServiceRole: true,
        workspaceId: auth.workspaceId,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        promptText: built.messages.map((m) => m.content).join('\n'),
        completionText: result.message.content,
        endpoint: 'widget/chat',
        requestId,
        agentId: agent.id,
        conversationId: conversation.id,
        model: result.model,
        status: 'success',
        metadata: { channel: 'website_widget', originHost: auth.originHost },
      });

      logger.info(
        {
          requestId,
          workspaceId: auth.workspaceId,
          agentId: agent.id,
          conversationId: conversation.id,
          channel: 'website_widget',
          success: true,
        },
        'Widget chat completed',
      );

      return {
        conversationId: conversation.id,
        message: { role: 'assistant', content: result.message.content },
        citations: toCitations(built.citations),
        credits: settled.credits,
      };
    } catch (err) {
      logger.error(
        {
          requestId,
          workspaceId: auth.workspaceId,
          agentId: agent.id,
          success: false,
        },
        'Widget chat failed',
      );
      if (err instanceof AiUnavailableError) throw err;
      throw new AiUnavailableError();
    }
  }

  async *streamChat(params: {
    request: WidgetChatRequest;
    auth: WidgetAuthContext;
    agent: AgentConfiguration;
    signal?: AbortSignal;
  }): AsyncGenerator<
    | { event: 'start'; data: { conversationId: string } }
    | { event: 'token'; data: { content: string } }
    | {
        event: 'done';
        data: {
          conversationId: string;
          citations: WidgetCitation[];
          credits?: WidgetChatResponse['credits'];
        };
      }
    | { event: 'error'; data: { message: string } }
  > {
    const { request, auth, agent, signal } = params;
    this.validate(request);

    await aiCreditsService.assertAvailable(undefined, auth.workspaceId, true);

    const conversation = await this.resolveConversation(auth, agent, request.conversationId);
    yield { event: 'start', data: { conversationId: conversation.id } };

    const built = await this.buildMessages({
      auth,
      agent,
      conversationId: conversation.id,
      message: request.message,
    });

    const model = resolveModel(agent);
    const provider = getAIProvider();
    const requestId = uuidv4();
    let assistantContent = '';

    try {
      const generator = provider.streamChat(built.messages, {
        model,
        temperature: agent.temperature,
        maxTokens: agent.max_tokens,
        signal,
      });

      let next = await generator.next();
      while (!next.done) {
        if (signal?.aborted) break;
        assistantContent += next.value;
        yield { event: 'token', data: { content: next.value } };
        next = await generator.next();
      }

      if (signal?.aborted) return;

      const final = next.value as
        | {
            message?: ChatMessage;
            usage?: {
              promptTokens: number;
              completionTokens: number;
            };
          }
        | undefined;
      if (final?.message?.content) assistantContent = final.message.content;

      await widgetRepository.saveUserMessage({
        workspaceId: auth.workspaceId,
        conversationId: conversation.id,
        content: request.message,
      });
      if (assistantContent) {
        await widgetRepository.saveAssistantMessage({
          workspaceId: auth.workspaceId,
          conversationId: conversation.id,
          content: assistantContent,
        });
      }

      const settled = await aiCreditsService.settle({
        useServiceRole: true,
        workspaceId: auth.workspaceId,
        promptTokens: final?.usage?.promptTokens,
        completionTokens: final?.usage?.completionTokens,
        promptText: built.messages.map((m) => m.content).join('\n'),
        completionText: assistantContent,
        endpoint: 'widget/chat/stream',
        requestId,
        agentId: agent.id,
        conversationId: conversation.id,
        model,
        status: 'success',
        metadata: { channel: 'website_widget', originHost: auth.originHost },
      });

      yield {
        event: 'done',
        data: {
          conversationId: conversation.id,
          citations: toCitations(built.citations),
          credits: settled.credits,
        },
      };
    } catch (err) {
      logger.error(
        { requestId, workspaceId: auth.workspaceId, err: err instanceof Error ? err.message : err },
        'Widget stream chat failed',
      );
      throw err;
    }
  }

  private validate(request: WidgetChatRequest): void {
    if (!request.message?.trim()) throw new ValidationError('message is required');
    if (!request.agentId?.trim()) throw new ValidationError('agentId is required');
  }

  private async resolveConversation(
    auth: WidgetAuthContext,
    agent: AgentConfiguration,
    conversationId?: string,
  ) {
    if (conversationId) {
      const existing = await widgetRepository.findWidgetConversation({
        conversationId,
        workspaceId: auth.workspaceId,
        agentId: agent.id,
      });
      if (!existing) {
        throw new NotFoundError('Conversation not found');
      }
      // Isolation: never resume playground (or other channel) threads.
      if (existing.channel !== 'website_widget') {
        throw new NotFoundError('Conversation not found');
      }
      return existing;
    }

    return widgetRepository.createConversation({
      workspaceId: auth.workspaceId,
      agentId: agent.id,
    });
  }

  private async buildMessages(params: {
    auth: WidgetAuthContext;
    agent: AgentConfiguration;
    conversationId: string;
    message: string;
  }): Promise<{
    messages: ChatMessage[];
    citations: WidgetCitation[];
  }> {
    const history = await widgetRepository.listMessages({
      conversationId: params.conversationId,
      workspaceId: params.auth.workspaceId,
    });

    const retrieved = await knowledgeRetrievalService.retrieve({
      useServiceRole: true,
      workspaceId: params.auth.workspaceId,
      agentId: params.agent.id,
      query: params.message,
    });

    const built = promptBuilder.build({
      systemPrompt: params.agent.system_prompt,
      knowledgeContext: knowledgeRetrievalService.buildGroundingBlock(retrieved.texts),
      conversation: history,
      currentQuestion: params.message,
    });

    return {
      messages: built.messages,
      citations: toCitations(retrieved.payload.sources),
    };
  }
}

export const widgetChatService = new WidgetChatService();
