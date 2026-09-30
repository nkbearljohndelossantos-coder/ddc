export interface AuditLogEntry {
  id: string;
  action: string;
  actorEmail: string;
  details?: string;
  ipAddress?: string;
  createdAt: string;
}

export class AuditComplianceView {
  /**
   * Renders the compliance audit log explorer and export generator.
   */
  public static render(logs: AuditLogEntry[]): string {
    const rows = logs
      .map(
        (l) => `
        <tr>
          <td><code>${l.action}</code></td>
          <td>${l.actorEmail}</td>
          <td>${l.details || '-'}</td>
          <td>${l.ipAddress || 'Internal'}</td>
          <td>${l.createdAt}</td>
        </tr>
      `
      )
      .join('\n');

    return `
      <div class="audit-compliance-container" role="region" aria-label="Compliance Audit Log Viewer">
        <header class="view-header">
          <h2>Compliance Audit Logs & Export</h2>
        </header>

        <section class="export-controls-card" aria-label="Export Generator">
          <h3>Generate Compliance Export</h3>
          <div class="form-row">
            <div class="form-group">
              <label for="export-type-select">Export Type:</label>
              <select id="export-type-select" class="form-select">
                <option value="AUDIT_LOGS">Document Audit Logs</option>
                <option value="INCIDENTS">Incident History</option>
                <option value="SECURITY_EVENTS">Security Events</option>
              </select>
            </div>
            <div class="form-group">
              <label for="export-format-select">Format:</label>
              <select id="export-format-select" class="form-select">
                <option value="JSON">JSON Archive</option>
                <option value="CSV">CSV Spreadsheet</option>
              </select>
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="btn-generate-export">Download Verified Export</button>
        </section>

        <section class="audit-table-section" aria-label="Audit Log Entries">
          <h3>Recent Audit Trail (${logs.length})</h3>
          <table class="data-table" aria-label="Audit Logs">
            <thead>
              <tr>
                <th>Action</th>
                <th>Actor</th>
                <th>Details</th>
                <th>IP Address</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${logs.length > 0 ? rows : '<tr><td colspan="5" class="text-center">No audit log entries found.</td></tr>'}
            </tbody>
          </table>
        </section>
      </div>
    `;
  }
}
