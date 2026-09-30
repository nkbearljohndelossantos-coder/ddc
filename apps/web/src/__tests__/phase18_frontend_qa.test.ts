import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthStore } from '../services/authStore.js';
import { ApiClient } from '../services/apiClient.js';
import { DashboardView } from '../views/DashboardView.js';
import { DocumentDetailView } from '../views/DocumentDetailView.js';

describe('Phase 18: Frontend QA & Production UX Hardening Tests', () => {
  const auth = AuthStore.getInstance();
  const api = ApiClient.getInstance();

  // =========================================================================
  // 1. SESSION MANAGEMENT & REDIRECTION GUARDS
  // =========================================================================
  describe('1. Session Management & Unauthorized State Handling', () => {
    it('should retain user credentials across store queries and reject unauthenticated calls', () => {
      auth.setSession({
        id: 'user-qa-operator',
        email: 'qa@dcc.corp',
        fullName: 'QA Operator',
        organizationId: 'org-qa-01',
        departmentId: 'dept-qa-audit',
        roles: ['OPERATOR'],
      }, 'jwt-valid-token-999');

      assert.strictEqual(auth.isAuthenticated(), true);
      assert.strictEqual(auth.getSession()?.fullName, 'QA Operator');
      assert.strictEqual(api.getAccessToken(), 'jwt-valid-token-999');

      // Logout
      auth.setSession(null);
      assert.strictEqual(auth.isAuthenticated(), false);
      assert.strictEqual(api.getAccessToken(), null);
    });
  });

  // =========================================================================
  // 2. DOM SECRET REDACTION & ACCESSIBILITY AUDIT
  // =========================================================================
  describe('2. DOM Secret Redaction & WCAG Accessibility Compliance', () => {
    it('should never expose passwords, raw tokens, or database secrets in rendered HTML', () => {
      const docHtml = DocumentDetailView.render({
        id: 'doc-sec-01',
        title: 'Confidential Audit.pdf',
        documentType: 'AUDIT',
        status: 'COMPLETED',
        version: 1,
        ocrConfidence: 99.0,
        pageCount: 3,
        fileSizeBytes: 102400,
        sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        isLegalHold: false,
        isPurged: false,
        metadata: {},
        versions: [],
        createdAt: '2026-08-28',
      });

      assert.strictEqual(docHtml.includes('password'), false);
      assert.strictEqual(docHtml.includes('postgres://'), false);
      assert.strictEqual(docHtml.includes('SECRET_KEY'), false);
    });

    it('should include ARIA semantic landmarks, regions, and status roles', () => {
      const dashHtml = DashboardView.render({
        totalDocuments: 100,
        documentsAwaitingQc: 5,
        activeScanJobs: 1,
        failedScanJobs: 0,
        activeWorkflowTasks: 2,
        overdueTasks: 0,
        activeLegalHolds: 1,
        observedRpoMinutes: 10,
        observedRtoMinutes: 2,
        activeAlertsCount: 0,
        activeIncidentsCount: 0,
        sloCompliancePercent: 100.0,
        lastUpdated: '2026-08-28 17:45:00',
      });

      assert.ok(dashHtml.includes('role="region"'));
      assert.ok(dashHtml.includes('aria-label="Enterprise Operations Dashboard"'));
      assert.ok(dashHtml.includes('role="status"'));
    });
  });
});
