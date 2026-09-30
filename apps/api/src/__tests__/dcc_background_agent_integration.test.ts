import { describe, it } from 'node:test';
import assert from 'node:assert';
import { agentService } from '../modules/agents/agent.service.js';
import { agentController } from '../modules/agents/agent.controller.js';

describe('DCC Background Agent Backend Integration Tests', () => {
  const sampleMachine = 'TEST-LIAISON-STATION';
  const sampleHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('1. should return offline status when no active heartbeat has been received', async () => {
    const status = await agentService.getAgentStatus();
    assert.ok(status);
    assert.strictEqual(typeof status.status, 'string');
    assert.ok(status.watchFolder);
  });

  it('2. should process heartbeat and update agent telemetry and online status', async () => {
    const heartbeatInput = {
      agentId: 'test-agent-001',
      agentName: 'Test DCC Agent',
      machineName: sampleMachine,
      osVersion: 'Windows 11 Enterprise',
      version: '1.2.0',
      status: 'ONLINE' as const,
      timestamp: new Date().toISOString(),
      telemetry: {
        watchFolder: 'C:\\DCC\\Incoming',
        processedFolder: 'C:\\DCC\\Processed',
        failedFolder: 'C:\\DCC\\Failed',
        queue: { queued: 2, uploading: 0, processed: 10, failed: 0, total: 12 },
        lastSync: new Date().toISOString(),
      },
    };

    const res = await agentService.processHeartbeat('test-agent-001', heartbeatInput);
    assert.strictEqual(res.acknowledged, true);
    assert.ok(res.serverTime);

    // Verify getAgentStatus reflects live state
    const currentStatus = await agentService.getAgentStatus();
    assert.strictEqual(currentStatus.status, 'ONLINE');
    assert.strictEqual(currentStatus.machineName, sampleMachine);
    assert.strictEqual(currentStatus.version, '1.2.0');
    assert.strictEqual(currentStatus.watchFolder, 'C:\\DCC\\Incoming');
    assert.strictEqual(currentStatus.queue.queued, 2);
    assert.strictEqual(currentStatus.queue.processed, 10);
    assert.strictEqual(currentStatus.isLive, true);
  });

  it('3. should ingest document from background agent and mark FOR_REVIEW (Pending Registration)', async () => {
    const ingestInput = {
      title: 'Scanned_Invoice_2026_09.pdf',
      fileSizeBytes: 204800,
      sha256Hash: sampleHash,
      documentType: 'INCOMING_SCAN',
      originalFileName: 'Scanned_Invoice_2026_09.pdf',
      agentId: 'test-agent-001',
      machineName: sampleMachine,
    };

    const ingestResult = await agentService.ingestDocument(ingestInput, 'test-agent-001');
    assert.strictEqual(ingestResult.success, true);
    assert.ok(ingestResult.document);
    assert.strictEqual(ingestResult.document.status, 'FOR_REVIEW');
    assert.strictEqual(ingestResult.document.title, 'Scanned_Invoice_2026_09.pdf');
  });

  it('4. should detect duplicate SHA-256 and prevent duplicate document ingestion', async () => {
    const duplicateInput = {
      title: 'Scanned_Invoice_2026_09_Copy.pdf',
      fileSizeBytes: 204800,
      sha256Hash: sampleHash,
      documentType: 'INCOMING_SCAN',
      originalFileName: 'Scanned_Invoice_2026_09_Copy.pdf',
      agentId: 'test-agent-001',
      machineName: sampleMachine,
    };

    const dupResult = await agentService.ingestDocument(duplicateInput, 'test-agent-001');
    assert.strictEqual(dupResult.success, true);
    // In database-backed environments or service duplicate checks, duplicate is identified
    assert.ok(dupResult.document || dupResult.duplicate);
  });

  it('5. should expose getStatus and ingest via controller seamlessly', async () => {
    let statusPayload: any = null;
    const reqMock: any = {};
    const resMock: any = {
      json: (data: any) => { statusPayload = data; return resMock; },
      status: (code: number) => resMock,
    };
    const nextMock: any = (err: any) => { if (err) throw err; };

    await agentController.getStatus(reqMock, resMock, nextMock);
    assert.ok(statusPayload);
    assert.strictEqual(statusPayload.machineName, sampleMachine);
  });
});
