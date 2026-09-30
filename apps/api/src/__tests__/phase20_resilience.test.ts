import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { workerHeartbeatService } from '../modules/sre/workerHeartbeat.service.js';
import { DistributedLockManager } from '../lib/ha/distributedLock.js';
import { DistributedRateLimiter } from '../lib/ha/distributedRateLimiter.js';

describe('Phase 20: Zero-Downtime Resilience & Worker Recovery Tests', () => {
  const lockMgr = new DistributedLockManager();
  const rateLimiter = new DistributedRateLimiter();

  // =========================================================================
  // 1. WORKER HEARTBEAT RECOVERY
  // =========================================================================
  describe('1. Worker Stale Detection & Heartbeat Lifecycle', () => {
    it('should register worker heartbeat and transition stale workers cleanly', async () => {
      await workerHeartbeatService.recordHeartbeat({
        workerId: 'worker-resilience-01',
        workerType: 'OCR_WORKER',
        hostname: 'node-res-01',
        version: '1.0.0',
        status: 'IDLE',
      });

      // Stale check with 0 threshold should mark active workers as stale
      const result = await workerHeartbeatService.detectStaleWorkers(0);
      assert.ok(result.staleWorkersCount >= 1);
    });
  });

  // =========================================================================
  // 2. DISTRIBUTED LOCKING & RATE LIMITING
  // =========================================================================
  describe('2. Distributed Lock Lease Exclusivity & Rate Throttling', () => {
    it('should enforce mutual exclusion on distributed resources across concurrent callers', async () => {
      const resource = 'resource:phase20-resilience-lock';
      const lock1 = await lockMgr.acquireLock(resource, 5000);
      assert.ok(lock1);

      const lock2 = await lockMgr.acquireLock(resource, 5000);
      assert.strictEqual(lock2, null, 'Second worker must be denied lock while active');

      await lockMgr.releaseLock(lock1);
    });

    it('should enforce sliding-window rate limit burst protection', async () => {
      const opts = { windowMs: 10000, maxRequests: 2, keyPrefix: 'rate:phase20' };
      const ip = '198.51.100.99';

      const r1 = await rateLimiter.checkRateLimit(ip, opts);
      const r2 = await rateLimiter.checkRateLimit(ip, opts);
      const r3 = await rateLimiter.checkRateLimit(ip, opts);

      assert.strictEqual(r1.allowed, true);
      assert.strictEqual(r2.allowed, true);
      assert.strictEqual(r3.allowed, false, 'Third burst request within window must be throttled');
    });
  });
});
