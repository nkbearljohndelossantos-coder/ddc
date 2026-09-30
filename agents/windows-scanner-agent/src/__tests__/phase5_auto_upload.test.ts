import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import {
  AutoUploadManager,
  IUploadTransport,
  EncryptedScanStorage,
  EncryptedPageFile,
} from '../index.js';

describe('Phase 5 Agent: Automatic Resumable Chunk Upload & Local Cleanup Tests', () => {
  const testEncryptedDir = './.test_agent_enc_p5_' + Date.now();

  function cleanupDir() {
    if (fs.existsSync(testEncryptedDir)) {
      fs.rmSync(testEncryptedDir, { recursive: true, force: true });
    }
  }

  // =========================================================================
  // 1. AUTOMATIC CHUNKED UPLOAD & RESUMPTION
  // =========================================================================
  describe('1. Resumable Chunk Upload Workflow', () => {
    const encStorage = new EncryptedScanStorage(testEncryptedDir);

    it('should slice scanned pages into chunks and upload sequentially', async () => {
      const jobId = 'job-upload-001';
      const executionId = 'exec-upload-101';

      // Create 2 encrypted pages locally
      const page1Buf = Buffer.from('Page 1 Content: Brother ADS-4300N High-Speed Document Capture', 'utf-8');
      const page2Buf = Buffer.from('Page 2 Content: Tax Form 1040 Schedule C Expense Ledger', 'utf-8');

      const p1 = await encStorage.writeEncryptedPage(
        jobId,
        1,
        page1Buf,
        crypto.createHash('sha256').update(page1Buf).digest('hex')
      );
      const p2 = await encStorage.writeEncryptedPage(
        jobId,
        2,
        page2Buf,
        crypto.createHash('sha256').update(page2Buf).digest('hex')
      );

      const uploadedChunksList: number[] = [];

      const mockTransport: IUploadTransport = {
        async createOrResumeSession(payload) {
          return { sessionId: 'session-uuid-001', nextChunkNumber: 1, resumed: false };
        },
        async uploadChunk(sessionId, chunkNumber, chunkBuffer, chunkHash) {
          uploadedChunksList.push(chunkNumber);
          return { acknowledged: true, uploadedChunks: chunkNumber };
        },
        async completeSession(sessionId, payload) {
          return { status: 'COMPLETED', document: { id: 'doc-uuid-001', status: 'COMPLETED' } };
        },
      };

      const uploadManager = new AutoUploadManager(encStorage, undefined, mockTransport, 64); // 64-byte chunks for testing
      const result = await uploadManager.uploadJobPages(jobId, executionId, [p1, p2]);

      assert.strictEqual(result.success, true);
      assert.ok(uploadedChunksList.length >= 2, 'Must have uploaded multiple chunks');
      assert.strictEqual(uploadedChunksList[0], 1);

      // Verify local cleanup: encrypted directory should be deleted after COMPLETED
      const jobDir = `${testEncryptedDir}/${jobId}`;
      assert.strictEqual(fs.existsSync(jobDir), false, 'Local encrypted files must be wiped after COMPLETED');
    });

    it('should resume from last confirmed chunk without re-uploading from 0', async () => {
      const jobId = 'job-upload-resume-002';
      const executionId = 'exec-upload-resume-102';

      const page1Buf = Buffer.from('Large document page content to split across multiple chunks for resumption test', 'utf-8');
      const p1 = await encStorage.writeEncryptedPage(
        jobId,
        1,
        page1Buf,
        crypto.createHash('sha256').update(page1Buf).digest('hex')
      );

      const uploadedChunksList: number[] = [];

      // Transport simulates resuming at chunk 3
      const mockTransport: IUploadTransport = {
        async createOrResumeSession(payload) {
          return { sessionId: 'session-resume-102', nextChunkNumber: 3, resumed: true };
        },
        async uploadChunk(sessionId, chunkNumber, chunkBuffer, chunkHash) {
          uploadedChunksList.push(chunkNumber);
          return { acknowledged: true, uploadedChunks: chunkNumber };
        },
        async completeSession(sessionId, payload) {
          return { status: 'COMPLETED', document: { id: 'doc-uuid-102', status: 'COMPLETED' } };
        },
      };

      const uploadManager = new AutoUploadManager(encStorage, undefined, mockTransport, 16);
      const result = await uploadManager.uploadJobPages(jobId, executionId, [p1]);

      assert.strictEqual(result.success, true);
      // Chunks 1 and 2 should have been skipped, starting from chunk 3
      assert.strictEqual(uploadedChunksList[0], 3, 'Resumed upload must start from nextChunkNumber');
    });

    it('should retain local encrypted scan data if upload fails', async () => {
      const jobId = 'job-upload-fail-003';
      const executionId = 'exec-upload-fail-103';

      const pageBuf = Buffer.from('Important payload that must not be deleted on network failure', 'utf-8');
      const p1 = await encStorage.writeEncryptedPage(
        jobId,
        1,
        pageBuf,
        crypto.createHash('sha256').update(pageBuf).digest('hex')
      );

      const failingTransport: IUploadTransport = {
        async createOrResumeSession() {
          throw new Error('503 Service Unavailable: Network disconnect');
        },
        async uploadChunk() {
          throw new Error('Network error');
        },
        async completeSession() {
          throw new Error('Network error');
        },
      };

      const uploadManager = new AutoUploadManager(encStorage, undefined, failingTransport, 64);
      const result = await uploadManager.uploadJobPages(jobId, executionId, [p1]);

      assert.strictEqual(result.success, false);

      // Local encrypted files must STILL exist for recovery
      const jobDir = `${testEncryptedDir}/${jobId}`;
      assert.strictEqual(fs.existsSync(jobDir), true, 'Encrypted scan data must be retained on failure');

      cleanupDir();
    });
  });
});
