import fs from 'fs';
import path from 'path';
import { AgentConfig } from './config.js';
import { QueueStats } from './queue.js';

export interface HeartbeatPayload {
  agentId: string;
  agentName: string;
  machineName: string;
  osVersion: string;
  version: string;
  status: 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'ERROR';
  timestamp: string;
  telemetry: {
    watchFolder: string;
    processedFolder: string;
    failedFolder: string;
    queue: QueueStats;
    lastSync: string | null;
  };
}

export interface IngestDocumentPayload {
  title: string;
  fileSizeBytes: number;
  sha256Hash: string;
  documentType?: string;
  fileData?: string; // Base64 encoded file data
  originalFileName: string;
  agentId: string;
  machineName: string;
}

export class DccApiClient {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Agent-Id': this.config.agentId,
      'X-Agent-Machine': this.config.machineName,
    };
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
      headers['X-Agent-Secret'] = this.config.authToken;
    }
    return headers;
  }

  public async sendHeartbeat(
    status: 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'ERROR',
    queueStats: QueueStats,
    lastSync: string | null
  ): Promise<{ acknowledged: boolean; serverTime?: string }> {
    const payload: HeartbeatPayload = {
      agentId: this.config.agentId,
      agentName: this.config.agentName,
      machineName: this.config.machineName,
      osVersion: this.config.osVersion,
      version: this.config.version,
      status,
      timestamp: new Date().toISOString(),
      telemetry: {
        watchFolder: this.config.watchFolder,
        processedFolder: this.config.processedFolder,
        failedFolder: this.config.failedFolder,
        queue: queueStats,
        lastSync,
      },
    };

    const url = `${this.config.apiUrl}/agents/heartbeat`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Heartbeat failed (${res.status}): ${errText}`);
    }

    return (await res.json()) as { acknowledged: boolean; serverTime?: string };
  }

  public async uploadDocument(
    filePath: string,
    sha256Hash: string,
    fileSizeBytes: number
  ): Promise<{ success: boolean; duplicate?: boolean; documentId?: string; message?: string }> {
    const fileName = path.basename(filePath);

    // Read and encode file data (capped at reasonable buffer for base64 or stored directly)
    let fileDataBase64: string | undefined;
    try {
      if (fileSizeBytes < 25 * 1024 * 1024) { // Under 25MB include base64
        const buffer = fs.readFileSync(filePath);
        fileDataBase64 = buffer.toString('base64');
      }
    } catch (err: any) {
      throw new Error(`Failed to read file for upload: ${err.message}`);
    }

    const payload: IngestDocumentPayload = {
      title: fileName,
      fileSizeBytes,
      sha256Hash,
      documentType: 'INCOMING_SCAN',
      originalFileName: fileName,
      fileData: fileDataBase64,
      agentId: this.config.agentId,
      machineName: this.config.machineName,
    };

    const url = `${this.config.apiUrl}/agents/ingest`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Check if duplicate
      if (res.status === 409 || data.code === 'DUPLICATE_DOCUMENT') {
        return {
          success: true,
          documentId: data.existingDocumentId,
          message: 'Document already exists in DCC repository (duplicate SHA-256)',
        };
      }
      throw new Error(data.message || data.error || `Upload failed with status ${res.status}`);
    }

    const data = await res.json();
    return {
      success: true,
      documentId: data.document?.id || data.id,
      message: data.message || 'Ingested successfully',
    };
  }
}
