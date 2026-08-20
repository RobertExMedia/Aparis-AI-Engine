import { describe, expect, it } from 'vitest';
import {
  estimateRemainingMs,
  progressForEmbeddingWork,
  STAGE_PROGRESS_END,
  STAGE_PROGRESS_START,
  displayStageName,
} from '../../src/knowledge/processing-stages.js';

describe('knowledge processing progress', () => {
  it('never invents embedding progress beyond real chunk ratio', () => {
    expect(progressForEmbeddingWork(0, 10)).toBe(STAGE_PROGRESS_START.generating_embeddings);
    expect(progressForEmbeddingWork(5, 10)).toBe(
      Math.floor(
        STAGE_PROGRESS_START.generating_embeddings +
          0.5 *
            (STAGE_PROGRESS_END.generating_embeddings -
              STAGE_PROGRESS_START.generating_embeddings),
      ),
    );
    expect(progressForEmbeddingWork(10, 10)).toBe(STAGE_PROGRESS_END.generating_embeddings);
  });

  it('does not estimate ETA without enough real progress', () => {
    const started = new Date(Date.now() - 60_000).toISOString();
    expect(estimateRemainingMs(started, 0)).toBeNull();
    expect(estimateRemainingMs(started, 4)).toBeNull();
    expect(estimateRemainingMs(null, 50)).toBeNull();
  });

  it('estimates remaining time from elapsed and real progress only', () => {
    const started = new Date(Date.now() - 10_000).toISOString();
    const eta = estimateRemainingMs(started, 50);
    expect(eta).not.toBeNull();
    // 10s elapsed at 50% ⇒ ~10s remaining
    expect(eta!).toBeGreaterThanOrEqual(8_000);
    expect(eta!).toBeLessThanOrEqual(12_000);
  });

  it('maps stages to human labels for the frontend', () => {
    expect(displayStageName('extracting_text')).toBe('Extracting Text');
    expect(displayStageName('generating_embeddings')).toBe('Generating Embeddings');
    expect(displayStageName('completed')).toBe('Completed');
  });

  it('keeps stage progress floors ordered', () => {
    const order = [
      'uploading',
      'extracting_text',
      'cleaning_content',
      'chunking',
      'generating_embeddings',
      'saving_chunks',
      'indexing',
      'completed',
    ] as const;
    for (let i = 1; i < order.length; i++) {
      expect(STAGE_PROGRESS_START[order[i]]).toBeGreaterThanOrEqual(
        STAGE_PROGRESS_START[order[i - 1]],
      );
    }
  });
});
