import { prisma } from '../config/database.js';
import { hashApiKey } from '../utils/crypto.js';

export class WorkspaceRepository {
  async findById(id: string) {
    return prisma.workspace.findFirst({
      where: { id, isActive: true },
    });
  }

  async findApiKeyByHash(keyHash: string) {
    return prisma.apiKey.findUnique({
      where: { keyHash },
      include: { workspace: true },
    });
  }

  async createApiKey(data: {
    workspaceId: string;
    name: string;
    key: string;
    role?: 'USER' | 'ADMIN' | 'SERVICE';
  }) {
    const keyHash = hashApiKey(data.key);
    return prisma.apiKey.create({
      data: {
        workspaceId: data.workspaceId,
        name: data.name,
        keyHash,
        keyPrefix: data.key.slice(0, 12),
        role: data.role ?? 'SERVICE',
      },
    });
  }
}

export const workspaceRepository = new WorkspaceRepository();
