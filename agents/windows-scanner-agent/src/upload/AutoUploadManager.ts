import crypto from 'crypto';
import { EventEmitter } from 'events';
import { EncryptedScanStorage, EncryptedPageFile } from '../storage/EncryptedScanStorage.js';
import { LocalExecutionStore } from '../storage/LocalExecutionStore.js';

export interface UploadProgressEvent {
  jobId: string;
  executionId: string;
  uploadedChunks: number;
  totalChunks: number;
  percent: number;
}

export interface IUploadTransport {
  createOrResumeSession(payload: {
    jobId: string;
    executionId: string;
    totalBytes: number;
    totalChunks: number;
    fileHash: string;
    pageNumber?: number;
  }): Promise<{ sessionId: string; nextChunkNumber: number; resumed: boolean }>;

  uploadChunk(
    sessionId: string,
    chunkNumber: number,
    chunkBuffer: Buffer,
    chunkHash: string
  ): Promise<{ acknowledged: boolean; uploadedChunks: number }>;

  completeSession(
    sessionId: string,
    payload: { fileHash: string; pageCount: number }
  ): Promise<{ status: string; document: any }>;
}

export class AutoUploadManager extends EventEmitter {
  private encryptedStorage: EncryptedScanStorage;
  private executionStore: LocalExecutionStore;
  private transport?: IUploadTransport;
  private chunkSize: number;

  constructor(
    encryptedStorage?: EncryptedScanStorage,
    executionStore?: LocalExecutionStore,
    transport?: IUploadTransport,
    chunkSize: number = 512 * 1024 // 512KB default chunk size
  ) {
    super();
    this.encryptedStorage = encryptedStorage || new EncryptedScanStorage();
    this.executionStore = executionStore || new LocalExecutionStore();
    this.transport = transport;
    this.chunkSize = chunkSize;
  }

  setTransport(transport: IUploadTransport) {
    this.transport = transport;
  }

  /**
   * Automatically executes the resumable upload workflow for a locally completed job.
   */
  async uploadJobPages(
    jobId: string,
    executionId: string,
    pages: EncryptedPageFile[]
  ): Promise<{ success: boolean; document?: any; error?: string }> {
    if (!this.transport) {
      throw new Error('Upload transport not configured on agent');
    }

    try {
      this.emit('upload:started', { jobId, executionId, totalPages: pages.length });

      // 1. Read and combine pages into bounded stream / calculate total hash
      const pageBuffers: Buffer[] = [];
      let totalBytes = 0;

      for (const page of pages) {
        const decrypted = await this.encryptedStorage.readAndDecryptPage(page);
        pageBuffers.push(decrypted);
        totalBytes += decrypted.length;
      }

      const completeFileBuffer = Buffer.concat(pageBuffers);
      const fileHash = crypto.createHash('sha256').update(completeFileBuffer).digest('hex');

      // 2. Slice into chunks
      const chunks: Buffer[] = [];
      for (let offset = 0; offset < completeFileBuffer.length; offset += this.chunkSize) {
        chunks.push(completeFileBuffer.subarray(offset, offset + this.chunkSize));
      }

      const totalChunks = chunks.length;

      // 3. Create or Resume Upload Session
      const sessionResult = await this.transport.createOrResumeSession({
        jobId,
        executionId,
        totalBytes,
        totalChunks,
        fileHash,
        pageNumber: pages.length,
      });

      const sessionId = sessionResult.sessionId;
      const startChunk = sessionResult.nextChunkNumber || 1;

      this.emit('upload:session_ready', {
        jobId,
        sessionId,
        resumed: sessionResult.resumed,
        startChunk,
      });

      // 4. Upload remaining chunks sequentially with retry
      for (let chunkIdx = startChunk - 1; chunkIdx < totalChunks; chunkIdx++) {
        const chunkNumber = chunkIdx + 1;
        const chunkBuffer = chunks[chunkIdx];
        const chunkHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex');

        let attempts = 0;
        let uploaded = false;

        while (!uploaded && attempts < 3) {
          try {
            attempts++;
            const ack = await this.transport.uploadChunk(sessionId, chunkNumber, chunkBuffer, chunkHash);
            if (ack.acknowledged) {
              uploaded = true;
              this.emit('upload:progress', {
                jobId,
                executionId,
                uploadedChunks: chunkNumber,
                totalChunks,
                percent: Math.round((chunkNumber / totalChunks) * 100),
              } as UploadProgressEvent);
            }
          } catch (err: any) {
            if (attempts >= 3) {
              throw new Error(`Failed to upload chunk ${chunkNumber} after 3 attempts: ${err.message}`);
            }
            // Exponential backoff
            await new Promise((r) => setTimeout(r, attempts * 500));
          }
        }
      }

      // 5. Complete Session & Trigger Server Finalization
      const finalResult = await this.transport.completeSession(sessionId, {
        fileHash,
        pageCount: pages.length,
      });

      // 6. Local Cleanup Policy: Delete local encrypted files ONLY after server marks COMPLETED
      if (finalResult.status === 'COMPLETED') {
        await this.encryptedStorage.cleanupJobStorage(jobId);
        this.emit('upload:completed', { jobId, executionId, document: finalResult.document });
        return { success: true, document: finalResult.document };
      }

      return { success: false, error: 'Server did not mark document COMPLETED' };
    } catch (err: any) {
      this.emit('upload:failed', { jobId, executionId, error: err.message });
      // Retain local encrypted storage for subsequent retry
      return { success: false, error: err.message };
    }
  }
}
