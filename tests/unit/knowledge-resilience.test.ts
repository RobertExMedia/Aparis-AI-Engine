import { describe, expect, it } from 'vitest';
import type { Job } from 'bullmq';
import { isFinalKnowledgeAttempt } from '../../src/services/knowledge-processing.service.js';
import { displayStageName } from '../../src/knowledge/processing-stages.js';

function fakeJob(attemptsMade: number, attempts: number): Job {
  return {
    attemptsMade,
    opts: { attempts },
  } as Job;
}

describe('knowledge processing resilience', () => {
  it('treats missing BullMQ job as final attempt', () => {
    expect(isFinalKnowledgeAttempt(undefined)).toBe(true);
  });

  it('detects intermediate vs final BullMQ attempts', () => {
    expect(isFinalKnowledgeAttempt(fakeJob(0, 3))).toBe(false);
    expect(isFinalKnowledgeAttempt(fakeJob(1, 3))).toBe(false);
    expect(isFinalKnowledgeAttempt(fakeJob(2, 3))).toBe(true);
    expect(isFinalKnowledgeAttempt(fakeJob(0, 1))).toBe(true);
  });

  it('exposes embedding stage label for failure banners', () => {
    expect(displayStageName('generating_embeddings')).toBe('Generating Embeddings');
  });
});
