import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { vaultService } from '../modules/vault/vault.service.js';

describe('Private Vault Enterprise Security Module Tests', () => {
  let orgId: string;
  let superAdminUser: any;
  let vaultManagerUser: any;
  let vaultNormalUser: any;
  let unauthorizedUser: any;

  const superAdminPwd = 'SuperAdminPassword123!';
  const managerPwd = 'ManagerPassword123!';
  const normalUserPwd = 'NormalUserPassword123!';
  const unauthorizedPwd = 'UnauthorizedPassword123!';

  before(async () => {
    // 1. Create or find test organization
    const org = await prisma.organization.upsert({
      where: { code: 'VAULT_TEST_ORG' },
      create: { name: 'Vault Test Organization', code: 'VAULT_TEST_ORG' },
      update: {},
    });
    orgId = org.id;

    // 2. Roles
    const superRole = await prisma.role.upsert({
      where: { name: 'SUPER_ADMIN' },
      create: { name: 'SUPER_ADMIN', description: 'Super Administrator' },
      update: {},
    });

    const userRole = await prisma.role.upsert({
      where: { name: 'VIEWER' },
      create: { name: 'VIEWER', description: 'Regular Viewer' },
      update: {},
    });

    // 3. Create Test Users with known hashed passwords
    const superHash = await bcrypt.hash(superAdminPwd, 10);
    superAdminUser = await prisma.user.upsert({
      where: { email: 'vault_superadmin@test.local' },
      create: {
        email: 'vault_superadmin@test.local',
        fullName: 'Vault Super Admin',
        passwordHash: superHash,
        organizationId: orgId,
        isActive: true,
      },
      update: { passwordHash: superHash, isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: superAdminUser.id, roleId: superRole.id } },
      create: { userId: superAdminUser.id, roleId: superRole.id },
      update: {},
    });

    const managerHash = await bcrypt.hash(managerPwd, 10);
    vaultManagerUser = await prisma.user.upsert({
      where: { email: 'vault_manager@test.local' },
      create: {
        email: 'vault_manager@test.local',
        fullName: 'Vault Manager Officer',
        passwordHash: managerHash,
        organizationId: orgId,
        isActive: true,
      },
      update: { passwordHash: managerHash, isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: vaultManagerUser.id, roleId: userRole.id } },
      create: { userId: vaultManagerUser.id, roleId: userRole.id },
      update: {},
    });

    const normalHash = await bcrypt.hash(normalUserPwd, 10);
    vaultNormalUser = await prisma.user.upsert({
      where: { email: 'vault_user@test.local' },
      create: {
        email: 'vault_user@test.local',
        fullName: 'Authorized Vault User',
        passwordHash: normalHash,
        organizationId: orgId,
        isActive: true,
      },
      update: { passwordHash: normalHash, isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: vaultNormalUser.id, roleId: userRole.id } },
      create: { userId: vaultNormalUser.id, roleId: userRole.id },
      update: {},
    });

    const unauthHash = await bcrypt.hash(unauthorizedPwd, 10);
    unauthorizedUser = await prisma.user.upsert({
      where: { email: 'vault_unauthorized@test.local' },
      create: {
        email: 'vault_unauthorized@test.local',
        fullName: 'Unauthorized Staff',
        passwordHash: unauthHash,
        organizationId: orgId,
        isActive: true,
      },
      update: { passwordHash: unauthHash, isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: unauthorizedUser.id, roleId: userRole.id } },
      create: { userId: unauthorizedUser.id, roleId: userRole.id },
      update: {},
    });

    // 4. Authorize manager & normal user via vaultService
    await vaultService.authorizeUser({
      targetUserId: vaultManagerUser.id,
      vaultRole: 'VAULT_MANAGER',
      authorizedById: superAdminUser.id,
      notes: 'Initial test authorization for manager',
    });

    await vaultService.authorizeUser({
      targetUserId: vaultNormalUser.id,
      vaultRole: 'VAULT_USER',
      authorizedById: superAdminUser.id,
      notes: 'Initial test authorization for viewer',
    });
  });

  after(async () => {
    // Cleanup sessions, authorizations, and test documents
    try {
      await prisma.vaultAccessSession.deleteMany({
        where: { userId: { in: [superAdminUser.id, vaultManagerUser.id, vaultNormalUser.id, unauthorizedUser.id] } },
      });
      await prisma.vaultDocumentPermission.deleteMany({});
      await prisma.vaultDocument.deleteMany({
        where: { ownerId: { in: [superAdminUser.id, vaultManagerUser.id, vaultNormalUser.id, unauthorizedUser.id] } },
      });
      await prisma.vaultAuthorization.deleteMany({
        where: { userId: { in: [superAdminUser.id, vaultManagerUser.id, vaultNormalUser.id, unauthorizedUser.id] } },
      });
    } catch (e) {}
  });

  // --- Requirement 1 & 2: Access Control & Authorization ---
  it('1. should deny Private Vault access to unauthorized user (403 ACCESS DENIED)', async () => {
    const authCheck = await vaultService.checkUserAuthorization(unauthorizedUser.id);
    assert.strictEqual(authCheck.authorized, false);
    assert.strictEqual(authCheck.status, 'UNAUTHORIZED');

    // Attempting to unlock must throw 403 and log audit event
    await assert.rejects(
      async () => {
        await vaultService.unlockVault(unauthorizedUser.id, unauthorizedPwd, '127.0.0.1', 'TestRunner');
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes('403 ACCESS DENIED'));
        return true;
      }
    );

    // Verify audit log
    const auditLogs = await prisma.vaultAuditLog.findMany({
      where: { userId: unauthorizedUser.id, action: 'VAULT_ACCESS_DENIED' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    assert.strictEqual(auditLogs.length, 1);
    assert.strictEqual(auditLogs[0].result, 'DENIED');
  });

  it('2. should verify DCC password and reject invalid password attempt', async () => {
    await assert.rejects(
      async () => {
        await vaultService.unlockVault(vaultManagerUser.id, 'WrongPassword123!', '127.0.0.1', 'TestRunner');
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 401);
        assert.ok(err.message.includes('Invalid password'));
        return true;
      }
    );

    // Verify audit log recorded failure without logging password
    const failLog = await prisma.vaultAuditLog.findFirst({
      where: { userId: vaultManagerUser.id, action: 'VAULT_PASSWORD_VERIFICATION_FAILED' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(failLog);
    assert.strictEqual(failLog.result, 'FAILED');
    // Ensure password is NEVER stored
    assert.strictEqual(JSON.stringify(failLog).includes('WrongPassword123!'), false);
  });

  it('3. should verify correct DCC password, grant access, and issue a 15-min session token', async () => {
    const unlock = await vaultService.unlockVault(vaultManagerUser.id, managerPwd, '127.0.0.1', 'TestRunner');
    assert.ok(unlock.sessionToken);
    assert.strictEqual(unlock.vaultRole, 'VAULT_MANAGER');
    assert.ok(unlock.expiresAt > new Date());

    // Verify session in database
    const session = await prisma.vaultAccessSession.findUnique({
      where: { sessionToken: unlock.sessionToken },
    });
    assert.ok(session);
    assert.strictEqual(session.isActive, true);
    assert.strictEqual(session.userId, vaultManagerUser.id);

    // Verify audit events
    const successLog = await prisma.vaultAuditLog.findFirst({
      where: { userId: vaultManagerUser.id, action: 'VAULT_PASSWORD_VERIFICATION_SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(successLog);

    const accessLog = await prisma.vaultAuditLog.findFirst({
      where: { userId: vaultManagerUser.id, action: 'VAULT_ACCESS_GRANTED' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(accessLog);
  });

  // --- Requirement 6: Auto-Lock & Sliding Window ---
  it('4. should auto-lock session when 15-minute inactivity expires', async () => {
    // Create an expired session
    const expiredToken = crypto.randomBytes(32).toString('hex');
    await prisma.vaultAccessSession.create({
      data: {
        userId: vaultManagerUser.id,
        sessionToken: expiredToken,
        isActive: true,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        lastActivityAt: new Date(Date.now() - 16 * 60 * 1000),
      },
    });

    await assert.rejects(
      async () => {
        await vaultService.validateSession(expiredToken, '127.0.0.1');
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 401);
        assert.ok(err.message.includes('15-minute inactivity'));
        return true;
      }
    );

    // Session must be marked isActive: false
    const sessionInDb = await prisma.vaultAccessSession.findUnique({
      where: { sessionToken: expiredToken },
    });
    assert.strictEqual(sessionInDb?.isActive, false);

    // Auto-lock audit event recorded
    const autoLockLog = await prisma.vaultAuditLog.findFirst({
      where: { userId: vaultManagerUser.id, action: 'VAULT_AUTO_LOCKED' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(autoLockLog);
  });

  // --- Requirement 3 & 4: Super Admin Revocation Immediate Effect ---
  it('5. should immediately terminate active session and deny access upon revocation by Super Admin', async () => {
    // 1. User unlocks and has active token
    const unlock = await vaultService.unlockVault(vaultNormalUser.id, normalUserPwd);
    const validationBefore = await vaultService.validateSession(unlock.sessionToken);
    assert.strictEqual(validationBefore.valid, true);

    // 2. Super Admin revokes access
    await vaultService.revokeUser({
      targetUserId: vaultNormalUser.id,
      revokedById: superAdminUser.id,
      reason: 'Role audit revocation test',
    });

    // 3. User attempts to use active session token -> must be rejected immediately (403)
    await assert.rejects(
      async () => {
        await vaultService.validateSession(unlock.sessionToken);
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes('403 ACCESS DENIED'));
        return true;
      }
    );

    // 4. Verify revocation audit log
    const revokeLog = await prisma.vaultAuditLog.findFirst({
      where: { userId: superAdminUser.id, action: 'VAULT_USER_REVOKED' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(revokeLog);
  });

  // --- Requirement 8: Secure Document Storage, SHA-256, and CRUD ---
  it('6. should upload, stream preview, download, and delete confidential documents securely', async () => {
    // Re-authorize user for document tests
    await vaultService.authorizeUser({
      targetUserId: vaultManagerUser.id,
      vaultRole: 'VAULT_MANAGER',
      authorizedById: superAdminUser.id,
    });

    const fileContent = 'TOP SECRET EXECUTIVE AUDIT REPORT CONTENT - 2026';
    const fileBuffer = Buffer.from(fileContent, 'utf-8');
    const expectedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 1. Secure Upload
    const uploaded = await vaultService.uploadDocument({
      title: 'FY2026 Executive Financial Dossier',
      folder: '/Executive',
      documentType: 'FINANCIAL_AUDIT',
      fileBuffer,
      fileName: 'FY2026_Audit.txt',
      userId: vaultManagerUser.id,
      vaultRole: 'VAULT_MANAGER',
    });

    assert.ok(uploaded.id);
    assert.strictEqual(uploaded.sha256Hash, expectedHash);
    assert.strictEqual(uploaded.folder, '/Executive');
    assert.ok(fs.existsSync(uploaded.storageKey)); // Stored in isolated vault storage
    assert.strictEqual(uploaded.storageKey.includes('.server_object_storage'), true);

    // Verify upload audit log
    const uploadLog = await prisma.vaultAuditLog.findFirst({
      where: { documentId: uploaded.id, action: 'VAULT_DOCUMENT_UPLOADED' },
    });
    assert.ok(uploadLog);

    // 2. Stream Preview
    const preview = await vaultService.getDocumentStream(
      uploaded.id,
      vaultManagerUser.id,
      'VAULT_MANAGER',
      'PREVIEW'
    );
    assert.ok(preview.stream);
    assert.strictEqual(preview.contentType, 'text/plain');

    // 3. Stream Download
    const download = await vaultService.getDocumentStream(
      uploaded.id,
      vaultManagerUser.id,
      'VAULT_MANAGER',
      'DOWNLOAD'
    );
    assert.ok(download.stream);
    assert.strictEqual(download.size, fileBuffer.length);

    // 4. Secure Deletion
    await vaultService.deleteDocument(
      uploaded.id,
      vaultManagerUser.id,
      'VAULT_MANAGER'
    );

    // Confirm physical file is purged and record is deleted
    assert.strictEqual(fs.existsSync(uploaded.storageKey), false);
    const checkDoc = await prisma.vaultDocument.findUnique({ where: { id: uploaded.id } });
    assert.strictEqual(checkDoc, null);

    // Verify delete audit log
    const deleteLog = await prisma.vaultAuditLog.findFirst({
      where: { documentTitle: 'FY2026 Executive Financial Dossier', action: 'VAULT_DOCUMENT_DELETED' },
    });
    assert.ok(deleteLog);
  });

  // --- Requirement 7: Audit Log Query & Sequencing ---
  it('7. should maintain an immutable audit trail queryable by Super Admin', async () => {
    const auditData = await vaultService.getAuditLogs({ limit: 50 });
    assert.ok(auditData.total > 0);
    assert.ok(Array.isArray(auditData.logs));
    assert.ok(auditData.logs.length > 0);

    const actions = auditData.logs.map((l) => l.action);
    // Must contain the vault actions triggered during test
    assert.ok(actions.includes('VAULT_ACCESS_DENIED'));
    assert.ok(actions.includes('VAULT_PASSWORD_VERIFICATION_FAILED'));
    assert.ok(actions.includes('VAULT_PASSWORD_VERIFICATION_SUCCESS'));
    assert.ok(actions.includes('VAULT_ACCESS_GRANTED'));
    assert.ok(actions.includes('VAULT_USER_REVOKED'));
  });

  // --- Requirement: Non-Interference with Regular DCC Documents ---
  it('8. should verify regular DCC document repository remains intact and independent', async () => {
    // Query normal documents table
    const normalDocCount = await prisma.document.count();
    assert.strictEqual(typeof normalDocCount, 'number');

    // Query normal departments
    const depts = await prisma.department.findMany();
    assert.ok(depts.length > 0);
  });
});
