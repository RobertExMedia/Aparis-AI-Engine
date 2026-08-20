import { describe, expect, it, vi, beforeEach } from 'vitest';
import { canViewRetrievalDebug } from '../../src/knowledge/retrieval-debug.js';
import { ChatService } from '../../src/services/chat.service.js';

const {
  chatMock,
  assertMembership,
  retrieveMock,
} = vi.hoisted(() => ({
  chatMock: vi.fn(),
  assertMembership: vi.fn(),
  retrieveMock: vi.fn(),
}));

vi.mock('../../src/providers/index.js', () => ({
  getAIProvider: () => ({
    name: 'ollama',
    chat: chatMock,
    streamChat: vi.fn(),
    health: vi.fn(),
    models: vi.fn(),
    embeddings: vi.fn(),
  }),
}));

vi.mock('../../src/services/workspace-authorization.service.js', () => ({
  workspaceAuthorizationService: {
    assertMembership,
  },
}));

vi.mock('../../src/repositories/supabase/agent.repository.js', () => ({
  supabaseAgentRepository: {
    loadAgentConfiguration: vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000aa',
      workspace_id: '00000000-0000-4000-8000-000000000001',
      public_id: 'agt_test',
      name: 'Agent',
      description: null,
      status: 'draft',
      system_prompt: 'Be concise',
      greeting: 'Hi',
      fallback_message: 'Fallback',
      language: 'en',
      tone: 'professional',
      temperature: 0.7,
      max_tokens: 1024,
      settings: {},
      archived_at: null,
      published_at: null,
      avatar_url: null,
    }),
  },
}));

vi.mock('../../src/repositories/supabase/conversation.repository.js', () => ({
  supabaseConversationRepository: {
    createConversation: vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000cc',
      workspace_id: '00000000-0000-4000-8000-000000000001',
      agent_id: '00000000-0000-4000-8000-0000000000aa',
      title: 'Chat',
      started_by: 'user-1',
    }),
    findConversation: vi.fn(),
    listMessages: vi.fn().mockResolvedValue([]),
    saveUserMessage: vi.fn(),
    saveAssistantMessage: vi.fn(),
    markGenerationFailed: vi.fn(),
    generateConversationTitle: vi.fn(),
    updateConversationTimestamp: vi.fn(),
    touchConversation: vi.fn(),
  },
}));

vi.mock('../../src/services/knowledge-retrieval.service.js', () => ({
  knowledgeRetrievalService: {
    retrieve: retrieveMock,
    buildGroundingBlock: vi.fn().mockReturnValue('Knowledge:\nHours: 9am'),
  },
}));

vi.mock('../../src/services/ai-credits.service.js', () => ({
  aiCreditsService: {
    assertAvailable: vi.fn().mockResolvedValue({ remaining: 10, used: 0, limit: 10 }),
    settle: vi.fn().mockResolvedValue({
      credits: { remaining: 9, used: 1, limit: 10 },
      creditsCharged: 1,
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
    }),
    getBalance: vi.fn(),
  },
}));

const debugPayload = {
  chunksRetrieved: 1,
  chunks: [
    {
      chunkId: 'chunk-1',
      content: 'We open at 9am.',
      similarity: 0.91,
      knowledgeSource: 'FAQ',
      sourceId: 'src-1',
      tokenCount: 6,
    },
  ],
  retrievalTimeMs: 42,
  embeddingModel: 'nomic-embed-text',
  topK: 8,
  threshold: 0.25,
};

describe('canViewRetrievalDebug', () => {
  it('allows only supabase owner/admin when requested', () => {
    expect(
      canViewRetrievalDebug({
        authMethod: 'supabase',
        role: 'owner',
        requested: true,
      }),
    ).toBe(true);
    expect(
      canViewRetrievalDebug({
        authMethod: 'supabase',
        role: 'admin',
        requested: true,
      }),
    ).toBe(true);
  });

  it('denies editors, viewers, unrequested, and API keys (widgets)', () => {
    expect(
      canViewRetrievalDebug({
        authMethod: 'supabase',
        role: 'editor',
        requested: true,
      }),
    ).toBe(false);
    expect(
      canViewRetrievalDebug({
        authMethod: 'supabase',
        role: 'owner',
        requested: false,
      }),
    ).toBe(false);
    expect(
      canViewRetrievalDebug({
        authMethod: 'api_key',
        role: 'owner',
        requested: true,
      }),
    ).toBe(false);
  });
});

describe('ChatService retrievalDebug gating', () => {
  const service = new ChatService();
  const baseRequest = {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    agentId: '00000000-0000-4000-8000-0000000000aa',
    message: 'What time do you open?',
    retrievalDebug: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chatMock.mockResolvedValue({
      message: { role: 'assistant', content: '9am' },
      model: 'deepseek-r1:1.5b',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    retrieveMock.mockResolvedValue({
      texts: ['[FAQ]\nWe open at 9am.'],
      citations: [
        {
          sourceId: 'src-1',
          sourceName: 'FAQ',
          chunkId: 'chunk-1',
          similarity: 0.91,
        },
      ],
      payload: {
        used: true,
        sources: [
          {
            sourceId: 'src-1',
            sourceName: 'FAQ',
            chunkId: 'chunk-1',
            similarity: 0.91,
          },
        ],
      },
      debug: debugPayload,
    });
  });

  it('includes retrievalDebug for workspace admin when requested', async () => {
    assertMembership.mockResolvedValue({
      workspaceId: baseRequest.workspaceId,
      userId: 'user-1',
      role: 'admin',
      canChat: true,
      canViewRetrievalDebug: true,
    });

    const result = await service.chat({
      request: baseRequest,
      userId: 'user-1',
      accessToken: 'tok',
      authMethod: 'supabase',
    });

    expect(result.retrievalDebug).toEqual(debugPayload);
    expect(result.retrievalDebug?.chunks[0]?.similarity).toBe(0.91);
    expect(result.retrievalDebug?.embeddingModel).toBe('nomic-embed-text');
  });

  it('omits retrievalDebug for editors even when requested', async () => {
    assertMembership.mockResolvedValue({
      workspaceId: baseRequest.workspaceId,
      userId: 'user-1',
      role: 'editor',
      canChat: true,
      canViewRetrievalDebug: false,
    });

    const result = await service.chat({
      request: baseRequest,
      userId: 'user-1',
      accessToken: 'tok',
      authMethod: 'supabase',
    });

    expect(result.retrievalDebug).toBeUndefined();
  });

  it('never includes retrievalDebug for api_key / widget callers', async () => {
    assertMembership.mockResolvedValue({
      workspaceId: baseRequest.workspaceId,
      userId: 'user-1',
      role: 'owner',
      canChat: true,
      canViewRetrievalDebug: true,
    });

    const result = await service.chat({
      request: baseRequest,
      userId: 'user-1',
      accessToken: 'tok',
      authMethod: 'api_key',
    });

    expect(result.retrievalDebug).toBeUndefined();
  });
});
