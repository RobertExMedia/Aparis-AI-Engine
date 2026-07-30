import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const PLACEHOLDER_API_KEYS = new Set([
  'apk_dev_master_key_change_me',
  'change-me',
  'changeme',
]);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  OLLAMA_BASE_URL: z.string().url().default('https://ai.aparis.io'),
  OLLAMA_CHAT_ENDPOINT: z.string().default('/api/chat'),
  OLLAMA_MODELS_ENDPOINT: z.string().default('/api/tags'),
  OLLAMA_EMBEDDINGS_ENDPOINT: z.string().default('/api/embeddings'),
  OLLAMA_CHAT_MODEL: z.string().default('deepseek-r1:1.5b'),
  OLLAMA_EMBEDDING_MODEL: z.string().optional(),
  OLLAMA_EMBED_MODEL: z.string().optional(),
  OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().optional(),
  OLLAMA_TIMEOUT_MS: z.coerce.number().optional(),
  OLLAMA_ALLOWED_MODELS: z.string().optional().default(''),

  JWT_SECRET: z.string().min(16).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ADMIN_JWT_SECRET: z.string().min(16).optional(),
  API_KEY_HASH_SECRET: z.string().optional().default(''),
  MASTER_API_KEYS: z.string().optional().default(''),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  ALLOWED_ORIGINS: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;
const isTest = env.NODE_ENV === 'test';
const isProd = env.NODE_ENV === 'production';
const isDev = env.NODE_ENV === 'development';

function requireInProd(name: string, value: string | undefined): string {
  if (value && value.length > 0) return value;
  if (isTest) {
    const defaults: Record<string, string> = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-jwt-secret-32-characters!!',
      ADMIN_JWT_SECRET: 'test-admin-secret-32-characters!',
    };
    return defaults[name] ?? `test-${name}`;
  }
  if (isProd) {
    console.error(`Missing required production environment variable: ${name}`);
    process.exit(1);
  }
  // development: allow missing with placeholders so docs/build still work
  const devDefaults: Record<string, string> = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'dev-anon-key-replace-me',
    SUPABASE_SERVICE_ROLE_KEY: 'dev-service-role-key-replace-me',
    DATABASE_URL: 'postgresql://aparis:aparis@localhost:5432/aparis_ai_engine?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'dev-jwt-secret-change-me-32chars',
    ADMIN_JWT_SECRET: 'dev-admin-secret-change-me-32c',
  };
  return value && value.length > 0 ? value : (devDefaults[name] ?? '');
}

const masterApiKeys = env.MASTER_API_KEYS
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean)
  .filter((k) => {
    if (PLACEHOLDER_API_KEYS.has(k)) {
      if (!isDev && !isTest) {
        console.error('Refusing to start: placeholder MASTER_API_KEYS value in non-development');
        process.exit(1);
      }
      console.warn(
        `[security] Ignoring placeholder API key "${k}". Set a real key or leave MASTER_API_KEYS empty.`,
      );
      return false;
    }
    return true;
  });

const allowedOriginsRaw =
  env.ALLOWED_ORIGINS ??
  env.CORS_ORIGIN ??
  'https://studio.aparis.io,http://localhost:5173,http://localhost:8080';

const embedModel =
  env.OLLAMA_EMBEDDING_MODEL ?? env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';
const timeoutMs =
  env.OLLAMA_REQUEST_TIMEOUT_MS ?? env.OLLAMA_TIMEOUT_MS ?? 120_000;

export const config = {
  env: env.NODE_ENV,
  isProd,
  isDev,
  isTest,
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,

  databaseUrl: requireInProd('DATABASE_URL', env.DATABASE_URL),
  redisUrl: requireInProd('REDIS_URL', env.REDIS_URL),

  supabase: {
    url: requireInProd('SUPABASE_URL', env.SUPABASE_URL),
    anonKey: requireInProd('SUPABASE_ANON_KEY', env.SUPABASE_ANON_KEY),
    /** Optional — Lovable Cloud does not expose this. Hub playground uses JWT + RLS. */
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '',
  },

  jwt: {
    secret: requireInProd('JWT_SECRET', env.JWT_SECRET),
    expiresIn: env.JWT_EXPIRES_IN,
    adminSecret: requireInProd('ADMIN_JWT_SECRET', env.ADMIN_JWT_SECRET),
  },

  apiKeyHashSecret: env.API_KEY_HASH_SECRET,
  masterApiKeys,

  ollama: {
    baseUrl: env.OLLAMA_BASE_URL.replace(/\/$/, ''),
    chatEndpoint: env.OLLAMA_CHAT_ENDPOINT.startsWith('/')
      ? env.OLLAMA_CHAT_ENDPOINT
      : `/${env.OLLAMA_CHAT_ENDPOINT}`,
    modelsEndpoint: env.OLLAMA_MODELS_ENDPOINT.startsWith('/')
      ? env.OLLAMA_MODELS_ENDPOINT
      : `/${env.OLLAMA_MODELS_ENDPOINT}`,
    embeddingsEndpoint: env.OLLAMA_EMBEDDINGS_ENDPOINT.startsWith('/')
      ? env.OLLAMA_EMBEDDINGS_ENDPOINT
      : `/${env.OLLAMA_EMBEDDINGS_ENDPOINT}`,
    chatModel: env.OLLAMA_CHAT_MODEL,
    embedModel,
    timeoutMs,
    allowedModels: env.OLLAMA_ALLOWED_MODELS
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  },

  rateLimit: {
    max: env.RATE_LIMIT_MAX,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
  },

  allowedOrigins: allowedOriginsRaw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  app: {
    name: 'Aparis AI Engine',
    version: '1.0.0',
  },
} as const;

export type Config = typeof config;

/** Startup warnings for misconfiguration (never logs secrets). */
export function runStartupSecurityChecks(): void {
  if (config.supabase.url.includes('example.supabase.co') && config.isProd) {
    throw new Error('SUPABASE_URL is not configured for production');
  }
  if (config.supabase.anonKey.includes('replace-me') && config.isProd) {
    throw new Error('SUPABASE_ANON_KEY is a placeholder in production');
  }
  if (config.isProd && config.allowedOrigins.includes('*')) {
    throw new Error('Wildcard ALLOWED_ORIGINS is not permitted in production');
  }
}
