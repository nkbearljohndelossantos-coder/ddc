export interface WorkflowTaskItem {
  id: string;
  workflowId: string;
  taskType: string;
  status: string;
  assignedRole?: string;
  assignedUserId?: string;
  isOverdue: boolean;
  dueDate?: string;
  documentTitle: string;
}

export class WorkflowTasksView {
  /**
   * Renders enterprise workflow instances and task execution queue.
   */
  public static render(tasks: WorkflowTaskItem[], isPrivilegedReviewer = false): string {
    const rows = tasks
      .map(
        (t) => `
        <tr class="task-row ${t.isOverdue ? 'task-overdue' : ''}">
          <td><strong>${t.documentTitle}</strong></td>
          <td>${t.taskType}</td>
          <td>
            <span class="badge ${t.status === 'CLAIMED' ? 'badge-info' : 'badge-warning'}">
              ${t.status}
            </span>
          </td>
          <td>${t.isOverdue ? '<span class="text-danger">⚠️ OVERDUE</span>' : (t.dueDate || 'Standard')}</td>
          <td>
            ${
              isPrivilegedReviewer
                ? `
                  <button type="button" class="btn btn-sm btn-primary btn-claim-task" data-task-id="${t.id}">Claim</button>
                  <button type="button" class="btn btn-sm btn-success btn-complete-task" data-task-id="${t.id}">Approve</button>
                `
                : `<span class="text-muted">Viewing Only</span>`
            }
          </td>
        </tr>
      `
      )
      .join('\n');

    return `
      <div class="workflow-tasks-container" role="region" aria-label="Workflow Task Queue">
        <header class="view-header">
          <h2>Workflow Tasks & Approvals</h2>
        </header>

        <section class="tasks-table-section" aria-label="Assigned Tasks">
          <table class="data-table" aria-label="Workflow Tasks">
            <thead>
              <tr>
                <th>Document</th>
                <th>Task Type</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.length > 0 ? rows : '<tr><td colspan="5" class="text-center">No pending workflow tasks.</td></tr>'}
            </tbody>
          </table>
        </section>
      </div>
    `;
  }
}
