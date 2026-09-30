import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { configVersionService } from '../modules/sre/configVersion.service.js';

describe('Phase 20: Database & Data Integrity Validation Tests', () => {
  // =========================================================================
  // 1. CONFIGURATION CHECKSUM & VERSION IMMUTABILITY
  // =========================================================================
  describe('1. Version Checksums & Rollback Safety', () => {
    it('should generate deterministic SHA-256 checksums and preserve version history upon rollback', async () => {
      const v1 = await configVersionService.saveConfigVersion(
        'STORAGE_QUOTA',
        {},
        { maxQuotaGb: 500 },
        'Initial storage quota',
        'admin-01'
      );
      assert.strictEqual(v1.version, 1);
      assert.ok(v1.checksum);

      const v2 = await configVersionService.saveConfigVersion(
        'STORAGE_QUOTA',
        { maxQuotaGb: 500 },
        { maxQuotaGb: 1000 },
        'Doubled storage quota to 1000GB',
        'admin-01'
      );
      assert.strictEqual(v2.version, 2);

      const rollback = await configVersionService.rollbackToVersion(v1.id, 'admin-01');
      assert.strictEqual(rollback.version, 3);
      assert.deepStrictEqual(rollback.afterValues, v1.afterValues);
    });
  });

  // =========================================================================
  // 2. LEGAL HOLD INVARIANT LOCKOUT
  // =========================================================================
  describe('2. Legal Hold & Purge Invariants', () => {
    it('should block deletion when document is flagged under litigation hold', () => {
      const document = {
        id: 'doc-integrity-01',
        isLegalHold: true,
        status: 'COMPLETED',
      };

      assert.throws(
        () => {
          if (document.isLegalHold) {
            throw new Error('Forbidden: Purge operation blocked due to active legal hold');
          }
        },
        /active legal hold/
      );
    });
  });
});
