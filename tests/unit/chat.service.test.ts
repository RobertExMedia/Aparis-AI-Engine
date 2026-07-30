import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AiUnavailableError } from '../../src/utils/errors.js';
import type { ChatMessage } from '../../src/types/index.js';

const chatMock = vi.fn();
const streamChatMock = vi.fn();

vi.mock('../../src/providers/index.js', () => ({
  getAIProvider: () => ({
    name: 'ollama',
    chat: chatMock,
    streamChat: streamChatMock,
    health: vi.fn(),
    models: vi.fn(),
    embeddings: vi.fn(),
  }),
}));

vi.mock('../../src/services/workspace-authorization.service.js', () => ({
  workspaceAuthorizationService: {
    assertMembership: vi.fn().mockResolvedValue({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      userId: 'user-1',
      role: 'editor',
      canChat: true,
    }),
  },
}));

const agentConfig = {
  id: '00000000-0000-4000-8000-0000000000aa',
  workspace_id: '00000000-0000-4000-8000-000000000001',
  public_id: 'agt_test',
  name: 'Agent',
  description: null,
  status: 'draft' as const,
  system_prompt: 'Be concise',
  greeting: 'Hi',
  fallback_message: 'Fallback',
  language: 'en',
  tone: 'professional' as const,
  temperature: 0.7,
  max_tokens: 1024,
  settings: {},
  archived_at: null,
  published_at: null,
  avatar_url: null,
};

vi.mock('../../src/repositories/supabase/agent.repository.js', () => ({
  supabaseAgentRepository: {
    loadAgentConfiguration: vi.fn().mockResolvedValue(agentConfig),
  },
}));

const createConversation = vi.fn().mockResolvedValue({
  id: '00000000-0000-4000-8000-0000000000cc',
  workspace_id: '00000000-0000-4000-8000-000000000001',
  agent_id: '00000000-0000-4000-8000-0000000000aa',
  title: null,
});

vi.mock('../../src/repositories/supabase/conversation.repository.js', () => ({
  supabaseConversationRepository: {
    createConversation,
    verifyConversationAccess: vi.fn().mockImplementation(async (p) => {
      if (p.workspaceId !== '00000000-0000-4000-8000-000000000001') {
        const { ForbiddenError } = await import('../../src/utils/errors.js');
        throw new ForbiddenError();
      }
      return {
        id: p.conversationId,
        workspace_id: p.workspaceId,
        agent_id: p.agentId,
        title: 'Existing',
      };
    }),
    listMessages: vi.fn().mockResolvedValue([]),
    saveUserMessage: vi.fn().mockResolvedValue({}),
    saveAssistantMessage: vi.fn().mockResolvedValue({}),
    markGenerationFailed: vi.fn().mockResolvedValue(undefined),
    generateConversationTitle: vi.fn().mockResolvedValue('Title'),
    updateConversationTimestamp: vi.fn(),
  },
}));

vi.mock('../../src/services/knowledge.service.js', () => ({
  knowledgeService: {
    search: vi.fn().mockResolvedValue([]),
    index: vi.fn(),
    delete: vi.fn(),
  },
}));

import { ChatService } from '../../src/services/chat.service.js';
import { supabaseConversationRepository } from '../../src/repositories/supabase/conversation.repository.js';

describe('ChatService', () => {
  const service = new ChatService();
  const baseRequest = {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    agentId: '00000000-0000-4000-8000-0000000000aa',
    message: 'Hello',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chatMock.mockResolvedValue({
      message: { role: 'assistant', content: 'Hi there' },
      model: 'deepseek-r1:1.5b',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
  });

  it('completes a valid chat request and stores messages', async () => {
    const result = await service.chat({
      request: baseRequest,
      userId: 'user-1',
      accessToken: 'tok',
    });

    expect(result.message.content).toBe('Hi there');
    expect(result.provider).toBe('ollama');
    expect(result.conversationId).toBeTruthy();
    expect(supabaseConversationRepository.saveUserMessage).toHaveBeenCalled();
    expect(supabaseConversationRepository.saveAssistantMessage).toHaveBeenCalled();
  });

  it('creates conversation when conversationId omitted', async () => {
    await service.chat({
      request: baseRequest,
      userId: 'user-1',
      accessToken: 'tok',
    });
    expect(createConversation).toHaveBeenCalled();
  });

  it('loads history for existing conversation', async () => {
    await service.chat({
      request: {
        ...baseRequest,
        conversationId: '00000000-0000-4000-8000-0000000000cc',
      },
      userId: 'user-1',
      accessToken: 'tok',
    });
    expect(supabaseConversationRepository.listMessages).toHaveBeenCalled();
  });

  it('isolates cross-workspace conversations', async () => {
    await expect(
      service.chat({
        request: {
          ...baseRequest,
          workspaceId: '00000000-0000-4000-8000-000000000099',
          conversationId: '00000000-0000-4000-8000-0000000000cc',
        },
        userId: 'user-1',
        accessToken: 'tok',
      }),
    ).rejects.toThrow();
  });

  it('maps Ollama failure to AI unavailable', async () => {
    chatMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      service.chat({
        request: baseRequest,
        userId: 'user-1',
        accessToken: 'tok',
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(supabaseConversationRepository.markGenerationFailed).toHaveBeenCalled();
  });

  it('streams tokens then done', async () => {
    async function* gen(): AsyncGenerator<string, { message: ChatMessage; model: string }, unknown> {
      yield 'Hel';
      yield 'lo';
      return { message: { role: 'assistant', content: 'Hello' }, model: 'deepseek-r1:1.5b' };
    }
    streamChatMock.mockReturnValue(gen());

    const events = [];
    for await (const evt of service.streamChat({
      request: baseRequest,
      userId: 'user-1',
      accessToken: 'tok',
    })) {
      events.push(evt);
    }

    expect(events[0]?.event).toBe('start');
    expect(events.some((e) => e.event === 'token')).toBe(true);
    expect(events.at(-1)?.event).toBe('done');
  });

  it('aborts stream on client disconnect signal', async () => {
    const abort = new AbortController();
    async function* gen(): AsyncGenerator<string, { message: ChatMessage; model: string }, unknown> {
      yield 'A';
      abort.abort();
      yield 'B';
      return { message: { role: 'assistant', content: 'AB' }, model: 'm' };
    }
    streamChatMock.mockReturnValue(gen());

    const events = [];
    for await (const evt of service.streamChat({
      request: baseRequest,
      userId: 'user-1',
      accessToken: 'tok',
      signal: abort.signal,
    })) {
      events.push(evt);
    }

    expect(events.some((e) => e.event === 'done')).toBe(false);
    expect(supabaseConversationRepository.markGenerationFailed).toHaveBeenCalled();
  });
});
