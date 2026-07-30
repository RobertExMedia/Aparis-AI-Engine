import { buildApp } from './app.js';
import { config, runStartupSecurityChecks } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { getAIProvider } from './providers/index.js';
import { startKnowledgeWorker } from './workers/knowledge.worker.js';
import { logger } from './utils/logger.js';

async function main() {
  runStartupSecurityChecks();

  await connectDatabase();
  await connectRedis();

  const ollama = getAIProvider();
  const health = await ollama.health();
  if (!health.ok) {
    logger.warn(
      { latencyMs: health.latencyMs },
      'Ollama health check failed at startup. Chat endpoints will return AI_UNAVAILABLE until the provider is reachable. Verify OLLAMA_BASE_URL and endpoint paths on the AI host.',
    );
  } else {
    logger.info({ latencyMs: health.latencyMs }, 'Ollama health check OK');
  }

  const knowledgeWorker = startKnowledgeWorker();

  const app = await buildApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    try {
      await knowledgeWorker?.close();
      await app.close();
      await disconnectRedis();
      await disconnectDatabase();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  logger.info(
    {
      port: config.port,
      host: config.host,
      env: config.env,
      docs: `/docs`,
      allowedOrigins: config.allowedOrigins.length,
    },
    `${config.app.name} v${config.app.version} online`,
  );
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
