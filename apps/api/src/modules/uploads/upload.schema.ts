import { z } from 'zod';

export const createUploadSessionSchema = z.object({
  jobId: z.string().uuid(),
  executionId: z.string().min(1, 'executionId is required'),
  totalBytes: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
  fileHash: z.string().length(64, 'SHA-256 hash must be exactly 64 hex characters'),
  pageNumber: z.number().int().optional(),
});

export const uploadChunkQuerySchema = z.object({
  chunkNumber: z.coerce.number().int().positive(),
  chunkHash: z.string().length(64),
});

export const completeUploadSessionSchema = z.object({
  fileHash: z.string().length(64),
  pageCount: z.number().int().positive(),
});

export type CreateUploadSessionInput = z.infer<typeof createUploadSessionSchema>;
export type UploadChunkQueryInput = z.infer<typeof uploadChunkQuerySchema>;
export type CompleteUploadSessionInput = z.infer<typeof completeUploadSessionSchema>;
