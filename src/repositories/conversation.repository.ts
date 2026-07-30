import { prisma } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { ChatMessage } from '../types/index.js';

export class ConversationRepository {
  async findById(id: string, workspaceId: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id, workspaceId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
        agent: true,
      },
    });
    return conversation;
  }

  async create(data: {
    workspaceId: string;
    agentId?: string;
    title?: string;
  }) {
    return prisma.conversation.create({
      data: {
        workspaceId: data.workspaceId,
        agentId: data.agentId,
        title: data.title,
      },
    });
  }

  async addMessage(data: {
    conversationId: string;
    workspaceId: string;
    role: string;
    content: string;
    tokens?: number;
    metadata?: object;
  }) {
    // Guard against workspace leakage
    const conversation = await prisma.conversation.findFirst({
      where: { id: data.conversationId, workspaceId: data.workspaceId },
    });
    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    return prisma.message.create({
      data: {
        conversationId: data.conversationId,
        workspaceId: data.workspaceId,
        role: data.role,
        content: data.content,
        tokens: data.tokens,
        metadata: data.metadata,
      },
    });
  }

  async getMessages(conversationId: string, workspaceId: string): Promise<ChatMessage[]> {
    const messages = await prisma.message.findMany({
      where: { conversationId, workspaceId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((m) => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
    }));
  }
}

export const conversationRepository = new ConversationRepository();
