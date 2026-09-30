# DCC ENTERPRISE PLATFORM — POST-GO-LIVE OBSERVABILITY & MONITORING PROTOCOL

## 1. Monitoring Windows & Observability Gates
Following production traffic cutover, operations teams maintain active monitoring across three distinct observation windows:
- **Immediate Post-Cutover Window**: 0 – 2 hours (Canary evaluation & smoke verification).
- **Extended Go-Live Window**: 2 – 24 hours (Full traffic load & worker queue throughput).
- **Steady-State Monitoring**: Day 2 onwards (Continuous SLO tracking & automated alert escalation).

---

## 2. Key Telemetry Metrics & Alert Thresholds

| Metric | Target / SLO | Warning Threshold | Critical Incident Trigger |
|---|---|---|---|
| **API Availability** | >= 99.9% | < 99.5% | < 99.0% (SEV1) |
| **API Latency (P95)** | < 200 ms | > 350 ms | > 500 ms (SEV2) |
| **Scan-Job Success Rate** | >= 99.5% | < 98.0% | < 95.0% (SEV2) |
| **OCR Processing Latency**| < 5000 ms | > 8000 ms | > 15000 ms (SEV3) |
| **Backup Currency (RPO)** | <= 60 min | > 90 min | > 180 min (SEV2) |
| **Storage Integrity** | 100% | 1 mismatch | >= 2 mismatches (SEV1) |
| **Worker Heartbeats** | Fresh (<60s) | > 60s (Stale) | All workers dead (SEV1) |
