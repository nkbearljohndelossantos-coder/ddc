import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveData } from '../lib/logger.js';
import { validateWebhookUrl } from '../modules/integrations/webhooks/webhook.ssrf.js';
import { LocalObjectStorageProvider } from '../lib/storage/LocalObjectStorageProvider.js';

describe('Phase 20: Security Penetration Hardening & Defense Tests', () => {
  // =========================================================================
  // 1. SSRF & CLOUD METADATA PENETRATION DEFENSE
  // =========================================================================
  describe('1. Advanced SSRF Defense Matrix', () => {
    it('should reject all IPv4/IPv6 loopbacks, private subnets, and cloud metadata variants', () => {
      const forbiddenTargets = [
        'http://127.0.0.1:8080/admin',
        'http://localhost:3000/api',
        'http://[::1]:9000',
        'http://0.0.0.0:80',
        'http://169.254.169.254/latest/user-data',
        'http://169.254.1.1/metadata',
        'http://10.10.10.10/private',
        'http://172.16.5.5:443',
        'http://192.168.0.1:8080',
      ];

      for (const target of forbiddenTargets) {
        const check = validateWebhookUrl(target);
        assert.strictEqual(check.isValid, false, `SSRF target ${target} must be rejected`);
      }
    });

    it('should permit valid public HTTPS destinations', () => {
      const allowed = validateWebhookUrl('https://api.verified-enterprise-partner.com/v1/webhook');
      assert.strictEqual(allowed.isValid, true);
    });
  });

  // =========================================================================
  // 2. PATH TRAVERSAL & STORAGE ISOLATION
  // =========================================================================
  describe('2. Path Traversal & Escaped Storage Defense', () => {
    const storage = new LocalObjectStorageProvider('./tmp/penetration_test_storage');

    it('should reject path traversal, relative parent paths, and escape sequences', async () => {
      const maliciousKeys = [
        '../../../../etc/passwd',
        '..\\..\\..\\windows\\win.ini',
        'sub/../../secret.key',
      ];

      for (const key of maliciousKeys) {
        await assert.rejects(
          async () => {
            await storage.getObject(key);
          },
          /traversal/i
        );
      }
    });
  });

  // =========================================================================
  // 3. ZERO SECRET LEAKAGE AUDIT
  // =========================================================================
  describe('3. Multi-Layer Secret Scrubbing Audit', () => {
    it('should deeply scrub passwords, JWT tokens, and private keys from complex structures', () => {
      const structure = {
        name: 'DCC_PRODUCTION_CONFIG',
        credentials: {
          password: 'SuperSecret123!',
          jwtToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
          apiKey: 'key_live_987654321',
        },
        metadata: {
          safeProperty: 'Active',
        },
      };

      const sanitized = redactSensitiveData(structure);
      assert.strictEqual(sanitized.credentials.password, '[REDACTED]');
      assert.strictEqual(sanitized.credentials.jwtToken, '[REDACTED]');
      assert.strictEqual(sanitized.credentials.apiKey, '[REDACTED]');
      assert.strictEqual(sanitized.metadata.safeProperty, 'Active');
    });
  });
});
