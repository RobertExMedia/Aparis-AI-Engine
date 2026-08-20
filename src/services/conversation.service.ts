import { conversationRepository } from '../repositories/conversation.repository.js';
import { estimateTokens } from '../utils/crypto.js';
import type { ChatMessage } from '../types/index.js';

export class ConversationService {
  async saveMessage(params: {
    conversationId: string;
    workspaceId: string;
    role: string;
    content: string;
    tokens?: number;
    metadata?: object;
  }) {
    return conversationRepository.addMessage({
      ...params,
      tokens: params.tokens ?? estimateTokens(params.content),
    });
  }

  async loadConversation(conversationId: string, workspaceId: string) {
    return conversationRepository.findById(conversationId, workspaceId);
  }

  async loadMessages(conversationId: string, workspaceId: string): Promise<ChatMessage[]> {
    return conversationRepository.getMessages(conversationId, workspaceId);
  }

  async getOrCreate(params: {
    workspaceId: string;
    conversationId?: string;
    agentId?: string;
    title?: string;
  }) {
    if (params.conversationId) {
      const existing = await conversationRepository.findById(
        params.conversationId,
        params.workspaceId,
      );
      if (existing) return existing;
    }

    return conversationRepository.create({
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      title: params.title,
    });
  }
}

export const conversationService = new ConversationService();
