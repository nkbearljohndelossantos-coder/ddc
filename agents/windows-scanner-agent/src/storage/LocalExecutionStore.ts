import fs from 'fs';
import path from 'path';

export type DurableExecutionState =
  | 'RECEIVED'
  | 'PREPARING'
  | 'SCANNING'
  | 'LOCAL_COMPLETED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED'
  | 'FAILED';

export interface DurableExecutionRecord {
  jobId: string;
  executionId: string;
  scannerId: string;
  providerType: string;
  state: DurableExecutionState;
  pageCount: number;
  startedAt: string;
  updatedAt: string;
  lastError: string | null;
  cancellationRequested?: boolean;
}

/**
 * Local persistent store for scan execution records.
 * Ensures duplicate physical scan prevention and survives agent restarts.
 */
export class LocalExecutionStore {
  private dbPath: string;
  private inMemoryIndex: Map<string, DurableExecutionRecord> = new Map();

  constructor(storageDir: string = './.agent_state') {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.dbPath = path.join(storageDir, 'durable_executions.json');
    this.loadState();
  }

  private loadState(): void {
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const list: DurableExecutionRecord[] = JSON.parse(raw);
        for (const item of list) {
          this.inMemoryIndex.set(item.jobId, item);
        }
      } catch (err) {
        // Fallback to fresh state if file is unreadable
      }
    }
  }

  private persistState(): void {
    const list = Array.from(this.inMemoryIndex.values());
    fs.writeFileSync(this.dbPath, JSON.stringify(list, null, 2), 'utf-8');
  }

  /**
   * Checks whether a physical scan may start.
   * Prevents duplicate physical scans if the job has already been executed or is currently active.
   */
  canStartPhysicalScan(jobId: string, executionId: string): { allowed: boolean; reason?: string; existing?: DurableExecutionRecord } {
    const existing = this.inMemoryIndex.get(jobId);
    if (!existing) {
      return { allowed: true };
    }

    if (existing.state === 'LOCAL_COMPLETED' || existing.state === 'SCANNING' || existing.state === 'PREPARING') {
      return {
        allowed: false,
        reason: `Physical scan already performed or in-progress for Job ${jobId} (State: ${existing.state}, Execution: ${existing.executionId})`,
        existing,
      };
    }

    // If previously failed or cancelled, a new executionId is required
    if (existing.executionId === executionId && existing.state === 'CANCELLED') {
      return {
        allowed: false,
        reason: `Execution ${executionId} was previously cancelled`,
        existing,
      };
    }

    return { allowed: true };
  }

  recordJobExecution(
    jobId: string,
    executionId: string,
    scannerId: string,
    providerType: string
  ): DurableExecutionRecord {
    const record: DurableExecutionRecord = {
      jobId,
      executionId,
      scannerId,
      providerType,
      state: 'RECEIVED',
      pageCount: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: null,
    };

    this.inMemoryIndex.set(jobId, record);
    this.persistState();
    return record;
  }

  updateState(jobId: string, state: DurableExecutionState, error?: string): DurableExecutionRecord | null {
    const record = this.inMemoryIndex.get(jobId);
    if (!record) return null;

    record.state = state;
    record.updatedAt = new Date().toISOString();
    if (error) {
      record.lastError = error;
    }
    this.persistState();
    return record;
  }

  incrementPageCount(jobId: string): DurableExecutionRecord | null {
    const record = this.inMemoryIndex.get(jobId);
    if (!record) return null;

    record.pageCount += 1;
    record.updatedAt = new Date().toISOString();
    this.persistState();
    return record;
  }

  getExecutionByJobId(jobId: string): DurableExecutionRecord | undefined {
    return this.inMemoryIndex.get(jobId);
  }

  getAllExecutions(): DurableExecutionRecord[] {
    return Array.from(this.inMemoryIndex.values());
  }

  clear(): void {
    this.inMemoryIndex.clear();
    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }
  }
}
