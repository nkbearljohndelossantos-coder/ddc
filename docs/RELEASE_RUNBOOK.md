# DCC ENTERPRISE PLATFORM — PRODUCTION RELEASE RUNBOOK

## 1. Release Philosophy & Principles
- **Immutable Artifacts**: Every production deployment uses immutable Git commit tags and container image digests.
- **Mandatory Pre-Deployment Backup**: A cryptographic database backup (SHA-256 verified) is created and validated prior to executing any migration or deployment step.
- **Zero-Downtime Rolling Update**: API instances are updated sequentially behind a load balancer; new instances do not receive live traffic until passing `/readyz` probes.

---

## 2. Release Execution Pipeline

```
[1. PRE-FLIGHT]          [2. BACKUP & VERIFY]          [3. MIGRATION]          [4. ROLLING DEPLOY]          [5. VERIFICATION]
node release-preflight -> Create pg_dump & SHA-256 -> prisma migrate deploy -> docker compose up -d -> node release-verify
```

### Step 1: Preflight Verification
Execute the automated preflight gate script:
```bash
node scripts/release-preflight.js
```
*Validates environment variables, secret strength, storage root isolation, distributed lock leases, and SSRF rules.*

### Step 2: Mandatory Backup Creation
Record the pre-deployment database backup and verify cryptographic checksum:
```bash
# Automated via BackupService or CLI:
pg_dump -Fc -d dcc_production > /var/backups/dcc/pre_release_$(date +%s).dump
sha256sum /var/backups/dcc/pre_release_*.dump
```

### Step 3: Safe Database Migration
Execute additive, forward-compatible schema migrations:
```bash
npx prisma migrate deploy
```

### Step 4: Zero-Downtime Rolling Deployment
Deploy updated API and Worker containers:
```bash
docker compose -f docker-compose.prod.yml up -d --no-deps --build api worker-ocr worker-sweeper
```

### Step 5: Post-Deployment Smoke & Telemetry Verification
Execute post-deployment verification script:
```bash
node scripts/release-verify.js
```

---

## 3. Canary & Staged Rollout Policy
1. **Canary Instance**: Deploy 1 canary container instance receiving 10% of ingress traffic.
2. **Evaluation Period**: Monitor for 15 minutes checking:
   - 5xx error rate < 0.01%
   - API latency P95 < 200 ms
   - Worker heartbeat freshness < 60s
3. **Full Promotion**: Promote the release to all cluster replicas upon passing canary evaluation.
