import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { configVersionService } from '../modules/sre/configVersion.service.js';

describe('Phase 19: Release Rollback & Configuration Recovery Tests', () => {
  // =========================================================================
  // 1. CONFIGURATION ROLLBACK & AUDIT IMMUTABILITY
  // =========================================================================
  describe('1. Configuration Versioning & Rollback Safety', () => {
    it('should save versioned configurations, compute SHA-256, and roll back safely', async () => {
      // 1. Save Initial Version
      const v1 = await configVersionService.saveConfigVersion(
        'SCANNER_SETTINGS',
        {},
        { maxDpi: 300, colorMode: 'COLOR' },
        'Initial scanner configuration',
        'admin-01'
      );
      assert.strictEqual(v1.version, 1);
      assert.ok(v1.checksum);

      // 2. Save Updated Version
      const v2 = await configVersionService.saveConfigVersion(
        'SCANNER_SETTINGS',
        { maxDpi: 300, colorMode: 'COLOR' },
        { maxDpi: 600, colorMode: 'COLOR' },
        'Increased max DPI to 600',
        'admin-01'
      );
      assert.strictEqual(v2.version, 2);

      // 3. Rollback to V1
      const rolledBack = await configVersionService.rollbackToVersion(v1.id, 'admin-01');
      assert.strictEqual(rolledBack.version, 3, 'Rollback action must append new version to maintain immutable history');
      assert.deepStrictEqual(rolledBack.afterValues, v1.afterValues);
    });
  });
});
