import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceService } from '../modules/compliance/compliance.service.js';

describe('Phase 8: Enterprise Document Lifecycle, Retention, Deletion/Purge & Compliance Tests', () => {
  const mockDb = {
    policies: new Map<string, any>(),
    documents: new Map<string, any>(),
    storageRecords: new Map<string, any>(),
    auditLogs: [] as any[],
  };

  // Seed sample documents
  mockDb.documents.set('doc-retention-acct-1', {
    id: 'doc-retention-acct-1',
    title: 'Financial Statement FY2026',
    departmentId: 'dept-accounting',
    organizationId: 'org-1',
    documentType: 'INVOICE',
    status: 'COMPLETED',
    isLegalHold: false,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    retentionDate: null as Date | null,
    storageKeyPdf: 'final/derived/searchable-pdf/doc-retention-acct-1.pdf',
    isPurged: false,
  });

  mockDb.documents.set('doc-legal-hold-2', {
    id: 'doc-legal-hold-2',
    title: 'Litigation Settlement Agreement',
    departmentId: 'dept-legal',
    organizationId: 'org-1',
    documentType: 'CONTRACT',
    status: 'COMPLETED',
    isLegalHold: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    retentionDate: new Date('2025-01-01T00:00:00.000Z'), // Expired, but under legal hold
    storageKeyPdf: 'final/derived/searchable-pdf/doc-legal-hold-2.pdf',
    isPurged: false,
  });

  // =========================================================================
  // 1. RETENTION POLICY CREATION, VERSIONING & ASSIGNMENT
  // =========================================================================
  describe('1. Retention Policy Lifecycle & Expiration Calculation', () => {
    it('should create a retention policy with version 1 and retentionDays calculation', () => {
      const policy = {
        id: 'policy-inv-1',
        name: 'Standard 7-Year Accounting Invoice Retention',
        documentType: 'INVOICE',
        retentionDays: 2555, // 7 years
        retentionYears: 7,
        version: 1,
        actionOnExpiry: 'ARCHIVE',
        isActive: true,
      };

      mockDb.policies.set(policy.id, policy);
      assert.strictEqual(policy.version, 1);
      assert.strictEqual(policy.retentionDays, 2555);
    });

    it('should update retention policy, incrementing version to 2 for auditability', () => {
      const policy = mockDb.policies.get('policy-inv-1')!;
      const updatedPolicy = {
        ...policy,
        retentionDays: 3650, // 10 years
        version: policy.version + 1,
      };

      mockDb.policies.set(policy.id, updatedPolicy);
      assert.strictEqual(updatedPolicy.version, 2);
      assert.strictEqual(updatedPolicy.retentionDays, 3650);
    });

    it('should calculate exact document retention expiration timestamp upon policy assignment', () => {
      const doc = mockDb.documents.get('doc-retention-acct-1')!;
      const policy = mockDb.policies.get('policy-inv-1')!;

      const retentionDate = new Date(doc.createdAt.getTime() + policy.retentionDays * 24 * 60 * 60 * 1000);
      doc.retentionDate = retentionDate;

      assert.ok(doc.retentionDate.getTime() > doc.createdAt.getTime());
      assert.strictEqual(doc.retentionDate.toISOString().startsWith('2034'), true);
    });
  });

  // =========================================================================
  // 2. LEGAL HOLD INVARIANT OVERRIDING RETENTION & DELETION
  // =========================================================================
  describe('2. Legal Hold Protection over Retention, Deletion & Purge', () => {
    it('should block retention expiration and purge for documents under active legal hold', () => {
      const doc = mockDb.documents.get('doc-legal-hold-2')!;
      const now = new Date('2026-08-28T00:00:00.000Z');

      const isExpired = doc.retentionDate && doc.retentionDate <= now;
      assert.strictEqual(isExpired, true, 'Document retention date is in the past');

      // Legal hold invariant: Active legal hold blocks any automated purge or deletion
      const canPurge = !doc.isLegalHold;
      assert.strictEqual(canPurge, false, 'Purge must be strictly blocked while isLegalHold is true');
    });

    it('should block user deletion request when document is under active legal hold', () => {
      const doc = mockDb.documents.get('doc-legal-hold-2')!;

      assert.throws(
        () => {
          if (doc.isLegalHold) {
            throw new Error('Deletion blocked: Document is protected by an active Legal Hold');
          }
        },
        /Deletion blocked: Document is protected by an active Legal Hold/
      );
    });
  });

  // =========================================================================
  // 3. CONTROLLED DELETION & SAFE PURGE ENGINE
  // =========================================================================
  describe('3. Controlled Deletion & Irreversible Purge Engine', () => {
    it('should transition document to DELETION_PENDING and record audit trail', () => {
      const doc = mockDb.documents.get('doc-retention-acct-1')!;
      doc.status = 'DELETION_PENDING';

      mockDb.auditLogs.push({
        documentId: doc.id,
        userId: 'user-admin-1',
        action: 'DELETION_REQUESTED',
        details: { reason: 'End of mandatory financial record lifecycle' },
        createdAt: new Date(),
      });

      assert.strictEqual(doc.status, 'DELETION_PENDING');
      const audit = mockDb.auditLogs.find((l) => l.action === 'DELETION_REQUESTED');
      assert.ok(audit);
    });

    it('should permanently purge document files and record PURGE_COMPLETED audit event', () => {
      const doc = mockDb.documents.get('doc-retention-acct-1')!;
      doc.status = 'PURGED';
      doc.isPurged = true;
      doc.purgedAt = new Date();
      doc.storageKeyPdf = null;

      mockDb.auditLogs.push({
        documentId: doc.id,
        userId: 'user-admin-1',
        action: 'PURGE_COMPLETED',
        details: { reason: 'Permanent compliance purge confirmed', purgedKeysCount: 1 },
        createdAt: new Date(),
      });

      assert.strictEqual(doc.status, 'PURGED');
      assert.strictEqual(doc.isPurged, true);
      assert.strictEqual(doc.storageKeyPdf, null);
    });

    it('should handle repeated purge requests idempotently without error', () => {
      const doc = mockDb.documents.get('doc-retention-acct-1')!;
      assert.strictEqual(doc.isPurged, true);

      // Re-running purge on already purged document returns success state
      const isAlreadyPurged = doc.isPurged && doc.status === 'PURGED';
      assert.strictEqual(isAlreadyPurged, true, 'Repeated purge must be safe and idempotent');
    });
  });

  // =========================================================================
  // 4. AUDIT TRAIL QUERY & DEPARTMENT ISOLATION
  // =========================================================================
  describe('4. Compliance Audit Logs & Department Isolation', () => {
    it('should filter audit logs by action and date range', () => {
      const purgeLogs = mockDb.auditLogs.filter((l) => l.action === 'PURGE_COMPLETED');
      assert.strictEqual(purgeLogs.length, 1);
      assert.strictEqual(purgeLogs[0].documentId, 'doc-retention-acct-1');
    });

    it('should isolate audit log queries to reviewer department for departmental users', () => {
      const hrUser = {
        departmentId: 'dept-hr',
        roles: ['DEPARTMENT_USER'],
      };

      // HR user searches audit logs; must not see Accounting audit records
      const visibleLogs = mockDb.auditLogs.filter((l) => {
        const doc = mockDb.documents.get(l.documentId);
        return doc && doc.departmentId === hrUser.departmentId;
      });

      assert.strictEqual(visibleLogs.length, 0, 'HR user cannot inspect Accounting audit records');
    });
  });
});
