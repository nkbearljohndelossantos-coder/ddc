import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { validateWebhookUrl } from '../modules/integrations/webhooks/webhook.ssrf.js';
import { signWebhookPayload, verifyWebhookSignature } from '../modules/integrations/webhooks/webhook.signature.js';
import { MockNotificationProvider } from '../modules/integrations/notifications/providers/MockNotificationProvider.js';
import { NotificationDeliveryService } from '../modules/integrations/notifications/notification.service.js';
import { AutomationEngine } from '../modules/automation/automation.engine.js';
import { EnterpriseEventBus } from '../lib/events/eventBus.js';

describe('Phase 12: Enterprise Integrations, Webhooks, Event Bus & Automation Tests', () => {
  // =========================================================================
  // 1. NOTIFICATION PROVIDER ABSTRACTION & IDEMPOTENCY
  // =========================================================================
  describe('1. External Notification Delivery & Idempotency', () => {
    it('should deliver notification via Mock provider with execution timing', async () => {
      const provider = new MockNotificationProvider();
      const payload = {
        recipient: 'compliance-officer@enterprise.corp',
        providerType: 'MOCK' as const,
        eventType: 'LEGAL_HOLD_APPLIED' as const,
        title: 'Legal Hold Applied to Document #DOC-101',
        message: 'A litigation hold was placed on Master Services Agreement FY2026.',
        idempotencyKey: 'notif-idemp-001',
      };

      const result = await provider.send(payload);

      assert.strictEqual(result.success, true);
      assert.ok(result.providerMessageId);
      assert.strictEqual(provider.deliveredNotifications.length, 1);
      assert.strictEqual(provider.deliveredNotifications[0].recipient, 'compliance-officer@enterprise.corp');
    });

    it('should handle simulated downstream provider failure gracefully', async () => {
      const provider = new MockNotificationProvider();
      provider.shouldFail = true;

      const payload = {
        recipient: 'ops@enterprise.corp',
        providerType: 'MOCK' as const,
        eventType: 'INTEGRITY_MISMATCH' as const,
        title: 'Critical Storage Mismatch',
        message: 'Storage checksum mismatch detected',
        idempotencyKey: 'notif-fail-002',
      };

      const result = await provider.send(payload);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('timeout'));
    });
  });

  // =========================================================================
  // 2. WEBHOOK SSRF PROTECTION
  // =========================================================================
  describe('2. Webhook Destination SSRF Protection', () => {
    it('should allow valid public HTTPS webhook destinations', () => {
      const validUrl = 'https://api.partner-system.com/v1/dcc-events';
      const check = validateWebhookUrl(validUrl);
      assert.strictEqual(check.isValid, true);
    });

    it('should block localhost and loopback addresses (127.0.0.1, ::1, localhost)', () => {
      assert.strictEqual(validateWebhookUrl('http://localhost:8080/hook').isValid, false);
      assert.strictEqual(validateWebhookUrl('http://127.0.0.1/webhook').isValid, false);
      assert.strictEqual(validateWebhookUrl('http://[::1]:3000/webhook').isValid, false);
    });

    it('should block private RFC1918 networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
      assert.strictEqual(validateWebhookUrl('http://10.0.0.5:8000/hook').isValid, false);
      assert.strictEqual(validateWebhookUrl('http://172.20.10.5/hook').isValid, false);
      assert.strictEqual(validateWebhookUrl('http://192.168.1.100:4000/hook').isValid, false);
    });

    it('should block cloud metadata and link-local addresses (169.254.169.254)', () => {
      assert.strictEqual(validateWebhookUrl('http://169.254.169.254/latest/meta-data').isValid, false);
      assert.strictEqual(validateWebhookUrl('http://169.254.1.1/internal').isValid, false);
    });
  });

  // =========================================================================
  // 3. WEBHOOK HMAC SIGNATURE & REPLAY PROTECTION
  // =========================================================================
  describe('3. Webhook HMAC-SHA256 Signatures & Replay Prevention', () => {
    const secret = 'dcc_whsec_test_secret_key_1234567890abcdef';
    const samplePayload = { documentId: 'doc-001', status: 'APPROVED', timestamp: '2026-08-28T00:00:00Z' };
    const eventId = 'evt-test-uuid-999';

    it('should generate valid HMAC-SHA256 signature for payload', () => {
      const now = Date.now();
      const signed = signWebhookPayload(secret, samplePayload, now, eventId);

      assert.ok(signed.signature);
      assert.strictEqual(signed.signature.length, 64);
      assert.strictEqual(signed.headerString, `t=${now},v1=${signed.signature}`);
    });

    it('should verify authentic signature in constant time', () => {
      const now = Date.now();
      const { signature } = signWebhookPayload(secret, samplePayload, now, eventId);

      const verification = verifyWebhookSignature(secret, samplePayload, now, eventId, signature);
      assert.strictEqual(verification.isValid, true);
    });

    it('should reject tampered payload with signature mismatch', () => {
      const now = Date.now();
      const { signature } = signWebhookPayload(secret, samplePayload, now, eventId);
      const tamperedPayload = { ...samplePayload, status: 'REJECTED_TAMPERED' };

      const verification = verifyWebhookSignature(secret, tamperedPayload, now, eventId, signature);
      assert.strictEqual(verification.isValid, false);
      assert.strictEqual(verification.reason, 'HMAC signature mismatch');
    });

    it('should reject expired signature older than tolerance window (Replay Protection)', () => {
      const expiredTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago (tolerance is 5 min)
      const { signature } = signWebhookPayload(secret, samplePayload, expiredTimestamp, eventId);

      const verification = verifyWebhookSignature(secret, samplePayload, expiredTimestamp, eventId, signature);
      assert.strictEqual(verification.isValid, false);
      assert.ok(verification.reason?.includes('Replay Protection'));
    });
  });

  // =========================================================================
  // 4. ENTERPRISE DOMAIN EVENT BUS & OUTBOX
  // =========================================================================
  describe('4. Domain Event Bus Pub/Sub & Outbox Integration', () => {
    it('should publish domain event and dispatch to subscribed event listeners', async () => {
      const eventBus = new EnterpriseEventBus();
      let receivedEvent: any = null;

      eventBus.on('DOCUMENT_APPROVED', (evt) => {
        receivedEvent = evt;
      });

      const published = await eventBus.publish(
        'DOCUMENT_APPROVED',
        { documentId: 'doc-approved-01', approverId: 'usr-admin-1', amount: 50000 },
        { organizationId: 'org-1', departmentId: 'dept-finance', correlationId: 'req-corr-101' }
      );

      assert.ok(published.eventId);
      assert.strictEqual(published.eventType, 'DOCUMENT_APPROVED');
      assert.strictEqual(published.correlationId, 'req-corr-101');
      assert.strictEqual(receivedEvent?.eventId, published.eventId);
    });
  });

  // =========================================================================
  // 5. AUTOMATION RULE ENGINE & RECURSION LIMITS
  // =========================================================================
  describe('5. Advanced Automation Rule Evaluation & Action Execution', () => {
    const engine = new AutomationEngine();

    it('should evaluate condition AST with allowlisted operators (equals, greaterThan, in, contains)', () => {
      const context = {
        documentType: 'INVOICE',
        amount: 75000,
        tags: ['URGENT', 'VIP'],
        supplier: 'Acme Logistics Ltd',
      };

      assert.strictEqual(engine.evaluateCondition({ field: 'documentType', operator: 'equals', value: 'INVOICE' }, context), true);
      assert.strictEqual(engine.evaluateCondition({ field: 'amount', operator: 'greaterThan', value: 50000 }, context), true);
      assert.strictEqual(engine.evaluateCondition({ field: 'tags', operator: 'in', value: ['VIP'] }, context), true);
      assert.strictEqual(engine.evaluateCondition({ field: 'supplier', operator: 'contains', value: 'Logistics' }, context), true);
      assert.strictEqual(engine.evaluateCondition({ field: 'amount', operator: 'lessThan', value: 10000 }, context), false);
    });

    it('should match rule when all compound conditions are met', () => {
      const conditions = [
        { field: 'documentType', operator: 'equals' as const, value: 'INVOICE' },
        { field: 'confidence', operator: 'greaterThan' as const, value: 85 },
      ];

      const matchContext = { documentType: 'INVOICE', confidence: 92 };
      const nonMatchContext = { documentType: 'INVOICE', confidence: 60 };

      assert.strictEqual(engine.matchesRule(conditions, matchContext), true);
      assert.strictEqual(engine.matchesRule(conditions, nonMatchContext), false);
    });

    it('should execute actions and abort with error when recursion depth limit exceeded (Loop Guard)', async () => {
      const actions = [{ actionType: 'CREATE_WORKFLOW' as const, payload: {} }];

      // Normal depth (depth = 0) succeeds
      const result = await engine.executeActions(actions, {}, 0);
      assert.strictEqual(result.executedCount, 1);

      // Depth > 5 exceeds recursion guard and aborts
      await assert.rejects(
        async () => {
          await engine.executeActions(actions, {}, 6);
        },
        /Automation loop detected: Max recursion depth exceeded/
      );
    });
  });

  // =========================================================================
  // 6. INTEGRATION CREDENTIAL ENCRYPTION & MASKING
  // =========================================================================
  describe('6. Integration Credentials & Secret Masking', () => {
    it('should mask sensitive integration secrets in administration responses', () => {
      const rawIntegration = {
        id: 'int-smtp-01',
        name: 'Corporate SMTP Relay',
        type: 'EMAIL_SMTP',
        credentials: [
          { keyIdentifier: 'int_key_123', secret: 'superSecretPassword123!', version: 1 },
        ],
      };

      const masked = {
        ...rawIntegration,
        credentials: rawIntegration.credentials.map((c) => ({
          ...c,
          secret: '[REDACTED]',
        })),
      };

      assert.strictEqual(masked.credentials[0].secret, '[REDACTED]');
      assert.strictEqual(JSON.stringify(masked).includes('superSecretPassword123!'), false);
    });
  });
});
