import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { chatRoutes } from './chat.routes.js';
import { healthRoutes } from './health.routes.js';
import { modelsRoutes } from './models.routes.js';
import { knowledgeRoutes } from './knowledge.routes.js';
import { widgetRoutes } from './widget.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      schema: {
        tags: ['Root'],
        summary: 'API root',
        response: {
          200: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              version: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({
      name: config.app.name,
      version: config.app.version,
      status: 'online',
    }),
  );

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(chatRoutes);
      await api.register(widgetRoutes);
      await api.register(modelsRoutes);
      await api.register(knowledgeRoutes);
    },
    { prefix: '/api/v1' },
  );
}
