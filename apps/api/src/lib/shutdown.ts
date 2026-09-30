import http from 'http';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { redis } from './redis.js';

export interface ShutdownResources {
  httpServer?: http.Server;
  workers?: Array<{ close: () => Promise<void> }>;
  queues?: Array<{ close: () => Promise<void> }>;
}

export function registerGracefulShutdown(resources: ShutdownResources): void {
  let isShuttingDown = false;

  const shutdownHandler = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn(`[Shutdown] Force termination requested by signal: ${signal}`);
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`[Shutdown] Initiating graceful shutdown on signal: ${signal}`);

    const timeout = setTimeout(() => {
      logger.error('[Shutdown] Graceful shutdown timed out after 15s. Forcing exit.');
      process.exit(1);
    }, 15000);

    try {
      // 1. Stop HTTP Server
      if (resources.httpServer) {
        logger.info('[Shutdown] Closing HTTP server...');
        await new Promise<void>((resolve) => {
          resources.httpServer!.close(() => resolve());
        });
      }

      // 2. Close Workers
      if (resources.workers) {
        logger.info(`[Shutdown] Closing ${resources.workers.length} background worker(s)...`);
        for (const worker of resources.workers) {
          await worker.close();
        }
      }

      // 3. Close Queues
      if (resources.queues) {
        logger.info(`[Shutdown] Closing ${resources.queues.length} queue(s)...`);
        for (const queue of resources.queues) {
          await queue.close();
        }
      }

      // 4. Disconnect Redis
      logger.info('[Shutdown] Disconnecting Redis...');
      await redis.quit().catch(() => {});

      // 5. Disconnect Prisma
      logger.info('[Shutdown] Disconnecting Prisma PostgreSQL...');
      await prisma.$disconnect().catch(() => {});

      clearTimeout(timeout);
      logger.info('[Shutdown] Graceful shutdown completed cleanly.');
      process.exit(0);
    } catch (err: any) {
      clearTimeout(timeout);
      logger.error(`[Shutdown] Error during graceful shutdown: ${err.message}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
}
