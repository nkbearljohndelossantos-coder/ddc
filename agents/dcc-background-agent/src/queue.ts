import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type QueueItemStatus = 'QUEUED' | 'UPLOADING' | 'PROCESSED' | 'FAILED';

export interface QueueItem {
  id: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  sha256Hash: string;
  status: QueueItemStatus;
  retries: number;
  maxRetries: number;
  lastAttemptAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface QueueStats {
  queued: number;
  uploading: number;
  processed: number;
  failed: number;
  total: number;
}

export class PersistentQueue {
  private queueFilePath: string;
  private items: Map<string, QueueItem> = new Map();
  private maxRetries: number;

  constructor(queueFilePath: string, maxRetries = 5) {
    this.queueFilePath = queueFilePath;
    this.maxRetries = maxRetries;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.queueFilePath)) {
        const raw = fs.readFileSync(this.queueFilePath, 'utf8');
        const parsed = JSON.parse(raw) as QueueItem[];
        if (Array.isArray(parsed)) {
          this.items.clear();
          for (const item of parsed) {
            // Reset items that were left in UPLOADING state due to previous crash
            if (item.status === 'UPLOADING') {
              item.status = 'QUEUED';
            }
            this.items.set(item.id, item);
          }
        }
      }
    } catch (err) {
      console.error(`[Queue] Failed to load queue file ${this.queueFilePath}:`, err);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.queueFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.items.values());
      fs.writeFileSync(this.queueFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`[Queue] Failed to save queue file ${this.queueFilePath}:`, err);
    }
  }

  public isHashKnown(sha256Hash: string): boolean {
    for (const item of this.items.values()) {
      if (item.sha256Hash.toLowerCase() === sha256Hash.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  public enqueue(filePath: string, sha256Hash: string, fileSizeBytes: number): QueueItem | null {
    if (this.isHashKnown(sha256Hash)) {
      return null;
    }

    const id = crypto.randomUUID();
    const item: QueueItem = {
      id,
      filePath,
      fileName: path.basename(filePath),
      fileSizeBytes,
      sha256Hash,
      status: 'QUEUED',
      retries: 0,
      maxRetries: this.maxRetries,
      lastAttemptAt: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.items.set(id, item);
    this.save();
    return item;
  }

  public getNextPending(): QueueItem | null {
    for (const item of this.items.values()) {
      if (item.status === 'QUEUED') {
        return item;
      }
      if (item.status === 'FAILED' && item.retries < item.maxRetries) {
        return item;
      }
    }
    return null;
  }

  public markUploading(id: string): void {
    const item = this.items.get(id);
    if (item) {
      item.status = 'UPLOADING';
      item.lastAttemptAt = new Date().toISOString();
      this.save();
    }
  }

  public markSuccess(id: string): void {
    const item = this.items.get(id);
    if (item) {
      item.status = 'PROCESSED';
      item.completedAt = new Date().toISOString();
      item.errorMessage = null;
      this.save();
    }
  }

  public markFailed(id: string, error: string): void {
    const item = this.items.get(id);
    if (item) {
      item.retries += 1;
      item.status = 'FAILED';
      item.errorMessage = error;
      item.lastAttemptAt = new Date().toISOString();
      this.save();
    }
  }

  public retryItem(id: string): boolean {
    const item = this.items.get(id);
    if (item && (item.status === 'FAILED' || item.status === 'UPLOADING')) {
      item.status = 'QUEUED';
      item.errorMessage = null;
      this.save();
      return true;
    }
    return false;
  }

  public removeItem(id: string): boolean {
    const deleted = this.items.delete(id);
    if (deleted) {
      this.save();
    }
    return deleted;
  }

  public getAllItems(): QueueItem[] {
    return Array.from(this.items.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public getStats(): QueueStats {
    let queued = 0;
    let uploading = 0;
    let processed = 0;
    let failed = 0;

    for (const item of this.items.values()) {
      switch (item.status) {
        case 'QUEUED':
          queued++;
          break;
        case 'UPLOADING':
          uploading++;
          break;
        case 'PROCESSED':
          processed++;
          break;
        case 'FAILED':
          failed++;
          break;
      }
    }

    return {
      queued,
      uploading,
      processed,
      failed,
      total: this.items.size,
    };
  }
}
