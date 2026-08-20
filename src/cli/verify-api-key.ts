/**
 * Diagnostic: verify a plain API key against API_KEY_HASHED using the same
 * hashApiKey + safeCompare path as authentication middleware.
 *
 * Usage: node dist/cli/verify-api-key.js <plain_api_key>
 *    or: npm run verify-api-key -- <plain_api_key>
 *
 * Prints only: matches: true | matches: false
 */
import { hashApiKey, safeCompare } from '../utils/crypto.js';

const key = process.argv[2] ?? '';
const envHash = process.env.API_KEY_HASHED ?? '';

const matches =
  key.length > 0 && envHash.length > 0 && safeCompare(hashApiKey(key), envHash);

console.log(`matches: ${matches}`);
process.exit(matches ? 0 : 1);
