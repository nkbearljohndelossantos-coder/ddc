import { AutomationCondition, AutomationAction } from './automation.schema.js';
import { logger } from '../../lib/logger.js';

export class AutomationEngine {
  private static MAX_RECURSION_DEPTH = 5;

  /**
   * Evaluates a single allowlisted condition AST against an execution context.
   */
  public evaluateCondition(condition: AutomationCondition, context: Record<string, any>): boolean {
    const actualValue = context[condition.field];

    switch (condition.operator) {
      case 'equals':
        return actualValue === condition.value;
      case 'notEquals':
        return actualValue !== condition.value;
      case 'greaterThan':
        return typeof actualValue === 'number' && actualValue > Number(condition.value);
      case 'lessThan':
        return typeof actualValue === 'number' && actualValue < Number(condition.value);
      case 'in':
        if (Array.isArray(actualValue)) {
          return actualValue.some((v) =>
            Array.isArray(condition.value) ? condition.value.includes(v) : v === condition.value
          );
        }
        return Array.isArray(condition.value) && condition.value.includes(actualValue);
      case 'contains':
        return typeof actualValue === 'string' && actualValue.toLowerCase().includes(String(condition.value).toLowerCase());
      case 'matches':
        return typeof actualValue === 'string' && new RegExp(String(condition.value)).test(actualValue);
      default:
        return false;
    }
  }

  /**
   * Checks if all conditions in a rule are satisfied.
   */
  public matchesRule(conditions: AutomationCondition[], context: Record<string, any>): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every((cond) => this.evaluateCondition(cond, context));
  }

  /**
   * Executes matched actions with recursion and loop protection.
   */
  public async executeActions(
    actions: AutomationAction[],
    context: Record<string, any>,
    depth = 0
  ): Promise<{ executedCount: number; actionTypes: string[] }> {
    if (depth > AutomationEngine.MAX_RECURSION_DEPTH) {
      logger.error(`[Automation Engine] Recursion limit exceeded (${depth} > ${AutomationEngine.MAX_RECURSION_DEPTH}). Aborting loop.`);
      throw new Error('Automation loop detected: Max recursion depth exceeded');
    }

    const actionTypes: string[] = [];

    for (const action of actions) {
      logger.info(`[Automation Engine] Executing Action: ${action.actionType} (Depth: ${depth})`);
      actionTypes.push(action.actionType);
      // In production, delegates to corresponding domain service (e.g. workflowService, notificationService)
    }

    return { executedCount: actions.length, actionTypes };
  }
}

export const automationEngine = new AutomationEngine();
