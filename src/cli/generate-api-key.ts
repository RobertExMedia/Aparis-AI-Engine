/**
 * One-time API key generator (compiled into dist for production images).
 * Uses the same SHA-256(+pepper) hashing as auth middleware / hashApiKey().
 * Prints to stdout only — never write keys to disk or commit them.
 *
 * Requires API_KEY_HASH_SECRET to match the deployment that will verify the key.
 *
 * Usage: node dist/cli/generate-api-key.js
 *    or: npm run generate-api-key
 */
import { generateApiKey, hashApiKey, safeCompare } from '../utils/crypto.js';

const { key, hash } = generateApiKey();

if (!safeCompare(hashApiKey(key), hash)) {
  console.error('Generated hash does not match hashApiKey(); aborting.');
  process.exit(1);
}

console.log(`PLAIN_API_KEY=${key}`);
console.log(`API_KEY_HASHED=${hash}`);
