import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { AdvancedSearchQuery, CreateSavedSearchInput } from './advancedSearch.schema.js';
import { UserContext } from '../versioning/versioning.service.js';

export class AdvancedSearchService {
  /**
   * Executes multi-criteria full-text & metadata advanced search.
   */
  async advancedSearch(query: AdvancedSearchQuery, user: UserContext) {
    const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(Math.max(query.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {
      isPurged: false, // Never return purged documents
    };

    // Tenant / Organization Scope
    if (user.organizationId) {
      where.organizationId = user.organizationId;
    }

    // Department Isolation
    if (!isSuperAdmin) {
      where.departmentId = user.departmentId;
    } else if (query.departmentId) {
      where.departmentId = query.departmentId;
    }

    // Title / Document Type / Status / Legal Hold filters
    if (query.title) {
      where.title = { contains: query.title, mode: 'insensitive' };
    }
    if (query.documentType) {
      where.documentType = query.documentType;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.isLegalHold !== undefined) {
      where.isLegalHold = query.isLegalHold;
    }
    if (query.supplierName) {
      where.supplierName = { contains: query.supplierName, mode: 'insensitive' };
    }

    // Date range filter
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    // OCR Text Full-Text filter
    if (query.textQuery && query.textQuery.trim().length > 0) {
      where.ocrResult = {
        fullText: { contains: query.textQuery.trim(), mode: 'insensitive' },
      };
    }

    // OCR Confidence filters
    if (query.minConfidence !== undefined || query.maxConfidence !== undefined) {
      where.ocrResult = {
        ...(where.ocrResult || {}),
        ...(query.minConfidence !== undefined ? { avgConfidence: { gte: query.minConfidence } } : {}),
      };
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: {
          ocrResult: { select: { avgConfidence: true, minConfidence: true, language: true } },
          department: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc' },
        skip,
        take: limit,
      }),
      prisma.document.count({ where }),
    ]);

    logger.info(`[Advanced Search] Query executed: ${total} match(es) for user ${user.id}`);

    return {
      documents: documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        documentType: doc.documentType,
        status: doc.status,
        departmentId: doc.departmentId,
        departmentName: doc.department?.name,
        isLegalHold: doc.isLegalHold,
        pageCount: doc.pageCount,
        fileSizeBytes: doc.fileSizeBytes,
        createdAt: doc.createdAt,
        ocrConfidence: doc.ocrResult?.avgConfidence,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Creates a saved enterprise search query.
   */
  async createSavedSearch(input: CreateSavedSearchInput, user: UserContext) {
    const saved = await prisma.savedSearch.create({
      data: {
        userId: user.id,
        organizationId: user.organizationId,
        departmentId: input.departmentId || user.departmentId,
        name: input.name,
        description: input.description,
        queryPayload: input.queryPayload as any,
        isShared: input.isShared,
      },
    });

    logger.info(`[Saved Search] Created saved search '${saved.name}' (ID: ${saved.id})`);
    return saved;
  }

  /**
   * Lists saved searches available to user (personal + shared).
   */
  async listSavedSearches(user: UserContext) {
    const searches = await prisma.savedSearch.findMany({
      where: {
        organizationId: user.organizationId,
        OR: [
          { userId: user.id },
          { isShared: true, departmentId: user.departmentId },
          { isShared: true, departmentId: null },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });

    return searches;
  }

  /**
   * Executes a saved search query by ID.
   */
  async executeSavedSearch(searchId: string, user: UserContext) {
    const saved = await prisma.savedSearch.findUnique({ where: { id: searchId } });
    if (!saved) throw { statusCode: 404, message: 'Saved search not found' };

    // Check visibility
    if (saved.userId !== user.id && !saved.isShared) {
      throw { statusCode: 403, message: 'Forbidden: Private saved search' };
    }

    return this.advancedSearch(saved.queryPayload as any, user);
  }

  /**
   * Deletes a saved search.
   */
  async deleteSavedSearch(searchId: string, user: UserContext) {
    const saved = await prisma.savedSearch.findUnique({ where: { id: searchId } });
    if (!saved) throw { statusCode: 404, message: 'Saved search not found' };

    const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
    if (saved.userId !== user.id && !isSuperAdmin) {
      throw { statusCode: 403, message: 'Forbidden: Only creator or admin can delete saved search' };
    }

    await prisma.savedSearch.delete({ where: { id: searchId } });
    logger.info(`[Saved Search] Deleted saved search ${searchId}`);
    return { success: true, id: searchId };
  }
}

export const advancedSearchService = new AdvancedSearchService();
