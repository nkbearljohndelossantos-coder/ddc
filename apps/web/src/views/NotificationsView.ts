export interface NotificationItem {
  id: string;
  category: string;
  title: string;
  message: string;
  isRead: boolean;
  targetDocumentId?: string;
  createdAt: string;
}

export class NotificationsView {
  /**
   * Renders the user notification inbox and event center.
   */
  public static render(notifications: NotificationItem[]): string {
    const rows = notifications
      .map(
        (n) => `
        <li class="notification-item ${n.isRead ? 'item-read' : 'item-unread'}" role="article">
          <div class="notification-content">
            <span class="notification-category badge">${n.category}</span>
            <h4 class="notification-title">${n.title}</h4>
            <p class="notification-message">${n.message}</p>
            <span class="notification-time">${n.createdAt}</span>
          </div>
          <div class="notification-actions">
            ${n.targetDocumentId ? `<a href="/documents/${n.targetDocumentId}" class="btn btn-sm btn-outline">View Doc</a>` : ''}
            ${!n.isRead ? `<button type="button" class="btn btn-sm btn-secondary btn-mark-read" data-notification-id="${n.id}">Mark Read</button>` : ''}
          </div>
        </li>
      `
      )
      .join('\n');

    return `
      <div class="notifications-container" role="region" aria-label="Notification Center">
        <header class="view-header">
          <h2>Notifications Inbox</h2>
        </header>

        <ul class="notifications-list" aria-label="Notifications">
          ${notifications.length > 0 ? rows : '<li class="empty-notice">No notifications in your inbox.</li>'}
        </ul>
      </div>
    `;
  }
}
