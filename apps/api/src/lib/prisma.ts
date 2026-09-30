import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';
import { withRetry } from './resilience.js';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => {
  logger.error(`[Prisma Error]: ${e.message}`);
});

prisma.$on('warn', (e) => {
  logger.warn(`[Prisma Warning]: ${e.message}`);
});

export async function connectPrisma(): Promise<void> {
  await withRetry(
    async () => {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      logger.info('✅ PostgreSQL connected and healthy via Prisma');
    },
    { serviceName: 'PostgreSQL Database', maxRetries: 10, initialDelayMs: 1000 }
  );
}
