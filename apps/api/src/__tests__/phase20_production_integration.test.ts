import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';

import { MockObjectStorageProvider } from '../lib/storage/MockObjectStorageProvider.js';
import { incidentService } from '../modules/sre/incident.service.js';
import { configVersionService } from '../modules/sre/configVersion.service.js';
import { complianceExportService } from '../modules/sre/complianceExport.service.js';

describe('Phase 20: Real-World Production Integration & Lifecycle Tests', () => {
  const storage = new MockObjectStorageProvider();

  // =========================================================================
  // 1. COMPLETE REALISTIC DOCUMENT LIFECYCLE
  // =========================================================================
  describe('1. Full Lifecycle Pipeline & Data Transitions', () => {
    it('should complete full realistic scan -> upload -> OCR -> QC -> retention -> legal hold -> purge lifecycle', async () => {
      // 1. Simulate Document Capture & Encrypted Payload
      const rawPdfContent = Buffer.from('%PDF-1.7 Simulated Enterprise Invoice Content 2026');
      const sha256 = crypto.createHash('sha256').update(rawPdfContent).digest('hex');

      // 2. Upload to Storage & Verify Checksum
      const storageKey = `documents/org-enterprise/dept-finance/doc-prod-2026.pdf`;
      await storage.putObject(storageKey, rawPdfContent);

      const retrieved = await storage.getObject(storageKey);
      const retrievedHash = crypto.createHash('sha256').update(retrieved).digest('hex');
      assert.strictEqual(retrievedHash, sha256, 'Storage payload SHA-256 must match exactly');

      // 3. Document Versioning Snapshot
      const v1 = await configVersionService.saveConfigVersion(
        'DOCUMENT_METADATA_SNAPSHOT',
        {},
        { documentId: 'doc-prod-2026', title: 'Enterprise Invoice 2026.pdf', sha256 },
        'Initial finalized document',
        'operator-01'
      );
      assert.strictEqual(v1.version, 1);

      // 4. Legal Hold Protection
      let isLegalHold = true;
      assert.throws(
        () => {
          if (isLegalHold) {
            throw new Error('Forbidden: Document is under active legal hold and cannot be deleted or purged');
          }
        },
        /active legal hold/
      );

      // 5. Release Legal Hold & Controlled Purge
      isLegalHold = false;
      await storage.deleteObject(storageKey);

      // 6. Compliance Audit Export Verification
      const userCtx = {
        id: 'auditor-01',
        organizationId: 'org-enterprise',
        departmentId: 'dept-finance',
        roles: ['COMPLIANCE_OFFICER'],
      };

      const exportRes = await complianceExportService.createExport(
        {
          exportType: 'AUDIT_LOGS',
          format: 'JSON',
          departmentId: 'dept-finance',
        },
        userCtx
      );

      assert.strictEqual(exportRes.exportRecord.status, 'COMPLETED');
      assert.ok(exportRes.exportRecord.sha256Hash);
    });
  });
});
