# DCC ENTERPRISE PLATFORM — INCIDENT ESCALATION MATRIX & SLA POLICY

## 1. Severity Classifications & SLAs

| Severity | Description | Response SLA | Resolution SLA | Auto-Escalation Trigger |
|---|---|---|---|---|
| **SEV1** | Critical outage, data integrity compromise, storage failure | **< 15 minutes** | < 2 hours | 3 repeated CRITICAL alerts in 10m |
| **SEV2** | Major feature impaired (OCR queue blocked, scanning fleet offline) | **< 30 minutes** | < 4 hours | 3 repeated HIGH alerts in 10m |
| **SEV3** | Minor performance degradation, non-critical worker restart | **< 2 hours** | < 24 hours | 5 repeated WARNING alerts in 30m |
| **SEV4** | Cosmetic/UI bug, low-priority informational query | **< 8 hours** | Next sprint | Manual logging |

---

## 2. On-Call Escalation Paths
- **Level 1 (Automated SRE Alerts)**: Telemetry breach triggers `AlertEscalationService`, creating an active incident with an immutable audit timeline.
- **Level 2 (Primary On-Call SRE)**: Acknowledges incident via `/admin/incidents/:id/acknowledge` (Status $\rightarrow$ `INVESTIGATING`).
- **Level 3 (Engineering Lead / Lead Principal)**: Escalation for root-cause mitigation and fix deployment (Status $\rightarrow$ `RESOLVED`).
- **Level 4 (Post-Incident Review)**: Mandatory PIR recording upon incident closure (`postIncidentReview`).
