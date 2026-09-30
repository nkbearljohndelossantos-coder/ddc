import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthStore } from '../services/authStore.js';
import { NavigationShell } from '../components/NavigationShell.js';
import { DocumentListView } from '../views/DocumentListView.js';
import { QcWorkspaceView } from '../views/QcWorkspaceView.js';
import { ComplianceView } from '../views/ComplianceView.js';
import { AdministrationView } from '../views/AdministrationView.js';
import { DocumentSummary } from '../types/ui.js';

describe('Phase 16: Enterprise Frontend, User Experience & UI Integration Tests', () => {
  // =========================================================================
  // 1. ROLE-AWARE NAVIGATION & SESSION ACCESS
  // =========================================================================
  describe('1. Navigation Shell & RBAC Menu Visibility', () => {
    it('should expose administrative and DR navigation items for SUPER_ADMIN', () => {
      const auth = AuthStore.getInstance();
      auth.setSession({
        id: 'user-super-1',
        email: 'superadmin@dcc.corp',
        fullName: 'Super Administrator',
        organizationId: 'org-enterprise',
        roles: ['SUPER_ADMIN'],
      });

      const navItems = NavigationShell.getAuthorizedNavItems();
      const itemIds = navItems.map((i) => i.id);

      assert.ok(itemIds.includes('dashboard'));
      assert.ok(itemIds.includes('admin'));
      assert.ok(itemIds.includes('dr'));
      assert.ok(itemIds.includes('compliance'));
    });

    it('should restrict administrative navigation items for DEPARTMENT_USER', () => {
      const auth = AuthStore.getInstance();
      auth.setSession({
        id: 'user-dept-1',
        email: 'user@dcc.corp',
        fullName: 'Department Operator',
        organizationId: 'org-enterprise',
        departmentId: 'dept-accounting',
        roles: ['DEPARTMENT_USER'],
      });

      const navItems = NavigationShell.getAuthorizedNavItems();
      const itemIds = navItems.map((i) => i.id);

      assert.ok(itemIds.includes('dashboard'));
      assert.ok(itemIds.includes('documents'));
      assert.ok(itemIds.includes('search'));
      assert.strictEqual(itemIds.includes('admin'), false, 'Admin must not be visible to DEPARTMENT_USER');
      assert.strictEqual(itemIds.includes('dr'), false, 'DR must not be visible to DEPARTMENT_USER');
    });
  });

  // =========================================================================
  // 2. DOCUMENT LIFECYCLE & PURGED DOCUMENT GUARDS
  // =========================================================================
  describe('2. Document Management UI & Purged State Guards', () => {
    it('should render document list with active download links for COMPLETED records', () => {
      const docs: DocumentSummary[] = [
        {
          id: 'doc-completed-1',
          title: 'Q3 Financial Audit.pdf',
          documentType: 'FINANCIAL_REPORT',
          status: 'COMPLETED',
          ocrConfidence: 97.4,
          pageCount: 3,
          fileSizeBytes: 1048576,
          isLegalHold: false,
          isPurged: false,
          version: 1,
          createdAt: new Date().toISOString(),
        },
      ];

      const html = DocumentListView.render(docs);
      assert.ok(html.includes('Q3 Financial Audit.pdf'));
      assert.ok(html.includes('status-completed'));
      assert.ok(html.includes('/api/v1/documents/doc-completed-1/download'));
    });

    it('should disable download controls and display [PURGED] for permanently destroyed documents', () => {
      const docs: DocumentSummary[] = [
        {
          id: 'doc-purged-1',
          title: 'Expunged Payroll File.pdf',
          documentType: 'PAYROLL',
          status: 'PURGED',
          pageCount: 1,
          fileSizeBytes: 0,
          isLegalHold: false,
          isPurged: true,
          version: 1,
          createdAt: new Date().toISOString(),
        },
      ];

      const html = DocumentListView.render(docs);
      assert.ok(html.includes('[PURGED]'));
      assert.strictEqual(html.includes('/download'), false, 'Purged document must have no download link');
    });
  });

  // =========================================================================
  // 3. QC REVIEWER WORKSPACE & ACCESSIBILITY
  // =========================================================================
  describe('3. QC Workspace & Confidence Visualizer', () => {
    it('should highlight low-confidence pages and render editable correction textarea', () => {
      const html = QcWorkspaceView.render({
        documentId: 'doc-qc-101',
        title: 'Damaged Receipt 442',
        pageNumber: 1,
        totalPages: 2,
        ocrConfidence: 68.2,
        previewUrl: '/api/v1/documents/doc-qc-101/pages/1/preview',
        extractedText: 'TOTAL: $14.99 (Low confidence)',
        isLowConfidence: true,
      });

      assert.ok(html.includes('confidence-low'));
      assert.ok(html.includes('Review Required'));
      assert.ok(html.includes('id="ocr-text-editor"'));
      assert.ok(html.includes('btn-qc-approve'));
      assert.ok(html.includes('btn-qc-rescan'));
    });
  });

  // =========================================================================
  // 4. COMPLIANCE & LEGAL HOLD LOCKOUT
  // =========================================================================
  describe('4. Legal Hold UI Indicators & Deletion Lockouts', () => {
    it('should render warning banner and disable deletion button when legal hold is active', () => {
      const html = ComplianceView.render({
        documentId: 'doc-litigation-77',
        title: 'Executive Contract 2026',
        isLegalHold: true,
        legalHoldReason: 'Department of Justice Subpoena Ref #882',
        retentionPolicyName: 'SEC 7-Year Retention',
        retentionExpirationDate: '2033-08-28',
        isPurged: false,
      });

      assert.ok(html.includes('ACTIVE LITIGATION / REGULATORY HOLD'));
      assert.ok(html.includes('Locked by Legal Hold'));
      assert.ok(html.includes('disabled'));
    });
  });

  // =========================================================================
  // 5. ADMINISTRATION & DR METRICS DASHBOARD
  // =========================================================================
  describe('5. Administration & Disaster Recovery Health Dashboard', () => {
    it('should render scanner fleet status and observed RPO/RTO metrics', () => {
      const html = AdministrationView.render(
        [
          {
            id: 'agent-brother-01',
            scannerModel: 'Brother ADS-4300N',
            status: 'ONLINE',
            ipAddress: '192.168.1.150',
            lastHeartbeat: 'Just now',
          },
        ],
        {
          observedRpoMinutes: 15,
          observedRtoMinutes: 4,
          rpoTargetMinutes: 60,
          rtoTargetMinutes: 30,
          lastDrillStatus: 'SUCCESS',
          lastDrillTimestamp: '2026-08-28',
        }
      );

      assert.ok(html.includes('Brother ADS-4300N'));
      assert.ok(html.includes('15m (Target: 60m)'));
      assert.ok(html.includes('4m (Target: 30m)'));
      assert.ok(html.includes('SUCCESS'));
    });
  });
});
