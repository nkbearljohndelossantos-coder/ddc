import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  CreateOrganizationInput,
  CreateDepartmentInput,
  CreateUserAdminInput,
  UpdateUserAdminInput,
  PublicSelfRegisterInput,
  AssignUserRoleInput,
} from './admin.schema.js';

export interface AdminUserContext {
  id: string;
  organizationId: string;
  departmentId: string | null;
  roles: string[];
}

export class AdminService {
  /**
   * Creates a new organization/company.
   */
  async createOrganization(input: CreateOrganizationInput, adminContext: AdminUserContext) {
    const org = await prisma.organization.create({
      data: {
        name: input.name,
        code: input.code,
        isActive: true,
      },
    });

    logger.info(`[Admin] Organization created: ${org.name} (${org.code}) by ${adminContext.id}`);
    return org;
  }

  /**
   * Creates a new department within an organization.
   */
  async createDepartment(input: CreateDepartmentInput, adminContext: AdminUserContext) {
    const orgId = input.organizationId || adminContext.organizationId;
    const dept = await prisma.department.create({
      data: {
        organizationId: orgId,
        name: input.name,
        code: input.code,
      },
    });

    logger.info(`[Admin] Department created: ${dept.name} (${dept.code})`);
    return dept;
  }

  /**
   * Creates a new user with role assignments (enforcing privilege escalation prevention).
   */
  async createUser(input: CreateUserAdminInput, adminContext: AdminUserContext) {
    // Privilege escalation check: non-super-admin cannot create SUPER_ADMIN users
    const isSuperAdmin = adminContext.roles.includes('SUPER_ADMIN');
    if (!isSuperAdmin && input.roles.includes('SUPER_ADMIN')) {
      throw { statusCode: 403, message: 'Forbidden: Only SUPER_ADMIN can grant SUPER_ADMIN role' };
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          organizationId: adminContext.organizationId,
          departmentId: input.departmentId || adminContext.departmentId,
          email: input.email.toLowerCase(),
          passwordHash,
          fullName: input.fullName,
          isActive: true,
        },
      });

      // Link roles
      for (const roleName of input.roles) {
        const role = await tx.role.findUnique({ where: { name: roleName } });
        if (role) {
          await tx.userRole.create({
            data: { userId: u.id, roleId: role.id },
          });
        }
      }

      return u;
    });

    logger.info(`[Admin] User created: ${user.email} with roles: [${input.roles.join(', ')}]`);
    return { id: user.id, email: user.email, fullName: user.fullName, roles: input.roles };
  }

  /**
   * Retrieves all users within the organization.
   */
  async listUsers(adminContext: AdminUserContext) {
    const users = await prisma.user.findMany({
      where: { organizationId: adminContext.organizationId },
      include: {
        department: true,
        userRoles: {
          include: { role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      isActive: u.isActive,
      department: u.department ? { id: u.department.id, name: u.department.name, code: u.department.code } : null,
      roles: u.userRoles.map((ur) => ur.role.name),
      createdAt: u.createdAt,
    }));
  }

  /**
   * Updates an existing user's details, department, roles, or status.
   */
  async updateUser(userId: string, input: UpdateUserAdminInput, adminContext: AdminUserContext) {
    const isSuperAdmin = adminContext.roles.includes('SUPER_ADMIN');

    if (input.roles && input.roles.includes('SUPER_ADMIN') && !isSuperAdmin) {
      throw { statusCode: 403, message: 'Forbidden: Only SUPER_ADMIN can grant SUPER_ADMIN role' };
    }

    // Check target user
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!targetUser) {
      throw { statusCode: 404, message: 'User not found' };
    }

    const dataToUpdate: any = {};
    if (input.fullName) dataToUpdate.fullName = input.fullName;
    if (input.email) dataToUpdate.email = input.email.toLowerCase();
    if (input.departmentId !== undefined) dataToUpdate.departmentId = input.departmentId;
    if (input.isActive !== undefined) {
      // Prevent self-deactivation of SUPER_ADMIN
      if (userId === adminContext.id && !input.isActive) {
        throw { statusCode: 400, message: 'Self-deactivation of current administrator is not allowed' };
      }
      dataToUpdate.isActive = input.isActive;
    }
    if (input.password) {
      dataToUpdate.passwordHash = await bcrypt.hash(input.password, 12);
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: dataToUpdate,
      });

      if (input.roles && input.roles.length > 0) {
        await tx.userRole.deleteMany({ where: { userId } });
        for (const roleName of input.roles) {
          const role = await tx.role.findUnique({ where: { name: roleName } });
          if (role) {
            await tx.userRole.create({
              data: { userId, roleId: role.id },
            });
          }
        }
      }
    });

    logger.info(`[Admin] User updated: ${userId} by ${adminContext.id}`);
    return { success: true, userId };
  }

  /**
   * Deletes a user account (with protection against self-deletion or sole admin deletion).
   */
  async deleteUser(userId: string, adminContext: AdminUserContext) {
    if (userId === adminContext.id) {
      throw { statusCode: 400, message: 'Cannot delete your own active administrator account' };
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!targetUser) {
      throw { statusCode: 404, message: 'User not found' };
    }

    // Check if target is a super admin and if they are the last one
    const isTargetSuperAdmin = targetUser.userRoles.some((ur) => ur.role.name === 'SUPER_ADMIN');
    if (isTargetSuperAdmin) {
      const superAdminCount = await prisma.userRole.count({
        where: { role: { name: 'SUPER_ADMIN' } },
      });
      if (superAdminCount <= 1) {
        throw { statusCode: 400, message: 'Cannot delete the sole remaining SUPER_ADMIN user' };
      }
    }

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId } }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    logger.info(`[Admin] User deleted: ${userId} (${targetUser.email}) by ${adminContext.id}`);
    return { success: true, deletedUserId: userId };
  }

  /**
   * Public Self-Registration for Liaison Users via Registration Link.
   * Auto-assigns to default organization and VIEWER (Liaison Officer) role.
   */
  async publicRegisterUser(input: PublicSelfRegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (existing) {
      throw { statusCode: 409, message: 'An account with this email already exists' };
    }

    // Get default organization (HQ)
    let org = await prisma.organization.findFirst({
      where: { isActive: true },
    });
    if (!org) {
      org = await prisma.organization.create({
        data: { name: 'Document Control Center HQ', code: 'DCC-HQ', isActive: true },
      });
    }

    // Determine role to assign (default: VIEWER)
    const roleNameToAssign = input.targetRole || 'VIEWER';
    let role = await prisma.role.findUnique({ where: { name: roleNameToAssign } });
    if (!role) {
      role = await prisma.role.create({
        data: { 
          name: roleNameToAssign, 
          description: roleNameToAssign === 'DEPARTMENT_USER' 
            ? 'Department Executive / Boss View (Full Department Visibility)' 
            : 'Document Access and Liaison Operations' 
        },
      });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        departmentId: input.departmentId || null,
        email: input.email.toLowerCase(),
        passwordHash,
        fullName: input.fullName,
        isActive: true,
        userRoles: {
          create: { roleId: role.id },
        },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
      },
    });

    logger.info(`[Public Registration] New liaison user self-registered: ${user.email}`);
    return user;
  }

  /**
   * Assigns roles to user (enforcing privilege escalation prevention).
   */
  async assignRoles(targetUserId: string, input: AssignUserRoleInput, adminContext: AdminUserContext) {
    const isSuperAdmin = adminContext.roles.includes('SUPER_ADMIN');

    if (!isSuperAdmin && input.roleNames.includes('SUPER_ADMIN')) {
      throw { statusCode: 403, message: 'Forbidden: Cannot grant SUPER_ADMIN privilege' };
    }

    // Prevent administrators from demoting/modifying their own authorization in unsafe ways
    if (targetUserId === adminContext.id && !input.roleNames.includes('SUPER_ADMIN') && isSuperAdmin) {
      throw { statusCode: 400, message: 'Bad Request: Self-demotion of the active SUPER_ADMIN is disallowed' };
    }

    await prisma.$transaction(async (tx) => {
      // Clear existing roles
      await tx.userRole.deleteMany({ where: { userId: targetUserId } });

      // Assign new roles
      for (const roleName of input.roleNames) {
        const role = await tx.role.findUnique({ where: { name: roleName } });
        if (role) {
          await tx.userRole.create({
            data: { userId: targetUserId, roleId: role.id },
          });
        }
      }
    });

    logger.info(`[Admin] Assigned roles [${input.roleNames.join(', ')}] to user ${targetUserId}`);
    return { userId: targetUserId, roles: input.roleNames };
  }

  /**
   * Returns complete fleet overview for scanner agents, health, and current activity.
   */
  async getFleetOverview(adminContext: AdminUserContext) {
    const [agents, scanners, activeJobs, failedJobsCount] = await Promise.all([
      prisma.scannerAgent.findMany({
        where: { organizationId: adminContext.organizationId },
        include: { credentials: { where: { isActive: true } }, scanners: true },
      }),
      prisma.scanner.findMany({
        where: { organizationId: adminContext.organizationId },
      }),
      prisma.scanJob.findMany({
        where: { status: { in: ['DISPATCHED', 'SCANNING', 'UPLOADING'] } },
        take: 20,
      }),
      prisma.scanJob.count({
        where: { status: 'FAILED' },
      }),
    ]);

    const onlineAgentsCount = agents.filter((a) => a.status === 'ONLINE').length;

    return {
      agentsTotal: agents.length,
      onlineAgentsCount,
      offlineAgentsCount: agents.length - onlineAgentsCount,
      scannersTotal: scanners.length,
      activeJobsCount: activeJobs.length,
      failedJobsCount,
      agents: agents.map((a) => ({
        id: a.id,
        agentName: a.agentName,
        machineName: a.machineName,
        ipAddress: a.ipAddress,
        status: a.status,
        version: a.version,
        lastHeartbeat: a.lastHeartbeat,
        scannersCount: a.scanners.length,
      })),
      activeJobs: activeJobs.map((j) => ({
        id: j.id,
        status: j.status,
        scannerId: j.scannerId,
        pageCount: j.pageCount,
        createdAt: j.createdAt,
      })),
    };
  }

  /**
   * Identifies and recovers stale scan jobs stuck in DISPATCHED or SCANNING states.
   */
  async recoverStaleJobs(staleThresholdMs = 10 * 60 * 1000) {
    const cutoff = new Date(Date.now() - staleThresholdMs);

    const staleJobs = await prisma.scanJob.findMany({
      where: {
        status: { in: ['DISPATCHED', 'SCANNING'] },
        updatedAt: { lte: cutoff },
      },
    });

    const recovered: string[] = [];

    for (const job of staleJobs) {
      await prisma.$transaction([
        prisma.scanJob.update({
          where: { id: job.id },
          data: { status: 'RETRYING', retryCount: { increment: 1 } },
        }),
        prisma.scanJobAuditLog.create({
          data: {
            jobId: job.id,
            event: 'JOB_RECOVERED_STALE',
            fromStatus: job.status,
            toStatus: 'RETRYING',
            details: { reason: 'Job heartbeat timed out in active execution state' },
          },
        }),
      ]);
      recovered.push(job.id);
    }

    logger.info(`[Admin Recovery] Recovered ${recovered.length} stale scan job(s)`);
    return { recoveredCount: recovered.length, jobIds: recovered };
  }

  /**
   * Danger Zone: Purges all documents, scan jobs, batches, and related operational artifacts.
   * Keeps users, organizations, departments, scanner agents, scan profiles, and system settings intact.
   */
  async resetSystemData(adminContext: AdminUserContext) {
    logger.warn(`[Admin Danger Zone] Resetting all system document data triggered by ${adminContext.id}`);

    // Execute atomic cleanup of all document and scanning operational records
    const result = await prisma.$transaction(async (tx) => {
      // 1. Delete all documents (Cascades to pages, storage, metadata, ocr, links, access logs, audit logs, versions, workflow instances)
      const deletedDocs = await tx.document.deleteMany({});

      // 2. Delete all scan jobs (Cascades to job pages, upload sessions, job audit logs)
      const deletedJobs = await tx.scanJob.deleteMany({});

      // 3. Delete all scan batches
      const deletedBatches = await tx.scanBatch.deleteMany({});

      // 4. Delete saved searches and bulk operations
      await tx.bulkOperation.deleteMany({});
      await tx.notificationEvent.deleteMany({});

      return {
        documentsPurged: deletedDocs.count,
        scanJobsPurged: deletedJobs.count,
        batchesPurged: deletedBatches.count,
      };
    });

    logger.info(`[Admin Danger Zone] System reset complete: ${result.documentsPurged} docs, ${result.scanJobsPurged} jobs purged.`);
    return result;
  }
}

export const adminService = new AdminService();
