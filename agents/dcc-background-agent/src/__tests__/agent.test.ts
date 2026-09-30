import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FolderWatcher } from '../watcher.js';
import { PersistentQueue } from '../queue.js';
import { computeFileHash, computeBufferHash } from '../hash.js';
import { DccBackgroundAgent } from '../daemon.js';

describe('DCC Background Agent Tests', () => {
  const testTmpDir = path.join(os.tmpdir(), `dcc-agent-test-${Date.now()}`);
  const watchDir = path.join(testTmpDir, 'Incoming');
  const processedDir = path.join(testTmpDir, 'Processed');
  const failedDir = path.join(testTmpDir, 'Failed');
  const queueFile = path.join(testTmpDir, 'queue.json');

  before(() => {
    fs.mkdirSync(watchDir, { recursive: true });
    fs.mkdirSync(processedDir, { recursive: true });
    fs.mkdirSync(failedDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. File Type Validation & Hash Generation', () => {
    it('should correctly validate supported liaison document extensions', () => {
      const watcher = new FolderWatcher(watchDir);
      assert.strictEqual(watcher.isSupportedFile('invoice.pdf'), true);
      assert.strictEqual(watcher.isSupportedFile('SCAN_2026.PDF'), true);
      assert.strictEqual(watcher.isSupportedFile('document.jpg'), true);
      assert.strictEqual(watcher.isSupportedFile('document.jpeg'), true);
      assert.strictEqual(watcher.isSupportedFile('attachment.png'), true);
      assert.strictEqual(watcher.isSupportedFile('dossier.tiff'), true);
      assert.strictEqual(watcher.isSupportedFile('dossier.tif'), true);

      // Unsupported or temp files
      assert.strictEqual(watcher.isSupportedFile('script.exe'), false);
      assert.strictEqual(watcher.isSupportedFile('.~lock.file.pdf'), false);
      assert.strictEqual(watcher.isSupportedFile('doc.tmp'), false);
      assert.strictEqual(watcher.isSupportedFile('notes.txt'), false);
    });

    it('should compute consistent SHA-256 hash for document content', async () => {
      const sampleContent = 'Enterprise DCC Document Content for SHA256 Verification';
      const sampleFile = path.join(watchDir, 'test_sample.pdf');
      fs.writeFileSync(sampleFile, sampleContent, 'utf8');

      const fileHash = await computeFileHash(sampleFile);
      const bufferHash = computeBufferHash(Buffer.from(sampleContent, 'utf8'));

      assert.strictEqual(fileHash, bufferHash);
      assert.strictEqual(fileHash.length, 64);
    });
  });

  describe('2. Persistent Offline Queue & Duplicate Prevention', () => {
    it('should enqueue newly detected files and save queue state', () => {
      const queue = new PersistentQueue(queueFile, 3);
      const filePath = path.join(watchDir, 'sample_doc_1.pdf');
      const hash = 'a1b2c3d4e5f67890123456789012345678901234567890123456789012345678';

      const item = queue.enqueue(filePath, hash, 1024);
      assert.ok(item);
      assert.strictEqual(item.status, 'QUEUED');
      assert.strictEqual(item.fileName, 'sample_doc_1.pdf');

      // Duplicate protection: Enqueuing the same hash should return null
      const duplicateItem = queue.enqueue(filePath, hash, 1024);
      assert.strictEqual(duplicateItem, null, 'Duplicate SHA-256 hash must be rejected');

      // Check stats
      const stats = queue.getStats();
      assert.strictEqual(stats.queued, 1);
      assert.strictEqual(stats.total, 1);
    });

    it('should reload queue from disk correctly', () => {
      const reloadedQueue = new PersistentQueue(queueFile, 3);
      const items = reloadedQueue.getAllItems();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].fileName, 'sample_doc_1.pdf');
    });

    it('should transition status from QUEUED -> UPLOADING -> PROCESSED', () => {
      const queue = new PersistentQueue(queueFile, 3);
      const item = queue.getNextPending();
      assert.ok(item);

      queue.markUploading(item.id);
      assert.strictEqual(queue.getAllItems()[0].status, 'UPLOADING');

      queue.markSuccess(item.id);
      assert.strictEqual(queue.getAllItems()[0].status, 'PROCESSED');
      assert.ok(queue.getAllItems()[0].completedAt);

      const stats = queue.getStats();
      assert.strictEqual(stats.processed, 1);
      assert.strictEqual(stats.queued, 0);
    });

    it('should handle failure and retry counting', () => {
      const queue = new PersistentQueue(queueFile, 3);
      const filePath2 = path.join(watchDir, 'failed_doc.pdf');
      const hash2 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const item = queue.enqueue(filePath2, hash2, 2048);
      assert.ok(item);

      queue.markFailed(item.id, 'Connection refused to DCC Gateway');
      const updated = queue.getAllItems().find((i) => i.id === item.id);
      assert.strictEqual(updated?.status, 'FAILED');
      assert.strictEqual(updated?.retries, 1);
      assert.strictEqual(updated?.errorMessage, 'Connection refused to DCC Gateway');
    });
  });

  describe('3. DccBackgroundAgent Instantiation & Configuration', () => {
    it('should initialize agent with customized paths and load watcher/queue', () => {
      const agent = new DccBackgroundAgent({
        watchFolder: watchDir,
        processedFolder: processedDir,
        failedFolder: failedDir,
        queueFilePath: path.join(testTmpDir, 'agent_live_queue.json'),
        apiUrl: 'http://localhost:4000/api/v1',
      });

      const config = agent.getConfig();
      assert.strictEqual(config.watchFolder, watchDir);
      assert.strictEqual(config.processedFolder, processedDir);
      assert.strictEqual(config.failedFolder, failedDir);
      assert.ok(config.machineName);
      assert.strictEqual(config.version, '1.2.0');
    });
  });
});
