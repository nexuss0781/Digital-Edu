# Scalability & Reliability

## Payment Path Isolation

The single most important reliability principle: **the payment authorization path must be isolated from everything else**. Webhook delivery, dashboard queries, analytics, dispute processing---none of these should share resources with the payment path.

### Isolation Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    Payment Critical Path                     │
│  (99.999% availability target)                              │
│                                                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │ API GW  │→ │ Idem.   │→ │ Payment │→ │ Acquirer│      │
│  │(payment)│  │ Layer   │  │ Orch.   │  │ Client  │      │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
│       │            │             │                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                    │
│  │ Redis   │  │ PG      │  │ Token   │                    │
│  │(idem.)  │  │(payment)│  │ Vault   │                    │
│  └─────────┘  └─────────┘  └─────────┘                    │
│                                                              │
│  Dedicated: compute, database replicas, Redis cluster,      │
│  network bandwidth, on-call team                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Non-Critical Paths                         │
│  (99.9% availability target)                                │
│                                                              │
│  Webhook Delivery │ Merchant Dashboard │ Analytics          │
│  Payout Processing │ Dispute Mgmt      │ Reporting          │
│                                                              │
│  Separate: compute pools, database read replicas,           │
│  independent scaling, separate on-call                       │
└─────────────────────────────────────────────────────────────┘
```

### What Isolation Means in Practice

| Resource | Payment Path | Non-Critical Path |
|----------|-------------|-------------------|
| **Compute** | Dedicated pod pool, cannot be borrowed | Shared pool with autoscaling |
| **Database** | Primary + synchronous replicas, dedicated connection pool | Async read replicas, separate connection pool |
| **Redis** | Dedicated cluster for idempotency keys | Shared cluster for caching, rate limiting |
| **Network** | Dedicated load balancers with priority routing | Standard load balancers |
| **On-call** | Dedicated payment reliability team, 5-min response | Standard SRE rotation, 15-min response |
| **Deploy** | Canary deployment with automated rollback on error rate spike | Standard blue-green deployment |
| **Capacity** | Provisioned for 2x peak (headroom for burst) | Provisioned for 1.3x peak with autoscaling |

---

## Multi-Region Architecture

### Read/Write Split by Criticality

```
                    ┌─────────────────────┐
                    │   Global DNS/LB     │
                    │ (latency-based      │
                    │  routing)           │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
       ┌────────────┐  ┌────────────┐   ┌────────────┐
       │  Region A   │  │  Region B   │   │  Region C   │
       │  (Primary)  │  │  (Secondary)│   │ (Secondary) │
       └──────┬─────┘  └──────┬─────┘   └──────┬─────┘
              │               │                  │
         ┌────┴────┐    ┌────┴────┐        ┌────┴────┐
         │ Payment │    │ Payment │        │ Payment │
         │ Write   │    │ Read    │        │ Read    │
         │ Primary │    │ + Local │        │ + Local │
         │         │    │ Write*  │        │ Write*  │
         └─────────┘    └─────────┘        └─────────┘

    * Writes routed to primary region for payments
      Local writes for non-financial data (logs, analytics)
```

**Payment writes**: Always routed to primary region. Financial data requires strong consistency; multi-primary writes create reconciliation nightmares for money movement. Cross-region latency (50-150ms) is acceptable because the card network round-trip (1-3s) dominates.

**Payment reads** (status checks, dashboard): Served from local region using async replicas. Acceptable staleness: < 1 second for status queries.

**Webhook delivery**: Local region delivery. Webhook workers in each region handle delivery to geographically close merchant endpoints, reducing delivery latency.

**Failover**: If primary region fails, a secondary region is promoted. Recovery Time Objective (RTO): < 5 minutes for payment writes. In-flight payments during failover enter "pending_network_resolution" and are reconciled post-recovery.

---

## Circuit Breaker Strategy

### Per-Provider Circuit Breakers

Each external dependency (acquiring bank, card network interface, 3D Secure directory) gets its own circuit breaker:

```
CIRCUIT_BREAKER for Acquirer_Visa:
    State: CLOSED | OPEN | HALF_OPEN

    CLOSED (normal operation):
        - Forward all requests to acquirer
        - Track: error_count, success_count in rolling 60-second window
        - IF error_rate > 50% AND request_count > 20 in window:
            → Transition to OPEN

    OPEN (circuit tripped):
        - Reject all requests immediately (fail fast)
        - Return: "acquirer_unavailable" error
        - Payment Orchestrator: route to backup acquirer if available
        - After 30 seconds: → transition to HALF_OPEN

    HALF_OPEN (testing recovery):
        - Allow 10% of requests through
        - IF 5 consecutive successes:
            → Transition to CLOSED
        - IF any failure:
            → Transition back to OPEN (reset timer)
```

### Circuit Breaker Topology

| External System | Circuit Breaker | Fallback Strategy |
|----------------|----------------|-------------------|
| **Primary Acquirer** | Per-card-network (Visa, MC, Amex) | Route to backup acquirer; queue if no backup |
| **3D Secure Directory** | Per-directory server | Skip 3DS (merchant assumes liability); or block |
| **Tokenization Vault** | Single breaker | Return cached token data from local replica (read-only) |
| **Webhook Endpoints** | Per-merchant-endpoint | Queue events; retry later; disable after 3 days |
| **Risk Engine** | Single breaker | Default to "allow" with logging (or "block" for high-risk merchants) |

---

## Zero-Downtime Deployments

### Canary Deployment for Payment Path

```
Phase 1: Deploy canary (1% of traffic)
├── Deploy new version to canary pod pool
├── Route 1% of payment traffic via weighted load balancing
├── Monitor for 15 minutes:
│   ├── Payment success rate (must not drop > 0.1%)
│   ├── Authorization latency p99 (must not increase > 200ms)
│   ├── Error rate (must not increase > 0.05%)
│   └── Ledger imbalance count (must be zero)
├── IF metrics healthy → proceed to Phase 2
└── IF metrics degraded → automatic rollback (< 2 minutes)

Phase 2: Gradual rollout
├── 1% → 5% → 10% → 25% → 50% → 100%
├── Each stage: 10-minute bake time with monitoring
├── Any stage can trigger automatic rollback
└── Total rollout time: ~90 minutes

Phase 3: Verification
├── Run end-to-end payment tests (test card numbers)
├── Verify ledger consistency
├── Confirm webhook delivery rates
└── Previous version kept warm for 2 hours (instant rollback capability)
```

### Database Schema Migration Strategy

Financial databases cannot tolerate downtime for schema changes. Strategy:

1. **Additive-only migrations**: Add columns, tables, indexes---never drop or rename in production
2. **Dual-write period**: New code writes to both old and new columns; read from old
3. **Backfill**: Background job populates new column for historical records
4. **Switch read**: After backfill, read from new column; continue dual-write
5. **Cleanup**: After verification period (1 week), stop writing to old column
6. **Drop old column**: Separate migration, weeks later, after confirming no reads

---

## Disaster Recovery for Financial Data

### Recovery Objectives

| Data Type | RPO (Recovery Point Objective) | RTO (Recovery Time Objective) | Strategy |
|-----------|------|------|----------|
| **Payment records** | 0 (zero data loss) | < 5 minutes | Synchronous replication to standby |
| **Ledger entries** | 0 (zero data loss) | < 5 minutes | Synchronous replication + WAL archiving |
| **Idempotency keys** | < 1 minute | < 2 minutes | Redis replication + DB fallback |
| **Tokenization vault** | 0 (zero data loss) | < 10 minutes | HSM-backed, cross-region encrypted replication |
| **Webhook events** | < 5 minutes | < 15 minutes | Event bus replay from committed offset |
| **Merchant data** | < 1 minute | < 5 minutes | Async replication (not on critical path) |

### Backup Strategy

```
Continuous:
├── Write-ahead log (WAL) streaming to object storage (real-time)
├── Synchronous replication to standby database (same region)
└── Asynchronous replication to DR region (< 1 second lag)

Periodic:
├── Full database snapshot: every 6 hours
├── Incremental backup: every 15 minutes
├── Ledger archive: daily (immutable, append-only)
└── Tokenization vault backup: daily (encrypted, separate key management)

Testing:
├── DR failover drill: quarterly
├── Backup restoration test: monthly
├── Point-in-time recovery test: monthly
└── Chaos engineering on payment path: weekly (controlled blast radius)
```

### In-Flight Payment Recovery

When a region fails mid-payment:

```
Scenario: Primary region fails while payment is in "processing" state

1. Standby promoted to primary (< 5 minutes)
2. Recovery process scans for "processing" payments older than 2 minutes:
   a. Query acquiring bank for transaction status
   b. Approved → transition to "succeeded"; record ledger entries
   c. Declined → transition to "requires_payment_method"
   d. Unknown → mark "pending_network_resolution"; manual review
3. Resume webhook delivery for any payments resolved during recovery
4. Reconciliation process runs immediately after recovery to catch anomalies
```

---

## Horizontal Scaling Strategy

| Component | Scaling Dimension | Approach |
|-----------|------------------|----------|
| **API Gateway** | Request volume | Horizontal pod autoscaling on CPU/request rate |
| **Payment Orchestrator** | Transaction volume | Shard by merchant_id; each shard handles ~100 merchants |
| **Idempotency Store (Redis)** | Key volume | Redis Cluster with hash-slot sharding; add nodes for capacity |
| **Payment Database** | Write throughput | Vertical scaling (larger instance) + read replicas; shard only as last resort |
| **Ledger Database** | Write throughput | Shard by merchant_id; each shard is an independent ledger |
| **Webhook Workers** | Delivery volume | Horizontal scaling based on queue depth; per-endpoint rate limiting |
| **Risk Engine** | Scoring throughput | Stateless horizontal scaling; feature store in Redis |
| **Tokenization Vault** | Token volume | Vertical scaling (HSM throughput limited); add HSM partitions |

### Scaling Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| Payment API latency p99 > 2s | Sustained 5 min | Scale out Payment Orchestrator pods |
| Redis memory > 80% | Sustained 10 min | Add Redis cluster nodes |
| Webhook queue depth > 1M | Sustained 5 min | Scale out webhook workers |
| DB connection pool > 80% | Sustained 10 min | Add read replicas; investigate slow queries |
| Payment error rate > 1% | Sustained 2 min | Alert on-call; check circuit breakers |

---

## Smart Payment Routing and Multi-Acquirer Strategy

### Intelligent Routing Engine

A production payment gateway integrates with multiple acquiring banks and routes each transaction to the optimal acquirer based on real-time signals:

```
FUNCTION select_optimal_acquirer(payment):
    candidates = get_available_acquirers(payment.card_network, payment.currency)

    -- Filter: remove acquirers with open circuit breakers
    candidates = FILTER(candidates, cb -> cb.circuit_state != OPEN)

    -- Score each candidate
    FOR EACH acquirer IN candidates:
        score = 0.0

        -- Factor 1: Historical authorization rate for this BIN range (40% weight)
        bin_auth_rate = get_auth_rate(acquirer, payment.card_bin, last_7_days)
        score += bin_auth_rate * 0.40

        -- Factor 2: Current latency percentile (25% weight)
        current_p50 = get_current_latency_p50(acquirer)
        latency_score = 1.0 - MIN(current_p50 / 3000.0, 1.0)  -- normalize to 3s max
        score += latency_score * 0.25

        -- Factor 3: Cost (interchange + acquirer markup) (20% weight)
        cost = estimate_processing_cost(acquirer, payment)
        cost_score = 1.0 - MIN(cost / max_cost, 1.0)
        score += cost_score * 0.20

        -- Factor 4: Error rate in last 5 minutes (15% weight)
        error_rate = get_recent_error_rate(acquirer, last_5_min)
        score += (1.0 - error_rate) * 0.15

        acquirer.routing_score = score

    -- Select highest-scoring acquirer
    RETURN candidates.SORT_BY(routing_score).FIRST()
```

### Acquirer Failover Cascade

```
Primary acquirer attempt
        │
    ┌───┴───┐
    │Success?│
    ├─YES───→ Return result
    └─NO────→ Check error type
                  │
           ┌──────┴──────┐
           │  Retryable?  │
           │(timeout/5xx) │
           ├─YES─────────→ Route to secondary acquirer
           │                    │
           │               ┌────┴────┐
           │               │Success? │
           │               ├─YES────→ Return result, update routing scores
           │               └─NO─────→ Route to tertiary acquirer (if available)
           │                              │
           │                         ┌────┴────┐
           │                         │Success? │
           │                         ├─YES────→ Return result
           │                         └─NO─────→ Return decline to merchant
           └─NO──────────→ Return decline (card declined, insufficient funds)
                           Non-retryable errors are NOT routed to secondary
```

### Routing Analytics

| Metric | Purpose | Granularity |
|--------|---------|-------------|
| Auth rate by acquirer × BIN range | Identify optimal acquirer per card segment | Hourly rollup |
| Cost per successful transaction | Minimize processing cost | Daily rollup |
| Latency by acquirer × card network | Detect degradation before circuit trips | 1-minute window |
| Failover success rate | Measure recovery effectiveness | Per-incident |
| Revenue recovered via retry routing | Quantify value of multi-acquirer strategy | Daily |

---

## Rate Limiting and Load Shedding

### Tiered Rate Limiting

```
Rate Limit Hierarchy (evaluated in order):

Tier 1: Global system protection
├── Total payment API: 100,000 req/sec (hard ceiling)
├── Total webhook delivery: 50,000 deliveries/sec
└── Breach → HTTP 503 with Retry-After header

Tier 2: Per-merchant rate limits
├── Default: 100 req/sec per merchant
├── Enterprise tier: 1,000 req/sec
├── Custom: negotiated per contract
├── Implementation: Token bucket in Redis per merchant_id
└── Breach → HTTP 429 with rate limit headers

Tier 3: Per-endpoint protection
├── Card vault (tokenization): 500 req/sec per merchant
├── Bulk operations (list, search): 20 req/sec per merchant
├── Webhook endpoint test: 5 req/sec per merchant
└── Breach → HTTP 429 with specific limit info

Tier 4: Abuse detection
├── Same card across merchants: 10 attempts/hour
├── Same IP with different cards: 5 cards/hour
├── Failed payment ratio > 80%: throttle for 15 min
└── Breach → HTTP 429 + fraud team notification
```

### Load Shedding Strategy

When the payment path approaches capacity limits, shed non-critical work to protect payment authorization:

```
Load Shedding Levels:

Level 0 (Normal): All systems operational
├── Payment path: serving
├── Webhooks: delivering
├── Dashboard: serving
├── Analytics: processing
└── Trigger: CPU < 70%, latency p99 < 2.5s

Level 1 (Elevated): Reduce non-critical work
├── Payment path: serving (priority)
├── Webhooks: delivering (reduced parallelism)
├── Dashboard: serving (cached data, longer refresh)
├── Analytics: paused
└── Trigger: CPU > 70% OR latency p99 > 2.5s

Level 2 (Critical): Payment path protection
├── Payment path: serving (priority, reject low-risk-tier merchants last)
├── Webhooks: queueing only (delivery paused)
├── Dashboard: degraded (read-only, stale data)
├── Analytics: stopped
└── Trigger: CPU > 85% OR latency p99 > 4s

Level 3 (Emergency): Survival mode
├── Payment path: serving essential only (top 100 merchants by volume)
├── Webhooks: queueing only
├── Dashboard: 503 with status page redirect
├── Analytics: stopped
└── Trigger: CPU > 95% OR payment path errors > 1%
```

---

## Database Scaling Deep Dive

### Write Amplification Problem

A single payment generates writes to multiple tables:

```
One payment authorization → database write fan-out:

1. PaymentIntent INSERT              (~2 KB)
2. IdempotencyKey INSERT (Redis)     (~1 KB, separate store)
3. PaymentStatusChange INSERT        (~200 B)
4. JournalEntry INSERT × 4          (~500 B × 4 = 2 KB)
5. LedgerAccount UPDATE × 2         (~100 B × 2)
6. WebhookEvent INSERT               (~1 KB)
7. AuditLog INSERT                   (~500 B)
────────────────────────────────────────────────
Total per payment:                   ~6.8 KB across 10+ writes

At 15,000 peak TPS: ~102 MB/s sustained write throughput
```

### Sharding Strategy

```
Sharding Key: merchant_id (hash-based)

Why merchant_id:
├── All queries for a merchant hit one shard
├── Merchant dashboard reads are shard-local
├── Ledger reconciliation is shard-local
├── Cross-merchant queries (rare) use scatter-gather
└── Rebalancing: consistent hashing with virtual nodes

Shard Sizing:
├── Target: 1,000-5,000 merchants per shard
├── Large merchants (>1M txn/day): dedicated shard
├── Shard count: start with 16, grow to 256
└── Each shard: primary + 2 synchronous replicas

What is NOT sharded:
├── Idempotency keys → Redis Cluster (hash-slot sharding built-in)
├── Tokenization vault → single highly-available store (HSM-bound)
└── Global config → replicated to all shards
```

### Connection Pool Management

```
Connection Pool Architecture:

Payment Path (Critical):
├── Pool size: 50 connections per shard primary
├── Max wait: 100ms (fail fast if pool exhausted)
├── Idle timeout: 30 seconds
├── Health check: every 5 seconds
└── Reserved: 10 connections for admin/monitoring

Read Replicas (Dashboard/Analytics):
├── Pool size: 100 connections per replica
├── Max wait: 500ms
├── Idle timeout: 60 seconds
└── Load balance: round-robin across replicas

Monitoring:
├── Active connections / pool size → alert at 80%
├── Wait time p99 → alert at 50ms
├── Connection creation rate → detect leak patterns
└── Idle connection count → tune pool size
```

---

## Chaos Engineering for Payment Systems

### Controlled Failure Injection

```
Chaos Experiments (weekly, controlled blast radius):

Experiment 1: Acquirer Timeout Injection
├── Inject 100% timeout on secondary acquirer for 5 minutes
├── Verify: circuit breaker opens within 30 seconds
├── Verify: traffic routes to primary acquirer
├── Verify: zero double charges during failover
└── Blast radius: 1% of traffic to test acquirer

Experiment 2: Redis Cluster Node Failure
├── Kill one Redis node in idempotency cluster
├── Verify: cluster reshards within 30 seconds
├── Verify: idempotency checks fall back to database
├── Verify: no duplicate payments during failover
└── Blast radius: keys mapped to killed node

Experiment 3: Database Replica Lag
├── Inject 30-second replication lag on read replica
├── Verify: dashboard serves stale data (acceptable)
├── Verify: payment writes unaffected (use primary)
├── Verify: alerting fires within 1 minute
└── Blast radius: one read replica

Experiment 4: Webhook Endpoint Mass Failure
├── Simulate 50% of webhook endpoints returning 500
├── Verify: retry queues absorb backlog
├── Verify: healthy endpoints unaffected
├── Verify: per-endpoint circuit breakers activate
└── Blast radius: synthetic test endpoints only
```

---

## Graceful Degradation Modes

| Failure Scenario | Degradation | User Impact | Recovery |
|-----------------|-------------|-------------|----------|
| **Single acquirer down** | Route to backup acquirer | None (transparent failover) | Auto-recovery via circuit breaker half-open |
| **Redis cluster degraded** | DB-backed idempotency (higher latency) | +20ms per payment | Redis recovery + cache warm |
| **Primary DB region failure** | Promote standby, replay WAL | 2-5 min payment write pause | Reconciliation sweep post-recovery |
| **3DS directory unavailable** | Skip 3DS (merchant assumes liability) | No change for customer | Monitor 3DS recovery; re-enable |
| **Webhook delivery backlogged** | Queue events, pause delivery | Merchants see delayed notifications | Drain queue at recovery; no data loss |
| **HSM latency spike** | Serve from token cache (read-only) | New tokenization blocked; existing tokens work | HSM vendor escalation |
| **Risk engine timeout** | Default to rule-based scoring | Slightly higher fraud exposure | ML model recovery; backfill scores |
