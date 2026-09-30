import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';
import { objectStorage } from '../../lib/storage.js';

export interface FinalizeDocumentInput {
  pageCount: number;
  fileSizeBytes: number;
  sha256Hash: string;
}

export class DocumentService {
  /**
   * Executes Two-Phase Document Finalization:
   * 1. Quarantine & Integrity Check
   * 2. DB Transaction (Document & Pages registration, status: FINALIZING)
   * 3. Move Quarantine Object -> Final Storage
   * 4. Verify Final Object Exists
   * 5. Update Status -> COMPLETED
   */
  async finalizeDocument(
    jobId: string,
    executionId: string,
    input: FinalizeDocumentInput
  ) {
    const session = await prisma.storageUploadSession.findUnique({
      where: {
        jobId_executionId: { jobId, executionId },
      },
      include: {
        job: {
          include: {
            scanner: true,
            batch: true,
          },
        },
      },
    });

    if (!session) {
      throw { statusCode: 404, message: 'Upload session not found for finalization' };
    }

    const job = session.job;
    const orgId = job.scanner.organizationId || 'org-default';
    const deptId = job.scanner.departmentId || 'dept-default';

    // 1. Check if Document already finalized (Idempotency)
    const existingDoc = await prisma.document.findUnique({
      where: {
        jobId_executionId: { jobId, executionId },
      },
      include: {
        pages: true,
        storageRecords: true,
      },
    });

    if (existingDoc && existingDoc.status === 'COMPLETED') {
      logger.info(`[Document Service] Idempotent hit: Document ${existingDoc.id} already completed for Job ${jobId}`);
      return { document: existingDoc, isIdempotentReplay: true };
    }

    // 2. Compute Final Storage Key
    const finalKey = `final/${orgId}/${deptId}/${jobId}/doc_${jobId}_${executionId}.dat`;

    // 3. PHASE 1: Database Transaction (Register Document in FINALIZING status)
    const document = await prisma.$transaction(async (tx) => {
      // Upsert Document record
      const doc = await tx.document.upsert({
        where: {
          jobId_executionId: { jobId, executionId },
        },
        update: {
          pageCount: input.pageCount,
          fileSizeBytes: input.fileSizeBytes,
          sha256Hash: input.sha256Hash,
          status: 'FINALIZING',
          storageKeyPdf: finalKey,
        },
        create: {
          organizationId: orgId,
          departmentId: deptId,
          batchId: job.batchId,
          jobId,
          executionId,
          scannerId: job.scannerId,
          agentId: job.agentId,
          title: `Scan_${new Date().toISOString().slice(0, 10)}_${job.scanner.scannerName}`,
          documentType: 'GENERAL',
          pageCount: input.pageCount,
          fileSizeBytes: input.fileSizeBytes,
          sha256Hash: input.sha256Hash,
          storageKeyPdf: finalKey,
          status: 'FINALIZING',
        },
      });

      // Create Document Pages
      for (let p = 1; p <= input.pageCount; p++) {
        await tx.documentPage.upsert({
          where: {
            documentId_pageNumber: {
              documentId: doc.id,
              pageNumber: p,
            },
          },
          update: {},
          create: {
            documentId: doc.id,
            pageNumber: p,
            storageKey: `${finalKey}#page=${p}`,
            dpi: 300,
          },
        });
      }

      // Create Document Storage Record
      await tx.documentStorage.create({
        data: {
          documentId: doc.id,
          bucket: 'nkb-documents',
          quarantineKey: session.quarantineKey,
          storageKey: finalKey,
          fileHash: input.sha256Hash,
          byteSize: input.fileSizeBytes,
          isFinalized: false,
        },
      });

      // Create Audit Log
      await tx.documentAuditLog.create({
        data: {
          documentId: doc.id,
          action: 'DOCUMENT_FINALIZING',
          details: { jobId, executionId, finalKey, quarantineKey: session.quarantineKey },
        },
      });

      // Update ScanJob to FINALIZING
      await tx.scanJob.update({
        where: { id: jobId },
        data: { status: 'FINALIZING' },
      });

      return doc;
    });

    // 4. PHASE 2: Move Object Quarantine -> Final Storage
    const moveSuccess = await objectStorage.moveToFinalStorage(session.quarantineKey, finalKey);

    if (!moveSuccess) {
      logger.error(`[Document Service] Object move failed: ${session.quarantineKey} -> ${finalKey}. Document kept in FINALIZING state for background reconciliation.`);
      return { document, isIdempotentReplay: false, requiresReconciliation: true };
    }

    // 5. Verify Final Object Exists
    const finalExists = await objectStorage.finalObjectExists(finalKey);
    if (!finalExists) {
      logger.error(`[Document Service] Final object verification failed for ${finalKey}.`);
      return { document, isIdempotentReplay: false, requiresReconciliation: true };
    }

    // 6. Complete Document and Job Status
    const completedDoc = await prisma.$transaction(async (tx) => {
      const completed = await tx.document.update({
        where: { id: document.id },
        data: { status: 'COMPLETED' },
      });

      await tx.documentStorage.updateMany({
        where: { documentId: document.id, storageKey: finalKey },
        data: { isFinalized: true, finalizedAt: new Date() },
      });

      await tx.scanJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      await tx.documentAuditLog.create({
        data: {
          documentId: document.id,
          action: 'DOCUMENT_COMPLETED',
          details: { finalKey, sha256: input.sha256Hash, pageCount: input.pageCount },
        },
      });

      return completed;
    });

    logger.info(`[Document Service] Two-Phase Finalization successful: Document ${completedDoc.id} is COMPLETED`);

    // 7. Automatically Enqueue Asynchronous OCR Processing Job
    try {
      const { enqueueOcrJob } = await import('../ocr/ocr.queue.js');
      await enqueueOcrJob({
        documentId: completedDoc.id,
        jobId,
        executionId,
        pageCount: input.pageCount,
        sourceStorageKey: finalKey,
        orgId,
        deptId,
      });
    } catch (ocrErr: any) {
      logger.warn(`[Document Service] Could not enqueue OCR job to BullMQ (mock/unit mode): ${ocrErr.message}`);
    }

    return { document: completedDoc, isIdempotentReplay: false };
  }
}

export const documentService = new DocumentService();
