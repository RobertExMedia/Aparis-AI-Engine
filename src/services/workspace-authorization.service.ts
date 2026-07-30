import { createUserSupabaseClient } from '../supabase/client.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import type { WorkspaceRole } from '../types/index.js';

const CHAT_ROLES: ReadonlySet<WorkspaceRole> = new Set(['owner', 'admin', 'editor']);

export interface WorkspaceAccess {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  canChat: boolean;
}

/**
 * Verifies workspace membership using aparis-ai-hub tables under the user's JWT + RLS.
 * No service-role fallback (Lovable Cloud compatible).
 */
export class WorkspaceAuthorizationService {
  async assertMembership(params: {
    accessToken: string;
    userId: string;
    workspaceId: string;
  }): Promise<WorkspaceAccess> {
    const { accessToken, userId, workspaceId } = params;
    if (!userId) throw new UnauthorizedError();
    if (!workspaceId) throw new ForbiddenError();

    const userClient = createUserSupabaseClient(accessToken);

    const { data: rpcRole, error: rpcError } = await userClient.rpc(
      'current_user_workspace_role',
      { _workspace_id: workspaceId },
    );

    let role: WorkspaceRole | null =
      !rpcError && rpcRole ? (rpcRole as WorkspaceRole) : null;

    if (!role) {
      const { data: membership, error } = await userClient
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !membership) {
        throw new ForbiddenError('You do not have permission to use this agent.');
      }
      role = membership.role as WorkspaceRole;
    }

    const canChat = CHAT_ROLES.has(role);
    if (!canChat) {
      throw new ForbiddenError('You do not have permission to use this agent.');
    }

    const { data: workspace } = await userClient
      .from('workspaces')
      .select('id, status, deleted_at')
      .eq('id', workspaceId)
      .maybeSingle();

    if (workspace?.deleted_at) {
      throw new ForbiddenError('You do not have permission to use this agent.');
    }
    if (workspace && (workspace.status === 'suspended' || workspace.status === 'cancelled')) {
      throw new ForbiddenError('You do not have permission to use this agent.');
    }

    return { workspaceId, userId, role, canChat };
  }

  canChat(role: WorkspaceRole): boolean {
    return CHAT_ROLES.has(role);
  }
}

export const workspaceAuthorizationService = new WorkspaceAuthorizationService();
