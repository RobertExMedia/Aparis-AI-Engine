import { prisma } from '../config/database.js';

export class AgentRepository {
  async findById(id: string, workspaceId: string) {
    return prisma.agent.findFirst({
      where: { id, workspaceId, isActive: true },
    });
  }
}

export const agentRepository = new AgentRepository();
