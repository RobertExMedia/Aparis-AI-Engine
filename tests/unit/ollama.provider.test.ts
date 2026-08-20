import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../../src/providers/ollama/ollama.provider.js';
import { AiUnavailableError } from '../../src/utils/errors.js';

vi.mock('axios', () => {
  const create = vi.fn();
  return {
    default: {
      create,
      isAxiosError: (err: unknown) =>
        Boolean(err && typeof err === 'object' && 'isAxiosError' in err),
    },
  };
});

import axios from 'axios';

describe('OllamaProvider', () => {
  const post = vi.fn();
  const get = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue({ post, get } as never);
  });

  it('uses configurable chat endpoint', async () => {
    post.mockResolvedValue({
      data: {
        model: 'deepseek-r1:1.5b',
        message: { role: 'assistant', content: 'ok' },
        done: true,
      },
    });
    const provider = new OllamaProvider();
    await provider.chat([{ role: 'user', content: 'hi' }]);
    expect(post.mock.calls[0]?.[0]).toMatch(/\/api\/chat/);
  });

  it('throws AI unavailable on timeout', async () => {
    const err = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout' };
    post.mockRejectedValue(err);
    const provider = new OllamaProvider();
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it('health returns unreachable without leaking host URL in message', async () => {
    get.mockRejectedValue({ isAxiosError: true, message: 'connect ECONNREFUSED https://secret-host' });
    const provider = new OllamaProvider();
    const result = await provider.health();
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain('http');
    expect(result.message).not.toContain('secret-host');
  });
});
