import { z } from 'zod';

export const createRetentionPolicySchema = z.object({
  name: z.string().min(3, 'Policy name must be at least 3 characters'),
  documentType: z.string().min(2, 'Document type is required'),
  retentionDays: z.number().int().positive().default(365),
  retentionYears: z.number().int().nonnegative().optional(),
  actionOnExpiry: z.enum(['ARCHIVE', 'SOFT_DELETE', 'HARD_DELETE']).default('ARCHIVE'),
  description: z.string().optional(),
  departmentId: z.string().uuid().optional(),
});

export const updateRetentionPolicySchema = z.object({
  name: z.string().min(3).optional(),
  retentionDays: z.number().int().positive().optional(),
  retentionYears: z.number().int().nonnegative().optional(),
  actionOnExpiry: z.enum(['ARCHIVE', 'SOFT_DELETE', 'HARD_DELETE']).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const deleteDocumentSchema = z.object({
  reason: z.string().min(5, 'Reason for document deletion is required'),
  immediatePurge: z.boolean().optional().default(false),
});

export const purgeDocumentSchema = z.object({
  reason: z.string().min(5, 'Reason for irreversible document purge is required'),
  confirmDocumentId: z.string().min(1, 'Confirmation document ID is required'),
});

export const auditQuerySchema = z.object({
  documentId: z.string().optional(),
  userId: z.string().optional(),
  action: z.string().optional(),
  departmentId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateRetentionPolicyInput = z.infer<typeof createRetentionPolicySchema>;
export type UpdateRetentionPolicyInput = z.infer<typeof updateRetentionPolicySchema>;
export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;
export type PurgeDocumentInput = z.infer<typeof purgeDocumentSchema>;
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
