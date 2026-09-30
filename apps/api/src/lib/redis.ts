import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withRetry } from './resilience.js';

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 3000);
    return delay;
  },
});

redis.on('error', (err) => {
  logger.error(`[Redis Error]: ${err.message}`);
});

export async function connectRedis(): Promise<void> {
  await withRetry(
    async () => {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') throw new Error('Redis ping response was not PONG');
      logger.info('✅ Redis connected and healthy');
    },
    { serviceName: 'Redis Broker', maxRetries: 10, initialDelayMs: 1000 }
  );
}
