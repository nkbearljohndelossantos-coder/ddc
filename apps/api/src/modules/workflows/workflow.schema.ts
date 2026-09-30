import { z } from 'zod';

export const startWorkflowSchema = z.object({
  workflowName: z.string().default('STANDARD_DOCUMENT_APPROVAL'),
  initialTaskType: z.string().default('REVIEW'),
  assignedToRole: z.string().optional(),
  assignedToUserId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
});

export const transitionWorkflowSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'REQUEST_RESCAN', 'CANCEL', 'ADVANCE']),
  notes: z.string().optional(),
  nextTaskType: z.string().optional(),
  assignedToUserId: z.string().uuid().optional(),
  assignedToRole: z.string().optional(),
});

export const completeTaskSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'COMPLETE', 'REQUEST_CHANGES']),
  outcomeNotes: z.string().min(2, 'Outcome notes required'),
});

export const reassignTaskSchema = z.object({
  assignedToUserId: z.string().uuid('Valid user ID required'),
  reason: z.string().optional(),
});

export type StartWorkflowInput = z.infer<typeof startWorkflowSchema>;
export type TransitionWorkflowInput = z.infer<typeof transitionWorkflowSchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;
export type ReassignTaskInput = z.infer<typeof reassignTaskSchema>;
