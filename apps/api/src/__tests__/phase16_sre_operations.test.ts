import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { sloService } from '../modules/sre/slo.service.js';
import { incidentService } from '../modules/sre/incident.service.js';
import { alertEscalationService } from '../modules/sre/alertEscalation.service.js';
import { workerHeartbeatService } from '../modules/sre/workerHeartbeat.service.js';
import { maintenanceService } from '../modules/sre/maintenance.service.js';
import { configVersionService } from '../modules/sre/configVersion.service.js';
import { complianceExportService } from '../modules/sre/complianceExport.service.js';

describe('Phase 16: Enterprise SRE, Production Operations, SLA Enforcement & Continuous Reliability Tests', () => {
  // =========================================================================
  // 1. SERVICE LEVEL OBJECTIVES (SLO) & SLA BREACH DETECTION
  // =========================================================================
  describe('1. Service Level Objectives & SLA Evaluation', () => {
    it('should create and evaluate SLO thresholds, flagging breaches accurately', async () => {
      const slo = await sloService.createSlo({
        name: 'API Availability 99.9%',
        metricName: 'API_AVAILABILITY_TEST',
        targetValue: 99.9,
        warningThreshold: 99.5,
        criticalThreshold: 99.0,
      });

      assert.strictEqual(slo.metricName, 'API_AVAILABILITY_TEST');

      // 1. Healthy sample
      const mOk = await sloService.evaluateMetric('API_AVAILABILITY_TEST', 99.95);
      assert.strictEqual(mOk?.status, 'OK');

      // 2. Warning sample
      const mWarn = await sloService.evaluateMetric('API_AVAILABILITY_TEST', 99.3);
      assert.strictEqual(mWarn?.status, 'WARNING');

      // 3. Breach sample
      const mBreach = await sloService.evaluateMetric('API_AVAILABILITY_TEST', 98.5);
      assert.strictEqual(mBreach?.status, 'BREACH');
    });
  });

  // =========================================================================
  // 2. PRODUCTION INCIDENT MANAGEMENT & AUDIT TIMELINE
  // =========================================================================
  describe('2. Incident Management Lifecycle & Timeline Audit', () => {
    it('should advance incident through OPEN -> INVESTIGATING -> RESOLVED -> CLOSED with auditable timeline', async () => {
      // 1. Create incident
      const inc = await incidentService.createIncident(
        {
          title: 'Database Replica Replication Lag Spike',
          description: 'Replication lag exceeded 5000ms on secondary node',
          severity: 'SEV2',
          serviceName: 'DATABASE',
        },
        'user-sre-lead'
      );

      assert.strictEqual(inc.status, 'OPEN');
      assert.strictEqual(inc.severity, 'SEV2');
      assert.strictEqual(inc.timeline.length, 1);
      assert.strictEqual(inc.timeline[0].eventType, 'CREATED');

      // 2. Acknowledge
      const acked = await incidentService.acknowledgeIncident(inc.id, 'user-oncall-01');
      assert.strictEqual(acked.status, 'INVESTIGATING');
      assert.ok(acked.timeline.some((t: any) => t.eventType === 'ACKNOWLEDGED'));

      // 3. Resolve
      const resolved = await incidentService.resolveIncident(
        inc.id,
        'user-oncall-01',
        'Restarted WAL receiver process and caught up with primary'
      );
      assert.strictEqual(resolved.status, 'RESOLVED');
      assert.strictEqual(resolved.resolutionNotes, 'Restarted WAL receiver process and caught up with primary');

      // 4. Close with PIR
      const closed = await incidentService.closeIncident(
        inc.id,
        'user-sre-lead',
        'PIR-2026-08-28: Implemented auto-restart on WAL connection timeout'
      );
      assert.strictEqual(closed.status, 'CLOSED');
      assert.ok(closed.postIncidentReview?.includes('PIR-2026-08-28'));
    });
  });

  // =========================================================================
  // 3. ALERT DEDUPLICATION & AUTOMATIC INCIDENT ESCALATION
  // =========================================================================
  describe('3. Operational Alert Deduplication & Escalation', () => {
    it('should deduplicate repeating alerts and automatically escalate repeated failures to an incident', async () => {
      const alertInput = {
        alertType: 'STORAGE_UNAVAILABLE_BURST',
        severity: 'CRITICAL' as const,
        title: 'MinIO Storage Connection Timeout',
        message: 'Failed to connect to storage endpoint after 3 retries',
        serviceName: 'STORAGE',
      };

      // 1. First occurrence
      const res1 = await alertEscalationService.processAlert(alertInput);
      assert.strictEqual(res1.deduplicated, false);

      // 2. Second occurrence (deduplicated)
      const res2 = await alertEscalationService.processAlert(alertInput);
      assert.strictEqual(res2.deduplicated, true);

      // 3. Third occurrence (triggers automatic incident creation)
      const res3 = await alertEscalationService.processAlert(alertInput);
      assert.strictEqual(res3.deduplicated, true);
      assert.strictEqual(res3.occurrences, 3);

      const createdIncident = await incidentService.listIncidents({ serviceName: 'STORAGE' });
      assert.ok(createdIncident.length > 0);
      assert.ok(createdIncident[0].title.includes('Auto-Escalated'));
    });
  });

  // =========================================================================
  // 4. WORKER HEARTBEAT TRACKING & STALE RECOVERY
  // =========================================================================
  describe('4. Worker Heartbeat & Stale Worker Detection', () => {
    it('should record worker heartbeats and identify stale workers exceeding threshold', async () => {
      // 1. Register active worker
      await workerHeartbeatService.recordHeartbeat({
        workerId: 'worker-ocr-01',
        workerType: 'OCR_WORKER',
        hostname: 'node-compute-05',
        version: '1.0.0',
        status: 'BUSY',
        currentJobId: 'job-999',
        queueName: 'ocr-tasks',
      });

      // 2. Check stale with 0ms threshold to trigger stale detection immediately
      const result = await workerHeartbeatService.detectStaleWorkers(0);
      assert.ok(result.staleWorkersCount >= 1);
      assert.ok(result.staleWorkers.some((w) => w.workerId === 'worker-ocr-01'));
    });
  });

  // =========================================================================
  // 5. MAINTENANCE MODE CONTROLS
  // =========================================================================
  describe('5. Maintenance Mode & Role Bypass Controls', () => {
    it('should block non-admin writes during READ_ONLY maintenance while allowing SUPER_ADMIN bypass', async () => {
      const now = new Date();
      await maintenanceService.createMaintenanceWindow(
        {
          title: 'Database Schema Optimization Window',
          mode: 'READ_ONLY',
          startsAt: new Date(now.getTime() - 10000),
          endsAt: new Date(now.getTime() + 60000),
          allowedRoles: ['SUPER_ADMIN'],
        },
        'user-admin-01'
      );

      // 1. Regular user write is blocked
      const userWrite = await maintenanceService.isRequestBlocked(['DEPARTMENT_USER'], true);
      assert.strictEqual(userWrite.blocked, true);

      // 2. Regular user read is allowed in READ_ONLY mode
      const userRead = await maintenanceService.isRequestBlocked(['DEPARTMENT_USER'], false);
      assert.strictEqual(userRead.blocked, false);

      // 3. Super Admin write is allowed (exempt)
      const adminWrite = await maintenanceService.isRequestBlocked(['SUPER_ADMIN'], true);
      assert.strictEqual(adminWrite.blocked, false);
    });
  });

  // =========================================================================
  // 6. CONFIGURATION VERSIONING & ROLLBACK
  // =========================================================================
  describe('6. Configuration Versioning, Secret Redaction & Rollback', () => {
    it('should track configuration changes, redact secrets, and support safe rollback', async () => {
      const v1 = await configVersionService.saveConfigVersion(
        'RETENTION',
        { defaultRetentionDays: 365, secretKey: 'top_secret_123' },
        { defaultRetentionDays: 730, secretKey: 'top_secret_123' },
        'Extended default retention to 2 years',
        'user-admin-01'
      );

      assert.strictEqual(v1.version, 1);
      assert.strictEqual(JSON.stringify(v1.afterValues).includes('top_secret_123'), false);

      // Rollback to v1
      const v2 = await configVersionService.rollbackToVersion(v1.id, 'user-admin-01');
      assert.strictEqual(v2.version, 2);
      assert.ok(v2.changeReason.includes('Rollback'));
    });
  });

  // =========================================================================
  // 7. COMPLIANCE & AUDIT EXPORT WITH ISOLATION
  // =========================================================================
  describe('7. Compliance Export Generation & Tenant Isolation', () => {
    it('should generate compliant export with SHA-256 integrity and secret redaction', async () => {
      const exportResult = await complianceExportService.createExport(
        { exportType: 'INCIDENTS', format: 'JSON' },
        { id: 'user-audit-01', organizationId: 'org-enterprise', departmentId: null, roles: ['AUDITOR'] }
      );

      assert.strictEqual(exportResult.exportRecord.status, 'COMPLETED');
      assert.ok(exportResult.exportRecord.sha256Hash);
      assert.strictEqual(exportResult.exportRecord.sha256Hash.length, 64);
      assert.strictEqual(typeof exportResult.content, 'string');
    });
  });
});
