import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { authStore } from '../services/authStore.js';
import { LoginView } from '../views/LoginView.js';
import { NavigationShell, ALL_NAVIGATION_ITEMS } from '../components/NavigationShell.js';
import { DocumentListView } from '../views/DocumentListView.js';
import { DocumentProcessingView } from '../views/DocumentProcessingView.js';
import { DashboardView } from '../views/DashboardView.js';

describe('Phase 21: Final Enterprise UI Polish, Authentication & Navigation Tests', () => {
  beforeEach(() => {
    authStore.setSession(null);
  });

  describe('1. Production Product Identity & Login View', () => {
    it('should render LoginView with NKB Manufacturing and Document Control Center branding', () => {
      const html = LoginView.render();
      assert.match(html, /NKB MANUFACTURING/);
      assert.match(html, /Document Control Center/);
      assert.match(html, /dcc\.nkbmanufacturing\.com/);
      assert.doesNotMatch(html, /demo|prototype|sample/i);
    });

    it('should render accessible email and password inputs with ARIA attributes', () => {
      const html = LoginView.render({ email: 'admin@nkbmanufacturing.com' });
      assert.match(html, /id="login-email"/);
      assert.match(html, /id="login-password"/);
      assert.match(html, /id="toggle-password-btn"/);
      assert.match(html, /aria-required="true"/);
      assert.match(html, /admin@nkbmanufacturing\.com/);
    });

    it('should display error alert when invalid credential message is provided', () => {
      const html = LoginView.render({ error: 'Invalid email or password' });
      assert.match(html, /role="alert"/);
      assert.match(html, /Invalid email or password/);
    });
  });

  describe('2. Collapsible Accordion Navigation & Persona RBAC', () => {
    it('should restrict unauthenticated users from seeing navigation items', () => {
      assert.equal(NavigationShell.getAuthorizedNavItems().length, 0);
    });

    it('should grant Accounting persona access to Document Tool, Processing, and Reports, but NOT System Operation', () => {
      authStore.setSession({
        id: 'usr-acct-1',
        email: 'accountant@nkbmanufacturing.com',
        fullName: 'Accounting Officer',
        roles: ['ACCOUNTING'],
        organizationId: 'org-1',
        departmentId: 'ACCOUNTING',
      }, 'test-token');

      const items = NavigationShell.getAuthorizedNavItems();
      const itemIds = items.map((i) => i.id);

      assert.ok(itemIds.includes('dashboard'));
      assert.ok(itemIds.includes('documents'));
      assert.ok(itemIds.includes('search'));
      assert.ok(itemIds.includes('ocr-processing'));
      assert.ok(itemIds.includes('qc'));
      assert.ok(itemIds.includes('reports'));

      // Must NOT include SRE or Admin items
      assert.ok(!itemIds.includes('health'));
      assert.ok(!itemIds.includes('sre'));
      assert.ok(!itemIds.includes('workers'));
      assert.ok(!itemIds.includes('incidents'));
      assert.ok(!itemIds.includes('users'));
    });

    it('should grant Liaison persona access to Document Tool and Processing, but NOT System Operation', () => {
      authStore.setSession({
        id: 'usr-liaison-1',
        email: 'liaison@nkbmanufacturing.com',
        fullName: 'Liaison Officer',
        roles: ['LIAISON'],
        organizationId: 'org-1',
        departmentId: 'OPERATIONS',
      }, 'test-token');

      const items = NavigationShell.getAuthorizedNavItems();
      const itemIds = items.map((i) => i.id);

      assert.ok(itemIds.includes('dashboard'));
      assert.ok(itemIds.includes('documents'));
      assert.ok(itemIds.includes('scan-jobs'));
      assert.ok(itemIds.includes('ocr-processing'));

      // Must NOT include SRE or Admin items
      assert.ok(!itemIds.includes('health'));
      assert.ok(!itemIds.includes('sre'));
      assert.ok(!itemIds.includes('incidents'));
    });

    it('should grant SUPER_ADMIN full access to all 5 sections and render accordion headers', () => {
      authStore.setSession({
        id: 'usr-admin-1',
        email: 'admin@nkb-scanning.local',
        fullName: 'Super Admin',
        roles: ['SUPER_ADMIN'],
        organizationId: 'org-1',
      }, 'test-token');

      const items = NavigationShell.getAuthorizedNavItems();
      const itemIds = items.map((i) => i.id);

      assert.ok(itemIds.includes('health'));
      assert.ok(itemIds.includes('sre'));
      assert.ok(itemIds.includes('workers'));
      assert.ok(itemIds.includes('incidents'));
      assert.ok(itemIds.includes('users'));
      assert.ok(itemIds.includes('admin'));

      const html = NavigationShell.renderNavHtml('/dashboard');
      assert.match(html, /role="navigation"/);
      assert.match(html, /DOCUMENT TOOL/);
      assert.match(html, /DOCUMENT PROCESSING/);
      assert.match(html, /REPORT & COMPLIANCE/);
      assert.match(html, /SYSTEM OPERATION/);
      assert.match(html, /ADMINISTRATION/);
    });
  });

  describe('3. OCR & Document Processing Integration', () => {
    it('should render DocumentProcessingView with user-friendly terminology', () => {
      const processingHtml = DocumentProcessingView.render([
        {
          id: 'proc-1',
          documentTitle: 'Invoice_NKB_2026_001.pdf',
          departmentId: 'Accounting',
          status: 'COMPLETED',
          ocrConfidence: 98.4,
          submittedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
        {
          id: 'proc-2',
          documentTitle: 'Shipping_Manifest_HQ_08.pdf',
          departmentId: 'Operations',
          status: 'OCR_PROCESSING',
          submittedAt: new Date().toISOString(),
        },
        {
          id: 'proc-3',
          documentTitle: 'Faded_Carbon_Copy_Scan.pdf',
          departmentId: 'Legal',
          status: 'REVIEW_REQUIRED',
          ocrConfidence: 62.1,
          submittedAt: new Date().toISOString(),
          errorMessage: 'Low OCR confidence on page 2',
        },
      ]);

      assert.match(processingHtml, /Text Extraction Complete/);
      assert.match(processingHtml, /OCR Processing/);
      assert.match(processingHtml, /Manual Review Required/);
      assert.match(processingHtml, /98\.4%/);
      assert.doesNotMatch(processingHtml, /tesseract pid|thread_id|spawn/i);
    });

    it('should render clean empty state when no documents are processing', () => {
      const emptyHtml = DocumentProcessingView.render([]);
      assert.match(emptyHtml, /No Active Document Processing/);
      assert.doesNotMatch(emptyHtml, /demo|fake|mock/i);
    });
  });

  describe('4. Professional Empty States & Real Data Fallback', () => {
    it('should render clean empty state for documents without fake mock arrays', () => {
      const emptyHtml = DocumentListView.render([]);
      assert.match(emptyHtml, /No documents found/);
      assert.doesNotMatch(emptyHtml, /fake|mock|demo/i);
    });

    it('should render dashboard with live metrics and accessible landmarks', () => {
      const dashHtml = DashboardView.render({
        totalDocuments: 1428,
        documentsAwaitingQc: 3,
        activeScanJobs: 2,
        failedScanJobs: 0,
        activeWorkflowTasks: 5,
        overdueTasks: 0,
        activeLegalHolds: 1,
        observedRpoMinutes: 15,
        observedRtoMinutes: 4,
        activeAlertsCount: 0,
        activeIncidentsCount: 0,
        sloCompliancePercent: 99.99,
        lastUpdated: new Date().toISOString(),
      });
      assert.match(dashHtml, /Enterprise Overview/);
      assert.match(dashHtml, /1428/);
      assert.match(dashHtml, /Observed RPO \/ RTO/);
    });
  });

  describe('5. DOM Security & Secret Redaction', () => {
    it('should never expose JWTs, database secrets, or raw passwords in rendered HTML', () => {
      const loginHtml = LoginView.render();
      const navHtml = NavigationShell.renderNavHtml('/dashboard');

      assert.doesNotMatch(loginHtml, /postgresql:\/\//i);
      assert.doesNotMatch(loginHtml, /nkb_development_secret/i);
      assert.doesNotMatch(navHtml, /eyJhbGciOi/);
      assert.doesNotMatch(navHtml, /password/i);
    });
  });
});
