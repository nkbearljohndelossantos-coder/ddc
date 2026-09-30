import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DistributedLockManager } from '../lib/ha/distributedLock.js';
import { DistributedRateLimiter } from '../lib/ha/distributedRateLimiter.js';
import { alertEscalationService } from '../modules/sre/alertEscalation.service.js';

describe('Phase 18: Concurrency & Race-Condition Validation Tests', () => {
  const lockMgr = new DistributedLockManager();
  const rateLimiter = new DistributedRateLimiter();

  // =========================================================================
  // 1. CONCURRENT DISTRIBUTED LOCKS
  // =========================================================================
  describe('1. Distributed Lock Mutual Exclusion Under Concurrency', () => {
    it('should grant lock to exactly one caller among concurrent requests', async () => {
      const resource = 'resource:concurrent-test-01';
      const results = await Promise.all([
        lockMgr.acquireLock(resource, 5000),
        lockMgr.acquireLock(resource, 5000),
        lockMgr.acquireLock(resource, 5000),
      ]);

      const acquired = results.filter((l) => l !== null);
      assert.strictEqual(acquired.length, 1, 'Only one concurrent worker must acquire lock');

      // Release lock
      await lockMgr.releaseLock(acquired[0]!);
    });
  });

  // =========================================================================
  // 2. CONCURRENT RATE LIMITING
  // =========================================================================
  describe('2. Concurrent Sliding-Window Rate Limit Enforcement', () => {
    it('should accurately throttle parallel requests exceeding sliding window', async () => {
      const opts = { windowMs: 5000, maxRequests: 3, keyPrefix: 'rate:test-concurrency' };
      const ip = '192.0.2.99';

      const results = await Promise.all([
        rateLimiter.checkRateLimit(ip, opts),
        rateLimiter.checkRateLimit(ip, opts),
        rateLimiter.checkRateLimit(ip, opts),
        rateLimiter.checkRateLimit(ip, opts),
        rateLimiter.checkRateLimit(ip, opts),
      ]);

      const allowed = results.filter((r: any) => r.allowed);
      const blocked = results.filter((r: any) => !r.allowed);

      assert.strictEqual(allowed.length, 3);
      assert.strictEqual(blocked.length, 2);
    });
  });

  // =========================================================================
  // 3. CONCURRENT ALERT DEDUPLICATION
  // =========================================================================
  describe('3. Concurrent Alert Deduplication & Escalation', () => {
    it('should deduplicate multiple parallel identical alerts accurately', async () => {
      const alertInput = {
        alertType: 'DB_CONNECTION_POOL_HIGH',
        severity: 'HIGH' as const,
        title: 'High Connection Pool Utilization',
        message: 'Pool utilization at 88%',
        serviceName: 'DATABASE',
      };

      const results = await Promise.all([
        alertEscalationService.processAlert(alertInput),
        alertEscalationService.processAlert(alertInput),
        alertEscalationService.processAlert(alertInput),
      ]);

      assert.strictEqual(results[0].deduplicated, false);
      assert.strictEqual(results[1].deduplicated, true);
      assert.strictEqual(results[2].deduplicated, true);
    });
  });
});
