import { z } from 'zod';

export const advancedSearchSchema = z.object({
  textQuery: z.string().optional(),
  title: z.string().optional(),
  documentType: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  supplierName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isLegalHold: z.boolean().optional(),
  status: z.string().optional(),
  minConfidence: z.number().min(0).max(100).optional(),
  maxConfidence: z.number().min(0).max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'title', 'relevance', 'confidence']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const createSavedSearchSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  queryPayload: advancedSearchSchema,
  isShared: z.boolean().default(false),
  departmentId: z.string().uuid().optional(),
});

export type AdvancedSearchQuery = z.infer<typeof advancedSearchSchema>;
export type CreateSavedSearchInput = z.infer<typeof createSavedSearchSchema>;
