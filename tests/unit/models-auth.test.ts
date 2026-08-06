import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  UnauthorizedError,
  ForbiddenError,
} from '../../src/utils/errors.js';

vi.mock('../../src/supabase/client.js', () => ({
  createUserSupabaseClient: vi.fn(),
  createAnonSupabaseClient: vi.fn(),
  getServiceSupabaseClient: vi.fn(),
  hasServiceRoleKey: vi.fn().mockReturnValue(false),
  resetServiceSupabaseClient: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    apiKey: { findUnique: vi.fn(), update: vi.fn() },
    usageLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('../../src/providers/index.js', () => ({
  getAIProvider: () => ({
    models: vi.fn().mockResolvedValue([
      { name: 'deepseek-r1:1.5b', size: 1, digest: 'abc', modifiedAt: '2026-01-01' },
    ]),
  }),
}));

import { createUserSupabaseClient } from '../../src/supabase/client.js';
import {
  authenticateSupabaseOrApiKey,
  authenticateApiKeyOnly,
} from '../../src/middleware/auth.js';
import { WorkspaceAuthorizationService } from '../../src/services/workspace-authorization.service.js';
import { modelsController } from '../../src/controllers/models.controller.js';
import { hashApiKey } from '../../src/utils/crypto.js';

function mockRequest(headers: Record<string, string | undefined> = {}) {
  return {
    headers,
    auth: undefined as unknown,
  };
}

function mockReply() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: unknown) {
      this.payload = body;
      return this;
    },
  };
}

describe('authenticateSupabaseOrApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.API_KEY_HASHED;
  });

  it('returns 401 when both JWT and API key are missing', async () => {
    const req = mockRequest();
    await expect(
      authenticateSupabaseOrApiKey(req as never, {} as never),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects invalid Supabase JWT with 401', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null, error: { message: 'bad' } }),
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'bad' } }),
      },
    } as never);

    const req = mockRequest({ authorization: 'Bearer aaa.bbb.ccc' });
    await expect(
      authenticateSupabaseOrApiKey(req as never, {} as never),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('accepts valid Supabase JWT when user is a workspace member', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-1', email: 'a@aparis.io' } },
          error: null,
        }),
        getUser: vi.fn(),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ workspace_id: 'ws-1', role: 'editor' }],
          error: null,
        }),
      }),
    } as never);

    const req = mockRequest({ authorization: 'Bearer aaa.bbb.ccc' });
    await authenticateSupabaseOrApiKey(req as never, {} as never);
    expect(req.auth).toMatchObject({
      method: 'supabase',
      userId: 'user-1',
    });
  });

  it('accepts viewer workspace members for models listing', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'viewer-1', email: 'v@aparis.io' } },
          error: null,
        }),
        getUser: vi.fn(),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ workspace_id: 'ws-1', role: 'viewer' }],
          error: null,
        }),
      }),
    } as never);

    const req = mockRequest({ authorization: 'Bearer aaa.bbb.ccc' });
    await authenticateSupabaseOrApiKey(req as never, {} as never);
    expect(req.auth).toMatchObject({ method: 'supabase', userId: 'viewer-1' });
  });

  it('rejects valid JWT with no workspace membership', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-1', email: 'a@aparis.io' } },
          error: null,
        }),
        getUser: vi.fn(),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    } as never);

    const req = mockRequest({ authorization: 'Bearer aaa.bbb.ccc' });
    await expect(
      authenticateSupabaseOrApiKey(req as never, {} as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('accepts valid X-API-Key (server-to-server)', async () => {
    const plain = 'apk_test_models_key_0123456789abcdef0123456789abcdef';
    process.env.API_KEY_HASHED = hashApiKey(plain);

    const req = mockRequest({ 'x-api-key': plain });
    await authenticateSupabaseOrApiKey(req as never, {} as never);
    expect(req.auth).toMatchObject({ method: 'api_key', isAdmin: true });
  });

  it('keeps authenticateApiKeyOnly rejecting JWT-only requests', async () => {
    const req = mockRequest({ authorization: 'Bearer aaa.bbb.ccc' });
    await expect(authenticateApiKeyOnly(req as never, {} as never)).rejects.toMatchObject({
      message: 'API key required',
    });
  });
});

describe('WorkspaceAuthorizationService.assertAnyWorkspaceMembership', () => {
  const service = new WorkspaceAuthorizationService();

  beforeEach(() => vi.clearAllMocks());

  it('allows viewer role', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ workspace_id: 'ws-1', role: 'viewer' }],
          error: null,
        }),
      }),
    } as never);

    const access = await service.assertAnyWorkspaceMembership({
      accessToken: 'tok',
      userId: 'u1',
    });
    expect(access.role).toBe('viewer');
    expect(access.workspaceId).toBe('ws-1');
  });
});

describe('ModelsController.list', () => {
  it('returns the same response shape regardless of auth method', async () => {
    const reply = mockReply();
    await modelsController.list({ auth: { method: 'supabase' } } as never, reply as never);
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toMatchObject({
      models: [{ name: 'deepseek-r1:1.5b' }],
      defaultChatModel: expect.any(String),
      defaultEmbedModel: expect.any(String),
    });
  });
});
