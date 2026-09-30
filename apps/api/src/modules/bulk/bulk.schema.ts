import { z } from 'zod';

export const bulkOperationSchema = z.object({
  operationType: z.enum(['BULK_METADATA', 'BULK_CLASSIFICATION', 'BULK_RETENTION', 'BULK_LEGAL_HOLD']),
  documentIds: z.array(z.string().uuid()).min(1).max(100, 'Bulk operations are capped at 100 items per request'),
  payload: z.record(z.any()),
});

export type BulkOperationInput = z.infer<typeof bulkOperationSchema>;
