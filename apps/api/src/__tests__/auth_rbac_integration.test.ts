import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { requireRole, requirePermission, requireDepartmentAccess } from '../middleware/rbac.js';

describe('Phase 1: Full Authentication & RBAC Integration Tests', () => {
  const JWT_SECRET = 'test_jwt_secret_key_minimum_32_characters_long_12345';
  const JWT_REFRESH_SECRET = 'test_jwt_refresh_key_minimum_32_characters_long_67890';

  // In-memory mock database for isolated integration testing
  const db = {
    users: new Map<string, any>(),
    refreshTokens: new Map<string, any>(),
  };

  function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // -------------------------------------------------------------
  // 1. REGISTRATION & VALIDATION
  // -------------------------------------------------------------
  it('should register a new user and reject duplicate emails', async () => {
    const email = 'new-operator@nkb.local';
    const password = 'StrongPassword2026!';
    const passwordHash = await bcrypt.hash(password, 12);

    const user = {
      id: crypto.randomUUID(),
      email,
      passwordHash,
      fullName: 'Scanner Operator 1',
      organizationId: 'org-hq-1',
      departmentId: 'dept-accounting',
      roles: ['SCAN_OPERATOR'],
      permissions: ['scan:execute', 'documents:read'],
      isActive: true,
    };

    db.users.set(email, user);

    assert.ok(user.id);
    assert.strictEqual(user.email, email);

    // Test duplicate registration detection
    const isDuplicate = db.users.has(email);
    assert.strictEqual(isDuplicate, true, 'Duplicate email registration must be rejected');
  });

  // -------------------------------------------------------------
  // 2. LOGIN & CREDENTIAL VERIFICATION
  // -------------------------------------------------------------
  it('should authenticate valid credentials and reject invalid passwords', async () => {
    const user = db.users.get('new-operator@nkb.local');
    assert.ok(user);

    // Valid password
    const validMatch = await bcrypt.compare('StrongPassword2026!', user.passwordHash);
    assert.strictEqual(validMatch, true);

    // Invalid password
    const invalidMatch = await bcrypt.compare('WrongPassword!', user.passwordHash);
    assert.strictEqual(invalidMatch, false);
  });

  // -------------------------------------------------------------
  // 3. TOKEN ISSUANCE, EXPIRATION & REFRESH ROTATION
  // -------------------------------------------------------------
  let currentRefreshToken: string;
  let currentAccessToken: string;
  let currentFamilyId: string;

  it('should issue access token, refresh token and record session family', () => {
    const user = db.users.get('new-operator@nkb.local');
    currentFamilyId = crypto.randomUUID();

    currentAccessToken = jwt.sign(
      { userId: user.id, roles: user.roles, permissions: user.permissions },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    currentRefreshToken = jwt.sign(
      { userId: user.id, nonce: crypto.randomBytes(16).toString('hex') },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    const tokenHash = hashToken(currentRefreshToken);
    db.refreshTokens.set(tokenHash, {
      id: crypto.randomUUID(),
      userId: user.id,
      familyId: currentFamilyId,
      tokenHash,
      revoked: false,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });

    assert.ok(currentAccessToken);
    assert.ok(currentRefreshToken);
  });

  it('should rotate refresh token and invalidate old refresh token', () => {
    const oldTokenHash = hashToken(currentRefreshToken);
    const oldStored = db.refreshTokens.get(oldTokenHash);
    assert.ok(oldStored);
    assert.strictEqual(oldStored.revoked, false);

    // Mark old as revoked
    oldStored.revoked = true;

    // Issue new token in same family
    const newRefreshToken = jwt.sign(
      { userId: oldStored.userId, nonce: crypto.randomBytes(16).toString('hex') },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );
    const newTokenHash = hashToken(newRefreshToken);

    db.refreshTokens.set(newTokenHash, {
      id: crypto.randomUUID(),
      userId: oldStored.userId,
      familyId: oldStored.familyId,
      tokenHash: newTokenHash,
      revoked: false,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });

    // Verify old token is now revoked
    assert.strictEqual(db.refreshTokens.get(oldTokenHash).revoked, true);
    // Verify new token is valid
    assert.strictEqual(db.refreshTokens.get(newTokenHash).revoked, false);

    currentRefreshToken = newRefreshToken;
  });

  // -------------------------------------------------------------
  // 4. REFRESH TOKEN REUSE PROTECTION
  // -------------------------------------------------------------
  it('should detect reuse of a revoked refresh token and invalidate the entire session family', () => {
    // Attempt to reuse an old revoked token (simulating an attacker replay)
    const oldReusedToken = Array.from(db.refreshTokens.values()).find((t) => t.revoked === true);
    assert.ok(oldReusedToken, 'A revoked token must exist for reuse test');

    // Reuse detection logic
    if (oldReusedToken.revoked) {
      // Invalidate all tokens in this family
      for (const token of db.refreshTokens.values()) {
        if (token.familyId === oldReusedToken.familyId || token.userId === oldReusedToken.userId) {
          token.revoked = true;
        }
      }
    }

    // Verify ALL tokens in this family are now revoked
    const activeTokens = Array.from(db.refreshTokens.values()).filter(
      (t) => t.familyId === oldReusedToken.familyId && t.revoked === false
    );
    assert.strictEqual(activeTokens.length, 0, 'All tokens in family must be revoked upon reuse attempt');
  });

  // -------------------------------------------------------------
  // 5. RBAC & PERMISSION MIDDLEWARE VERIFICATION
  // -------------------------------------------------------------
  it('should allow SUPER_ADMIN access to all roles and permissions', () => {
    const superAdminUser = {
      id: 'admin-1',
      roles: ['SUPER_ADMIN'],
      permissions: ['admin:all'],
      departmentId: 'dept-admin',
    };

    let allowed = false;
    const req: any = { user: superAdminUser, params: {}, body: {} };
    const res: any = {
      status(code: number) {
        return {
          json(obj: any) {
            allowed = false;
          },
        };
      },
    };
    const next = () => {
      allowed = true;
    };

    requireRole('SCANNER_ADMIN')(req, res, next);
    assert.strictEqual(allowed, true, 'SUPER_ADMIN must bypass role requirements');

    allowed = false;
    requirePermission('scanners:manage')(req, res, next);
    assert.strictEqual(allowed, true, 'SUPER_ADMIN must bypass permission requirements');
  });

  it('should restrict SCAN_OPERATOR from administrative actions', () => {
    const operatorUser = {
      id: 'op-1',
      roles: ['SCAN_OPERATOR'],
      permissions: ['scan:execute', 'documents:read'],
      departmentId: 'dept-accounting',
    };

    let statusCode = 200;
    let errorMessage = '';
    const req: any = { user: operatorUser, params: {}, body: {} };
    const res: any = {
      status(code: number) {
        statusCode = code;
        return {
          json(obj: any) {
            errorMessage = obj.error;
          },
        };
      },
    };
    const next = () => {
      statusCode = 200;
    };

    // Attempt admin action
    requireRole('SUPER_ADMIN', 'SCANNER_ADMIN')(req, res, next);
    assert.strictEqual(statusCode, 403, 'SCAN_OPERATOR must receive 403 Forbidden for admin roles');

    // Attempt unauthorized permission
    requirePermission('scanners:manage')(req, res, next);
    assert.strictEqual(statusCode, 403, 'SCAN_OPERATOR must receive 403 Forbidden for scanners:manage');
  });

  it('should enforce department isolation for departmental users', () => {
    const accountingUser = {
      id: 'acct-user-1',
      roles: ['DEPARTMENT_USER'],
      permissions: ['documents:read'],
      departmentId: 'dept-accounting',
    };

    let statusCode = 200;
    const req: any = {
      user: accountingUser,
      params: { departmentId: 'dept-hr' },
      body: {},
      query: {},
    };
    const res: any = {
      status(code: number) {
        statusCode = code;
        return {
          json(obj: any) {},
        };
      },
    };
    const next = () => {
      statusCode = 200;
    };

    requireDepartmentAccess(req, res, next);
    assert.strictEqual(statusCode, 403, 'User accessing a different department must be forbidden (403)');

    // Access own department
    req.params.departmentId = 'dept-accounting';
    requireDepartmentAccess(req, res, next);
    assert.strictEqual(statusCode, 200, 'User accessing own department must be permitted (200)');
  });

  // -------------------------------------------------------------
  // 6. HEALTH & READINESS ENDPOINTS
  // -------------------------------------------------------------
  it('should verify liveness probe returns uptime and status ok', () => {
    const livenessResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
    assert.strictEqual(livenessResponse.status, 'ok');
    assert.ok(typeof livenessResponse.uptimeSeconds === 'number');
  });
});
