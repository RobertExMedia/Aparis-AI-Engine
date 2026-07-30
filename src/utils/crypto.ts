import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';

export function hashApiKey(key: string): string {
  const pepper = config.apiKeyHashSecret ?? '';
  return createHash('sha256').update(`${pepper}${key}`).digest('hex');
}

export function generateApiKey(prefix = 'apk'): { key: string; hash: string; keyPrefix: string } {
  const secret = randomBytes(32).toString('hex');
  const key = `${prefix}_${secret}`;
  return {
    key,
    hash: hashApiKey(key),
    keyPrefix: key.slice(0, 12),
  };
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function estimateTokens(text: string): number {
  // Rough heuristic ~4 chars per token
  return Math.ceil(text.length / 4);
}
