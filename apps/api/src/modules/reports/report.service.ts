import { prisma } from '../../lib/prisma.js';
import { UserContext } from '../versioning/versioning.service.js';

export class ReportService {
  /**
   * Generates aggregated enterprise report respecting tenant and department boundaries.
   */
  async getEnterpriseReport(user: UserContext) {
    const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
    const whereOrg = user.organizationId ? { organizationId: user.organizationId } : {};
    const whereDept = !isSuperAdmin && user.departmentId ? { departmentId: user.departmentId } : {};

    const [
      totalDocuments,
      documentsByType,
      documentsByStatus,
      legalHoldCount,
      purgedCount,
      activeWorkflowsCount,
      overdueTasksCount,
      departments,
    ] = await Promise.all([
      prisma.document.count({ where: { ...whereOrg, ...whereDept, isPurged: false } }),
      prisma.document.groupBy({
        by: ['documentType'],
        where: { ...whereOrg, ...whereDept, isPurged: false },
        _count: true,
      }),
      prisma.document.groupBy({
        by: ['status'],
        where: { ...whereOrg, ...whereDept, isPurged: false },
        _count: true,
      }),
      prisma.document.count({ where: { ...whereOrg, ...whereDept, isLegalHold: true, isPurged: false } }),
      prisma.document.count({ where: { ...whereOrg, ...whereDept, isPurged: true } }),
      prisma.workflowInstance.count({ where: { status: 'IN_PROGRESS', ...whereDept } }),
      prisma.workflowTask.count({ where: { isOverdue: true, status: { in: ['PENDING', 'CLAIMED'] } } }),
      prisma.department.findMany({
        where: whereOrg,
        select: { id: true, name: true, code: true, _count: { select: { documents: true, users: true } } },
      }),
    ]);

    return {
      overview: {
        totalActiveDocuments: totalDocuments,
        legalHoldDocuments: legalHoldCount,
        purgedDocuments: purgedCount,
        activeWorkflows: activeWorkflowsCount,
        overdueTasks: overdueTasksCount,
      },
      distribution: {
        byType: documentsByType.map((d) => ({ type: d.documentType, count: d._count })),
        byStatus: documentsByStatus.map((d) => ({ status: d.status, count: d._count })),
      },
      departments: departments.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        documentCount: d._count.documents,
        userCount: d._count.users,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}

export const reportService = new ReportService();
