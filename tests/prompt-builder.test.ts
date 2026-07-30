import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '../src/services/prompt-builder.service.js';

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  it('builds messages with system, knowledge, conversation, and question', () => {
    const result = builder.build({
      systemPrompt: 'You are a helpful assistant.',
      knowledge: ['Product X costs $10.'],
      conversation: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ],
      currentQuestion: 'How much is Product X?',
    });

    expect(result.messages[0]?.role).toBe('system');
    expect(result.messages[0]?.content).toContain('helpful assistant');
    expect(result.messages[1]?.role).toBe('system');
    expect(result.messages[1]?.content).toContain('Product X costs $10');
    expect(result.messages.at(-1)?.role).toBe('user');
    expect(result.messages.at(-1)?.content).toBe('How much is Product X?');
    expect(result.finalPrompt).toContain('[SYSTEM]');
    expect(result.finalPrompt).toContain('[KNOWLEDGE]');
  });

  it('does not duplicate current question if already last user message', () => {
    const result = builder.build({
      conversation: [{ role: 'user', content: 'Hello' }],
      currentQuestion: 'Hello',
    });

    const userMessages = result.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
  });
});
