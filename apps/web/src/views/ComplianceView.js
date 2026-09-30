export class ComplianceView {
    /**
     * Renders the compliance, legal hold, and retention control view.
     */
    static render(state) {
        const isHeld = state.isLegalHold;
        const legalHoldBanner = isHeld
            ? `
        <div class="alert alert-warning legal-hold-banner" role="alert">
          <strong>🔒 ACTIVE LITIGATION / REGULATORY HOLD:</strong> 
          This document is protected under legal hold. Deletion and purge controls are strictly locked.
          <p class="hold-reason">Reason: ${state.legalHoldReason || 'Regulatory Compliance Hold'}</p>
        </div>
      `
            : '';
        const deletionControls = isHeld
            ? `
        <button type="button" class="btn btn-danger" disabled aria-disabled="true" title="Disabled: Document is under active legal hold">
          Request Deletion (Locked by Legal Hold)
        </button>
      `
            : `
        <button type="button" class="btn btn-danger" id="btn-request-delete" aria-label="Request document deletion">
          Request Deletion
        </button>
      `;
        return `
      <div class="compliance-view" role="region" aria-label="Compliance and Legal Hold Management">
        <header class="view-header">
          <h2>Compliance & Legal Hold: ${state.title}</h2>
        </header>

        ${legalHoldBanner}

        <div class="compliance-card">
          <h3>Retention Policy</h3>
          <p>Assigned Policy: <strong>${state.retentionPolicyName || 'Default 7-Year Retention'}</strong></p>
          <p>Scheduled Destruction Date: <strong>${state.retentionExpirationDate || '2033-08-28'}</strong></p>

          <hr class="divider" />

          <h3>Lifecycle Actions</h3>
          <div class="action-row">
            ${deletionControls}
          </div>
        </div>
      </div>
    `;
    }
}
//# sourceMappingURL=ComplianceView.js.map