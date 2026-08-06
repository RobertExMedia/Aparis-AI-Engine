import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerRateLimit } from './middleware/rate-limit.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      base: {
        service: config.app.name,
        version: config.app.version,
        env: config.env,
      },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.Authorization',
          'req.headers["x-api-key"]',
          'req.headers["X-API-Key"]',
          'req.headers["x-widget-key"]',
          'req.headers["X-Widget-Key"]',
          'req.headers.cookie',
          'req.headers.Cookie',
          'res.headers["set-cookie"]',
          'password',
          'token',
          'accessToken',
          'apiKey',
          'supabase.serviceRoleKey',
          'SUPABASE_SERVICE_ROLE_KEY',
        ],
        remove: true,
      },
      transport: config.isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      // Hub / Studio origins
      if (config.allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      // Third-party widget embeds: reflect Origin.
      // Domain whitelist is enforced in authenticateWidget (not CORS alone).
      cb(null, true);
    },
    credentials: true,
  });

  await app.register(jwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.expiresIn },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Aparis AI Engine',
        description: [
          'Backend AI engine for Aparis AI Hub / Studio.',
          '',
          '**Dashboard auth:** `Authorization: Bearer <Supabase access token>`',
          '',
          '**Data access:** Engine validates the user JWT and reads/writes agents & conversations under Supabase RLS. No service-role key is required for Hub playground.',
          '',
          '**Workspace authorization:** user must be a member with role `owner`, `admin`, or `editor`. Viewers are rejected for chat.',
          '',
          '**Agent source of truth:** Supabase `agents` table from aparis-ai-hub (system_prompt loaded server-side; never accepted from the client).',
          '',
          '**API keys:** `X-API-Key` is reserved for trusted server-to-server integrations only — not for the Hub playground.',
          '',
          '**Website widget:** `POST /api/v1/widget/chat` uses `X-Widget-Key` (wpk_…) + Origin domain whitelist. Never send a Supabase JWT from the browser widget. Conversations are stored with channel `website_widget` (isolated from playground). Requires `SUPABASE_SERVICE_ROLE_KEY` on the Engine.',
        ].join('\n'),
        version: config.app.version,
        contact: { name: 'Aparis', url: 'https://aparis.io' },
      },
      servers: [
        { url: 'https://api-ai.aparis.io', description: 'Production' },
        { url: `http://localhost:${config.port}`, description: 'Local' },
      ],
      tags: [
        { name: 'Root', description: 'Service root' },
        { name: 'Health', description: 'Health & readiness' },
        { name: 'Chat', description: 'Dashboard chat (Supabase auth)' },
        { name: 'Widget', description: 'Public website widget (widget key + domain)' },
        { name: 'Models', description: 'Available AI models (server-to-server)' },
      ],
      components: {
        securitySchemes: {
          supabaseBearer: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Supabase access token from Aparis AI Hub Auth',
          },
          apiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'Server-to-server only — not for Hub playground',
          },
          widgetKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Widget-Key',
            description: 'Public widget key (wpk_…). Must match an allowed Origin domain.',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  await registerRateLimit(app);
  app.setErrorHandler(errorHandler);
  await registerRoutes(app);

  return app;
}
