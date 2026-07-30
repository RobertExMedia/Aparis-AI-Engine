import { buildApp } from './app.js';
import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDatabase();
  await connectRedis();

  const app = await buildApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    try {
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
      ollama: config.ollama.baseUrl,
      docs: `http://${config.host}:${config.port}/docs`,
    },
    `${config.app.name} v${config.app.version} online`,
  );
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
