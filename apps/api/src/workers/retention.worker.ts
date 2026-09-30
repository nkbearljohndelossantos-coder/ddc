import { Worker, Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/prisma.js';
import { RETENTION_SWEEP_QUEUE, RetentionSweepPayload } from '../modules/compliance/retention.queue.js';
import { complianceService } from '../modules/compliance/compliance.service.js';

const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

export function startRetentionWorker(): Worker<RetentionSweepPayload> {
  const worker = new Worker<RetentionSweepPayload>(
    RETENTION_SWEEP_QUEUE,
    async (job: Job<RetentionSweepPayload>) => {
      logger.info(`[Retention Worker] Running retention evaluation sweep (Job ${job.id})`);

      const now = new Date();

      // 1. Find all expired documents that are not already expired/purged/archived
      const expiredDocuments = await prisma.document.findMany({
        where: {
          retentionDate: { lte: now },
          status: { notIn: ['RETENTION_EXPIRED', 'DELETION_PENDING', 'PURGED', 'ARCHIVED'] },
          isPurged: false,
        },
        include: {
          retentionPolicy: true,
        },
        take: 100, // Bounded batch
      });

      logger.info(`[Retention Worker] Found ${expiredDocuments.length} document(s) matching retention expiration`);

      for (const doc of expiredDocuments) {
        // Legal hold invariant: Never expire or delete documents under legal hold
        if (doc.isLegalHold) {
          logger.info(`[Retention Worker] Document ${doc.id} retention expired, but blocked by active Legal Hold`);
          await prisma.documentAuditLog.create({
            data: {
              documentId: doc.id,
              action: 'RETENTION_BLOCKED_LEGAL_HOLD',
              details: { retentionDate: doc.retentionDate },
            },
          });
          continue;
        }

        // Apply policy action on expiry
        const actionOnExpiry = doc.retentionPolicy?.actionOnExpiry || 'ARCHIVE';

        if (actionOnExpiry === 'HARD_DELETE') {
          logger.info(`[Retention Worker] Policy specifies HARD_DELETE for document ${doc.id}`);
          await complianceService.purgeDocument(
            doc.id,
            { reason: 'Automatic retention policy expiration HARD_DELETE', confirmDocumentId: doc.id },
            { id: 'system-retention-worker', organizationId: doc.organizationId || '', departmentId: doc.departmentId, roles: ['SUPER_ADMIN'], permissions: ['admin:all'] }
          );
        } else {
          await prisma.$transaction([
            prisma.document.update({
              where: { id: doc.id },
              data: { status: 'RETENTION_EXPIRED' },
            }),
            prisma.documentAuditLog.create({
              data: {
                documentId: doc.id,
                action: 'RETENTION_EXPIRED',
                details: { retentionDate: doc.retentionDate, actionOnExpiry },
              },
            }),
          ]);
          logger.info(`[Retention Worker] Document ${doc.id} transitioned to RETENTION_EXPIRED`);
        }
      }

      return { evaluatedCount: expiredDocuments.length };
    },
    {
      connection: redisConnection,
      concurrency: 1, // Single worker per instance for deterministic sequential processing
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[Retention Worker] Sweep Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`[Retention Worker] Worker error: ${err.message}`);
  });

  return worker;
}
