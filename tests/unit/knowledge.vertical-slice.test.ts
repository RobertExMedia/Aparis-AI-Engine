import { describe, expect, it } from 'vitest';
import { chunkText } from '../../src/knowledge/chunker.js';
import { TxtMarkdownParser } from '../../src/knowledge/parsers/txt.parser.js';
import { resolveParser } from '../../src/knowledge/parsers/index.js';
import { PromptBuilder } from '../../src/services/prompt-builder.service.js';
import { ValidationError } from '../../src/utils/errors.js';

describe('knowledge chunker', () => {
  it('splits long text with overlap and removes duplicates', () => {
    const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const chunks = chunkText(text, { filename: 'a.txt', sourceType: 'text' }, {
      chunkSizeTokens: 80,
      overlapTokens: 20,
      removeDuplicates: true,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.metadata.filename).toBe('a.txt');
  });
});

describe('TXT parser', () => {
  it('extracts normalized text', async () => {
    const parser = new TxtMarkdownParser();
    const segments = await parser.parse(Buffer.from('Hello   world\n\n\nNext'), {
      fileName: 'note.txt',
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.content).toContain('Hello world');
  });
});

describe('parser registry', () => {
  it('rejects legacy DOC', () => {
    expect(() => resolveParser('legacy.doc')).toThrow(ValidationError);
  });

  it('resolves PDF parser', () => {
    expect(resolveParser('manual.pdf').id).toBe('pdf');
  });
});

describe('PromptBuilder knowledge + history', () => {
  const builder = new PromptBuilder();

  it('places knowledge after system and before history', () => {
    const result = builder.build({
      systemPrompt: 'You are helpful.',
      knowledgeContext: 'Knowledge:\nAparis opens at 9am.',
      conversation: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
      currentQuestion: 'When do you open?',
    });

    expect(result.messages.map((m) => m.role)).toEqual([
      'system',
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(result.messages[0]?.content).toBe('You are helpful.');
    expect(result.messages[1]?.content).toContain('Aparis opens at 9am');
    expect(result.messages.at(-1)?.content).toBe('When do you open?');
  });

  it('still works without knowledge', () => {
    const result = builder.build({
      systemPrompt: 'Be brief.',
      conversation: [],
      currentQuestion: 'Hello',
    });
    expect(result.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hello' },
    ]);
  });
});
