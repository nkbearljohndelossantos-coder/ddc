export interface DocumentVersionInfo {
  id: string;
  versionNumber: number;
  sha256Hash: string;
  changeReason: string;
  createdByName: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface DocumentDetailData {
  id: string;
  title: string;
  documentType: string;
  departmentId?: string;
  status: string;
  version: number;
  ocrConfidence: number;
  pageCount: number;
  fileSizeBytes: number;
  sha256Hash: string;
  isLegalHold: boolean;
  isPurged: boolean;
  metadata: Record<string, any>;
  versions: DocumentVersionInfo[];
  createdAt: string;
}

export class DocumentDetailView {
  /**
   * Renders complete document detail page with metadata, preview controls, and version history.
   */
  public static render(doc: DocumentDetailData): string {
    const isPurged = doc.isPurged || doc.status === 'PURGED';
    const isHeld = doc.isLegalHold;

    const versionRows = doc.versions
      .map(
        (v) => `
        <tr class="${v.isCurrent ? 'row-current-version' : ''}">
          <td>v${v.versionNumber} ${v.isCurrent ? '<strong>(Current)</strong>' : ''}</td>
          <td><code class="hash-code">${v.sha256Hash.substring(0, 12)}...</code></td>
          <td>${v.changeReason}</td>
          <td>${v.createdByName}</td>
          <td>${v.createdAt}</td>
          <td>
            ${
              v.isCurrent || isPurged
                ? '-'
                : `<button type="button" class="btn btn-sm btn-outline btn-restore" data-version-id="${v.id}" aria-label="Restore document to version ${v.versionNumber}">Restore</button>`
            }
          </td>
        </tr>
      `
      )
      .join('\n');

    return `
      <div class="document-detail-container" role="region" aria-label="Document Details for ${doc.title}">
        <header class="detail-header">
          <h2>${doc.title}</h2>
          <div class="header-badges">
            <span class="badge status-badge">${doc.status}</span>
            ${isHeld ? '<span class="badge badge-warning">🔒 Legal Hold Active</span>' : ''}
            ${isPurged ? '<span class="badge badge-danger">Permanent Purged</span>' : ''}
          </div>
        </header>

        <section class="metadata-section" aria-label="Document Metadata">
          <h3>Metadata & Identification</h3>
          <dl class="metadata-grid">
            <dt>Document ID:</dt> <dd><code>${doc.id}</code></dd>
            <dt>Document Type:</dt> <dd>${doc.documentType}</dd>
            <dt>Department:</dt> <dd>${doc.departmentId || 'Global'}</dd>
            <dt>OCR Confidence:</dt> <dd>${doc.ocrConfidence.toFixed(1)}%</dd>
            <dt>Pages / Size:</dt> <dd>${doc.pageCount} pages (${Math.round(doc.fileSizeBytes / 1024)} KB)</dd>
            <dt>SHA-256 Hash:</dt> <dd><code class="hash-code">${doc.sha256Hash}</code></dd>
          </dl>
        </section>

        <section class="versions-section" aria-label="Version Revision History">
          <h3>Version History</h3>
          <p class="section-help">Restoring a previous version creates a new current version to preserve immutable audit history.</p>
          <table class="data-table" aria-label="Document Versions">
            <thead>
              <tr>
                <th>Version</th>
                <th>SHA-256</th>
                <th>Reason</th>
                <th>Created By</th>
                <th>Timestamp</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${versionRows}
            </tbody>
          </table>
        </section>
      </div>
    `;
  }
}
