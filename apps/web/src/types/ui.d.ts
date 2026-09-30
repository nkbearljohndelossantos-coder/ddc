export type UserRole = 'SUPER_ADMIN' | 'ORG_ADMIN' | 'DEPT_ADMIN' | 'OPERATOR' | 'QC_REVIEWER' | 'COMPLIANCE_OFFICER' | 'AUDITOR' | 'DEPARTMENT_USER';
export interface UserSession {
    id: string;
    email: string;
    fullName: string;
    organizationId: string;
    departmentId?: string;
    roles: UserRole[];
}
export type DocumentLifecycleStatus = 'DRAFT' | 'UPLOADING' | 'PROCESSING' | 'OCR_PROCESSING' | 'QC_REQUIRED' | 'FOR_REVIEW' | 'COMPLETED' | 'REJECTED' | 'RESCAN_REQUESTED' | 'RETENTION_EXPIRED' | 'DELETION_PENDING' | 'PURGED';
export interface DocumentSummary {
    id: string;
    title: string;
    documentType: string;
    departmentId?: string;
    status: DocumentLifecycleStatus;
    ocrConfidence?: number;
    pageCount: number;
    fileSizeBytes: number;
    isLegalHold: boolean;
    isPurged: boolean;
    version: number;
    createdAt: string;
}
export interface NavigationItem {
    id: string;
    label: string;
    path: string;
    icon: string;
    requiredRoles?: UserRole[];
}
//# sourceMappingURL=ui.d.ts.map