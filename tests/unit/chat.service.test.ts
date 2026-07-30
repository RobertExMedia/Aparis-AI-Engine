import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AiUnavailableError } from '../../src/utils/errors.js';
import type { ChatMessage } from '../../src/types/index.js';

const {
  chatMock,
  streamChatMock,
  createConversation,
  findConversation,
  listMessages,
  saveUserMessage,
  saveAssistantMessage,
  markGenerationFailed,
} = vi.hoisted(() => ({
  chatMock: vi.fn(),
  streamChatMock: vi.fn(),
  createConversation: vi.fn(),
  findConversation: vi.fn(),
  listMessages: vi.fn(),
  saveUserMessage: vi.fn(),
  saveAssistantMessage: vi.fn(),
  markGenerationFailed: vi.fn(),
}));

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
    createConversation,
    findConversation,
    listMessages,
    saveUserMessage,
    saveAssistantMessage,
    markGenerationFailed,
    generateConversationTitle: vi.fn().mockResolvedValue('Title'),
    updateConversationTimestamp: vi.fn(),
    touchConversation: vi.fn(),
  },
}));

vi.mock('../../src/services/knowledge-retrieval.service.js', () => ({
  knowledgeRetrievalService: {
    retrieve: vi.fn().mockResolvedValue({
      texts: [],
      citations: [],
      payload: { used: false, sources: [] },
    }),
    buildGroundingBlock: vi.fn().mockReturnValue(undefined),
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
    createConversation.mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000cc',
      workspace_id: baseRequest.workspaceId,
      agent_id: baseRequest.agentId,
      title: 'New conversation',
      started_by: 'user-1',
    });
    findConversation.mockResolvedValue(null);
    listMessages.mockResolvedValue([]);
    saveUserMessage.mockResolvedValue({});
    saveAssistantMessage.mockResolvedValue({});
    markGenerationFailed.mockResolvedValue(undefined);
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
    expect(saveUserMessage).toHaveBeenCalled();
    expect(saveAssistantMessage).toHaveBeenCalled();
  });

  it('creates conversation when conversationId omitted', async () => {
    await service.chat({
      request: baseRequest,
      userId: 'user-1',
      accessToken: 'tok',
    });
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        startedBy: 'user-1',
        workspaceId: baseRequest.workspaceId,
        agentId: baseRequest.agentId,
      }),
    );
    expect(createConversation.mock.calls[0]?.[0]).not.toHaveProperty('id');
  });

  it('creates conversation when client sends a new conversationId', async () => {
    const conversationId = '00000000-0000-4000-8000-0000000000ff';
    findConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({
      id: conversationId,
      workspace_id: baseRequest.workspaceId,
      agent_id: baseRequest.agentId,
      title: 'New conversation',
      started_by: 'user-1',
    });

    const result = await service.chat({
      request: { ...baseRequest, conversationId },
      userId: 'user-1',
      accessToken: 'tok',
    });

    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: conversationId,
        workspaceId: baseRequest.workspaceId,
        agentId: baseRequest.agentId,
        startedBy: 'user-1',
      }),
    );
    expect(result.conversationId).toBe(conversationId);
  });

  it('loads history for existing conversation', async () => {
    const conversationId = '00000000-0000-4000-8000-0000000000cc';
    findConversation.mockResolvedValue({
      id: conversationId,
      workspace_id: baseRequest.workspaceId,
      agent_id: baseRequest.agentId,
      title: 'Existing',
      started_by: 'user-1',
    });

    await service.chat({
      request: {
        ...baseRequest,
        conversationId,
      },
      userId: 'user-1',
      accessToken: 'tok',
    });
    expect(createConversation).not.toHaveBeenCalled();
    expect(listMessages).toHaveBeenCalled();
  });

  it('sends prior turns so the third message can reference the first', async () => {
    const conversationId = '00000000-0000-4000-8000-0000000000cc';
    findConversation.mockResolvedValue({
      id: conversationId,
      workspace_id: baseRequest.workspaceId,
      agent_id: baseRequest.agentId,
      title: 'Existing',
      started_by: 'user-1',
    });
    listMessages.mockResolvedValue([
      { role: 'user', content: 'Who are you?' },
      { role: 'assistant', content: 'I am a helpful assistant.' },
      { role: 'user', content: 'What day is it?' },
      { role: 'assistant', content: 'It is Thursday.' },
    ]);

    await service.chat({
      request: {
        ...baseRequest,
        conversationId,
        message: 'What was my first question?',
      },
      userId: 'user-1',
      accessToken: 'tok',
    });

    expect(listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId, workspaceId: baseRequest.workspaceId }),
    );
    expect(chatMock).toHaveBeenCalledTimes(1);
    const sent = chatMock.mock.calls[0]?.[0] as ChatMessage[];
    expect(sent[0]?.role).toBe('system');
    expect(sent.some((m) => m.role === 'user' && m.content === 'Who are you?')).toBe(true);
    expect(sent.some((m) => m.role === 'assistant' && m.content === 'I am a helpful assistant.')).toBe(
      true,
    );
    expect(sent.at(-1)).toEqual({
      role: 'user',
      content: 'What was my first question?',
    });
    // History is loaded before persisting this turn
    expect(listMessages.mock.invocationCallOrder[0]).toBeLessThan(
      saveUserMessage.mock.invocationCallOrder[0],
    );
    expect(chatMock.mock.invocationCallOrder[0]).toBeLessThan(
      saveUserMessage.mock.invocationCallOrder[0],
    );
  });

  it('isolates cross-workspace conversations', async () => {
    findConversation.mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000cc',
      workspace_id: baseRequest.workspaceId,
      agent_id: baseRequest.agentId,
      title: 'Existing',
      started_by: 'user-1',
    });

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
    expect(markGenerationFailed).toHaveBeenCalled();
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
    expect(markGenerationFailed).toHaveBeenCalled();
  });
});
