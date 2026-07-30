import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ADMIN_JWT_SECRET: z.string().min(16),
  MASTER_API_KEYS: z.string().optional().default(''),

  OLLAMA_BASE_URL: z.string().url().default('https://ai.aparis.io'),
  OLLAMA_CHAT_MODEL: z.string().default('deepseek-r1:latest'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().default(120_000),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  CORS_ORIGIN: z.string().default('https://api-ai.aparis.io'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,

  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    adminSecret: env.ADMIN_JWT_SECRET,
  },

  masterApiKeys: env.MASTER_API_KEYS
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),

  ollama: {
    baseUrl: env.OLLAMA_BASE_URL.replace(/\/$/, ''),
    chatModel: env.OLLAMA_CHAT_MODEL,
    embedModel: env.OLLAMA_EMBED_MODEL,
    timeoutMs: env.OLLAMA_TIMEOUT_MS,
  },

  rateLimit: {
    max: env.RATE_LIMIT_MAX,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
  },

  corsOrigin: env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),

  app: {
    name: 'Aparis AI Engine',
    version: '1.0.0',
  },
} as const;

export type Config = typeof config;
