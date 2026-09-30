import fs from 'fs';
import path from 'path';
import { loadConfig, AgentConfig } from './config.js';
import { FolderWatcher } from './watcher.js';
import { PersistentQueue, QueueItem } from './queue.js';
import { computeFileHash } from './hash.js';
import { DccApiClient } from './client.js';

export class DccBackgroundAgent {
  private config: AgentConfig;
  private watcher: FolderWatcher;
  private queue: PersistentQueue;
  private client: DccApiClient;
  private isRunning: boolean = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastSync: string | null = null;
  private isSyncing: boolean = false;

  constructor(configOverrides?: Partial<AgentConfig>) {
    this.config = loadConfig(configOverrides);
    this.watcher = new FolderWatcher(this.config.watchFolder);
    this.queue = new PersistentQueue(this.config.queueFilePath, this.config.maxRetries);
    this.client = new DccApiClient(this.config);
  }

  public getConfig(): AgentConfig {
    return this.config;
  }

  public getQueue(): PersistentQueue {
    return this.queue;
  }

  public logEvent(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level}] ${message}`;
    if (level === 'ERROR') {
      console.error(formatted);
    } else if (level === 'WARN') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    try {
      if (!fs.existsSync(this.config.logFolder)) {
        fs.mkdirSync(this.config.logFolder, { recursive: true });
      }
      const logFile = path.join(this.config.logFolder, 'agent.log');
      const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
      fs.appendFileSync(logFile, `${formatted}${metaStr}\n`, 'utf8');
    } catch {}
  }

  public async start(): Promise<void> {
    this.isRunning = true;

    this.logEvent('INFO', 'Agent started: DCC Document Control Center Background Service');
    this.logEvent('INFO', `Machine Name:      ${this.config.machineName}`);
    this.logEvent('INFO', `Agent Version:     ${this.config.version}`);
    this.logEvent('INFO', `DCC API Gateway:   ${this.config.apiUrl}`);
    this.logEvent('INFO', `Watch Folder:      ${this.config.watchFolder}`);
    this.logEvent('INFO', `Processed Folder:  ${this.config.processedFolder}`);
    this.logEvent('INFO', `Failed Folder:     ${this.config.failedFolder}`);
    this.logEvent('INFO', `Queue File:        ${this.config.queueFilePath}`);
    this.logEvent('INFO', 'Hardware Scanners: DISABLED (Pure Liaison File-Watch Mode)');

    // Ensure working directories exist
    this.watcher.ensureDirectoriesExist([
      this.config.processedFolder,
      this.config.failedFolder,
      this.config.logFolder,
    ]);

    // Send initial heartbeat
    await this.pulseHeartbeat('ONLINE');

    // Start background timers
    this.heartbeatTimer = setInterval(
      () => this.pulseHeartbeat(this.isSyncing ? 'SYNCING' : 'ONLINE'),
      this.config.heartbeatIntervalMs
    );

    this.runPollCycle();
  }

  public async pulseHeartbeat(status: 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'ERROR'): Promise<void> {
    try {
      await this.client.sendHeartbeat(status, this.queue.getStats(), this.lastSync);
      this.logEvent('DEBUG', `Heartbeat sent: Status=${status}`);
    } catch (err: any) {
      this.logEvent('WARN', `API unavailable during heartbeat: ${err.message}`);
    }
  }

  private async runPollCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.processWatchFolder();
      await this.processQueue();
    } catch (err: any) {
      this.logEvent('ERROR', `Error in poll cycle: ${err.message}`);
    } finally {
      if (this.isRunning) {
        this.pollTimer = setTimeout(() => this.runPollCycle(), this.config.pollIntervalMs);
      }
    }
  }

  public async processWatchFolder(): Promise<void> {
    const discovered = await this.watcher.scanFolder();

    for (const file of discovered) {
      try {
        this.logEvent('INFO', `File detected: ${file.fileName} (${file.sizeBytes} bytes)`);
        this.logEvent('INFO', `File stabilized: ${file.fileName}`);

        const hash = await computeFileHash(file.filePath);
        this.logEvent('INFO', `Hash calculated: ${file.fileName} -> SHA-256=${hash.slice(0, 16)}...`);

        // Check if hash is already known in queue or repository
        if (this.queue.isHashKnown(hash)) {
          this.logEvent('WARN', `Duplicate detected: File "${file.fileName}" has identical SHA-256 hash. Preserving file and skipping duplicate queue.`);
          // Move duplicate safely to processed with [DUPLICATE] flag so it doesn't loop
          this.moveFileSafely(file.filePath, this.config.processedFolder, true);
          continue;
        }

        const item = this.queue.enqueue(file.filePath, hash, file.sizeBytes);
        if (item) {
          this.logEvent('INFO', `File queued: ${file.fileName} [Queue ID: ${item.id}]`);
        }
      } catch (err: any) {
        this.logEvent('ERROR', `Failed processing watch file ${file.filePath}: ${err.message}`);
      }
    }
  }

  public async processQueue(): Promise<void> {
    const item = this.queue.getNextPending();
    if (!item) return;

    this.isSyncing = true;
    this.queue.markUploading(item.id);
    this.logEvent('INFO', `Upload started: ${item.fileName} (Attempt ${item.retries + 1}/${item.maxRetries})`);

    try {
      if (!fs.existsSync(item.filePath)) {
        throw new Error(`Local file not found at ${item.filePath}`);
      }

      const uploadResult = await this.client.uploadDocument(
        item.filePath,
        item.sha256Hash,
        item.fileSizeBytes
      );

      this.queue.markSuccess(item.id);
      this.lastSync = new Date().toISOString();

      if (uploadResult.duplicate) {
        this.logEvent('WARN', `Duplicate detected: DCC API confirmed document already exists (ID: ${uploadResult.documentId}). No duplicate record created.`);
      } else {
        this.logEvent('INFO', `Upload successful: ${item.fileName} -> DCC Document ID: ${uploadResult.documentId || 'Created'}`);
      }

      // Safely move file to Processed folder
      const movedPath = this.moveFileSafely(item.filePath, this.config.processedFolder, uploadResult.duplicate);
      if (movedPath) {
        this.logEvent('INFO', `File moved to Processed: ${path.basename(movedPath)}`);
      }
    } catch (err: any) {
      this.logEvent('ERROR', `Upload failed: ${item.fileName} -> Reason: ${err.message}`);
      this.queue.markFailed(item.id, err.message);

      if (item.retries >= item.maxRetries) {
        this.logEvent('ERROR', `Document ${item.fileName} reached max retries (${item.maxRetries}). Moving to Failed dead-letter folder.`);
        const failedPath = this.moveFileSafely(item.filePath, this.config.failedFolder);
        if (failedPath) {
          this.logEvent('INFO', `File moved to Failed: ${path.basename(failedPath)}`);
          // Write clear error reason metadata file beside failed document
          try {
            const metaFile = `${failedPath}.reason.json`;
            fs.writeFileSync(
              metaFile,
              JSON.stringify(
                {
                  fileName: item.fileName,
                  sha256Hash: item.sha256Hash,
                  fileSizeBytes: item.fileSizeBytes,
                  failedAt: new Date().toISOString(),
                  retriesAttempted: item.retries,
                  maxRetries: item.maxRetries,
                  errorReason: item.errorMessage || 'Terminal synchronization failure',
                },
                null,
                2
              ),
              'utf8'
            );
          } catch {}
        }
      } else {
        this.logEvent('INFO', `Retry scheduled: ${item.fileName} (Next attempt in ${this.config.pollIntervalMs}ms)`);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private moveFileSafely(sourcePath: string, targetDir: string, isDuplicate = false): string | null {
    try {
      if (!fs.existsSync(sourcePath)) return null;
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const baseName = path.basename(sourcePath);
      const ext = path.extname(baseName);
      const nameWithoutExt = path.basename(baseName, ext);

      const prefix = isDuplicate ? '[DUPLICATE]_' : '';
      let targetPath = path.join(targetDir, `${prefix}${baseName}`);

      if (fs.existsSync(targetPath)) {
        targetPath = path.join(targetDir, `${prefix}${nameWithoutExt}_${Date.now()}${ext}`);
      }

      fs.renameSync(sourcePath, targetPath);
      return targetPath;
    } catch (err: any) {
      this.logEvent('ERROR', `Error moving file from ${sourcePath} to ${targetDir}: ${err.message}`);
      return null;
    }
  }

  public async stop(): Promise<void> {
    this.logEvent('INFO', 'Agent stopped: Stopping DCC Background Agent gracefully...');
    this.isRunning = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    try {
      await this.pulseHeartbeat('OFFLINE');
    } catch {}

    this.logEvent('INFO', 'DCC Background Agent is OFFLINE.');
  }
}

// Auto-run if executed directly via CLI
if (
  process.argv[1]?.includes('daemon.ts') ||
  process.argv[1]?.includes('daemon.js') ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`
) {
  const agent = new DccBackgroundAgent();
  agent.start().catch((err) => {
    console.error('Fatal DCC Agent Error:', err);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await agent.stop();
    process.exit(0);
  });
}
