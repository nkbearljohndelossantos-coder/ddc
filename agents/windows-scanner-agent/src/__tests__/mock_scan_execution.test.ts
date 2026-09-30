import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockScanExecutionProvider } from '../index.js';

describe('Windows Scanner Agent: MockScanExecutionProvider Tests', () => {
  it('should simulate successful scan job acquisition and emit pages', async () => {
    const executor = new MockScanExecutionProvider();
    const emittedPages: number[] = [];
    let started = false;
    let completed = false;

    executor.on('job:started', (data) => {
      started = true;
      assert.strictEqual(data.jobId, 'job-test-101');
    });

    executor.on('page:scanned', (data) => {
      emittedPages.push(data.pageNumber);
    });

    executor.on('job:completed', (data) => {
      completed = true;
      assert.strictEqual(data.totalPagesScanned, 3);
    });

    await executor.executeJob({
      jobId: 'job-test-101',
      scannerId: 'BROTHER_ADS4300N_SN12345',
      resolutionDpi: 300,
      duplex: true,
      colorMode: 'COLOR_24BIT',
      pagesToSimulate: 3,
    });

    assert.strictEqual(started, true);
    assert.deepStrictEqual(emittedPages, [1, 2, 3]);
    assert.strictEqual(completed, true);
  });

  it('should simulate hardware error event (paper jam) when requested', async () => {
    const executor = new MockScanExecutionProvider();
    let failedError = '';

    executor.on('job:failed', (data) => {
      failedError = data.error;
    });

    await executor.executeJob({
      jobId: 'job-test-fail-102',
      scannerId: 'BROTHER_ADS4300N_SN12345',
      resolutionDpi: 300,
      duplex: true,
      colorMode: 'COLOR_24BIT',
      simulateFailure: true,
    });

    assert.ok(failedError.includes('paper jam'));
  });
});
