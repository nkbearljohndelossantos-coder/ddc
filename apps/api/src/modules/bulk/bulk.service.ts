import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { BulkOperationInput } from './bulk.schema.js';
import { UserContext } from '../versioning/versioning.service.js';

export class BulkService {
  /**
   * Executes a bounded batch operation over multiple documents with partial failure reporting.
   */
  async executeBulkOperation(input: BulkOperationInput, user: UserContext) {
    const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
    let successfulCount = 0;
    let failedCount = 0;
    const errors: Array<{ documentId: string; reason: string }> = [];

    const documents = await prisma.document.findMany({
      where: { id: { in: input.documentIds } },
    });

    const docMap = new Map(documents.map((d) => [d.id, d]));

    for (const docId of input.documentIds) {
      const doc = docMap.get(docId);

      if (!doc) {
        failedCount++;
        errors.push({ documentId: docId, reason: 'Document not found' });
        continue;
      }

      if (doc.isPurged) {
        failedCount++;
        errors.push({ documentId: docId, reason: 'Cannot modify purged document' });
        continue;
      }

      // Department isolation
      if (!isSuperAdmin && doc.departmentId && doc.departmentId !== user.departmentId) {
        failedCount++;
        errors.push({ documentId: docId, reason: 'Forbidden: Department mismatch' });
        continue;
      }

      try {
        if (input.operationType === 'BULK_CLASSIFICATION' && input.payload.documentType) {
          await prisma.document.update({
            where: { id: doc.id },
            data: { documentType: input.payload.documentType },
          });
        } else if (input.operationType === 'BULK_LEGAL_HOLD') {
          await prisma.document.update({
            where: { id: doc.id },
            data: { isLegalHold: Boolean(input.payload.isLegalHold) },
          });
        } else if (input.operationType === 'BULK_METADATA' && input.payload.metadata) {
          await prisma.documentMetadata.upsert({
            where: { documentId_key: { documentId: doc.id, key: input.payload.metadata.key } },
            update: { value: input.payload.metadata.value },
            create: { documentId: doc.id, key: input.payload.metadata.key, value: input.payload.metadata.value },
          });
        }

        await prisma.documentAuditLog.create({
          data: {
            documentId: doc.id,
            userId: user.id,
            action: `BULK_${input.operationType}`,
            details: input.payload,
          },
        });

        successfulCount++;
      } catch (err: any) {
        failedCount++;
        errors.push({ documentId: docId, reason: err.message || 'Operation failed' });
      }
    }

    const bulkRecord = await prisma.bulkOperation.create({
      data: {
        operationType: input.operationType,
        initiatedById: user.id,
        totalItems: input.documentIds.length,
        successfulItems: successfulCount,
        failedItems: failedCount,
        status: failedCount === 0 ? 'COMPLETED' : successfulCount === 0 ? 'FAILED' : 'COMPLETED_WITH_ERRORS',
        errors: errors.length > 0 ? (errors as any) : undefined,
      },
    });

    logger.info(`[Bulk Operation] ${input.operationType}: ${successfulCount}/${input.documentIds.length} succeeded`);

    return {
      id: bulkRecord.id,
      operationType: bulkRecord.operationType,
      totalItems: bulkRecord.totalItems,
      successfulItems: bulkRecord.successfulItems,
      failedItems: bulkRecord.failedItems,
      status: bulkRecord.status,
      errors,
    };
  }
}

export const bulkService = new BulkService();
