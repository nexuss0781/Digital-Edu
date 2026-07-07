# 14.1 AI-Native MSME Credit Scoring & Lending Platform — Scalability & Reliability

## Scaling the Credit Decision Pipeline

### Challenge: Festival Season 3x Volume Spike

The MSME lending market exhibits extreme seasonality: Diwali season (October–November) and harvest financing (March–April) drive 3x application volume spikes. The credit decision pipeline—from AA data fetch through scoring to approval—must scale from 6 applications/sec to 85 applications/sec without degrading the 5-second SLO.

### Scaling Strategy: Horizontal Pipeline Decomposition

The credit decision pipeline is decomposed into independently scalable stages:

```
Stage 1: Application Ingestion & Validation
  - Stateless API workers behind a load balancer
  - Auto-scale from 10 to 50 instances based on request queue depth
  - Each worker: validate input, create application record, enqueue for processing
  - Throughput: 200 applications/sec per instance (I/O-bound: writes to database)
  - Scaling: 10 instances handle baseline; 50 instances handle 3x peak

Stage 2: Data Fetching (AA + Bureau + KYC)
  - Orchestrator service that dispatches parallel data fetches
  - Slowest part of the process: external API latency (AA: 15-60s, Bureau: 2-5s, KYC: 1-3s)
  - Each orchestrator instance handles 100 concurrent fetch operations
  - Auto-scale from 20 to 100 instances based on in-flight fetch count
  - Timeout strategy: proceed with partial data if any source exceeds timeout
  - AA fetch pool: dedicated connection pool per FIP with rate limiting
    to respect FIP throughput limits (typically 100 requests/sec per AA)

Stage 3: Data Processing (Parsing + Feature Engineering)
  - CPU-intensive: bank statement OCR, transaction categorization, feature computation
  - Auto-scale from 50 to 500 worker pods based on processing queue depth
  - Bank statement parsing: ~500ms per page, 10 pages average = 5 seconds per statement
  - Feature engineering: ~50ms per borrower (read pre-computed features + compute deltas)
  - Stateless workers pull from a partitioned queue (partition key: application_id)

Stage 4: Credit Scoring
  - Model inference: ~200ms per application (including SHAP explanation)
  - Scoring workers hold model artifacts in memory (750MB per worker)
  - Auto-scale from 10 to 50 instances based on scoring queue depth
  - Each instance: loads model on startup, handles 100 inferences/sec
  - Model artifacts cached locally; model registry pushes updates via pub/sub

Stage 5: Underwriting Decision
  - Lightweight: policy rule evaluation + score-to-decision mapping
  - Co-located with scoring workers (no separate scaling needed)
  - Manual review queue: capped at 30% of applications; excess auto-declined with
    "high volume" reason code to prevent unbounded queue growth
```

### Scaling the Feature Store

The feature store holds 10M borrower profiles at ~1.8 KB each (17.7 GB total). During peak season, feature read rates spike to 85/sec (one per application) plus 200/sec (embedded finance offer checks), and feature write rates spike to 50/sec (AA data arrivals updating profiles).

```
Feature store architecture:
  - In-memory key-value store sharded by borrower_id hash
  - 4 shards × 4.4 GB each = 17.7 GB total
  - Read replication: 3 read replicas per shard for query distribution
  - Write path: write to primary shard, async replicate to read replicas (< 100ms lag)
  - Cache hit rate: >99% for active borrowers (repeat applications within 30 days)
  - Cold borrower feature computation: triggered on-demand during AA data fetch
  - TTL: feature vectors expire after 90 days of inactivity

Auto-scaling:
  - Add read replicas when per-shard query latency p95 > 50ms
  - Shard splitting when any shard exceeds 6 GB (triggered by portfolio growth)
  - Peak season: pre-scale read replicas from 3 to 6 per shard (scheduled, not reactive)
```

---

## Scaling the Collection Pipeline

### Challenge: Month-End Collection Surge

EMI due dates cluster around the 1st, 5th, 7th, and 15th of each month. On the 1st, approximately 30% of all active loans (3M loans) have EMI due, creating a burst of auto-debit executions, reminder messages, and collection actions.

```
Month-end surge handling:
  Auto-debit execution:
    - 3M NACH instructions submitted to banks in the overnight batch (12 AM – 6 AM)
    - Submitted in bank-specific batches (each bank has its own file format and submission window)
    - Response processing: bank returns success/failure by 10 AM
    - 3M × 25% failure rate = 750K failed auto-debits requiring retry or escalation

  Communication burst:
    - Pre-due reminders (3 days before): 3M SMS + 3M push notifications
    - Post-failure follow-ups: 750K WhatsApp messages within 4 hours of failure notification
    - Channel capacity: SMS gateway handles 50,000/min; WhatsApp Business API handles 10,000/min

  Collection worker scaling:
    - SMS workers: scale from 5 to 20 instances (50K SMS/min capacity)
    - WhatsApp workers: scale from 3 to 15 instances (10K messages/min)
    - IVR workers: scale from 5 to 25 instances (1,000 concurrent calls)
    - Pre-scheduled scaling on the 28th of each month to be ready for the 1st
```

---

## Reliability Architecture

### Credit Decision Service: Four-Nines Availability (99.99%)

The credit decision service is business-critical: every minute of downtime represents lost loan applications and revenue. However, it depends on external services (AA, bureau, payment rails) that have lower availability.

```
Redundancy architecture:
  Application layer:
    - Multi-zone deployment: 3 availability zones, each with full service stack
    - Zone-level failover: if one zone loses connectivity, traffic routes to remaining 2
    - No cross-zone dependencies in the critical path
    - Database: multi-zone primary with synchronous replication to one zone,
      async to the third (RPO=0 for zone failure, RPO<5s for region failure)

  External dependency isolation:
    - AA gateway: circuit breaker per FIP (open after 5 consecutive failures)
      Fallback: proceed with partial data if ≥1 bank statement available
    - Bureau service: circuit breaker with 30-second timeout
      Fallback: route to thin-file model if bureau unavailable
    - Payment rails: multi-rail with automatic failover (UPI → IMPS → NEFT)
    - Each external dependency has a health check endpoint polled every 10 seconds
      Dashboard shows real-time health of all 50+ FIPs and payment partners

  Fraud detection service:
    - Fail-closed design: disbursement blocked if fraud service unavailable
    - Availability target: 99.99% (higher than core platform)
    - Deployment: separate from main application cluster for isolation
    - Degraded mode: if full fraud service is down, fast-path rules (cached locally
      at application nodes) provide basic fraud screening for up to 15 minutes
    - Queued applications re-checked when full service recovers
```

### Failure Modes and Recovery

| Failure Mode | Impact | Detection | Recovery |
|---|---|---|---|
| **AA gateway timeout** | Cannot fetch bank statements for affected FIP | FIP health check timeout | Circuit breaker opens; proceed with data from other FIPs; retry in 5 minutes |
| **Bureau service unavailable** | Cannot pull bureau score | API timeout / error rate spike | Route all applications to thin-file model; queue bureau pulls for retry |
| **Credit scoring engine crash** | Applications queue up, no decisions | Health check failure + queue depth spike | Auto-restart with model reload (30 seconds); hot standby takes over in 5 seconds |
| **Fraud service unavailable** | Disbursements blocked (fail-closed) | Health check failure | Degraded mode: fast-path rules only for 15 minutes; full block if >15 minutes |
| **Payment rail failure (UPI)** | Disbursements delayed | Success rate drop below 90% | Automatic failover to IMPS; notify operations team |
| **Feature store shard failure** | Scoring degraded for affected borrower partition | Read timeout spike | Promote read replica to primary; cold-compute features from source data |
| **Database primary failure** | Write operations fail | Connection refused / timeout | Automatic failover to synchronous replica (RPO=0, RTO<30 seconds) |
| **Collection SMS gateway failure** | Reminders not sent | Delivery report failure rate spike | Failover to backup SMS provider (2 providers configured active-passive) |

### Data Durability

```
Loan records (business-critical, regulatory requirement):
  - Synchronous replication across 2 zones
  - Write-ahead log with guaranteed durability before acknowledgment
  - RPO: 0 (zero data loss)
  - RTO: < 30 seconds (automatic failover to synchronous replica)
  - Backup: daily snapshot to object storage; 8-year retention

Credit decision audit trail:
  - Append-only event store with cryptographic chaining
  - Synchronous replication across 2 zones
  - RPO: 0 (regulatory requirement: every decision must be auditable)
  - RTO: < 5 minutes (read-only during failover; decisions continue on new primary)
  - Retention: 8 years (regulatory mandate)

Feature store:
  - Asynchronous replication
  - RPO: < 1 minute (acceptable: features can be recomputed from source data)
  - RTO: < 5 minutes (promote read replica)
  - Source data: AA-fetched bank statements retained for 90 days for recomputation

Fraud detection graph:
  - Asynchronous replication
  - RPO: < 5 minutes
  - RTO: < 10 minutes
  - Acceptable: graph can be rebuilt from application event stream (2-hour rebuild)

Document store (KYC images, bank statements):
  - Object storage with cross-region replication
  - RPO: < 1 hour (acceptable: documents can be re-fetched from AA or re-uploaded)
  - Retention: 8 years (regulatory mandate for KYC documents)
```

---

## Handling Peak Events

### Scenario: Diwali Festival Season — 3x Application Volume

During the 2-week Diwali period, MSME working capital demand spikes as businesses stock inventory for the festive season. Application volume increases from 500K/day to 1.5M/day.

**Platform response:**

```
Timeline:
  T-30 days: Festival season detected in historical patterns
    → Pre-scale all pipeline stages to peak capacity
    → Pre-warm feature store with recent borrower profiles
    → Pre-allocate co-lending capital with banking partners
    → Increase fraud detection sensitivity (festival season attracts fraud rings)

  T-7 days: Partner APIs report pre-qualification check volume increasing
    → Activate festival-season credit policies (higher limits for repeat borrowers)
    → Scale AA data fetch pool: increase concurrent connections to FIPs
    → Notify FIPs of expected volume increase (coordination protocol)

  T-0: Festival season peak begins
    → Application rate: 85/sec (3x normal)
    → Auto-scale: scoring workers 10 → 50, processing workers 50 → 500
    → Manual review queue grows: increase auto-approve threshold for
       repeat borrowers with clean repayment history (reduce manual review load)
    → Disbursement volume: 800/hour → monitor payment rail capacity

  T+14 days: Festival season ends
    → Gradually scale down over 3 days (not instant: late applications still coming)
    → Post-season analysis: compare default rates for festival-season originations
       vs. normal-season originations to validate festival policy decisions
    → Model retraining with festival-season data included in training set

  T+90 days: First EMI for festival-season loans
    → Heightened monitoring: festival-season vintage default rates
    → Early warning model recalibrated with festival-season features
    → Collection readiness: pre-allocate collection capacity for expected
       higher delinquency in festival-season cohort (historically 1.5x)
```

---

## Geographic Distribution

### Multi-Region Deployment for Regulatory Compliance

```
Region configuration:
  Primary region: handles all live application processing, scoring, and disbursement
  DR region: handles backup and read-only analytics
  Data sovereignty: all borrower PII stored within country (regulatory requirement)

  Within-region distribution:
    - 3 availability zones for high availability
    - Application processing distributed across zones by hash(application_id)
    - Database primary in Zone A, sync replica in Zone B, async replica in Zone C
    - External API connections (AA, bureau, payment) from Zone A and B (active-active)

Geographic scaling for collection:
  - Collection operations distributed by borrower geography
  - Regional collection teams handle local language and field operations
  - Communication templates localized per state/language
  - Field collection routes optimized per city with daily batch routing algorithm
```

### Partner API Regional Endpoints

```
Partner API distribution:
  - Single logical API endpoint with geographic routing
  - Partners in different cities route to nearest application processing cluster
  - Partner-specific rate limiting: 100 applications/minute per partner (configurable)
  - Burst handling: 3x burst allowance with token bucket rate limiter
  - Partner health dashboard: real-time visibility into API latency, error rates,
    and approval rates per partner
```

---

## Scaling the Fraud Detection Graph

### Challenge: Graph Growth and Query Latency

The fraud detection graph grows by ~500K nodes and ~2M edges per month (new borrowers, devices, addresses, bank accounts). Without active management, the graph reaches query-degrading size within 18 months.

```
Graph scaling strategy:
  Year 1: 50M nodes, 200M edges → single-server graph database
    - 2-hop queries: ~200ms (acceptable)
    - Full graph in memory: ~6.4 GB

  Year 2: 100M nodes, 500M edges → sharded graph
    - Geographic partitioning: 8 regional shards
    - Cross-region edges replicated (5% of total edges)
    - 2-hop queries: ~180ms (partition Cutting off unnecessary steps helps)
    - Per-shard: ~12.5M nodes, ~65M edges, ~2 GB

  Year 3+: 200M nodes, 1B edges → tiered graph
    - Hot tier: entities active in last 90 days (30% of graph)
      Stored in-memory, sub-100ms queries
    - Warm tier: entities active 90 days–2 years (50%)
      SSD-backed, 200ms queries
    - Cold tier: entities inactive 2+ years (20%)
      Archived, batch-queryable for investigation

  Graph maintenance:
    - Edge expiry: device-borrower edges older than 2 years archived
    - Node deduplication: monthly batch merge of duplicate identity nodes
      (same person with different phone numbers, detected via fuzzy matching)
    - Ring archival: confirmed fraud rings archived with full context
      after legal resolution; ring pattern preserved as template for detection
```

### Pre-Computed Materialization Strategy

Real-time fraud queries require sub-200ms response. For high-branching-factor nodes (popular addresses, shared devices in co-working spaces), raw graph traversal can exceed this budget.

```
Materialized views:
  Neighbor cache:
    - For every node, materialize its 2-hop neighbor set
    - Update frequency: every 5 minutes (async from application path)
    - Storage: average 500 neighbors × 16 bytes per neighbor = 8 KB per node
    - 50M nodes × 8 KB = ~400 GB (fits on SSD)
    - Cache hit rate: >99% for real-time queries

  Ring membership index:
    - Pre-computed connected components with ring scoring
    - Batch refresh: daily (full graph analysis, ~4 hours on 32-core cluster)
    - Incremental updates: new edges trigger local re-computation
      within the affected connected component (sub-second)
    - Lookup: O(1) — "is this borrower/device in a known ring?"

  Shared-attribute count index:
    - For each entity, count of distinct borrowers sharing this entity
    - Materialized: address → borrower_count, device → borrower_count
    - Updated: real-time (increment on new edge)
    - Threshold alerts: device_borrower_count > 3 → auto-flag
```

---

## Capacity Planning for Portfolio Growth

### Year 1 → Year 3 Scaling Trajectory

```
                    Year 1          Year 2          Year 3
Active loans:       10M             25M             50M
Applications/day:   500K            1.2M            2.5M
Peak apps/sec:      85              200             420
Bureau pulls/day:   1.5M            3.5M            7M
Collection actions: 5M/day          12M/day         25M/day
Feature store:      17.7 GB         44 GB           88 GB
Event store:        500M events     1.5B events     3.5B events
Audit trail:        250 GB/year     625 GB/year     1.25 TB/year

Scaling triggers:
  - Feature store: add shards when any shard > 6 GB or p95 read > 50ms
  - Scoring workers: add when p99 inference > 200ms or queue depth > 100
  - Processing workers: add when parsing backlog > 10 minutes
  - Collection workers: add when message send rate approaches gateway limit
  - Event store: partition when single partition exceeds 100M events
  - Graph database: shard when 2-hop query p95 exceeds 200ms
```

### Cost Optimization at Scale

```
Compute optimization:
  - Model inference: batch scoring for pre-qualification checks
    (check 10 borrowers in one model invocation vs. 10 separate calls)
    50% compute reduction for embedded finance offer checks
  - Bank statement parsing: GPU-accelerated OCR for peak season
    (3x throughput per worker, 2x cost — net 1.5x cost efficiency)
  - Collection optimization: suppress low-probability collection actions
    (if P(payment | action) < 0.05, skip the action and save channel cost)
    Saves ~₹2 crore/month in SMS and IVR costs at scale

Storage optimization:
  - Bank statement raw data: 90-day TTL (consent-bound), then purge
    Saves ~7.5 TB/month at Year 3 volumes
  - Feature store: evict borrowers inactive > 180 days to cold tier
    Keeps hot tier under 50 GB
  - Audit trail: compress warm tier (1-3 year) with columnar encoding
    4x compression ratio → 312 GB/year instead of 1.25 TB/year
  - Document store: progressive JPEG compression for KYC images
    50% storage reduction with negligible quality loss for verification
```

---

## Disaster Recovery

### RPO/RTO Matrix

| System | RPO | RTO | Recovery Strategy |
|---|---|---|---|
| Loan database | 0 (sync replication) | < 30 seconds | Auto-failover to sync replica |
| Event store / audit trail | 0 (sync replication) | < 5 minutes | Promote replica; read-only during failover |
| Feature store | < 1 minute | < 5 minutes | Promote read replica; recompute from source |
| Fraud graph | < 5 minutes | < 10 minutes | Warm standby; rebuild from event stream (2 hours) |
| Document store | < 1 hour | < 30 minutes | Object storage cross-region replication |
| Model artifacts | 0 (versioned in model registry) | < 2 minutes | Load from model registry to new instance |
| Partner API config | 0 (versioned policy store) | < 1 minute | Config reload from policy store |

### Chaos Engineering Scenarios

```
Quarterly chaos tests:
  1. "FIP Blackout": Disable all AA FIP connections for 10 minutes
     Expected: platform continues scoring on partial data; approval rate drops
     but does not go to zero; no application data loss

  2. "Fraud Service Kill": Terminate fraud detection service
     Expected: all disbursements pause (fail-closed); fast-path rules activate
     within 30 seconds; full service recovery < 2 minutes

  3. "Payment Rail Failure": Simulate UPI outage
     Expected: automatic failover to IMPS; disbursement latency increases
     from 30s to 2 minutes; no double-disbursement

  4. "Database Primary Failure": Kill database primary
     Expected: sync replica promoted in < 30 seconds; no data loss;
     read-only mode during failover for non-critical queries

  5. "Feature Store Partition": Network-partition one feature store shard
     Expected: affected borrowers routed to cold-compute path (recompute
     features from source data); latency increases by 5 seconds; no failures

  6. "Collection Storm": Simulate 10x normal collection volume
     Expected: SMS/WhatsApp queues absorb burst; message delivery
     degrades gracefully (priority queue serves highest-DPD first);
     no message loss
```

---

## Scaling for UPI Credit Line Product

### Challenge: Per-Transaction Authorization at UPI Scale

UPI credit line shifts the platform from batch disbursement (200K/day) to per-transaction authorization potentially reaching millions of transactions per day. Each transaction requires real-time credit check, fraud scoring, and ledger update within 200ms.

```
UPI credit line authorization pipeline:

Transaction volume:
  Year 1: 100K credit line transactions/day (~1.2/sec)
  Year 2: 1M transactions/day (~12/sec)
  Year 3: 10M transactions/day (~115/sec)
  Peak (festival season + month-end): 300/sec

Per-transaction processing (budget: 200ms):
  Available balance check: 5ms (in-memory ledger lookup)
  Velocity check: 10ms (sliding window counter)
  Merchant category check: 2ms (blocked MCC lookup)
  Fraud scoring (lightweight): 20ms (rule-based + device check)
  Ledger update: 15ms (debit available balance, record transaction)
  UPI response: 10ms (format and return authorization)
  Total: ~62ms (well within 200ms budget)

Scaling approach:
  - Credit line ledger: in-memory store with async persistence
    Sharded by credit_line_id hash
    Each shard: single-writer for consistency (no double-spend)
    Read replicas for balance inquiries
  - Authorization workers: stateless, horizontally scaled
    10 workers at Year 1 → 100 workers at Year 3
  - Settlement reconciliation: async batch process every 15 minutes
    Reconciles in-memory ledger against persistent store and bank records
```

---

## AI Release Ladder

Every AI model or capability change MUST follow this rollout sequence:

| Stage | Description | Gate Criteria |
|-------|-------------|---------------|
| 1. Offline Evaluation | Benchmark against historical ground truth | Meets baseline metrics |
| 2. Shadow Mode | Run in parallel, compare to production | No regression on key metrics |
| 3. Canary (Blast-Radius Capped) | 1-5% traffic, human review of all outputs | Error rate < threshold |
| 4. Human-Reviewed Production | AI recommends, human approves all actions | Approval rate > 90% |
| 5. Limited Autonomous Production | AI acts within pre-approved boundaries | Continuous monitoring |
| 6. Instant Rollback | One-click revert to previous model/rules | < 5 min rollback time |

**Regulatory constraint:** Under RBI fair lending guidelines and EU AI Act credit-scoring provisions, Stage 5 is limited to pre-qualification screening only. All credit approval decisions must remain at Stage 4 with mandatory human review. Model changes affecting credit scoring require regulatory notification and explainability documentation.
