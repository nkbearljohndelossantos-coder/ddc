export type DomainEventType =
  | 'DOCUMENT_FINALIZED'
  | 'OCR_COMPLETED'
  | 'QC_REQUIRED'
  | 'QC_APPROVED'
  | 'DOCUMENT_APPROVED'
  | 'DOCUMENT_REJECTED'
  | 'RESCAN_REQUESTED'
  | 'METADATA_UPDATED'
  | 'WORKFLOW_CREATED'
  | 'WORKFLOW_TRANSITIONED'
  | 'TASK_ASSIGNED'
  | 'TASK_COMPLETED'
  | 'TASK_OVERDUE'
  | 'DOCUMENT_VERSION_CREATED'
  | 'DOCUMENT_RESTORED'
  | 'RETENTION_EXPIRED'
  | 'LEGAL_HOLD_APPLIED'
  | 'LEGAL_HOLD_RELEASED'
  | 'DELETION_REQUESTED'
  | 'PURGE_COMPLETED'
  | 'INTEGRITY_MISMATCH'
  | 'BACKUP_VERIFICATION_FAILED'
  | 'AGENT_OFFLINE'
  | 'JOB_RECOVERY_REQUIRED';

export interface DomainEvent<T = any> {
  eventId: string;
  eventType: DomainEventType;
  schemaVersion: string;
  occurredAt: Date;
  organizationId?: string;
  departmentId?: string;
  actorId?: string;
  resourceId?: string;
  resourceType?: string;
  correlationId?: string;
  payload: T;
}
