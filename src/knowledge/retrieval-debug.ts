import type { AuthMethod, WorkspaceRole } from '../types/index.js';

/**
 * Workspace admins = owner | admin.
 * Editors/viewers and non-Supabase (widget / API key) callers are denied.
 */
export function canViewRetrievalDebug(params: {
  authMethod: AuthMethod;
  role: WorkspaceRole;
  requested: boolean;
}): boolean {
  if (!params.requested) return false;
  // Public widget / S2S API keys must never receive retrieval internals.
  if (params.authMethod !== 'supabase') return false;
  return params.role === 'owner' || params.role === 'admin';
}
