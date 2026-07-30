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
import { logger } from './utils/logger.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: config.corsOrigin,
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
        description:
          'Production AI backend engine powering Aparis products. Multi-tenant, provider-abstracted, JWT & API key authenticated.',
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
        { name: 'Chat', description: 'Chat completions' },
        { name: 'Models', description: 'Available AI models' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Workspace JWT',
          },
          apiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'Workspace API key (apk_...)',
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
