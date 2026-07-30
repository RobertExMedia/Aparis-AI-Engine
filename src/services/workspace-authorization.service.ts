import { createUserSupabaseClient, getServiceSupabaseClient } from '../supabase/client.js';
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
 * Verifies workspace membership using real aparis-ai-hub tables/enums.
 * Prefers user-scoped client + RLS; falls back to service role only after token identity is known.
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

    // Prefer RPC that mirrors RLS helpers in aparis-ai-hub
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
        // Controlled service-role read after we already know userId from validated token
        const admin = getServiceSupabaseClient();
        const { data: fallback } = await admin
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', workspaceId)
          .eq('user_id', userId)
          .maybeSingle();

        if (!fallback) {
          throw new ForbiddenError('You do not have permission to use this agent.');
        }
        role = fallback.role as WorkspaceRole;
      } else {
        role = membership.role as WorkspaceRole;
      }
    }

    const canChat = CHAT_ROLES.has(role);
    if (!canChat) {
      throw new ForbiddenError('You do not have permission to use this agent.');
    }

    // Ensure workspace is not soft-deleted / suspended when readable
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
