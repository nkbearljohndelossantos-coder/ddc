import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';
import { QcReviewActionInput } from './qc.schema.js';

export interface UserContext {
  id: string;
  organizationId: string;
  departmentId: string | null;
  roles: string[];
}

export class QcService {
  /**
   * Retrieves the queue of documents awaiting Quality Control review.
   */
  async getQcQueue(
    filters: { page?: number; limit?: number; departmentId?: string },
    userContext: UserContext
  ) {
    const page = Math.max(filters.page || 1, 1);
    const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    const isSuperAdmin = userContext.roles.includes('SUPER_ADMIN') || userContext.roles.includes('SCANNER_ADMIN');
    let targetDeptId = filters.departmentId;

    if (!isSuperAdmin) {
      targetDeptId = userContext.departmentId || undefined;
    }

    const whereClause: any = {
      status: { in: ['QC_REQUIRED', 'FOR_REVIEW'] },
      ...(targetDeptId ? { departmentId: targetDeptId } : {}),
    };

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where: whereClause,
        include: {
          ocrResult: {
            select: {
              avgConfidence: true,
              minConfidence: true,
              lowConfidencePages: true,
              language: true,
            },
          },
          department: { select: { name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.document.count({ where: whereClause }),
    ]);

    return {
      queue: documents,
      total,
      page,
      limit,
    };
  }

  /**
   * Retrieves detailed OCR word/bounding box diagnostic information for reviewer inspection.
   */
  async getQcDocumentDetails(documentId: string, userContext: UserContext) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        ocrResult: {
          include: {
            pageResults: { orderBy: { pageNumber: 'asc' } },
          },
        },
        pages: { orderBy: { pageNumber: 'asc' } },
        department: true,
        auditLogs: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!document) {
      throw { statusCode: 404, message: 'Document not found' };
    }

    const isSuperAdmin = userContext.roles.includes('SUPER_ADMIN') || userContext.roles.includes('SCANNER_ADMIN');
    if (!isSuperAdmin && userContext.departmentId && document.departmentId !== userContext.departmentId) {
      throw { statusCode: 403, message: 'Forbidden: Cannot access QC queue for other departments' };
    }

    return document;
  }

  /**
   * Submits reviewer decision, OCR corrections, or rescan requests.
   */
  async submitQcReview(
    documentId: string,
    input: QcReviewActionInput,
    userContext: UserContext
  ) {
    const document = await this.getQcDocumentDetails(documentId, userContext);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Apply Page-Level & Document Text Corrections if provided
      if (input.pageCorrections && input.pageCorrections.length > 0) {
        for (const corr of input.pageCorrections) {
          await tx.documentPageOcrResult.updateMany({
            where: {
              documentId,
              pageNumber: corr.pageNumber,
            },
            data: {
              extractedText: corr.correctedText,
              isLowConfidence: false,
            },
          });
        }
      }

      if (input.correctedText) {
        await tx.documentOcrResult.updateMany({
          where: { documentId },
          data: {
            rawText: input.correctedText,
            searchVector: input.correctedText,
          },
        });
      }

      let nextStatus = document.status;
      let auditAction = 'QC_REVIEW_SUBMITTED';

      switch (input.action) {
        case 'SUBMIT_CORRECTIONS':
          auditAction = 'QC_TEXT_CORRECTED';
          break;
        case 'APPROVE':
          nextStatus = 'COMPLETED';
          auditAction = 'QC_APPROVED_COMPLETED';
          break;
        case 'REJECT':
          nextStatus = 'REJECTED';
          auditAction = 'QC_REJECTED';
          break;
        case 'REQUEST_RESCAN':
          nextStatus = 'RESCAN_REQUESTED';
          auditAction = 'QC_RESCAN_REQUESTED';
          break;
      }

      const updatedDoc = await tx.document.update({
        where: { id: documentId },
        data: { status: nextStatus },
      });

      await tx.documentAuditLog.create({
        data: {
          documentId,
          userId: userContext.id,
          action: auditAction,
          details: {
            action: input.action,
            notes: input.notes || null,
            previousStatus: document.status,
            newStatus: nextStatus,
            reviewerId: userContext.id,
          },
        },
      });

      return updatedDoc;
    });

    logger.info(`[QC Service] Review submitted for document ${documentId}: Action '${input.action}' -> Status '${result.status}'`);

    return result;
  }
}

export const qcService = new QcService();
