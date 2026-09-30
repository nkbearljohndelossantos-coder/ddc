export interface QcWorkspaceData {
    documentId: string;
    title: string;
    pageNumber: number;
    totalPages: number;
    ocrConfidence: number;
    previewUrl: string;
    extractedText: string;
    isLowConfidence: boolean;
}
export declare class QcWorkspaceView {
    /**
     * Renders the QC Reviewer workspace with side-by-side document preview and OCR editor.
     */
    static render(data: QcWorkspaceData): string;
}
//# sourceMappingURL=QcWorkspaceView.d.ts.map