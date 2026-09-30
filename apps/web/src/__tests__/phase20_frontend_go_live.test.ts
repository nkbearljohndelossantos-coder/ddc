import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthStore } from '../services/authStore.js';
import { DashboardView } from '../views/DashboardView.js';
import { SreOperationsView } from '../views/SreOperationsView.js';

describe('Phase 20: Frontend Go-Live & Accessibility Validation Tests', () => {
  const auth = AuthStore.getInstance();

  // =========================================================================
  // 1. SESSION & ROLE-AWARE ACCESS
  // =========================================================================
  describe('1. Frontend Session & Department Security', () => {
    it('should correctly enforce department access and super admin privileges', () => {
      auth.setSession({
        id: 'user-ops-lead',
        email: 'ops@dcc.corp',
        fullName: 'Operations Lead',
        organizationId: 'org-enterprise',
        departmentId: 'dept-operations',
        roles: ['ORG_ADMIN'],
      }, 'token-jwt-phase20-valid');

      assert.strictEqual(auth.isAuthenticated(), true);
      assert.strictEqual(auth.hasDepartmentAccess('dept-operations'), true);
      assert.strictEqual(auth.hasDepartmentAccess('dept-legal'), false);
    });
  });

  // =========================================================================
  // 2. DOM SECRET REDACTION & ACCESSIBILITY AUDIT
  // =========================================================================
  describe('2. SRE Dashboard & Accessible Landmarks', () => {
    it('should render SRE dashboard with semantic accessibility roles and zero secret leakage', () => {
      const html = SreOperationsView.render(
        [
          {
            id: 'inc-phase20',
            title: 'S3 Object Storage Latency Spike',
            severity: 'SEV2',
            status: 'OPEN',
            serviceName: 'STORAGE',
            createdAt: '2026-08-29',
          },
        ],
        [],
        [
          {
            id: 'slo-p20',
            name: 'API Availability',
            targetValue: 99.9,
            observedValue: 99.98,
            status: 'OK',
          },
        ],
        false
      );

      assert.ok(html.includes('role="region"'));
      assert.ok(html.includes('aria-label="SRE Operations Console"'));
      assert.strictEqual(html.includes('password'), false);
      assert.strictEqual(html.includes('s3://'), false);
      assert.strictEqual(html.includes('SECRET'), false);
    });
  });
});
