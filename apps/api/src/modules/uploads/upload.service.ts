import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../config/logger.js';
import { objectStorage } from '../../lib/storage.js';
import { JobStateMachine } from '../jobs/job.stateMachine.js';
import {
  CreateUploadSessionInput,
  CompleteUploadSessionInput,
} from './upload.schema.js';

export class UploadService {
  /**
   * Creates or resumes an upload session for an edge agent scan job.
   */
  async createOrResumeSession(input: CreateUploadSessionInput, agentId: string) {
    const job = await prisma.scanJob.findUnique({
      where: { id: input.jobId },
      include: { scanner: true },
    });

    if (!job) {
      throw { statusCode: 404, message: 'Scan job not found' };
    }

    if (job.agentId !== agentId) {
      throw { statusCode: 403, message: 'Forbidden: Agent does not own this scan job' };
    }

    // 1. Idempotency & Resumable Check
    const existingSession = await prisma.storageUploadSession.findUnique({
      where: {
        jobId_executionId: {
          jobId: input.jobId,
          executionId: input.executionId,
        },
      },
    });

    if (existingSession) {
      logger.info(`[Upload Service] Resuming existing upload session ${existingSession.id} (Chunks: ${existingSession.uploadedChunks}/${existingSession.totalChunks})`);
      return {
        session: existingSession,
        resumed: true,
        nextChunkNumber: existingSession.uploadedChunks + 1,
      };
    }

    // 2. Create Quarantine Key
    const orgId = job.scanner.organizationId || 'org-default';
    const quarantineKey = `quarantine/${orgId}/${agentId}/${input.executionId}/scan_${job.id}.dat`;

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const session = await prisma.storageUploadSession.create({
      data: {
        jobId: input.jobId,
        executionId: input.executionId,
        agentId,
        pageNumber: input.pageNumber || null,
        totalBytes: input.totalBytes,
        totalChunks: input.totalChunks,
        uploadedChunks: 0,
        uploadState: 'CREATED',
        fileHash: input.fileHash,
        quarantineKey,
        expiresAt,
      },
    });

    // Update job status to UPLOADING
    if (JobStateMachine.canTransition(job.status, 'UPLOADING')) {
      await prisma.$transaction([
        prisma.scanJob.update({
          where: { id: job.id },
          data: { status: 'UPLOADING' },
        }),
        prisma.scanJobAuditLog.create({
          data: {
            jobId: job.id,
            fromStatus: job.status,
            toStatus: 'UPLOADING',
            event: 'UPLOAD_STARTED',
            details: { sessionId: session.id, totalChunks: input.totalChunks },
          },
        }),
      ]);
    }

    logger.info(`[Upload Service] Created upload session ${session.id} for Job ${input.jobId} (Execution: ${input.executionId})`);

    return {
      session,
      resumed: false,
      nextChunkNumber: 1,
    };
  }

  /**
   * Uploads and persists a single verifiable chunk.
   */
  async uploadChunk(
    sessionId: string,
    chunkNumber: number,
    chunkBuffer: Buffer,
    chunkHash: string,
    agentId: string
  ) {
    const session = await prisma.storageUploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw { statusCode: 404, message: 'Upload session not found' };
    }

    if (session.agentId !== agentId) {
      throw { statusCode: 403, message: 'Forbidden: Agent does not own this upload session' };
    }

    // Verify chunk integrity
    const computedHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex');
    if (computedHash.toLowerCase() !== chunkHash.toLowerCase()) {
      throw {
        statusCode: 400,
        message: `Chunk ${chunkNumber} SHA-256 mismatch: expected ${chunkHash}, got ${computedHash}`,
      };
    }

    // Write chunk to quarantine storage
    await objectStorage.writeQuarantineChunk(session.quarantineKey, chunkNumber, chunkBuffer);

    // Idempotently update session uploadedChunks count
    const updatedCount = Math.max(session.uploadedChunks, chunkNumber);
    const updated = await prisma.storageUploadSession.update({
      where: { id: sessionId },
      data: {
        uploadedChunks: updatedCount,
        uploadState: 'UPLOADING',
      },
    });

    logger.info(`[Upload Service] Chunk ${chunkNumber}/${session.totalChunks} persisted for session ${sessionId}`);

    return {
      sessionId,
      chunkNumber,
      acknowledged: true,
      uploadedChunks: updated.uploadedChunks,
      isComplete: updated.uploadedChunks >= session.totalChunks,
    };
  }

  /**
   * Completes the upload session, assembles quarantine object, and validates file hash.
   */
  async completeSession(
    sessionId: string,
    input: CompleteUploadSessionInput,
    agentId: string
  ) {
    const session = await prisma.storageUploadSession.findUnique({
      where: { id: sessionId },
      include: { job: { include: { scanner: true } } },
    });

    if (!session) {
      throw { statusCode: 404, message: 'Upload session not found' };
    }

    if (session.agentId !== agentId) {
      throw { statusCode: 403, message: 'Forbidden: Agent does not own this upload session' };
    }

    // Mark VERIFYING
    await prisma.storageUploadSession.update({
      where: { id: sessionId },
      data: { uploadState: 'VERIFYING' },
    });

    // Assemble quarantine object
    const assembledInfo = await objectStorage.assembleQuarantineObject(
      session.quarantineKey,
      session.totalChunks
    );

    // Verify document-level SHA-256 hash
    if (assembledInfo.sha256Hash.toLowerCase() !== input.fileHash.toLowerCase()) {
      await prisma.storageUploadSession.update({
        where: { id: sessionId },
        data: {
          uploadState: 'FAILED',
          errorMessage: `Document hash mismatch: expected ${input.fileHash}, got ${assembledInfo.sha256Hash}`,
        },
      });

      throw {
        statusCode: 400,
        message: `Integrity check failed: Assembled document hash ${assembledInfo.sha256Hash} does not match expected ${input.fileHash}`,
      };
    }

    // Mark VERIFIED
    const verifiedSession = await prisma.storageUploadSession.update({
      where: { id: sessionId },
      data: {
        uploadState: 'VERIFIED',
      },
    });

    // Update job status: UPLOADING -> QUARANTINED -> VALIDATING
    await prisma.$transaction([
      prisma.scanJob.update({
        where: { id: session.jobId },
        data: { status: 'VALIDATING', pageCount: input.pageCount },
      }),
      prisma.scanJobAuditLog.create({
        data: {
          jobId: session.jobId,
          fromStatus: 'UPLOADING',
          toStatus: 'VALIDATING',
          event: 'UPLOAD_VERIFIED',
          details: {
            sha256: assembledInfo.sha256Hash,
            sizeBytes: assembledInfo.sizeBytes,
            quarantineKey: session.quarantineKey,
          },
        },
      }),
    ]);

    logger.info(`[Upload Service] Upload session ${sessionId} verified successfully. Quarantine Key: ${session.quarantineKey}`);

    // Trigger Two-Phase Document Finalization
    const { documentService } = await import('../documents/document.service.js');
    const finalizationResult = await documentService.finalizeDocument(
      session.jobId,
      session.executionId,
      {
        pageCount: input.pageCount,
        fileSizeBytes: assembledInfo.sizeBytes,
        sha256Hash: assembledInfo.sha256Hash,
      }
    );

    return {
      session: verifiedSession,
      document: finalizationResult.document,
      status: 'COMPLETED',
    };
  }
}

export const uploadService = new UploadService();
