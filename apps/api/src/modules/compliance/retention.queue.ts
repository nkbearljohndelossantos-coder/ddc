import { Queue, Job } from 'bullmq';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

export const RETENTION_SWEEP_QUEUE = 'retention-sweep';

export const retentionQueue = new Queue(RETENTION_SWEEP_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export interface RetentionSweepPayload {
  organizationId?: string;
  triggerSource: 'SCHEDULED' | 'MANUAL';
}

export async function enqueueRetentionSweep(payload: RetentionSweepPayload): Promise<Job<RetentionSweepPayload>> {
  const job = await retentionQueue.add('evaluate-retention-policies', payload, {
    jobId: `retention-sweep-${Date.now()}`,
  });

  logger.info(`[Queue] Enqueued Retention Sweep job (Source: ${payload.triggerSource})`);
  return job;
}
