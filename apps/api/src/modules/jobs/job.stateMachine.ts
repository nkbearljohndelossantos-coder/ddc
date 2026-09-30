import { JobStatus } from '@prisma/client';

export class JobStateMachine {
  private static readonly validTransitions: Record<JobStatus, JobStatus[]> = {
    CREATED: ['QUEUED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'FAILED'],
    QUEUED: ['DISPATCHED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'FAILED', 'RETRYING'],
    DISPATCHED: ['ACKNOWLEDGED', 'RETRYING', 'CANCELLATION_REQUESTED', 'FAILED', 'CANCELLED'],
    ACKNOWLEDGED: ['SCANNING', 'CANCELLATION_REQUESTED', 'FAILED', 'CANCELLED'],
    SCANNING: ['LOCAL_COMPLETED', 'CANCELLATION_REQUESTED', 'FAILED', 'CANCELLED'],
    LOCAL_COMPLETED: ['UPLOADING', 'FAILED'],
    UPLOADING: ['QUARANTINED', 'FAILED'],
    QUARANTINED: ['VALIDATING', 'FAILED'],
    VALIDATING: ['PROCESSING', 'FAILED'],
    PROCESSING: ['OCR_PROCESSING', 'FINALIZING', 'FAILED'],
    OCR_PROCESSING: ['FINALIZING', 'FAILED'],
    FINALIZING: ['COMPLETED', 'FAILED'],
    CANCELLATION_REQUESTED: ['CANCELLED', 'FAILED'],
    RETRYING: ['QUEUED', 'FAILED'],
    COMPLETED: [],
    FAILED: ['RETRYING'],
    CANCELLED: [],
  };

  /**
   * Checks if a transition from fromStatus to toStatus is permitted.
   */
  static canTransition(fromStatus: JobStatus, toStatus: JobStatus): boolean {
    if (fromStatus === toStatus) return true;
    const allowed = this.validTransitions[fromStatus];
    return Array.isArray(allowed) && allowed.includes(toStatus);
  }

  /**
   * Asserts that a state transition is valid, throwing an Error with statusCode if invalid.
   */
  static validateTransition(fromStatus: JobStatus, toStatus: JobStatus): void {
    if (!this.canTransition(fromStatus, toStatus)) {
      const error: any = new Error(`Illegal job state transition from '${fromStatus}' to '${toStatus}'`);
      error.statusCode = 400;
      throw error;
    }
  }
}
