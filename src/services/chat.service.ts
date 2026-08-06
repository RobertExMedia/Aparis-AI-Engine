import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { getAIProvider } from '../providers/index.js';
import { supabaseAgentRepository } from '../repositories/supabase/agent.repository.js';
import { supabaseConversationRepository } from '../repositories/supabase/conversation.repository.js';
import { workspaceAuthorizationService } from './workspace-authorization.service.js';
import { promptBuilder } from './prompt-builder.service.js';
import { knowledgeRetrievalService } from './knowledge-retrieval.service.js';
import { aiCreditsService } from './ai-credits.service.js';
import { ValidationError, AiUnavailableError, ForbiddenError, CreditsExhaustedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { ChatKnowledgePayload } from '../knowledge/types.js';
import type {
  AgentConfiguration,
  CreditsBalance,
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

    if (!conversation.title || conversation.title === 'New conversation') {
      void supabaseConversationRepository.generateConversationTitle({
        accessToken,
        conversationId: conversation.id,
        workspaceId: request.workspaceId,
        firstMessage: request.message,
      });
    }

    const built = await this.buildOllamaMessages({
      request,
      agent,
      accessToken,
      conversationId: conversation.id,
      requestId,
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

      await supabaseConversationRepository.saveUserMessage({
        accessToken,
        workspaceId: request.workspaceId,
        conversationId: conversation.id,
        content: request.message,
        metadata: { requestId },
      });

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

      const settled = await aiCreditsService.settle({
        accessToken,
        workspaceId: request.workspaceId,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        promptText: built.messages.map((m) => m.content).join('\n'),
        completionText: result.message.content,
        endpoint: 'chat',
        requestId,
        agentId: agent.id,
        conversationId: conversation.id,
        model: result.model,
        status: 'success',
      });

      logger.info(
        {
          requestId,
          workspaceId: request.workspaceId,
          agentId: agent.id,
          conversationId: conversation.id,
          model: result.model,
          provider: provider.name,
          historyMessageCount: built.historyMessageCount,
          ollamaMessageCount: built.messages.length,
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
        usage: {
          promptTokens: settled.promptTokens,
          completionTokens: settled.completionTokens,
          totalTokens: settled.totalTokens,
        },
        credits: settled.credits,
        knowledge: built.knowledge,
      };
    } catch (err) {
      // Persist the user turn even when generation fails so history stays continuous.
      await supabaseConversationRepository
        .saveUserMessage({
          accessToken,
          workspaceId: request.workspaceId,
          conversationId: conversation.id,
          content: request.message,
          metadata: { requestId, failed: true },
        })
        .catch(() => undefined);

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
          conversationId: conversation.id,
          success: false,
          durationMs: Date.now() - started,
        },
        'Chat failed',
      );

      if (err instanceof CreditsExhaustedError) throw err;
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
          knowledge?: ChatKnowledgePayload;
          usage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
          };
          credits?: CreditsBalance;
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

      if (!conversation.title || conversation.title === 'New conversation') {
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

      const built = await this.buildOllamaMessages({
        request,
        agent,
        accessToken,
        conversationId: conversation.id,
        requestId,
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
          .saveUserMessage({
            accessToken,
            workspaceId: request.workspaceId,
            conversationId: conversation.id,
            content: request.message,
            metadata: { requestId, aborted: true },
          })
          .catch(() => undefined);

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
        | {
            message?: ChatMessage;
            model?: string;
            usage?: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
            };
          }
        | undefined;
      if (final?.message?.content) {
        assistantContent = final.message.content;
      }
      if (final?.model) finalModel = final.model;

      const durationMs = Date.now() - started;

      await supabaseConversationRepository.saveUserMessage({
        accessToken,
        workspaceId: request.workspaceId,
        conversationId: conversation.id,
        content: request.message,
        metadata: { requestId },
      });

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

      const settled = await aiCreditsService.settle({
        accessToken,
        workspaceId: request.workspaceId,
        promptTokens: final?.usage?.promptTokens,
        completionTokens: final?.usage?.completionTokens,
        promptText: built.messages.map((m) => m.content).join('\n'),
        completionText: assistantContent,
        endpoint: 'chat/stream',
        requestId,
        agentId: agent.id,
        conversationId: conversation.id,
        model: finalModel,
        status: 'success',
      });

      logger.info(
        {
          requestId,
          workspaceId: request.workspaceId,
          agentId: agent.id,
          conversationId: conversation.id,
          model: finalModel,
          provider: provider.name,
          historyMessageCount: built.historyMessageCount,
          ollamaMessageCount: built.messages.length,
          knowledgeUsed: built.knowledge.used,
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
          knowledge: built.knowledge,
          usage: {
            promptTokens: settled.promptTokens,
            completionTokens: settled.completionTokens,
            totalTokens: settled.totalTokens,
          },
          credits: settled.credits,
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

  /**
   * Load prior turns (created_at ASC), retrieve agent knowledge, then assemble Ollama messages:
   * system → knowledge context → prior user/assistant → current user message.
   */
  private async buildOllamaMessages(params: {
    request: DashboardChatRequest;
    agent: AgentConfiguration;
    accessToken: string;
    conversationId: string;
    requestId: string;
  }): Promise<{
    messages: ChatMessage[];
    historyMessageCount: number;
    knowledge: ChatKnowledgePayload;
  }> {
    const { request, agent, accessToken, conversationId, requestId } = params;

    const history = await supabaseConversationRepository.listMessages({
      accessToken,
      conversationId,
      workspaceId: request.workspaceId,
    });

    const priorTurns = history.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    );

    const retrieved = await knowledgeRetrievalService.retrieve({
      accessToken,
      workspaceId: request.workspaceId,
      agentId: agent.id,
      query: request.message,
    });

    const built = promptBuilder.build({
      systemPrompt: agent.system_prompt,
      knowledgeContext: knowledgeRetrievalService.buildGroundingBlock(retrieved.texts),
      conversation: priorTurns,
      currentQuestion: request.message,
    });

    logger.info(
      {
        requestId,
        conversationId,
        historyMessageCount: priorTurns.length,
        knowledgeUsed: retrieved.payload.used,
        knowledgeSourceCount: retrieved.citations.length,
        ollamaMessageCount: built.messages.length,
        hasSystem: built.messages.some((m) => m.role === 'system'),
        lastRole: built.messages.at(-1)?.role,
      },
      'Prepared Ollama chat messages with conversation history and knowledge',
    );

    return {
      messages: built.messages,
      historyMessageCount: priorTurns.length,
      knowledge: retrieved.payload,
    };
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
        if (existing.started_by && existing.started_by !== userId) {
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
        startedBy: userId,
        channel: 'playground',
      });
    }

    return supabaseConversationRepository.createConversation({
      accessToken,
      workspaceId: request.workspaceId,
      agentId: agent.id,
      startedBy: userId,
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
