import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';
import { objectStorage } from '../../lib/storage.js';
import {
  CreateRetentionPolicyInput,
  UpdateRetentionPolicyInput,
  DeleteDocumentInput,
  PurgeDocumentInput,
  AuditQueryInput,
} from './compliance.schema.js';

export interface UserContext {
  id: string;
  organizationId: string;
  departmentId: string | null;
  roles: string[];
  permissions: string[];
}

export class ComplianceService {
  /**
   * Creates a new Document Retention Policy.
   */
  async createRetentionPolicy(input: CreateRetentionPolicyInput, userContext: UserContext) {
    const days = input.retentionDays || (input.retentionYears ? input.retentionYears * 365 : 365);
    const years = input.retentionYears || Math.round(days / 365);

    const policy = await prisma.documentRetentionPolicy.create({
      data: {
        organizationId: userContext.organizationId,
        departmentId: input.departmentId || userContext.departmentId || undefined,
        name: input.name,
        documentType: input.documentType,
        retentionDays: days,
        retentionYears: years,
        version: 1,
        description: input.description,
        actionOnExpiry: input.actionOnExpiry,
        isActive: true,
      },
    });

    logger.info(`[Compliance] Retention policy created: ${policy.name} for ${policy.documentType} (${days} days)`);
    return policy;
  }

  /**
   * Updates an existing Retention Policy with version tracking.
   */
  async updateRetentionPolicy(id: string, input: UpdateRetentionPolicyInput, userContext: UserContext) {
    const existing = await prisma.documentRetentionPolicy.findUnique({ where: { id } });
    if (!existing) {
      throw { statusCode: 404, message: 'Retention policy not found' };
    }

    const nextVersion = existing.version + 1;
    const days = input.retentionDays || existing.retentionDays;
    const years = input.retentionYears || Math.round(days / 365);

    const updated = await prisma.documentRetentionPolicy.update({
      where: { id },
      data: {
        name: input.name || existing.name,
        retentionDays: days,
        retentionYears: years,
        actionOnExpiry: input.actionOnExpiry || existing.actionOnExpiry,
        description: input.description !== undefined ? input.description : existing.description,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
        version: nextVersion,
      },
    });

    logger.info(`[Compliance] Retention policy updated to version ${nextVersion}: ${updated.name}`);
    return updated;
  }

  /**
   * Lists Retention Policies.
   */
  async getRetentionPolicies(filters: { departmentId?: string; isActive?: boolean }, userContext: UserContext) {
    const isSuperAdmin = userContext.roles.includes('SUPER_ADMIN') || userContext.roles.includes('SCANNER_ADMIN');
    let targetDeptId = filters.departmentId;

    if (!isSuperAdmin && userContext.departmentId) {
      targetDeptId = userContext.departmentId;
    }

    return prisma.documentRetentionPolicy.findMany({
      where: {
        organizationId: userContext.organizationId,
        ...(targetDeptId ? { departmentId: targetDeptId } : {}),
        ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Assigns a retention policy to a document and calculates its expiration date.
   */
  async assignRetentionPolicy(documentId: string, policyId: string, userContext: UserContext) {
    const [doc, policy] = await Promise.all([
      prisma.document.findUnique({ where: { id: documentId } }),
      prisma.documentRetentionPolicy.findUnique({ where: { id: policyId } }),
    ]);

    if (!doc) throw { statusCode: 404, message: 'Document not found' };
    if (!policy) throw { statusCode: 404, message: 'Retention policy not found' };

    const retentionDate = new Date(doc.createdAt.getTime() + policy.retentionDays * 24 * 60 * 60 * 1000);

    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.document.update({
        where: { id: documentId },
        data: {
          retentionPolicyId: policy.id,
          retentionDate,
        },
      });

      await tx.documentAuditLog.create({
        data: {
          documentId,
          userId: userContext.id,
          action: 'RETENTION_POLICY_ASSIGNED',
          details: { policyId: policy.id, policyName: policy.name, retentionDate, retentionDays: policy.retentionDays },
        },
      });

      return d;
    });

    logger.info(`[Compliance] Assigned policy '${policy.name}' to document ${documentId} (Expires: ${retentionDate.toISOString()})`);
    return updated;
  }

  /**
   * Controlled document deletion request (respects legal hold and department isolation).
   */
  async deleteDocument(documentId: string, input: DeleteDocumentInput, userContext: UserContext) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!doc) throw { statusCode: 404, message: 'Document not found' };

    // 1. Department isolation
    const isSuperAdmin = userContext.roles.includes('SUPER_ADMIN') || userContext.roles.includes('SCANNER_ADMIN');
    if (!isSuperAdmin && userContext.departmentId && doc.departmentId !== userContext.departmentId) {
      throw { statusCode: 403, message: 'Forbidden: Cannot delete documents from other departments' };
    }

    // 2. Legal hold protection
    if (doc.isLegalHold) {
      await prisma.documentAuditLog.create({
        data: {
          documentId,
          userId: userContext.id,
          action: 'DELETION_BLOCKED_LEGAL_HOLD',
          details: { reason: input.reason },
        },
      });
      throw { statusCode: 403, message: 'Deletion blocked: Document is protected by an active Legal Hold' };
    }

    // 3. Mark as DELETION_PENDING
    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.document.update({
        where: { id: documentId },
        data: { status: 'DELETION_PENDING' },
      });

      await tx.documentAuditLog.create({
        data: {
          documentId,
          userId: userContext.id,
          action: 'DELETION_REQUESTED',
          details: { reason: input.reason, requestedBy: userContext.id },
        },
      });

      return d;
    });

    logger.info(`[Compliance] Document ${documentId} marked as DELETION_PENDING (Reason: ${input.reason})`);
    return updated;
  }

  /**
   * Permanent, irreversible purge of document files and database metadata (strictly protected by Legal Hold).
   */
  async purgeDocument(documentId: string, input: PurgeDocumentInput, userContext: UserContext) {
    if (input.confirmDocumentId !== documentId) {
      throw { statusCode: 400, message: 'Confirmation document ID does not match target document ID' };
    }

    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        storageRecords: true,
        pages: true,
      },
    });

    if (!doc) throw { statusCode: 404, message: 'Document not found' };

    // 1. Legal hold invariant
    if (doc.isLegalHold) {
      await prisma.documentAuditLog.create({
        data: {
          documentId,
          userId: userContext.id,
          action: 'PURGE_BLOCKED_LEGAL_HOLD',
          details: { reason: input.reason },
        },
      });
      throw { statusCode: 403, message: 'Purge blocked: Document is protected under active Legal Hold' };
    }

    // 2. Department isolation
    const isSuperAdmin = userContext.roles.includes('SUPER_ADMIN') || userContext.roles.includes('SCANNER_ADMIN');
    if (!isSuperAdmin && userContext.departmentId && doc.departmentId !== userContext.departmentId) {
      throw { statusCode: 403, message: 'Forbidden: Cannot purge documents from other departments' };
    }

    // 3. Collect all storage keys
    const keysToPurge = new Set<string>();
    if (doc.storageKeyPdf) keysToPurge.add(doc.storageKeyPdf);
    if (doc.storageKeyTiff) keysToPurge.add(doc.storageKeyTiff);
    for (const record of doc.storageRecords) {
      if (record.storageKey) keysToPurge.add(record.storageKey);
      if (record.quarantineKey) keysToPurge.add(record.quarantineKey);
    }
    for (const page of doc.pages) {
      if (page.storageKey) keysToPurge.add(page.storageKey);
      if (page.thumbnailKey) keysToPurge.add(page.thumbnailKey);
    }

    // 4. Purge storage files idempotently
    const purgeReport = await objectStorage.purgeDocumentStorage(Array.from(keysToPurge));

    // 5. Update database state -> PURGED
    const purgedDoc = await prisma.$transaction(async (tx) => {
      const d = await tx.document.update({
        where: { id: documentId },
        data: {
          status: 'PURGED',
          isPurged: true,
          purgedAt: new Date(),
          storageKeyPdf: null,
          storageKeyTiff: null,
        },
      });

      await tx.documentAuditLog.create({
        data: {
          documentId,
          userId: userContext.id,
          action: 'PURGE_COMPLETED',
          details: {
            reason: input.reason,
            purgedKeysCount: purgeReport.deleted.length,
            alreadyAbsentCount: purgeReport.notFound.length,
            purgedBy: userContext.id,
          },
        },
      });

      return d;
    });

    logger.info(`[Compliance] Document ${documentId} permanently PURGED (${purgeReport.deleted.length} storage files removed)`);
    return { document: purgedDoc, purgeReport };
  }

  /**
   * Queries immutable audit logs with department isolation and date/action filtering.
   */
  async queryAuditLogs(query: AuditQueryInput, userContext: UserContext) {
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(Math.max(query.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    const isSuperAdmin = userContext.roles.includes('SUPER_ADMIN') || userContext.roles.includes('SCANNER_ADMIN');
    let targetDeptId = query.departmentId;

    if (!isSuperAdmin) {
      targetDeptId = userContext.departmentId || undefined;
    }

    const whereClause: any = {
      ...(query.documentId ? { documentId: query.documentId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(targetDeptId ? { document: { departmentId: targetDeptId } } : {}),
    };

    if (query.startDate || query.endDate) {
      whereClause.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }

    const [logs, total] = await Promise.all([
      prisma.documentAuditLog.findMany({
        where: whereClause,
        include: {
          user: { select: { id: true, email: true, fullName: true } },
          document: { select: { id: true, title: true, departmentId: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.documentAuditLog.count({ where: whereClause }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
    };
  }
}

export const complianceService = new ComplianceService();
