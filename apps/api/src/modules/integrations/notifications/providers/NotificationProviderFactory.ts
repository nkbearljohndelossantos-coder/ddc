import { INotificationProvider } from '../notification.types.js';
import { MockNotificationProvider } from './MockNotificationProvider.js';
import { EmailNotificationProvider, WebhookNotificationProvider } from './EmailNotificationProvider.js';

export class NotificationProviderFactory {
  private static mockProvider = new MockNotificationProvider();
  private static emailProvider = new EmailNotificationProvider();
  private static webhookProvider = new WebhookNotificationProvider();

  public static getProvider(type: 'EMAIL' | 'WEBHOOK' | 'MOCK'): INotificationProvider {
    switch (type) {
      case 'EMAIL':
        return this.emailProvider;
      case 'WEBHOOK':
        return this.webhookProvider;
      case 'MOCK':
      default:
        return this.mockProvider;
    }
  }

  public static getMockProvider(): MockNotificationProvider {
    return this.mockProvider;
  }
}
