export interface ComplianceDocumentState {
    documentId: string;
    title: string;
    isLegalHold: boolean;
    legalHoldReason?: string;
    retentionPolicyName?: string;
    retentionExpirationDate?: string;
    isPurged: boolean;
}
export declare class ComplianceView {
    /**
     * Renders the compliance, legal hold, and retention control view.
     */
    static render(state: ComplianceDocumentState): string;
}
//# sourceMappingURL=ComplianceView.d.ts.map