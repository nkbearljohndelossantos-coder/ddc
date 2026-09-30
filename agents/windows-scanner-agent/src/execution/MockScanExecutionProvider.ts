import { EventEmitter } from 'events';

export interface ScanJobExecutionConfig {
  jobId: string;
  scannerId: string;
  resolutionDpi: number;
  duplex: boolean;
  colorMode: string;
  pagesToSimulate?: number;
  simulateFailure?: boolean;
}

export class MockScanExecutionProvider extends EventEmitter {
  async executeJob(config: ScanJobExecutionConfig): Promise<void> {
    this.emit('job:started', { jobId: config.jobId, scannerId: config.scannerId });

    if (config.simulateFailure) {
      this.emit('job:failed', {
        jobId: config.jobId,
        error: 'Simulated ADF paper jam during scan acquisition',
      });
      return;
    }

    const pages = config.pagesToSimulate || 3;
    for (let page = 1; page <= pages; page++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      this.emit('page:scanned', {
        jobId: config.jobId,
        pageNumber: page,
        totalPages: pages,
      });
    }

    this.emit('job:completed', {
      jobId: config.jobId,
      totalPagesScanned: pages,
    });
  }
}
