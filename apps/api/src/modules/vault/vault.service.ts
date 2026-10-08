import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable } from 'stream';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';
import { scannerService } from '../scanners/scanner.service.js';
import { generateDossierDocketPdf } from '../../lib/pdfMergeSplit.js';

interface FailedAttemptTracker {
  attempts: number;
  lockedUntil?: Date;
}

const VAULT_MASTER_SECRET = process.env.VAULT_ENCRYPTION_SECRET || 'NKB-DCC-HIGH-SECURITY-VAULT-AES256GCM-2026';

export class VaultService {
  private failedAttempts: Map<string, FailedAttemptTracker> = new Map();
  private baseStorageDir: string;

  constructor() {
    this.baseStorageDir = scannerService.getVaultLocalStoragePath();
    if (!fs.existsSync(this.baseStorageDir)) {
      fs.mkdirSync(this.baseStorageDir, { recursive: true });
    }
  }

  private getActiveVaultLocalDir(): string {
    const dir = scannerService.getVaultLocalStoragePath();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * High-Security Compression (GZIP) + Encryption (AES-256-GCM + PBKDF2-SHA512)
   * Produces a tamper-evident .dccvault binary container saved to Local Storage.
   */
  compressAndEncryptToVaultContainer(
    rawBuffer: Buffer,
    metadata: {
      originalFileName: string;
      title: string;
      mimeType: string;
      cloudDocumentId?: string;
      sha256Hash: string;
      createdAt: string;
    },
    pin?: string
  ): { vaultBuffer: Buffer; compressedSize: number; encryptedSize: number } {
    const compressed = zlib.gzipSync(rawBuffer, { level: 9 });
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const effectivePassphrase = `${VAULT_MASTER_SECRET}:${pin || 'DEFAULT_VAULT_KEY'}`;
    const key = crypto.pbkdf2Sync(effectivePassphrase, salt, 100000, 32, 'sha512');

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encryptedPayload = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const headerObj = {
      magic: 'DCCVAULT_V2',
      algorithm: 'GZIP+AES-256-GCM-PBKDF2-SHA512',
      kdfIterations: 100000,
      hasCustomPin: Boolean(pin && pin.trim().length > 0),
      saltHex: salt.toString('hex'),
      ivHex: iv.toString('hex'),
      authTagHex: authTag.toString('hex'),
      originalSizeBytes: rawBuffer.length,
      compressedSizeBytes: compressed.length,
      encryptedSizeBytes: encryptedPayload.length,
      metadata,
    };

    const headerJsonBuf = Buffer.from(JSON.stringify(headerObj), 'utf-8');
    const magicBuf = Buffer.from('DCCVAULT1', 'ascii'); // 9 bytes
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(headerJsonBuf.length, 0);

    const vaultBuffer = Buffer.concat([magicBuf, lenBuf, headerJsonBuf, encryptedPayload]);
    return {
      vaultBuffer,
      compressedSize: compressed.length,
      encryptedSize: vaultBuffer.length,
    };
  }

  /**
   * Zero-Disk Plaintext Decryption + Decompression of a .dccvault container in memory (RAM)
   */
  decryptAndDecompressVaultContainer(
    vaultBuffer: Buffer,
    pin?: string
  ): {
    rawBuffer: Buffer;
    header: any;
    metadata: any;
  } {
    const magic = vaultBuffer.subarray(0, 9).toString('ascii');
    if (magic !== 'DCCVAULT1') {
      // Legacy unencrypted fallback if file was stored before .dccvault container
      return {
        rawBuffer: vaultBuffer,
        header: { algorithm: 'RAW_LEGACY', originalSizeBytes: vaultBuffer.length },
        metadata: { originalFileName: 'Document.pdf', mimeType: 'application/pdf' },
      };
    }

    const headerLen = vaultBuffer.readUInt32BE(9);
    const headerJsonStr = vaultBuffer.subarray(13, 13 + headerLen).toString('utf-8');
    const header = JSON.parse(headerJsonStr);
    const ciphertext = vaultBuffer.subarray(13 + headerLen);

    const salt = Buffer.from(header.saltHex, 'hex');
    const iv = Buffer.from(header.ivHex, 'hex');
    const authTag = Buffer.from(header.authTagHex, 'hex');

    // Try with provided PIN first; if not custom-pinned, fallback to default key
    const candidatePins = pin ? [pin, ''] : [''];
    let decryptedCompressed: Buffer | null = null;

    for (const candidatePin of candidatePins) {
      try {
        const effectivePassphrase = `${VAULT_MASTER_SECRET}:${candidatePin || 'DEFAULT_VAULT_KEY'}`;
        const key = crypto.pbkdf2Sync(effectivePassphrase, salt, 100000, 32, 'sha512');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        decryptedCompressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        break;
      } catch {}
    }

    if (!decryptedCompressed) {
      throw {
        statusCode: 401,
        message: 'Decryption failed: Invalid Vault Security PIN or tampered .dccvault file (AES-256-GCM Auth Tag mismatch).',
      };
    }

    const rawBuffer = zlib.gunzipSync(decryptedCompressed);
    return {
      rawBuffer,
      header,
      metadata: header.metadata || {},
    };
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

  // --- Authorization Status Check (Strictly Admin & Liaison Only) ---
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

    const roleNames = user.userRoles.map((ur) => ur.role.name.toUpperCase());
    const isDccSuperAdmin = roleNames.includes('SUPER_ADMIN') || roleNames.includes('SUPER ADMIN');
    const isLiaison = roleNames.includes('VIEWER') || roleNames.includes('LIAISON');

    const vaultAuth = await prisma.vaultAuthorization.findUnique({
      where: { userId },
    });

    if (vaultAuth) {
      if (vaultAuth.status === 'ACTIVE') {
        const effectiveRole = isDccSuperAdmin ? 'SUPER_ADMIN' : (vaultAuth.vaultRole as any);
        return { authorized: true, vaultRole: effectiveRole, status: 'ACTIVE', user };
      } else {
        return { authorized: false, vaultRole: null, status: 'REVOKED', user };
      }
    }

    // Auto-provision active vault record for SUPER_ADMIN (Admin) and VIEWER (Liaison Officer)
    if (isDccSuperAdmin || isLiaison) {
      const assignedRole = isDccSuperAdmin ? 'SUPER_ADMIN' : 'VAULT_MANAGER';
      await prisma.vaultAuthorization.create({
        data: {
          userId: user.id,
          vaultRole: assignedRole,
          authorizedById: user.id,
          status: 'ACTIVE',
          notes: isDccSuperAdmin
            ? 'Auto-provisioned for System Super Administrator'
            : 'Auto-provisioned for Authorized Liaison Officer',
        },
      });
      return { authorized: true, vaultRole: assignedRole, status: 'ACTIVE', user };
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

  // --- Document Storage & Management (Compressed + Encrypted .dccvault in Local Storage) ---
  async uploadDocument(params: {
    title: string;
    folder?: string;
    documentType?: string;
    fileBuffer: Buffer;
    fileName: string;
    cloudDocumentId?: string;
    vaultPin?: string;
    userId: string;
    vaultRole: string;
    ip?: string;
    userAgent?: string;
  }): Promise<any> {
    const {
      title,
      folder = '/BIR',
      documentType = 'EXECUTIVE_CONFIDENTIAL',
      fileBuffer,
      fileName,
      cloudDocumentId,
      vaultPin,
      userId,
      ip,
      userAgent,
    } = params;

    const docId = crypto.randomUUID();
    const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const vaultLocalDir = this.getActiveVaultLocalDir();

    const safeFileName = (fileName || 'confidential.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(safeFileName).toLowerCase();
    let mimeType = 'application/pdf';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.txt') mimeType = 'text/plain';

    // Compress (GZIP) + Encrypt (AES-256-GCM) before saving to Local Storage
    const { vaultBuffer, compressedSize, encryptedSize } = this.compressAndEncryptToVaultContainer(
      fileBuffer,
      {
        originalFileName: safeFileName,
        title: title || safeFileName,
        mimeType,
        cloudDocumentId,
        sha256Hash,
        createdAt: new Date().toISOString(),
      },
      vaultPin
    );

    const vaultFileName = `${docId.slice(0, 8)}_${safeFileName}.dccvault`;
    const storagePath = path.join(vaultLocalDir, vaultFileName);
    fs.writeFileSync(storagePath, vaultBuffer);

    const document = await prisma.vaultDocument.create({
      data: {
        id: docId,
        title: title || safeFileName,
        folder: folder.startsWith('/') ? folder : `/${folder}`,
        documentType,
        fileSizeBytes: BigInt(fileBuffer.length),
        sha256Hash,
        storageKey: storagePath,
        encryptionAlgorithm: 'GZIP+AES-256-GCM-PBKDF2',
        ownerId: userId,
        status: 'ACTIVE',
      },
    });

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
        vaultFileName,
        localStoragePath: storagePath,
        originalSizeBytes: Number(fileBuffer.length),
        compressedSizeBytes: compressedSize,
        encryptedSizeBytes: encryptedSize,
        cloudDocumentId: cloudDocumentId || null,
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
      compressedSizeBytes: compressedSize,
      encryptedSizeBytes: encryptedSize,
      localStoragePath: storagePath,
      vaultFileName,
    };
  }

  /**
   * NEW MECHANIC: Before adding a document to Private Vault, it MUST first exist in Cloud Storage.
   * Pulls the Cloud Storage document, compresses + encrypts it (GZIP + AES-256-GCM),
   * and saves it as a .dccvault file into Local Storage (<LocalStorage>/PrivateVault/).
   */
  async addFromCloudStorage(params: {
    cloudDocumentId: string;
    title?: string;
    folder?: string;
    documentType?: string;
    vaultPin?: string;
    removeFromCloud?: boolean;
    userId: string;
    vaultRole: string;
    ip?: string;
    userAgent?: string;
  }): Promise<any> {
    const {
      cloudDocumentId,
      title,
      folder = '/BIR',
      documentType,
      vaultPin,
      removeFromCloud = false,
      userId,
      vaultRole,
      ip,
      userAgent,
    } = params;

    if (!cloudDocumentId) {
      throw {
        statusCode: 400,
        message: 'Cloud Storage Document ID is required. You must upload the document to Cloud Storage first before adding it to the Private Vault.',
      };
    }

    const cloudDoc = await prisma.document.findUnique({
      where: { id: cloudDocumentId },
      include: {
        metadata: true,
        pages: true,
        department: true,
      },
    });

    if (!cloudDoc || cloudDoc.isPurged) {
      throw {
        statusCode: 400,
        message: 'Security Mechanic Enforced: Document was not found in Cloud Storage. Please upload the document to Cloud Storage first before transferring to the Private Vault.',
      };
    }

    // Read physical file from Cloud Storage (or generate official PDF dossier if metadata-only)
    let rawBuffer: Buffer | null = null;
    let resolvedFileName = `${(cloudDoc.title || 'Cloud_Document').replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`;

    if (cloudDoc.storageKeyPdf && fs.existsSync(cloudDoc.storageKeyPdf)) {
      rawBuffer = fs.readFileSync(cloudDoc.storageKeyPdf);
      resolvedFileName = path.basename(cloudDoc.storageKeyPdf);
    } else if (cloudDoc.pages && cloudDoc.pages.length > 0) {
      const firstPageKey = cloudDoc.pages[0].storageKey;
      if (firstPageKey && fs.existsSync(firstPageKey)) {
        rawBuffer = fs.readFileSync(firstPageKey);
        resolvedFileName = path.basename(firstPageKey);
      }
    }

    if (!rawBuffer) {
      rawBuffer = await generateDossierDocketPdf({
        title: cloudDoc.title,
        referenceNumber: cloudDoc.referenceNumber || cloudDoc.id.slice(0, 8),
        departmentName: cloudDoc.department?.name || 'Cloud Storage',
        documentType: cloudDoc.documentType,
        status: cloudDoc.status,
        createdAt: cloudDoc.createdAt,
        fileSizeBytes: Number(cloudDoc.fileSizeBytes || 0),
        sha256Hash: cloudDoc.sha256Hash,
      });
    }

    const folderMeta = cloudDoc.metadata?.find((m) => m.key === 'folder_category')?.value;
    const effectiveFolder = folder || (folderMeta === 'BIR' ? '/BIR' : '/Company_Documentation');

    const vaultDoc = await this.uploadDocument({
      title: title || cloudDoc.title,
      folder: effectiveFolder,
      documentType: documentType || cloudDoc.documentType || 'EXECUTIVE_CONFIDENTIAL',
      fileBuffer: rawBuffer,
      fileName: resolvedFileName,
      cloudDocumentId: cloudDoc.id,
      vaultPin,
      userId,
      vaultRole,
      ip,
      userAgent,
    });

    // Tag the Cloud Storage document or remove it if requested
    if (removeFromCloud) {
      await prisma.document.delete({ where: { id: cloudDoc.id } }).catch(() => {});
    } else {
      await prisma.documentMetadata.createMany({
        data: [
          { documentId: cloudDoc.id, key: 'in_private_vault', value: 'true' },
          { documentId: cloudDoc.id, key: 'vault_document_id', value: vaultDoc.id },
          { documentId: cloudDoc.id, key: 'vault_local_path', value: vaultDoc.localStoragePath },
        ],
      }).catch(() => {});
    }

    return {
      ...vaultDoc,
      sourceCloudDocumentId: cloudDoc.id,
      sourceCloudReference: cloudDoc.referenceNumber,
    };
  }

  /**
   * Decrypts & Decompresses a Local Storage .dccvault file inside the Private Vault Upload/Decrypt Section.
   * Performs Zero-Disk Plaintext Decryption in RAM and returns the original file for preview/download.
   */
  async decryptLocalVaultFile(params: {
    vaultDocumentId?: string;
    localFilePath?: string;
    fileBuffer?: Buffer;
    fileName?: string;
    vaultPin?: string;
    userId: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{
    decryptedFileName: string;
    title: string;
    mimeType: string;
    originalSizeBytes: number;
    encryptedSizeBytes: number;
    algorithm: string;
    sha256Hash: string;
    base64Data: string;
    localStoragePath?: string;
  }> {
    const { vaultDocumentId, localFilePath, fileBuffer, fileName, vaultPin, userId, ip, userAgent } = params;

    let targetVaultBuffer: Buffer | null = fileBuffer || null;
    let sourcePath = localFilePath || fileName || 'Uploaded .dccvault';

    if (!targetVaultBuffer && vaultDocumentId) {
      const vDoc = await prisma.vaultDocument.findUnique({ where: { id: vaultDocumentId } });
      if (!vDoc || !fs.existsSync(vDoc.storageKey)) {
        throw { statusCode: 404, message: 'Encrypted .dccvault file not found in Local Storage.' };
      }
      targetVaultBuffer = fs.readFileSync(vDoc.storageKey);
      sourcePath = vDoc.storageKey;
    } else if (!targetVaultBuffer && localFilePath) {
      const candidatePath = path.isAbsolute(localFilePath)
        ? localFilePath
        : path.join(this.getActiveVaultLocalDir(), path.basename(localFilePath));
      if (!fs.existsSync(candidatePath)) {
        throw { statusCode: 404, message: `Encrypted file not found at Local Storage path: ${candidatePath}` };
      }
      targetVaultBuffer = fs.readFileSync(candidatePath);
      sourcePath = candidatePath;
    }

    if (!targetVaultBuffer || targetVaultBuffer.length === 0) {
      throw { statusCode: 400, message: 'No encrypted .dccvault file provided for decryption.' };
    }

    const { rawBuffer, header, metadata } = this.decryptAndDecompressVaultContainer(targetVaultBuffer, vaultPin);
    const computedHash = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    const cleanName = (metadata.originalFileName || (fileName ? fileName.replace(/\.dccvault$/i, '') : 'Decrypted_Document.pdf'));
    const mimeType = metadata.mimeType || (cleanName.toLowerCase().endsWith('.png') ? 'image/png' : cleanName.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'application/pdf');

    await this.logAudit({
      userId,
      action: 'VAULT_LOCAL_FILE_DECRYPTED',
      documentTitle: metadata.title || cleanName,
      details: {
        sourcePath,
        algorithm: header.algorithm,
        originalSizeBytes: rawBuffer.length,
        encryptedSizeBytes: targetVaultBuffer.length,
        sha256Hash: computedHash,
      },
      result: 'SUCCESS',
      ipAddress: ip,
      userAgent,
    });

    return {
      decryptedFileName: cleanName,
      title: metadata.title || cleanName,
      mimeType,
      originalSizeBytes: rawBuffer.length,
      encryptedSizeBytes: targetVaultBuffer.length,
      algorithm: header.algorithm || 'GZIP+AES-256-GCM-PBKDF2',
      sha256Hash: computedHash,
      base64Data: rawBuffer.toString('base64'),
      localStoragePath: sourcePath,
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

    // Admin (SUPER_ADMIN) and Liaison (VAULT_MANAGER) have full view of Vault documents
    if (vaultRole !== 'SUPER_ADMIN' && vaultRole !== 'VAULT_MANAGER') {
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
      const canDelete = isSuper || isManager || isOwner || !!userPerm?.canDelete;

      let encryptedDiskSize = Number(doc.fileSizeBytes);
      try {
        if (fs.existsSync(doc.storageKey)) {
          encryptedDiskSize = fs.statSync(doc.storageKey).size;
        }
      } catch {}

      return {
        id: doc.id,
        title: doc.title,
        folder: doc.folder,
        documentType: doc.documentType,
        fileSizeBytes: Number(doc.fileSizeBytes),
        encryptedDiskSizeBytes: encryptedDiskSize,
        localStoragePath: doc.storageKey,
        isCompressedEncrypted: doc.storageKey.endsWith('.dccvault'),
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
      localStoragePath: doc.storageKey,
      permissions: {
        canRead: true,
        canPreview: isSuper || isManager || isOwner || !!userPerm?.canPreview,
        canDownload: isSuper || isManager || isOwner || !!userPerm?.canDownload,
        canEdit: isSuper || isManager || isOwner || !!userPerm?.canEdit,
        canDelete: isSuper || isManager || isOwner || !!userPerm?.canDelete,
      },
    };
  }

  async getDocumentStream(
    documentId: string,
    userId: string,
    vaultRole: string,
    type: 'PREVIEW' | 'DOWNLOAD',
    ip?: string,
    userAgent?: string,
    pin?: string,
    rawEncrypted = false
  ): Promise<{ stream: Readable; title: string; size: number; contentType: string }> {
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
      throw { statusCode: 404, message: 'Physical vault file not found on Local Storage.' };
    }

    const diskBuffer = fs.readFileSync(doc.storageKey);

    // If rawEncrypted is requested, stream the raw .dccvault file directly
    if (rawEncrypted) {
      return {
        stream: Readable.from(diskBuffer),
        title: path.basename(doc.storageKey),
        size: diskBuffer.length,
        contentType: 'application/octet-stream',
      };
    }

    // Zero-Disk Plaintext Decryption + Decompression in RAM
    const { rawBuffer, metadata } = this.decryptAndDecompressVaultContainer(diskBuffer, pin);

    let contentType = metadata?.mimeType || 'application/pdf';
    const cleanFileName = metadata?.originalFileName || path.basename(doc.storageKey || '').replace(/\.dccvault$/i, '') || `${doc.title}.pdf`;
    const ext = path.extname(cleanFileName).toLowerCase();
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
      stream: Readable.from(rawBuffer),
      title: cleanFileName,
      size: rawBuffer.length,
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
