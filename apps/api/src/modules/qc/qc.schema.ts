import { z } from 'zod';

export const pageCorrectionSchema = z.object({
  pageNumber: z.number().int().positive(),
  correctedText: z.string().min(1),
});

export const qcReviewActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'REQUEST_RESCAN', 'SUBMIT_CORRECTIONS']),
  notes: z.string().optional(),
  correctedText: z.string().optional(),
  pageCorrections: z.array(pageCorrectionSchema).optional(),
});

export const legalHoldActionSchema = z.object({
  isLegalHold: z.boolean(),
  reason: z.string().min(5, 'Reason for legal hold action is required'),
});

export const updateMetadataSchema = z.object({
  metadata: z.record(z.string()),
  documentType: z.string().optional(),
  referenceNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  supplierName: z.string().optional(),
  employeeName: z.string().optional(),
});

export type QcReviewActionInput = z.infer<typeof qcReviewActionSchema>;
export type LegalHoldActionInput = z.infer<typeof legalHoldActionSchema>;
export type UpdateMetadataInput = z.infer<typeof updateMetadataSchema>;
