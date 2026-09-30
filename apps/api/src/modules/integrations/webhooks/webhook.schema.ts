import { z } from 'zod';

export const createWebhookSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  url: z.string().url('Must be a valid URL'),
  events: z.array(z.string()).min(1, 'At least one subscribed event type is required'),
  departmentId: z.string().uuid().optional(),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
});

export const updateWebhookSchema = z.object({
  name: z.string().min(2).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  isActive: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional(),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
