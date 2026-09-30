import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';

interface FailedAttemptTracker {
  attempts: number;
  lockedUntil?: Date;
}

export class VaultService {
  private failedAttempts: Map<string, FailedAttemptTracker> = new Map();
  private baseStorageDir: string;

  constructor() {
    this.baseStorageDir = path.resolve(process.cwd(), '.server_object_storage', 'nkb-documents', 'vault');
    if (!fs.existsSync(this.baseStorageDir)) {
      fs.mkdirSync(this.baseStorageDir, { recursive: true });
    }
  }

  // --- Rate Limiting / Brute Force Protection ---
  private checkBruteForce(userId: string): void {
    const tracker = this.failedAttempts.get(userId);
    if (!tracker) return;

    if (tracker.lockedUntil && tracker.lockedUntil > new Date()) {
      const waitMinutes = Math.ceil((tracker.lockedUntil.getTime() - Date.now()) / (60 * 1000));
      throw {
        statusCode: 429,
        message: `Too many failed vault authentication attempts. Locked out for ${waitMinutes} more minute(s).`,
      };
    }

    if (tracker.lockedUntil && tracker.lockedUntil <= new Date()) {
      this.failedAttempts.delete(userId);
    }
  }

  private recordFailedAttempt(userId: string): void {
    const tracker = this.failedAttempts.get(userId) || { attempts: 0 };
    tracker.attempts += 1;

    if (tracker.attempts >= 5) {
      tracker.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lockout
    }

    this.failedAttempts.set(userId, tracker);
  }

  private resetFailedAttempts(userId: string): void {
    this.failedAttempts.delete(userId);
  }

  // --- Audit Logger ---
  async logAudit(params: {
    userId?: string;
    action: string;
    documentId?: string;
    documentTitle?: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
    result?: 'SUCCESS' | 'DENIED' | 'FAILED';
    failureReason?: string;
  }): Promise<void> {
    try {
      await prisma.vaultAuditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          documentId: params.documentId,
          documentTitle: params.documentTitle,
          details: params.details || undefined,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent ? params.userAgent.substring(0, 500) : undefined,
          result: params.result || 'SUCCESS',
          failureReason: params.failureReason,
        },
      });
    } catch (err: any) {
      logger.error(`[VaultAuditLog] Failed to persist audit log: ${err.message}`);
    }
  }

  // --- Authorization Status Check ---
  async checkUserAuthorization(userId: string): Promise<{
    authorized: boolean;
    vaultRole: 'SUPER_ADMIN' | 'VAULT_MANAGER' | 'VAULT_USER' | null;
    status: string;
    user: any;
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return { authorized: false, vaultRole: null, status: 'INACTIVE_USER', user: null };
    }

    const isDccSuperAdmin = user.userRoles.some(
      (ur) => ur.role.name === 'SUPER_ADMIN' || ur.role.name === 'Super Admin'
    );

    const vaultAuth = await prisma.vaultAuthorization.findUnique({
      where: { userId },
    });

    if (vaultAuth) {
      if (vaultAuth.status === 'ACTIVE') {
        const effectiveRole = isDccSuperAdmin ? 'SUPER_ADMIN' : (vaultAuth.vaultRole as any);
        return { authorized: true, vaultRole: effectiveRole, status: 'ACTIVE', user };
      } else {
        // Explicitly revoked
        return { authorized: false, vaultRole: null, status: 'REVOKED', user };
      }
    }

    // If user is DCC SUPER_ADMIN and no explicit record yet, auto-provision active vault record
    if (isDccSuperAdmin) {
      const createdAuth = await prisma.vaultAuthorization.create({
        data: {
          userId: user.id,
          vaultRole: 'SUPER_ADMIN',
          authorizedById: user.id,
          status: 'ACTIVE',
          notes: 'Auto-provisioned for System Super Administrator',
        },
      });
      return { authorized: true, vaultRole: 'SUPER_ADMIN', status: 'ACTIVE', user };
    }

    return { authorized: false, vaultRole: null, status: 'UNAUTHORIZED', user };
  }

  // --- Unlock Vault via Password Verification ---
  async unlockVault(
    userId: string,
    passwordAttempt: string,
    ip?: string,
    userAgent?: string
  ): Promise<{
    sessionToken: string;
    expiresAt: Date;
    vaultRole: string;
  }> {
    this.checkBruteForce(userId);

    const authCheck = await this.checkUserAuthorization(userId);
    if (!authCheck.authorized || !authCheck.user) {
      await this.logAudit({
        userId,
        action: 'VAULT_ACCESS_DENIED',
        result: 'DENIED',
        failureReason: authCheck.status === 'REVOKED' ? 'Vault access revoked' : 'User not authorized for Private Vault',
        ipAddress: ip,
        userAgent,
      });

      throw {
        statusCode: 403,
        message: '403 ACCESS DENIED: Your account is not authorized to access the Private Vault.',
      };
    }

    // Verify user's DCC password using bcrypt
    const passwordValid = await bcrypt.compare(passwordAttempt, authCheck.user.passwordHash);

    if (!passwordValid) {
      this.recordFailedAttempt(userId);

      await this.logAudit({
        userId,
        action: 'VAULT_PASSWORD_VERIFICATION_FAILED',
        result: 'FAILED',
        failureReason: 'Invalid DCC password provided',
        ipAddress: ip,
        userAgent,
      });

      throw {
        statusCode: 401,
        message: 'Vault authentication failed: Invalid password.',
      };
    }

    // Password valid -> reset failed attempts
    this.resetFailedAttempts(userId);

    // Invalidate existing active sessions for this user to enforce single-session hygiene
    await prisma.vaultAccessSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute validity

    await prisma.vaultAccessSession.create({
      data: {
        userId,
        sessionToken,
        ipAddress: ip,
        userAgent,
        isActive: true,
        expiresAt,
        lastActivityAt: new Date(),
      },
    });

    // Update last access timestamp in VaultAuthorization
    await prisma.vaultAuthorization.updateMany({
      where: { userId },
      data: { lastAccessAt: new Date() },
    });

    await this.logAudit({
      userId,
      action: 'VAULT_PASSWORD_VERIFICATION_SUCCESS',
      result: 'SUCCESS',
      details: { role: authCheck.vaultRole },
      ipAddress: ip,
      userAgent,
    });

    await this.logAudit({
      userId,
      action: 'VAULT_ACCESS_GRANTED',
      result: 'SUCCESS',
      details: { role: authCheck.vaultRole, sessionExpiresAt: expiresAt },
      ipAddress: ip,
      userAgent,
    });

    return {
      sessionToken,
      expiresAt,
      vaultRole: authCheck.vaultRole!,
    };
  }

  // --- Validate Vault Session (with Inactivity Auto-Lock & Sliding Window) ---
  async validateSession(
    sessionToken: string,
    ip?: string,
    userAgent?: string
  ): Promise<{
    valid: boolean;
    userId: string;
    vaultRole: string;
    session: any;
    user: any;
  }> {
    if (!sessionToken) {
      throw { statusCode: 401, message: 'Vault session token required.' };
    }

    const session = await prisma.vaultAccessSession.findUnique({
      where: { sessionToken },
      include: {
        user: {
          include: {
            userRoles: {
              include: { role: true },
            },
          },
        },
      },
    });

    if (!session) {
      throw { statusCode: 401, message: 'Invalid or locked Vault session.' };
    }

    // Re-verify authorization status (immediate revocation check)
    const authCheck = await this.checkUserAuthorization(session.userId);
    if (!authCheck.authorized) {
      if (session.isActive) {
        await prisma.vaultAccessSession.update({
          where: { id: session.id },
          data: { isActive: false },
        });
      }

      await this.logAudit({
        userId: session.userId,
        action: 'VAULT_ACCESS_DENIED',
        result: 'DENIED',
        failureReason: 'Vault authorization was revoked',
        ipAddress: ip,
        userAgent,
      });

      throw {
        statusCode: 403,
        message: '403 ACCESS DENIED: Vault access has been revoked.',
      };
    }

    if (!session.isActive) {
      throw { statusCode: 401, message: 'Invalid or locked Vault session.' };
    }

    const now = new Date();

    // Check expiration (15-min auto-lock)
    if (session.expiresAt <= now) {
      await prisma.vaultAccessSession.update({
        where: { id: session.id },
        data: { isActive: false },
      });

      await this.logAudit({
        userId: session.userId,
        action: 'VAULT_AUTO_LOCKED',
        result: 'SUCCESS',
        details: { reason: 'Session expired after 15 minutes of inactivity' },
        ipAddress: ip,
        userAgent,
      });

      throw {
        statusCode: 401,
        message: 'Vault locked due to 15-minute inactivity. Please re-authenticate.',
      };
    }

    // Sliding window: refresh expiration by 15 minutes on active request
    const newExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const updatedSession = await prisma.vaultAccessSession.update({
      where: { id: session.id },
      data: {
        lastActivityAt: now,
        expiresAt: newExpiresAt,
      },
    });

    return {
      valid: true,
      userId: session.userId,
      vaultRole: authCheck.vaultRole!,
      session: updatedSession,
      user: session.user,
    };
  }

  // --- Lock Vault Session ---
  async lockVault(sessionToken?: string, userId?: string, ip?: string, userAgent?: string): Promise<void> {
    if (sessionToken) {
      await prisma.vaultAccessSession.updateMany({
        where: { sessionToken, isActive: true },
        data: { isActive: false },
      });
    } else if (userId) {
      await prisma.vaultAccessSession.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });
    }

    await this.logAudit({
      userId,
      action: 'VAULT_LOCKED',
      result: 'SUCCESS',
      details: { lockedByUser: true },
      ipAddress: ip,
      userAgent,
    });
  }

  // --- Document Storage & Management ---
  async uploadDocument(params: {
    title: string;
    folder?: string;
    documentType?: string;
    fileBuffer: Buffer;
    fileName: string;
    userId: string;
    vaultRole: string;
    ip?: string;
    userAgent?: string;
  }): Promise<any> {
    const { title, folder = '/', documentType = 'EXECUTIVE_CONFIDENTIAL', fileBuffer, fileName, userId, vaultRole, ip, userAgent } = params;

    const docId = crypto.randomUUID();
    const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Secure isolated vault storage directory
    const docDir = path.join(this.baseStorageDir, docId);
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }

    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = path.join(docDir, safeFileName);
    fs.writeFileSync(storagePath, fileBuffer);

    // Save in database
    const document = await prisma.vaultDocument.create({
      data: {
        id: docId,
        title: title || safeFileName,
        folder: folder.startsWith('/') ? folder : `/${folder}`,
        documentType,
        fileSizeBytes: BigInt(fileBuffer.length),
        sha256Hash,
        storageKey: storagePath,
        ownerId: userId,
        status: 'ACTIVE',
      },
    });

    // Create owner permission
    await prisma.vaultDocumentPermission.create({
      data: {
        vaultDocumentId: docId,
        userId,
        canRead: true,
        canPreview: true,
        canDownload: true,
        canEdit: true,
        canDelete: true,
        grantedById: userId,
      },
    });

    await this.logAudit({
      userId,
      action: 'VAULT_DOCUMENT_UPLOADED',
      documentId: docId,
      documentTitle: document.title,
      details: {
        fileName: safeFileName,
        fileSizeBytes: Number(fileBuffer.length),
        sha256Hash,
        folder: document.folder,
      },
      result: 'SUCCESS',
      ipAddress: ip,
      userAgent,
    });

    return {
      ...document,
      fileSizeBytes: Number(document.fileSizeBytes),
    };
  }

  async listDocuments(
    userId: string,
    vaultRole: string,
    options: { folder?: string; search?: string; status?: string } = {}
  ): Promise<any[]> {
    const where: any = {
      status: options.status || 'ACTIVE',
    };

    if (options.folder && options.folder !== '/') {
      where.folder = options.folder;
    }

    if (options.search) {
      where.OR = [
        { title: { contains: options.search, mode: 'insensitive' } },
        { documentType: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    // Role-based visibility
    if (vaultRole === 'SUPER_ADMIN' || vaultRole === 'VAULT_MANAGER') {
      // Full view
    } else {
      // VAULT_USER: only documents they own OR have permission for
      where.OR = [
        { ownerId: userId },
        { permissions: { some: { userId, canRead: true } } },
        { permissions: { some: { vaultRole: 'VAULT_USER', canRead: true } } },
      ];
    }

    const docs = await prisma.vaultDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        permissions: {
          where: {
            OR: [{ userId }, { vaultRole: 'VAULT_USER' }],
          },
        },
      },
    });

    return docs.map((doc) => {
      const isOwner = doc.ownerId === userId;
      const isSuper = vaultRole === 'SUPER_ADMIN';
      const isManager = vaultRole === 'VAULT_MANAGER';
      const userPerm = doc.permissions.find((p) => p.userId === userId);

      const canRead = isSuper || isManager || isOwner || !!userPerm?.canRead;
      const canPreview = isSuper || isManager || isOwner || !!userPerm?.canPreview;
      const canDownload = isSuper || isManager || isOwner || !!userPerm?.canDownload;
      const canEdit = isSuper || isManager || isOwner || !!userPerm?.canEdit;
      const canDelete = isSuper || isOwner || !!userPerm?.canDelete;

      return {
        id: doc.id,
        title: doc.title,
        folder: doc.folder,
        documentType: doc.documentType,
        fileSizeBytes: Number(doc.fileSizeBytes),
        sha256Hash: doc.sha256Hash,
        encryptionAlgorithm: doc.encryptionAlgorithm,
        ownerId: doc.ownerId,
        ownerName: doc.owner.fullName,
        ownerEmail: doc.owner.email,
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        permissions: {
          canRead,
          canPreview,
          canDownload,
          canEdit,
          canDelete,
        },
      };
    });
  }

  async getDocument(
    documentId: string,
    userId: string,
    vaultRole: string,
    ip?: string,
    userAgent?: string
  ): Promise<any> {
    const doc = await prisma.vaultDocument.findUnique({
      where: { id: documentId },
      include: {
        owner: {
          select: { id: true, fullName: true, email: true },
        },
        permissions: true,
      },
    });

    if (!doc || doc.status === 'PURGED') {
      throw { statusCode: 404, message: 'Vault document not found.' };
    }

    // Permission check
    const isSuper = vaultRole === 'SUPER_ADMIN';
    const isManager = vaultRole === 'VAULT_MANAGER';
    const isOwner = doc.ownerId === userId;
    const userPerm = doc.permissions.find((p) => p.userId === userId || p.vaultRole === vaultRole);

    if (!isSuper && !isManager && !isOwner && (!userPerm || !userPerm.canRead)) {
      await this.logAudit({
        userId,
        action: 'VAULT_DOCUMENT_VIEWED',
        documentId,
        documentTitle: doc.title,
        result: 'DENIED',
        failureReason: 'No read permission for this vault document',
        ipAddress: ip,
        userAgent,
      });

      throw { statusCode: 403, message: 'Access denied: You do not have permission to view this document.' };
    }

    await this.logAudit({
      userId,
      action: 'VAULT_DOCUMENT_VIEWED',
      documentId,
      documentTitle: doc.title,
      result: 'SUCCESS',
      ipAddress: ip,
      userAgent,
    });

    return {
      ...doc,
      fileSizeBytes: Number(doc.fileSizeBytes),
      permissions: {
        canRead: true,
        canPreview: isSuper || isManager || isOwner || !!userPerm?.canPreview,
        canDownload: isSuper || isManager || isOwner || !!userPerm?.canDownload,
        canEdit: isSuper || isManager || isOwner || !!userPerm?.canEdit,
        canDelete: isSuper || isOwner || !!userPerm?.canDelete,
      },
    };
  }

  async getDocumentStream(
    documentId: string,
    userId: string,
    vaultRole: string,
    type: 'PREVIEW' | 'DOWNLOAD',
    ip?: string,
    userAgent?: string
  ): Promise<{ stream: fs.ReadStream; title: string; size: number; contentType: string }> {
    const doc = await prisma.vaultDocument.findUnique({
      where: { id: documentId },
      include: { permissions: true },
    });

    if (!doc || doc.status === 'PURGED') {
      throw { statusCode: 404, message: 'Vault document not found.' };
    }

    const isSuper = vaultRole === 'SUPER_ADMIN';
    const isManager = vaultRole === 'VAULT_MANAGER';
    const isOwner = doc.ownerId === userId;
    const userPerm = doc.permissions.find((p) => p.userId === userId || p.vaultRole === vaultRole);

    const allowed =
      type === 'PREVIEW'
        ? isSuper || isManager || isOwner || !!userPerm?.canPreview
        : isSuper || isManager || isOwner || !!userPerm?.canDownload;

    if (!allowed) {
      await this.logAudit({
        userId,
        action: type === 'PREVIEW' ? 'VAULT_DOCUMENT_PREVIEWED' : 'VAULT_DOCUMENT_DOWNLOADED',
        documentId,
        documentTitle: doc.title,
        result: 'DENIED',
        failureReason: `Permission denied for ${type.toLowerCase()}`,
        ipAddress: ip,
        userAgent,
      });

      throw { statusCode: 403, message: `Access denied: You do not have permission to ${type.toLowerCase()} this document.` };
    }

    if (!fs.existsSync(doc.storageKey)) {
      throw { statusCode: 404, message: 'Physical vault file not found on secure storage.' };
    }

    const stat = fs.statSync(doc.storageKey);
    const stream = fs.createReadStream(doc.storageKey);

    // Determine contentType
    let contentType = 'application/octet-stream';
    const ext = path.extname(doc.storageKey).toLowerCase();
    if (ext === '.pdf') contentType = 'application/pdf';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.txt') contentType = 'text/plain';

    await this.logAudit({
      userId,
      action: type === 'PREVIEW' ? 'VAULT_DOCUMENT_PREVIEWED' : 'VAULT_DOCUMENT_DOWNLOADED',
      documentId,
      documentTitle: doc.title,
      result: 'SUCCESS',
      ipAddress: ip,
      userAgent,
    });

    return {
      stream,
      title: doc.title,
      size: stat.size,
      contentType,
    };
  }

  async deleteDocument(
    documentId: string,
    userId: string,
    vaultRole: string,
    ip?: string,
    userAgent?: string
  ): Promise<void> {
    const doc = await prisma.vaultDocument.findUnique({
      where: { id: documentId },
      include: { permissions: true },
    });

    if (!doc) {
      throw { statusCode: 404, message: 'Vault document not found.' };
    }

    const isSuper = vaultRole === 'SUPER_ADMIN';
    const isOwner = doc.ownerId === userId;
    const userPerm = doc.permissions.find((p) => p.userId === userId);

    if (!isSuper && !isOwner && (!userPerm || !userPerm.canDelete)) {
      await this.logAudit({
        userId,
        action: 'VAULT_DOCUMENT_DELETED',
        documentId,
        documentTitle: doc.title,
        result: 'DENIED',
        failureReason: 'No delete permission for this vault document',
        ipAddress: ip,
        userAgent,
      });

      throw { statusCode: 403, message: 'Access denied: You do not have permission to delete this document.' };
    }

    // Remove physical file from secure storage
    if (fs.existsSync(doc.storageKey)) {
      try {
        fs.unlinkSync(doc.storageKey);
        const dir = path.dirname(doc.storageKey);
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch (err: any) {
        logger.error(`[VaultService] Error deleting file on disk: ${err.message}`);
      }
    }

    // Log audit event before deleting document
    await this.logAudit({
      userId,
      action: 'VAULT_DOCUMENT_DELETED',
      documentId,
      documentTitle: doc.title,
      details: { deletedDocumentId: documentId, folder: doc.folder, sha256: doc.sha256Hash },
      result: 'SUCCESS',
      ipAddress: ip,
      userAgent,
    });

    // Delete record & permissions
    await prisma.vaultDocumentPermission.deleteMany({ where: { vaultDocumentId: documentId } });
    await prisma.vaultDocument.delete({ where: { id: documentId } });
  }

  // --- Super Admin User Authorization Management ---
  async listVaultUsers(): Promise<any[]> {
    const allUsers = await prisma.user.findMany({
      where: { isActive: true },
      include: {
        userRoles: {
          include: { role: true },
        },
        vaultAuthorizations: {
          include: {
            authorizedBy: {
              select: { id: true, fullName: true, email: true },
            },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    return allUsers.map((u: any) => {
      const isSuper = u.userRoles.some((r: any) => r.role.name === 'SUPER_ADMIN' || r.role.name === 'Super Admin');
      const auth = u.vaultAuthorizations && u.vaultAuthorizations.length > 0 ? u.vaultAuthorizations[0] : null;

      return {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        roles: u.userRoles.map((ur: any) => ur.role.name),
        isSuperAdmin: isSuper,
        vaultStatus: auth ? auth.status : (isSuper ? 'ACTIVE' : 'UNAUTHORIZED'),
        vaultRole: auth ? auth.vaultRole : (isSuper ? 'SUPER_ADMIN' : null),
        authorizedAt: auth?.authorizedAt || null,
        authorizedByName: auth?.authorizedBy?.fullName || (isSuper ? 'System' : null),
        lastAccessAt: auth?.lastAccessAt || null,
        notes: auth?.notes || null,
      };
    });
  }

  async authorizeUser(params: {
    targetUserId: string;
    vaultRole: 'VAULT_MANAGER' | 'VAULT_USER';
    authorizedById: string;
    notes?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<any> {
    const { targetUserId, vaultRole, authorizedById, notes, ip, userAgent } = params;

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw { statusCode: 404, message: 'Target user not found.' };
    }

    const auth = await prisma.vaultAuthorization.upsert({
      where: { userId: targetUserId },
      create: {
        userId: targetUserId,
        vaultRole,
        authorizedById,
        status: 'ACTIVE',
        notes,
      },
      update: {
        vaultRole,
        authorizedById,
        authorizedAt: new Date(),
        status: 'ACTIVE',
        notes,
      },
    });

    await this.logAudit({
      userId: authorizedById,
      action: 'VAULT_USER_AUTHORIZED',
      details: {
        targetUserId,
        targetEmail: targetUser.email,
        targetFullName: targetUser.fullName,
        vaultRole,
        notes,
      },
      result: 'SUCCESS',
      ipAddress: ip,
      userAgent,
    });

    return auth;
  }

  async revokeUser(params: {
    targetUserId: string;
    revokedById: string;
    reason?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    const { targetUserId, revokedById, reason, ip, userAgent } = params;

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!targetUser) {
      throw { statusCode: 404, message: 'Target user not found.' };
    }

    const isSuper = targetUser.userRoles.some((r) => r.role.name === 'SUPER_ADMIN' || r.role.name === 'Super Admin');
    if (isSuper && targetUserId === revokedById) {
      throw { statusCode: 400, message: 'Cannot revoke your own Super Admin Vault access.' };
    }

    await prisma.vaultAuthorization.upsert({
      where: { userId: targetUserId },
      create: {
        userId: targetUserId,
        vaultRole: 'VAULT_USER',
        authorizedById: revokedById,
        status: 'REVOKED',
        notes: reason || 'Access Revoked',
      },
      update: {
        status: 'REVOKED',
        notes: reason || 'Access Revoked',
      },
    });

    // Invalidate ALL active sessions for this user immediately
    await prisma.vaultAccessSession.updateMany({
      where: { userId: targetUserId, isActive: true },
      data: { isActive: false },
    });

    await this.logAudit({
      userId: revokedById,
      action: 'VAULT_USER_REVOKED',
      details: {
        targetUserId,
        targetEmail: targetUser.email,
        targetFullName: targetUser.fullName,
        reason,
      },
      result: 'SUCCESS',
      ipAddress: ip,
      userAgent,
    });
  }

  // --- Audit Logs Retrieval ---
  async getAuditLogs(options: { page?: number; limit?: number; action?: string; userId?: string } = {}): Promise<{
    logs: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 25));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (options.action) where.action = options.action;
    if (options.userId) where.userId = options.userId;

    const [total, logs] = await Promise.all([
      prisma.vaultAuditLog.count({ where }),
      prisma.vaultAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
      }),
    ]);

    return {
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        documentId: l.documentId,
        documentTitle: l.documentTitle,
        details: l.details,
        ipAddress: l.ipAddress,
        userAgent: l.userAgent,
        result: l.result,
        failureReason: l.failureReason,
        createdAt: l.createdAt,
        user: l.user,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
}

export const vaultService = new VaultService();
