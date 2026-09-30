import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { automationEngine } from './automation.engine.js';
import { CreateAutomationRuleInput } from './automation.schema.js';
import { DomainEvent } from '../../lib/events/event.types.js';
import { UserContext } from '../versioning/versioning.service.js';

export class AutomationService {
  /**
   * Creates a new automated workflow rule.
   */
  async createRule(input: CreateAutomationRuleInput, user: UserContext) {
    const rule = await prisma.automationRule.create({
      data: {
        organizationId: user.organizationId,
        departmentId: input.departmentId || user.departmentId,
        name: input.name,
        description: input.description,
        triggerEvent: input.triggerEvent,
        conditions: input.conditions as any,
        actions: input.actions as any,
        priority: input.priority,
        isEnabled: input.isEnabled,
        version: 1,
      },
    });

    logger.info(`[Automation Service] Created automation rule '${rule.name}' for event ${rule.triggerEvent}`);
    return rule;
  }

  /**
   * Lists automation rules.
   */
  async listRules(user: UserContext) {
    const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
    const where: any = { organizationId: user.organizationId };
    if (!isSuperAdmin && user.departmentId) {
      where.departmentId = user.departmentId;
    }

    return prisma.automationRule.findMany({
      where,
      orderBy: { priority: 'asc' },
    });
  }

  /**
   * Evaluates incoming domain event against active automation rules.
   */
  async evaluateEvent(event: DomainEvent): Promise<number> {
    const rules = await prisma.automationRule.findMany({
      where: {
        triggerEvent: event.eventType,
        isEnabled: true,
        ...(event.organizationId ? { organizationId: event.organizationId } : {}),
      },
      orderBy: { priority: 'asc' },
    });

    let executedCount = 0;

    for (const rule of rules) {
      const conditions = (rule.conditions as any[]) || [];
      const matches = automationEngine.matchesRule(conditions, event.payload);

      if (!matches) {
        continue;
      }

      const start = Date.now();
      try {
        const actions = (rule.actions as any[]) || [];
        const result = await automationEngine.executeActions(actions, event.payload);

        await prisma.automationExecution.create({
          data: {
            ruleId: rule.id,
            triggerEventId: event.eventId,
            status: 'SUCCESS',
            executionDetails: result as any,
            durationMs: Date.now() - start,
          },
        });

        executedCount++;
      } catch (err: any) {
        logger.error(`[Automation Service] Execution failed for rule ${rule.id}: ${err.message}`);
        await prisma.automationExecution.create({
          data: {
            ruleId: rule.id,
            triggerEventId: event.eventId,
            status: 'FAILED',
            executionDetails: { error: err.message },
            errorReason: err.message,
            durationMs: Date.now() - start,
          },
        });
      }
    }

    return executedCount;
  }

  /**
   * Simulates rule evaluation without executing external side-effects (Dry-run mode).
   */
  async simulateDryRun(rule: CreateAutomationRuleInput, samplePayload: Record<string, any>) {
    const matches = automationEngine.matchesRule(rule.conditions || [], samplePayload);
    return {
      ruleName: rule.name,
      triggerEvent: rule.triggerEvent,
      matched: matches,
      simulatedActions: matches ? rule.actions.map((a) => a.actionType) : [],
    };
  }
}

export const automationService = new AutomationService();
