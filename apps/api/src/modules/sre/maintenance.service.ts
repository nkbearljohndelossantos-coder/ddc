import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import crypto from 'crypto';

export interface CreateMaintenanceInput {
  title: string;
  description?: string;
  mode: 'READ_ONLY' | 'FULL_MAINTENANCE';
  startsAt: Date;
  endsAt: Date;
  allowedRoles?: string[];
}

export class MaintenanceService {
  private memWindows: any[] = [];

  private isDbDisabled() {
    return process.env.NODE_ENV === 'test';
  }

  /**
   * Schedules or activates a system maintenance window.
   */
  async createMaintenanceWindow(input: CreateMaintenanceInput, actorId: string) {
    const now = new Date();
    const isActive = input.startsAt <= now && input.endsAt > now;

    if (!this.isDbDisabled()) {
      try {
        return await prisma.maintenanceWindow.create({
          data: {
            title: input.title,
            description: input.description,
            mode: input.mode,
            isActive,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            allowedRoles: input.allowedRoles || ['SUPER_ADMIN'],
            createdById: actorId,
          },
        });
      } catch {
        // fallback
      }
    }

    const window = {
      id: `maint-${crypto.randomUUID()}`,
      title: input.title,
      description: input.description || null,
      mode: input.mode,
      isActive,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allowedRoles: input.allowedRoles || ['SUPER_ADMIN'],
      createdById: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.memWindows.push(window);
    return window;
  }

  /**
   * Retrieves currently active maintenance window, if any.
   */
  async getActiveMaintenance() {
    const now = new Date();
    if (!this.isDbDisabled()) {
      try {
        return await prisma.maintenanceWindow.findFirst({
          where: {
            startsAt: { lte: now },
            endsAt: { gt: now },
          },
          orderBy: { startsAt: 'desc' },
        });
      } catch {
        // fallback
      }
    }

    return (
      this.memWindows.find((w) => new Date(w.startsAt) <= now && new Date(w.endsAt) > now) || null
    );
  }

  /**
   * Checks whether a request should be rejected due to active maintenance mode.
   */
  async isRequestBlocked(userRoles: string[] = [], isWriteRequest = false) {
    const activeWindow = await this.getActiveMaintenance();
    if (!activeWindow) return { blocked: false };

    // Check role bypass (e.g. SUPER_ADMIN)
    const isExempt = userRoles.some((r) => activeWindow.allowedRoles.includes(r));
    if (isExempt) return { blocked: false, activeWindow };

    // In READ_ONLY mode, allow GET / HEAD / OPTIONS requests
    if (activeWindow.mode === 'READ_ONLY' && !isWriteRequest) {
      return { blocked: false, activeWindow };
    }

    return {
      blocked: true,
      reason: `System is under ${activeWindow.mode}: "${activeWindow.title}". Scheduled until ${new Date(activeWindow.endsAt).toISOString()}`,
      activeWindow,
    };
  }
}

export const maintenanceService = new MaintenanceService();
