import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { prisma } from '../config/database.js';
import { hashApiKey, safeCompare } from '../utils/crypto.js';
import { ForbiddenError, UnauthorizedError, WorkspaceMismatchError } from '../utils/errors.js';
import type { AuthContext, AuthRole, JwtPayload } from '../types/index.js';

function extractBearer(header?: string): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function authenticateApiKey(apiKey: string): Promise<AuthContext | null> {
  // Master keys (bootstrap / service) — not workspace-scoped
  for (const master of config.masterApiKeys) {
    if (safeCompare(master, apiKey)) {
      return {
        workspaceId: '',
        role: 'ADMIN',
        method: 'api_key',
        isAdmin: true,
      };
    }
  }

  const keyHash = hashApiKey(apiKey);
  const record = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { workspace: true },
  });

  if (!record || !record.isActive || !record.workspace.isActive) {
    return null;
  }

  if (record.expiresAt && record.expiresAt < new Date()) {
    return null;
  }

  // Fire-and-forget last used update
  void prisma.apiKey
    .update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => undefined);

  return {
    workspaceId: record.workspaceId,
    role: record.role as AuthRole,
    method: 'api_key',
    apiKeyId: record.id,
    isAdmin: record.role === 'ADMIN',
  };
}

async function authenticateJwt(
  request: FastifyRequest,
  token: string,
  admin = false,
): Promise<AuthContext | null> {
  try {
    const secret = admin ? config.jwt.adminSecret : config.jwt.secret;
    const payload = request.server.jwt.verify<JwtPayload>(token, {
      key: secret,
    } as never);

    if (admin && payload.type !== 'admin' && payload.role !== 'ADMIN') {
      return null;
    }

    return {
      workspaceId: payload.workspaceId,
      userId: payload.sub,
      role: payload.role,
      method: admin ? 'admin' : 'jwt',
      isAdmin: payload.role === 'ADMIN' || payload.type === 'admin',
    };
  } catch {
    return null;
  }
}

/**
 * Primary auth: accepts JWT (Authorization: Bearer) or API key (X-API-Key / Bearer apk_...).
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const apiKeyHeader = request.headers['x-api-key'];
  const apiKey =
    typeof apiKeyHeader === 'string'
      ? apiKeyHeader
      : extractBearer(request.headers.authorization);

  if (apiKey && (apiKey.startsWith('apk_') || config.masterApiKeys.includes(apiKey))) {
    const ctx = await authenticateApiKey(apiKey);
    if (!ctx) throw new UnauthorizedError('Invalid API key');
    request.auth = ctx;
    return;
  }

  const bearer = extractBearer(request.headers.authorization);
  if (bearer) {
    const ctx = await authenticateJwt(request, bearer);
    if (!ctx) throw new UnauthorizedError('Invalid or expired token');
    request.auth = ctx;
    return;
  }

  throw new UnauthorizedError('Authentication required');
}

export async function requireAdmin(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  await authenticate(request, _reply);
  if (!request.auth?.isAdmin) {
    // Try admin JWT secret specifically
    const bearer = extractBearer(request.headers.authorization);
    if (bearer) {
      const adminCtx = await authenticateJwt(request, bearer, true);
      if (adminCtx?.isAdmin) {
        request.auth = adminCtx;
        return;
      }
    }
    throw new ForbiddenError('Admin access required');
  }
}

/**
 * Ensures the request body/params workspaceId matches the authenticated workspace.
 * Admins may act across workspaces.
 */
export function assertWorkspaceAccess(
  auth: AuthContext,
  workspaceId: string,
): void {
  if (auth.isAdmin) return;
  if (!auth.workspaceId) {
    throw new ForbiddenError('Workspace context required');
  }
  if (auth.workspaceId !== workspaceId) {
    throw new WorkspaceMismatchError();
  }
}

export async function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await authenticate(request, reply);
  } catch {
    // leave unauthenticated
  }
}
