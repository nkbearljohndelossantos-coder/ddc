import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

export interface CreateAlertInput {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  alertType: 'QUEUE_BACKLOG' | 'STALE_AGENT' | 'INTEGRITY_MISMATCH' | 'REPEATED_FAILURE' | 'SECURITY_ABUSE' | 'STORAGE_UNAVAILABLE';
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

export class AlertService {
  /**
   * Emits an operational alert and logs structured warning/error.
   */
  async emitOperationalAlert(input: CreateAlertInput) {
    const alert = await prisma.operationalAlert.create({
      data: {
        severity: input.severity,
        alertType: input.alertType,
        title: input.title,
        message: input.message,
        metadata: input.metadata as any,
        isResolved: false,
      },
    });

    logger.warn(`[Operational Alert] [${alert.severity}] ${alert.alertType}: ${alert.title}`, {
      alertId: alert.id,
      severity: alert.severity,
      alertType: alert.alertType,
    });

    return alert;
  }

  /**
   * Retrieves operational alerts with filtering and pagination.
   */
  async getAlerts(filters: { severity?: string; isResolved?: boolean; page?: number; limit?: number }) {
    const page = Math.max(filters.page || 1, 1);
    const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    const whereClause: any = {
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.isResolved !== undefined ? { isResolved: filters.isResolved } : {}),
    };

    const [alerts, total] = await Promise.all([
      prisma.operationalAlert.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.operationalAlert.count({ where: whereClause }),
    ]);

    return { alerts, total, page, limit };
  }

  /**
   * Marks an operational alert as resolved.
   */
  async resolveAlert(alertId: string, resolvedById: string, notes?: string) {
    const updated = await prisma.operationalAlert.update({
      where: { id: alertId },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolvedById,
      },
    });

    logger.info(`[Operational Alert] Alert ${alertId} marked as RESOLVED by ${resolvedById}`);
    return updated;
  }
}

export const alertService = new AlertService();
