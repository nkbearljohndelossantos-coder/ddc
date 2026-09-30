import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import {
  LocalExecutionStore,
  EncryptedScanStorage,
  DurableScanExecutor,
  TwainScannerProvider,
} from '../index.js';

describe('Phase 4 Hardening: Durable Execution, Encryption & Duplicate Scan Prevention Tests', () => {
  const testStorageDir = './.test_agent_state_' + Date.now();
  const testEncryptedDir = './.test_agent_enc_' + Date.now();

  // Cleanup helper
  function cleanupDirs() {
    if (fs.existsSync(testStorageDir)) fs.rmSync(testStorageDir, { recursive: true, force: true });
    if (fs.existsSync(testEncryptedDir)) fs.rmSync(testEncryptedDir, { recursive: true, force: true });
  }

  // =========================================================================
  // 1. ENCRYPTED SCAN STORAGE & DPAPI-DERIVED KEY MANAGEMENT
  // =========================================================================
  describe('1. Authenticated AES-256-GCM Encrypted Storage', () => {
    const encStorage = new EncryptedScanStorage(testEncryptedDir);

    it('should encrypt raw page buffer with AES-256-GCM, write to disk, and wipe plaintext memory', async () => {
      const jobId = 'job-enc-001';
      const pageNumber = 1;
      const rawText = 'Confidential Brother ADS-4300N Acquired Scan Page Data @ 300 DPI';
      const plaintextBuffer = Buffer.from(rawText, 'utf-8');
      const expectedSha256 = crypto.createHash('sha256').update(plaintextBuffer).digest('hex');

      const encResult = await encStorage.writeEncryptedPage(jobId, pageNumber, plaintextBuffer, expectedSha256);

      assert.ok(fs.existsSync(encResult.encryptedFilePath));
      assert.strictEqual(encResult.sha256PlaintextHash, expectedSha256);
      assert.ok(encResult.ivHex.length === 24, 'IV must be 12-byte (24 hex)');
      assert.ok(encResult.authTagHex.length === 32, 'Auth tag must be 16-byte (32 hex)');

      // Verify plaintext memory wipe: buffer should be zeroed
      assert.strictEqual(plaintextBuffer.every((byte) => byte === 0), true, 'Plaintext buffer must be securely zeroed');

      // Verify successful decryption and checksum match
      const decrypted = await encStorage.readAndDecryptPage(encResult);
      assert.strictEqual(decrypted.toString('utf-8'), rawText);
    });

    it('should reject tampered or corrupted ciphertext during decryption', async () => {
      const jobId = 'job-enc-tamper-002';
      const rawText = 'Tamper test sample';
      const plaintextBuffer = Buffer.from(rawText, 'utf-8');
      const sha256 = crypto.createHash('sha256').update(plaintextBuffer).digest('hex');

      const encResult = await encStorage.writeEncryptedPage(jobId, 1, plaintextBuffer, sha256);

      // Corrupt 1 byte in the ciphertext file
      const encryptedData = fs.readFileSync(encResult.encryptedFilePath);
      encryptedData[0] ^= 0xff; // Flip bits
      fs.writeFileSync(encResult.encryptedFilePath, encryptedData);

      // Attempt decrypt: must throw integrity verification error
      await assert.rejects(
        async () => {
          await encStorage.readAndDecryptPage(encResult);
        },
        /Integrity verification failed/
      );
    });
  });

  // =========================================================================
  // 2. DURABLE LOCAL EXECUTION STORE & DUPLICATE PHYSICAL SCAN PREVENTION
  // =========================================================================
  describe('2. Durable Execution State & Duplicate Scan Prevention', () => {
    const executionStore = new LocalExecutionStore(testStorageDir);

    it('should record durable execution and prevent duplicate physical scan on duplicate job receipt', () => {
      const jobId = 'job-dup-001';
      const executionId = 'exec-uuid-101';
      const scannerId = 'BROTHER_ADS_4300N_TWAIN_01';

      // 1. Initial check: should be allowed
      const check1 = executionStore.canStartPhysicalScan(jobId, executionId);
      assert.strictEqual(check1.allowed, true);

      // 2. Record execution
      executionStore.recordJobExecution(jobId, executionId, scannerId, 'TWAIN');
      executionStore.updateState(jobId, 'LOCAL_COMPLETED');

      // 3. Duplicate scan attempt with same jobId: must be BLOCKED
      const check2 = executionStore.canStartPhysicalScan(jobId, 'exec-uuid-retry-102');
      assert.strictEqual(check2.allowed, false, 'Duplicate scan must be prevented');
      assert.ok(check2.reason?.includes('already performed'));
    });

    it('should recover state on agent process restart from persistent storage', () => {
      // Simulate process restart by creating a new LocalExecutionStore instance pointing to same dir
      const restartedStore = new LocalExecutionStore(testStorageDir);
      const recovered = restartedStore.getExecutionByJobId('job-dup-001');

      assert.ok(recovered, 'Execution record must survive restart');
      assert.strictEqual(recovered.jobId, 'job-dup-001');
      assert.strictEqual(recovered.state, 'LOCAL_COMPLETED');
    });
  });

  // =========================================================================
  // 3. DURABLE SCAN EXECUTOR END-TO-END WORKFLOW & CANCELLATION
  // =========================================================================
  describe('3. Durable Scan Executor Workflow & Cancellation', () => {
    const store = new LocalExecutionStore(testStorageDir);
    const encStorage = new EncryptedScanStorage(testEncryptedDir);
    const executor = new DurableScanExecutor(store, encStorage);
    const twainProvider = new TwainScannerProvider();

    it('should execute physical scan, persist encrypted pages, and update durable state to LOCAL_COMPLETED', async () => {
      const request = {
        jobId: 'job-e2e-001',
        executionId: 'exec-e2e-101',
        scannerId: 'BROTHER_ADS_4300N_TWAIN_01',
        providerType: 'TWAIN',
        options: {
          scannerId: 'BROTHER_ADS_4300N_TWAIN_01',
          resolutionDpi: 300,
          colorMode: 'COLOR_24BIT' as const,
          duplex: true,
          maxPages: 2,
        },
      };

      const result = await executor.executeJob(request, twainProvider);

      assert.strictEqual(result.record.state, 'LOCAL_COMPLETED');
      assert.strictEqual(result.pages.length, 2);
      assert.ok(fs.existsSync(result.pages[0].encryptedFilePath));
      assert.ok(fs.existsSync(result.pages[1].encryptedFilePath));
    });

    it('should handle cancellation request and transition to CANCELLED state', async () => {
      const cancelJobId = 'job-cancel-test-002';
      store.recordJobExecution(cancelJobId, 'exec-cancel-102', 'BROTHER_ADS_4300N_TWAIN_01', 'TWAIN');
      store.updateState(cancelJobId, 'SCANNING');

      executor.requestCancellation(cancelJobId);

      const record = store.getExecutionByJobId(cancelJobId);
      assert.strictEqual(record?.state, 'CANCELLATION_REQUESTED');

      // Finalize cancellation
      store.updateState(cancelJobId, 'CANCELLED');
      assert.strictEqual(store.getExecutionByJobId(cancelJobId)?.state, 'CANCELLED');
    });
  });
});
