import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';
import { objectStorage } from '../../lib/storage.js';
import { documentService } from '../documents/document.service.js';

export class ReconciliationService {
  /**
   * Performs an automated sweep to reconcile interrupted or dangling upload and finalization operations.
   */
  async runReconciliationSweep(): Promise<{ reconciledCount: number; errorsCount: number }> {
    let reconciledCount = 0;
    let errorsCount = 0;

    logger.info('[Reconciliation] Starting background storage & document reconciliation sweep...');

    // 1. Reconcile documents stuck in FINALIZING status
    const danglingDocs = await prisma.document.findMany({
      where: { status: 'FINALIZING' },
      include: { storageRecords: true },
    });

    for (const doc of danglingDocs) {
      if (!doc.jobId || !doc.executionId) continue;

      const storageRecord = doc.storageRecords[0];
      if (!storageRecord) continue;

      try {
        // Check if final object exists
        const finalExists = await objectStorage.finalObjectExists(storageRecord.storageKey);

        if (!finalExists) {
          // Attempt copy from quarantine
          const moveSuccess = await objectStorage.moveToFinalStorage(
            storageRecord.quarantineKey,
            storageRecord.storageKey
          );

          if (moveSuccess) {
            await prisma.$transaction([
              prisma.document.update({
                where: { id: doc.id },
                data: { status: 'COMPLETED' },
              }),
              prisma.documentStorage.updateMany({
                where: { documentId: doc.id },
                data: { isFinalized: true, finalizedAt: new Date() },
              }),
              prisma.scanJob.update({
                where: { id: doc.jobId },
                data: { status: 'COMPLETED', completedAt: new Date() },
              }),
            ]);
            reconciledCount++;
            logger.info(`[Reconciliation] Successfully recovered Document ${doc.id}`);
          } else {
            errorsCount++;
          }
        } else {
          // Final object already exists, just update DB status
          await prisma.$transaction([
            prisma.document.update({
              where: { id: doc.id },
              data: { status: 'COMPLETED' },
            }),
            prisma.documentStorage.updateMany({
              where: { documentId: doc.id },
              data: { isFinalized: true, finalizedAt: new Date() },
            }),
            prisma.scanJob.update({
              where: { id: doc.jobId },
              data: { status: 'COMPLETED', completedAt: new Date() },
            }),
          ]);
          reconciledCount++;
        }
      } catch (err: any) {
        errorsCount++;
        logger.error(`[Reconciliation] Error recovering Document ${doc.id}: ${err.message}`);
      }
    }

    // 2. Reconcile VERIFIED upload sessions without a finalized document
    const verifiedSessions = await prisma.storageUploadSession.findMany({
      where: { uploadState: 'VERIFIED' },
    });

    for (const session of verifiedSessions) {
      const existingDoc = await prisma.document.findUnique({
        where: { jobId_executionId: { jobId: session.jobId, executionId: session.executionId } },
      });

      if (!existingDoc || existingDoc.status !== 'COMPLETED') {
        try {
          await documentService.finalizeDocument(session.jobId, session.executionId, {
            pageCount: session.pageNumber || 1,
            fileSizeBytes: session.totalBytes,
            sha256Hash: session.fileHash,
          });
          reconciledCount++;
        } catch (err: any) {
          errorsCount++;
          logger.error(`[Reconciliation] Error finalizing session ${session.id}: ${err.message}`);
        }
      }
    }

    logger.info(`[Reconciliation] Sweep completed. Reconciled: ${reconciledCount}, Errors: ${errorsCount}`);
    return { reconciledCount, errorsCount };
  }
}

export const reconciliationService = new ReconciliationService();
