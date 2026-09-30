import { Queue, Job } from 'bullmq';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

export const OCR_PROCESSING_QUEUE = 'ocr-processing';

export const ocrQueue = new Queue(OCR_PROCESSING_QUEUE, {
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

export interface OcrJobPayload {
  documentId: string;
  jobId: string;
  executionId: string;
  pageCount: number;
  sourceStorageKey: string;
  orgId: string;
  deptId: string;
}

export async function enqueueOcrJob(payload: OcrJobPayload): Promise<Job<OcrJobPayload>> {
  const job = await ocrQueue.add('process-document-ocr', payload, {
    jobId: `ocr-${payload.documentId}`, // Idempotent queueing using documentId
  });

  logger.info(`[Queue] Enqueued OCR processing job for document ${payload.documentId}`);
  return job;
}
