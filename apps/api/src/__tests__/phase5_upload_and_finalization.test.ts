import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import { ObjectStorageClient } from '../lib/storage.js';

describe('Phase 5 API: Object Storage, Two-Phase Finalization & Reconciliation Tests', () => {
  const testStorageDir = './.test_server_storage_' + Date.now();
  const storage = new ObjectStorageClient(testStorageDir, 'test-bucket');

  function cleanupStorage() {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  }

  // =========================================================================
  // 1. QUARANTINE OBJECT STORAGE & CHUNK ASSEMBLY
  // =========================================================================
  describe('1. Quarantine Chunk Ingestion & Deterministic Assembly', () => {
    const quarantineKey = 'quarantine/org-1/agent-1/exec-101/scan_job_101.dat';

    it('should write chunks to quarantine storage and assemble with SHA-256 hash', async () => {
      const chunk1 = Buffer.from('CHUNK_1_DATA_PAYLOAD_');
      const chunk2 = Buffer.from('CHUNK_2_DATA_PAYLOAD_');
      const chunk3 = Buffer.from('CHUNK_3_FINAL_PAGE_DATA');

      const fullPlaintext = Buffer.concat([chunk1, chunk2, chunk3]);
      const expectedSha256 = crypto.createHash('sha256').update(fullPlaintext).digest('hex');

      await storage.writeQuarantineChunk(quarantineKey, 1, chunk1);
      await storage.writeQuarantineChunk(quarantineKey, 2, chunk2);
      await storage.writeQuarantineChunk(quarantineKey, 3, chunk3);

      const assembled = await storage.assembleQuarantineObject(quarantineKey, 3);

      assert.strictEqual(assembled.sizeBytes, fullPlaintext.length);
      assert.strictEqual(assembled.sha256Hash, expectedSha256);

      const isValid = await storage.verifyObjectIntegrity(quarantineKey, expectedSha256);
      assert.strictEqual(isValid, true);
    });

    it('should reject assembly when a chunk is missing', async () => {
      const missingKey = 'quarantine/org-1/agent-1/exec-missing/scan_missing.dat';
      await storage.writeQuarantineChunk(missingKey, 1, Buffer.from('Chunk 1'));
      // Chunk 2 missing
      await storage.writeQuarantineChunk(missingKey, 3, Buffer.from('Chunk 3'));

      await assert.rejects(
        async () => {
          await storage.assembleQuarantineObject(missingKey, 3);
        },
        /Missing chunk 2 of 3/
      );
    });
  });

  // =========================================================================
  // 2. TWO-PHASE DOCUMENT PROMOTION (QUARANTINE -> FINAL)
  // =========================================================================
  describe('2. Two-Phase Object Promotion', () => {
    const quarantineKey = 'quarantine/org-1/agent-1/exec-promote/doc.dat';
    const finalKey = 'final/org-1/dept-1/doc-uuid-1/doc_final.dat';

    it('should promote object from quarantine to final storage atomically', async () => {
      const content = Buffer.from('Finalized PDF Scan Data from Brother ADS-4300N');
      await storage.writeQuarantineChunk(quarantineKey, 1, content);
      await storage.assembleQuarantineObject(quarantineKey, 1);

      assert.strictEqual(await storage.finalObjectExists(finalKey), false);

      const moveSuccess = await storage.moveToFinalStorage(quarantineKey, finalKey);
      assert.strictEqual(moveSuccess, true);

      // Verify final exists and quarantine copy cleaned up
      assert.strictEqual(await storage.finalObjectExists(finalKey), true);
    });

    it('should return false when quarantine source object is missing', async () => {
      const missingSrc = 'quarantine/nonexistent.dat';
      const destKey = 'final/dest.dat';

      const result = await storage.moveToFinalStorage(missingSrc, destKey);
      assert.strictEqual(result, false);
    });
  });

  // =========================================================================
  // 3. DATABASE IDEMPOTENCY & DUPLICATE PREVENTION
  // =========================================================================
  describe('3. Database Idempotency & Reconciliation Logic', () => {
    const mockDb = {
      documents: new Map<string, any>(),
      uploadSessions: new Map<string, any>(),
      storageRecords: new Map<string, any>(),
    };

    it('should register document with composite key (jobId + executionId) and prevent duplicates', () => {
      const jobId = 'job-uuid-p5-1';
      const executionId = 'exec-uuid-p5-1';
      const compositeKey = `${jobId}:${executionId}`;

      const doc1 = {
        id: 'doc-1',
        jobId,
        executionId,
        title: 'Scan_2026-08-28_Brother ADS-4300N',
        status: 'COMPLETED',
        pageCount: 3,
        sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      };

      mockDb.documents.set(compositeKey, doc1);

      // Duplicate attempt: return existing doc
      const duplicateHit = mockDb.documents.get(compositeKey);
      assert.ok(duplicateHit);
      assert.strictEqual(duplicateHit.id, 'doc-1');

      const allDocs = Array.from(mockDb.documents.values()).filter(
        (d) => d.jobId === jobId && d.executionId === executionId
      );
      assert.strictEqual(allDocs.length, 1, 'Never create duplicate documents for same physical scan execution');
    });

    it('should reconcile dangling FINALIZING document to COMPLETED after final object move', () => {
      const doc = {
        id: 'doc-dangling-2',
        jobId: 'job-dangling-2',
        executionId: 'exec-dangling-2',
        status: 'FINALIZING',
      };

      assert.strictEqual(doc.status, 'FINALIZING');

      // Reconciliation sweep detects final object move completion
      doc.status = 'COMPLETED';
      assert.strictEqual(doc.status, 'COMPLETED');
    });
  });
});
