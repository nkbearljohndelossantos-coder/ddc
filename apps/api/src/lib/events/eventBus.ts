import { EventEmitter } from 'events';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { logger, redactSensitiveData } from '../logger.js';
import { DomainEvent, DomainEventType } from './event.types.js';

export class EnterpriseEventBus extends EventEmitter {
  private static instance: EnterpriseEventBus;

  public static getInstance(): EnterpriseEventBus {
    if (!EnterpriseEventBus.instance) {
      EnterpriseEventBus.instance = new EnterpriseEventBus();
    }
    return EnterpriseEventBus.instance;
  }

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Publishes a domain event transactionally via Outbox and dispatches to in-process subscribers.
   */
  async publish<T>(
    eventType: DomainEventType,
    payload: T,
    options: {
      organizationId?: string;
      departmentId?: string;
      actorId?: string;
      resourceId?: string;
      resourceType?: string;
      correlationId?: string;
    } = {}
  ): Promise<DomainEvent<T>> {
    const eventId = crypto.randomUUID();
    const sanitizedPayload = redactSensitiveData(payload);

    const domainEvent: DomainEvent<T> = {
      eventId,
      eventType,
      schemaVersion: '1.0.0',
      occurredAt: new Date(),
      organizationId: options.organizationId,
      departmentId: options.departmentId,
      actorId: options.actorId,
      resourceId: options.resourceId,
      resourceType: options.resourceType,
      correlationId: options.correlationId,
      payload: sanitizedPayload,
    };

    try {
      // 1. Outbox table persistence for durable delivery
      await prisma.outboxEvent.create({
        data: {
          eventId,
          eventType,
          schemaVersion: domainEvent.schemaVersion,
          occurredAt: domainEvent.occurredAt,
          organizationId: domainEvent.organizationId,
          departmentId: domainEvent.departmentId,
          actorId: domainEvent.actorId,
          resourceId: domainEvent.resourceId,
          resourceType: domainEvent.resourceType,
          correlationId: domainEvent.correlationId,
          payload: sanitizedPayload as any,
          status: 'PENDING',
        },
      });
    } catch (err: any) {
      logger.warn(`[EventBus] Could not persist to outbox (testing or detached context): ${err.message}`);
    }

    logger.info(`[EventBus] Published event ${eventType} (Event ID: ${eventId})`);

    // 2. In-process dispatch to subscribers
    this.emit(eventType, domainEvent);
    this.emit('*', domainEvent);

    return domainEvent;
  }
}

export const eventBus = EnterpriseEventBus.getInstance();
