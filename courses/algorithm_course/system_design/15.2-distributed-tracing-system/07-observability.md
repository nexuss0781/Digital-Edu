# 07 — Observability (Meta-Observability)

> The unique challenge of a tracing system's observability is that **the system must monitor itself without creating circular dependencies**. If the tracing system uses distributed tracing to debug itself, a failure in the tracing system would simultaneously prevent diagnosis of that very failure. This section addresses the meta-observability strategy.

---

## Metrics (USE/RED)

### Ingestion Pipeline Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `collector.spans.received` | Counter | Total spans received per second | N/A (informational) |
| `collector.spans.accepted` | Counter | Spans accepted after validation | Drop rate > 5% triggers investigation |
| `collector.spans.rejected` | Counter | Spans rejected (invalid, rate-limited) | Rejection rate > 10% pages on-call |
| `collector.batch.size` | Histogram | Number of spans per ingestion batch | Avg < 10 suggests SDK batching issue |
| `collector.queue.publish.latency` | Histogram | Time to publish span batch to message queue | p99 > 500ms triggers scale-up |
| `collector.queue.publish.failures` | Counter | Failed queue publish attempts | > 0 sustained for 1 min pages on-call |

### Tail Sampler Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `sampler.buffer.traces` | Gauge | Number of traces currently buffered | > 80% capacity triggers scale-up |
| `sampler.buffer.memory_bytes` | Gauge | Memory used by trace buffer | > 75% of allocated memory |
| `sampler.trace.decision.keep` | Counter | Traces decided to keep | Monitor keep/drop ratio |
| `sampler.trace.decision.drop` | Counter | Traces decided to drop | Monitor keep/drop ratio |
| `sampler.trace.wait_time` | Histogram | Time between first span arrival and decision | p99 > 45s suggests traces not completing |
| `sampler.trace.span_count` | Histogram | Spans per completed trace | Sudden changes indicate instrumentation changes |
| `sampler.late_spans` | Counter | Spans arriving after trace decision | Sustained increase suggests wait window too short |

### Storage Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `storage.write.latency` | Histogram | Time to write a trace batch to hot store | p99 > 1s triggers investigation |
| `storage.write.failures` | Counter | Failed write operations | > 0 sustained for 5 min pages on-call |
| `storage.read.latency` | Histogram | Time to read a trace from storage | p99 > 3s for hot tier pages on-call |
| `storage.hot.disk_usage` | Gauge | Hot store disk utilization percentage | > 80% triggers capacity planning |
| `storage.compaction.lag` | Gauge | Age of oldest uncompacted data | > 4 hours triggers scale-up of compactors |
| `storage.compaction.throughput` | Counter | Traces compacted per second | Dropping below ingestion rate is concerning |

### Query Service Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `query.requests` | Counter | Total query requests per second by type | N/A (informational) |
| `query.latency` | Histogram | Query response time by query type | p99 > 5s for trace-by-ID pages on-call |
| `query.errors` | Counter | Query errors by error type | Error rate > 1% triggers investigation |
| `query.cache.hit_rate` | Gauge | Cache hit ratio by cache layer | L2 hit rate < 40% suggests cache sizing issue |
| `query.results.size` | Histogram | Number of traces returned per search | Avg > 100 suggests queries too broad |

### Service Map Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `service_map.edges` | Gauge | Number of active service-to-service edges | Sudden large increase suggests new service deployment or misconfiguration |
| `service_map.update.latency` | Histogram | Time to update service map from span batch | p99 > 1s |
| `service_map.staleness` | Gauge | Time since last service map update | > 5 minutes triggers alert |

---

## Logging

### What to Log

| Component | Log Events | Rationale |
|---|---|---|
| **Collector** | Span validation failures, rate limit triggers, queue publish failures, batch processing errors | Debug ingestion issues without relying on the tracing system itself |
| **Tail Sampler** | Buffer evictions, sampling rule changes, decision overrides, memory pressure events | Understand why specific traces were kept or dropped |
| **Storage Writer** | Write failures, compaction start/complete, retention deletions, schema migrations | Track data lifecycle and storage health |
| **Query Service** | Slow queries (> 5s), cross-tier queries, cache misses, authorization denials | Debug query performance and access control issues |
| **Compactor** | Block creation, block deletion, bloom filter generation, size statistics | Track compaction efficiency and storage cost |

### Log Levels Strategy

| Level | Usage | Examples |
|---|---|---|
| **ERROR** | Data loss risk, service degradation | Queue publish failure, storage write failure, PII detected post-scrubbing |
| **WARN** | Anomalous but handled conditions | Buffer memory > 70%, high rejection rate, compaction lag > 1 hour |
| **INFO** | Significant state transitions | Sampling rule change, compaction cycle complete, new service detected in map |
| **DEBUG** | Per-request detail (disabled in production) | Individual span processing, sampling decisions, cache hit/miss per query |

### Structured Logging Format

```
{
    "timestamp": "2026-03-10T14:23:45.678Z",
    "level": "WARN",
    "component": "tail-sampler",
    "instance_id": "sampler-7",
    "message": "Buffer memory pressure detected",
    "attributes": {
        "buffer_memory_bytes": 5368709120,
        "buffer_capacity_bytes": 7516192768,
        "utilization_pct": 71.4,
        "active_traces": 285000,
        "action": "reducing_wait_window",
        "new_wait_window_sec": 20
    }
}
```

**Critical rule**: The tracing system's own logs must **never contain trace IDs from user traces** in a way that creates a circular debugging dependency. Instead, the system uses its own internal request IDs for correlating its own operations.

---

## Meta-Tracing: Tracing the Tracing System

### The Circular Dependency Problem

If the tracing system instruments itself with its own tracing, a failure in the tracing pipeline would also prevent diagnosing that failure. The solution is a **separate, lightweight internal tracing path**:

```
Production tracing pipeline:
    Service SDKs → Agents → Collectors → Queue → Samplers → Storage

Internal tracing pipeline (separate):
    Tracing system components → Internal metrics + logs
    (NO dependency on the main tracing pipeline)
```

### Key Internal Spans to Instrument

Instead of full distributed tracing, the tracing system uses **metrics with exemplars** for self-monitoring:

| Component | Key Measurements | Method |
|---|---|---|
| Collector span processing | Processing time per batch, validation failures | Prometheus histogram with batch_id exemplar |
| Queue publish | Publish latency, message size | Metrics with partition/offset exemplar |
| Tail sampler decision | Decision latency, buffer scan time | Metrics with trace_id exemplar |
| Storage write | Write latency, batch size, error rate | Metrics with block_id exemplar |
| Query execution | Query parse time, storage read time, assembly time | Metrics with query_id exemplar |
| Compaction | Block read time, Parquet write time, bloom filter generation | Metrics with compaction_job_id exemplar |

### Health Check Hierarchy

```
FUNCTION deepHealthCheck():
    results = {}

    # Level 1: Process health
    results["process"] = checkProcessHealth()   # memory, CPU, GC pressure

    # Level 2: Dependency connectivity
    results["queue"] = checkQueueConnectivity()     # can publish/consume
    results["hot_store"] = checkHotStoreConnectivity()  # can read/write
    results["object_store"] = checkObjectStoreConnectivity()  # can list/get

    # Level 3: Pipeline flow
    results["ingestion_flow"] = checkIngestionFlow()  # send canary span, verify arrival
    results["query_flow"] = checkQueryFlow()           # query known trace, verify result

    # Level 4: Data freshness
    results["latest_trace_age"] = getLatestTraceAge()  # should be < 2 minutes
    results["service_map_age"] = getServiceMapAge()     # should be < 5 minutes

    overallStatus = ALL(results.values() are HEALTHY) ? HEALTHY : DEGRADED
    RETURN HealthReport(status = overallStatus, checks = results)
```

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Impact | Runbook Action |
|---|---|---|---|
| **Ingestion pipeline down** | `collector.spans.received` = 0 for 2 minutes | No trace data being collected; debugging capability lost | Check collector health, queue connectivity, agent connectivity; escalate if not resolvable in 10 min |
| **Storage write failures** | `storage.write.failures` > 0 for 5 minutes | Sampled traces being lost | Check hot store health, disk space, replication status; failover to secondary if needed |
| **Tail sampler buffer full** | `sampler.buffer.memory_bytes` > 95% capacity | Traces being dropped without sampling evaluation | Scale up sampler instances; reduce wait window; enable head-only sampling fallback |
| **Compaction lag critical** | `storage.compaction.lag` > 8 hours | Hot store filling up; risk of disk exhaustion | Scale up compaction workers; check for stuck compaction jobs; verify object storage accessibility |
| **PII detected post-scrubbing** | PII scanner detects patterns in stored spans | Compliance violation; potential data breach | Identify the source service; quarantine affected traces; notify security team; patch scrubbing rules |

### Warning Alerts

| Alert | Condition | Impact | Action |
|---|---|---|---|
| **High span rejection rate** | `collector.spans.rejected` / `collector.spans.received` > 5% for 15 min | Trace completeness degraded | Investigate source: malformed spans, rate limiting, or validation failures |
| **Query latency degradation** | `query.latency` p99 > 5s for 15 min | Engineers experience slow debugging | Check storage read latency, cache hit rates, query patterns |
| **Sampling imbalance** | One service produces > 30% of all spans | Storage budget dominated by one service | Review service's sampling rate; apply per-service rate limiting |
| **Service map gap** | Known service missing from dependency graph for > 1 hour | Missing visibility into service health | Check service's instrumentation; verify agent connectivity |
| **Cache hit rate drop** | L2 cache hit rate < 30% for 30 min | Increased storage read load | Check cache eviction rate; consider cache size increase |

### Alert Suppression During Maintenance

```
FUNCTION shouldSuppressAlert(alert):
    # Suppress during planned maintenance windows
    IF maintenanceWindow.isActive():
        IF alert.component IN maintenanceWindow.affectedComponents:
            RETURN TRUE

    # Suppress cascading alerts
    IF alert.severity == WARNING:
        IF anyActiveAlert(severity = CRITICAL, component = alert.component):
            # A critical alert already exists for this component;
            # suppress warning-level alerts to reduce noise
            RETURN TRUE

    RETURN FALSE
```

---

## Dashboard Design

### Overview Dashboard

| Panel | Visualization | Data Source |
|---|---|---|
| Ingestion rate | Time-series line chart (spans/sec) | `collector.spans.received` |
| Sampling efficiency | Stacked area (kept vs. dropped) | `sampler.trace.decision.*` |
| Storage utilization | Gauge (hot tier %) + trend line | `storage.hot.disk_usage` |
| Query performance | Heatmap (latency by query type) | `query.latency` |
| Service map health | Node graph (services + edges) | `service_map.edges` |
| Error traces | Counter + trend | `sampler.trace.decision.keep` where reason=error |

### Operational Dashboard

| Panel | Visualization | Data Source |
|---|---|---|
| Pipeline lag | Time-series (seconds of lag at each stage) | Consumer lag metrics |
| Buffer pressure | Multi-line (memory % per sampler instance) | `sampler.buffer.memory_bytes` |
| Compaction progress | Progress bar + queue depth | `storage.compaction.*` |
| Collector fleet health | Status grid (green/yellow/red per instance) | Health check endpoints |
| Top services by span volume | Horizontal bar chart | `collector.spans.received` by service |

### Canary Monitoring

To detect silent failures (the tracing system appears healthy but silently drops data), deploy a **canary service** that:

1. Sends a known trace (with a predictable trace ID) every 60 seconds
2. After 90 seconds, queries for that trace via the query API
3. Verifies the trace is complete and matches expectations
4. Alerts if the canary trace is missing or incomplete

This end-to-end canary catches failures that component-level metrics might miss: a scenario where collectors accept spans, the queue delivers them, but the storage writer silently fails.

### Canary Trace Architecture

```
FUNCTION runCanaryCheck():
    // Generate a deterministic trace ID for this canary cycle
    canaryTraceId = generateCanaryTraceId(currentMinute())

    // Phase 1: Emit canary trace (simulates a 3-service request)
    emitCanarySpan(traceId=canaryTraceId, service="canary-gateway", operation="canary-request", parent=NULL)
    emitCanarySpan(traceId=canaryTraceId, service="canary-service-a", operation="process", parent="canary-gateway")
    emitCanarySpan(traceId=canaryTraceId, service="canary-service-b", operation="store", parent="canary-service-a")

    // Phase 2: Wait for pipeline processing (sampling + storage)
    WAIT 90 seconds

    // Phase 3: Query for the canary trace
    result = queryService.getTrace(canaryTraceId)

    // Phase 4: Validate
    checks = {
        "trace_found": result IS NOT NULL,
        "span_count": result.spanCount == 3,
        "all_services_present": set(result.services) == {"canary-gateway", "canary-service-a", "canary-service-b"},
        "no_clock_skew_warning": "clock_skew_adjusted" NOT IN result.warnings,
        "query_latency": result.queryLatency < 3_SECONDS
    }

    FOR check, passed IN checks:
        IF NOT passed:
            ALERT("Canary check failed: {check}", severity=CRITICAL)
            INCREMENT metric: "canary.check.failed"

    IF ALL(checks.values()):
        INCREMENT metric: "canary.check.passed"

// Canary runs on a dedicated instance outside the tracing infrastructure
// It uses a SEPARATE monitoring system for alerting (not the tracing system itself)
// This ensures canary alerts work even when the tracing system is fully down
```

### Anomaly Detection for Trace Quality

| Signal | Normal Range | Anomaly Trigger | Likely Cause |
|---|---|---|---|
| Average spans per trace | 6-12 | <4 or >20 | Instrumentation change; propagation gap; fan-out pattern change |
| Root span percentage | 5-15% of all spans | >25% | Propagation failure; many services starting new traces |
| Error trace percentage | 0.5-2% | >5% | Application incident; PII scrubber false-positive on valid data |
| Clock skew adjustment rate | <5% of cross-service spans | >15% | NTP sync degradation; VM clock drift |
| Orphan span rate | <2% | >5% | Consistent hashing rebalance; collector instance failure |
| Late span rate (arriving after decision) | <1% | >3% | Wait window too short for current traffic pattern |

---

## Runbooks

### Runbook 1: Diagnosing Tail Sampler Memory Pressure

**Symptom**: `sampler.buffer.memory_bytes` exceeds 80% capacity; `sampler.trace.wait_time` p99 increasing.

```
Step 1: Identify the pressure source
    CHECK sampler.buffer.traces (gauge)
        → If trace count is normal but memory is high:
          spans per trace are larger than usual (check sampler.trace.span_count)
        → If trace count is abnormally high:
          traces are not completing (check sampler.late_spans rate)

Step 2: Check for upstream anomalies
    CHECK collector.spans.received (rate)
        → If span ingestion rate spiked: traffic burst from a deployment or load test
        → Identify the source service:
          GROUP BY service_name → find the service emitting excessive spans

Step 3: Immediate mitigation
    IF memory > 90%:
        ACTION: Reduce wait window to 10 seconds (automatic via adaptive policy)
        ACTION: Evict head-sampled traces (they're already retained via head path)
        VERIFY: sampler.buffer.memory_bytes decreasing within 2 minutes

Step 4: Root cause resolution
    IF source is a rogue service:
        ACTION: Apply per-service rate limit at the agent level
    IF source is a legitimate traffic increase:
        ACTION: Scale up sampler fleet (add instances to hash ring)
    IF traces are not completing (missing root spans):
        ACTION: Investigate service instrumentation; check propagation coverage dashboard
```

### Runbook 2: Hot Store Write Failures

**Symptom**: `storage.write.failures` > 0 sustained for 5+ minutes; alert fired.

```
Step 1: Assess scope
    CHECK storage.write.failures (rate) → how many writes/sec are failing?
    CHECK storage.write.latency (p99) → is latency elevated (indicating overload) or constant (indicating hard failure)?

Step 2: Check hot store cluster health
    QUERY hot store cluster status:
        → If nodes are down: check node health, disk space, replication status
        → If all nodes healthy but writes slow: check compaction backlog, memtable pressure

Step 3: Check message queue backlog
    CHECK consumer lag for storage writer consumer group
        → If lag growing: writes are failing and messages accumulate
        → If lag stable: writes are partially succeeding (some partitions affected)

Step 4: Immediate mitigation
    IF isolated node failure:
        ACTION: Storage writer retries against replica nodes (automatic)
        VERIFY: write failures drop after cluster rebalances (~5 min)
    IF cluster-wide degradation:
        ACTION: Reduce write concurrency (fewer parallel batch writes)
        ACTION: If queue lag exceeds 10 min: alert on-call for manual intervention
        ACTION: Consider temporarily routing writes directly to object storage (skip hot tier)

Step 5: Post-incident
    CHECK for data loss: compare span counts at collector vs. storage for the affected period
    TRIGGER compaction verification for the affected time range
```

### Runbook 3: Recovering from Service Map Staleness

**Symptom**: `service_map.staleness` exceeds 5 minutes; service map dashboard shows stale topology.

```
Step 1: Identify the Slowest part of the process
    CHECK service_map.update.latency (p99)
        → If update latency is high: map generator is overloaded
    CHECK the span stream consumer for the map generator
        → If consumer lag is high: generator cannot keep up with span volume

Step 2: Immediate mitigation
    IF generator overloaded:
        ACTION: Reduce map aggregation window (from 1-min buckets to 5-min buckets)
        ACTION: Scale generator instances (if sharded by source service)
    IF span stream consumer lag:
        ACTION: Increase consumer parallelism (add consumer instances)
        ACTION: Temporarily reduce map update frequency (compute every 5 min instead of 1 min)

Step 3: Verify recovery
    MONITOR service_map.staleness → should drop below 5 min within 10 minutes
    VERIFY new service dependencies appear within expected freshness window
```

---

## SLO Dashboard Design

### Executive Dashboard

| Panel | Visualization | SLO Target | Data Source |
|---|---|---|---|
| Ingestion availability | Single stat (%) with color coding | 99.9% | `1 - (collector.spans.rejected / collector.spans.received)` |
| Trace completeness | Single stat (%) | 95% | `traces_with_all_spans / total_sampled_traces` |
| Error trace retention | Single stat (%) | 100% | `error_traces_retained / error_traces_detected` |
| SLO burn rate | Time-series (burn rate over 1h, 6h, 1d windows) | <1x | Multi-window burn rate calculation |
| Monthly error budget remaining | Progress bar (% remaining) | >50% at mid-month | Cumulative error budget consumption |

### Operational Dashboard

| Panel | Visualization | Purpose |
|---|---|---|
| Pipeline health | Status grid (green/yellow/red per component) | At-a-glance health of all pipeline stages |
| Ingestion throughput | Time-series (spans/sec) with baseline overlay | Detect anomalous traffic patterns |
| Sampling ratio | Stacked area (head-sampled, tail-sampled, dropped) | Verify sampling policies are working as expected |
| Storage cost trend | Line chart (GB/day by tier) with cost overlay | Track cost trajectory; alert on unexpected growth |
| Top 10 services by span volume | Horizontal bar chart | Identify noisy services consuming disproportionate budget |
| Query latency heatmap | Heatmap (latency × time) by query type | Detect query performance degradation |

### Trace Quality Dashboard

| Panel | Visualization | Purpose |
|---|---|---|
| Propagation coverage | Table (service → % traces with unbroken context) | Identify services failing to propagate trace context |
| Clock skew distribution | Histogram (skew adjustment magnitude) | Monitor clock synchronization across the fleet |
| Orphan span rate | Time-series (orphan spans/sec by service) | Detect instrumentation gaps and broken propagation |
| Average trace depth | Line chart (spans per trace over time) | Detect instrumentation regressions (sudden drop = service stopped tracing) |

---

## Incident Playbooks

### Playbook: Ingestion Pipeline Stalled (P1)

**Trigger**: `collector.spans.received` drops to 0 for > 2 minutes.

| Step | Action | Owner | SLA |
|---|---|---|---|
| 1 | Verify alert is real: check collector fleet health and agent connectivity | On-call SRE | 2 min |
| 2 | Check agent → collector network connectivity; verify load balancer health | On-call SRE | 5 min |
| 3 | If LB is down: failover to backup LB; if collectors are down: restart fleet | On-call SRE | 10 min |
| 4 | If message queue is down: collectors buffer in memory; trigger queue recovery | On-call SRE | 15 min |
| 5 | Verify recovery: `collector.spans.received` returns to baseline within 5 min | On-call SRE | 20 min |
| 6 | Post-incident: quantify span loss; check if error traces were affected | Platform team | 24 hours |

**Escalation**: If not resolved within 15 minutes, page platform team lead.

### Playbook: Trace Query Latency Degradation (P2)

**Trigger**: `query.latency` p99 exceeds 5s for trace-by-ID queries for > 15 minutes.

| Step | Action | Owner | SLA |
|---|---|---|---|
| 1 | Check cache hit rates: is L2 cache hit rate below 30%? | On-call SRE | 5 min |
| 2 | Check hot store read latency: is the wide-column cluster overloaded? | On-call SRE | 10 min |
| 3 | If cache issue: check cache instance health; restart if needed; increase cache size | On-call SRE | 15 min |
| 4 | If hot store issue: check compaction backlog; check disk utilization; scale cluster | Platform team | 30 min |
| 5 | If warm/cold tier queries: check object storage latency; verify block metadata cache | Platform team | 30 min |
| 6 | Interim mitigation: redirect queries to hot tier only; accept incomplete results for older traces | On-call SRE | 5 min |

### Playbook: PII Detected in Stored Traces (P1/Security)

**Trigger**: PII scanner detects patterns in stored span data.

| Step | Action | Owner | SLA |
|---|---|---|---|
| 1 | Identify affected traces: which service, which tag/log field, how many traces | Security team | 30 min |
| 2 | Quarantine affected traces: mark as PII-contaminated in metadata; restrict query access | Platform team | 1 hour |
| 3 | Identify root cause: which service is leaking PII? Is it a new endpoint, a misconfigured SDK, or a missing scrubbing rule? | Security team + service owner | 2 hours |
| 4 | Deploy fix: add scrubbing rule at collector layer; update SDK configuration for the source service | Platform team | 4 hours |
| 5 | Remediate stored data: delete or redact affected traces across all storage tiers (including warm/cold) | Platform team | 24 hours |
| 6 | Post-incident: update PII scrubbing test suite; add regression test for this pattern | Security team | 48 hours |
