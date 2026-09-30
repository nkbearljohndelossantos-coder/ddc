import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { metrics } from '../lib/metrics.js';
import { sloService } from '../modules/sre/slo.service.js';
import { alertEscalationService } from '../modules/sre/alertEscalation.service.js';

describe('Phase 20: Observability, SRE Telemetry & Alerting Tests', () => {
  // =========================================================================
  // 1. METRICS ACCUMULATION & ZERO SECRET EXPOSURE
  // =========================================================================
  describe('1. In-Memory Metrics Registry', () => {
    it('should aggregate request and reliability metrics without leaking PII or credentials', () => {
      metrics.recordHttpRequest(200, 14.5);
      metrics.recordHttpRequest(500, 45.2);
      metrics.recordDeadLetter();
      metrics.recordRateLimitViolation();

      const summary = metrics.getSummary();
      assert.ok(summary.http.requestsTotal >= 2);
      assert.ok(summary.http.status5xx >= 1);
      assert.ok(summary.reliability.deadLettersTotal >= 1);

      const serialized = JSON.stringify(summary);
      assert.strictEqual(serialized.includes('password'), false);
      assert.strictEqual(serialized.includes('Bearer'), false);
    });
  });

  // =========================================================================
  // 2. SLO EVALUATION & ALERT DEDUPLICATION
  // =========================================================================
  describe('2. SLO Thresholds & Alert Escalation', () => {
    it('should evaluate SLO compliance status and deduplicate rapid alerts', async () => {
      const slo = await sloService.createSlo({
        name: 'Phase 20 API P95 Latency',
        metricName: 'PHASE20_API_LATENCY',
        targetValue: 200,
        warningThreshold: 350,
        criticalThreshold: 500,
      });
      assert.ok(slo.id);

      const evalOk = await sloService.evaluateMetric('PHASE20_API_LATENCY', 120);
      assert.strictEqual(evalOk?.status, 'OK');

      // Deduplicate alerts
      const alert = {
        alertType: 'HIGH_LATENCY_SPIKE',
        severity: 'HIGH' as const,
        title: 'API Latency Spiked Above 350ms',
        message: 'Observed P95 latency is 380ms',
        serviceName: 'API_GATEWAY',
      };

      const res1 = await alertEscalationService.processAlert(alert);
      const res2 = await alertEscalationService.processAlert(alert);

      assert.strictEqual(res1.deduplicated, false);
      assert.strictEqual(res2.deduplicated, true);
    });
  });
});
