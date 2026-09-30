import { z } from 'zod';

export const automationConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['equals', 'notEquals', 'greaterThan', 'lessThan', 'in', 'contains', 'matches']),
  value: z.any(),
});

export const automationActionSchema = z.object({
  actionType: z.enum([
    'CREATE_WORKFLOW',
    'ASSIGN_TASK',
    'NOTIFY_USER',
    'SEND_WEBHOOK',
    'UPDATE_METADATA',
    'APPLY_RETENTION',
    'APPLY_LEGAL_HOLD',
    'REJECT_DOCUMENT',
    'REQUEST_RESCAN',
  ]),
  payload: z.record(z.any()),
});

export const createAutomationRuleSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  triggerEvent: z.string().min(2, 'Trigger event is required'),
  conditions: z.array(automationConditionSchema).default([]),
  actions: z.array(automationActionSchema).min(1, 'At least one action is required'),
  priority: z.number().int().default(100),
  isEnabled: z.boolean().default(true),
  departmentId: z.string().uuid().optional(),
});

export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export type AutomationAction = z.infer<typeof automationActionSchema>;
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
