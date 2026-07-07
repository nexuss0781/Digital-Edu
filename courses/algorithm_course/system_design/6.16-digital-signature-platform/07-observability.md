# Observability

## Key Metrics

### Business Metrics

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|----------------|
| **Envelope completion rate** | % of sent envelopes that reach COMPLETED status | > 85% | < 75% (7-day rolling average) |
| **Average time-to-sign** | Time from signer notification to signature capture | < 24 hours | > 72 hours (median, weekly) |
| **Signer session abandonment rate** | % of signing sessions started but not completed | < 20% | > 35% |
| **Bulk send throughput** | Envelopes generated per minute during bulk operations | > 10,000/min | < 5,000/min |
| **Template utilization rate** | % of envelopes created from templates vs. ad-hoc | Informational | N/A |
| **Decline rate** | % of envelopes where a signer declines | Informational | > 15% for an org (may indicate UX issue) |

### System Performance Metrics

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|----------------|
| **Envelope creation latency (p99)** | Time to create envelope via API | < 1s | > 2s |
| **Signature capture latency (p99)** | Time from signature submission to confirmation | < 500ms | > 1s |
| **HSM request latency (p99)** | Time for HSM to complete signing operation | < 200ms | > 500ms |
| **PDF generation time (p99)** | Time to convert, render, or seal a PDF | < 5s | > 10s |
| **Document upload latency (p99)** | Time to upload and store a document | < 5s | > 10s |
| **Audit log write latency (p99)** | Time to write and hash-chain an audit event | < 50ms | > 200ms |
| **Signer email delivery (p95)** | Time from trigger to email accepted by provider | < 30s | > 60s |
| **Signing session load time (p99)** | Time for signer to see the first document page | < 3s | > 5s |

### Infrastructure Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|----------------|
| **HSM cluster utilization** | % of HSM signing capacity in use | > 70% |
| **Object storage write throughput** | PUT operations per second | > 80% of provider limit |
| **Database connection pool utilization** | % of connections in use | > 80% |
| **Message queue depth** | Pending messages in notification queue | > 10,000 messages |
| **Bulk send queue depth** | Pending bulk send messages | > 50,000 messages |
| **Audit log replication lag** | Delay between primary and backup audit store | > 30 seconds |
| **Cache hit rate** | % of reads served from cache | < 80% |

---

## Logging Strategy

### What to Log

Every signer action is legally significant and must be logged with sufficient detail for court proceedings:

#### Legally Required Logging

| Event | Required Fields | Retention |
|-------|----------------|-----------|
| **Signer authentication** | Signer email, auth method, success/failure, IP, user agent, geolocation, timestamp | Envelope retention period (7-10 years) |
| **Document viewed** | Signer ID, document ID, pages viewed, duration, IP, user agent, timestamp | Envelope retention period |
| **Field filled** | Signer ID, field ID, field type, value (redacted for PII), timestamp | Envelope retention period |
| **Signature captured** | Signer ID, signature type, document hash at signing time, IP, user agent, geolocation, timestamp | Envelope retention period |
| **Envelope completed** | All signer details, completion timestamp, document hashes | Envelope retention period |
| **Document downloaded** | Requester ID, document ID, IP, timestamp | Envelope retention period |

#### Operational Logging

| Log Category | Level | Example |
|-------------|-------|---------|
| **API requests** | INFO | `method=POST path=/api/v1/envelopes status=201 duration_ms=245 org_id=xxx` |
| **HSM operations** | INFO | `operation=sign key_id=xxx algorithm=RSA-2048 duration_ms=52 hsm_node=hsm-3` |
| **PDF processing** | INFO | `operation=convert input_type=docx pages=12 duration_ms=3200 worker=pdf-7` |
| **Notification delivery** | INFO | `type=email recipient=signer@example.com template=signing_invitation status=delivered provider_response_ms=450` |
| **Authentication failures** | WARN | `signer_id=xxx auth_method=sms_otp reason=invalid_code attempts=2 ip=1.2.3.4` |
| **HSM errors** | ERROR | `operation=sign key_id=xxx error=timeout hsm_node=hsm-3 duration_ms=5000` |
| **Audit chain errors** | CRITICAL | `envelope_id=xxx event=hash_chain_broken sequence=42 expected_hash=abc actual_hash=def` |

### Structured Log Format

```
{
    "timestamp": "2026-03-08T12:00:00.000Z",
    "level": "INFO",
    "service": "signature-capture-service",
    "trace_id": "abc-123-def-456",
    "span_id": "ghi-789",
    "envelope_id": "env-001",
    "org_id": "org-100",
    "event": "signature.captured",
    "signer_id": "signer-050",
    "signature_type": "click_to_sign",
    "signature_level": "ses",
    "document_hash": "sha256:abc123...",
    "duration_ms": 145,
    "ip": "203.0.113.50",
    "user_agent": "Mozilla/5.0...",
    "geolocation": "US-CA"
}
```

### Log Level Strategy

| Level | When | Example |
|-------|------|---------|
| **DEBUG** | Detailed internal state (disabled in production) | PDF byte ranges, hash computation steps |
| **INFO** | Normal operations | Envelope created, signature captured, email sent |
| **WARN** | Degraded but recoverable | Authentication retry, HSM latency > threshold, email delivery delayed |
| **ERROR** | Operation failed | PDF conversion failed, HSM timeout, database connection error |
| **CRITICAL** | System integrity at risk | Audit chain broken, HSM cluster unavailable, data corruption detected |

---

## Distributed Tracing

### Trace Propagation

Every request carries a trace ID through the entire signing flow:

```
Signing Flow Trace:
├── API Gateway (receive signing request)
│   ├── Auth Service (validate signer token)
│   ├── Signer Workflow Service (check routing step)
│   ├── Signature Capture Service (capture signature)
│   │   ├── HSM Client (sign document hash)
│   │   └── Audit Service (record signature event)
│   │       └── Database (write audit event)
│   └── Signer Workflow Service (advance routing)
│       ├── Database (update envelope state)
│       └── Message Queue (enqueue notification)
```

### Key Spans to Instrument

| Span Name | Service | What It Measures |
|-----------|---------|-----------------|
| `api.signing.submit` | API Gateway | Total signing request duration |
| `auth.signer.validate` | Auth Service | Signer token validation time |
| `workflow.routing.advance` | Signer Workflow | Routing state machine execution |
| `signature.capture` | Signature Capture | Signature processing time |
| `hsm.sign` | HSM Client | HSM cryptographic operation |
| `audit.event.write` | Audit Service | Audit event recording + hash chain |
| `pdf.render.page` | PDF Rendering | Single page rendering time |
| `pdf.seal.document` | Sealing Service | Document sealing with signatures |
| `notification.email.send` | Notification | Email preparation + delivery |
| `storage.object.put` | Object Storage Client | Document storage write |
| `storage.object.get` | Object Storage Client | Document retrieval |
| `db.envelope.update` | Database Client | Envelope state update |
| `bulk.envelope.create` | Bulk Send Worker | Single envelope creation in bulk operation |

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Runbook |
|-------|-----------|---------|
| **HSM cluster unavailable** | All HSM nodes in a cluster failing health checks for > 2 minutes | Failover to secondary cluster; if both down, page HSM vendor |
| **Audit chain integrity failure** | Any envelope's hash chain verification returns invalid | Immediately isolate affected envelope; compare against immutable backup; investigate for tampering |
| **Signature capture failure rate > 5%** | Rolling 5-minute window | Check HSM latency, DB connectivity, certificate validity |
| **Document storage write failure** | Object storage PUT operations failing > 1% for 5 minutes | Check storage capacity, network connectivity, IAM permissions |
| **Database primary unavailable** | Health check fails for > 30 seconds | Verify automatic failover triggered; if not, manual failover |
| **Zero envelopes completing** | No envelopes transition to COMPLETED for > 30 minutes during business hours | Check sealing service, HSM, database; may indicate systemic failure |

### Warning Alerts

| Alert | Condition | Response |
|-------|-----------|----------|
| **HSM latency p99 > 200ms** | Rolling 5-minute window | Monitor for escalation; scale HSM cluster if sustained |
| **PDF generation queue > 500** | Queue depth sustained for > 5 minutes | Scale PDF workers; check for stuck jobs |
| **Email delivery rate < 90%** | Rolling 15-minute window | Check email provider status; verify sending domain reputation |
| **Audit log replication lag > 10s** | Sustained for > 5 minutes | Check replication pipeline; increase consumer throughput |
| **Signing session abandonment > 30%** | Rolling 1-hour window | Check rendering performance; investigate UX issues |
| **Bulk send backlog > 50K** | Queue depth sustained for > 15 minutes | Scale bulk send workers; check for template processing errors |
| **Cache hit rate < 70%** | Rolling 15-minute window | Check cache cluster health; investigate access pattern changes |

---

## Dashboards

### Operations Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ DIGITAL SIGNATURE PLATFORM - OPERATIONS                 │
├─────────────────┬───────────────┬───────────────────────┤
│ Active Sessions │ Envelopes/min │ HSM Ops/sec           │
│    12,345       │     156       │       42              │
├─────────────────┼───────────────┼───────────────────────┤
│ Signature       │ PDF Gen       │ Email Delivery        │
│ Latency p99     │ Queue Depth   │ Rate                  │
│   245ms         │    34         │   98.5%               │
├─────────────────┴───────────────┴───────────────────────┤
│ [Envelope Funnel: Created → Sent → Signing → Completed] │
│ [HSM Latency Distribution: p50/p95/p99 over 24h]       │
│ [Signature Volume by Type: SES / AES / QES over 7d]    │
│ [Error Rate by Service over 24h]                        │
└─────────────────────────────────────────────────────────┘
```

### Compliance Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ COMPLIANCE & AUDIT                                      │
├─────────────────────────────────────────────────────────┤
│ Audit Chain Integrity: ✅ All chains valid              │
│ Last Full Verification: 2026-03-08 06:00 UTC            │
│ TSA Anchoring Status: ✅ Hourly anchoring active        │
│ Last Anchor: 2026-03-08 11:00 UTC                       │
├─────────────────────────────────────────────────────────┤
│ [Audit Events/Day - 30 Day Trend]                       │
│ [Signature Level Distribution: SES/AES/QES]             │
│ [Authentication Method Usage]                           │
│ [Data Residency Compliance: US/EU/APAC]                 │
│ [Certificate Expiry Timeline: Next 90 Days]             │
└─────────────────────────────────────────────────────────┘
```

### Bulk Send Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ BULK SEND OPERATIONS                                    │
├─────────────────┬───────────────┬───────────────────────┤
│ Active Batches  │ Envelopes/min │ Completion Rate       │
│      7          │    8,500      │     94.2%             │
├─────────────────┴───────────────┴───────────────────────┤
│ [Active Batch Progress Bars]                            │
│ [Bulk Send Throughput over 24h]                         │
│ [Failure Rate by Error Type]                            │
│ [Email Delivery Queue Depth]                            │
└─────────────────────────────────────────────────────────┘
```

---

## Audit Trail Monitoring

### Periodic Integrity Verification

The platform runs scheduled jobs to verify audit chain integrity:

| Check | Frequency | Scope |
|-------|-----------|-------|
| **Random sampling** | Every 15 minutes | Verify 100 random envelope audit chains |
| **Recent envelopes** | Every hour | Verify all chains for envelopes completed in the last hour |
| **Full verification** | Daily (off-peak) | Verify all chains for envelopes completed in the last 30 days |
| **Backup comparison** | Weekly | Compare primary audit store against immutable backup for last 7 days |
| **TSA anchor verification** | Daily | Verify all TSA timestamps are valid and chains match anchored values |

### Anomaly Detection

| Anomaly | Detection Method | Response |
|---------|-----------------|----------|
| **Unusual signing velocity** | Signer completing signatures faster than human possible (<2 seconds per field) | Flag for review; may indicate automated/fraudulent signing |
| **Geographic impossibility** | Same signer signing from two distant locations within minutes | Alert security team; may indicate token compromise |
| **Off-hours signing spike** | Unusual volume outside business hours for an org | Informational alert; may be legitimate (global org) or compromised account |
| **Mass decline pattern** | Multiple signers declining the same org's envelopes | Alert org admin; may indicate phishing or envelope spam |

---

## SLI/SLO Framework

| SLI (Service Level Indicator) | Measurement | SLO Target | Error Budget (30-day) |
|------------------------------|-------------|-----------|----------------------|
| **Signing availability** | % of signature capture requests returning 2xx in < 500ms | 99.99% | 4.3 minutes downtime |
| **Audit trail integrity** | % of envelope audit chains passing verification | 100% | Zero tolerance (any violation is SEV-1) |
| **Document sealing latency** | % of sealing operations completing in < 5s | 99.9% | 43 minutes of degraded sealing |
| **HSM operation success** | % of HSM signing requests succeeding in < 200ms | 99.99% | 4.3 minutes of HSM degradation |
| **Signer session load time** | % of signing session loads rendering first page in < 3s | 99.5% | 3.6 hours of slow session loads |
| **Email delivery** | % of signer notification emails accepted by provider in < 30s | 99.0% | 7.2 hours of delayed notifications |

### Error Budget Policy

| SLO | Burn Rate Alert (Fast) | Burn Rate Alert (Slow) | Exhaustion Action |
|-----|----------------------|----------------------|-------------------|
| **Signing availability 99.99%** | 14.4x in 1 hour | 3x in 6 hours | Freeze all non-critical deployments; redirect all engineering to reliability |
| **Audit integrity 100%** | Any single violation | N/A | Immediate SEV-1 incident; suspend signing for affected shard until verified |
| **HSM availability 99.99%** | 14.4x in 1 hour | 3x in 6 hours | Activate secondary HSM cluster; page HSM vendor |

---

## Cost Observability

| Dimension | Metrics to Track | Optimization Lever |
|-----------|-----------------|-------------------|
| **Object storage** | TB stored, GET/PUT requests/day, tier distribution (hot/warm/cold) | Aggressive lifecycle policies; move to cold after 30 days, archive after 1 year |
| **HSM operations** | Signing ops/day by type (SES skip vs AES vs QES), ops per HSM node, idle capacity | Ensure SES never touches HSM; right-size HSM cluster to peak + 30% headroom |
| **PDF processing** | CPU-hours for conversion, rendering, sealing; queue wait time | Cache rendered pages (TTL 1h); batch sealing during off-peak if latency allows |
| **Email delivery** | Emails sent/day, provider cost per email, bounce rate | Consolidate notifications (batch digest instead of per-event for CC recipients) |
| **Bandwidth** | Upload GB/day, download GB/day, cross-region transfer | CDN for document downloads; edge rendering for signing UI |
| **Database** | IOPS, storage growth rate, read replica utilization | Partition archiving; move completed envelope data to cold storage after retention threshold |

---

## On-Call Playbook: Signing Service Triage

```
ALERT RECEIVED: Signing operations degraded

Step 1: CLASSIFY
├── Signature capture latency > 1s p99?
│   └── Yes → Go to Step 2 (HSM path)
├── Signature capture failing > 5%?
│   └── Yes → Go to Step 3 (Service path)
└── Audit chain verification failing?
    └── Yes → Go to Step 4 (Integrity path - SEV-1)

Step 2: HSM PATH
├── Check HSM cluster health: all nodes responding?
│   ├── No → Failover to secondary HSM cluster
│   └── Yes → Check HSM latency per node
│       ├── Single node slow → Drain node, investigate
│       └── All nodes slow → Check HSM queue depth
│           ├── Queue deep → Rate limit non-critical ops
│           └── Queue normal → Check network latency to HSM

Step 3: SERVICE PATH
├── Check database connectivity
│   ├── DB unreachable → Verify failover status
│   └── DB reachable → Check envelope service health
│       ├── High error rate → Check recent deployments
│       └── Normal errors → Check object storage status
│           ├── Storage errors → Check provider status page
│           └── Storage OK → Check signing session load

Step 4: INTEGRITY PATH (SEV-1)
├── IMMEDIATE: Page security team + engineering lead
├── Isolate affected audit partition
├── Compare against immutable backup
│   ├── Match → False positive; investigate alerting bug
│   └── Mismatch → Execute audit compromise playbook
└── Do NOT restore service until root cause identified
```

---

## Compliance Audit Readiness

| Audit Type | Frequency | What Auditors Check | Pre-Audit Preparation |
|-----------|-----------|-------------------|---------------------|
| **SOC 2 Type II** | Annual | Access controls, encryption, audit trail integrity, change management | Export 12-month access logs, hash chain verification reports, deployment logs |
| **eIDAS conformity assessment** | Biennial | QTSP integration, QSCD certification, identity verification procedures | QTSP partnership documentation, HSM certification records, ID verification audit trail |
| **HIPAA audit** | Annual (if applicable) | BAA compliance, access controls, encryption, minimum necessary | PHI access logs, encryption verification, role-based access reports |
| **Penetration test** | Semi-annual | Signer token security, PDF injection, cross-envelope access, HSM access | Prepare test environment with synthetic data; coordinate HSM vendor access |
| **Internal security review** | Quarterly | Code review, dependency scanning, secret rotation, access review | Dependency audit report, secret rotation log, access privilege review |

---

## Signing Funnel Analytics

Tracking the conversion funnel from envelope creation to completion reveals system health and UX issues:

```
Signing Funnel (7-Day Rolling):

  Envelopes Created:    100,000  ████████████████████████████████ 100%
  Envelopes Sent:        98,500  ███████████████████████████████  98.5%
  Signer Notified:       97,200  ██████████████████████████████   97.2%
  Signing Session Start: 82,000  ████████████████████████         82.0%
  Signature Captured:    76,500  ███████████████████████          76.5%
  All Signers Complete:  71,800  █████████████████████            71.8%
  Document Sealed:       71,750  █████████████████████            71.8%
  Downloaded:            45,000  █████████████                    45.0%

  Key Drop-Off Points:
  - Sent → Session Start (15.5% loss): Signer never opens email
  - Session Start → Captured (6.7% loss): Session abandonment (UX/rendering issue)
  - Complete → Downloaded (37.3% loss): Normal - not all parties download immediately
```

### Drop-Off Alert Thresholds

| Funnel Stage | Normal Drop-Off | Alert Threshold | Possible Cause |
|-------------|----------------|----------------|---------------|
| Sent → Notified | < 2% | > 5% | Email delivery failure; domain reputation issue |
| Notified → Session Start | 15-20% | > 30% | Email landing in spam; signer link broken |
| Session Start → Captured | 5-10% | > 20% | Slow PDF rendering; confusing field layout; session timeout |
| Captured → Completed | < 2% | > 5% | Multi-signer stalling; reminders not working |
