# 12.19 AI-Native Insurance Platform — Requirements & Estimations

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR-01 | **Real-time quote engine** — Accept a quote request with applicant data and return a bindable insurance offer with premium, coverage options, and eligibility determination within 90 seconds | Synchronous; must complete before customer abandons |
| FR-02 | **Instant underwriting** — Score applicant risk using a multi-model ensemble combining structured application data, external bureau enrichment, and telematics signals | Per-state feature set; must log all features used for regulatory traceability |
| FR-03 | **Telematics ingestion** — Continuously receive driving event streams from mobile SDK and OBD-II devices; compute per-trip and rolling behavioral scores | 10Hz sensor events; edge preprocessing on device; server aggregation |
| FR-04 | **Behavioral pricing** — Adjust policyholder premium at each billing cycle based on accumulated telematics behavioral score; apply state-approved rating algorithm | Score delta triggers re-rating; policyholder notified of rate change |
| FR-05 | **Conversational claims intake** — Accept first notice of loss (FNOL) via chat/voice interface; classify intent, collect structured loss information, and issue claim number | Available 24/7; must handle ambiguous or emotionally distressed input |
| FR-06 | **Photo/video damage assessment** — Accept uploaded images or video of damaged property/vehicles; run computer vision pipeline to estimate damage category and repair cost range | Supports auto, home, and personal property claims |
| FR-07 | **Fraud scoring** — Score every incoming claim for fraud likelihood at FNOL using real-time graph features and behavioral signals; flag high-risk claims for adjuster escalation | Sub-3-second response from FNOL submission |
| FR-08 | **Fraud ring detection** — Run periodic batch analysis over the claims graph to identify organized fraud rings (coordinated claimant networks, provider billing fraud) | Weekly batch; surfaced as investigative leads to SIU (Special Investigations Unit) |
| FR-09 | **Straight-through claims payment** — For low-value, low-fraud-risk claims meeting defined criteria, automatically approve and initiate payment without adjuster involvement | Configurable approval thresholds by line of business and state |
| FR-10 | **Adjuster workflow** — Route complex or fraud-flagged claims to adjusters with pre-populated loss summary, supporting documents, fraud score breakdown, and recommended actions | Integrated with policy and billing systems |
| FR-11 | **Rate filing management** — Maintain approved rating algorithms per state; enforce prohibited factor exclusion at scoring time; generate SERFF-format rate filing packages | 50-state regulatory compliance; algorithm versions versioned and immutable |
| FR-12 | **Adverse action notices** — For any underwriting or renewal decision resulting in a denial, higher rate, or reduced coverage, generate FCRA-compliant adverse action notices within required timeframes | Regulatory obligation; consumer right to explanation |
| FR-13 | **Policy lifecycle management** — Issue, endorse, renew, and cancel policies; maintain complete policy version history | Event-sourced policy record; every state change auditable |
| FR-14 | **Regulatory reporting** — Generate state-mandated reports (loss ratios, market conduct data, bordereau reports) on regulatory schedules | Automated; supports multiple format requirements per state |

---

## Out of Scope

- **Reinsurance treaty management** — Complex financial instrument negotiation with reinsurers (separate system)
- **Agent/broker portal** — Distribution channel management and commission calculation (separate platform)
- **Investment portfolio management** — Float investment of premium reserves (treasury/finance system)
- **Medical claim adjudication** — Full clinical logic for health insurance claims (separate clinical system)
- **Legal/litigation management** — Coverage dispute resolution and litigation tracking (legal ops system)

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| Quote API p99 latency | ≤ 200 ms for scoring only; ≤ 90 s for full bureau-enriched quote | Customer abandonment threshold; scoring must return before external calls |
| Telematics event ingest latency | ≤ 5 seconds from device upload to behavioral score update | Near-real-time; batch acceptable if within one billing cycle |
| Claims FNOL acknowledgment | ≤ 3 seconds to assign claim number after submission | Customer expectation; sets fraud scoring deadline |
| Fraud score availability | ≤ 3 seconds from FNOL submission | Adjuster assignment delay if score unavailable |
| Straight-through payment SLA | ≤ 24 hours from FNOL to payment initiation for qualifying claims | Competitive differentiator; Lemonade benchmark: 3 minutes |
| Adverse action notice generation | ≤ 3 business days from underwriting decision | FCRA regulatory requirement |
| Rate filing package generation | ≤ 4 hours from triggered rate change to SERFF-ready package | Operational requirement for timely state submissions |

### Reliability & Availability

| Metric | Target |
|---|---|
| Quote API availability | 99.99% (≤ 52 minutes downtime/year) |
| Telematics ingest pipeline | 99.9% (≤ 8.7 hours downtime/year); data loss < 0.01% |
| Claims platform availability | 99.95% (≤ 26 minutes downtime/month) |
| Risk score record durability | 99.9999999% (9 nines); replicated across ≥ 3 regions |
| Policy database consistency | Strong consistency for policy state; eventual consistency for analytics |
| Graceful degradation | During ML outage, fall back to GLM-only scoring with conservative manual review threshold |

### Scalability

| Metric | Target |
|---|---|
| Quote throughput | ≥ 10,000 concurrent quotes; ≥ 100,000 quotes/hour at peak |
| Telematics events | ≥ 50,000 events/second sustained; ≥ 200,000/second burst |
| Active policyholders | ≥ 5 million; ≥ 50 million quotes processed per year |
| Claims processed | ≥ 1 million claims/year; ≥ 10,000 FNOL submissions/day at peak |
| Fraud graph nodes | ≥ 100 million entity nodes; ≥ 500 million relationship edges |

### Security & Compliance

| Requirement | Specification |
|---|---|
| Prohibited factor enforcement | Per-state prohibited factor list enforced at model feature extraction; never passed to scoring model |
| Regulatory traceability | Every risk score record must include model version, feature snapshot, and approved algorithm version in effect at binding time |
| FCRA compliance | Adverse action notices generated with specific reason codes; consumer dispute workflow supported |
| NAIC Data Security Model Law | Comprehensive information security program; annual third-party audits; 72-hour breach notification to regulators |
| PII handling | Field-level encryption for SSN, DOB, health data; data minimization by retention tier; consumer access/deletion endpoints |

---

## Capacity Estimations

### Traffic Model

**Assumptions:**
- 5 million active policies
- 10× policy count in annual quote volume: 50 million quotes/year
- Quote-to-bind ratio: 20% → 10 million binds/year
- Average 1.2 claims per policy per year → 6 million claims/year
- Telematics: 50% of auto policyholders opted-in (1.5M drivers)
- Each driver generates ~200 trips/month × 10 min average → 15M trips/month

```
Quote traffic:
  50M quotes/year / 365 days = 137,000 quotes/day
  Baseline QPS: 137,000 / 86,400 = ~1.6 QPS
  Peak (end of month, marketing campaigns): 10x = 16 QPS burst
  Concurrent long-running quotes (90s timeout): 16 × 90 = ~1,440 in-flight

Claims traffic:
  6M claims/year / 365 = 16,400 claims/day
  Baseline FNOL/sec: 16,400 / 86,400 = ~0.19 FNOL/sec
  Catastrophe event spike: 100x baseline = 1,640 FNOL/hour

Telematics:
  1.5M active telematics drivers
  Average trip: 10 minutes × 10 Hz = 6,000 events/trip
  15M trips/month = 500,000 trips/day
  Average events/sec: 500,000 trips × 6,000 events / 86,400 sec = ~34,700 events/sec
  Peak (morning/evening commute): 3x = ~104,000 events/sec
```

### Underwriting Model Inference

```
Quote scoring pipeline (per quote):
  External bureau calls (MVR, CLUE, credit):     60–120 seconds (external SLA)
  Telematics feature retrieval:                  50 ms (cached)
  ML ensemble inference (3 models):              80 ms total
    - GLM baseline:              5 ms
    - Gradient boosting model:  30 ms
    - Telematics neural net:    45 ms
  SHAP attribution computation:                  120 ms (post-scoring, async)
  Total scoring time (excluding external calls):  200 ms

GPU/CPU fleet sizing:
  Peak concurrent quotes needing ML: ~1,500
  Inference latency: 80 ms → ~18,750 RPS throughput needed per GPU cluster
  CPU inference (gradient boosting): 100 RPS per core → 200 cores
  GPU inference (neural net): 500 RPS per GPU → 40 GPUs
  With 3x headroom: 600 CPU cores + 120 GPUs for scoring
```

### Telematics Processing

```
Event ingest pipeline:
  Raw events: 34,700/sec baseline; 104,000/sec peak
  Event size: ~200 bytes (GPS + accelerometer + timestamp)
  Baseline ingestion bandwidth: 34,700 × 200 = 6.9 MB/sec
  Peak: 20.8 MB/sec → well within streaming capacity

Trip aggregation:
  500,000 trips/day
  Per-trip feature computation (30 features): 50ms/trip
  Trip processor workers needed: 500,000 × 0.05 / 86,400 = ~0.3 workers (trivial)
  With batching efficiency: 10 worker nodes sufficient

Behavioral score storage:
  Per-driver per-trip record: ~1 KB
  Daily: 500,000 trips × 1 KB = 500 MB/day
  Annual: ~180 GB (manageable in relational DB with partitioning)
```

### Fraud Graph

```
Entity counts (5M active policies, 6M claims/year):
  Claimant entities: ~5M
  Vehicle entities: ~6M
  Provider entities (repair shops, medical): ~500K
  Accident location clusters: ~10M
  Relationship edges: ~500M (many-to-many across entities)

Graph DB sizing:
  Node storage: 12M nodes × 500 bytes = 6 GB
  Edge storage: 500M edges × 100 bytes = 50 GB
  Graph index: ~20 GB
  Total in-memory graph: ~76 GB → fits in a 128 GB graph DB node

GNN inference:
  Per-claim subgraph: avg 50 nodes, 200 edges
  GNN forward pass: 10 ms
  Peak FNOL rate: 0.2/sec → trivial GPU utilization
  Catastrophe burst: 100 FNOL/sec → 1 sec/claim → queue 10 GPUs
```

### Storage Estimations

```
Risk score records (policy database, 10-year retention):
  Per-record: ~5 KB (features + scores + attribution)
  10M binds/year × 5 KB = 50 GB/year
  10 years: 500 GB → manageable with tiered storage

Telematics raw events (30-day hot; 7-year cold for regulatory):
  34,700 events/sec × 200 bytes × 86,400 sec = 600 GB/day raw
  Aggregated trip records: 500 MB/day (600:1 compression)
  Hot store (30 days): 600 GB × 30 = 18 TB (compressed to ~300 GB)
  Cold archive (7 years): 500 MB × 365 × 7 = ~1.3 TB

Claims documents (photos, videos, PDFs):
  Average claim: 20 photos × 5 MB + 2 PDFs × 1 MB = 102 MB
  6M claims/year × 102 MB = 612 TB/year → object storage tiering essential
```

### SLO Summary

| SLO | Target | Measurement Window |
|---|---|---|
| Quote API p99 latency (scoring only) | 200 ms | Rolling 1-hour |
| Full quote completion (with external calls) | 90 s for 95th percentile | Rolling 1-day |
| FNOL acknowledgment p99 | 3 s | Rolling 1-hour |
| Fraud score delivery p99 | 3 s from FNOL | Rolling 1-hour |
| Telematics score freshness | Updated within 30 min of trip end | Daily SLA |
| Straight-through payment cycle time | 95% within 24 hours | Weekly |
| Risk score record write durability | 100% written before quote binding confirmation | Per-transaction |
| Regulatory report delivery | 100% on mandated schedule | Per-jurisdiction |

---

## SLO Error Budgets and Escalation Policy

| SLO | Target | Monthly Error Budget | Burn Rate Alert | Escalation |
|---|---|---|---|---|
| Quote API availability | 99.99% | 4.3 min downtime | Fast: 14.4× (1h window) | Page on-call + eng manager |
| Quote scoring p99 latency | ≤ 200 ms | 0.01% of requests > 200ms | Slow: 3× (6h window) | Alert on-call; investigate model serving |
| FNOL acknowledgment p99 | ≤ 3 s | 0.05% of submissions > 3s | Fast: 10× (1h window) | Page claims platform on-call |
| Fraud score delivery p99 | ≤ 3 s from FNOL | 0.05% of scores > 3s | Fast: 10× (1h window) | Page fraud team; consider rule-based fallback |
| Telematics ingest availability | 99.9% | 43.8 min downtime/month | Slow: 3× (6h window) | Alert pipeline on-call; data loss check |
| Risk score record durability | 100% pre-bind | 0 tolerance | Any failure | Halt binding; page storage + underwriting |
| Adverse action notice SLA | 100% within 3 business days | 0 tolerance | Any overdue notice | Page compliance + legal |

**Burn rate alerting formula:**

```
Fast burn:  error_rate_1h  / (error_budget / 30 days) > 14.4  → page immediately
Slow burn:  error_rate_6h  / (error_budget / 30 days) > 3.0   → alert for investigation
Normal:     error_rate_24h / (error_budget / 30 days) > 1.0   → log and track
```

---

## Hardware Infrastructure Estimates

### Quote & Underwriting Cluster

| Component | Specification | Count | Rationale |
|---|---|---|---|
| Quote API servers | 8 vCPU, 16 GB RAM | 20 | Handle 1,500 concurrent long-lived quotes (90s timeout) |
| ML inference — CPU (GLM + GBM) | 16 vCPU, 32 GB RAM | 40 | 200 cores active at peak; 3× headroom |
| ML inference — GPU (Telematics NN) | 4 GPU, 64 GB RAM | 15 | 500 RPS/GPU × 15 = 7,500 RPS capacity; 3× headroom over peak |
| Bureau enrichment proxy | 4 vCPU, 8 GB RAM | 10 | Fan-out to 3 bureaus per quote; connection pooling |
| Risk score recorder | 4 vCPU, 16 GB RAM | 6 | Append-only writes; low CPU, high durability requirement |

### Claims & Fraud Cluster

| Component | Specification | Count | Rationale |
|---|---|---|---|
| Claims intake (conversational AI) | 8 vCPU, 32 GB RAM | 12 | NLP inference per turn; 100× scale for CAT mode |
| Fraud GNN inference | 4 GPU, 64 GB RAM | 4 | Sub-second inference on 50-node subgraphs; low baseline QPS |
| Fraud graph DB | 64 vCPU, 256 GB RAM | 3 (HA cluster) | ~76 GB in-memory graph; HA for FNOL-path dependency |
| Damage assessment (CV) | 4 GPU, 32 GB RAM | 8 | Photo/video classification; batch queue with priority |
| Adjuster workflow API | 4 vCPU, 8 GB RAM | 4 | Low throughput; internal users only |

### Telematics Pipeline

| Component | Specification | Count | Rationale |
|---|---|---|---|
| Event ingest nodes | 8 vCPU, 16 GB RAM | 8 | 104K events/sec peak; partition by driver_id |
| Stream broker cluster | 16 vCPU, 64 GB RAM, NVMe | 6 | Durability + replication; 7-day retention window |
| Trip processor workers | 4 vCPU, 8 GB RAM | 12 | Feature computation; CPU-bound |
| Behavioral scorer | 4 GPU, 32 GB RAM | 4 | Neural net inference on trip features; batch scoring |

### Storage Infrastructure

| Store | Technology | Size (Year 1) | Growth Rate |
|---|---|---|---|
| Policy DB (primary) | Relational, HA | 200 GB | ~50 GB/year |
| Risk score archive | Append-only relational | 50 GB | ~50 GB/year |
| Claims DB | Relational, HA | 100 GB | ~30 GB/year |
| Telematics hot store | Time-series / columnar | 300 GB (30-day) | Steady-state with rotation |
| Telematics cold archive | Object storage, compressed | 1.3 TB (7-year) | ~180 GB/year |
| Claims documents | Object storage, tiered | 612 TB | ~612 TB/year |
| Fraud graph | Graph DB, in-memory | 76 GB | ~15 GB/year |
| Data warehouse | Columnar analytics | 2 TB | ~500 GB/year |

---

## Cost Optimization Levers

| Lever | Savings Estimate | Trade-off |
|---|---|---|
| Bureau response caching (30-day TTL) | $20M–$100M/year at 50M quotes | Stale data for returning applicants; reconcile at bind |
| Soft pull at quote, hard pull at bind only | $5M–$25M/year | Reduced precision in pre-bind score; reconciliation gap |
| GPU spot instances for batch GNN ring detection | 60-70% compute cost reduction | Weekly ring detection may be delayed by up to 6 hours |
| Telematics cold tier auto-transition at day 31 | 90% storage cost reduction on trip data | No hot query on historical trips; re-hydration takes hours |
| Claims photo lifecycle (hot 90d → warm 1y → archive) | 80% storage cost on media after 1 year | Retrieval latency increases for old claim photos |
| Model inference batching during off-peak | 30-40% GPU cost reduction | Higher p99 latency at night; acceptable for non-real-time scoring |
| Right-to-delete compliance automation | Avoided $500K+ annual manual effort | Engineering investment in crypto-deletion and audit trail |

### Unit Economics Summary

```
Per-policy annual platform cost estimate (5M policies):
  Quote & underwriting infrastructure:   $0.80/policy/year
  Telematics pipeline (enrolled drivers): $1.20/enrolled/year
  Claims processing infrastructure:       $0.60/policy/year
  Fraud detection (graph + GNN):          $0.15/policy/year
  Storage & data warehouse:               $0.40/policy/year
  Bureau enrichment (net after caching):  $1.50/policy/year
  Regulatory compliance infrastructure:   $0.10/policy/year
  ─────────────────────────────────────────
  Total platform cost:                    ~$4.75/policy/year
  At 5M policies:                         ~$23.75M/year

  Scaling breakpoints:
  - 2M → 5M policies: linear scaling; unit cost stable
  - 5M → 15M policies: sub-linear (graph DB needs vertical scale at ~10M;
    bureau caching efficiency improves with volume)
  - 15M+ policies: re-architecture needed for fraud graph partitioning
```

---

## Bandwidth & Throughput Estimates

| Data Path | Baseline Throughput | Peak Throughput | Bandwidth |
|---|---|---|---|
| Quote API (inbound) | 1.6 QPS | 16 QPS | ~50 KB/s (small JSON payloads) |
| Quote API (outbound, including bureau) | 1.6 QPS | 16 QPS | ~100 KB/s (enriched responses) |
| Telematics event ingest | 34,700 events/sec | 104,000 events/sec | 6.9–20.8 MB/s |
| Claims FNOL ingest | 0.2/sec | 20/sec (CAT mode) | ~10 KB/s baseline; 100 KB/s CAT |
| Claims photo upload | ~2 MB/claim × 0.2/sec | ~2 MB/claim × 20/sec | 400 KB/s baseline; 40 MB/s CAT |
| Fraud graph queries (2-hop) | 0.2/sec | 100/sec (CAT mode) | ~50 KB/query result |
| Risk score record writes | 0.3/sec (binds) | 3/sec (peak bind hour) | ~1.5 KB/s baseline |
| Data warehouse ETL | Continuous (streaming) | N/A | ~50 MB/s aggregate |
