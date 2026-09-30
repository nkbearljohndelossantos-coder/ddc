import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { metrics } from '../lib/metrics.js';
import { sloService } from '../modules/sre/slo.service.js';
import { DistributedLockManager } from '../lib/ha/distributedLock.js';

describe('Phase 18: Performance & Load Baseline Tests', () => {
  // =========================================================================
  // 1. METRICS REGISTRY LATENCY
  // =========================================================================
  describe('1. In-Memory Telemetry & Metrics Performance', () => {
    it('should record 10,000 metrics events with average latency under 0.05ms', () => {
      const start = performance.now();
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        metrics.recordHttpRequest(200, 12.5);
      }

      const totalDuration = performance.now() - start;
      const avgLatencyMs = totalDuration / iterations;

      assert.ok(avgLatencyMs < 0.05, `Average latency (${avgLatencyMs}ms) must be under 0.05ms`);
    });
  });

  // =========================================================================
  // 2. SLO EVALUATION THROUGHPUT
  // =========================================================================
  describe('2. SLO Evaluation Throughput', () => {
    it('should evaluate SLO measurements rapidly under high load', async () => {
      await sloService.createSlo({
        name: 'Benchmark API Latency',
        metricName: 'BENCHMARK_API_LATENCY',
        targetValue: 200,
        warningThreshold: 350,
        criticalThreshold: 500,
      });

      const start = performance.now();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        await sloService.evaluateMetric('BENCHMARK_API_LATENCY', 150 + (i % 50));
      }

      const totalDuration = performance.now() - start;
      const avgLatencyMs = totalDuration / iterations;

      assert.ok(avgLatencyMs < 1.0, `Average SLO eval latency (${avgLatencyMs}ms) must be under 1ms`);
    });
  });

  // =========================================================================
  // 3. DISTRIBUTED LOCK PERFORMANCE
  // =========================================================================
  describe('3. Lock Acquisition & Release Throughput', () => {
    it('should acquire and release locks with sub-millisecond overhead', async () => {
      const lockMgr = new DistributedLockManager();
      const start = performance.now();
      const iterations = 500;

      for (let i = 0; i < iterations; i++) {
        const lock = await lockMgr.acquireLock(`bench-lock-${i % 10}`, 5000);
        if (lock) {
          await lockMgr.releaseLock(lock);
        }
      }

      const totalDuration = performance.now() - start;
      const avgLatencyMs = totalDuration / iterations;

      assert.ok(avgLatencyMs < 1.0, `Average lock cycle latency (${avgLatencyMs}ms) must be under 1ms`);
    });
  });
});
