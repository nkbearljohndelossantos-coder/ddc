import { z } from 'zod';

export const createScanJobSchema = z.object({
  idempotencyKey: z.string().min(8, 'idempotencyKey is required for duplicate prevention'),
  scannerId: z.string().uuid(),
  profileId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
});

export const acknowledgeJobSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['ACKNOWLEDGED', 'FAILED']),
  reason: z.string().optional(),
});

export const updateJobStatusSchema = z.object({
  status: z.enum([
    'CREATED',
    'QUEUED',
    'DISPATCHED',
    'ACKNOWLEDGED',
    'SCANNING',
    'LOCAL_COMPLETED',
    'UPLOADING',
    'QUARANTINED',
    'VALIDATING',
    'PROCESSING',
    'OCR_PROCESSING',
    'FINALIZING',
    'COMPLETED',
    'CANCELLATION_REQUESTED',
    'RETRYING',
    'FAILED',
    'CANCELLED',
  ]),
  pageCount: z.number().int().min(0).optional(),
  errorMessage: z.string().optional(),
  details: z.record(z.any()).optional(),
});

export const cancelJobSchema = z.object({
  reason: z.string().min(3, 'Cancellation reason required'),
});

export type CreateScanJobInput = z.infer<typeof createScanJobSchema>;
export type AcknowledgeJobInput = z.infer<typeof acknowledgeJobSchema>;
export type UpdateJobStatusInput = z.infer<typeof updateJobStatusSchema>;
export type CancelJobInput = z.infer<typeof cancelJobSchema>;
