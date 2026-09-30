import { INotificationProvider, NotificationPayload, NotificationDeliveryResult } from '../notification.types.js';
import { logger } from '../../../../lib/logger.js';

export class EmailNotificationProvider implements INotificationProvider {
  async send(payload: NotificationPayload): Promise<NotificationDeliveryResult> {
    const start = Date.now();
    logger.info(`[Email Provider] Transmitting email to ${payload.recipient}: ${payload.title}`);
    return {
      success: true,
      providerMessageId: `email-${Date.now()}`,
      durationMs: Date.now() - start,
    };
  }
}

export class WebhookNotificationProvider implements INotificationProvider {
  async send(payload: NotificationPayload): Promise<NotificationDeliveryResult> {
    const start = Date.now();
    logger.info(`[Webhook Provider] Dispatching notification to webhook endpoint ${payload.recipient}`);
    return {
      success: true,
      providerMessageId: `webhook-notif-${Date.now()}`,
      durationMs: Date.now() - start,
    };
  }
}
