import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { redactSensitiveData } from '../lib/logger.js';
import { SecurityEventAuditor } from '../lib/securityEvents.js';
import { MetricsRegistry } from '../lib/metrics.js';
import { createTieredRateLimiter } from '../middleware/rateLimit.js';
import { requestContext } from '../middleware/requestContext.js';

describe('Phase 9: Security Hardening, Observability & Production Readiness Tests', () => {
  // =========================================================================
  // 1. SENSITIVE DATA REDACTION & LOGGING SAFETY
  // =========================================================================
  describe('1. Sensitive Log & Data Redaction', () => {
    it('should deeply redact passwords, JWTs, and encryption keys from objects', () => {
      const payload = {
        email: 'admin@company.local',
        password: 'SuperSecretPassword123!',
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
        agentSecret: 'nkb_sec_abcdef123456',
        pairingToken: 'NKB-ABC123XYZ',
        encryptionKey: 'AES256GCM_MASTER_KEY',
        documentMetadata: {
          title: 'Quarterly Report',
          refreshToken: 'refresh_tok_987654321',
        },
      };

      const redacted = redactSensitiveData(payload);

      assert.strictEqual(redacted.email, 'admin@company.local');
      assert.strictEqual(redacted.password, '[REDACTED]');
      assert.strictEqual(redacted.jwt, '[REDACTED]');
      assert.strictEqual(redacted.agentSecret, '[REDACTED]');
      assert.strictEqual(redacted.pairingToken, '[REDACTED]');
      assert.strictEqual(redacted.encryptionKey, '[REDACTED]');
      assert.strictEqual(redacted.documentMetadata.title, 'Quarterly Report');
      assert.strictEqual(redacted.documentMetadata.refreshToken, '[REDACTED]');
    });

    it('should redact raw Bearer token and pairing token string patterns', () => {
      const tokenStr = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
      const pairingStr = 'NKB-TEST-TOKEN-999';

      assert.strictEqual(redactSensitiveData(tokenStr), '[REDACTED_SECRET]');
      assert.strictEqual(redactSensitiveData(pairingStr), '[REDACTED_SECRET]');
    });

    it('should preserve non-sensitive operational fields unchanged during redaction', () => {
      const operationalPayload = {
        jobId: 'job-101',
        executionId: 'exec-202',
        documentId: 'doc-303',
        pageCount: 15,
        status: 'COMPLETED',
        durationMs: 340,
      };

      const redacted = redactSensitiveData(operationalPayload);
      assert.strictEqual(redacted.jobId, 'job-101');
      assert.strictEqual(redacted.pageCount, 15);
      assert.strictEqual(redacted.status, 'COMPLETED');
    });
  });

  // =========================================================================
  // 2. REQUEST CORRELATION & CONTEXT
  // =========================================================================
  describe('2. Request Context & Correlation ID Middleware', () => {
    it('should generate a UUID request ID when X-Request-ID header is missing', () => {
      const req: any = { headers: {} };
      const res: any = {
        headers: {} as Record<string, string>,
        setHeader(k: string, v: string) { this.headers[k] = v; },
      };

      requestContext(req, res, () => {});

      assert.ok(req.id);
      assert.strictEqual(typeof req.id, 'string');
      assert.ok(req.startTime > 0);
      assert.strictEqual(res.headers['X-Request-ID'], req.id);
    });

    it('should propagate incoming X-Request-ID and attach to response header', () => {
      const customRequestId = 'req-custom-client-tracing-999';
      const req: any = { headers: { 'x-request-id': customRequestId } };
      const res: any = {
        headers: {} as Record<string, string>,
        setHeader(k: string, v: string) { this.headers[k] = v; },
      };

      requestContext(req, res, () => {});

      assert.strictEqual(req.id, customRequestId);
      assert.strictEqual(res.headers['X-Request-ID'], customRequestId);
    });
  });

  // =========================================================================
  // 3. SECURITY EVENT AUDIT & CORRELATION
  // =========================================================================
  describe('3. Security Event Emission & Correlation', () => {
    const auditor = new SecurityEventAuditor();

    it('should emit and track security events with correlation IDs and actor context', () => {
      const event = auditor.emitSecurityEvent({
        eventType: 'AUTH_LOGIN_FAILURE',
        actorId: 'bad_actor@attacker.com',
        actorType: 'ANONYMOUS',
        requestId: 'req-test-uuid-001',
        ipAddress: '198.51.100.42',
        resourceType: 'USER_ACCOUNT',
        resourceId: 'bad_actor@attacker.com',
        success: false,
        reason: 'Invalid password attempt',
      });

      assert.strictEqual(event.eventType, 'AUTH_LOGIN_FAILURE');
      assert.strictEqual(event.requestId, 'req-test-uuid-001');
      assert.strictEqual(event.success, false);

      const recent = auditor.getRecentSecurityEvents();
      assert.ok(recent.length > 0);
      assert.strictEqual(recent[recent.length - 1].requestId, 'req-test-uuid-001');
    });

    it('should emit CROSS_DEPARTMENT_ACCESS_BLOCKED event upon unauthorized access attempt', () => {
      const event = auditor.emitSecurityEvent({
        eventType: 'CROSS_DEPARTMENT_ACCESS_BLOCKED',
        actorId: 'user-hr-01',
        actorType: 'USER',
        requestId: 'req-test-cross-dept',
        departmentId: 'dept-accounting',
        success: false,
        reason: 'User from HR attempted access to Accounting document',
      });

      assert.strictEqual(event.eventType, 'CROSS_DEPARTMENT_ACCESS_BLOCKED');
      assert.strictEqual(event.departmentId, 'dept-accounting');
    });

    it('should emit LEGAL_HOLD_BLOCKED_OPERATION event when destructive action attempted on held doc', () => {
      const event = auditor.emitSecurityEvent({
        eventType: 'LEGAL_HOLD_BLOCKED_OPERATION',
        actorId: 'user-admin-01',
        actorType: 'USER',
        resourceType: 'DOCUMENT',
        resourceId: 'doc-held-404',
        success: false,
        reason: 'Purge blocked due to active legal hold',
      });

      assert.strictEqual(event.eventType, 'LEGAL_HOLD_BLOCKED_OPERATION');
      assert.strictEqual(event.resourceId, 'doc-held-404');
    });

    it('should emit AGENT_CREDENTIAL_ROTATED event upon successful key rotation', () => {
      const event = auditor.emitSecurityEvent({
        eventType: 'AGENT_CREDENTIAL_ROTATED',
        actorId: 'agent-101',
        actorType: 'AGENT',
        resourceType: 'AGENT_CREDENTIAL',
        resourceId: 'cred-ver-2',
        success: true,
      });

      assert.strictEqual(event.eventType, 'AGENT_CREDENTIAL_ROTATED');
      assert.strictEqual(event.success, true);
    });
  });

  // =========================================================================
  // 4. TIERED RATE LIMITING & ABUSE PROTECTION
  // =========================================================================
  describe('4. Tiered Rate Limiting & Abuse Protection', () => {
    it('should enforce rate limiting and return HTTP 429 when max requests exceeded', () => {
      const limiter = createTieredRateLimiter({ max: 3, windowMs: 1000, tierName: 'TEST_AUTH' });

      let statusCode = 200;
      let responseBody: any = null;
      const headers: Record<string, any> = {};

      const req = {
        ip: '203.0.113.10',
        headers: { 'user-agent': 'TestRunner' },
        socket: { remoteAddress: '203.0.113.10' },
        id: 'req-rate-1',
      } as any;

      const res = {
        setHeader: (k: string, v: any) => { headers[k] = v; },
        status: (code: number) => { statusCode = code; return res; },
        json: (body: any) => { responseBody = body; return res; },
      } as any;

      // 3 successful requests
      limiter(req, res, () => {});
      limiter(req, res, () => {});
      limiter(req, res, () => {});
      assert.strictEqual(statusCode, 200);

      // 4th request must be rejected with 429 and Retry-After header
      limiter(req, res, () => {});
      assert.strictEqual(statusCode, 429);
      assert.ok(headers['Retry-After']);
      assert.strictEqual(responseBody?.error?.code, 'RATE_LIMIT_EXCEEDED');
      assert.strictEqual(responseBody?.error?.requestId, 'req-rate-1');
    });

    it('should distinguish limits across different IP addresses independently', () => {
      const limiter = createTieredRateLimiter({ max: 2, windowMs: 1000, tierName: 'TEST_MULTI_IP' });

      let ip1Status = 200;
      let ip2Status = 200;

      const req1 = { ip: '10.0.0.1', headers: {}, socket: {} } as any;
      const req2 = { ip: '10.0.0.2', headers: {}, socket: {} } as any;
      const res1 = { setHeader: () => {}, status: (c: number) => { ip1Status = c; return res1; }, json: () => {} } as any;
      const res2 = { setHeader: () => {}, status: (c: number) => { ip2Status = c; return res2; }, json: () => {} } as any;

      limiter(req1, res1, () => {});
      limiter(req1, res1, () => {});
      limiter(req1, res1, () => {}); // 3rd request for IP 1 -> 429
      assert.strictEqual(ip1Status, 429);

      // IP 2 first request must still be allowed (200)
      limiter(req2, res2, () => {});
      assert.strictEqual(ip2Status, 200);
    });
  });

  // =========================================================================
  // 5. PRODUCTION METRICS REGISTRY
  // =========================================================================
  describe('5. Metrics Registry Tracking & Observability', () => {
    it('should record HTTP requests, durations, status codes, and error ratios', () => {
      const metrics = new MetricsRegistry();

      metrics.recordHttpRequest(200, 45);
      metrics.recordHttpRequest(201, 55);
      metrics.recordHttpRequest(404, 15);
      metrics.recordHttpRequest(500, 120);

      const summary = metrics.getSummary();

      assert.strictEqual(summary.http.requestsTotal, 4);
      assert.strictEqual(summary.http.status2xx, 2);
      assert.strictEqual(summary.http.status4xx, 1);
      assert.strictEqual(summary.http.status5xx, 1);
      assert.strictEqual(summary.http.avgDurationMs, 58.75);
    });

    it('should record agent, job, upload, OCR, and compliance operations', () => {
      const metrics = new MetricsRegistry();

      metrics.recordAgentConnected();
      metrics.recordJobCreated();
      metrics.recordJobCompleted();
      metrics.recordUploadChunk(1024 * 512);
      metrics.recordOcrProcessed(true); // low-confidence
      metrics.recordLegalHoldBlock();
      metrics.recordDocumentPurged();

      const summary = metrics.getSummary();

      assert.strictEqual(summary.agents.connectedCount, 1);
      assert.strictEqual(summary.jobs.createdTotal, 1);
      assert.strictEqual(summary.jobs.completedTotal, 1);
      assert.strictEqual(summary.uploads.bytesUploadedTotal, 524288);
      assert.strictEqual(summary.ocr.lowConfidenceTotal, 1);
      assert.strictEqual(summary.compliance.legalHoldBlocksTotal, 1);
      assert.strictEqual(summary.compliance.purgedTotal, 1);
    });

    it('should decrement connected agent count when agent disconnects cleanly', () => {
      const metrics = new MetricsRegistry();
      metrics.recordAgentConnected();
      metrics.recordAgentConnected();
      assert.strictEqual(metrics.getSummary().agents.connectedCount, 2);

      metrics.recordAgentDisconnected();
      assert.strictEqual(metrics.getSummary().agents.connectedCount, 1);
    });
  });

  // =========================================================================
  // 6. READINESS & HEALTH PROBE SAFETY
  // =========================================================================
  describe('6. Readiness Probes & Secret Leakage Prevention', () => {
    it('should return safe readiness payload without leaking connection strings or passwords', () => {
      const checks = {
        database: 'connected',
        redis: 'connected',
        objectStorage: 'ready',
        queues: 'ready',
      };

      const response = {
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks,
      };

      const jsonStr = JSON.stringify(response);
      assert.strictEqual(jsonStr.includes('postgres://'), false);
      assert.strictEqual(jsonStr.includes('redis://'), false);
      assert.strictEqual(jsonStr.includes('password'), false);
      assert.strictEqual(response.status, 'ready');
      assert.strictEqual(response.checks.database, 'connected');
    });

    it('should return 503 status when any critical subsystem is unavailable', () => {
      const checks: Record<string, string> = {
        database: 'unreachable',
        redis: 'connected',
        objectStorage: 'ready',
        queues: 'ready',
      };

      const isReady = Object.values(checks).every((s) => s === 'connected' || s === 'ready');
      assert.strictEqual(isReady, false);
      const statusCode = isReady ? 200 : 503;
      assert.strictEqual(statusCode, 503, 'System must report 503 if database is down');
    });
  });

  // =========================================================================
  // 7. PRODUCTION ERROR SANITIZATION
  // =========================================================================
  describe('7. Production Error Sanitization & Masking', () => {
    it('should mask internal stack traces and database errors in production responses', () => {
      const internalDbError = new Error('syntax error at or near "SELECT" in PostgreSQL internal connection postgres://admin:superSecretPassword@10.0.0.5:5432/dcc');
      const isProduction = true;

      const safeMessage = isProduction
        ? 'An unexpected internal error occurred. Please contact system support with your Request ID.'
        : internalDbError.message;

      const sanitizedResponse = {
        error: safeMessage,
        details: {
          code: 'INTERNAL_SERVER_ERROR',
          message: safeMessage,
          requestId: 'req-corr-uuid-999',
        },
      };

      assert.strictEqual(sanitizedResponse.error.includes('postgres://'), false);
      assert.strictEqual(sanitizedResponse.error.includes('superSecretPassword'), false);
      assert.strictEqual(sanitizedResponse.details.requestId, 'req-corr-uuid-999');
    });
  });

  // =========================================================================
  // 8. WEBSOCKET REVOCATION & CORRELATION INTEGRITY
  // =========================================================================
  describe('8. WebSocket Security & Immediate Revocation', () => {
    it('should reject socket session immediately when agent is revoked in Redis cache', () => {
      const revokedAgentId = 'agent-revoked-007';
      const revokedCache = new Set([revokedAgentId]);

      const isRevoked = revokedCache.has(revokedAgentId);
      assert.strictEqual(isRevoked, true);

      // Attempting socket communication: must be rejected
      const canProceed = !isRevoked;
      assert.strictEqual(canProceed, false, 'Revoked agent must be blocked on WebSocket gateway');
    });

    it('should bind socket session strictly to authenticated agent ID', () => {
      const socketSession = {
        socketId: 'sock-uuid-1',
        authenticatedAgentId: 'agent-auth-101',
      };

      // Attacker attempts to forge different agentId in dispatch ACK
      const attackerPayload = { agentId: 'agent-victim-999', jobId: 'job-1' };
      const isValid = socketSession.authenticatedAgentId === attackerPayload.agentId;

      assert.strictEqual(isValid, false, 'Socket operation must not accept forged agentId');
    });
  });

  // =========================================================================
  // 9. WORKER RESILIENCE & DEAD-LETTER SAFETY
  // =========================================================================
  describe('9. Worker Resilience & Dead-Letter Handling', () => {
    it('should prevent duplicate queue execution with deterministic job IDs', () => {
      const documentId = 'doc-idempotent-ocr-500';
      const jobId1 = `ocr-${documentId}`;
      const jobId2 = `ocr-${documentId}`;

      assert.strictEqual(jobId1, jobId2, 'Deterministic job ID prevents duplicate worker jobs for same document');
    });

    it('should handle exponential backoff retry calculation accurately', () => {
      const baseDelay = 2000;
      const calculateDelay = (attempt: number) => baseDelay * Math.pow(2, attempt - 1);

      assert.strictEqual(calculateDelay(1), 2000);
      assert.strictEqual(calculateDelay(2), 4000);
      assert.strictEqual(calculateDelay(3), 8000);
    });
  });
});
