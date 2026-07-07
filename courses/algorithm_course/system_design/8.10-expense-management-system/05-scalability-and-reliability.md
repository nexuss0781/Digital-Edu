# Scalability & Reliability

## Scaling Strategy Overview

An expense management platform has highly uneven load patterns. Month-end and quarter-end periods generate 8--10x normal submission volume as employees rush to file before deadlines. The OCR pipeline is GPU-bound and bursty, while the policy engine and approval service are CPU-bound and latency-sensitive. Receipt storage grows monotonically and must remain accessible for 7+ years (tax audit retention).

| Component | Scaling Dimension | Strategy | Primary Slowest part of the process |
|-----------|------------------|----------|-------------------|
| Expense Service | Submissions/sec | Stateless horizontal scaling | CPU + DB writes |
| Policy Engine | Evaluations/sec | Stateless horizontal scaling | CPU (rule evaluation) |
| OCR Pipeline | Queue depth | GPU worker auto-scaling | GPU memory + throughput |
| Approval Service | Requests/sec | Stateless horizontal scaling | Downstream DB latency |
| Reporting Service | Query complexity | Read-replica fan-out | Database I/O |
| Receipt Storage | Object count | Object storage (infinite scale) | Network bandwidth |

---

## 1. Horizontal Scaling Strategy

### Stateless Service Tier

The expense service, policy engine, and approval service are fully stateless. All workflow state lives in the database or distributed cache.

```
Load Balancer (Layer 7)
├── Expense Service Pool   → reads org config from cache, writes to sharded DB
├── Policy Engine Pool     → fetches rules from cache, evaluates in-memory
├── Approval Service Pool  → reads approval chain from cache, updates DB
└── Reporting Service Pool → queries read replicas, caches aggregated results
```

### OCR Pipeline: GPU Worker Auto-Scaling

```
Receipt Upload → Object Storage → OCR Job Queue → GPU Workers → Extracted Data

GPU Worker Pool:
  Baseline: 4 workers (~200 receipts/min) | Peak: 40 workers (~2,000 receipts/min)

Auto-scale triggers:
  Queue depth > 500    → Add 4 workers
  Queue depth > 2,000  → Add 12 workers
  Queue depth > 10,000 → Scale to max capacity (month-end surge)
  Queue depth < 50 for 10 min → Remove 2 workers
```

### Database: Shard by Organization

**Shard key**: `org_id`. All data for an organization (expenses, policies, approval chains, audit logs) co-locates on the same shard --- tenant isolation without cross-shard joins.

```
Co-located tables per shard:
  Expense, ExpenseLineItem, ExpenseReport,
  ApprovalWorkflow, ApprovalStep, PolicyRule, AuditLog

Sizing: 32 shards initial | ~500 GB per shard | 2 read replicas per shard
Large tenants (100K+ employees): dedicated shards to prevent hot-spot contention
```

### Receipt Storage

Object storage scales infinitely. Thumbnails served via CDN with 30-day TTL.

```
Lifecycle policy:
  0-2 years:  Hot storage (instant access)
  2-7 years:  Warm storage (access within seconds)
  7+ years:   Cold archive (access within hours, retained for compliance)
```

---

## 2. Auto-Scaling Triggers

```
Expense Service:
  Scale-out: p99 > 300ms for 2 min OR CPU > 70% for 3 min → +2 instances
  Scale-in:  p99 < 100ms AND CPU < 25% for 15 min → -1 instance
  Min: 4 | Max: 40

Policy Engine:
  Scale-out: p99 > 200ms for 1 min OR queue depth > 500 → +3 instances
  Min: 3 | Max: 30

OCR Queue:
  Queue depth > 10K → scale to max GPU workers
```

### Calendar-Based Pre-Scaling

```
FUNCTION pre_scale_for_period(date):
    IF is_month_end_window(date):           // last 3 business days
        SET expense_service.min = baseline * 3
        SET ocr_workers.min = baseline * 5

    IF is_quarter_end_window(date):         // last 5 business days
        SET expense_service.min = baseline * 5
        SET ocr_workers.min = baseline * 8

    IF is_fiscal_year_end(date, org):       // org-specific
        SET shard[org].read_replicas += 2
```

---

## 3. Caching Layers

**L1 --- In-Process Policy Rule Cache**: Each policy engine instance caches compiled rules per org. Rules change infrequently but are evaluated on every submission.

```
Content: Compiled policy rule sets, per org_id
TTL: 5 minutes | Invalidation: event-driven + TTL | Hit rate: ~98%
```

**L2 --- Distributed Cache**:

```
FX Rates:            key="fx:{base}:{target}:{date}"       TTL: 1 hour
Org Settings:        key="org_settings:{org_id}"            TTL: 10 min
Employee Hierarchy:  key="hierarchy:{org_id}:{emp_id}"      TTL: 15 min
Approval Templates:  key="chain:{org_id}:{category}:{tier}" TTL: 10 min
```

**CDN**: Receipt thumbnails (30-day TTL), report PDFs (7-day TTL). Version-bumped cache keys for invalidation on regeneration.

---

## 4. Hot Spot Mitigation

**Large enterprise tenants** (100K+ employees) can produce 500K submissions in 48 hours at quarter-end.

```
Mitigation:
  1. Dedicated database shards for tenants > 50K employees
  2. Isolated OCR worker pools for top-10 tenants (prevents queue starvation)
  3. Per-tenant rate limiting: standard=100/min, enterprise=2,000/min, burst=3x for 5 min
  4. Queue-based admission control under extreme load:
     IF global_queue_depth > CRITICAL_THRESHOLD:
         ENQUEUE with priority = tenant_tier
         RETURN 202 Accepted with estimated_processing_time
```

**Month-end / quarter-end spikes**:

```
Day 1-25: 1x baseline | Day 26-28: 3x | Day 29-30: 8x | Last day: 10x | Quarter-end: 15x

Response: Pre-scale 48h before surge, batch-optimize OCR, defer analytics jobs
```

---

## 5. Reliability & Fault Tolerance

### SPOF Analysis

| Component | SPOF Risk | Mitigation |
|-----------|-----------|------------|
| Expense Database | Primary failure | Multi-AZ, auto-failover to synchronous replica |
| OCR Pipeline | GPU worker failure | Queue-based; failed jobs auto-retry on other workers |
| Policy Engine | Instance failure | Stateless; LB removes unhealthy instances |
| Receipt Storage | Storage failure | Cross-region replication, 11-nines durability |
| Card Feed Ingestion | Provider outage | Circuit breaker + retry queue; manual entry fallback |
| FX Rate Provider | Provider outage | Cached rates (< 4h old); fallback to secondary provider |
| ERP Sync | ERP outage | Outbound queue buffers events; replays on recovery |

### Redundancy

```
Region A (Primary)                    Region B (Standby)
┌──────────────────────┐              ┌──────────────────────┐
│ Expense Service      │              │ Expense Service      │
│ Policy Engine        │              │ Policy Engine        │
│ OCR Pipeline         │              │ OCR Pipeline (warm)  │
│ Approval Service     │              │ Approval Service     │
│                      │              │                      │
│ DB Primary (writes)  │──sync──────► │ DB Replica (reads)   │
│ Receipt Storage      │──async─────► │ Receipt Storage      │
│ Cache Cluster        │──async─────► │ Cache Cluster        │
└──────────────────────┘              └──────────────────────┘

Active-passive rationale: approval workflows require strong consistency;
duplicate reimbursement prevention demands single-writer semantics.
```

### Failover

- **Database**: Synchronous replica auto-promoted on primary failure. Connection pool refreshes within 10s. In-flight transactions retry via idempotency keys.
- **OCR queue**: Failed jobs re-enqueued automatically. Receipts persist in object storage --- jobs can be resubmitted from source.
- **Reimbursement payments**: Queued on banking API failure; retried with idempotent payment references to prevent double-pay.

### Circuit Breakers

```
Corporate Card Feed API:
  Threshold: 40% errors over 60s | Fallback: buffer feed data, retry later

Banking / Payment API:
  Threshold: 30% errors over 30s | Fallback: queue reimbursements, notify finance

ERP / Accounting Sync:
  Threshold: 50% errors over 120s | Fallback: buffer journal entries, alert accounting

FX Rate Provider:
  Threshold: 3 consecutive failures | Fallback: use cached rates (< 4h), flag for review
```

### Retry Strategy

```
FUNCTION submit_expense_with_retry(expense, idempotency_key):
    existing = cache.get("idempotency:" + idempotency_key)
    IF existing: RETURN existing.response

    FOR attempt IN 1..MAX_RETRIES:
        TRY:
            result = expense_service.create(expense, idempotency_key)
            cache.set("idempotency:" + idempotency_key, result, ttl=24h)
            RETURN result
        CATCH transient_error:
            SLEEP(MIN(base_delay * 2^attempt + jitter(), max_delay))
        CATCH permanent_error:
            RETURN error

    ENQUEUE_FOR_MANUAL_REVIEW(expense)

Retry config:  Submission=3/200ms/2s | Policy=2/100ms/500ms
                Reimbursement=5/1s/30s | ERP sync=5/5s/5min
```

### Graceful Degradation

```
Level 0 — Full: OCR + policy checks + real-time approval routing

Level 1 — OCR Down: Manual expense entry; OCR queue drains when restored
  "Smart scan temporarily unavailable. Please enter details manually."

Level 2 — Approval Degraded: Email-based approvals as fallback
  Trigger: approval latency > 5s or error rate > 30%

Level 3 — Read Replica Failure: Dashboards show cached data with staleness indicator
  Reads redirected to primary with rate limiting

Level 4 — Primary DB Failover: Read-only mode; new submissions queued
  "Submissions temporarily queued. Your expense will be processed shortly."
```

### Bulkhead Pattern

```
Pool 1: Real-Time Expense Ops     → submission, policy, approval
  Dedicated DB connection pool (200 connections/shard), independent thread pool

Pool 2: OCR Processing            → scanning, extraction, categorization
  Dedicated GPU workers; failure does NOT affect submissions or approvals

Pool 3: Reporting & Analytics     → dashboards, exports, report generation
  Uses read replicas only; long queries timeout at 30s

Pool 4: External Integrations     → card feeds, ERP sync, banking APIs
  Dedicated connection pools per external system; failures contained
```

---

## 6. Disaster Recovery

### Recovery Objectives

| Component | RPO | RTO | Strategy |
|-----------|-----|-----|----------|
| Expense Database | < 1 min | < 5 min | Synchronous replication + auto-failover |
| Receipt Storage | 0 | < 1 min | Active-active object storage replication |
| Approval Workflow | < 1 min | < 5 min | Replicated with expense database |
| OCR Job Queue | < 5 min | < 10 min | Queue replication; resubmit from object storage |
| Cache Cluster | N/A | < 3 min | Warm standby; rebuild from DB on failover |
| Audit Logs | < 1 min | < 10 min | Append-only log with synchronous replication |

### Backup Strategy

```
Continuous: DB WAL streaming to standby region (< 1 min lag)
            Receipt cross-region replication (async)
Daily:      Full DB snapshot at 02:00 UTC (30-day retention)
            Incremental backups every 6 hours
Weekly:     Restore validation in isolated environment
Annually:   Full DR drill; validate 7-year receipt retrieval from cold archive
```

### Multi-Region Strategy

```
Data tier:
  Active-passive: transactional databases (strong consistency required)
  Active-active:  receipt object storage (eventual consistency acceptable)

Failover (target RTO < 4 hours):
  1. Health monitor detects degradation (3 failed checks, 15s)
  2. DNS failover routes traffic to secondary region (< 60s)
  3. Database replica promoted to primary (< 2 min)
  4. Cache warms from promoted DB (< 3 min for hot data)
  5. OCR queue rehydrated from pending receipts in object storage

Failback:
  1. Original region restored, reverse replication established
  2. Quiesce writes, verify replication caught up
  3. DNS cutover during low-traffic window
```

---

## 7. Data Lifecycle Management

Receipt images and audit logs dominate storage costs over the 7-year retention window. A tiered data lifecycle policy keeps costs manageable while maintaining compliance.

### Storage Tier Transitions

```
Receipt Images:
  Hot  (0-90 days):   Standard object storage; CDN-served thumbnails
  Warm (90d-2 years): Infrequent-access tier; thumbnails cached on demand
  Cold (2-7 years):   Archive tier; retrieval within 4 hours; no thumbnails
  Purge (7+ years):   Delete after confirming no active audit hold

Expense Metadata:
  Hot  (0-1 year):    Primary DB; full indexing
  Warm (1-3 years):   Read replicas; reduced indexing
  Cold (3-7 years):   Compressed archive DB; query via async job
  Purge (7+ years):   Archive to immutable audit store; drop from active DB

Audit Logs:
  Hot  (0-6 months):  Active partitions; full indexing for compliance queries
  Warm (6m-2 years):  Compressed partitions; index on entity_id + timestamp only
  Cold (2-7 years):   Archive storage; hash-chain verification maintained
  Purge (7+ years):   Verify hash chain integrity; archive to compliance vault
```

### Automated Lifecycle Step-by-step plan in plain English

```
FUNCTION run_data_lifecycle(org_id):
    -- Phase 1: Identify data eligible for tier transition
    hot_to_warm = QUERY Receipt
        WHERE org_id = org_id AND storage_tier = "hot"
        AND created_at < NOW() - INTERVAL '90 days'
        AND NOT EXISTS (SELECT 1 FROM AuditHold WHERE entity_id = receipt_id AND active = true)

    FOR EACH receipt IN hot_to_warm:
        move_to_warm_storage(receipt.original_url)
        UPDATE Receipt SET storage_tier = "warm" WHERE receipt_id = receipt.receipt_id

    -- Phase 2: Archive cold data
    warm_to_cold = QUERY Receipt
        WHERE org_id = org_id AND storage_tier = "warm"
        AND created_at < NOW() - INTERVAL '2 years'
    FOR EACH receipt IN warm_to_cold:
        move_to_archive_storage(receipt.original_url)
        UPDATE Receipt SET storage_tier = "cold" WHERE receipt_id = receipt.receipt_id

    -- Phase 3: Purge expired data (with legal hold check)
    expired = QUERY Receipt
        WHERE org_id = org_id AND storage_tier = "cold"
        AND created_at < NOW() - INTERVAL '7 years'
        AND NOT EXISTS (SELECT 1 FROM AuditHold WHERE entity_id = receipt_id AND active = true)
    FOR EACH receipt IN expired:
        delete_from_archive(receipt.original_url)
        SOFT_DELETE Receipt WHERE receipt_id = receipt.receipt_id
        audit_log("data_purged", receipt.receipt_id, { reason: "retention_expired" })
```

---

## 8. Data Residency and Regional Compliance

Global organizations must comply with data residency requirements (GDPR in EU, LGPD in Brazil, PIPL in China). Employee expense data may be required to remain within specific geographic boundaries.

| Requirement | Impact | Architecture Response |
|------------|--------|----------------------|
| **EU data residency (GDPR)** | Employee PII must be processed and stored within EU | EU-region database shards; EU-region receipt storage buckets |
| **Cross-border transfer** | Expense data for global travelers crosses regions | Data minimization: transfer only aggregated, non-PII data; keep PII in origin region |
| **Right to erasure** | Employee requests deletion of personal data | Soft-delete with 30-day retention; hard-delete PII fields while preserving audit trail structure |
| **Data portability** | Employee requests export of their expense data | Automated export endpoint generating structured JSON/CSV of all personal expense records |

```
Regional routing:
  EU employees  → eu-west database shard, eu-west receipt storage
  US employees  → us-east database shard, us-east receipt storage
  APAC employees → ap-southeast database shard, ap-southeast receipt storage

Cross-region reporting: Analytics warehouse receives pseudonymized data only
  (org_id, department, category, amount — NO employee_id, name, or bank details)
```

---

## 9. Load Testing Strategy

| Scenario | Traffic Pattern | Duration | Success Criteria |
|----------|----------------|----------|-----------------|
| **Baseline** | Steady 6 TPS submissions, 17 TPS policy checks | 30 min | p99 < SLO targets; 0 errors |
| **Month-end ramp** | Linear ramp from 1x to 10x over 3 hours | 3 hours | Auto-scaling triggers within 5 min; p99 < 2x SLO |
| **Month-end spike** | Instant jump to 10x sustained | 1 hour | No request failures; queue depth stabilizes |
| **Quarter-end compound** | 15x expense + 5x approval + 3x reimbursement | 2 hours | All services remain responsive; no cascade failure |
| **OCR saturation** | 500 receipts/min sustained (5x normal peak) | 30 min | Queue drains within 30 min of returning to normal |
| **Single-tenant surge** | One enterprise tenant at 100x their normal rate | 1 hour | Other tenants unaffected (< 10% latency increase) |
| **Card feed batch burst** | 500K transactions in 5-minute batch window | 15 min | All transactions ingested; matching completes within 1 hour |
| **DR failover** | Primary region failure during month-end | 30 min | RTO < 5 min; no data loss; no duplicate reimbursements |
