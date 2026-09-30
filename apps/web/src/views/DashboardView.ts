export interface DashboardMetrics {
  totalDocuments: number;
  documentsAwaitingQc: number;
  activeScanJobs: number;
  failedScanJobs: number;
  activeWorkflowTasks: number;
  overdueTasks: number;
  activeLegalHolds: number;
  observedRpoMinutes: number;
  observedRtoMinutes: number;
  activeAlertsCount: number;
  activeIncidentsCount: number;
  sloCompliancePercent: number;
  lastUpdated: string;
}

export class DashboardView {
  /**
   * Renders the production enterprise KPI dashboard.
   */
  public static render(metrics: DashboardMetrics): string {
    const rpoStatusClass = metrics.observedRpoMinutes <= 60 ? 'status-good' : 'status-bad';
    const rtoStatusClass = metrics.observedRtoMinutes <= 30 ? 'status-good' : 'status-bad';
    const incidentStatusClass = metrics.activeIncidentsCount === 0 ? 'status-good' : 'status-bad';

    return `
      <div class="enterprise-dashboard" role="region" aria-label="Enterprise Operations Dashboard">
        <header class="dashboard-header">
          <h2>Enterprise Overview</h2>
          <span class="last-updated" role="status">Last refreshed: ${metrics.lastUpdated}</span>
        </header>

        <div class="kpi-grid">
          <div class="kpi-card" role="region" aria-label="Document Statistics">
            <span class="kpi-title">Total Documents</span>
            <span class="kpi-value">${metrics.totalDocuments}</span>
            <span class="kpi-subtext">${metrics.documentsAwaitingQc} awaiting QC</span>
          </div>

          <div class="kpi-card" role="region" aria-label="Scan Job Operations">
            <span class="kpi-title">Active Scan Jobs</span>
            <span class="kpi-value">${metrics.activeScanJobs}</span>
            <span class="kpi-subtext">${metrics.failedScanJobs} failed</span>
          </div>

          <div class="kpi-card" role="region" aria-label="Workflow & Tasks">
            <span class="kpi-title">Pending Workflow Tasks</span>
            <span class="kpi-value">${metrics.activeWorkflowTasks}</span>
            <span class="kpi-subtext text-danger">${metrics.overdueTasks} overdue</span>
          </div>

          <div class="kpi-card" role="region" aria-label="Compliance & Legal Holds">
            <span class="kpi-title">Active Legal Holds</span>
            <span class="kpi-value">${metrics.activeLegalHolds}</span>
            <span class="kpi-subtext">Litigation locked</span>
          </div>

          <div class="kpi-card" role="region" aria-label="Disaster Recovery Health">
            <span class="kpi-title">Observed RPO / RTO</span>
            <span class="kpi-value ${rpoStatusClass}">${metrics.observedRpoMinutes}m / ${metrics.observedRtoMinutes}m</span>
            <span class="kpi-subtext">Targets: 60m / 30m</span>
          </div>

          <div class="kpi-card" role="region" aria-label="SRE Incident Status">
            <span class="kpi-title">Active Incidents / Alerts</span>
            <span class="kpi-value ${incidentStatusClass}">${metrics.activeIncidentsCount} / ${metrics.activeAlertsCount}</span>
            <span class="kpi-subtext">SLO: ${metrics.sloCompliancePercent.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    `;
  }
}
