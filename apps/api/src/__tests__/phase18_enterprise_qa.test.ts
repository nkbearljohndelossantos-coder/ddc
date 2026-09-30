import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { sloService } from '../modules/sre/slo.service.js';
import { incidentService } from '../modules/sre/incident.service.js';
import { maintenanceService } from '../modules/sre/maintenance.service.js';
import { configVersionService } from '../modules/sre/configVersion.service.js';
import { complianceExportService } from '../modules/sre/complianceExport.service.js';
import { metrics } from '../lib/metrics.js';
import { DistributedLockManager } from '../lib/ha/distributedLock.js';

describe('Phase 18: Enterprise QA & Full System Regression Tests', () => {
  // =========================================================================
  // 1. END-TO-END QA & WORKFLOW INVARIANTS
  // =========================================================================
  describe('1. Full System Regression & Invariants', () => {
    it('should enforce full lifecycle transition and preserve audit records', async () => {
      // Create incident and verify complete state machine
      const inc = await incidentService.createIncident(
        {
          title: 'QA System Regression Incident',
          description: 'Validating end-to-end incident lifecycle and audit logs',
          severity: 'SEV3',
          serviceName: 'OCR_SERVICE',
        },
        'user-qa-01'
      );

      assert.strictEqual(inc.status, 'OPEN');
      assert.strictEqual(inc.timeline.length, 1);

      const acked = await incidentService.acknowledgeIncident(inc.id, 'user-qa-01');
      assert.strictEqual(acked.status, 'INVESTIGATING');

      const resolved = await incidentService.resolveIncident(inc.id, 'user-qa-01', 'Patched OCR memory leak');
      assert.strictEqual(resolved.status, 'RESOLVED');

      const closed = await incidentService.closeIncident(inc.id, 'user-qa-01', 'PIR: Memory tuning completed');
      assert.strictEqual(closed.status, 'CLOSED');
      assert.strictEqual(closed.postIncidentReview, 'PIR: Memory tuning completed');
    });

    it('should generate compliant export with SHA-256 integrity check and secret redaction', async () => {
      const userCtx = {
        id: 'user-compliance-officer',
        organizationId: 'org-enterprise',
        departmentId: 'dept-legal',
        roles: ['COMPLIANCE_OFFICER'],
      };

      const result = await complianceExportService.createExport(
        {
          exportType: 'AUDIT_LOGS',
          format: 'JSON',
          departmentId: 'dept-legal',
        },
        userCtx
      );

      assert.ok(result.exportRecord.id);
      assert.strictEqual(result.exportRecord.status, 'COMPLETED');
      assert.strictEqual(result.exportRecord.departmentId, 'dept-legal');
      assert.ok(result.exportRecord.sha256Hash);
      assert.strictEqual(result.content.includes('REDACT_ME'), false, 'Sensitive fields must be redacted from exports');
    });
  });

  // =========================================================================
  // 2. MAINTENANCE MODE & ROLE BYPASS
  // =========================================================================
  describe('2. Maintenance Mode & Protection Gates', () => {
    it('should enforce READ_ONLY mode and permit SUPER_ADMIN write bypass', async () => {
      await maintenanceService.createMaintenanceWindow(
        {
          title: 'QA Database Migration',
          mode: 'READ_ONLY',
          startsAt: new Date(Date.now() - 10000),
          endsAt: new Date(Date.now() + 60000),
          allowedRoles: ['SUPER_ADMIN'],
        },
        'admin-01'
      );

      // Normal write request blocked
      const userCheck = await maintenanceService.isRequestBlocked(['DEPARTMENT_USER'], true);
      assert.strictEqual(userCheck.blocked, true);

      // Normal read request allowed
      const readCheck = await maintenanceService.isRequestBlocked(['DEPARTMENT_USER'], false);
      assert.strictEqual(readCheck.blocked, false);

      // Admin write request permitted
      const adminCheck = await maintenanceService.isRequestBlocked(['SUPER_ADMIN'], true);
      assert.strictEqual(adminCheck.blocked, false);
    });
  });
});
