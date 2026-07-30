import type { ChatMessage } from '../types/index.js';

export interface PromptBuilderInput {
  systemPrompt?: string;
  knowledge?: string[];
  conversation?: ChatMessage[];
  currentQuestion?: string;
}

export interface PromptBuilderResult {
  messages: ChatMessage[];
  finalPrompt: string;
}

/**
 * Assembles a final prompt from system instructions, retrieved knowledge,
 * conversation history, and the current user question.
 */
export class PromptBuilder {
  build(input: PromptBuilderInput): PromptBuilderResult {
    const messages: ChatMessage[] = [];
    const sections: string[] = [];

    const systemParts: string[] = [];

    if (input.systemPrompt?.trim()) {
      systemParts.push(input.systemPrompt.trim());
      sections.push(`[SYSTEM]\n${input.systemPrompt.trim()}`);
    }

    if (input.knowledge && input.knowledge.length > 0) {
      const knowledgeBlock = input.knowledge
        .map((k, i) => `[${i + 1}] ${k.trim()}`)
        .filter(Boolean)
        .join('\n\n');

      if (knowledgeBlock) {
        systemParts.push(
          `Use the following knowledge context when relevant:\n\n${knowledgeBlock}`,
        );
        sections.push(`[KNOWLEDGE]\n${knowledgeBlock}`);
      }
    }

    if (systemParts.length > 0) {
      messages.push({
        role: 'system',
        content: systemParts.join('\n\n'),
      });
    }

    if (input.conversation && input.conversation.length > 0) {
      for (const msg of input.conversation) {
        if (msg.role === 'system') continue; // already handled
        messages.push({ role: msg.role, content: msg.content });
      }
      sections.push(
        `[CONVERSATION]\n${input.conversation
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n')}`,
      );
    }

    if (input.currentQuestion?.trim()) {
      const question = input.currentQuestion.trim();
      const last = messages[messages.length - 1];
      // Avoid duplicating if the last message is already this question
      if (!(last?.role === 'user' && last.content === question)) {
        messages.push({ role: 'user', content: question });
      }
      sections.push(`[QUESTION]\n${question}`);
    }

    return {
      messages,
      finalPrompt: sections.join('\n\n---\n\n'),
    };
  }
}

export const promptBuilder = new PromptBuilder();
