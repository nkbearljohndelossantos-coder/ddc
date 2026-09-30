import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveData } from '../lib/logger.js';
import { validateWebhookUrl } from '../modules/integrations/webhooks/webhook.ssrf.js';
import { LocalObjectStorageProvider } from '../lib/storage/LocalObjectStorageProvider.js';

describe('Phase 18: Security Audit & Hardening Tests', () => {
  // =========================================================================
  // 1. SSRF & CLOUD METADATA PROTECTION
  // =========================================================================
  describe('1. SSRF & Private Network Protection', () => {
    it('should block SSRF attempts targeting cloud metadata endpoints', () => {
      assert.strictEqual(validateWebhookUrl('http://169.254.169.254/latest/meta-data/').isValid, false);
      assert.strictEqual(validateWebhookUrl('http://127.0.0.1:8080/internal/admin').isValid, false);
      assert.strictEqual(validateWebhookUrl('http://10.0.0.1/private/api').isValid, false);
      assert.strictEqual(validateWebhookUrl('http://192.168.1.50/hook').isValid, false);
    });

    it('should allow valid public HTTPS webhook targets', () => {
      assert.strictEqual(validateWebhookUrl('https://api.enterprise-partner.com/webhook').isValid, true);
    });
  });

  // =========================================================================
  // 2. PATH TRAVERSAL & STORAGE ISOLATION
  // =========================================================================
  describe('2. Path Traversal & File Boundary Protection', () => {
    const storage = new LocalObjectStorageProvider('./tmp/secure_storage_test');

    it('should reject keys with directory traversal patterns', async () => {
      await assert.rejects(
        async () => {
          await storage.getObject('../../../etc/passwd');
        },
        /traversal/i
      );
    });
  });

  // =========================================================================
  // 3. SENSITIVE DATA REDACTION AUDIT
  // =========================================================================
  describe('3. Application-Wide Secret Redaction Audit', () => {
    it('should recursively redact secrets, JWT tokens, and private keys from objects', () => {
      const payload = {
        username: 'admin',
        password: 'SuperSecretPassword123!',
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
        nested: {
          apiKey: 'sec_live_987654321',
          privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...',
          regularField: 'safeValue',
        },
      };

      const sanitized = redactSensitiveData(payload);
      assert.strictEqual(sanitized.password, '[REDACTED]');
      assert.strictEqual(sanitized.token, '[REDACTED]');
      assert.strictEqual(sanitized.nested.apiKey, '[REDACTED]');
      assert.strictEqual(sanitized.nested.privateKey, '[REDACTED]');
      assert.strictEqual(sanitized.nested.regularField, 'safeValue');
    });
  });
});
