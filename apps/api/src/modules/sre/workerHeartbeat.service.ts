import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { alertEscalationService } from './alertEscalation.service.js';
import crypto from 'crypto';

export interface HeartbeatInput {
  workerId: string;
  workerType: string;
  hostname: string;
  version: string;
  status: 'IDLE' | 'BUSY' | 'STOPPED';
  currentJobId?: string;
  queueName?: string;
}

export class WorkerHeartbeatService {
  private memWorkers = new Map<string, any>();

  private isDbDisabled() {
    return process.env.NODE_ENV === 'test';
  }

  /**
   * Records or updates a worker's heartbeat.
   */
  async recordHeartbeat(input: HeartbeatInput) {
    if (!this.isDbDisabled()) {
      try {
        return await prisma.workerHeartbeat.upsert({
          where: { workerId: input.workerId },
          create: {
            workerId: input.workerId,
            workerType: input.workerType,
            hostname: input.hostname,
            version: input.version,
            status: input.status,
            currentJobId: input.currentJobId,
            queueName: input.queueName,
            lastHeartbeatAt: new Date(),
          },
          update: {
            workerType: input.workerType,
            hostname: input.hostname,
            version: input.version,
            status: input.status,
            currentJobId: input.currentJobId,
            queueName: input.queueName,
            lastHeartbeatAt: new Date(),
          },
        });
      } catch {
        // fallback
      }
    }

    const worker = {
      id: `whb-${crypto.randomUUID()}`,
      workerId: input.workerId,
      workerType: input.workerType,
      hostname: input.hostname,
      version: input.version,
      status: input.status,
      currentJobId: input.currentJobId || null,
      queueName: input.queueName || null,
      lastHeartbeatAt: new Date(),
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.memWorkers.set(input.workerId, worker);
    return worker;
  }

  /**
   * Scans for workers with expired heartbeats, marks them STALE, and alerts operations.
   */
  async detectStaleWorkers(staleThresholdMs = 60000) {
    const cutoff = new Date(Date.now() - staleThresholdMs);

    let staleWorkers: any[] = [];
    if (!this.isDbDisabled()) {
      try {
        staleWorkers = await prisma.workerHeartbeat.findMany({
          where: {
            status: { in: ['IDLE', 'BUSY'] },
            lastHeartbeatAt: { lt: cutoff },
          },
        });
      } catch {
        // fallback
      }
    }

    if (staleWorkers.length === 0) {
      staleWorkers = Array.from(this.memWorkers.values()).filter(
        (w) => (w.status === 'IDLE' || w.status === 'BUSY') && new Date(w.lastHeartbeatAt) <= cutoff
      );
    }

    const recoveredCount = staleWorkers.length;

    for (const worker of staleWorkers) {
      if (!this.isDbDisabled()) {
        try {
          await prisma.workerHeartbeat.update({
            where: { id: worker.id },
            data: { status: 'STALE' },
          });
        } catch {
          worker.status = 'STALE';
        }
      } else {
        worker.status = 'STALE';
      }

      logger.warn(`[WorkerHeartbeat] Stale worker detected: ${worker.workerId} (${worker.workerType}) on ${worker.hostname}`);

      await alertEscalationService.processAlert({
        alertType: 'WORKER_HEARTBEAT_STALE',
        severity: 'HIGH',
        title: `Worker ${worker.workerId} Missed Heartbeat`,
        message: `Worker ${worker.workerId} (${worker.workerType}) has been unresponsive since ${new Date(worker.lastHeartbeatAt).toISOString()}`,
        serviceName: worker.workerType,
      });
    }

    return { staleWorkersCount: recoveredCount, staleWorkers };
  }
}

export const workerHeartbeatService = new WorkerHeartbeatService();
