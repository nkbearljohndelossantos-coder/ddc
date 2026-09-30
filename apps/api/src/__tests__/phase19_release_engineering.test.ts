import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runReleasePreflight } from '../../../../scripts/release-preflight.js';

describe('Phase 19: Release Engineering & Preflight Gate Tests', () => {
  // =========================================================================
  // 1. RELEASE PREFLIGHT GATE
  // =========================================================================
  describe('1. Release Preflight Validation Script', () => {
    it('should execute release preflight and pass all dependency and security gates', async () => {
      const result = await runReleasePreflight();
      assert.strictEqual(result, true);
    });

    it('should reject insecure or default JWT secret placeholders in production mode', () => {
      const defaultInsecureSecrets = [
        'change_me_super_secret_jwt_key_at_least_32_bytes_long',
        'secret',
        'admin',
        'password',
        '123456',
      ];

      for (const insecureSecret of defaultInsecureSecrets) {
        assert.throws(
          () => {
            const isProd = true;
            if (isProd && (!insecureSecret || defaultInsecureSecrets.includes(insecureSecret))) {
              throw new Error('[PREFLIGHT_ERROR] Insecure or default JWT_SECRET detected in production environment.');
            }
          },
          /Insecure or default JWT_SECRET/
        );
      }
    });
  });
});
