import { EventEmitter } from 'events';
import { IScannerProvider } from '../core/types.js';
import { LocalExecutionStore, DurableExecutionRecord } from '../storage/LocalExecutionStore.js';
import { EncryptedScanStorage, EncryptedPageFile } from '../storage/EncryptedScanStorage.js';
import { ScanAcquisitionOptions, AcquiredPageFrame } from '../core/driverEvents.js';

export interface ScanJobExecutionRequest {
  jobId: string;
  executionId: string;
  scannerId: string;
  providerType: string;
  options: ScanAcquisitionOptions;
}

export class DurableScanExecutor extends EventEmitter {
  private executionStore: LocalExecutionStore;
  private encryptedStorage: EncryptedScanStorage;
  private isCancelling: Map<string, boolean> = new Map();

  constructor(
    executionStore?: LocalExecutionStore,
    encryptedStorage?: EncryptedScanStorage
  ) {
    super();
    this.executionStore = executionStore || new LocalExecutionStore();
    this.encryptedStorage = encryptedStorage || new EncryptedScanStorage();
  }

  /**
   * Executes a scan job with durable state tracking and duplicate scan prevention.
   */
  async executeJob(
    request: ScanJobExecutionRequest,
    provider: IScannerProvider
  ): Promise<{ record: DurableExecutionRecord; pages: EncryptedPageFile[] }> {
    // 1. Duplicate Physical Scan Prevention
    const check = this.executionStore.canStartPhysicalScan(request.jobId, request.executionId);
    if (!check.allowed) {
      this.emit('scan:duplicate_prevented', {
        jobId: request.jobId,
        executionId: request.executionId,
        reason: check.reason,
      });
      return {
        record: check.existing!,
        pages: [],
      };
    }

    // 2. Record initial execution in local persistent state
    const record = this.executionStore.recordJobExecution(
      request.jobId,
      request.executionId,
      request.scannerId,
      request.providerType
    );

    this.executionStore.updateState(request.jobId, 'PREPARING');
    this.emit('scan:preparing', { jobId: request.jobId, executionId: request.executionId });

    const storedEncryptedPages: EncryptedPageFile[] = [];

    try {
      this.executionStore.updateState(request.jobId, 'SCANNING');
      this.emit('scan:started', { jobId: request.jobId, executionId: request.executionId });

      // 3. Acquire pages via provider
      await (provider as any).acquirePages(request.options, async (frame: AcquiredPageFrame) => {
        // Check for cancellation before persisting page
        if (this.isCancelling.get(request.jobId)) {
          throw new Error('CANCELLATION_CONFIRMED');
        }

        // 4. Persist encrypted page
        const encPage = await this.encryptedStorage.writeEncryptedPage(
          request.jobId,
          frame.pageNumber,
          frame.rawBuffer,
          frame.sha256Hash
        );

        storedEncryptedPages.push(encPage);
        this.executionStore.incrementPageCount(request.jobId);

        this.emit('page:encrypted_and_stored', {
          jobId: request.jobId,
          pageNumber: frame.pageNumber,
          sha256Hash: frame.sha256Hash,
          encryptedFilePath: encPage.encryptedFilePath,
        });
      });

      // 5. Transition to LOCAL_COMPLETED
      const finalRecord = this.executionStore.updateState(request.jobId, 'LOCAL_COMPLETED');
      this.emit('scan:local_completed', {
        jobId: request.jobId,
        executionId: request.executionId,
        totalPages: storedEncryptedPages.length,
      });

      return {
        record: finalRecord!,
        pages: storedEncryptedPages,
      };
    } catch (err: any) {
      if (err.message === 'CANCELLATION_CONFIRMED') {
        const cancelledRecord = this.executionStore.updateState(request.jobId, 'CANCELLED');
        this.isCancelling.delete(request.jobId);
        this.emit('scan:cancelled', { jobId: request.jobId, executionId: request.executionId });
        return { record: cancelledRecord!, pages: storedEncryptedPages };
      }

      const failedRecord = this.executionStore.updateState(request.jobId, 'FAILED', err.message);
      this.emit('scan:failed', {
        jobId: request.jobId,
        executionId: request.executionId,
        error: err.message,
      });
      return { record: failedRecord!, pages: storedEncryptedPages };
    }
  }

  /**
   * Requests cancellation of an in-progress scan job.
   */
  requestCancellation(jobId: string): void {
    const existing = this.executionStore.getExecutionByJobId(jobId);
    if (existing && existing.state === 'SCANNING') {
      this.isCancelling.set(jobId, true);
      this.executionStore.updateState(jobId, 'CANCELLATION_REQUESTED');
      this.emit('scan:cancellation_requested', { jobId });
    }
  }

  /**
   * Reconciles existing state upon agent restart.
   */
  reconcileOnRestart(): DurableExecutionRecord[] {
    return this.executionStore.getAllExecutions();
  }
}
