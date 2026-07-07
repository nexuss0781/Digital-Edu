# 12.16 Product Analytics Platform — Observability

## Observability Philosophy

A product analytics platform is, at its core, an observability tool for other products—yet it is often the last system to be well-instrumented itself. The platform must monitor two fundamentally different operational concerns: **ingestion health** (are events arriving and being stored correctly?) and **query health** (are analytical results accurate and fast?). A third dimension unique to analytics platforms is **data freshness health**: the lag between an event occurring in the real world and that event being reflected in query results. Each concern has distinct failure modes, metrics, and alerting strategies.

---

## Ingestion Metrics

### Core Ingestion KPIs

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `ingest.events.received_total` | Counter | Total events received by collectors | — (baseline) |
| `ingest.events.accepted_total` | Counter | Events accepted after validation | — |
| `ingest.events.rejected_total` | Counter | Events rejected (invalid envelope) | > 0.1% of received |
| `ingest.events.deduplicated_total` | Counter | Events dropped as duplicates | > 5% of received (SDK retry storm) |
| `ingest.collector.latency_p99_ms` | Histogram | End-to-end collector latency (receipt to queue write) | > 100ms |
| `ingest.queue.lag_seconds` | Gauge | Consumer lag for each queue partition | > 60 seconds |
| `ingest.stream_processor.throughput_eps` | Gauge | Events/second processed per processor instance | < 1000 eps (under-provisioned) |
| `ingest.hot_store.write_latency_p99_ms` | Histogram | Hot store write latency | > 50ms |
| `ingest.bloom_filter.false_positive_rate` | Gauge | Estimated bloom filter false positive rate | > 0.05% |
| `ingest.governance.violation_rate` | Gauge | % of events with schema violations per project | > 10% (data quality issue) |
| `ingest.pii.detection_rate` | Gauge | % of events triggering PII detection | > 1% (customer education needed) |

### Event Volume Anomaly Detection

A baseline model is maintained for expected event volume per project per hour-of-day, day-of-week:

```
Anomaly detection model:
  For each (project_id, event_name, hour_of_day, day_of_week):
    expected_volume = EWMA(historical_volumes, alpha=0.1)
    sigma = EWMA_std_dev(historical_volumes, alpha=0.1)

  Alert conditions:
    - Volume < expected - 3*sigma for 2 consecutive 5-min windows → "Event drop detected"
    - Volume > expected + 5*sigma for 1 window → "Event spike detected"
    - Volume = 0 for 30 min during peak hours (8am–10pm project timezone) → "Event silence"
```

Event silence detection is critical: when a product's analytics go silent (SDK misconfigured after a deploy), the product team may not notice for hours. Proactive alerting on silence reduces the mean-time-to-detect (MTTD) from hours to minutes.

---

## Query Performance Metrics

### Core Query KPIs

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `query.funnel.latency_p50_ms` | Histogram | Median funnel query execution time | > 500ms |
| `query.funnel.latency_p99_ms` | Histogram | P99 funnel query execution time | > 2000ms |
| `query.retention.latency_p99_ms` | Histogram | P99 retention query execution time | > 3000ms |
| `query.path.latency_p99_ms` | Histogram | P99 path analysis query time | > 5000ms |
| `query.cache.hit_rate` | Gauge | L1 result cache hit rate | < 20% (cache misconfigured) |
| `query.materialized_view.hit_rate` | Gauge | Warm materialized view hit rate | < 30% (workload shifted) |
| `query.cold_scan.rate` | Gauge | % of queries hitting cold columnar scan | > 60% (cache miss high) |
| `query.timeout_rate` | Gauge | % of queries timing out (> 30s) | > 0.1% |
| `query.queue.depth` | Gauge | Queries waiting for executor slots | > 10 |
| `query.executor.utilization` | Gauge | % of query executor capacity in use | > 80% sustained |
| `query.cost.rows_scanned_total` | Counter | Total rows scanned per project per hour | Top-N projects (quota enforcement) |

### Query Latency Breakdown

Slow queries are instrumented with span-level timing to identify the Slowest part of the process:

```
Span tree for a typical funnel query:
  query_total (wall clock)
  ├── cache_lookup (L1 check)
  ├── plan_generation (parse + route)
  ├── step_scan_parallel (all steps in parallel)
  │   ├── step_0_scan (hot + warm partition reads)
  │   ├── step_1_scan
  │   └── step_2_scan
  ├── bitmap_construction (per step)
  ├── intersection_and_window_check
  ├── breakdown_computation (if requested)
  └── result_serialization
```

When P99 latency exceeds threshold, the span tree identifies which phase is slow:
- If `step_scan_parallel` dominates: storage is the Slowest part of the process → scale storage nodes
- If `bitmap_construction` dominates: memory pressure → add query worker memory
- If `intersection_and_window_check` dominates: funnel has too many steps or users → suggest query optimization
- If `result_serialization` dominates: result set too large → suggest breakdown limits

---

## Data Freshness Monitoring

### Freshness Metrics

Data freshness is the most analytically important observability dimension: stale data leads to incorrect business decisions.

| Metric | Description | Alert Threshold |
|---|---|---|
| `freshness.ingest_lag_p95_seconds` | P95 time from event timestamp to event queryable in hot store | > 60 seconds |
| `freshness.hot_to_warm_lag_hours` | Time since last hot→warm compaction ran | > 2 hours |
| `freshness.warm_to_cold_lag_hours` | Time since last warm→cold compaction ran | > 26 hours |
| `freshness.rollup.lag_minutes` | Age of the oldest un-refreshed rollup cell | > 15 minutes |
| `freshness.materialized_view.stale_count` | Count of materialized views older than their configured refresh interval | > 0 |
| `freshness.late_event.rate` | % of events arriving with event_time > 1 hour before server_received_at | > 5% (client clock issues) |
| `freshness.retention_matrix.staleness_hours` | Age of oldest retention matrix cell in active cohort queries | > 25 hours |

### Canary Event Monitoring

A synthetic canary event (`_platform_canary`) is emitted by the monitoring system every minute from a controlled source. The end-to-end latency from canary emission to query visibility is the most reliable freshness measurement:

```
Canary flow:
  1. Monitoring system emits event with event_id=canary_001, timestamp=T0
  2. After 30 seconds, monitoring system queries: "did canary_001 appear?"
  3. If not visible: freshness alert (lag > 30s)
  4. If visible after 35 seconds: log actual lag
  5. Repeat every 60 seconds per region per project (sampled for large-project set)

Dashboards:
  - Real-time freshness p50/p95 by region
  - Historical freshness trend (did a deploy degrade freshness?)
  - Freshness SLO burn rate (are we spending SLO budget faster than expected?)
```

---

## SLO Dashboards

### Dashboard Structure

The operational dashboard is organized into three views corresponding to the three operational concerns:

**Ingestion Health Dashboard:**
```
Row 1: Current ingestion rate (events/sec) — by region, by project tier
Row 2: Collector latency percentiles (P50/P95/P99) — 1-hour window
Row 3: Queue lag — per partition, color-coded (green < 5s, yellow 5–30s, red > 30s)
Row 4: Event rejection and deduplication rates — last 6 hours
Row 5: PII detection and governance violation rates — by project (top 20)
```

**Query Health Dashboard:**
```
Row 1: Query volume by type (funnel/retention/path/ad-hoc) — per hour
Row 2: P50/P99 query latency by type — compared to SLO thresholds
Row 3: Cache hit rate (L1 + materialized view) — 24-hour trend
Row 4: Query timeout rate — last 2 hours
Row 5: Executor utilization — per region, with quota alerts
```

**Data Freshness Dashboard:**
```
Row 1: Canary event end-to-end latency — real-time, last 2 hours
Row 2: Ingest lag distribution — P50/P95/P99 across all projects
Row 3: Compaction job status — last run time, files processed, duration
Row 4: Rollup staleness — count of stale rollup cells by tier
Row 5: SLO error budget burn rate — freshness SLO consumption over 30-day window
```

### SLO Error Budget Tracking

```
SLO: 95% of events queryable within 60 seconds of event occurrence

Error budget calculation:
  - 30-day window = 2,592,000 minutes = 2,592,000 measurement windows
  - 5% error budget = 129,600 minutes where freshness > 60s is allowed
  - 1 minute of freshness violation = 1 minute consumed from budget

Budget burn rate dashboard:
  - Current 1-hour burn rate vs. expected (budget / hours remaining)
  - Alert: "Burn rate 3× normal — at this rate, SLO will be violated in N days"
  - Multi-window alerts: 1h burn rate × 6h lookback for sustained issues
```

---

## Alerting Strategy

### Alert Tiers and Routing

| Tier | Severity | Response Time | Examples | Routing |
|---|---|---|---|---|
| P1 — Critical | Ingestion stopped or data loss | 5 min | Queue lag > 5 min; collector availability < 99.5%; hot store write failure | On-call engineer page |
| P2 — High | SLO at risk | 30 min | P99 query latency 2× SLO; freshness lag > 120s; error budget burning fast | Slack #alerts-analytics |
| P3 — Medium | Degraded experience | 2 hours | Cache hit rate drop; high PII detection rate; governance violations spike | Slack #analytics-ops |
| P4 — Low | Informational | Next business day | Compaction running slower than expected; bloom filter accuracy drift | Ticket creation |

### Composite Alerts

Single-metric alerts generate noise. Composite alerts fire only when multiple signals align:

**"Funnel Data Quality Degraded" alert:**
```
FIRE when:
  ingest.events.deduplicated_total rate > 5% for 5 consecutive minutes
  AND query.funnel.latency_p99 > 1.5× baseline
  AND freshness.ingest_lag_p95 > 45s

Indicates: SDK retry storm causing dedup pressure AND downstream query degradation
Action: Check SDK release rollout; scale collector tier if needed
```

**"Silent Project" alert:**
```
FIRE when:
  project has had > 100 events/hour for the past 7 days
  AND current event rate = 0 for 30 consecutive minutes
  AND it is within project's active hours (8am-10pm local timezone)

Indicates: Likely SDK misconfiguration or deploy broke instrumentation
Action: Auto-notify project owner via email + in-app notification
```

**"Query Cost Runaway" alert:**
```
FIRE when:
  query.cost.rows_scanned_total for project P in last 1 hour > 10× 7-day average
  AND query.executor.utilization > 70%

Indicates: An analyst is running expensive ad hoc queries that are consuming shared resources
Action: Auto-throttle project P to 5 concurrent queries; notify project admin; suggest materialized views for the query pattern
```

---

## Operational Runbooks

### Runbook 1: Ingestion Queue Lag > 5 Minutes

**Severity:** P1 — Event data becoming stale for all projects on affected partitions

**Diagnostic steps:**
```
1. Check stream processor health:
   - Are all consumer instances alive? (check consumer group membership)
   - Is any single instance processing slowly? (check per-instance throughput)

2. Check hot store write health:
   - Is hot store write latency elevated? (check ingest.hot_store.write_latency_p99)
   - Is hot store disk full? (check hot store capacity utilization)

3. Check for whale tenant spike:
   - Which partitions have the highest lag?
   - Map partitions to project_ids: is one project responsible for the spike?

4. Check queue broker health:
   - Is any broker under-replicated? (check ISR count per partition)
   - Is broker disk I/O saturated?
```

**Resolution actions:**
- If stream processor instances are down: restart failed instances; scale up consumer group
- If hot store is the Slowest part of the process: temporarily bypass hot store writes (accept dashboard staleness); scale hot store nodes
- If whale tenant spike: activate adaptive sub-partitioning for the whale project
- If queue broker issue: trigger leader rebalance to move partitions off degraded broker

### Runbook 2: Query P99 Latency > 2× SLO

**Severity:** P2 — User-facing query degradation

**Diagnostic steps:**
```
1. Identify the query type contributing most to P99:
   - Funnel, retention, path, or ad hoc?

2. Analyze span tree breakdown for slow queries:
   - Which phase dominates? (step_scan, bitmap_construction, intersection, serialization)

3. Check resource utilization:
   - Query executor CPU and memory utilization
   - Cold storage read throughput (object storage rate limits?)
   - L1 cache hit rate (has a deploy invalidated the cache?)

4. Check for hot projects:
   - Is one project consuming disproportionate query resources?
```

**Resolution actions:**
- If scan phase dominates: add query executor nodes; verify partition Cutting off unnecessary steps is working
- If bitmap phase dominates: increase query worker memory allocation
- If cache miss rate spiked: investigate recent cache invalidation event; pre-warm cache for top dashboard queries
- If single project is the cause: apply per-project query throttling; suggest query optimization to project admin

### Runbook 3: Canary Event Freshness > 120 Seconds

**Severity:** P2 — Data freshness SLO at risk

**Diagnostic steps:**
```
1. Determine which region and project tier is affected
2. Check canary emission: is the canary being emitted? (check canary.emitted counter)
3. Check canary ingestion: is the canary reaching the queue? (check canary event in queue)
4. Check canary processing: is the canary being processed by stream processor? (check canary in hot store)
5. Check canary queryability: is the canary visible in query results? (check query freshness)
```

**Resolution actions:**
- If canary not emitted: fix monitoring system (not a platform issue)
- If canary in queue but not processed: stream processor lag — see Runbook 1
- If canary in hot store but not queryable: query router not picking up hot store data — check hot store → query router connectivity
- If canary missing from queue: collector or bloom filter issue — check collector health and bloom filter false positive rate

---

## Error Budget Policy

### Budget Calculation

```
SLO: Ingestion availability = 99.99%
  30-day budget = 30 × 24 × 60 × (1 - 0.9999) = 4.32 minutes of downtime

SLO: Funnel query P99 < 2 seconds = 99.5% of queries
  30-day budget = total_queries × 0.005 = allowed slow queries

SLO: Data freshness within 60 seconds = 95% of events
  30-day budget = total_events × 0.05 = events allowed to exceed 60s freshness
```

### Budget Consumption Actions

| Budget Remaining | Status | Action |
|---|---|---|
| > 75% | **Healthy** | Normal operations; deploy freely |
| 50–75% | **Caution** | Limit deploys to non-ingestion components; increase monitoring frequency |
| 25–50% | **Warning** | Freeze non-critical deploys; investigate budget consumers; scale defensively |
| 10–25% | **Critical** | Emergency freeze; all changes require VP approval; focus engineering on reliability |
| < 10% | **Exhausted** | Post-incident review mandatory; reliability sprint takes priority over all feature work |

### Budget Attribution

Each budget violation is attributed to a root cause category:

| Category | Description | Example |
|---|---|---|
| **Planned** | Maintenance, migrations | Hot store version upgrade causing 2-min write pause |
| **Infrastructure** | Cloud provider issues | Object storage latency spike |
| **Software** | Bugs, misconfigurations | Query router incorrectly routing to cold tier for hot data |
| **Load** | Traffic exceeds provisioned capacity | Viral product launch causing 3× burst |
| **External** | Customer-caused | Whale tenant sending malformed events causing validation CPU spike |

---

## Capacity Forecasting

### Trend-Based Forecasting

The observability system maintains a capacity forecasting model that projects resource exhaustion:

```
FOR EACH resource IN [hot_store_capacity, warm_store_capacity, queue_throughput,
                       query_executor_slots, network_bandwidth]:
  current_usage = get_daily_average(resource, last_30_days)
  growth_rate = linear_regression_slope(resource, last_90_days)

  IF growth_rate > 0:
    days_to_exhaustion = (resource.capacity - current_usage) / growth_rate
    IF days_to_exhaustion < 30:
      alert("CAPACITY_WARNING", resource, days_to_exhaustion)
    IF days_to_exhaustion < 7:
      alert("CAPACITY_CRITICAL", resource, days_to_exhaustion)
```

### Seasonal Adjustment

Analytics traffic has strong seasonality: Q4 e-commerce spikes, back-to-school SaaS growth, gaming event launches. The forecasting model incorporates a seasonal multiplier derived from year-over-year patterns:

```
adjusted_growth = base_growth × seasonal_multiplier[current_month]
days_to_exhaustion = (capacity - current_usage) / adjusted_growth
```

This prevents under-provisioning during predictable high-traffic periods and over-provisioning during quiet months.

---

## Data Quality Monitoring

### Quality Checks

| Check | Frequency | Method | Alert Threshold |
|---|---|---|---|
| **Event count consistency** | Hourly | Compare queue produced count vs hot store written count | Discrepancy > 0.01% |
| **Dedup ratio stability** | Per 5-min window | Track bloom filter hit rate over time | Spike > 3× baseline (SDK retry storm) |
| **Schema violation trend** | Daily | Governance scorer violation count per project | Increase > 50% week-over-week |
| **Property type consistency** | Daily | Compare inferred types across daily partitions | New type conflicts in top-100 properties |
| **Late event ratio** | Hourly | Count events with client\_timestamp > 1h before server\_received\_at | > 5% of events (client clock issues) |
| **Identity stitching completeness** | Daily | Count events with user\_id = NULL after 24h | > 1% of events still unresolved |
| **Rollup vs raw accuracy** | Daily | Sample queries: compare rollup results vs cold scan | Divergence > 1% |

### Data Quality Score per Project

```
FUNCTION compute_project_data_quality_score(project_id, window=7_DAYS):
  score = 100.0

  // Schema quality: how many events match registered schemas?
  schema_adherence = registered_event_ratio(project_id, window)
  score -= (1.0 - schema_adherence) * 30  // Up to -30 for unregistered events

  // Property consistency: how many type conflicts exist?
  type_conflicts = count_type_conflicts(project_id, window)
  score -= MIN(type_conflicts * 2, 20)  // Up to -20 for type conflicts

  // Freshness: what fraction of events have significant clock skew?
  skewed_ratio = late_event_ratio(project_id, window)
  score -= MIN(skewed_ratio * 100, 15)  // Up to -15 for late events

  // Identity: what fraction of events are unresolved after 24h?
  unresolved_ratio = unresolved_identity_ratio(project_id, window)
  score -= MIN(unresolved_ratio * 100, 15)  // Up to -15 for identity gaps

  // PII exposure: how many PII detections per day?
  pii_rate = daily_pii_detections(project_id, window) / daily_event_count(project_id, window)
  score -= MIN(pii_rate * 1000, 20)  // Up to -20 for PII in events

  RETURN MAX(score, 0)
```

---

## Health Check Endpoint

```
GET /health

Response 200 OK:
{
  "status": "healthy",
  "timestamp": "2025-06-15T14:23:00Z",
  "components": {
    "collector_tier": {
      "status": "healthy",
      "active_nodes": 15,
      "events_per_second": 347000,
      "p99_latency_ms": 42
    },
    "message_queue": {
      "status": "healthy",
      "partitions": 300,
      "max_lag_seconds": 3.2,
      "under_replicated_partitions": 0
    },
    "stream_processors": {
      "status": "healthy",
      "active_instances": 65,
      "throughput_eps": 345000,
      "backlog_events": 12000
    },
    "hot_store": {
      "status": "healthy",
      "nodes": 12,
      "utilization_pct": 62,
      "write_latency_p99_ms": 18
    },
    "query_engine": {
      "status": "healthy",
      "active_workers": 32,
      "executor_utilization_pct": 55,
      "cache_hit_rate_pct": 68,
      "pending_queries": 3
    },
    "identity_cache": {
      "status": "healthy",
      "entries": 1200000000,
      "hit_rate_pct": 99.2
    }
  },
  "slo_status": {
    "ingestion_availability": {"current": 99.998, "target": 99.99, "budget_remaining_pct": 82},
    "freshness_p95_seconds": {"current": 28, "target": 60, "budget_remaining_pct": 91},
    "funnel_query_p99_ms": {"current": 1340, "target": 2000, "budget_remaining_pct": 76}
  }
}
```

---

## Monitoring Anti-Patterns

| Anti-Pattern | Problem | Correct Approach |
|---|---|---|
| **Alerting on queue lag alone** | Misses failures downstream of queue (hot store write failure, governance bug) | Use end-to-end canary event measurement |
| **Fixed thresholds for event volume** | Normal diurnal patterns trigger false positives on weekends/nights | Use EWMA-based anomaly detection with day-of-week seasonality |
| **Per-component uptime SLO** | All components "up" but data not flowing (pipeline stuck) | Measure end-to-end freshness as the primary SLO |
| **Alerting on every governance violation** | Creates alert fatigue; most violations are benign new properties | Aggregate into per-project quality score; alert on trend changes |
| **Ignoring cross-tier merge latency** | Hot-warm merge becomes dominant query cost during tier transitions | Track merge time as separate span in query instrumentation |
