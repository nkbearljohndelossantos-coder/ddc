import { logger, redactSensitiveData } from './logger.js';

export type SecurityEventType =
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILURE'
  | 'AUTHORIZATION_DENIED'
  | 'AGENT_AUTH_FAILURE'
  | 'AGENT_REVOKED'
  | 'AGENT_CREDENTIAL_ROTATED'
  | 'PAIRING_TOKEN_CREATED'
  | 'PAIRING_TOKEN_REJECTED'
  | 'WEBSOCKET_AUTH_FAILURE'
  | 'WEBSOCKET_REVOKED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'CROSS_DEPARTMENT_ACCESS_BLOCKED'
  | 'CROSS_AGENT_ACCESS_BLOCKED'
  | 'DOCUMENT_DOWNLOAD_DENIED'
  | 'DOCUMENT_PURGE_BLOCKED'
  | 'LEGAL_HOLD_BLOCKED_OPERATION';

export interface SecurityEvent {
  eventType: SecurityEventType;
  actorId?: string;
  actorType?: 'USER' | 'AGENT' | 'SYSTEM' | 'ANONYMOUS';
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  resourceType?: string;
  resourceId?: string;
  organizationId?: string;
  departmentId?: string;
  success: boolean;
  reason?: string;
  metadata?: Record<string, any>;
}

export class SecurityEventAuditor {
  private events: SecurityEvent[] = [];

  /**
   * Emits and logs a structured security event with sanitization.
   */
  emitSecurityEvent(event: SecurityEvent): SecurityEvent {
    const sanitizedEvent: SecurityEvent = {
      ...event,
      metadata: event.metadata ? redactSensitiveData(event.metadata) : undefined,
    };

    // Store in-memory recent ring buffer for metrics & health
    this.events.push(sanitizedEvent);
    if (this.events.length > 500) {
      this.events.shift();
    }

    logger.warn(`[Security Event] ${sanitizedEvent.eventType} - Success: ${sanitizedEvent.success} (Actor: ${sanitizedEvent.actorId || 'anonymous'})`, {
      securityEvent: sanitizedEvent,
    });

    return sanitizedEvent;
  }

  getRecentSecurityEvents(): SecurityEvent[] {
    return [...this.events];
  }
}

export const securityAuditor = new SecurityEventAuditor();
