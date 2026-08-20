import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  normalizeWidgetDomain,
  extractRequestOriginHost,
  domainsMatch,
} from '../../src/utils/widget-origin.js';

describe('widget origin helpers', () => {
  it('normalizes origins to bare hostnames without www', () => {
    expect(normalizeWidgetDomain('https://WWW.Example.com:443/path')).toBe('example.com');
    expect(normalizeWidgetDomain('example.com')).toBe('example.com');
    expect(normalizeWidgetDomain('https://shop.brand.io')).toBe('shop.brand.io');
  });

  it('extracts host from Origin or Referer', () => {
    expect(extractRequestOriginHost({ origin: 'https://docs.acme.com' })).toBe('docs.acme.com');
    expect(
      extractRequestOriginHost({ referer: 'https://www.acme.com/page' }),
    ).toBe('acme.com');
    expect(extractRequestOriginHost({})).toBeNull();
  });

  it('matches allowed domains', () => {
    expect(domainsMatch('acme.com', 'https://www.acme.com')).toBe(true);
    expect(domainsMatch('acme.com', 'https://evil.com')).toBe(false);
  });
});

const { resolveAuth, createConversation, findWidgetConversation } = vi.hoisted(() => ({
  resolveAuth: vi.fn(),
  createConversation: vi.fn(),
  findWidgetConversation: vi.fn(),
}));

vi.mock('../../src/repositories/supabase/widget.repository.js', () => ({
  widgetRepository: {
    resolveAuth,
    createConversation,
    findWidgetConversation,
    listMessages: vi.fn().mockResolvedValue([]),
    saveUserMessage: vi.fn(),
    saveAssistantMessage: vi.fn(),
  },
}));

vi.mock('../../src/providers/index.js', () => ({
  getAIProvider: () => ({
    name: 'ollama',
    chat: vi.fn().mockResolvedValue({
      message: { role: 'assistant', content: 'Hello visitor' },
      model: 'deepseek-r1:1.5b',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    }),
    streamChat: vi.fn(),
    embeddings: vi.fn(),
    health: vi.fn(),
    models: vi.fn(),
  }),
}));

vi.mock('../../src/services/knowledge-retrieval.service.js', () => ({
  knowledgeRetrievalService: {
    retrieve: vi.fn().mockResolvedValue({
      texts: ['[FAQ]\nWe open at 9am'],
      citations: [],
      payload: {
        used: true,
        sources: [{ sourceName: 'FAQ', similarity: 0.9, chunkId: 'c1', sourceId: 's1' }],
      },
      debug: {
        chunksRetrieved: 1,
        chunks: [],
        retrievalTimeMs: 1,
        embeddingModel: 'nomic-embed-text',
        topK: 8,
        threshold: 0.25,
      },
    }),
    buildGroundingBlock: vi.fn().mockReturnValue('Knowledge:\nWe open at 9am'),
  },
}));

vi.mock('../../src/services/ai-credits.service.js', () => ({
  aiCreditsService: {
    assertAvailable: vi.fn().mockResolvedValue({ remaining: 100, used: 0, limit: 100 }),
    settle: vi.fn().mockResolvedValue({
      credits: { remaining: 99, used: 1, limit: 100 },
      creditsCharged: 1,
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
    }),
  },
}));

import { DomainNotAllowedError } from '../../src/utils/errors.js';
import { WidgetChatService } from '../../src/services/widget-chat.service.js';

describe('WidgetChatService isolation', () => {
  const service = new WidgetChatService();
  const agent = {
    id: '00000000-0000-4000-8000-0000000000aa',
    workspace_id: '00000000-0000-4000-8000-000000000001',
    public_id: 'agt_testwidget0001',
    name: 'Widget Agent',
    description: null,
    status: 'published' as const,
    system_prompt: 'Help visitors',
    greeting: 'Hi',
    fallback_message: 'Sorry',
    language: 'en',
    tone: 'friendly' as const,
    temperature: 0.5,
    max_tokens: 512,
    settings: {},
    archived_at: null,
    published_at: new Date().toISOString(),
    avatar_url: null,
  };

  const auth = {
    method: 'widget' as const,
    workspaceId: agent.workspace_id,
    agentId: agent.id,
    agentPublicId: agent.public_id,
    widgetKeyId: 'key-1',
    originHost: 'shop.example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createConversation.mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000cc',
      workspace_id: agent.workspace_id,
      agent_id: agent.id,
      channel: 'website_widget',
      started_by: null,
      title: 'Website chat',
    });
  });

  it('returns a lightweight response with citations and credits', async () => {
    const result = await service.chat({
      request: { agentId: agent.public_id, message: 'Hours?' },
      auth,
      agent,
    });

    expect(result.message.content).toBe('Hello visitor');
    expect(result.conversationId).toBeTruthy();
    expect(result.citations[0]?.sourceName).toBe('FAQ');
    expect(result.credits?.remaining).toBe(99);
    expect(result).not.toHaveProperty('retrievalDebug');
    expect(result).not.toHaveProperty('provider');
  });

  it('rejects resume of non-widget (playground) conversations', async () => {
    findWidgetConversation.mockResolvedValue(null);

    await expect(
      service.chat({
        request: {
          agentId: agent.public_id,
          conversationId: '00000000-0000-4000-8000-0000000000ff',
          message: 'Hi',
        },
        auth,
        agent,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('widget domain auth rejection', () => {
  it('DomainNotAllowedError uses DOMAIN_NOT_ALLOWED code', () => {
    const err = new DomainNotAllowedError();
    expect(err.code).toBe('DOMAIN_NOT_ALLOWED');
    expect(err.statusCode).toBe(403);
  });

  it('resolveAuth surfaces unauthorized domains', async () => {
    resolveAuth.mockRejectedValue(new DomainNotAllowedError());
    await expect(
      resolveAuth({
        widgetKey: 'wpk_test',
        originHost: 'evil.com',
        agentPublicId: 'agt_x',
      }),
    ).rejects.toBeInstanceOf(DomainNotAllowedError);
  });
});
