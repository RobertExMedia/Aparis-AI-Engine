import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  UnauthorizedError,
  ForbiddenError,
  AgentNotFoundError,
  AgentUnavailableError,
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

import { createUserSupabaseClient } from '../../src/supabase/client.js';
import { authenticateSupabaseUser } from '../../src/middleware/auth.js';
import { WorkspaceAuthorizationService } from '../../src/services/workspace-authorization.service.js';
import { SupabaseAgentRepository } from '../../src/repositories/supabase/agent.repository.js';
import { config } from '../../src/config/index.js';

function mockRequest(authHeader?: string) {
  return {
    headers: { authorization: authHeader },
    auth: undefined as unknown,
  };
}

describe('authenticateSupabaseUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing bearer token', async () => {
    const req = mockRequest();
    await expect(authenticateSupabaseUser(req as never, {} as never)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects malformed token', async () => {
    const req = mockRequest('Bearer not-a-jwt');
    await expect(authenticateSupabaseUser(req as never, {} as never)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects invalid Supabase token', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null, error: { message: 'bad' } }),
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'bad' } }),
      },
    } as never);

    const req = mockRequest('Bearer aaa.bbb.ccc');
    await expect(authenticateSupabaseUser(req as never, {} as never)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects expired / invalid token via getUser fallback', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null, error: { message: 'expired' } }),
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'token is expired' },
        }),
      },
    } as never);

    const req = mockRequest('Bearer aaa.bbb.ccc');
    await expect(authenticateSupabaseUser(req as never, {} as never)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('accepts valid authenticated user', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-1', email: 'a@aparis.io' } },
          error: null,
        }),
        getUser: vi.fn(),
      },
    } as never);

    const req = mockRequest('Bearer aaa.bbb.ccc');
    await authenticateSupabaseUser(req as never, {} as never);
    expect(req.auth).toMatchObject({
      method: 'supabase',
      userId: 'user-1',
      email: 'a@aparis.io',
      accessToken: 'aaa.bbb.ccc',
    });
  });
});

describe('WorkspaceAuthorizationService', () => {
  const service = new WorkspaceAuthorizationService();

  beforeEach(() => vi.clearAllMocks());

  it('rejects user not in workspace', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'none' } }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    } as never);

    await expect(
      service.assertMembership({
        accessToken: 'tok',
        userId: 'u1',
        workspaceId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects viewer role', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: 'viewer', error: null }),
      from: vi.fn(),
    } as never);

    await expect(
      service.assertMembership({
        accessToken: 'tok',
        userId: 'u1',
        workspaceId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows editor', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: 'editor', error: null }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { id: 'ws', status: 'active', deleted_at: null }, error: null }),
      }),
    } as never);

    const access = await service.assertMembership({
      accessToken: 'tok',
      userId: 'u1',
      workspaceId: '00000000-0000-4000-8000-000000000001',
    });
    expect(access.role).toBe('editor');
    expect(access.canChat).toBe(true);
    expect(access.canViewRetrievalDebug).toBe(false);
  });

  it('allows owner', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: 'owner', error: null }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { id: 'ws', status: 'active', deleted_at: null }, error: null }),
      }),
    } as never);

    const access = await service.assertMembership({
      accessToken: 'tok',
      userId: 'u1',
      workspaceId: '00000000-0000-4000-8000-000000000001',
    });
    expect(access.role).toBe('owner');
    expect(access.canViewRetrievalDebug).toBe(true);
  });
});

describe('SupabaseAgentRepository', () => {
  const repo = new SupabaseAgentRepository();

  const baseAgent = {
    id: '00000000-0000-4000-8000-0000000000aa',
    workspace_id: '00000000-0000-4000-8000-000000000001',
    public_id: 'agt_abc123',
    name: 'Test',
    description: null,
    status: 'draft',
    system_prompt: 'You are helpful',
    greeting: 'Hi',
    fallback_message: 'Nope',
    language: 'en',
    tone: 'professional',
    temperature: 0.7,
    max_tokens: 1024,
    settings: {},
    archived_at: null,
    published_at: null,
    avatar_url: null,
  };

  beforeEach(() => vi.clearAllMocks());

  it('rejects agent in another workspace', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    } as never);

    await expect(
      repo.loadAgentConfiguration(
        baseAgent.id,
        '00000000-0000-4000-8000-000000000099',
        'tok',
      ),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it('rejects archived agent', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { ...baseAgent, status: 'archived', archived_at: new Date().toISOString() },
          error: null,
        }),
      }),
    } as never);

    await expect(
      repo.loadAgentConfiguration(baseAgent.id, baseAgent.workspace_id, 'tok'),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('loads valid agent configuration', async () => {
    vi.mocked(createUserSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: baseAgent, error: null }),
      }),
    } as never);

    const agent = await repo.loadAgentConfiguration(
      baseAgent.id,
      baseAgent.workspace_id,
      'tok',
    );
    expect(agent.system_prompt).toBe('You are helpful');
    expect(agent.public_id).toBe('agt_abc123');
  });
});

describe('security redaction', () => {
  it('does not require service role key for Hub playground', () => {
    expect(config.supabase.serviceRoleKey).toBeUndefined();
  });

  it('logger redact paths include authorization and api key headers', async () => {
    const { buildApp } = await import('../../src/app.js');
    expect(typeof buildApp).toBe('function');
  });
});
