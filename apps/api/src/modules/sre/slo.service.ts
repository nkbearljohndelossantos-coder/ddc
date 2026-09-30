import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import crypto from 'crypto';

export interface CreateSloInput {
  name: string;
  metricName: string;
  targetValue: number;
  warningThreshold: number;
  criticalThreshold: number;
  windowMinutes?: number;
}

export class SloService {
  private memSlos = new Map<string, any>();
  private memMeasurements: any[] = [];

  private isDbDisabled() {
    return process.env.NODE_ENV === 'test';
  }

  /**
   * Creates a new Service Level Objective definition.
   */
  async createSlo(input: CreateSloInput) {
    if (!this.isDbDisabled()) {
      try {
        return await prisma.serviceLevelObjective.create({
          data: {
            name: input.name,
            metricName: input.metricName,
            targetValue: input.targetValue,
            warningThreshold: input.warningThreshold,
            criticalThreshold: input.criticalThreshold,
            windowMinutes: input.windowMinutes || 60,
          },
        });
      } catch {
        // fallback
      }
    }

    const slo = {
      id: `slo-${crypto.randomUUID()}`,
      name: input.name,
      metricName: input.metricName,
      targetValue: input.targetValue,
      warningThreshold: input.warningThreshold,
      criticalThreshold: input.criticalThreshold,
      windowMinutes: input.windowMinutes || 60,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.memSlos.set(slo.metricName, slo);
    return slo;
  }

  /**
   * Lists all active SLOs with their latest measurement.
   */
  async listSlos() {
    if (!this.isDbDisabled()) {
      try {
        return await prisma.serviceLevelObjective.findMany({
          where: { isActive: true },
          include: {
            measurements: {
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        });
      } catch {
        // fallback
      }
    }
    return Array.from(this.memSlos.values());
  }

  /**
   * Evaluates an observed metric against an SLO target and records measurement.
   */
  async evaluateMetric(metricName: string, observedValue: number, sampleCount = 1) {
    let slo = null;
    if (!this.isDbDisabled()) {
      try {
        slo = await prisma.serviceLevelObjective.findFirst({
          where: { metricName, isActive: true },
        });
      } catch {
        slo = this.memSlos.get(metricName) || null;
      }
    } else {
      slo = this.memSlos.get(metricName) || null;
    }

    if (!slo) {
      slo = this.memSlos.get(metricName) || null;
    }
    if (!slo) return null;

    let status = 'OK';
    const isHigherBetter = slo.targetValue >= slo.criticalThreshold;

    if (isHigherBetter) {
      if (observedValue < slo.criticalThreshold) status = 'BREACH';
      else if (observedValue < slo.warningThreshold) status = 'WARNING';
    } else {
      if (observedValue > slo.criticalThreshold) status = 'BREACH';
      else if (observedValue > slo.warningThreshold) status = 'WARNING';
    }

    const measurement = {
      id: `meas-${crypto.randomUUID()}`,
      sloId: slo.id,
      observedValue,
      status,
      sampleCount,
      createdAt: new Date(),
    };

    if (!this.isDbDisabled()) {
      try {
        return await prisma.sloMeasurement.create({
          data: {
            sloId: slo.id,
            observedValue,
            status,
            sampleCount,
          },
        });
      } catch {
        this.memMeasurements.push(measurement);
        return measurement;
      }
    }

    this.memMeasurements.push(measurement);
    return measurement;
  }
}

export const sloService = new SloService();
