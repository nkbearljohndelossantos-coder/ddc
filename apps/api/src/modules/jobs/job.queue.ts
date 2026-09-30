import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

export const SCAN_JOBS_QUEUE = 'scan-jobs';

export const scanJobQueue = new Queue(SCAN_JOBS_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

export interface ScanJobPayload {
  jobId: string;
  scannerId: string;
  agentId: string;
  profileId: string;
  profileSettings: Record<string, any>;
  idempotencyKey: string;
}

export async function enqueueScanJob(payload: ScanJobPayload): Promise<Job<ScanJobPayload>> {
  const job = await scanJobQueue.add('dispatch-scan-job', payload, {
    jobId: payload.jobId, // Idempotent queueing using scanJob ID
  });

  logger.info(`[Queue] Scan Job ${payload.jobId} enqueued for agent ${payload.agentId}`);
  return job;
}
