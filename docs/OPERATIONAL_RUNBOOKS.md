# DCC ENTERPRISE PLATFORM — OPERATIONAL RUNBOOKS

This document provides production runbooks for system administrators and site reliability engineers operating the DCC Enterprise Document Capture & Management Platform.

---

## 1. BACKUP & RESTORE PROCEDURES

### 1.1 Automated Scheduled Backups
- **Frequency**: Every 30 minutes for transaction logs (WAL), every 6 hours for full database dumps.
- **RPO SLA**: Maximum 60 minutes.
- **Archive Path**: `/var/dcc/backups/full_database_<TIMESTAMP>.tar.gz`
- **Verification**: Automatic SHA-256 integrity computation and registration in `backup_metadata`.

### 1.2 Isolated Restore Procedure
1. Create an isolated restoration sandbox:
   ```bash
   createdb -h localhost -U dcc_admin dcc_restore_sandbox
   ```
2. Restore the verified archive:
   ```bash
   pg_restore -h localhost -U dcc_admin -d dcc_restore_sandbox /var/dcc/backups/full_database_<TIMESTAMP>.tar.gz
   ```
3. Run checksum and document record consistency validation:
   ```bash
   npm run validate:production
   ```
4. Confirm `dcc_restore_sandbox` passes integrity checks before promoting or exporting data.

---

## 2. DISASTER RECOVERY DRILL PROCEDURES

### 2.1 Triggering a Recurring DR Drill
- **API Endpoint**: `POST /api/v1/admin/dr/recovery-drills`
- **Execution Endpoint**: `POST /api/v1/admin/dr/recovery-drills/:id/execute`
- **RTO SLA**: Maximum 30 minutes.

### 2.2 Verification Checklist
- [x] Database backup archive existence & SHA-256 match.
- [x] Object storage connectivity and bucket accessibility.
- [x] Document record checksum verification.
- [x] Zero mutations against active production database during the drill.

---

## 3. MONITORING, ALERTING & INCIDENT RESPONSE

### 3.1 Key Metrics Endpoints
- `GET /healthz`: Basic liveness probe.
- `GET /readyz`: Deep readiness probe checking PostgreSQL, Redis, and Object Storage.
- `GET /metrics`: Prometheus-compatible operational counters and duration metrics.

### 3.2 Operational Alert Severity Levels
- **CRITICAL**: Storage checksum mismatch, database failover, or RPO breach (> 60m).
  - *Action*: On-call engineer alerted immediately; inspect `operational_alerts` table.
- **HIGH**: Rate-limit burst violation or repeated worker task failures.
  - *Action*: Inspect `/api/v1/admin/dead-letters` and review Redis queue backpressure.
- **MEDIUM / LOW**: Stale scanner agent or delayed notification.

---

## 4. QUEUE BACKLOG & DEAD-LETTER RECOVERY

### 4.1 Inspecting Dead-Letter Items
- **API Endpoint**: `GET /api/v1/admin/dead-letters`
- Returns failed items across Outbox events, Webhooks, and Notifications.

### 4.2 Replaying Dead-Letter Items
- **API Endpoint**: `POST /api/v1/admin/dead-letters/:id/retry`
- Requeues the failed task with reset retry counters and structured audit tracking.

---

## 5. ROLLBACK & DEGRADATION PROCEDURES

### 5.1 Rolling Back Application Replicas
1. Revert container image tag in `docker-compose.prod.yml`.
2. Apply rolling update:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d --no-deps api-1 api-2
   ```
3. Verify readiness via `GET /readyz`.
