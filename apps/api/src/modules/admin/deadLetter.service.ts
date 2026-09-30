import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { UserContext } from '../versioning/versioning.service.js';

export class DeadLetterService {
  /**
   * Lists failed/dead-letter items across Outbox, Webhooks, and Notifications.
   */
  async listDeadLetters(user: UserContext) {
    const failedOutbox = await prisma.outboxEvent.findMany({
      where: { status: 'FAILED' },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    const failedWebhooks = await prisma.webhookDelivery.findMany({
      where: { status: 'DEAD_LETTER' },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    const failedNotifications = await prisma.notificationDelivery.findMany({
      where: { status: 'DEAD_LETTER' },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    return {
      totalDeadLetters: failedOutbox.length + failedWebhooks.length + failedNotifications.length,
      outboxEvents: failedOutbox,
      webhookDeliveries: failedWebhooks,
      notificationDeliveries: failedNotifications,
    };
  }

  /**
   * Retries a dead-letter item.
   */
  async retryItem(type: 'OUTBOX' | 'WEBHOOK' | 'NOTIFICATION', id: string, user: UserContext) {
    logger.info(`[DeadLetter Admin] Retrying ${type} dead-letter item ${id} (Actor: ${user.id})`);

    if (type === 'OUTBOX') {
      await prisma.outboxEvent.update({
        where: { id },
        data: { status: 'PENDING', retryCount: 0 },
      });
    } else if (type === 'WEBHOOK') {
      await prisma.webhookDelivery.update({
        where: { id },
        data: { status: 'PENDING', attemptCount: 0 },
      });
    } else if (type === 'NOTIFICATION') {
      await prisma.notificationDelivery.update({
        where: { id },
        data: { status: 'QUEUED', attempts: 0 },
      });
    }

    return { success: true, type, id, status: 'REQUEUED' };
  }

  /**
   * Permanently discards or marks a dead-letter item as resolved.
   */
  async resolveItem(type: 'OUTBOX' | 'WEBHOOK' | 'NOTIFICATION', id: string, user: UserContext) {
    logger.info(`[DeadLetter Admin] Resolving/discarding ${type} item ${id}`);

    if (type === 'OUTBOX') {
      await prisma.outboxEvent.update({
        where: { id },
        data: { status: 'RESOLVED' as any },
      });
    } else if (type === 'WEBHOOK') {
      await prisma.webhookDelivery.update({
        where: { id },
        data: { status: 'RESOLVED' as any },
      });
    } else if (type === 'NOTIFICATION') {
      await prisma.notificationDelivery.update({
        where: { id },
        data: { status: 'RESOLVED' as any },
      });
    }

    return { success: true, type, id, status: 'RESOLVED' };
  }
}

export const deadLetterService = new DeadLetterService();
