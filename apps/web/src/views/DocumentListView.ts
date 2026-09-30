import { DocumentSummary } from '../types/ui.js';

export class DocumentListView {
  /**
   * Renders the document management table view with lifecycle state guards and accessibility tags.
   */
  public static render(documents: DocumentSummary[]): string {
    if (documents.length === 0) {
      return `
        <div class="empty-state" role="status">
          <p>No documents found matching your filter criteria.</p>
        </div>
      `;
    }

    const rows = documents
      .map((doc) => {
        const isPurged = doc.isPurged || doc.status === 'PURGED';
        const isHeld = doc.isLegalHold;

        const statusBadge = `
          <span class="status-badge status-${doc.status.toLowerCase()}" role="status">
            ${isHeld ? '🔒 ' : ''}${doc.status}
          </span>
        `;

        const actionButtons = isPurged
          ? `<span class="purged-notice" aria-label="Document files permanently purged">[PURGED]</span>`
          : `
            <a href="/documents/${doc.id}" class="btn btn-sm btn-outline" aria-label="View document ${doc.title}">View</a>
            <a href="/api/v1/documents/${doc.id}/download" class="btn btn-sm btn-primary" aria-label="Download PDF for ${doc.title}">PDF</a>
          `;

        return `
          <tr class="document-row ${isPurged ? 'row-purged' : ''} ${isHeld ? 'row-held' : ''}">
            <td><a href="/documents/${doc.id}" class="doc-title">${doc.title}</a></td>
            <td>${doc.documentType}</td>
            <td>${doc.departmentId || 'Global'}</td>
            <td>v${doc.version}</td>
            <td>${doc.ocrConfidence !== undefined ? `${doc.ocrConfidence.toFixed(1)}%` : 'N/A'}</td>
            <td>${statusBadge}</td>
            <td class="action-cell">${actionButtons}</td>
          </tr>
        `;
      })
      .join('\n');

    return `
      <div class="document-list-container">
        <header class="view-header">
          <h2>Document Repository</h2>
        </header>
        <div class="table-responsive">
          <table class="data-table" aria-label="Enterprise Document Records">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Type</th>
                <th scope="col">Department</th>
                <th scope="col">Version</th>
                <th scope="col">OCR Conf</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
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
