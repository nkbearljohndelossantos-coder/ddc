import { DomainEventType } from '../../../lib/events/event.types.js';

export interface NotificationPayload {
  recipient: string;
  providerType: 'EMAIL' | 'WEBHOOK' | 'MOCK';
  eventType: DomainEventType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  idempotencyKey: string;
}

export interface NotificationDeliveryResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  durationMs: number;
}

export interface INotificationProvider {
  send(payload: NotificationPayload): Promise<NotificationDeliveryResult>;
}
