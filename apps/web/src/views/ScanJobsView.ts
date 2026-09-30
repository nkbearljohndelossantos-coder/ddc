export interface ScanJobInfo {
  id: string;
  scannerId: string;
  status: string;
  pageCount: number;
  progressPercent: number;
  createdAt: string;
  errorMessage?: string;
}

export class ScanJobsView {
  /**
   * Renders scanner fleet and active scan job operations monitor.
   */
  public static render(jobs: ScanJobInfo[]): string {
    const rows = jobs
      .map(
        (j) => `
        <tr class="job-row">
          <td><code>${j.id}</code></td>
          <td>${j.scannerId}</td>
          <td><span class="badge job-status-${j.status.toLowerCase()}">${j.status}</span></td>
          <td>
            <div class="progress-bar-container" role="progressbar" aria-valuenow="${j.progressPercent}" aria-valuemin="0" aria-valuemax="100">
              <div class="progress-bar-fill" style="width: ${j.progressPercent}%"></div>
            </div>
          </td>
          <td>${j.pageCount}</td>
          <td>${j.errorMessage ? `<span class="text-danger">${j.errorMessage}</span>` : 'Normal'}</td>
        </tr>
      `
      )
      .join('\n');

    return `
      <div class="scan-jobs-container" role="region" aria-label="Scan Job Operations">
        <header class="view-header">
          <h2>Scan Job Operations & Fleet Dispatch</h2>
        </header>

        <section class="active-jobs-section" aria-label="Active Scan Jobs">
          <table class="data-table" aria-label="Scan Jobs">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Scanner</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Pages</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${jobs.length > 0 ? rows : '<tr><td colspan="6" class="text-center">No active scan jobs.</td></tr>'}
            </tbody>
          </table>
        </section>
      </div>
    `;
  }
}
