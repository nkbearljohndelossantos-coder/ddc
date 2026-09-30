import { Worker, Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { OCR_PROCESSING_QUEUE, OcrJobPayload } from '../modules/ocr/ocr.queue.js';
import { ocrService } from '../modules/ocr/ocr.service.js';

const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

export function startOcrWorker(): Worker<OcrJobPayload> {
  const worker = new Worker<OcrJobPayload>(
    OCR_PROCESSING_QUEUE,
    async (job: Job<OcrJobPayload>) => {
      logger.info(`[OCR Worker] Processing OCR Job ${job.id} for document ${job.data.documentId} (Attempt: ${job.attemptsMade + 1})`);

      try {
        const result = await ocrService.processDocumentOcr(job.data);
        logger.info(`[OCR Worker] Successfully completed OCR for document ${job.data.documentId} with status '${result.status}'`);
        return result;
      } catch (error: any) {
        logger.error(`[OCR Worker] OCR failed for document ${job.data.documentId}: ${error.message}`);
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: env.OCR_MAX_CONCURRENT_PAGES,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[OCR Worker] Job ${job?.id} failed permanently or awaiting retry: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`[OCR Worker] Worker error: ${err.message}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('[OCR Worker] Shutting down gracefully...');
    await worker.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return worker;
}
