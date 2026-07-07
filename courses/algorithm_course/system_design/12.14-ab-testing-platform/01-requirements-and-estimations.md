# 01 — Requirements & Estimations: A/B Testing Platform

## Functional Requirements

| # | Requirement | Details |
|---|---|---|
| FR-01 | **Experiment Lifecycle Management** | Create, start, pause, resume, stop, and archive experiments via API and UI; support experiment versioning and rollback |
| FR-02 | **Deterministic Variant Assignment** | Given an entity ID (user, session, device, org), always return the same variant for a given active experiment with no database lookup |
| FR-03 | **Traffic Allocation Control** | Specify percentage of eligible traffic exposed to an experiment (0.1% granularity); support unequal splits (e.g., 10/10/80) |
| FR-04 | **Targeting & Eligibility Rules** | Filter experiment exposure by user attributes (country, platform, cohort, account age, subscription tier, custom properties) |
| FR-05 | **Mutual Exclusion & Layering** | Namespace experiments into layers so users in experiment A cannot simultaneously be in experiment B within the same layer |
| FR-06 | **Feature Flag Integration** | Experiments use feature flags as the delivery mechanism; flag state is the variant; no separate SDK needed |
| FR-07 | **Event Ingestion** | Accept arbitrary event types with entity ID, timestamp, experiment context, and custom properties via SDK and server-side API |
| FR-08 | **Metric Definition & Computation** | Define metrics (conversion rate, mean, ratio, percentile) over raw events; compute metric values per variant with configurable aggregation |
| FR-09 | **Statistical Analysis** | Compute z-test, t-test, chi-squared; report p-values, confidence intervals, effect sizes; support sequential testing modes |
| FR-10 | **CUPED Variance Reduction** | Accept pre-experiment covariate data and apply CUPED adjustment to reduce metric variance, accelerating time to significance |
| FR-11 | **Sample Ratio Mismatch Detection** | Continuously monitor actual vs. expected traffic splits; alert and pause experiment on statistically significant mismatch |
| FR-12 | **Guardrail Metrics** | Define a set of metrics that must not degrade; automatically stop experiment if guardrail threshold is breached |
| FR-13 | **Segment Analysis** | Break down treatment effects by user segment (country, platform, device type, cohort) to detect heterogeneous treatment effects |
| FR-14 | **Multi-Armed Bandit Mode** | Optionally run an experiment in adaptive mode (epsilon-greedy, UCB, Thompson Sampling) to shift traffic to the winning variant |
| FR-15 | **Holdback Groups** | Support long-running holdback cohorts excluded from all experiments to measure cumulative and long-term platform effects |
| FR-16 | **Experiment Scheduling** | Allow experiments to be pre-configured and auto-started at a scheduled time; auto-stop after a specified duration |
| FR-17 | **Pre-Registration** | Require analysts to specify primary metric, MDE, target power, and run duration before experiment starts, preventing post-hoc outcome switching |

---

## Out of Scope

- Multivariate testing with more than 5 variants (combinatorial explosion of interactions makes interpretation unreliable at scale)
- Full contextual bandits for per-user personalization (bandits are supported; contextual bandits for recommendations are a separate system)
- Real-user monitoring (RUM) outside experiment context — handled by the observability platform
- Qualitative user research tooling (surveys, session replay beyond experiment context)
- A/A test automation — this is a configuration concern handled by creating an experiment with two identical control variants

---

## Non-Functional Requirements

### Performance

| Metric | Target | Notes |
|---|---|---|
| Assignment latency — SDK local (p50) | < 0.1 ms | Pure local hash computation, no I/O |
| Assignment latency — SDK local (p99) | < 1 ms | Includes targeting rule evaluation |
| Assignment latency — server fallback (p99) | < 5 ms | Remote assignment service call |
| Event ingest ACK (p99) | < 50 ms | Async pipeline; ACK confirms durable receipt to queue |
| Metric refresh lag — streaming (p95) | < 5 minutes | Preliminary streaming aggregates |
| Metric refresh lag — batch (p95) | < 90 minutes | Authoritative batch computation including CUPED |
| Dashboard query latency (p95) | < 3 seconds | Pre-aggregated results store query |
| Ruleset distribution lag | < 60 seconds | SDK receives updated ruleset after config change |

### Reliability

| Metric | Target | Notes |
|---|---|---|
| Assignment service availability | 99.99% (< 52 min downtime/year) | Measured at SDK edge; outage means stale cache served |
| Event pipeline durability | 99.999% no event loss after ACK | Exactly-once delivery commitment after queue write |
| Analysis pipeline availability | 99.9% | Brief gaps acceptable; stale results shown |
| Graceful degradation | On assignment failure, serve control | Control fallback preserves baseline experience |
| Recovery time objective (RTO) | < 5 minutes for assignment service | SDK cache maintains service during recovery |

### Scalability

| Metric | Target |
|---|---|
| Concurrent active experiments | 10 000+ |
| Peak assignment throughput | 2 000 000/second (burst) |
| Sustained assignment throughput | 500 000/second |
| Event ingest throughput | 500 000 events/second sustained peak |
| Experiment metadata size (ruleset) | < 50 MB total (fits in SDK memory) |
| Maximum variants per experiment | 5 (above this, interaction analysis becomes unreliable) |
| Maximum targeting rule complexity | 10 predicates per rule, 3 nesting levels |

### Data Integrity

| Property | Mechanism |
|---|---|
| Exactly-once event counting | Idempotent event IDs with 7-day dedup window |
| Immutable audit trail | Append-only write-once storage for all config changes |
| Assignment reproducibility | Deterministic hash allows server-side verification of any assignment |
| Statistical correctness | Sequential testing prevents false positives from peeking |

---

## Capacity Estimations

### Experiment Volume

| Parameter | Estimate | Reasoning |
|---|---|---|
| Active experiments at peak | 10 000 | Large product org; multiple teams, many surfaces |
| Average variants per experiment | 2.3 | Mostly 2-way (A/B); some 3-way |
| Average experiment duration | 14 days | Standard two-week cadence for most features |
| New experiments started per day | ~500 | 10 000 / 14 days × 70% overlap ≈ 500/day |
| Experiments stopped per day | ~500 | Steady state: starts ≈ stops |

### Assignment Throughput

| Variable | Value |
|---|---|
| Daily active users (DAU) | 500 million |
| Average sessions per DAU | 1.5 |
| Average page views per session | 7 |
| Fraction of page views with experiment lookup | 80% |
| Average experiments evaluated per page view | 3 |

**Total experiment evaluations per day:** 500M × 1.5 × 7 × 0.80 × 3 = **12.6 billion**

**Peak assignments per second:** 12.6B / 86,400 × 3.5 (peak factor) = **510,000/sec** → **target: 500K/sec sustained, 2M/sec burst**

Note: The vast majority (~99%) are resolved by the local SDK cache with zero network I/O. Only cache misses (ruleset refresh, first page load) hit the assignment service.

### Event Volume

| Event Category | Events/Day | Rate at Peak |
|---|---|---|
| Page view events | 5 billion | 200K/sec |
| Click / interaction events | 2 billion | 80K/sec |
| Purchase / conversion events | 50 million | 2K/sec |
| Custom metric events | 1 billion | 40K/sec |
| Server-side events (API calls, etc.) | 500 million | 20K/sec |
| **Total** | **~8.55 billion/day** | **~340K/sec avg; 1M/sec peak** |

### Storage Calculations

| Data Type | Retention | Calculation | Estimated Size |
|---|---|---|---|
| Raw event log (compressed Parquet) | 90 days | 8.55B events/day × 150 bytes compressed × 90 days | **115 TB** |
| Assignment log | 90 days | 12.6B evaluations/day × 40 bytes × 90 days | **45 TB** |
| Pre-aggregated metric snapshots | 2 years | 10K experiments × 20 metrics × 14 days × 100 data points/day × 50 bytes | **140 GB** |
| Statistical results | 2 years | 10K experiments × 5 metrics × 5 variants × 2 KB/result | **500 MB active; tens of GB archived** |
| Experiment configuration | Indefinite | 10K configs × 5 KB each | **50 MB (in-memory viable)** |
| Audit log | 7 years | 500 experiments started/day × 10 audit events × 2 KB × 365 × 7 | **~26 GB** |

**Total storage:** ~160 TB active, dominated by raw event log and assignment log.

### Compute Estimation

| Component | Throughput | Compute Requirement |
|---|---|---|
| Event Gateway shards | 1M events/sec peak | 50 nodes × 20K events/sec/node |
| Event Processor (dedup+enrich) | 1M events/sec | 100 nodes (I/O bound on cache lookups) |
| Stream Aggregator partitions | 1M events/sec | 200 partitions (5K events/sec/partition) |
| Batch Analysis jobs | 50K jobs/hour | 100 workers × 0.1 sec/job = 139 minutes → 200 workers needed |
| Statistical Engine | 50K analysis runs/hour | 50 workers (pure CPU, 0.5 sec/run) |

### Network Bandwidth

| Flow | Volume |
|---|---|
| SDK → Event Gateway | 1M events/sec × 200 bytes = **200 MB/sec = 1.6 Gbps** |
| Message Queue internal | 1M × 200 bytes + metadata = **~2 Gbps** |
| Event Log write | 1M × 150 bytes compressed = **150 MB/sec = 1.2 Gbps** |
| Ruleset CDN distribution | 50 MB ruleset × 10K SDK refreshes/min / 60 = **~8 GB/sec CDN hit rate; < 1% origin** |

---

## Service Level Objectives (SLOs)

| SLO ID | Metric | Target | Measurement Window | Alert Threshold |
|---|---|---|---|---|
| SLO-01 | Assignment service p99 latency (remote) | ≤ 5 ms | Rolling 5-minute window | > 8 ms for > 1 minute |
| SLO-02 | Assignment service availability | ≥ 99.99% | Monthly | < 99.95% in any 24-hour window |
| SLO-03 | Event pipeline data loss rate | ≤ 0.001% of ACK'd events | Per experiment over lifetime | Any confirmed loss > 100 events |
| SLO-04 | Streaming metric freshness | ≤ 5 minutes at p95 | Hourly sample | > 10 minutes for > 5 experiments |
| SLO-05 | Batch metric freshness | ≤ 90 minutes at p95 | Daily | Batch overdue by > 30 minutes |
| SLO-06 | SRM detection time | ≤ 30 minutes after mismatch onset | Per experiment | Not met for any P0 experiment |
| SLO-07 | Guardrail breach detection time | ≤ 15 minutes after breach onset | Per experiment | Not met for any production experiment |
| SLO-08 | Dashboard query response time | ≤ 3 seconds at p95 | Per query | > 5 seconds for > 5% of queries |
| SLO-09 | Ruleset propagation time | ≤ 60 seconds for 99% of SDKs | Per config change | > 90 seconds for any change |
| SLO-10 | Experiment start-to-first-result | ≤ 20 minutes | Per experiment | > 30 minutes |

---

## SLO Error Budgets

### Monthly Error Budget Calculations

| SLO | Target | Monthly Budget | Burn Rate Alert |
|-----|--------|---------------|-----------------|
| Assignment service p99 latency | ≤ 5ms | ~43.8 min/month of violations (99.9%) | >1% violations in 5 min → page |
| Assignment service availability | ≥ 99.99% | 4.38 min/month downtime | Any downtime > 1 min → page |
| Event pipeline data loss | ≤ 0.001% | ~85K events/month at 8.55B/day | Any confirmed batch loss → P0 |
| Streaming metric freshness | ≤ 5 min p95 | ~4.38 hours/month of violations | >5% stale in 15 min → alert |
| Batch metric freshness | ≤ 90 min p95 | 1 overdue batch/month allowed | Batch overdue > 30 min → alert |
| SRM detection time | ≤ 30 min | Zero tolerance for P0 experiments | Any P0 miss → postmortem |
| Guardrail breach detection | ≤ 15 min | Zero tolerance for production experiments | Any production miss → P0 |

### Error Budget Policy

| Budget Status | Remaining | Action |
|---------------|-----------|--------|
| **Green** | >75% | Normal operations; feature work and experiment changes proceed |
| **Yellow** | 50–75% | Review burn rate; schedule reliability improvements |
| **Orange** | 25–50% | Freeze non-critical platform deploys; reliability-only work |
| **Red** | <25% | All platform deploys frozen except reliability fixes; postmortem review |
| **Exhausted** | 0% | Complete freeze; executive review required to resume |

### Budget Attribution

| Category | Description | Example |
|----------|-------------|---------|
| **Planned** | Platform upgrades, maintenance windows | Statistical engine migration |
| **Infrastructure** | Cloud provider issues, network failures | CDN outage affecting ruleset distribution |
| **Software** | Bugs in platform code | Event processor dedup cache corruption |
| **Load** | Unexpected traffic spikes | Viral campaign causing 10× event ingest |
| **External** | Third-party SDK issues, client-side bugs | Browser version breaking SDK event batching |

---

## Latency Budget Breakdown

### Assignment Path (target: < 5ms p99 server-side fallback)

| Step | p50 | p99 | Budget Share |
|------|-----|-----|-------------|
| TLS + connection reuse | 0.1ms | 0.5ms | 10% |
| Request parsing + auth | 0.1ms | 0.3ms | 6% |
| Ruleset cache lookup | 0.05ms | 0.1ms | 2% |
| Targeting rule evaluation | 0.1ms | 0.5ms | 10% |
| Hash computation (SHA-256) | 0.01ms | 0.05ms | 1% |
| Bucket → variant mapping | 0.01ms | 0.02ms | 0.4% |
| Response serialization | 0.05ms | 0.2ms | 4% |
| **Total** | **~0.43ms** | **~1.67ms** | — |
| **Headroom** | — | 3.33ms | 67% |

### Event Ingest Path (target: < 50ms p99 ACK)

| Step | p50 | p99 | Notes |
|------|-----|-----|-------|
| Gateway receipt + validation | 2ms | 8ms | Schema validation + auth |
| Queue write + ACK | 5ms | 25ms | Durable write to message queue |
| Gateway ACK to client | 1ms | 5ms | Response transmission |
| **Total** | **~8ms** | **~38ms** | 12ms headroom for retries |

---

## Growth Projections

### Year 1 → Year 3 Scaling

| Metric | Year 1 | Year 2 | Year 3 | Growth Driver |
|--------|--------|--------|--------|---------------|
| DAU | 200M | 350M | 500M | Platform growth |
| Concurrent experiments | 2,000 | 5,000 | 10,000 | Experimentation culture maturity |
| Events/day | 3B | 6B | 8.55B | More surfaces instrumented |
| Event store (active) | 30 TB | 70 TB | 115 TB | Event volume + retention |
| Statistical engine jobs/hour | 10K | 25K | 50K | Experiment count × metrics |
| SDK instances | 100M | 250M | 500M | DAU growth |
| Teams running experiments | 50 | 150 | 300 | Organization-wide adoption |

### Cost Scaling Drivers

| Driver | Scaling Behavior | Mitigation |
|--------|-----------------|------------|
| Event storage | Linear with event volume | Columnar compression (85% reduction); tiered storage (hot → cold → archive) |
| CDN bandwidth for rulesets | Linear with SDK instances | Delta sync reduces per-refresh payload by 16× |
| Statistical computation | Linear with experiments × metrics | Job parallelism; sampling for large experiments |
| Event gateway compute | Linear with event throughput | SDK batching reduces request rate by 100× |
| Message queue throughput | Linear with event throughput | Partition-level scaling; consumer auto-scaling |

---

## Hardware Reference Architecture

| Component | Instance Type | Count (Peak) | Key Sizing Factor |
|---|---|---|---|
| Event Gateway nodes | 8 vCPU, 16 GB | 50 | Connection count; TLS termination; validation |
| Event Processors | 4 vCPU, 16 GB | 100 | Dedup cache; enrichment lookups |
| Stream Aggregator nodes | 4 vCPU, 32 GB | 200 | In-memory state per partition |
| Batch Aggregator workers | 16 vCPU, 64 GB | 200 | CPU-bound aggregation; CUPED computation |
| Statistical Engine workers | 8 vCPU, 16 GB | 50 | CPU-bound; pure computation |
| Assignment Service nodes | 4 vCPU, 8 GB | 20 | Stateless; ruleset cache only |
| Ruleset Manager | 4 vCPU, 8 GB | 3 | Compilation; CDN push |
| Config Store cluster | 8 vCPU, 32 GB, SSD | 5 | Low-latency key-value reads |
| Event Log cluster | 16 vCPU, 64 GB, NVMe | 30 | Append-only write throughput; storage capacity |
| Metric Store (columnar) | 16 vCPU, 128 GB | 10 | Query performance; aggregation speed |
| Results Store | 4 vCPU, 16 GB | 5 | Low-latency reads for dashboard |
| API / Dashboard backend | 4 vCPU, 8 GB | 10 | User-facing request handling |

---

## Workload Characterization

### Event Type Distribution and Processing Cost

| Event Type | % of Volume | Avg Size | Processing Cost | Metric Relevance |
|---|---|---|---|---|
| Page view | 58% | 150 bytes | Minimal (count + window) | Nearly all experiments (exposure metric) |
| Click / interaction | 23% | 200 bytes | Low (count + property extraction) | Most conversion experiments |
| Purchase / conversion | 0.6% | 500 bytes | Medium (revenue computation, winsorization) | Revenue experiments (high-value) |
| Custom metric event | 12% | 300 bytes | Variable (depends on metric definition) | Feature-specific experiments |
| Server-side API event | 6% | 250 bytes | Low | Backend performance experiments |

**Key insight:** Page view events dominate volume (58%) but contribute minimal analytical value beyond exposure counting. The most analytically valuable events (purchases) are < 1% of volume. The event pipeline must handle the volume of the former while preserving the precision needed for the latter.

### Experiment Lifecycle Distribution

| Phase | % of Active Experiments | Resource Consumption |
|---|---|---|
| First 24 hours (ramp-up) | 7% | High: ruleset compilation + distribution; SRM monitoring at high frequency |
| Days 2-7 (early collection) | 25% | Medium: streaming aggregation; preliminary statistical checks |
| Days 7-14 (primary analysis) | 40% | Medium: batch CUPED computation; sequential p-value updates |
| Days 14+ (extended) | 20% | Low: monitoring only; results stable |
| Paused / pending review | 8% | Minimal: no event processing; results frozen |

### Peak Traffic Correlation

| Time Window | Traffic Pattern | Scaling Implication |
|---|---|---|
| Weekday prime time (6-10 PM) | 3.5× baseline | Event gateway scales to 1M events/sec |
| Weekend | 1.2× weekday average | Sustained higher load; more experiments may reach significance |
| Holiday shopping events | 5-10× baseline | Pre-scale all layers; increase batch frequency |
| Sprint start (experiment launches) | 20-50 new experiments in 1 hour | Ruleset compilation queue; staged rollout |
| Month end (experiment stops) | Mass experiment archival | Config store write load; results finalization |

---

## Power Analysis Reference

### Sample Size Estimation for Common Experiment Types

Power analysis determines how much traffic is needed to detect a given effect size with statistical confidence. The platform pre-computes these estimates to help experimenters plan:

```
Required sample size per variant (two-sided z-test, alpha=0.05, power=0.80):

n = 2 × ((z_alpha/2 + z_beta) / delta)² × sigma²

where:
  z_alpha/2 = 1.96 (for alpha=0.05)
  z_beta = 0.84 (for power=0.80)
  delta = minimum detectable effect (absolute)
  sigma² = metric variance

For conversion rate metrics (binary):
  sigma² = p × (1-p) where p = baseline conversion rate
  n = 2 × (1.96 + 0.84)² × p × (1-p) / delta²
```

### Reference Table

| Metric | Baseline | MDE | Variance | N/variant | Duration at 10% traffic (500M DAU) |
|---|---|---|---|---|---|
| Conversion rate | 3.0% | +0.3% (10% relative) | 0.0291 | 12,800 | < 1 hour |
| Conversion rate | 3.0% | +0.1% (3.3% relative) | 0.0291 | 115,200 | < 1 day |
| Revenue/user | $2.50 | +$0.25 (10% relative) | $15.00 | 28,224 | < 1 hour |
| Revenue/user | $2.50 | +$0.05 (2% relative) | $15.00 | 705,600 | ~3 days |
| Session duration (min) | 12.0 | +0.5 (4.2% relative) | 25.0 | 62,720 | < 1 day |
| 7-day retention | 45% | +1% (2.2% relative) | 0.2475 | 77,616 | < 1 day |

### CUPED Impact on Sample Size

When CUPED achieves X% variance reduction, the effective sample size multiplier is 1/(1-X):

| CUPED Variance Reduction | Effective N Multiplier | Time Savings |
|---|---|---|
| 20% | 1.25× | 20% faster |
| 35% | 1.54× | 35% faster |
| 50% | 2.0× | 50% faster |
| 65% | 2.86× | 65% faster |

For a typical e-commerce platform with 45% CUPED variance reduction on revenue metrics, an experiment that would take 14 days without CUPED reaches significance in ~8 days. Over 300 experiments per quarter, this saves ~1,800 experiment-days.
