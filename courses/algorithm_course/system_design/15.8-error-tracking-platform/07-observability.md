# Observability — Error Tracking Platform

## Metrics (USE/RED)

### Ingestion Pipeline Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `relay.events.accepted` | Counter | Events accepted by relay per second | — |
| `relay.events.rejected` | Counter | Events rejected (rate limit, quota, invalid) | >10% of total |
| `relay.events.spike_throttled` | Counter | Events dropped by spike protection | Informational |
| `relay.latency.p99` | Histogram | Relay response latency | >500ms |
| `relay.dsn.invalid` | Counter | Invalid DSN authentication attempts | >100/min (abuse signal) |
| `bus.consumer.lag` | Gauge | Message bus consumer lag (seconds) | >30s |
| `bus.consumer.lag.events` | Gauge | Consumer lag in event count | >100K |
| `processing.throughput` | Counter | Events processed per second | — |
| `processing.errors` | Counter | Processing failures (crash, timeout) | >1% of throughput |
| `processing.latency.p99` | Histogram | End-to-end processing latency | >15s |

### Fingerprinting & Grouping Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `fingerprint.new_issues.rate` | Counter | New issues created per minute | >10x baseline (grouping degradation signal) |
| `fingerprint.cache.hit_rate` | Gauge | Fingerprint cache hit ratio | <80% |
| `fingerprint.strategy` | Counter | Events grouped by each strategy (stack_trace, exception, message, custom) | Informational |
| `issues.merge.rate` | Counter | User-initiated issue merges per day | Trend monitoring |
| `issues.split.rate` | Counter | User-initiated issue splits per day | Trend monitoring |
| `fingerprint.collision.suspected` | Counter | Issues with high event diversity (potential false merges) | >0 for new algorithm versions |

### Symbolication Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `symbolication.success_rate` | Gauge | Events successfully symbolicated / events needing symbolication | <95% |
| `symbolication.latency.p99` | Histogram | Source map lookup + parsing + resolution time | >5s |
| `symbolication.cache.hit_rate` | Gauge | Source map cache hit ratio | <70% |
| `symbolication.missing_sourcemap` | Counter | Events where source map was not found for the release | >5% per project |
| `symbolication.queue_depth` | Gauge | Retro-symbolication queue backlog | >10K |
| `sourcemap.parse_time.p99` | Histogram | Time to parse a single source map | >3s |
| `sourcemap.memory_usage` | Gauge | Memory consumed by cached parsed source maps | >80% of allocated |

### Alerting Pipeline Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `alerts.evaluation.latency.p99` | Histogram | Time from event to alert rule evaluation | >30s |
| `alerts.delivery.latency.p99` | Histogram | Time from rule trigger to notification delivery | >60s |
| `alerts.delivery.failure_rate` | Gauge | Failed notification deliveries / total | >5% |
| `alerts.queue_depth` | Gauge | Pending alert evaluations | >1K |
| `alerts.suppressed` | Counter | Alerts suppressed by frequency cap | Informational |

### Quota & Billing Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `quota.usage.percentage` | Gauge | Per-org quota consumption | >80% (warning), >95% (critical) |
| `quota.rejected.events` | Counter | Events rejected due to quota exhaustion | >0 (notify customer) |
| `spike_protection.active_projects` | Gauge | Projects currently under spike protection | Informational |
| `spike_protection.events_dropped` | Counter | Events dropped by spike protection | Informational |

---

## Dashboard Design

### Operator Dashboard: Platform Health

**Panels (4x3 grid):**

| Row 1 | | |
|--------|--------|--------|
| Event ingestion rate (events/sec, 5-min rolling) | Consumer lag (seconds, per partition) | Processing latency distribution (p50/p95/p99) |

| Row 2 | | |
|--------|--------|--------|
| Symbolication success rate (%, per platform) | Fingerprint cache hit rate (%) | New issues rate (per hour, with baseline overlay) |

| Row 3 | | |
|--------|--------|--------|
| Alert delivery latency (seconds, p99) | Active spike protections (count + project list) | Quota utilization heatmap (top 20 orgs) |

| Row 4 | | |
|--------|--------|--------|
| Error rate by processing stage (normalize, symbolicate, fingerprint) | Storage growth rate (GB/day) | Top 10 projects by event volume |

### Customer Dashboard: Project Health

**Panels:**
- Error rate over time (events/hour with release markers)
- Top 5 issues by frequency (with sparklines)
- Crash-free session rate (% with trend arrow)
- New issues vs resolved issues (daily stacked bar)
- Release comparison (error rates side-by-side)

---

## Logging

### What to Log

| Component | Log Events | Level |
|-----------|-----------|-------|
| Relay | DSN validation failure; rate limit activation; spike protection trigger; malformed envelope rejection | WARN |
| Processing | Symbolication failure (with release + filename); fingerprint strategy fallback; processing timeout | WARN |
| Alert engine | Rule evaluation; notification send; delivery failure; suppression | INFO / ERROR |
| Quota | Quota threshold crossed (80%, 95%, 100%); spike baseline recomputed | INFO / WARN |
| API | Authentication failure; authorization denial; rate limit on management API | WARN |

### Log Levels Strategy

| Level | Usage | Example |
|-------|-------|---------|
| ERROR | Unrecoverable failures requiring operator attention | "Failed to write event batch to columnar store: connection refused" |
| WARN | Recoverable issues or degraded behavior | "Source map not found for release frontend@2.4.1; storing raw frames" |
| INFO | Significant state changes | "Spike protection activated for project abc123; sample rate: 10%" |
| DEBUG | Detailed processing steps (disabled in production by default) | "Fingerprint computed via stack_trace strategy; hash=a1b2c3..." |

### Structured Logging Format

```
{
  "timestamp": "2026-03-10T09:15:23.456Z",
  "level": "WARN",
  "service": "processing-worker",
  "instance": "worker-07",
  "trace_id": "abc123def456",
  "event_id": "evt-789",
  "project_id": "proj-456",
  "org_id": "org-123",
  "message": "Source map not found for symbolication",
  "context": {
    "release": "frontend@2.4.1",
    "filename": "app.min.js",
    "fallback": "storing_raw_frames"
  }
}
```

---

## Distributed Tracing

### Trace Propagation Strategy

Every error event carries a `trace_id` through the entire processing pipeline:

1. **Relay** generates `trace_id` on event receipt (or uses the SDK-provided one)
2. **Message bus** propagates `trace_id` in message headers
3. **Processing workers** continue the trace through normalize → symbolicate → fingerprint → enrich stages
4. **Storage writes** carry the trace for write latency attribution
5. **Alert evaluation** continues the trace to notification delivery

### Key Spans to Instrument

| Span | Parent | What It Measures |
|------|--------|-----------------|
| `relay.receive` | Root | Envelope parsing + DSN validation + quota check |
| `relay.publish` | `relay.receive` | Publishing to message bus |
| `process.normalize` | Root (consumer) | Schema validation + field extraction |
| `process.symbolicate` | `process.normalize` | Source map lookup + parsing + resolution |
| `process.symbolicate.cache_lookup` | `process.symbolicate` | Cache hit/miss for parsed source map |
| `process.symbolicate.parse` | `process.symbolicate` | VLQ decoding (only on cache miss) |
| `process.fingerprint` | `process.symbolicate` | Frame normalization + hash computation |
| `process.fingerprint.db_lookup` | `process.fingerprint` | Issue existence check |
| `process.enrich` | `process.fingerprint` | Geo-IP + device classification |
| `store.columnar_write` | `process.enrich` | Batch insert to columnar store |
| `store.issue_upsert` | `process.fingerprint` | Issue create/update in relational DB |
| `alert.evaluate` | `store.issue_upsert` | Alert rule evaluation |
| `alert.deliver` | `alert.evaluate` | Notification dispatch (Slack, email, etc.) |

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Runbook |
|-------|-----------|---------|
| **Ingestion pipeline down** | Event acceptance rate drops to 0 for >2 minutes | Check relay health → message bus → network; failover if needed |
| **Consumer lag critical** | Bus consumer lag >5 minutes | Scale processing workers; check for stuck consumers; verify storage health |
| **Relational DB failover** | Primary DB unreachable; failover initiated | Verify replica promotion; check replication lag; update connection strings if needed |
| **Columnar store write failures** | Write error rate >5% for >2 minutes | Check disk space, cluster health, replication status |
| **Alert delivery pipeline down** | No alerts delivered for >10 minutes despite new events | Check alert engine health; verify notification channel connectivity |

### Warning Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| **Symbolication success rate degraded** | <90% for >30 minutes | Check symbolicator health; look for missing source maps for recent releases |
| **New issue rate anomaly** | >5x baseline for >15 minutes | Possible grouping degradation or legitimate spike; investigate fingerprint strategy distribution |
| **Consumer lag elevated** | Bus consumer lag >1 minute | Monitor trend; pre-scale workers if increasing |
| **Cache hit rate low** | Fingerprint cache hit rate <70% for >1 hour | Check cache cluster health; possible eviction pressure from new release with many new fingerprints |
| **Quota approaching limit** | Organization at 90% quota | Notify customer; prepare for quota enforcement |
| **Storage growth anomaly** | Daily growth >2x 7-day average | Investigate which projects are driving growth; check for event flooding |

### Runbook References

| Runbook | Trigger | Key Steps |
|---------|---------|-----------|
| `runbook-ingestion-outage` | Ingestion pipeline down | 1. Check relay logs 2. Verify message bus health 3. Check DNS/LB 4. Failover if regional |
| `runbook-consumer-lag` | Consumer lag critical | 1. Check worker errors 2. Scale workers 3. Check storage write latency 4. Skip/sample if degraded |
| `runbook-grouping-anomaly` | New issue rate spike | 1. Check recent algorithm changes 2. Verify symbolication 3. Check for new release with changed code structure |
| `runbook-quota-management` | Customer quota exhausted | 1. Verify spike protection is active 2. Contact customer 3. Offer temporary quota increase if legitimate |

---

## SLO Dashboard Design

### Error Budget Tracking

| SLO | Target | 30-Day Budget | Current Burn | Status |
|-----|--------|--------------|-------------|--------|
| Ingestion success | 99.9% | 43.2 min | Computed from `relay.events.rejected / relay.events.total` | Green / Yellow / Red |
| Processing p99 < 15s | 99.5% | 3.6h violations | Computed from `processing.latency.p99` histogram | Green / Yellow / Red |
| Alert delivery < 60s | 99.5% | 3.6h violations | Computed from `alerts.delivery.latency.p99` | Green / Yellow / Red |
| Platform availability | 99.95% | 21.6 min | Composite of health check endpoints | Green / Yellow / Red |

**Burn rate alert configuration:**

| Alert | Condition | Window | Action |
|-------|-----------|--------|--------|
| Fast burn | >14.4x error budget consumption rate | 1h | Page on-call immediately |
| Slow burn | >3x error budget consumption rate | 6h | Notify engineering channel |
| Budget warning | >50% budget consumed | 30-day rolling | Weekly report to engineering leadership |
| Budget exhaustion | >100% budget consumed | 30-day rolling | Incident review; postmortem required |

### Grouping Quality Dashboard

Dedicated dashboard for monitoring the fingerprinting engine's health:

| Panel | Metric | What It Reveals |
|-------|--------|----------------|
| New issue creation rate (per hour) | `fingerprint.new_issues.rate` | Spikes without new deploys indicate grouping regression |
| Merge rate trend (daily) | `issues.merge.rate` | Rising merge rate = under-grouping (too many issues) |
| Split rate trend (daily) | `issues.split.rate` | Rising split rate = over-grouping (unrelated bugs merged) |
| Strategy distribution | `fingerprint.strategy` by type | Sudden shift (e.g., stack_trace → message) indicates symbolication failure |
| Average events per new issue | New events / new issues ratio | Low ratio (1-2 events/issue) suggests excessive splitting |
| Fingerprint cache hit rate | `fingerprint.cache.hit_rate` | Drop after deploy indicates cold cache; sustained low rate indicates sizing issue |

---

## Extended Operational Runbooks

### Runbook: Symbolication Service Degradation

**Trigger:** `symbolication.success_rate` < 90% for > 30 minutes

**Diagnosis Steps:**
1. Check symbolicator service health: pod restarts, OOM kills, CPU saturation
2. Check source map availability: query object storage for recent releases — are maps uploaded?
3. Check cache hit rate: if cache miss rate is high, verify cache cluster health (Redis memory, evictions)
4. Check parsing queue depth: if the queue is deep, symbolicator nodes may be overwhelmed by simultaneous new release deploys

**Resolution Steps:**
| Root Cause | Action |
|-----------|--------|
| Symbolicator OOM | Reduce concurrent parsing limit; increase memory allocation |
| Source maps missing for new release | Check CI/CD upload pipeline; notify customer; events will retro-symbolicate when maps arrive |
| Cache cluster failure | Restart cache nodes; symbolicator falls back to object storage (slower but functional) |
| Parsing thundering herd | Verify deduplication semaphore is functioning; scale symbolicator nodes |

### Runbook: Consumer Lag Storm

**Trigger:** `bus.consumer.lag` > 5 minutes AND increasing

**Diagnosis Steps:**
1. Check worker error rates: are events failing to process (poison message)?
2. Check worker CPU/memory: are workers healthy but overwhelmed?
3. Check downstream dependencies: is columnar store or relational DB slow?
4. Check if spike protection should have triggered but didn't

**Resolution Steps:**
| Root Cause | Action |
|-----------|--------|
| Processing spike (legitimate) | Scale workers 2x; enable aggressive batching for columnar writes |
| Poison message blocking partition | Identify stuck offset; move message to DLQ; resume processing |
| Downstream storage slow | Check ClickHouse merges, PostgreSQL locks; scale if needed |
| Worker deployment issue | Rollback to previous version; investigate processing error |

### Runbook: Fingerprint Cache Corruption

**Trigger:** Sudden increase in `fingerprint.new_issues.rate` without corresponding new releases across multiple projects

**Diagnosis Steps:**
1. Check cache cluster health: look for partial failures, network partitions
2. Check if a fingerprint algorithm deployment occurred
3. Sample new issues: do they have similar stack traces to existing issues? (indicates cache miss → DB miss → duplicate issue)

**Resolution Steps:**
| Root Cause | Action |
|-----------|--------|
| Cache cluster partial failure | Restart affected nodes; cache will rebuild from DB lookups |
| Algorithm deployment bug | Rollback algorithm version; new issues created during window need manual merge |
| DB lookup failure (cache fall-through also failing) | Check DB health; restore from replica if primary is down |

---

## Log Retention Strategy

| Log Type | Retention | Rationale | Storage |
|----------|----------|-----------|---------|
| Relay access logs | 7 days | High volume; useful for immediate debugging only | Hot storage |
| Processing worker logs | 14 days | Needed for investigating recent symbolication/fingerprinting issues | Hot storage |
| Alert engine logs | 30 days | Required for alert audit trail | Warm storage |
| API access logs | 90 days | Security audit compliance | Cold storage |
| Authentication logs | 1 year | SOC 2 / compliance requirement | Cold storage |
| Source map upload/download audit | 1 year | Security-critical IP protection | Cold storage |

---

## Trace Sampling Strategy

| Trace Type | Sampling Rate | Rationale |
|-----------|-------------|-----------|
| Successful event processing (normal) | 1% | High volume; rare issues; sampled for baseline |
| Failed event processing | 100% | Every failure needs investigation |
| Symbolication (cache miss) | 100% | Performance-critical path; rare enough to trace fully |
| Symbolication (cache hit) | 10% | Moderate volume; sample for latency distribution |
| Alert evaluation + delivery | 100% | Low volume; critical path; always trace |
| API requests (management) | 10% | Moderate volume; sample for latency monitoring |

---

## Performance Regression Detection

### Automated Detection Algorithm

```
FUNCTION detect_performance_regression():
    // Compare current 1-hour window to same hour last week
    FOR metric IN [processing_latency_p99, symbolication_latency_p99,
                   fingerprint_cache_hit_rate, consumer_lag]:
        current = get_metric(metric, window=1h)
        baseline = get_metric(metric, window=1h, offset=7d)

        // Z-score based detection
        mean = baseline.mean()
        stddev = baseline.stddev()
        z_score = (current.mean() - mean) / stddev

        IF z_score > 3.0:  // 3 sigma deviation
            correlate_with_deployments(metric, window=2h)
            alert("Performance regression detected",
                  metric=metric,
                  current=current.mean(),
                  baseline=mean,
                  z_score=z_score)
```

### Correlation Sources

| Dimension | Source | Correlation Question |
|-----------|--------|---------------------|
| Deployment | Internal deployment log | Did a service deploy in the last 2 hours? |
| Traffic shape | `relay.events.accepted` trend | Is this a traffic-driven regression or processing-driven? |
| Event complexity | Average stack frame count | Are events becoming more complex (more frames to process)? |
| Cache state | Cache hit rates across layers | Did a cache flush or expiration event coincide? |
| Infrastructure | Node health, disk I/O, network | Is the regression correlated with infrastructure changes? |

---

## Cost Observability

### Per-Project Cost Attribution

Understanding the cost of each project enables accurate billing and identifies cost optimization opportunities:

| Cost Component | Attribution Method | Dashboard Panel |
|---------------|-------------------|----------------|
| Ingestion | Events accepted × per-event relay cost | Top 10 projects by ingestion cost |
| Processing | Events processed × per-event worker cost (weighted by symbolication) | Processing cost by project + platform |
| Storage (columnar) | Data bytes stored × per-GB storage cost × retention days | Storage cost by project with retention breakdown |
| Storage (source maps) | Source map bytes × per-GB cost × retention | Source map storage cost by release |
| Cache | Proportional allocation based on key count per project | Cache cost by project (allocated) |
| Alerting | Alerts delivered × per-alert notification cost | Alert delivery cost by project + channel |

### Cost Anomaly Detection

| Anomaly | Detection | Action |
|---------|----------|--------|
| Project cost 10x week-over-week | Automated comparison of weekly cost per project | Notify project admin; suggest quota adjustment |
| Source map storage growing without corresponding events | Source map upload count vs. event count divergence | Suggest source map retention cleanup |
| Symbolic cache miss rate driving compute cost | `symbolication.cache.miss_rate` × parsing cost | Increase cache size or pre-warm on upload |

---

## Data Freshness Monitoring

### End-to-End Latency Tracking

The platform must track how long it takes from error occurrence to developer visibility:

| Checkpoint | Metric | Target | Measurement |
|-----------|--------|--------|-------------|
| Error occurs → SDK captures | `sdk.capture_latency` | <5ms | SDK-side measurement; reported in envelope metadata |
| SDK captures → Relay accepts | `transport.latency` | <50ms (same region) | Timestamp delta: relay received_at - event created_at |
| Relay accepts → Bus published | `relay.publish_latency` | <10ms | Relay internal timing |
| Bus published → Worker consumes | `bus.consumer_latency` | <500ms (normal), <30s (spike) | Consumer lag metric |
| Worker consumes → Processing complete | `processing.total_latency` | <2s (cache hit), <15s (cache miss) | Worker span timing |
| Processing complete → Searchable in UI | `store.indexing_latency` | <1s | Query for event after write |
| **Total end-to-end** | `e2e.latency` | **<5s (p50), <30s (p99)** | Synthetic test events |

### Synthetic Monitoring

Deploy synthetic test events every 60 seconds from canary SDKs in each region:

```
Canary event properties:
  - Known fingerprint (maps to a canary issue)
  - Known release + source map (validates symbolication)
  - Known user context (validates PII scrubbing)
  - Timestamp of generation (measures end-to-end latency)

Canary checks:
  1. Event appears in columnar store within 30s
  2. Event is correctly symbolicated
  3. Event is assigned to the correct canary issue
  4. PII fields are properly scrubbed
  5. No alert fires (canary issue is excluded from alert rules)
```

---

## Capacity Planning Metrics

| Metric | Formula | Alert Threshold | Action |
|--------|---------|----------------|--------|
| Bus partition fill rate | `bytes_in_per_sec / max_partition_bandwidth` | >70% sustained | Add partitions or increase retention |
| ClickHouse parts per partition | `system.parts` query | >80% of `max_parts_count_for_partition` | Investigate write pattern; increase merge threads |
| PostgreSQL connection utilization | `active_connections / max_connections` | >80% | Scale PgBouncer pool; add read replicas |
| Redis memory utilization | `used_memory / maxmemory` | >85% | Increase memory; review TTL policies |
| Symbolicator memory per node | `process_resident_memory` | >80% of allocation | Reduce concurrent parsing; increase memory |
| Object storage request rate | `requests_per_second` per prefix | >5,000 (object storage throttling) | Add prefix sharding; CDN for reads |

---

## Release Impact Observability

### Release Comparison Dashboard

When a new release is deployed, operators and developers need to quickly assess its impact:

| Panel | Metric | Comparison |
|-------|--------|-----------|
| Error rate delta | `events/min` for new release vs. previous release | Percentage increase/decrease with confidence interval |
| New issues introduced | Issues with `first_release = current_release` | Count and severity breakdown |
| Regressions detected | Issues where `is_regression = true AND last_release = current_release` | List with link to original resolution |
| Crash-free session rate | `crash_free_sessions(current)` vs. `crash_free_sessions(previous)` | Delta with statistical significance |
| Top issues | Top 5 issues by event count in the new release | With sparkline showing whether trending up or stabilizing |

### Deploy Marker Integration

Processing events are correlated with deployment timestamps to provide visual deploy markers on all time-series dashboards:

```
Deploy markers source:
  1. Release API call (POST /releases/) records deploy_time
  2. CI/CD webhook integration pushes deploy events
  3. Inferred from first event with a new release tag

Dashboard rendering:
  - Vertical line at deploy_time on all time-series charts
  - Hover tooltip shows: release version, deployer, commit range
  - Click opens release detail page with error comparison
```

---

## Meta-Monitoring: Monitoring the Error Tracker

The error tracking platform itself needs monitoring — but cannot rely on itself for error reporting (circular dependency). Meta-monitoring uses a separate, simpler observability stack:

| Aspect | Internal Platform | Meta-Monitoring (External) |
|--------|------------------|---------------------------|
| Error reporting | Sentry SDKs in platform services | Lightweight log-based error detection |
| Metrics | Platform's own metric pipeline | Independent metric collection (Prometheus/Datadog) |
| Alerting | Platform's alert engine | Independent alerting (PagerDuty direct integration) |
| Dashboard | Platform's internal dashboards | Separate Grafana instance |
| Health checks | Application-level health endpoints | External synthetic monitoring (uptime checker) |

**Golden signals for meta-monitoring:**

| Signal | Metric | External Check |
|--------|--------|---------------|
| **Latency** | Relay p99 response time | Synthetic event submission every 30s |
| **Traffic** | Events accepted/sec | Compare with historical baseline |
| **Errors** | 5xx rate on relay endpoints | External HTTP probe |
| **Saturation** | Bus consumer lag; DB connections; cache memory | Infrastructure metrics via separate collection agent |
