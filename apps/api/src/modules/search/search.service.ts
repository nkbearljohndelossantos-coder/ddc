import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';

export interface SearchDocumentsQuery {
  q: string;
  departmentId?: string;
  status?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'relevance' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResultItem {
  documentId: string;
  title: string;
  documentType: string;
  departmentId: string | null;
  pageCount: number;
  status: string;
  avgConfidence: number | null;
  matchedPages: number[];
  snippet: string;
  relevanceScore: number;
  createdAt: Date;
}

export class SearchService {
  /**
   * Performs full-text search across OCR indexed documents with department isolation.
   */
  async searchDocuments(
    query: SearchDocumentsQuery,
    userContext: { organizationId: string; departmentId: string | null; roles: string[] }
  ): Promise<{ results: SearchResultItem[]; total: number; page: number; limit: number }> {
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(Math.max(query.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    const isSuperAdmin = userContext.roles.includes('SUPER_ADMIN') || userContext.roles.includes('ORG_ADMIN');

    // Department Isolation: Non-admins are strictly scoped to their own department
    let targetDeptId = query.departmentId;
    if (!isSuperAdmin) {
      targetDeptId = userContext.departmentId || undefined;
    }

    const keywords = query.q.trim().split(/\s+/).filter(Boolean);

    // Build Prisma query filters
    const whereClause: any = {
      ...(targetDeptId ? { departmentId: targetDeptId } : {}),
      ...(query.status ? { status: query.status as any } : {}),
    };

    if (keywords.length > 0) {
      whereClause.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        {
          ocrResult: {
            rawText: { contains: query.q, mode: 'insensitive' },
          },
        },
      ];
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where: whereClause,
        include: {
          ocrResult: {
            include: {
              pageResults: true,
            },
          },
          department: { select: { name: true, code: true } },
        },
        orderBy: { createdAt: query.sortOrder || 'desc' },
        skip,
        take: limit,
      }),
      prisma.document.count({ where: whereClause }),
    ]);

    const results: SearchResultItem[] = documents.map((doc) => {
      const matchedPages: number[] = [];
      let snippet = 'No extracted text available.';

      if (doc.ocrResult) {
        const fullText = doc.ocrResult.rawText;
        const lowerQ = query.q.toLowerCase();
        const matchIdx = fullText.toLowerCase().indexOf(lowerQ);

        if (matchIdx >= 0) {
          const start = Math.max(0, matchIdx - 40);
          const end = Math.min(fullText.length, matchIdx + lowerQ.length + 40);
          snippet = `...${fullText.slice(start, end).replace(/\n/g, ' ')}...`;
        } else {
          snippet = fullText.slice(0, 100).replace(/\n/g, ' ') + '...';
        }

        for (const pr of doc.ocrResult.pageResults) {
          if (pr.extractedText.toLowerCase().includes(lowerQ)) {
            matchedPages.push(pr.pageNumber);
          }
        }
      }

      return {
        documentId: doc.id,
        title: doc.title,
        documentType: doc.documentType,
        departmentId: doc.departmentId,
        pageCount: doc.pageCount,
        status: doc.status,
        avgConfidence: doc.ocrResult?.avgConfidence || null,
        matchedPages: matchedPages.length > 0 ? matchedPages : [1],
        snippet,
        relevanceScore: matchedPages.length > 0 ? 10.0 + matchedPages.length : 1.0,
        createdAt: doc.createdAt,
      };
    });

    return {
      results,
      total,
      page,
      limit,
    };
  }
}

export const searchService = new SearchService();
