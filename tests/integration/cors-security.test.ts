import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from '../../src/config/index.js';

describe('CORS', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('accepts configured Aparis AI Hub origin', async () => {
    const app = Fastify();
    await app.register(cors, {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        cb(null, config.allowedOrigins.includes(origin));
      },
    });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const origin = config.allowedOrigins[0] ?? 'https://studio.aparis.io';
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: {
        origin,
        'access-control-request-method': 'GET',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    await app.close();
  });

  it('rejects unknown origin', async () => {
    const app = Fastify();
    await app.register(cors, {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        cb(null, config.allowedOrigins.includes(origin));
      },
    });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});

describe('service role never in responses', () => {
  it('error bodies do not include service role key', async () => {
    const { errorHandler } = await import('../../src/middleware/error-handler.js');
    const { UnauthorizedError } = await import('../../src/utils/errors.js');
    const sent: unknown[] = [];
    const reply = {
      status: () => ({
        send: (body: unknown) => {
          sent.push(body);
        },
      }),
    };
    errorHandler(
      new UnauthorizedError(),
      { id: '1', auth: undefined, url: '/', method: 'GET' } as never,
      reply as never,
    );
    const body = JSON.stringify(sent[0]);
    expect(body).not.toContain(config.supabase.serviceRoleKey);
    expect(body).not.toContain('service_role');
  });
});
