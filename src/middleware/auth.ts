import type { FastifyReply, FastifyRequest } from 'fastify';
import { createUserSupabaseClient } from '../supabase/client.js';
import { config } from '../config/index.js';
import { hashApiKey, safeCompare } from '../utils/crypto.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { prisma } from '../config/database.js';
import type { ApiKeyAuthContext, AuthContext } from '../types/index.js';

function extractBearer(header?: string): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Validates a Supabase access token and attaches user identity.
 * Used by Aparis AI Hub playground / dashboard routes.
 */
export async function authenticateSupabaseUser(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const token = extractBearer(request.headers.authorization);
  if (!token) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  if (token.split('.').length !== 3) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  const supabase = createUserSupabaseClient(token);

  // Prefer getClaims (matches aparis-ai-hub auth middleware); fall back to getUser.
  const claimsResult = await supabase.auth.getClaims(token);
  let userId: string | undefined;
  let email: string | undefined;

  if (!claimsResult.error && claimsResult.data?.claims?.sub) {
    userId = claimsResult.data.claims.sub as string;
    email =
      (claimsResult.data.claims.email as string | undefined) ??
      (claimsResult.data.claims.user_metadata as { email?: string } | undefined)?.email;
  } else {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.id) {
      throw new UnauthorizedError('Your session has expired. Please sign in again.');
    }
    userId = data.user.id;
    email = data.user.email ?? undefined;
  }

  if (!userId) {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  request.auth = {
    method: 'supabase',
    userId,
    email,
    accessToken: token,
  };
}

function isMasterApiKey(apiKey: string): boolean {
  return config.masterApiKeys.some((master) => safeCompare(master, apiKey));
}

async function authenticateApiKey(apiKey: string): Promise<ApiKeyAuthContext | null> {
  if (isMasterApiKey(apiKey)) {
    return {
      method: 'api_key',
      workspaceId: '',
      isAdmin: true,
      role: 'ADMIN',
    };
  }

  try {
    const keyHash = hashApiKey(apiKey);
    const record = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { workspace: true },
    });

    if (!record || !record.isActive || !record.workspace.isActive) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    void prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      method: 'api_key',
      workspaceId: record.workspaceId,
      apiKeyId: record.id,
      isAdmin: record.role === 'ADMIN',
      role: record.role,
    };
  } catch {
    return null;
  }
}

/**
 * Server-to-server API key auth only. Not used for Hub playground.
 */
export async function authenticateApiKeyOnly(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const apiKeyHeader = request.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
    const ctx = await authenticateApiKey(apiKeyHeader);
    if (!ctx) throw new UnauthorizedError('Invalid API key');
    request.auth = ctx;
    return;
  }

  const bearer = extractBearer(request.headers.authorization);
  if (bearer && (bearer.startsWith('apk_') || isMasterApiKey(bearer))) {
    const ctx = await authenticateApiKey(bearer);
    if (!ctx) throw new UnauthorizedError('Invalid API key');
    request.auth = ctx;
    return;
  }

  throw new UnauthorizedError('API key required');
}

/** @deprecated Prefer authenticateSupabaseUser for Hub routes. */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apiKeyHeader = request.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
    return authenticateApiKeyOnly(request, reply);
  }
  const bearer = extractBearer(request.headers.authorization);
  if (bearer?.startsWith('apk_') || (bearer && isMasterApiKey(bearer))) {
    return authenticateApiKeyOnly(request, reply);
  }
  return authenticateSupabaseUser(request, reply);
}

export function requireSupabaseAuth(auth?: AuthContext): asserts auth is Extract<
  AuthContext,
  { method: 'supabase' }
> {
  if (!auth || auth.method !== 'supabase' || !auth.userId || !auth.accessToken) {
    throw new UnauthorizedError();
  }
}

export function requireAdmin(auth?: AuthContext): void {
  if (!auth || !('isAdmin' in auth) || !auth.isAdmin) {
    throw new ForbiddenError('Admin access required');
  }
}
