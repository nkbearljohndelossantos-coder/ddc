import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  StartWorkflowInput,
  TransitionWorkflowInput,
  CompleteTaskInput,
  ReassignTaskInput,
} from './workflow.schema.js';
import { UserContext } from '../versioning/versioning.service.js';

import { WorkflowStatus } from '@prisma/client';

export class WorkflowService {
  /**
   * Initiates a new workflow instance on a document.
   */
  async startWorkflow(documentId: string, input: StartWorkflowInput, user: UserContext) {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw { statusCode: 404, message: 'Document not found' };
    if (doc.isPurged) throw { statusCode: 410, message: 'Cannot start workflow on purged document' };

    const instance = await prisma.$transaction(async (tx) => {
      const wf = await tx.workflowInstance.create({
        data: {
          documentId,
          workflowName: input.workflowName,
          currentState: 'REVIEW_REQUIRED',
          status: 'IN_PROGRESS',
          initiatedById: user.id,
          departmentId: doc.departmentId || user.departmentId,
        },
      });

      // Create initial task
      await tx.workflowTask.create({
        data: {
          workflowInstanceId: wf.id,
          taskType: input.initialTaskType,
          assignedToUserId: input.assignedToUserId,
          assignedToRole: input.assignedToRole || 'QC_REVIEWER',
          status: 'PENDING',
          dueDate: input.dueDate ? new Date(input.dueDate) : new Date(Date.now() + 2 * 86400000), // 48h default
        },
      });

      // Record initial transition
      await tx.workflowTransition.create({
        data: {
          workflowInstanceId: wf.id,
          fromState: 'DOCUMENT_CREATED',
          toState: 'REVIEW_REQUIRED',
          action: 'INITIATE',
          performedById: user.id,
          notes: 'Workflow initiated',
        },
      });

      return wf;
    });

    logger.info(`[Workflow] Started workflow ${instance.id} on document ${documentId}`);
    return instance;
  }

  /**
   * Advances a workflow instance to the next state.
   */
  async transitionWorkflow(workflowInstanceId: string, input: TransitionWorkflowInput, user: UserContext) {
    const wf = await prisma.workflowInstance.findUnique({
      where: { id: workflowInstanceId },
      include: { document: true },
    });

    if (!wf) throw { statusCode: 404, message: 'Workflow instance not found' };
    if (wf.status === 'COMPLETED' || wf.status === 'CANCELLED') {
      throw { statusCode: 400, message: `Workflow is already in terminal state ${wf.status}` };
    }

    let nextState = wf.currentState;
    let nextStatus: WorkflowStatus = wf.status as WorkflowStatus;

    if (input.action === 'APPROVE') {
      if (wf.currentState === 'REVIEW_REQUIRED') {
        nextState = 'APPROVAL_REQUIRED';
      } else if (wf.currentState === 'APPROVAL_REQUIRED') {
        nextState = 'APPROVED';
        nextStatus = 'COMPLETED';
      }
    } else if (input.action === 'REJECT') {
      nextState = 'REJECTED';
      nextStatus = 'REJECTED';
    } else if (input.action === 'CANCEL') {
      nextState = 'CANCELLED';
      nextStatus = 'CANCELLED';
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.workflowInstance.update({
        where: { id: workflowInstanceId },
        data: {
          currentState: nextState,
          status: nextStatus as any,
        },
      });

      await tx.workflowTransition.create({
        data: {
          workflowInstanceId,
          fromState: wf.currentState,
          toState: nextState,
          action: input.action,
          performedById: user.id,
          notes: input.notes,
        },
      });

      // If transition requires a new task and workflow is still in progress
      if (nextStatus === 'IN_PROGRESS' && input.nextTaskType) {
        await tx.workflowTask.create({
          data: {
            workflowInstanceId,
            taskType: input.nextTaskType,
            assignedToUserId: input.assignedToUserId,
            assignedToRole: input.assignedToRole || 'DEPARTMENT_ADMIN',
            status: 'PENDING',
            dueDate: new Date(Date.now() + 2 * 86400000),
          },
        });
      }

      return u;
    });

    logger.info(`[Workflow] Transitioned workflow ${workflowInstanceId}: ${wf.currentState} -> ${nextState}`);
    return updated;
  }

  /**
   * Claims an unassigned or role-assigned task.
   */
  async claimTask(taskId: string, user: UserContext) {
    const task = await prisma.workflowTask.findUnique({ where: { id: taskId } });
    if (!task) throw { statusCode: 404, message: 'Task not found' };
    if (task.status !== 'PENDING') throw { statusCode: 400, message: `Task is already ${task.status}` };

    const claimed = await prisma.workflowTask.update({
      where: { id: taskId },
      data: {
        status: 'CLAIMED',
        assignedToUserId: user.id,
        claimedAt: new Date(),
      },
    });

    logger.info(`[Task] Task ${taskId} claimed by user ${user.id}`);
    return claimed;
  }

  /**
   * Completes a task and advances the linked workflow.
   */
  async completeTask(taskId: string, input: CompleteTaskInput, user: UserContext) {
    const task = await prisma.workflowTask.findUnique({
      where: { id: taskId },
      include: { workflowInstance: true },
    });

    if (!task) throw { statusCode: 404, message: 'Task not found' };
    if (task.status === 'COMPLETED') throw { statusCode: 400, message: 'Task is already completed' };

    const completed = await prisma.$transaction(async (tx) => {
      const t = await tx.workflowTask.update({
        where: { id: taskId },
        data: {
          status: input.action === 'REJECT' ? 'REJECTED' : 'COMPLETED',
          completedById: user.id,
          completedAt: new Date(),
          outcomeNotes: input.outcomeNotes,
        },
      });

      return t;
    });

    // Advance workflow state machine
    await this.transitionWorkflow(
      task.workflowInstanceId,
      { action: input.action === 'APPROVE' ? 'APPROVE' : input.action === 'REJECT' ? 'REJECT' : 'ADVANCE', notes: input.outcomeNotes },
      user
    );

    logger.info(`[Task] Task ${taskId} completed by user ${user.id}`);
    return completed;
  }

  /**
   * Reassigns a task to another user.
   */
  async reassignTask(taskId: string, input: ReassignTaskInput, user: UserContext) {
    const task = await prisma.workflowTask.findUnique({ where: { id: taskId } });
    if (!task) throw { statusCode: 404, message: 'Task not found' };

    const reassigned = await prisma.workflowTask.update({
      where: { id: taskId },
      data: {
        assignedToUserId: input.assignedToUserId,
        status: 'PENDING',
        claimedAt: null,
      },
    });

    logger.info(`[Task] Task ${taskId} reassigned to user ${input.assignedToUserId} by ${user.id}`);
    return reassigned;
  }

  /**
   * Identifies overdue workflow tasks and marks them.
   */
  async detectOverdueTasks() {
    const now = new Date();
    const overdueTasks = await prisma.workflowTask.findMany({
      where: {
        status: { in: ['PENDING', 'CLAIMED'] },
        dueDate: { lte: now },
        isOverdue: false,
      },
    });

    const updatedIds: string[] = [];
    for (const task of overdueTasks) {
      await prisma.workflowTask.update({
        where: { id: task.id },
        data: { isOverdue: true },
      });
      updatedIds.push(task.id);
    }

    if (updatedIds.length > 0) {
      logger.warn(`[Workflow] Flagged ${updatedIds.length} overdue workflow task(s)`);
    }

    return { overdueCount: updatedIds.length, taskIds: updatedIds };
  }
}

export const workflowService = new WorkflowService();
