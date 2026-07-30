import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { prisma } from '../config/database.js';
import { hashApiKey, safeCompare } from '../utils/crypto.js';
import { verifyJwt } from '../utils/jwt.js';
import { ForbiddenError, UnauthorizedError, WorkspaceMismatchError } from '../utils/errors.js';
import type { AuthContext, AuthRole } from '../types/index.js';

function extractBearer(header?: string): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function isMasterApiKey(apiKey: string): boolean {
  return config.masterApiKeys.some((master) => safeCompare(master, apiKey));
}

async function authenticateApiKey(apiKey: string): Promise<AuthContext | null> {
  if (isMasterApiKey(apiKey)) {
    return {
      workspaceId: '',
      role: 'ADMIN',
      method: 'api_key',
      isAdmin: true,
    };
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

function authenticateJwt(token: string, admin = false): AuthContext | null {
  try {
    const secret = admin ? config.jwt.adminSecret : config.jwt.secret;
    const payload = verifyJwt(token, secret);

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

  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
    const ctx = await authenticateApiKey(apiKeyHeader);
    if (!ctx) throw new UnauthorizedError('Invalid API key');
    request.auth = ctx;
    return;
  }

  const bearer = extractBearer(request.headers.authorization);
  if (!bearer) {
    throw new UnauthorizedError('Authentication required');
  }

  if (bearer.startsWith('apk_') || isMasterApiKey(bearer)) {
    const ctx = await authenticateApiKey(bearer);
    if (!ctx) throw new UnauthorizedError('Invalid API key');
    request.auth = ctx;
    return;
  }

  const ctx =
    authenticateJwt(bearer) ?? authenticateJwt(bearer, true);
  if (!ctx) throw new UnauthorizedError('Invalid or expired token');
  request.auth = ctx;
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authenticate(request, reply);
  if (!request.auth?.isAdmin) {
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
