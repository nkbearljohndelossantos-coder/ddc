export interface SystemMetrics {
  uptimeSeconds: number;
  http: {
    requestsTotal: number;
    status2xx: number;
    status4xx: number;
    status5xx: number;
    avgDurationMs: number;
  };
  agents: {
    connectedCount: number;
    revokedCount: number;
  };
  jobs: {
    createdTotal: number;
    completedTotal: number;
    failedTotal: number;
    retriesTotal: number;
  };
  uploads: {
    sessionsCreatedTotal: number;
    chunksUploadedTotal: number;
    bytesUploadedTotal: number;
    failedTotal: number;
  };
  ocr: {
    processedTotal: number;
    lowConfidenceTotal: number;
  };
  compliance: {
    retentionExpiredTotal: number;
    legalHoldBlocksTotal: number;
    purgedTotal: number;
  };
  drAndBackups: {
    backupsVerifiedTotal: number;
    backupsFailedTotal: number;
    drDrillsTotal: number;
    drDrillsFailedTotal: number;
  };
  reliability: {
    rateLimitViolationsTotal: number;
    deadLettersTotal: number;
    integrityMismatchesTotal: number;
  };
}

export class MetricsRegistry {
  private requestsTotal = 0;
  private status2xx = 0;
  private status4xx = 0;
  private status5xx = 0;
  private totalDurationMs = 0;

  private connectedAgents = 0;
  private revokedAgents = 0;

  private jobsCreated = 0;
  private jobsCompleted = 0;
  private jobsFailed = 0;
  private jobsRetried = 0;

  private uploadSessions = 0;
  private uploadChunks = 0;
  private uploadBytes = 0;
  private uploadFailures = 0;

  private ocrProcessed = 0;
  private ocrLowConfidence = 0;

  private retentionExpired = 0;
  private legalHoldBlocks = 0;
  private documentsPurged = 0;

  private backupsVerified = 0;
  private backupsFailed = 0;
  private drDrills = 0;
  private drDrillsFailed = 0;

  private rateLimitViolations = 0;
  private deadLetters = 0;
  private integrityMismatches = 0;

  recordHttpRequest(statusCode: number, durationMs: number) {
    this.requestsTotal++;
    this.totalDurationMs += durationMs;
    if (statusCode >= 200 && statusCode < 400) this.status2xx++;
    else if (statusCode >= 400 && statusCode < 500) this.status4xx++;
    else if (statusCode >= 500) this.status5xx++;
  }

  recordAgentConnected() { this.connectedAgents++; }
  recordAgentDisconnected() { if (this.connectedAgents > 0) this.connectedAgents--; }
  recordAgentRevoked() { this.revokedAgents++; }

  recordJobCreated() { this.jobsCreated++; }
  recordJobCompleted() { this.jobsCompleted++; }
  recordJobFailed() { this.jobsFailed++; }
  recordJobRetry() { this.jobsRetried++; }

  recordUploadSession() { this.uploadSessions++; }
  recordUploadChunk(bytes: number) { this.uploadChunks++; this.uploadBytes += bytes; }
  recordUploadFailure() { this.uploadFailures++; }

  recordOcrProcessed(isLowConfidence = false) {
    this.ocrProcessed++;
    if (isLowConfidence) this.ocrLowConfidence++;
  }

  recordRetentionExpired() { this.retentionExpired++; }
  recordLegalHoldBlock() { this.legalHoldBlocks++; }
  recordDocumentPurged() { this.documentsPurged++; }

  recordBackupVerification(success: boolean) {
    if (success) this.backupsVerified++;
    else this.backupsFailed++;
  }

  recordDrDrill(success: boolean) {
    this.drDrills++;
    if (!success) this.drDrillsFailed++;
  }

  recordRateLimitViolation() { this.rateLimitViolations++; }
  recordDeadLetter() { this.deadLetters++; }
  recordIntegrityMismatch() { this.integrityMismatches++; }

  getSummary(): SystemMetrics {
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      http: {
        requestsTotal: this.requestsTotal,
        status2xx: this.status2xx,
        status4xx: this.status4xx,
        status5xx: this.status5xx,
        avgDurationMs: this.requestsTotal > 0 ? Number((this.totalDurationMs / this.requestsTotal).toFixed(2)) : 0,
      },
      agents: {
        connectedCount: this.connectedAgents,
        revokedCount: this.revokedAgents,
      },
      jobs: {
        createdTotal: this.jobsCreated,
        completedTotal: this.jobsCompleted,
        failedTotal: this.jobsFailed,
        retriesTotal: this.jobsRetried,
      },
      uploads: {
        sessionsCreatedTotal: this.uploadSessions,
        chunksUploadedTotal: this.uploadChunks,
        bytesUploadedTotal: this.uploadBytes,
        failedTotal: this.uploadFailures,
      },
      ocr: {
        processedTotal: this.ocrProcessed,
        lowConfidenceTotal: this.ocrLowConfidence,
      },
      compliance: {
        retentionExpiredTotal: this.retentionExpired,
        legalHoldBlocksTotal: this.legalHoldBlocks,
        purgedTotal: this.documentsPurged,
      },
      drAndBackups: {
        backupsVerifiedTotal: this.backupsVerified,
        backupsFailedTotal: this.backupsFailed,
        drDrillsTotal: this.drDrills,
        drDrillsFailedTotal: this.drDrillsFailed,
      },
      reliability: {
        rateLimitViolationsTotal: this.rateLimitViolations,
        deadLettersTotal: this.deadLetters,
        integrityMismatchesTotal: this.integrityMismatches,
      },
    };
  }
}

export const metrics = new MetricsRegistry();
