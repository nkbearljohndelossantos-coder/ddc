import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveData } from '../lib/logger.js';
import { validateWebhookUrl } from '../modules/integrations/webhooks/webhook.ssrf.js';

describe('Phase 19: Security Release Gate & Vulnerability Hardening Tests', () => {
  // =========================================================================
  // 1. SECURITY RELEASE GATES
  // =========================================================================
  describe('1. Security Gate Validation Prior to Go-Live', () => {
    it('should scrub passwords, JWT tokens, and private keys recursively from output structures', () => {
      const configSnapshot = {
        app: 'DCC_PRODUCTION',
        database: {
          url: 'postgresql://postgres:SuperSecretPass123@db:5432/dcc_prod',
          password: 'SuperSecretPass123',
        },
        jwtToken: 'production_jwt_signing_key_32_bytes_long',
        publicSetting: 'ENABLE_OCR=true',
      };

      const sanitized = redactSensitiveData(configSnapshot);
      assert.strictEqual(sanitized.database.password, '[REDACTED]');
      assert.strictEqual(sanitized.jwtToken, '[REDACTED]');
      assert.strictEqual(sanitized.publicSetting, 'ENABLE_OCR=true');
    });

    it('should verify that all private subnets and metadata endpoints are blocked by SSRF gate', () => {
      const blockedTargets = [
        'http://169.254.169.254/latest/meta-data',
        'http://127.0.0.1:9000/minio/admin',
        'http://10.0.1.5/internal/metrics',
        'http://172.16.0.1:8080',
        'http://192.168.1.1',
      ];

      for (const target of blockedTargets) {
        assert.strictEqual(validateWebhookUrl(target).isValid, false, `Target ${target} must be blocked by SSRF gate`);
      }
    });
  });
});
