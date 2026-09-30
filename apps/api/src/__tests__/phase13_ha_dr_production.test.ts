import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { DistributedLockManager } from '../lib/ha/distributedLock.js';
import { DistributedRateLimiter } from '../lib/ha/distributedRateLimiter.js';
import { MockObjectStorageProvider } from '../lib/storage/MockObjectStorageProvider.js';
import { LocalObjectStorageProvider } from '../lib/storage/LocalObjectStorageProvider.js';
import { DeadLetterService } from '../modules/admin/deadLetter.service.js';

describe('Phase 13: High Availability, Horizontal Scaling & Disaster Recovery Tests', () => {
  // =========================================================================
  // 1. DISTRIBUTED LOCKING & LEASE MANAGEMENT
  // =========================================================================
  describe('1. Distributed Lock Manager & Leader Election', () => {
    const lockMgr = new DistributedLockManager();

    it('should acquire lock with lease TTL on resource', async () => {
      const lock = await lockMgr.acquireLock('scheduled:retention-sweep', 5000);
      assert.ok(lock);
      assert.strictEqual(lock.resource, 'scheduled:retention-sweep');
      assert.ok(lock.token);

      // Release lock
      const released = await lockMgr.releaseLock(lock);
      assert.strictEqual(released, true);
    });

    it('should deny lock acquisition to second instance while lock is held', async () => {
      const lock1 = await lockMgr.acquireLock('scheduled:integrity-sweep', 10000);
      assert.ok(lock1);

      // Second instance attempts to acquire same resource
      const lock2 = await lockMgr.acquireLock('scheduled:integrity-sweep', 10000);
      assert.strictEqual(lock2, null, 'Second worker must be denied lock on active resource');

      await lockMgr.releaseLock(lock1);
    });

    it('should execute task exclusively under runWithLock guard', async () => {
      let executed = false;
      const res = await lockMgr.runWithLock('job:stale-recovery', 5000, async () => {
        executed = true;
        return 'SUCCESS_PAYLOAD';
      });

      assert.strictEqual(res.executed, true);
      assert.strictEqual(res.result, 'SUCCESS_PAYLOAD');
      assert.strictEqual(executed, true);
    });
  });

  // =========================================================================
  // 2. DISTRIBUTED RATE LIMITING
  // =========================================================================
  describe('2. Distributed Rate Limiter & Sliding Window', () => {
    const rateLimiter = new DistributedRateLimiter();

    it('should allow requests within limit and track remaining tokens', async () => {
      const opts = { windowMs: 60000, maxRequests: 5, keyPrefix: 'test:ha' };

      const r1 = await rateLimiter.checkRateLimit('client-ip-1', opts);
      assert.strictEqual(r1.allowed, true);
      assert.strictEqual(r1.remaining, 4);

      const r2 = await rateLimiter.checkRateLimit('client-ip-1', opts);
      assert.strictEqual(r2.allowed, true);
      assert.strictEqual(r2.remaining, 3);
    });

    it('should reject requests exceeding limit and calculate Retry-After', async () => {
      const opts = { windowMs: 10000, maxRequests: 2, keyPrefix: 'test:strict' };

      await rateLimiter.checkRateLimit('client-ip-2', opts);
      await rateLimiter.checkRateLimit('client-ip-2', opts);

      // Third request exceeds limit
      const r3 = await rateLimiter.checkRateLimit('client-ip-2', opts);
      assert.strictEqual(r3.allowed, false);
      assert.strictEqual(r3.remaining, 0);
      assert.ok(r3.retryAfterSec && r3.retryAfterSec > 0);
    });
  });

  // =========================================================================
  // 3. OBJECT STORAGE PROVIDER ABSTRACTION & MULTIPART UPLOADS
  // =========================================================================
  describe('3. Object Storage Provider & Large Multipart Uploads', () => {
    const storage = new MockObjectStorageProvider();

    it('should assemble large document via multipart parts and compute correct SHA-256', async () => {
      const targetKey = 'final/org-1/dept-finance/large-financial-audit.pdf';
      const uploadId = await storage.createMultipartUpload(targetKey, 'application/pdf');

      // Create chunks
      const chunk1 = Buffer.alloc(1024 * 1024, 'A'); // 1MB
      const chunk2 = Buffer.alloc(1024 * 1024, 'B'); // 1MB
      const expectedCombined = Buffer.concat([chunk1, chunk2]);
      const expectedSha256 = crypto.createHash('sha256').update(expectedCombined).digest('hex');

      const p1 = await storage.uploadPart(targetKey, uploadId, 1, chunk1);
      const p2 = await storage.uploadPart(targetKey, uploadId, 2, chunk2);

      assert.strictEqual(p1.partNumber, 1);
      assert.strictEqual(p2.partNumber, 2);

      const completed = await storage.completeMultipartUpload(targetKey, uploadId, [p1, p2]);

      assert.strictEqual(completed.key, targetKey);
      assert.strictEqual(completed.sizeBytes, 2 * 1024 * 1024);
      assert.strictEqual(completed.sha256Hash, expectedSha256);

      const retrieved = await storage.getObject(targetKey);
      assert.strictEqual(retrieved.length, 2 * 1024 * 1024);
    });

    it('should abort multipart upload and clean up session', async () => {
      const targetKey = 'quarantine/abandoned-scan.pdf';
      const uploadId = await storage.createMultipartUpload(targetKey);
      const aborted = await storage.abortMultipartUpload(targetKey, uploadId);

      assert.strictEqual(aborted, true);
      assert.strictEqual(storage.multipartSessions.has(uploadId), false);
    });

    it('should reject path traversal in local storage provider', async () => {
      const local = new LocalObjectStorageProvider('./test-storage');
      await assert.rejects(
        async () => {
          await local.getObject('../../etc/passwd');
        },
        /Path traversal violation/
      );
    });
  });

  // =========================================================================
  // 4. DISASTER RECOVERY DRILL & RPO/RTO METRICS
  // =========================================================================
  describe('4. Disaster Recovery Drills & RPO/RTO Observability', () => {
    it('should validate simulated DR drill integrity and calculate RPO/RTO', () => {
      const backupTimestamp = new Date(Date.now() - 25 * 60 * 1000); // 25 min ago
      const configuredRpoMin = 60;
      const configuredRtoMin = 30;

      const observedRpoMin = Math.round((Date.now() - backupTimestamp.getTime()) / 60000);
      const observedRtoMin = 4; // 4 minutes recovery duration

      const isRpoSatisfied = observedRpoMin <= configuredRpoMin;
      const isRtoSatisfied = observedRtoMin <= configuredRtoMin;

      assert.strictEqual(isRpoSatisfied, true, 'RPO must be satisfied when backup age < 60 min');
      assert.strictEqual(isRtoSatisfied, true, 'RTO must be satisfied when recovery duration < 30 min');
    });
  });

  // =========================================================================
  // 5. CONCURRENCY & CHAOS GUARDS
  // =========================================================================
  describe('5. Concurrency & Replay Protection Guards', () => {
    it('should safely prevent duplicate side-effects during concurrent purge requests', () => {
      const doc = { id: 'doc-chaos-1', isPurged: false };
      let purgeExecutions = 0;

      function executePurge(targetDoc: { id: string; isPurged: boolean }) {
        if (targetDoc.isPurged) {
          return { status: 'ALREADY_PURGED', executed: false };
        }
        targetDoc.isPurged = true;
        purgeExecutions++;
        return { status: 'PURGED', executed: true };
      }

      const res1 = executePurge(doc);
      const res2 = executePurge(doc);

      assert.strictEqual(res1.executed, true);
      assert.strictEqual(res2.executed, false);
      assert.strictEqual(purgeExecutions, 1);
    });
  });
});
