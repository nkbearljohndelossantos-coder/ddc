import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectPrisma, prisma } from './lib/prisma.js';
import { connectRedis, redis } from './lib/redis.js';

async function bootstrap() {
  logger.info('🚀 Bootstrapping NKB Enterprise API Server...');

  // Connect dependencies with retry & exponential backoff
  await connectPrisma();
  await connectRedis();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`✨ NKB API Server running at http://localhost:${env.PORT}`);
    logger.info(`🔍 Environment: ${env.NODE_ENV}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      logger.info('HTTP server closed.');
      await prisma.$disconnect();
      redis.disconnect();
      logger.info('Database & Redis connections closed.');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forceful shutdown triggered after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('❌ Fatal error during API server bootstrap:', err);
  process.exit(1);
});
