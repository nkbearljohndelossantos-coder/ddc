import { INotificationProvider, NotificationPayload, NotificationDeliveryResult } from '../notification.types.js';
import { logger } from '../../../../lib/logger.js';

export class MockNotificationProvider implements INotificationProvider {
  public deliveredNotifications: NotificationPayload[] = [];
  public shouldFail = false;

  async send(payload: NotificationPayload): Promise<NotificationDeliveryResult> {
    const start = Date.now();

    if (this.shouldFail) {
      logger.warn(`[Mock Notification Provider] Simulated delivery failure for ${payload.recipient}`);
      return {
        success: false,
        error: 'Simulated downstream SMTP connection timeout',
        durationMs: Date.now() - start,
      };
    }

    this.deliveredNotifications.push(payload);
    logger.info(`[Mock Notification Provider] Delivered '${payload.eventType}' to ${payload.recipient}`);

    return {
      success: true,
      providerMessageId: `mock-msg-${Date.now()}`,
      durationMs: Date.now() - start,
    };
  }
}
