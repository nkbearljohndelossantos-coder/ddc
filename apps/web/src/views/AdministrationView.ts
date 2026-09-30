export interface ScannerAgentInfo {
  id: string;
  scannerModel: string;
  status: 'ONLINE' | 'OFFLINE';
  ipAddress: string;
  lastHeartbeat: string;
}

export interface DrDashboardStatus {
  observedRpoMinutes: number;
  observedRtoMinutes: number;
  rpoTargetMinutes: number;
  rtoTargetMinutes: number;
  lastDrillStatus: 'SUCCESS' | 'WARNING' | 'FAILED';
  lastDrillTimestamp: string;
}

export class AdministrationView {
  /**
   * Renders the enterprise administration, scanner fleet, and DR status views.
   */
  public static render(agents: ScannerAgentInfo[], dr: DrDashboardStatus): string {
    const agentRows = agents
      .map(
        (a) => `
        <tr>
          <td>${a.id}</td>
          <td>${a.scannerModel}</td>
          <td><span class="badge ${a.status === 'ONLINE' ? 'badge-success' : 'badge-danger'}">${a.status}</span></td>
          <td>${a.ipAddress}</td>
          <td>${a.lastHeartbeat}</td>
        </tr>
      `
      )
      .join('\n');

    return `
      <div class="admin-dashboard" role="region" aria-label="System Administration">
        <header class="view-header">
          <h2>Enterprise Administration & Fleet Operations</h2>
        </header>

        <section class="dr-metrics-section" aria-label="Disaster Recovery Metrics">
          <h3>Disaster Recovery & Backup Health</h3>
          <div class="metrics-cards-grid">
            <div class="metric-card">
              <span class="metric-title">Observed RPO</span>
              <span class="metric-value ${dr.observedRpoMinutes <= dr.rpoTargetMinutes ? 'text-success' : 'text-danger'}">
                ${dr.observedRpoMinutes}m (Target: ${dr.rpoTargetMinutes}m)
              </span>
            </div>
            <div class="metric-card">
              <span class="metric-title">Observed RTO</span>
              <span class="metric-value ${dr.observedRtoMinutes <= dr.rtoTargetMinutes ? 'text-success' : 'text-danger'}">
                ${dr.observedRtoMinutes}m (Target: ${dr.rtoTargetMinutes}m)
              </span>
            </div>
            <div class="metric-card">
              <span class="metric-title">Last Drill Status</span>
              <span class="metric-value text-success">${dr.lastDrillStatus} (${dr.lastDrillTimestamp})</span>
            </div>
          </div>
        </section>

        <section class="fleet-section" aria-label="Scanner Agent Fleet">
          <h3>Scanner Agent Fleet</h3>
          <table class="data-table" aria-label="Scanner Agents">
            <thead>
              <tr>
                <th>Agent ID</th>
                <th>Hardware Model</th>
                <th>Status</th>
                <th>IP Address</th>
                <th>Last Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              ${agentRows}
            </tbody>
          </table>
        </section>
      </div>
    `;
  }
}
