export interface SreIncidentItem {
  id: string;
  title: string;
  severity: string;
  status: string;
  serviceName: string;
  createdAt: string;
}

export interface SreAlertItem {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  createdAt: string;
}

export interface SreSloItem {
  id: string;
  name: string;
  targetValue: number;
  observedValue: number;
  status: string;
}

export class SreOperationsView {
  /**
   * Renders the unified SRE Operations Dashboard (`/admin/operations`).
   */
  public static render(
    incidents: SreIncidentItem[],
    alerts: SreAlertItem[],
    slos: SreSloItem[],
    isMaintenanceActive = false
  ): string {
    const incidentRows = incidents
      .map(
        (i) => `
        <tr class="incident-row ${i.severity === 'SEV1' || i.severity === 'SEV2' ? 'row-critical-incident' : ''}">
          <td><strong>${i.severity}</strong></td>
          <td>${i.title}</td>
          <td>${i.serviceName}</td>
          <td><span class="badge status-${i.status.toLowerCase()}">${i.status}</span></td>
          <td>${i.createdAt}</td>
          <td>
            ${
              i.status === 'OPEN'
                ? `<button type="button" class="btn btn-sm btn-warning btn-ack-incident" data-id="${i.id}">Acknowledge</button>`
                : i.status === 'INVESTIGATING'
                ? `<button type="button" class="btn btn-sm btn-success btn-resolve-incident" data-id="${i.id}">Resolve</button>`
                : '-'
            }
          </td>
        </tr>
      `
      )
      .join('\n');

    const alertRows = alerts
      .map(
        (a) => `
        <tr>
          <td><span class="badge badge-${a.severity.toLowerCase()}">${a.severity}</span></td>
          <td>${a.title}</td>
          <td>${a.alertType}</td>
          <td>${a.createdAt}</td>
        </tr>
      `
      )
      .join('\n');

    const sloRows = slos
      .map(
        (s) => `
        <tr>
          <td>${s.name}</td>
          <td>${s.targetValue}</td>
          <td><strong>${s.observedValue}</strong></td>
          <td>
            <span class="badge ${s.status === 'OK' ? 'badge-success' : s.status === 'WARNING' ? 'badge-warning' : 'badge-danger'}">
              ${s.status}
            </span>
          </td>
        </tr>
      `
      )
      .join('\n');

    return `
      <div class="sre-operations-container" role="region" aria-label="SRE Operations Console">
        <header class="view-header">
          <h2>SRE Operations & Reliability Console</h2>
          ${isMaintenanceActive ? '<div class="alert alert-warning" role="alert">⚠️ SYSTEM MAINTENANCE MODE ACTIVE</div>' : ''}
        </header>

        <section class="incidents-section" aria-label="Active Incidents">
          <h3>Active Incidents</h3>
          <table class="data-table" aria-label="Incidents Table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Title</th>
                <th>Service</th>
                <th>Status</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${incidents.length > 0 ? incidentRows : '<tr><td colspan="6" class="text-center">No active incidents.</td></tr>'}
            </tbody>
          </table>
        </section>

        <section class="slos-section" aria-label="SLO/SLA Targets">
          <h3>Service Level Objectives (SLO)</h3>
          <table class="data-table" aria-label="SLO Table">
            <thead>
              <tr>
                <th>SLO Metric</th>
                <th>Target</th>
                <th>Observed</th>
                <th>Compliance</th>
              </tr>
            </thead>
            <tbody>
              ${slos.length > 0 ? sloRows : '<tr><td colspan="4" class="text-center">No active SLOs configured.</td></tr>'}
            </tbody>
          </table>
        </section>

        <section class="alerts-section" aria-label="Operational Alerts">
          <h3>Recent Operational Alerts</h3>
          <table class="data-table" aria-label="Alerts Table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Alert Title</th>
                <th>Type</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${alerts.length > 0 ? alertRows : '<tr><td colspan="4" class="text-center">No recent alerts.</td></tr>'}
            </tbody>
          </table>
        </section>
      </div>
    `;
  }
}
