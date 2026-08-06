/**
 * Generate a public website widget key (wpk_…).
 * Store key_hash + key_prefix on Hub `widget_keys` for the target agent.
 * Never commit the plaintext key.
 *
 * Usage: npm run generate-widget-key
 */
import { generateWidgetKey, hashApiKey, safeCompare } from '../utils/crypto.js';

const { key, hash, keyPrefix } = generateWidgetKey();

if (!safeCompare(hashApiKey(key), hash)) {
  console.error('Generated hash does not match hashApiKey(); aborting.');
  process.exit(1);
}

console.log(`PLAIN_WIDGET_KEY=${key}`);
console.log(`WIDGET_KEY_HASH=${hash}`);
console.log(`WIDGET_KEY_PREFIX=${keyPrefix}`);
