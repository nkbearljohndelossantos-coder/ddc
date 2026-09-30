import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { CreateVersionInput, RestoreVersionInput } from './versioning.schema.js';

export interface UserContext {
  id: string;
  organizationId: string;
  departmentId: string | null;
  roles: string[];
}

export class VersioningService {
  /**
   * Creates a new sequential version for a document.
   */
  async createVersion(documentId: string, input: CreateVersionInput, user: UserContext) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    if (!doc) throw { statusCode: 404, message: 'Document not found' };
    if (doc.isPurged) throw { statusCode: 410, message: 'Cannot modify purged document' };

    // Department isolation
    const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
    if (!isSuperAdmin && doc.departmentId && doc.departmentId !== user.departmentId) {
      throw { statusCode: 403, message: 'Forbidden: Cannot version document from another department' };
    }

    const latestVersionNum = doc.versions[0]?.versionNumber || 0;
    const nextVersionNum = latestVersionNum + 1;

    const version = await prisma.$transaction(async (tx) => {
      const v = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: nextVersionNum,
          storageKey: input.storageKey,
          sha256Hash: input.sha256Hash,
          fileSizeBytes: BigInt(input.fileSizeBytes),
          createdById: user.id,
          changeReason: input.changeReason,
          sourceAction: input.sourceAction,
          metadataSnapshot: input.metadataSnapshot as any,
        },
      });

      // Update current document pointers
      await tx.document.update({
        where: { id: doc.id },
        data: {
          storageKeyPdf: input.storageKey,
          sha256Hash: input.sha256Hash,
        },
      });

      // Audit log
      await tx.documentAuditLog.create({
        data: {
          documentId: doc.id,
          userId: user.id,
          action: 'VERSION_CREATED',
          details: { versionNumber: nextVersionNum, changeReason: input.changeReason },
        },
      });

      return v;
    });

    logger.info(`[Versioning] Created Version ${nextVersionNum} for Document ${documentId}`);
    return {
      ...version,
      fileSizeBytes: Number(version.fileSizeBytes),
    };
  }

  /**
   * Lists all immutable historical versions of a document.
   */
  async listVersions(documentId: string, user: UserContext) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!doc) throw { statusCode: 404, message: 'Document not found' };
    if (doc.isPurged) throw { statusCode: 410, message: 'Document has been purged' };

    const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
    if (!isSuperAdmin && doc.departmentId && doc.departmentId !== user.departmentId) {
      throw { statusCode: 403, message: 'Forbidden: Department access restricted' };
    }

    const versions = await prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: 'asc' },
      include: { createdBy: { select: { id: true, fullName: true, email: true } } },
    });

    return versions.map((v) => ({
      ...v,
      fileSizeBytes: Number(v.fileSizeBytes),
    }));
  }

  /**
   * Restores a past revision as a NEW current version (preserving complete immutable history).
   */
  async restoreVersion(documentId: string, input: RestoreVersionInput, user: UserContext) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });

    if (!doc) throw { statusCode: 404, message: 'Document not found' };
    if (doc.isPurged) throw { statusCode: 410, message: 'Cannot restore purged document' };

    const targetVersion = doc.versions.find((v) => v.versionNumber === input.versionNumber);
    if (!targetVersion) throw { statusCode: 404, message: `Version ${input.versionNumber} not found` };

    const nextVersionNum = (doc.versions[0]?.versionNumber || 0) + 1;

    const restoredVersion = await prisma.$transaction(async (tx) => {
      const v = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: nextVersionNum,
          storageKey: targetVersion.storageKey,
          sha256Hash: targetVersion.sha256Hash,
          fileSizeBytes: targetVersion.fileSizeBytes,
          createdById: user.id,
          changeReason: `Restored from version ${input.versionNumber}: ${input.restoreReason}`,
          sourceAction: 'RESTORE',
          metadataSnapshot: targetVersion.metadataSnapshot as any,
        },
      });

      await tx.document.update({
        where: { id: doc.id },
        data: {
          storageKeyPdf: targetVersion.storageKey,
          sha256Hash: targetVersion.sha256Hash,
        },
      });

      await tx.documentAuditLog.create({
        data: {
          documentId: doc.id,
          userId: user.id,
          action: 'VERSION_RESTORED',
          details: { restoredFromVersion: input.versionNumber, newVersionNumber: nextVersionNum },
        },
      });

      return v;
    });

    logger.info(`[Versioning] Restored version ${input.versionNumber} as new Version ${nextVersionNum} for Document ${documentId}`);
    return {
      ...restoredVersion,
      fileSizeBytes: Number(restoredVersion.fileSizeBytes),
    };
  }
}

export const versioningService = new VersioningService();
