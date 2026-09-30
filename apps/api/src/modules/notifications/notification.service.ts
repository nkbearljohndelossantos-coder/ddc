import { prisma } from '../../lib/prisma.js';
import { logger, redactSensitiveData } from '../../lib/logger.js';
import { UserContext } from '../versioning/versioning.service.js';

export interface EmitNotificationInput {
  recipientUserId: string;
  eventType: 'TASK_ASSIGNED' | 'TASK_OVERDUE' | 'DOCUMENT_APPROVED' | 'QC_REQUIRED' | 'RESCAN_REQUESTED' | 'SECURITY_EVENT';
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

export class NotificationService {
  /**
   * Emits an internal notification event with automatic sensitive payload scrubbing.
   */
  async emitNotification(input: EmitNotificationInput) {
    const sanitizedMetadata = input.metadata ? redactSensitiveData(input.metadata) : undefined;

    const event = await prisma.notificationEvent.create({
      data: {
        recipientUserId: input.recipientUserId,
        eventType: input.eventType,
        title: input.title,
        message: input.message,
        metadata: sanitizedMetadata as any,
        status: 'DELIVERED',
        isRead: false,
      },
    });

    logger.info(`[Notification] Emitted '${event.eventType}' for user ${event.recipientUserId}`);
    return event;
  }

  /**
   * Retrieves notifications for the authenticated user.
   */
  async getUserNotifications(user: UserContext, limit = 50) {
    return prisma.notificationEvent.findMany({
      where: { recipientUserId: user.id },
      orderBy: { sentAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  /**
   * Marks a notification as read.
   */
  async markAsRead(notificationId: string, user: UserContext) {
    const notification = await prisma.notificationEvent.findUnique({ where: { id: notificationId } });
    if (!notification) throw { statusCode: 404, message: 'Notification not found' };
    if (notification.recipientUserId !== user.id) throw { statusCode: 403, message: 'Forbidden' };

    return prisma.notificationEvent.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }
}

export const notificationService = new NotificationService();
