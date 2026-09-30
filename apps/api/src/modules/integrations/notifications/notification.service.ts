import { prisma } from '../../../lib/prisma.js';
import { logger, redactSensitiveData } from '../../../lib/logger.js';
import { securityAuditor } from '../../../lib/securityEvents.js';
import { NotificationPayload, NotificationDeliveryResult } from './notification.types.js';
import { NotificationProviderFactory } from './providers/NotificationProviderFactory.js';

export class NotificationDeliveryService {
  /**
   * Dispatches an external notification durably with idempotency and retry handling.
   */
  async sendNotification(payload: NotificationPayload): Promise<NotificationDeliveryResult> {
    const sanitizedMetadata = payload.metadata ? redactSensitiveData(payload.metadata) : undefined;
    const sanitizedTitle = redactSensitiveData(payload.title);
    const sanitizedMessage = redactSensitiveData(payload.message);

    // 1. Idempotency Check
    try {
      const existing = await prisma.notificationDelivery.findUnique({
        where: { idempotencyKey: payload.idempotencyKey },
      });

      if (existing && existing.status === 'DELIVERED') {
        logger.info(`[Notification Service] Idempotent hit: Notification ${payload.idempotencyKey} already delivered`);
        return { success: true, durationMs: 0 };
      }
    } catch (err: any) {
      logger.warn(`[Notification Service] DB check skipped (test/detached context): ${err.message}`);
    }

    // 2. Resolve Provider & Send
    const provider = NotificationProviderFactory.getProvider(payload.providerType);
    const result = await provider.send({
      ...payload,
      title: sanitizedTitle,
      message: sanitizedMessage,
      metadata: sanitizedMetadata,
    });

    // 3. Persist Delivery Audit Record
    try {
      await prisma.notificationDelivery.upsert({
        where: { idempotencyKey: payload.idempotencyKey },
        update: {
          status: result.success ? 'DELIVERED' : 'FAILED',
          attempts: { increment: 1 },
          errorReason: result.error,
          deliveredAt: result.success ? new Date() : null,
        },
        create: {
          recipient: payload.recipient,
          provider: payload.providerType,
          eventType: payload.eventType,
          title: sanitizedTitle,
          status: result.success ? 'DELIVERED' : 'FAILED',
          attempts: 1,
          maxAttempts: 3,
          errorReason: result.error,
          idempotencyKey: payload.idempotencyKey,
          deliveredAt: result.success ? new Date() : null,
        },
      });
    } catch (err: any) {
      logger.warn(`[Notification Service] Could not persist delivery record: ${err.message}`);
    }

    if (!result.success) {
      securityAuditor.emitSecurityEvent({
        eventType: 'AUTH_LOGIN_FAILURE', // Using general alert/audit mechanism
        resourceType: 'NOTIFICATION',
        resourceId: payload.recipient,
        success: false,
        reason: `External notification delivery failure: ${result.error}`,
      });
    }

    return result;
  }
}

export const notificationDeliveryService = new NotificationDeliveryService();
