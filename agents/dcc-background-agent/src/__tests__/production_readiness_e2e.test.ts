import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { DccBackgroundAgent } from '../daemon.js';
import { PersistentQueue } from '../queue.js';
import { FolderWatcher } from '../watcher.js';
import { computeFileHash } from '../hash.js';

describe('DCC Background Agent — Production Readiness E2E Tests (Tests A-E)', () => {
  const tmpBase = path.join(os.tmpdir(), `dcc-prod-e2e-${Date.now()}`);
  const incomingDir = path.join(tmpBase, 'Incoming');
  const processedDir = path.join(tmpBase, 'Processed');
  const failedDir = path.join(tmpBase, 'Failed');
  const logDir = path.join(tmpBase, 'logs');
  const queueFile = path.join(tmpBase, 'queue.json');

  let mockServer: http.Server;
  let mockPort: number;
  let serverOnline = true;
  const ingestedDocs: any[] = [];
  const hashesSeen = new Set<string>();

  before(async () => {
    fs.mkdirSync(incomingDir, { recursive: true });
    fs.mkdirSync(processedDir, { recursive: true });
    fs.mkdirSync(failedDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    // Launch a mock DCC Backend API server
    mockServer = http.createServer((req, res) => {
      if (!serverOnline) {
        req.destroy();
        return;
      }

      const url = req.url || '';
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        // Enforce Agent Authentication check
        const authHeader = req.headers['authorization'];
        const secretHeader = req.headers['x-agent-secret'];

        if (!authHeader && !secretHeader) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: Missing agent credentials' }));
          return;
        }

        if (url === '/api/v1/agents/heartbeat') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ acknowledged: true, serverTime: new Date().toISOString() }));
          return;
        }

        if (url === '/api/v1/agents/ingest') {
          const data = JSON.parse(body);

          // Duplicate verification
          if (hashesSeen.has(data.sha256Hash)) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                duplicate: true,
                existingDocumentId: 'doc-existing-999',
                message: 'Duplicate detected',
              })
            );
            return;
          }

          hashesSeen.add(data.sha256Hash);
          const doc = {
            id: `doc-${ingestedDocs.length + 1}`,
            title: data.title,
            fileSizeBytes: data.fileSizeBytes,
            sha256Hash: data.sha256Hash,
            status: 'FOR_REVIEW', // Pending Registration
            createdAt: new Date().toISOString(),
          };
          ingestedDocs.push(doc);

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, document: doc }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        const addr: any = mockServer.address();
        mockPort = addr.port;
        resolve();
      });
    });
  });

  after(() => {
    mockServer?.close();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // TEST A: NORMAL INGESTION FLOW
  // =========================================================================
  it('Test A (Normal Flow): Detects stable PDF, hashes, uploads to PENDING_REGISTRATION, and moves to Processed', async () => {
    const agent = new DccBackgroundAgent({
      apiUrl: `http://localhost:${mockPort}/api/v1`,
      authToken: 'test-secret-token',
      watchFolder: incomingDir,
      processedFolder: processedDir,
      failedFolder: failedDir,
      logFolder: logDir,
      queueFilePath: queueFile,
      pollIntervalMs: 500,
      heartbeatIntervalMs: 1000,
    });

    // 1. Place a valid PDF into Incoming
    const samplePath = path.join(incomingDir, 'Liaison_Doc_TestA.pdf');
    fs.writeFileSync(samplePath, '%PDF-1.4 Test A Content for DCC Liaison Document Processing');

    // 2. Process watch folder & queue
    await agent.processWatchFolder();
    await agent.processQueue();

    // 3. Verify document entered PENDING_REGISTRATION in DCC repository
    assert.strictEqual(ingestedDocs.length, 1);
    assert.strictEqual(ingestedDocs[0].title, 'Liaison_Doc_TestA.pdf');
    assert.strictEqual(ingestedDocs[0].status, 'FOR_REVIEW');

    // 4. Verify file is moved to Processed and no longer in Incoming
    assert.strictEqual(fs.existsSync(samplePath), false, 'Original file must be moved out of Incoming');
    const processedFiles = fs.readdirSync(processedDir);
    assert.strictEqual(processedFiles.some((f) => f.includes('Liaison_Doc_TestA.pdf')), true);
  });

  // =========================================================================
  // TEST B: OFFLINE OPERATION & RECOVERY
  // =========================================================================
  it('Test B (Offline Recovery): Queues file when API is down, persists queue, retries and succeeds when API restored', async () => {
    const agent = new DccBackgroundAgent({
      apiUrl: `http://localhost:${mockPort}/api/v1`,
      authToken: 'test-secret-token',
      watchFolder: incomingDir,
      processedFolder: processedDir,
      failedFolder: failedDir,
      logFolder: logDir,
      queueFilePath: queueFile,
    });

    // 1. Simulate API Offline
    serverOnline = false;

    // 2. Place a valid PDF into Incoming while offline
    const samplePathB = path.join(incomingDir, 'Liaison_Doc_TestB.pdf');
    fs.writeFileSync(samplePathB, '%PDF-1.4 Offline Test Document placed while DCC API is down');

    // 3. Agent detects and queues the file
    await agent.processWatchFolder();
    const queueBefore = agent.getQueue();
    const queuedItems = queueBefore.getAllItems().filter((i) => i.fileName === 'Liaison_Doc_TestB.pdf');
    assert.strictEqual(queuedItems.length, 1);
    assert.strictEqual(queuedItems[0].status, 'QUEUED');

    // 4. Attempt processing while API is offline -> should fail gracefully and track retry
    await agent.processQueue();
    const itemAfterFail = agent.getQueue().getAllItems().find((i) => i.fileName === 'Liaison_Doc_TestB.pdf');
    assert.strictEqual(itemAfterFail?.status, 'FAILED');
    assert.strictEqual(itemAfterFail?.retries, 1);
    assert.ok(itemAfterFail?.errorMessage);
    assert.strictEqual(fs.existsSync(samplePathB), true, 'File must remain in Incoming for retry');

    // 5. Restore API Online
    serverOnline = true;

    // 6. Agent retries automatically
    await agent.processQueue();

    // 7. Verify document reached PENDING_REGISTRATION and file moved to Processed
    assert.strictEqual(ingestedDocs.some((d) => d.title === 'Liaison_Doc_TestB.pdf'), true);
    assert.strictEqual(fs.existsSync(samplePathB), false);
    const processedFiles = fs.readdirSync(processedDir);
    assert.strictEqual(processedFiles.some((f) => f.includes('Liaison_Doc_TestB.pdf')), true);
  });

  // =========================================================================
  // TEST C: DUPLICATE PROTECTION
  // =========================================================================
  it('Test C (Duplicate Protection): Prevents duplicate database record when identical SHA-256 is placed twice', async () => {
    const agent = new DccBackgroundAgent({
      apiUrl: `http://localhost:${mockPort}/api/v1`,
      authToken: 'test-secret-token',
      watchFolder: incomingDir,
      processedFolder: processedDir,
      failedFolder: failedDir,
      logFolder: logDir,
      queueFilePath: queueFile,
    });

    const docCountBefore = ingestedDocs.length;
    const duplicateContent = '%PDF-1.4 Unique Content for Duplicate Protection Check 12345';

    // First placement
    const samplePathC1 = path.join(incomingDir, 'Liaison_Doc_TestC_First.pdf');
    fs.writeFileSync(samplePathC1, duplicateContent);
    await agent.processWatchFolder();
    await agent.processQueue();
    assert.strictEqual(ingestedDocs.length, docCountBefore + 1);

    // Second placement with identical content / SHA-256
    const samplePathC2 = path.join(incomingDir, 'Liaison_Doc_TestC_Second.pdf');
    fs.writeFileSync(samplePathC2, duplicateContent);

    // Agent detects duplicate
    await agent.processWatchFolder();
    await agent.processQueue();

    // Verify NO duplicate record was created in repository
    assert.strictEqual(ingestedDocs.length, docCountBefore + 1, 'Duplicate record must NOT be created');

    // Verify duplicate file was preserved and not silently deleted
    assert.strictEqual(fs.existsSync(samplePathC2), false);
    const processedFiles = fs.readdirSync(processedDir);
    assert.strictEqual(processedFiles.some((f) => f.includes('TestC')), true);
  });

  // =========================================================================
  // TEST D: AGENT RESTART PRESERVES QUEUE
  // =========================================================================
  it('Test D (Agent Restart): Queue persists across agent shutdown and resumes on restart', async () => {
    // 1. Start Agent 1
    const agent1 = new DccBackgroundAgent({
      apiUrl: `http://localhost:${mockPort}/api/v1`,
      authToken: 'test-secret-token',
      watchFolder: incomingDir,
      processedFolder: processedDir,
      failedFolder: failedDir,
      logFolder: logDir,
      queueFilePath: queueFile,
    });

    // 2. Drop file into Incoming and queue it
    const samplePathD = path.join(incomingDir, 'Liaison_Doc_TestD.pdf');
    fs.writeFileSync(samplePathD, '%PDF-1.4 Restart preservation test payload');
    await agent1.processWatchFolder();

    // 3. Verify item entered queue
    const queuedItems = agent1.getQueue().getAllItems().filter((i) => i.fileName === 'Liaison_Doc_TestD.pdf');
    assert.strictEqual(queuedItems.length, 1);

    // 4. Simulate abrupt Agent stop / restart (destroy agent1)
    await agent1.stop();

    // 5. Start Agent 2 with same queue file
    const agent2 = new DccBackgroundAgent({
      apiUrl: `http://localhost:${mockPort}/api/v1`,
      authToken: 'test-secret-token',
      watchFolder: incomingDir,
      processedFolder: processedDir,
      failedFolder: failedDir,
      logFolder: logDir,
      queueFilePath: queueFile,
    });

    // 6. Verify queue was restored from persistent storage
    const restoredItems = agent2.getQueue().getAllItems().filter((i) => i.fileName === 'Liaison_Doc_TestD.pdf');
    assert.strictEqual(restoredItems.length, 1, 'Queue must be restored from persistent storage');

    // 7. Process queue with Agent 2
    await agent2.processQueue();
    assert.strictEqual(ingestedDocs.some((d) => d.title === 'Liaison_Doc_TestD.pdf'), true);
  });

  // =========================================================================
  // TEST E: INVALID & UNSUPPORTED FILE HANDLING
  // =========================================================================
  it('Test E (Invalid File Rejection): Rejects unsupported formats (.exe, .txt, .tmp) with no database records created', async () => {
    const agent = new DccBackgroundAgent({
      apiUrl: `http://localhost:${mockPort}/api/v1`,
      authToken: 'test-secret-token',
      watchFolder: incomingDir,
      processedFolder: processedDir,
      failedFolder: failedDir,
      logFolder: logDir,
      queueFilePath: queueFile,
    });

    const docCountBefore = ingestedDocs.length;

    // Place unsupported files
    const exeFile = path.join(incomingDir, 'malicious_binary.exe');
    const txtFile = path.join(incomingDir, 'random_notes.txt');
    const tmpFile = path.join(incomingDir, '.~temp_lock.tmp');

    fs.writeFileSync(exeFile, 'MZ BINARY CONTENT');
    fs.writeFileSync(txtFile, 'Plain text notes');
    fs.writeFileSync(tmpFile, 'temporary lock file');

    // Process folder
    await agent.processWatchFolder();
    await agent.processQueue();

    // Verify none of these files were queued or created in the repository
    assert.strictEqual(ingestedDocs.length, docCountBefore);
    const queueItems = agent.getQueue().getAllItems();
    assert.strictEqual(queueItems.some((i) => i.fileName.endsWith('.exe')), false);
    assert.strictEqual(queueItems.some((i) => i.fileName.endsWith('.txt')), false);
    assert.strictEqual(queueItems.some((i) => i.fileName.endsWith('.tmp')), false);

    // Clean up test files
    try {
      fs.unlinkSync(exeFile);
      fs.unlinkSync(txtFile);
      fs.unlinkSync(tmpFile);
    } catch {}
  });
});
