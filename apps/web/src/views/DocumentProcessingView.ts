export interface ProcessingItem {
  id: string;
  documentTitle: string;
  departmentId?: string;
  status: 'PENDING' | 'PROCESSING' | 'OCR_PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVIEW_REQUIRED';
  ocrConfidence?: number;
  submittedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export class DocumentProcessingView {
  /**
   * Renders the user-friendly Document Processing & OCR Status view.
   */
  public static render(items: ProcessingItem[]): string {
    if (items.length === 0) {
      return `
        <div class="card">
          <div class="empty-state" role="status">
            <div class="empty-icon">⚙️</div>
            <h3 class="empty-title">No Active Document Processing</h3>
            <p class="empty-text">All captured documents have completed OCR and text extraction processing.</p>
          </div>
        </div>
      `;
    }

    const rows = items
      .map((item) => {
        let statusBadge = '';
        if (item.status === 'COMPLETED') {
          statusBadge = `<span class="badge badge-success">Text Extraction Complete</span>`;
        } else if (item.status === 'OCR_PROCESSING' || item.status === 'PROCESSING') {
          statusBadge = `<span class="badge badge-neutral">OCR Processing</span>`;
        } else if (item.status === 'REVIEW_REQUIRED') {
          statusBadge = `<span class="badge badge-warning">Manual Review Required</span>`;
        } else if (item.status === 'FAILED') {
          statusBadge = `<span class="badge badge-danger">Processing Failed</span>`;
        } else {
          statusBadge = `<span class="badge badge-neutral">Processing Document</span>`;
        }

        const confidenceStr =
          item.ocrConfidence !== undefined ? `${item.ocrConfidence.toFixed(1)}%` : 'Processing';

        return `
          <tr>
            <td><strong>${item.documentTitle}</strong></td>
            <td>${item.departmentId || 'General'}</td>
            <td>${statusBadge}</td>
            <td>${confidenceStr}</td>
            <td>${new Date(item.submittedAt).toLocaleTimeString()}</td>
            <td>${item.completedAt ? new Date(item.completedAt).toLocaleTimeString() : 'In Progress'}</td>
            <td>
              ${item.errorMessage ? `<span class="error-msg">${item.errorMessage}</span>` : '<span class="status-ok">Normal</span>'}
            </td>
          </tr>
        `;
      })
      .join('\n');

    return `
      <div class="card">
        <div class="card-header">
          <h3 class="card-heading">Document Processing & Text Extraction Status</h3>
          <span class="badge badge-neutral">Real-Time OCR Queue</span>
        </div>
        <div class="table-container">
          <table class="data-table" aria-label="Document Processing Queue">
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Department</th>
                <th scope="col">Processing Status</th>
                <th scope="col">OCR Confidence</th>
                <th scope="col">Submitted</th>
                <th scope="col">Completed</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}
