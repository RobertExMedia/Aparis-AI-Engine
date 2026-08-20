/**
 * Supabase Storage object keys must be S3-safe (ASCII, no spaces/commas, etc.).
 * Hub may store the original filename in `storage_path` while the uploaded object
 * uses a sanitized name — resolve at download time.
 */

const UPLOAD_ID_PREFIX_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i;

/** Characters Supabase Storage rejects in object keys (S3-safe subset). */
const UNSAFE_KEY_CHARS = /[^A-Za-z0-9!_\-. *'()]/g;

export function parseKnowledgeStoragePath(storagePath: string): {
  prefix: string;
  objectName: string;
  uploadId: string | null;
} | null {
  const trimmed = storagePath.trim().replace(/^\/+/, '');
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return null;
  const rest = trimmed.slice(slash + 1);
  const secondSlash = rest.indexOf('/');
  if (secondSlash <= 0) return null;

  const workspaceId = trimmed.slice(0, slash);
  const sourceId = rest.slice(0, secondSlash);
  const objectName = rest.slice(secondSlash + 1);
  if (!workspaceId || !sourceId || !objectName) return null;

  const uploadMatch = objectName.match(UPLOAD_ID_PREFIX_RE);
  return {
    prefix: `${workspaceId}/${sourceId}`,
    objectName,
    uploadId: uploadMatch?.[1] ?? null,
  };
}

/** Strip diacritics and replace disallowed characters for storage keys. */
export function sanitizeStorageObjectName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(UNSAFE_KEY_CHARS, '_')
    .replace(/\s+/g, '_')
    .replace(/[,;]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  return ascii.length > 0 ? ascii : 'file';
}

export function buildSanitizedStoragePath(storagePath: string): string | null {
  const parsed = parseKnowledgeStoragePath(storagePath);
  if (!parsed) return null;
  const sanitizedObject = sanitizeStorageObjectName(parsed.objectName);
  if (sanitizedObject === parsed.objectName) return null;
  return `${parsed.prefix}/${sanitizedObject}`;
}

export function isInvalidStorageKeyError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('invalid key') || lower.includes('invalidkey');
}
