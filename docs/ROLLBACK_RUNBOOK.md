# DCC ENTERPRISE PLATFORM — PRODUCTION ROLLBACK RUNBOOK

## 1. Rollback Trigger Criteria
An immediate rollback must be initiated if any of the following objective criteria are met during release verification or the 1-hour post-deployment observation window:
1. **Sustained Error Rate**: HTTP 5xx error rate exceeds 0.5% over a 3-minute window.
2. **Readiness Probe Failure**: New container replicas fail `/readyz` probes for > 2 consecutive checks.
3. **Queue / Worker Degradation**: Worker heartbeats become `STALE` or queue backlog grows by > 500 jobs without drain.
4. **SLO Breach**: Any `CRITICAL` SLO threshold breach occurs (e.g. API P95 latency > 500 ms).
5. **Data Integrity Incident**: Any document checksum or storage verification mismatch is flagged.

---

## 2. Safe Application Rollback Procedure
Because database migrations in DCC are strictly forward-compatible and non-destructive, application containers can be safely rolled back to the previous immutable release image without altering database tables:

```bash
# 1. Roll back API and worker containers to previous known-good tag
docker compose -f docker-compose.prod.yml down --remove-orphans
docker compose -f docker-compose.prod.yml up -d --build api:previous-tag worker:previous-tag

# 2. Verify previous container health
curl -f http://localhost:3000/healthz
curl -f http://localhost:3000/readyz

# 3. Roll back configuration versions if applicable
# Trigger POST /api/v1/admin/config-versions/:id/rollback
```

---

## 3. Database Schema Contingency Policy
- **Forward Compatibility Rule**: All migrations in DCC are additive (new nullable columns, new tables, or non-blocking indexes). Therefore, old application versions can safely run against the migrated schema.
- **Destructive Rollback Prohibition**: Automated schema rollbacks that drop columns or tables are strictly prohibited against live production databases.
- **Isolated Point-In-Time Recovery**: If data corruption occurs, restore the verified pre-deployment backup into an isolated sandbox environment first, verify integrity, and coordinate a controlled maintenance window.
