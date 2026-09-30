import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { loginSchema, registerUserSchema } from '../modules/auth/auth.schema.js';

describe('Phase 1: Foundation & Security Tests', () => {
  const JWT_SECRET = 'test_jwt_secret_key_minimum_32_characters_long_12345';
  const JWT_REFRESH_SECRET = 'test_jwt_refresh_key_minimum_32_characters_long_67890';

  it('should hash and verify passwords using bcrypt', async () => {
    const rawPassword = 'Admin@NKB2026!Secure';
    const hash = await bcrypt.hash(rawPassword, 12);

    assert.ok(hash.startsWith('$2'));
    const isMatch = await bcrypt.compare(rawPassword, hash);
    assert.strictEqual(isMatch, true);

    const isWrong = await bcrypt.compare('WrongPassword', hash);
    assert.strictEqual(isWrong, false);
  });

  it('should sign and verify JWT access tokens with RBAC payload', () => {
    const payload = {
      userId: 'user-uuid-1234',
      roles: ['SUPER_ADMIN'],
      permissions: ['admin:all', 'scan:execute'],
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
    assert.ok(token);

    const decoded = jwt.verify(token, JWT_SECRET) as typeof payload;
    assert.strictEqual(decoded.userId, payload.userId);
    assert.deepStrictEqual(decoded.roles, ['SUPER_ADMIN']);
    assert.deepStrictEqual(decoded.permissions, ['admin:all', 'scan:execute']);
  });

  it('should compute cryptographic SHA-256 token hashes for refresh tokens', () => {
    const refreshToken = 'raw-refresh-token-value-xyz';
    const hash1 = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const hash2 = crypto.createHash('sha256').update(refreshToken).digest('hex');

    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
  });

  it('should validate valid and reject invalid login payloads with Zod', () => {
    const valid = loginSchema.safeParse({
      email: 'admin@nkb-scanning.local',
      password: 'password123',
    });
    assert.strictEqual(valid.success, true);

    const invalidEmail = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
    });
    assert.strictEqual(invalidEmail.success, false);

    const shortPassword = loginSchema.safeParse({
      email: 'admin@nkb-scanning.local',
      password: '123',
    });
    assert.strictEqual(shortPassword.success, false);
  });

  it('should validate valid register payloads with Zod', () => {
    const valid = registerUserSchema.safeParse({
      email: 'operator@nkb-scanning.local',
      password: 'StrongPassword123!',
      fullName: 'John Operator',
      organizationId: '11111111-1111-1111-1111-111111111111',
      roleNames: ['SCAN_OPERATOR'],
    });
    assert.strictEqual(valid.success, true);
  });
});
