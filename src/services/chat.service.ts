import { v4 as uuidv4 } from 'uuid';
import { getAIProvider } from '../providers/index.js';
import { agentRepository } from '../repositories/agent.repository.js';
import { conversationService } from './conversation.service.js';
import { promptBuilder } from './prompt-builder.service.js';
import { knowledgeService } from './knowledge.service.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { ChatRequest, ChatResponse, StreamChunk } from '../types/index.js';

export class ChatService {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.validate(request);

    const { workspaceId, agentId, messages } = request;
    const provider = getAIProvider();

    let systemPrompt = request.systemPrompt ?? '';
    let model = request.model;

    if (agentId) {
      const agent = await agentRepository.findById(agentId, workspaceId);
      if (!agent) throw new NotFoundError('Agent not found');
      systemPrompt = systemPrompt || agent.systemPrompt;
      model = model || agent.model || undefined;
    }

    const conversation = await conversationService.getOrCreate({
      workspaceId,
      conversationId: request.conversationId,
      agentId,
    });

    // Persist incoming user messages that aren't already stored
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      await conversationService.saveMessage({
        conversationId: conversation.id,
        workspaceId,
        role: 'user',
        content: lastUser.content,
      });
    }

    const knowledgeDocs = lastUser
      ? await knowledgeService.search({
          workspaceId,
          query: lastUser.content,
          agentId,
          limit: 5,
        })
      : [];

    const built = promptBuilder.build({
      systemPrompt,
      knowledge: knowledgeDocs.map((d) => d.content),
      conversation: messages.filter((m) => m.role !== 'system'),
      currentQuestion: lastUser?.content,
    });

    logger.info(
      {
        workspaceId,
        conversationId: conversation.id,
        agentId,
        model,
        messageCount: built.messages.length,
      },
      'Chat request',
    );

    const result = await provider.chat(built.messages, {
      model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    await conversationService.saveMessage({
      conversationId: conversation.id,
      workspaceId,
      role: 'assistant',
      content: result.message.content,
      tokens: result.usage?.completionTokens,
      metadata: { model: result.model, finishReason: result.finishReason },
    });

    return {
      id: uuidv4(),
      conversationId: conversation.id,
      message: result.message,
      model: result.model,
      usage: result.usage,
      finishReason: result.finishReason,
    };
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<StreamChunk> {
    this.validate(request);

    const { workspaceId, agentId, messages } = request;
    const provider = getAIProvider();
    const streamId = uuidv4();

    let systemPrompt = request.systemPrompt ?? '';
    let model = request.model;

    if (agentId) {
      const agent = await agentRepository.findById(agentId, workspaceId);
      if (!agent) throw new NotFoundError('Agent not found');
      systemPrompt = systemPrompt || agent.systemPrompt;
      model = model || agent.model || undefined;
    }

    const conversation = await conversationService.getOrCreate({
      workspaceId,
      conversationId: request.conversationId,
      agentId,
    });

    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      await conversationService.saveMessage({
        conversationId: conversation.id,
        workspaceId,
        role: 'user',
        content: lastUser.content,
      });
    }

    const knowledgeDocs = lastUser
      ? await knowledgeService.search({
          workspaceId,
          query: lastUser.content,
          agentId,
          limit: 5,
        })
      : [];

    const built = promptBuilder.build({
      systemPrompt,
      knowledge: knowledgeDocs.map((d) => d.content),
      conversation: messages.filter((m) => m.role !== 'system'),
      currentQuestion: lastUser?.content,
    });

    const generator = provider.streamChat(built.messages, {
      model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    let next = await generator.next();
    while (!next.done) {
      yield {
        id: streamId,
        conversationId: conversation.id,
        delta: next.value,
        done: false,
        model,
      };
      next = await generator.next();
    }

    const final = next.value;

    await conversationService.saveMessage({
      conversationId: conversation.id,
      workspaceId,
      role: 'assistant',
      content: final.message.content,
      tokens: final.usage?.completionTokens,
      metadata: { model: final.model, finishReason: final.finishReason },
    });

    yield {
      id: streamId,
      conversationId: conversation.id,
      delta: '',
      done: true,
      model: final.model,
      usage: final.usage,
    };
  }

  private validate(request: ChatRequest): void {
    if (!request.workspaceId) {
      throw new ValidationError('workspaceId is required');
    }
    if (!request.messages || request.messages.length === 0) {
      throw new ValidationError('messages must be a non-empty array');
    }
    for (const msg of request.messages) {
      if (!msg.role || !msg.content) {
        throw new ValidationError('Each message requires role and content');
      }
    }
  }
}

export const chatService = new ChatService();
