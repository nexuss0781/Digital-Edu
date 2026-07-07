# Observability --- Time-Series Database

## The Meta-Monitoring Challenge

A TSDB that stores metrics must itself be monitored---creating a circular dependency. If the TSDB's ingestion pipeline is overloaded, the metrics that would tell you about the overload are the ones being dropped. The solution is a lightweight, independent meta-monitoring stack that observes the TSDB's internal health without depending on the TSDB itself.

### Meta-Monitoring Architecture

```
Primary TSDB Cluster                    Meta-Monitoring Stack
┌─────────────────────┐                ┌──────────────────────────┐
│ Ingester → emits    │───scrape───>   │ Lightweight single-node  │
│   internal metrics  │                │ TSDB (~100 fixed series) │
│ Query Engine → emits│───scrape───>   │                          │
│   internal metrics  │                │ Direct HTTP alerting     │
│ Compactor → emits   │───scrape───>   │ (bypasses alert manager) │
│   internal metrics  │                │                          │
│ WAL → emits health  │───scrape───>   │ Fixed cardinality:       │
│   signals           │                │ no user-defined metrics  │
└─────────────────────┘                └──────────────────────────┘

Key principle: Meta-monitoring system MUST have a different failure domain.
  - Single process (no distributed coordination)
  - Fixed cardinality (no cardinality explosion risk)
  - Local disk storage (no object storage dependency)
  - Direct notification (no alert manager pipeline)
```

---

## Metrics (USE/RED)

### Ingestion Path Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `tsdb_samples_ingested_total` | Counter | Total samples ingested (by tenant, success/failure) | Rate drop > 50% for 5 min |
| `tsdb_samples_rejected_total` | Counter | Samples rejected (by reason: rate_limit, cardinality, validation) | Rate > 1% of ingested for 5 min |
| `tsdb_active_series` | Gauge | Current number of active series (by tenant) | > 80% of tenant limit |
| `tsdb_series_created_total` | Counter | New series creation rate (by tenant) | Rate > 1000/s for 1 min (cardinality alarm) |
| `tsdb_wal_write_duration_seconds` | Histogram | WAL append latency | p99 > 50 ms |
| `tsdb_wal_segment_size_bytes` | Gauge | Current WAL segment size | > 256 MB (close to rotation threshold) |
| `tsdb_head_block_series` | Gauge | Series count in head block | > 80% of memory budget |
| `tsdb_head_block_memory_bytes` | Gauge | Head block memory consumption | > 80% of allocated memory |
| `tsdb_ooo_samples_total` | Counter | Out-of-order samples received | Rate > 5% of total ingestion |
| `tsdb_ooo_rejected_total` | Counter | OOO samples rejected (outside window) | Any sustained rate |
| `tsdb_ingestion_rate_samples_per_second` | Gauge | Current ingestion rate per ingester | > 90% of capacity |

### Storage Path Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `tsdb_blocks_total` | Gauge | Number of blocks (by level, resolution) | Level 0 blocks > 50 (compaction falling behind) |
| `tsdb_compaction_duration_seconds` | Histogram | Time to complete a compaction job | p99 > 30 min |
| `tsdb_compaction_pending_jobs` | Gauge | Compaction jobs waiting in queue | > 100 for 15 min |
| `tsdb_compaction_failures_total` | Counter | Failed compaction attempts | Any failure |
| `tsdb_block_upload_duration_seconds` | Histogram | Time to upload block to object storage | p99 > 5 min |
| `tsdb_disk_usage_bytes` | Gauge | Local disk usage (by component: WAL, blocks, cache) | > 80% of disk capacity |
| `tsdb_object_storage_bytes` | Gauge | Object storage usage (by tenant, resolution tier) | Unexpected growth > 20%/day |
| `tsdb_downsampling_lag_seconds` | Gauge | Time since oldest un-downsampled block | > 6 hours |
| `tsdb_chunk_compression_ratio` | Gauge | Average bytes per sample (by metric type) | > 3.0 (degraded compression) |

### Query Path Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `tsdb_query_duration_seconds` | Histogram | Query execution time (by type: instant/range) | p99 > 5s |
| `tsdb_query_samples_scanned` | Histogram | Samples decompressed per query | p99 > 10M (expensive query) |
| `tsdb_query_series_matched` | Histogram | Series matched by inverted index per query | p99 > 100K |
| `tsdb_query_failures_total` | Counter | Failed queries (by reason: timeout, OOM, error) | Rate > 1% |
| `tsdb_query_cache_hit_ratio` | Gauge | Query result cache hit rate | < 30% (cache ineffective) |
| `tsdb_query_concurrent` | Gauge | Currently executing queries | > 80% of concurrency limit |
| `tsdb_query_queue_depth` | Gauge | Queries waiting for execution slot | > 50 for 3 min |

---

## Logging

### What to Log

| Event | Log Level | Content | Retention |
|---|---|---|---|
| Ingestion batch received | DEBUG | Tenant, sample count, series count, batch size | 24 hours |
| Series creation | INFO | Tenant, metric name, label set, series ID | 7 days |
| Cardinality limit hit | WARN | Tenant, metric name, current count, limit | 30 days |
| WAL segment rotation | INFO | Segment number, size, duration | 7 days |
| Block flush (head → disk) | INFO | Block ID, time range, series count, samples, size | 30 days |
| Compaction completed | INFO | Source blocks, merged block ID, duration, size reduction | 30 days |
| Compaction failed | ERROR | Source blocks, error, stack trace | 90 days |
| Query executed | INFO | Tenant, query text (scrubbed), duration, samples scanned, series matched | 7 days |
| Query timeout/OOM | WARN | Tenant, query text, resource usage at failure | 30 days |
| OOO sample received | DEBUG | Series ID, expected timestamp, actual timestamp, delta | 24 hours |
| Tenant rate limited | WARN | Tenant, limit type, current rate, limit value | 30 days |

### Structured Logging Format

```
{
  "timestamp": "2026-03-10T14:30:00.123Z",
  "level": "WARN",
  "component": "ingester",
  "event": "cardinality_limit_hit",
  "tenant_id": "tenant-abc",
  "metric_name": "http_requests_total",
  "current_series_count": 50000,
  "series_limit": 50000,
  "rejected_label_set": {"method": "GET", "user_id": "u-12345"},
  "trace_id": "abc123def456"
}
```

---

## Distributed Tracing

### Key Spans to Instrument

| Span | Parent | Attributes |
|---|---|---|
| `ingestion.gateway.receive` | Root | tenant_id, batch_size, sample_count |
| `ingestion.validate` | gateway.receive | validation_errors, label_count |
| `ingestion.distribute` | gateway.receive | target_ingester, series_count |
| `ingestion.wal_append` | distribute | segment_number, bytes_written |
| `ingestion.head_append` | distribute | series_id, is_ooo |
| `query.frontend.receive` | Root | tenant_id, query_text, time_range |
| `query.frontend.cache_check` | frontend.receive | cache_hit, cache_key |
| `query.frontend.split` | frontend.receive | sub_query_count |
| `query.engine.resolve_series` | frontend.split | matcher_count, series_matched |
| `query.engine.fetch_chunks` | engine.resolve_series | chunk_count, bytes_read, source (head/disk/object) |
| `query.engine.decompress` | engine.fetch_chunks | samples_decompressed, compression_ratio |
| `query.engine.aggregate` | engine.decompress | aggregation_op, result_series_count |
| `compaction.plan` | Root | block_count, target_level |
| `compaction.merge` | plan | series_merged, samples_merged |
| `compaction.upload` | merge | block_size, upload_duration |

### Trace Sampling Strategy

```
Sampling rules:
  - 100% of failed operations (ingestion errors, query timeouts, compaction failures)
  - 100% of slow operations (write > 50ms, query > 5s, compaction > 30min)
  - 1% of successful ingestion batches (high volume, low diagnostic value)
  - 10% of successful queries (moderate volume, useful for performance analysis)
  - 100% of compaction jobs (low volume, high diagnostic value)
```

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Severity | Runbook |
|---|---|---|---|
| `TSDBIngestionDown` | No samples ingested for any tenant for > 5 min | P1 | Check ingestion gateway health, ingester ring status, WAL disk space |
| `TSDBWALCorruption` | WAL checksum validation failure | P1 | Stop ingester; assess data loss; restore from replica; investigate root cause |
| `TSDBIngesterOOM` | Ingester memory > 95% of limit | P1 | Check cardinality spike; reduce head block window; restart if needed |
| `TSDBCompactionCriticallyBehind` | > 500 pending Level 0 blocks for > 1 hour | P1 | Scale compactor workers; check disk space; investigate slow compaction jobs |
| `TSDBDataLoss` | Acknowledged samples not queryable after 1 hour | P1 | Check WAL integrity; verify block uploads; check replication status |
| `TSDBQueryEngineDown` | All query engine instances failing health checks | P1 | Check memory; restart pods; verify block index cache health |

### Warning Alerts

| Alert | Condition | Severity | Runbook |
|---|---|---|---|
| `TSDBCardinalitySpike` | New series creation rate > 5x normal for tenant for > 10 min | P3 | Identify source metric/label; contact tenant; apply temporary cardinality cap |
| `TSDBCompressionDegraded` | Average bytes/sample > 3.0 (expected ~1.4) for > 1 hour | P3 | Investigate metric types; check for irregular timestamp intervals; review data sources |
| `TSDBQueryLatencyHigh` | Query p99 > 10s for > 15 min | P3 | Check query load; review slow query log; add recording rules for hot queries |
| `TSDBDiskUsageHigh` | Local disk > 80% capacity | P3 | Verify compaction running; check retention enforcement; expand storage |
| `TSDBReplicationLag` | Ingester replication lag > 30s for > 5 min | P3 | Check network between ingesters; verify WAL shipping; investigate slow replicas |
| `TSDBOOORateHigh` | OOO samples > 10% of total ingestion for > 15 min | P4 | Check agent clock sync; review push-based source configurations |
| `TSDBCacheHitRateLow` | Query cache hit rate < 20% for > 30 min | P4 | Review cache size; check for query pattern changes; verify step alignment |

### Runbook Structure

```
Each runbook follows this structure:

1. SYMPTOMS
   What alerts fired? What user impact is observed?

2. DIAGNOSIS
   Step-by-step commands to identify root cause:
   - Check tsdb_active_series for cardinality spike
   - Check tsdb_head_block_memory_bytes for memory pressure
   - Check tsdb_compaction_pending_jobs for compaction backlog
   - Check tsdb_wal_segment_size_bytes for WAL backup

3. IMMEDIATE MITIGATION
   Actions to restore service while investigating root cause:
   - Reduce OOO window to free memory
   - Apply emergency cardinality cap on offending tenant
   - Restart ingester with larger memory limit
   - Manually trigger compaction

4. ROOT CAUSE INVESTIGATION
   How to find and fix the underlying issue

5. PREVENTION
   What monitoring, limits, or architectural changes prevent recurrence
```

---

## Incident Detection Playbooks

### Playbook 1: Cardinality Explosion (P1)

**Trigger:** `tsdb.active_series` increases > 50% in 30 minutes OR `tsdb.series_creation_rate` > 10K/min sustained 5 minutes.

```
STEP 1: Identify the source of new series
  → Query: top 10 metrics by series creation rate in last 30 min
  → Query: top 10 label names by unique value count increase
  → Usually reveals a single metric with a new unbounded label

STEP 2: Immediate mitigation
  → Apply emergency per-metric cardinality cap on the offending metric
  → IF tenant is identifiable: apply tenant-level series cap reduction
  → IF ingester memory > 85%: reject ALL new series creation (allow only existing series)

STEP 3: Root cause
  → Contact the team that owns the metric
  → Common causes: (a) added request_id/trace_id as label, (b) deployment added
    per-pod labels to a previously aggregated metric, (c) A/B test variant IDs as labels
  → Fix: remove unbounded label at the source; use exemplars instead for trace linkage

STEP 4: Recovery
  → After source fix: wait for stale series to expire (2x scrape interval)
  → Monitor series count: should decline to pre-incident baseline
  → If memory doesn't recover: restart ingester (stale series may not be evicted until restart)
```

### Playbook 2: Compaction Backlog (P2)

**Trigger:** `tsdb.compaction_pending_jobs` > 0 for > 4 hours OR block count per time range > 10.

```
STEP 1: Assess impact
  → Check query latency: degraded (more blocks to scan) but queries still work
  → Check disk usage: blocks accumulate, disk usage grows faster than expected
  → Check compaction duration histogram: identify if specific blocks are slow

STEP 2: Diagnose root cause
  → CPU contention: compaction shares CPU with ingestion and queries
  → I/O contention: compaction reads/writes large blocks, saturating disk bandwidth
  → Large blocks: blocks with high series count take longer to compact
  → Tombstone-heavy blocks: blocks with many tombstones have expensive compaction

STEP 3: Mitigation
  → IF CPU-bound: move compaction to dedicated nodes (disaggregated architecture)
  → IF I/O-bound: rate-limit compaction I/O via cgroup; prioritize recent blocks
  → IF specific slow blocks: skip compaction for blocks near retention expiry
  → Manually trigger compaction during off-peak hours

STEP 4: Prevention
  → Set up auto-scaling for compaction workers based on pending job count
  → Alert at 2 hours of backlog (before it becomes a problem)
  → Consider separate storage for high-write-rate tenants
```

### Playbook 3: Head Block Memory Pressure (P1)

**Trigger:** `tsdb.head_block_memory_bytes` > 80% of ingester heap OR GC pause > 500ms.

```
STEP 1: Immediate triage
  → Check `tsdb.active_series`: has series count grown unexpectedly?
  → Check OOO buffer: is the OOO window too large, buffering too many samples?
  → Check if head block flush is stalled: is the double-buffer swap failing?

STEP 2: Mitigation
  → Reduce OOO acceptance window (from 30 min to 5 min) to free OOO buffer memory
  → Force head block flush: trigger immediate compaction of current head block
  → IF cardinality spike: apply emergency cardinality cap (see Playbook 1)
  → IF GC pressure: increase heap size temporarily; plan for horizontal scaling

STEP 3: Prevention
  → Set head block memory alerts at 60% and 80% of heap
  → Enforce series creation rate limits per tenant
  → Consider shorter head block window (1 hour instead of 2) to reduce memory
```

---

## Observability Anti-Patterns

| Anti-Pattern | Why It's Harmful | Better Approach |
|-------------|------------------|-----------------|
| **Monitoring the TSDB with itself** | Circular dependency: if TSDB is down, its own health metrics disappear | Use a small, independent meta-TSDB instance in a separate failure domain |
| **Alerting on absolute series count** | Series count varies with deployments, scaling events; absolute thresholds cause noise | Alert on rate of change (series creation rate) and deviation from baseline |
| **Ignoring compression ratio changes** | Compression degradation silently increases storage costs without visible errors | Monitor compression ratio per metric type; alert on sustained drops below 4x |
| **Treating compaction as optional** | Compaction backlog degrades queries, delays tombstone enforcement, grows disk usage | Monitor compaction pending jobs as a critical metric, not just a performance metric |
| **No per-tenant observability** | One tenant's cardinality explosion hidden in aggregate metrics | Per-tenant dashboards: series count, ingestion rate, query load, compression ratio |
| **Sampling meta-monitoring metrics** | TSDB health metrics are low-volume; sampling loses critical precision | Ingest all meta-metrics at full resolution (< 1000 series for the meta-monitor) |

---

## SLO Dashboard: Pipeline Health Score

```
FUNCTION calculate_tsdb_health_score(metrics):
    scores = {
        ingestion_health: IF metrics.ingestion_error_rate < 0.001 THEN 1.0
                          ELIF metrics.ingestion_error_rate < 0.01 THEN 0.7
                          ELSE 0.3,

        query_health: IF metrics.query_p99_latency < 3000 THEN 1.0
                      ELIF metrics.query_p99_latency < 8000 THEN 0.6
                      ELSE 0.2,

        compaction_health: IF metrics.compaction_pending_hours < 2 THEN 1.0
                          ELIF metrics.compaction_pending_hours < 6 THEN 0.5
                          ELSE 0.1,

        memory_health: IF metrics.head_memory_pct < 60 THEN 1.0
                       ELIF metrics.head_memory_pct < 80 THEN 0.5
                       ELSE 0.1,

        cardinality_health: IF metrics.series_creation_rate < 100 THEN 1.0
                           ELIF metrics.series_creation_rate < 1000 THEN 0.6
                           ELSE 0.2
    }

    weights = {ingestion: 0.30, query: 0.25, compaction: 0.20,
               memory: 0.15, cardinality: 0.10}
    health = sum(scores[k] * weights[k] for k in scores)

    RETURN {score: health, grade: "A" if health > 0.9 else "B" if health > 0.7
            else "C" if health > 0.5 else "F"}
```

---

## SLO Error Budget Tracking

```
SLO: Ingestion Availability = 99.95%
  - Monthly budget: 43,200 minutes × 0.0005 = 21.6 minutes of downtime
  - Budget consumed: COUNT(1-minute windows with ingestion_error_rate > 0.1%)
  - Remaining: 21.6 - consumed
  - Burn rate: consumed / elapsed_minutes_in_month × total_minutes_in_month / 21.6

SLO: Query Success Rate = 99.9%
  - Monthly budget: total_queries × 0.001 = allowed failures
  - Budget consumed: COUNT(failed queries)
  - Burn rate alert: IF consumed > 14.4x normal rate for 1 hour → PAGE

SLO: Ingestion Freshness = < 15 seconds
  - Measured: p99 of (query_time - sample_timestamp) for most recent sample per series
  - Budget: 0.1% of minutes where p99 freshness > 15s
  - Leading indicator: head block refresh latency trending upward

Error Budget Policy:
  IF budget_remaining < 25%:
    → Freeze non-critical deployments
    → Prioritize reliability work over feature work
    → Review recent changes for regression
  IF budget_remaining < 10%:
    → Halt all deployments
    → Page engineering lead
    → Begin incident review process
  IF budget_exhausted:
    → Automatic rollback of most recent deployment
    → Full incident postmortem required before resuming changes
```

---

## SLO Dashboard Design

```
╔═══════════════════════════════════════════════════════════════╗
║  TSDB Platform Health Dashboard                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  ┌─ Ingestion ─────────┐  ┌─ Queries ──────────┐            ║
║  │ Rate: 1.67M sam/s   │  │ QPS: 245           │            ║
║  │ Errors: 0.003%  ✓   │  │ p99: 1.2s      ✓   │            ║
║  │ Freshness: 4s   ✓   │  │ Success: 99.97% ✓  │            ║
║  │ Budget: 87%  ████░  │  │ Budget: 92%  █████░ │            ║
║  └─────────────────────┘  └─────────────────────┘            ║
║                                                               ║
║  ┌─ Storage ───────────┐  ┌─ Cardinality ───────┐            ║
║  │ Active Series: 24.8M│  │ Creation: 85/s  ✓   │            ║
║  │ Head Memory: 62% ██░│  │ Top Churn Metric:   │            ║
║  │ Compaction: OK   ✓  │  │  k8s_pod_cpu (12K)  │            ║
║  │ Disk: 45%     ██░   │  │ Tenants near cap: 2 │            ║
║  └─────────────────────┘  └─────────────────────┘            ║
║                                                               ║
║  ┌─ Top 5 Tenants by Series ──────────────────────┐          ║
║  │ tenant-prod    : 12.4M (62%)  ███████████████░  │          ║
║  │ tenant-staging :  4.1M (16%)  ████░              │          ║
║  │ tenant-dev     :  3.2M (13%)  ███░               │          ║
║  │ tenant-qa      :  1.8M  (7%)  ██░                │          ║
║  │ tenant-sandbox :  0.3M  (1%)  ░                  │          ║
║  └────────────────────────────────────────────────────┘       ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## Golden Signals per Component

| Component | Latency | Traffic | Errors | Saturation |
|-----------|---------|---------|--------|------------|
| **Ingestion Gateway** | Batch processing time (p99) | Batches/sec, samples/sec | 4xx rate (auth failures, validation), 5xx rate | Connection pool utilization, request queue depth |
| **Distributor** | Hash ring lookup + forwarding time | Series/sec routed, batches forwarded | Ring lookup failures, forwarding timeouts | Ring membership stability, forwarding queue depth |
| **Ingester** | WAL append time, head block append time | Samples/sec appended, series creation/sec | WAL write failures, OOO rejections | Head block memory %, WAL disk %, active series vs. limit |
| **Compactor** | Compaction job duration (p99) | Blocks compacted/hour, bytes processed | Compaction failures, checksum errors | Pending job count, disk I/O utilization |
| **Query Engine** | Query execution time (p50, p99) | QPS (instant + range), samples scanned | Timeouts, OOM kills, partial results | Concurrent query count vs. limit, memory utilization |
| **Object Storage** | First-byte latency, upload duration | GET/PUT requests/sec, bytes transferred | 5xx errors, throttling (429) | Bandwidth utilization, request rate vs. limits |

---

## Anomaly Detection Rules

```
// Rule 1: Series creation rate anomaly
ALERT TSDBSeriesCreationAnomaly
  IF tsdb_series_created_rate_5m > 3 * avg_over_time(tsdb_series_created_rate_5m[7d])
  FOR 10 minutes
  SEVERITY warning
  ANNOTATION "Series creation rate is 3x above 7-day average — possible cardinality incident"

// Rule 2: Compression ratio degradation
ALERT TSDBCompressionDegraded
  IF tsdb_chunk_compression_ratio > 3.0  // expected ~1.37
  FOR 1 hour
  SEVERITY warning
  ANNOTATION "Compression ratio degraded — investigate irregular timestamp or volatile data sources"

// Rule 3: Query fan-out explosion
ALERT TSDBQueryFanoutExplosion
  IF tsdb_query_series_matched_p99 > 10 * avg_over_time(tsdb_query_series_matched_p99[7d])
  FOR 5 minutes
  SEVERITY critical
  ANNOTATION "Query fan-out 10x above normal — possible query-of-death or cardinality spike"

// Rule 4: WAL growth rate anomaly
ALERT TSDBWALGrowthAnomaly
  IF rate(tsdb_wal_segment_size_bytes[15m]) > 2 * rate(tsdb_wal_segment_size_bytes[6h])
  FOR 15 minutes
  SEVERITY warning
  ANNOTATION "WAL growth accelerating — check for ingestion spike or checkpoint stall"

// Rule 5: Ingestion-query latency correlation
ALERT TSDBCrossPathContention
  IF (tsdb_wal_write_duration_seconds_p99 > 2 * baseline)
     AND (tsdb_query_duration_seconds_p99 > 2 * baseline)
  FOR 10 minutes
  SEVERITY critical
  ANNOTATION "Both write and query latency degraded simultaneously — likely resource contention (disk I/O, CPU)"
```

---

## End-to-End Consistency Auditing

```
FUNCTION audit_data_consistency(tenant_id, time_range):
    // Verify that all acknowledged writes are queryable

    // Step 1: Count samples in WAL for tenant within time range
    wal_count = count_wal_samples(tenant_id, time_range)

    // Step 2: Count samples in head block + compacted blocks + object storage
    queryable_count = execute_query(
        "count(count_over_time({__tenant__='{tenant_id}'}[time_range]))"
    )

    // Step 3: Compare (accounting for replication dedup)
    discrepancy = abs(wal_count - queryable_count)
    discrepancy_pct = discrepancy / wal_count * 100

    IF discrepancy_pct > 0.01:  // > 0.01% discrepancy
        alert("data consistency audit failed",
              tenant=tenant_id, wal=wal_count, queryable=queryable_count,
              discrepancy_pct=discrepancy_pct)

    // Step 4: Verify block coverage (no time gaps)
    blocks = list_blocks(tenant_id, time_range)
    gaps = find_time_gaps(blocks, expected_interval=2h)
    IF gaps:
        alert("block coverage gap detected", tenant=tenant_id, gaps=gaps)

    RETURN {wal_count, queryable_count, discrepancy_pct, gaps}
