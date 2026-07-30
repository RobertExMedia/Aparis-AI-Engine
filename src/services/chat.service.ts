import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { getAIProvider } from '../providers/index.js';
import { supabaseAgentRepository } from '../repositories/supabase/agent.repository.js';
import { supabaseConversationRepository } from '../repositories/supabase/conversation.repository.js';
import { workspaceAuthorizationService } from './workspace-authorization.service.js';
import { promptBuilder } from './prompt-builder.service.js';
import { knowledgeService } from './knowledge.service.js';
import { ValidationError, AiUnavailableError, ForbiddenError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type {
  AgentConfiguration,
  DashboardChatRequest,
  DashboardChatResponse,
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
    logger.warn(
      { agentId: agent.id },
      'Agent settings.model rejected — not in allowlist; using default chat model',
    );
  }
  return config.ollama.chatModel;
}

export class ChatService {
  async chat(params: {
    request: DashboardChatRequest;
    userId: string;
    accessToken: string;
    signal?: AbortSignal;
  }): Promise<DashboardChatResponse> {
    const { request, userId, accessToken, signal } = params;
    this.validate(request);
    const requestId = uuidv4();
    const started = Date.now();

    await workspaceAuthorizationService.assertMembership({
      accessToken,
      userId,
      workspaceId: request.workspaceId,
    });

    const agent = await supabaseAgentRepository.loadAgentConfiguration(
      request.agentId,
      request.workspaceId,
      accessToken,
    );

    const conversation = await this.resolveConversation({
      request,
      userId,
      agent,
      accessToken,
    });

    await supabaseConversationRepository.saveUserMessage({
      accessToken,
      workspaceId: request.workspaceId,
      conversationId: conversation.id,
      content: request.message,
      metadata: { requestId },
    });

    if (!conversation.title) {
      void supabaseConversationRepository.generateConversationTitle({
        accessToken,
        conversationId: conversation.id,
        workspaceId: request.workspaceId,
        firstMessage: request.message,
      });
    }

    const history = await supabaseConversationRepository.listMessages({
      accessToken,
      conversationId: conversation.id,
      workspaceId: request.workspaceId,
    });

    const knowledgeDocs = await knowledgeService.search({
      workspaceId: request.workspaceId,
      query: request.message,
      agentId: agent.id,
      limit: 5,
    });

    const built = promptBuilder.build({
      systemPrompt: agent.system_prompt,
      knowledge: knowledgeDocs.map((d) => d.content),
      conversation: history.filter((m) => m.role !== 'system'),
      currentQuestion: request.message,
    });

    const model = resolveModel(agent);
    const provider = getAIProvider();

    try {
      const result = await provider.chat(built.messages, {
        model,
        temperature: agent.temperature,
        maxTokens: agent.max_tokens,
        signal,
      });

      const durationMs = Date.now() - started;

      await supabaseConversationRepository.saveAssistantMessage({
        accessToken,
        workspaceId: request.workspaceId,
        conversationId: conversation.id,
        content: result.message.content,
        model: result.model,
        provider: provider.name,
        responseTimeMs: durationMs,
        metadata: {
          requestId,
          success: true,
          finishReason: result.finishReason,
        },
      });

      logger.info(
        {
          requestId,
          workspaceId: request.workspaceId,
          agentId: agent.id,
          conversationId: conversation.id,
          model: result.model,
          provider: provider.name,
          durationMs,
          success: true,
        },
        'Chat completed',
      );

      return {
        requestId,
        conversationId: conversation.id,
        message: result.message,
        model: result.model,
        provider: provider.name,
        durationMs,
        usage: result.usage,
      };
    } catch (err) {
      await supabaseConversationRepository
        .markGenerationFailed({
          accessToken,
          conversationId: conversation.id,
          workspaceId: request.workspaceId,
          errorCode: 'AI_UNAVAILABLE',
        })
        .catch(() => undefined);

      logger.error(
        {
          requestId,
          workspaceId: request.workspaceId,
          agentId: agent.id,
          success: false,
          durationMs: Date.now() - started,
        },
        'Chat failed',
      );

      if (err instanceof AiUnavailableError) throw err;
      throw new AiUnavailableError();
    }
  }

  async *streamChat(params: {
    request: DashboardChatRequest;
    userId: string;
    accessToken: string;
    signal?: AbortSignal;
  }): AsyncGenerator<
    | { event: 'start'; data: { requestId: string; conversationId: string } }
    | { event: 'token'; data: { content: string } }
    | {
        event: 'done';
        data: {
          requestId: string;
          conversationId: string;
          durationMs: number;
          model: string;
        };
      }
    | { event: 'error'; data: { message: string } }
  > {
    const { request, userId, accessToken, signal } = params;
    this.validate(request);
    const requestId = uuidv4();
    const started = Date.now();

    try {
      await workspaceAuthorizationService.assertMembership({
        accessToken,
        userId,
        workspaceId: request.workspaceId,
      });

      const agent = await supabaseAgentRepository.loadAgentConfiguration(
        request.agentId,
        request.workspaceId,
        accessToken,
      );

      const conversation = await this.resolveConversation({
        request,
        userId,
        agent,
        accessToken,
      });

      await supabaseConversationRepository.saveUserMessage({
        accessToken,
        workspaceId: request.workspaceId,
        conversationId: conversation.id,
        content: request.message,
        metadata: { requestId },
      });

      if (!conversation.title) {
        void supabaseConversationRepository.generateConversationTitle({
          accessToken,
          conversationId: conversation.id,
          workspaceId: request.workspaceId,
          firstMessage: request.message,
        });
      }

      yield {
        event: 'start',
        data: { requestId, conversationId: conversation.id },
      };

      const history = await supabaseConversationRepository.listMessages({
        accessToken,
        conversationId: conversation.id,
        workspaceId: request.workspaceId,
      });

      const knowledgeDocs = await knowledgeService.search({
        workspaceId: request.workspaceId,
        query: request.message,
        agentId: agent.id,
        limit: 5,
      });

      const built = promptBuilder.build({
        systemPrompt: agent.system_prompt,
        knowledge: knowledgeDocs.map((d) => d.content),
        conversation: history.filter((m) => m.role !== 'system'),
        currentQuestion: request.message,
      });

      const model = resolveModel(agent);
      const provider = getAIProvider();
      let assistantContent = '';
      let finalModel = model;

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

      if (signal?.aborted) {
        await supabaseConversationRepository
          .markGenerationFailed({
            accessToken,
            conversationId: conversation.id,
            workspaceId: request.workspaceId,
            errorCode: 'CLIENT_DISCONNECTED',
          })
          .catch(() => undefined);
        return;
      }

      const final = next.value as
        | { message?: ChatMessage; model?: string }
        | undefined;
      if (final?.message?.content) {
        assistantContent = final.message.content;
      }
      if (final?.model) finalModel = final.model;

      const durationMs = Date.now() - started;

      if (assistantContent) {
        await supabaseConversationRepository.saveAssistantMessage({
          accessToken,
          workspaceId: request.workspaceId,
          conversationId: conversation.id,
          content: assistantContent,
          model: finalModel,
          provider: provider.name,
          responseTimeMs: durationMs,
          metadata: { requestId, success: true },
        });
      }

      logger.info(
        {
          requestId,
          workspaceId: request.workspaceId,
          agentId: agent.id,
          conversationId: conversation.id,
          model: finalModel,
          provider: provider.name,
          durationMs,
          success: true,
        },
        'Stream chat completed',
      );

      yield {
        event: 'done',
        data: {
          requestId,
          conversationId: conversation.id,
          durationMs,
          model: finalModel,
        },
      };
    } catch (err) {
      logger.error(
        {
          requestId,
          workspaceId: request.workspaceId,
          success: false,
          durationMs: Date.now() - started,
        },
        'Stream chat failed',
      );
      throw err;
    }
  }

  private async resolveConversation(params: {
    request: DashboardChatRequest;
    userId: string;
    agent: AgentConfiguration;
    accessToken: string;
  }) {
    const { request, userId, agent, accessToken } = params;

    if (request.conversationId) {
      const existing = await supabaseConversationRepository.findConversation({
        accessToken,
        conversationId: request.conversationId,
        workspaceId: request.workspaceId,
      });

      if (existing) {
        if (existing.workspace_id !== request.workspaceId) {
          throw new ForbiddenError();
        }
        if (existing.agent_id !== agent.id) {
          throw new ForbiddenError();
        }
        if (existing.created_by && existing.created_by !== userId) {
          throw new ForbiddenError();
        }
        return existing;
      }

      // Client-supplied UUID for a new conversation — create then continue.
      return supabaseConversationRepository.createConversation({
        accessToken,
        id: request.conversationId,
        workspaceId: request.workspaceId,
        agentId: agent.id,
        createdBy: userId,
        channel: 'playground',
      });
    }

    return supabaseConversationRepository.createConversation({
      accessToken,
      workspaceId: request.workspaceId,
      agentId: agent.id,
      createdBy: userId,
      channel: 'playground',
    });
  }

  private validate(request: DashboardChatRequest): void {
    if (!request.workspaceId) throw new ValidationError('workspaceId is required');
    if (!request.agentId) throw new ValidationError('agentId is required');
    if (!request.message?.trim()) throw new ValidationError('message is required');
  }
}

export const chatService = new ChatService();

export type { ChatMessage };
