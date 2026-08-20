import { freemem, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { getAIProvider } from '../providers/index.js';
import { OllamaProvider } from '../providers/ollama/ollama.provider.js';
import { createAnonSupabaseClient } from '../supabase/client.js';
import { config } from '../config/index.js';
import type { ComponentHealth, HealthCheckResult } from '../types/index.js';

async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: 'Operational database unreachable',
    };
  }
}

async function checkRedis(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const pong = await redis.ping();
    return {
      status: pong === 'PONG' ? 'ok' : 'error',
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: 'Redis unreachable',
    };
  }
}

async function checkOllama(): Promise<ComponentHealth> {
  const result = await getAIProvider().health();
  return {
    status: result.ok ? 'ok' : 'error',
    latencyMs: result.latencyMs,
    message: result.message,
  };
}

async function checkOllamaEmbeddings(): Promise<ComponentHealth> {
  const provider = getAIProvider();
  if (!(provider instanceof OllamaProvider)) {
    return { status: 'ok', message: 'Embedding probe skipped (non-Ollama provider)' };
  }
  const result = await provider.embeddingHealth();
  return {
    status: result.ok ? 'ok' : 'error',
    latencyMs: result.latencyMs,
    message: result.message,
    details: result.model ? { model: result.model } : undefined,
  };
}

async function checkSupabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    // `plans` is readable by anon in aparis-ai-hub — no service-role needed
    const client = createAnonSupabaseClient();
    const { error } = await client.from('plans').select('code').limit(1);
    if (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        message: 'Supabase query failed',
      };
    }
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: 'Supabase unreachable',
    };
  }
}

async function checkDisk(): Promise<ComponentHealth> {
  try {
    const stats = await statfs('/');
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const usedRatio = 1 - free / total;
    const status = usedRatio > 0.95 ? 'error' : 'ok';
    return {
      status,
      details: {
        totalBytes: total,
        freeBytes: free,
        usedPercent: Math.round(usedRatio * 1000) / 10,
      },
      message: status === 'error' ? 'Disk usage critical (>95%)' : undefined,
    };
  } catch {
    return { status: 'error', message: 'Disk check failed' };
  }
}

function checkMemory(): ComponentHealth {
  const total = totalmem();
  const free = freemem();
  const usedRatio = 1 - free / total;
  const status = usedRatio > 0.95 ? 'error' : 'ok';
  return {
    status,
    details: {
      totalBytes: total,
      freeBytes: free,
      usedPercent: Math.round(usedRatio * 1000) / 10,
    },
    message: status === 'error' ? 'Memory usage critical (>95%)' : undefined,
  };
}

export class HealthService {
  async check(): Promise<HealthCheckResult> {
    const [database, redisHealth, ollama, ollamaEmbeddings, supabase, disk] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkOllama(),
      checkOllamaEmbeddings(),
      checkSupabase(),
      checkDisk(),
    ]);
    const memory = checkMemory();

    const checks = { database, redis: redisHealth, ollama, ollamaEmbeddings, supabase, disk, memory };
    const values = Object.values(checks);
    const allOk = values.every((c) => c.status === 'ok');

    return {
      status: allOk ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
      version: config.app.version,
    };
  }
}

export const healthService = new HealthService();
