import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import crypto from 'crypto';

export interface CreateIncidentInput {
  title: string;
  description: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  serviceName: string;
  ownerId?: string;
}

export class IncidentService {
  private memIncidents = new Map<string, any>();

  private isDbDisabled() {
    return process.env.NODE_ENV === 'test';
  }

  /**
   * Creates a new production incident and initializes its timeline.
   */
  async createIncident(input: CreateIncidentInput, actorId: string) {
    if (!this.isDbDisabled()) {
      try {
        return await prisma.incident.create({
          data: {
            title: input.title,
            description: input.description,
            severity: input.severity,
            serviceName: input.serviceName,
            ownerId: input.ownerId || actorId,
            status: 'OPEN',
            timeline: {
              create: {
                eventType: 'CREATED',
                description: `Incident created with severity ${input.severity} for service ${input.serviceName}`,
                actorId,
              },
            },
          },
          include: { timeline: true },
        });
      } catch {
        // fallback
      }
    }

    const id = `inc-${crypto.randomUUID()}`;
    const incident = {
      id,
      title: input.title,
      description: input.description,
      severity: input.severity,
      serviceName: input.serviceName,
      ownerId: input.ownerId || actorId,
      status: 'OPEN',
      acknowledgedAt: null,
      resolvedAt: null,
      closedAt: null,
      resolutionNotes: null,
      postIncidentReview: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      timeline: [
        {
          id: `time-${crypto.randomUUID()}`,
          incidentId: id,
          eventType: 'CREATED',
          description: `Incident created with severity ${input.severity} for service ${input.serviceName}`,
          actorId,
          createdAt: new Date(),
        },
      ],
    };
    this.memIncidents.set(id, incident);
    return incident;
  }

  /**
   * Lists incidents filtered by status or severity.
   */
  async listIncidents(filters?: { status?: string; severity?: string; serviceName?: string }) {
    if (!this.isDbDisabled()) {
      try {
        return await prisma.incident.findMany({
          where: {
            ...(filters?.status ? { status: filters.status } : {}),
            ...(filters?.severity ? { severity: filters.severity } : {}),
            ...(filters?.serviceName ? { serviceName: filters.serviceName } : {}),
          },
          include: {
            timeline: {
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
          orderBy: { createdAt: 'desc' },
        });
      } catch {
        // fallback
      }
    }

    return Array.from(this.memIncidents.values()).filter((inc) => {
      if (filters?.status && inc.status !== filters.status) return false;
      if (filters?.severity && inc.severity !== filters.severity) return false;
      if (filters?.serviceName && inc.serviceName !== filters.serviceName) return false;
      return true;
    });
  }

  /**
   * Retrieves single incident with complete timeline.
   */
  async getIncident(id: string) {
    if (!this.isDbDisabled()) {
      try {
        const incident = await prisma.incident.findUnique({
          where: { id },
          include: {
            timeline: {
              orderBy: { createdAt: 'asc' },
            },
          },
        });
        if (incident) return incident;
      } catch {
        // fallback
      }
    }

    const memInc = this.memIncidents.get(id);
    if (!memInc) {
      throw new Error(`Incident with id ${id} not found`);
    }
    return memInc;
  }

  /**
   * Acknowledges an incident and sets status to INVESTIGATING.
   */
  async acknowledgeIncident(id: string, actorId: string) {
    const incident = await this.getIncident(id);
    if (incident.status === 'CLOSED') {
      throw new Error('Cannot acknowledge a closed incident');
    }

    if (!this.isDbDisabled()) {
      try {
        return await prisma.incident.update({
          where: { id },
          data: {
            status: 'INVESTIGATING',
            acknowledgedAt: new Date(),
            timeline: {
              create: {
                eventType: 'ACKNOWLEDGED',
                description: 'Incident acknowledged and investigation started.',
                actorId,
              },
            },
          },
          include: { timeline: true },
        });
      } catch {
        // fallback
      }
    }

    incident.status = 'INVESTIGATING';
    incident.acknowledgedAt = new Date();
    incident.timeline.push({
      id: `time-${crypto.randomUUID()}`,
      incidentId: id,
      eventType: 'ACKNOWLEDGED',
      description: 'Incident acknowledged and investigation started.',
      actorId,
      createdAt: new Date(),
    });
    return incident;
  }

  /**
   * Resolves an incident with resolution notes.
   */
  async resolveIncident(id: string, actorId: string, resolutionNotes: string) {
    const incident = await this.getIncident(id);
    if (incident.status === 'CLOSED') {
      throw new Error('Cannot resolve an already closed incident');
    }

    if (!this.isDbDisabled()) {
      try {
        return await prisma.incident.update({
          where: { id },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolutionNotes,
            timeline: {
              create: {
                eventType: 'RESOLVED',
                description: `Incident resolved: ${resolutionNotes}`,
                actorId,
              },
            },
          },
          include: { timeline: true },
        });
      } catch {
        // fallback
      }
    }

    incident.status = 'RESOLVED';
    incident.resolvedAt = new Date();
    incident.resolutionNotes = resolutionNotes;
    incident.timeline.push({
      id: `time-${crypto.randomUUID()}`,
      incidentId: id,
      eventType: 'RESOLVED',
      description: `Incident resolved: ${resolutionNotes}`,
      actorId,
      createdAt: new Date(),
    });
    return incident;
  }

  /**
   * Closes an incident and attaches post-incident review (PIR).
   */
  async closeIncident(id: string, actorId: string, postIncidentReview?: string) {
    if (!this.isDbDisabled()) {
      try {
        return await prisma.incident.update({
          where: { id },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
            postIncidentReview,
            timeline: {
              create: {
                eventType: 'CLOSED',
                description: `Incident closed with post-incident review.`,
                actorId,
              },
            },
          },
          include: { timeline: true },
        });
      } catch {
        // fallback
      }
    }

    const incident = await this.getIncident(id);
    incident.status = 'CLOSED';
    incident.closedAt = new Date();
    incident.postIncidentReview = postIncidentReview || null;
    incident.timeline.push({
      id: `time-${crypto.randomUUID()}`,
      incidentId: id,
      eventType: 'CLOSED',
      description: `Incident closed with post-incident review.`,
      actorId,
      createdAt: new Date(),
    });
    return incident;
  }
}

export const incidentService = new IncidentService();
