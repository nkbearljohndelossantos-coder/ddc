import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { incidentService } from './incident.service.js';

export interface AlertInput {
  alertType: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  serviceName: string;
}

export class AlertEscalationService {
  private recentAlertFingerprints = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();
  private memAlerts: any[] = [];

  private isDbDisabled() {
    return process.env.NODE_ENV === 'test';
  }

  /**
   * Evaluates incoming operational alerts, performs deduplication, and escalates to incidents when threshold is reached.
   */
  async processAlert(input: AlertInput) {
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${input.serviceName}:${input.alertType}:${input.title}`)
      .digest('hex');

    const now = Date.now();
    const existing = this.recentAlertFingerprints.get(fingerprint);

    if (existing && now - existing.lastSeen < 10 * 60 * 1000) {
      existing.count++;
      existing.lastSeen = now;

      // Escalation trigger: >= 3 repeated critical/high alerts within 10 min creates an incident
      if (existing.count >= 3 && (input.severity === 'CRITICAL' || input.severity === 'HIGH')) {
        const activeIncidents = await incidentService.listIncidents({
          serviceName: input.serviceName,
          status: 'OPEN',
        });

        if (activeIncidents.length === 0) {
          await incidentService.createIncident(
            {
              title: `Auto-Escalated Incident: ${input.title}`,
              description: `Repeated alert "${input.title}" occurred ${existing.count} times within 10 minutes: ${input.message}`,
              severity: input.severity === 'CRITICAL' ? 'SEV1' : 'SEV2',
              serviceName: input.serviceName,
            },
            'SYSTEM_ALERT_ESCALATOR'
          );
        }
      }

      return { deduplicated: true, occurrences: existing.count };
    }

    this.recentAlertFingerprints.set(fingerprint, {
      count: 1,
      firstSeen: now,
      lastSeen: now,
    });

    const alert = {
      id: `alert-${crypto.randomUUID()}`,
      alertType: input.alertType,
      severity: input.severity,
      title: input.title,
      message: input.message,
      isResolved: false,
      createdAt: new Date(),
    };

    if (!this.isDbDisabled()) {
      try {
        const persisted = await prisma.operationalAlert.create({
          data: {
            alertType: input.alertType,
            severity: input.severity,
            title: input.title,
            message: input.message,
          },
        });
        return { deduplicated: false, alert: persisted };
      } catch {
        // fallback
      }
    }

    this.memAlerts.push(alert);
    return { deduplicated: false, alert };
  }
}

export const alertEscalationService = new AlertEscalationService();
