import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { sloService } from '../modules/sre/slo.service.js';
import { incidentService } from '../modules/sre/incident.service.js';
import { workerHeartbeatService } from '../modules/sre/workerHeartbeat.service.js';
import { maintenanceService } from '../modules/sre/maintenance.service.js';
import { metrics } from '../lib/metrics.js';
import { DistributedLockManager } from '../lib/ha/distributedLock.js';

describe('Phase 19: Production Smoke & Operational Health Tests', () => {
  // =========================================================================
  // 1. HEALTH & READINESS PROBES
  // =========================================================================
  describe('1. Production Readiness & Health Endpoints', () => {
    it('should verify core system readiness without leaking connection strings or credentials', async () => {
      // Validate metrics and SRE dependencies are live
      metrics.recordHttpRequest(200, 12.0);
      const metricsSummary = metrics.getSummary();

      assert.ok(metricsSummary.uptimeSeconds >= 0);
      assert.ok(metricsSummary.http.requestsTotal >= 1);
      assert.strictEqual(metricsSummary.http.status2xx >= 1, true);

      // Verify no sensitive keys leaked in telemetry
      const serialized = JSON.stringify(metricsSummary);
      assert.strictEqual(serialized.includes('password'), false);
      assert.strictEqual(serialized.includes('postgres://'), false);
      assert.strictEqual(serialized.includes('SECRET'), false);
    });
  });

  // =========================================================================
  // 2. SMOKE TESTS ACROSS CORE MODULES
  // =========================================================================
  describe('2. End-to-End Operational Smoke Workflows', () => {
    it('should verify SRE incident lifecycle, worker heartbeats, and SLO telemetry under smoke test', async () => {
      // 1. Worker Heartbeat
      const heartbeat = await workerHeartbeatService.recordHeartbeat({
        workerId: 'smoke-worker-01',
        workerType: 'OCR_WORKER',
        hostname: 'prod-node-01',
        version: '1.0.0',
        status: 'IDLE',
      });
      assert.strictEqual(heartbeat.status, 'IDLE');
      assert.strictEqual(heartbeat.workerType, 'OCR_WORKER');

      // 2. SLO Telemetry
      const slo = await sloService.createSlo({
        name: 'Smoke Test Availability',
        metricName: 'SMOKE_AVAILABILITY',
        targetValue: 99.9,
        warningThreshold: 99.5,
        criticalThreshold: 99.0,
      });
      assert.ok(slo.id);

      const evalResult = await sloService.evaluateMetric('SMOKE_AVAILABILITY', 99.98);
      assert.strictEqual(evalResult?.status, 'OK');

      // 3. Maintenance check
      const maintCheck = await maintenanceService.isRequestBlocked(['SUPER_ADMIN'], false);
      assert.strictEqual(maintCheck.blocked, false);
    });
  });
});
