import { z } from 'zod';

export const createVersionSchema = z.object({
  storageKey: z.string().min(3),
  sha256Hash: z.string().length(64),
  fileSizeBytes: z.number().int().positive(),
  changeReason: z.string().min(2, 'Change reason must be at least 2 characters'),
  sourceAction: z.enum(['INITIAL', 'EDIT', 'CORRECTION', 'RESTORE', 'REVISION']).default('REVISION'),
  metadataSnapshot: z.record(z.any()).optional(),
});

export const restoreVersionSchema = z.object({
  versionNumber: z.number().int().positive(),
  restoreReason: z.string().min(2, 'Restore reason is required'),
});

export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>;
