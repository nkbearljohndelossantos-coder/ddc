# DCC ENTERPRISE PLATFORM — PRODUCTION GO-LIVE CHECKLIST

## 1. Pre-Go-Live Acceptance Gates
- [x] **Mandatory Backup Verified**: Pre-deployment PostgreSQL backup created with verified SHA-256 checksum.
- [x] **Disaster Recovery Status**: DR failover drill verified in isolated sandbox (observed RPO < 60m, RTO < 30m).
- [x] **Database Migrations Reviewed**: All migrations are forward-compatible and non-destructive.
- [x] **Security Release Gate Passed**: Zero hardcoded secrets, SSRF protection active, path traversal blocked, tenant/dept isolation verified.
- [x] **Environment Validated**: `scripts/release-preflight.js` executed with 0 errors.
- [x] **Containers Built**: Docker production images built and tagged with Git commit SHA.
- [x] **Frontend Production Build**: `apps/web` compiled with zero TypeScript errors and zero embedded secrets.
- [x] **Worker Fleet Compatibility**: OCR, sweeper, and outbox workers validated for graceful shutdown and heartbeat reporting.
- [x] **Rollback Plan Confirmed**: Application rollback runbook confirmed with ops team.

---

## 2. Go-Live Deployment Execution
- [x] **Deploy API Replicas**: Rolling update initiated behind load balancer.
- [x] **Readiness Probes**: `/readyz` probes returning HTTP 200 on all new instances.
- [x] **Smoke Tests**: Production smoke tests (`phase19_production_smoke.test.ts`) executed successfully.
- [x] **Live Traffic Cutover**: Traffic shifted 100% to new release containers.
- [x] **Incident & Alert Watch**: SRE Operations console (`/admin/operations`) actively monitoring alert escalations.

---

## 3. Post-Go-Live Operational Verification
- [x] **SLO Compliance**: API availability > 99.9%, P95 latency < 200 ms, OCR latency < 5000 ms.
- [x] **Worker Heartbeats**: All registered workers reporting healthy heartbeats (< 60s).
- [x] **Queue Health**: BullMQ queues active with 0 stalled jobs and 0 unhandled dead letters.
- [x] **Object Storage Consistency**: 100% cryptographic checksum verification on uploaded blobs.
- [x] **Compliance Audit Trail**: Document lifecycle events, access logs, and security events recording immutably.
- [x] **Final Sign-Off**: Production go-live declared successfully executed.
