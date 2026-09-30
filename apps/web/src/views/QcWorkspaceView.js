export class QcWorkspaceView {
    /**
     * Renders the QC Reviewer workspace with side-by-side document preview and OCR editor.
     */
    static render(data) {
        const confidenceClass = data.ocrConfidence < 85 ? 'confidence-low' : 'confidence-high';
        return `
      <div class="qc-workspace" role="region" aria-label="Quality Control Workspace">
        <header class="qc-header">
          <h2>QC Review: ${data.title}</h2>
          <div class="qc-meta">
            <span>Page ${data.pageNumber} of ${data.totalPages}</span>
            <span class="confidence-badge ${confidenceClass}" role="status">
              Confidence: ${data.ocrConfidence.toFixed(1)}% ${data.isLowConfidence ? '⚠️ Review Required' : '✔ Passed'}
            </span>
          </div>
        </header>

        <div class="qc-grid">
          <section class="preview-panel" aria-label="Scanned Page Preview">
            <img src="${data.previewUrl}" alt="Scanned document page ${data.pageNumber}" class="preview-image" />
          </section>

          <section class="ocr-editor-panel" aria-label="OCR Text Verification">
            <label for="ocr-text-editor" class="editor-label">Extracted Text Content</label>
            <textarea id="ocr-text-editor" class="ocr-textarea" rows="18">${data.extractedText}</textarea>
            
            <div class="qc-actions">
              <button type="button" class="btn btn-success" id="btn-qc-approve" aria-label="Approve QC and finalize document">Approve</button>
              <button type="button" class="btn btn-warning" id="btn-qc-rescan" aria-label="Request document rescan">Request Rescan</button>
              <button type="button" class="btn btn-danger" id="btn-qc-reject" aria-label="Reject document">Reject</button>
            </div>
          </section>
        </div>
      </div>
    `;
    }
}
//# sourceMappingURL=QcWorkspaceView.js.map