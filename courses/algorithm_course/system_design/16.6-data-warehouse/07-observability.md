# Observability — Data Warehouse

## Metrics (USE/RED Framework)

### Query Engine Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `query.latency.p50` | Histogram | Median query execution time | > 5s for simple queries |
| `query.latency.p99` | Histogram | 99th percentile query execution time | > 60s for any query |
| `query.throughput` | Counter | Queries completed per second | < 10 QPS during business hours |
| `query.error_rate` | Gauge | Percentage of queries returning errors | > 1% |
| `query.compilation_time` | Histogram | SQL → execution plan compilation time | > 2s (p99) |
| `query.queue_time` | Histogram | Time waiting for available compute | > 5s (p95) |
| `query.queue_depth` | Gauge | Number of queries waiting for compute | > 50 |
| `query.concurrent_active` | Gauge | Currently executing queries | Informational |

### Compute Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `warehouse.cpu_utilization` | Gauge | Average CPU utilization across warehouse nodes | > 85% sustained 10 min |
| `warehouse.memory_utilization` | Gauge | Average memory utilization | > 90% |
| `warehouse.node_count` | Gauge | Active compute nodes | Informational |
| `warehouse.cluster_count` | Gauge | Active compute clusters (multi-cluster) | Informational |
| `warehouse.spill_to_disk_bytes` | Counter | Bytes spilled to local disk during execution | > 10 GB per query |
| `warehouse.spill_ratio` | Gauge | Spill bytes / total bytes processed | > 20% |
| `warehouse.idle_time` | Counter | Seconds warehouse is running with no queries | > auto-suspend timeout |

### Storage Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `storage.total_bytes` | Gauge | Total compressed data in object storage | Informational (cost tracking) |
| `storage.time_travel_bytes` | Gauge | Storage used by time travel snapshots | > 2x active data size |
| `storage.partitions_total` | Gauge | Total micro-partitions across all tables | Informational |
| `storage.clustering_depth` | Gauge | Average clustering depth for clustered tables | > 10 (indicates reclustering needed) |
| `storage.bytes_scanned` | Counter | Total bytes read from storage per hour | Informational (cost tracking) |

### Cache Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `cache.result_hit_ratio` | Gauge | Percentage of queries served from result cache | < 10% (check cache invalidation) |
| `cache.ssd_hit_ratio` | Gauge | Percentage of partition reads served from SSD | < 60% |
| `cache.ssd_utilization` | Gauge | SSD cache capacity utilization | > 95% (cache pressure) |
| `cache.eviction_rate` | Counter | Cache entries evicted per second | > 1000/s (thrashing) |
| `cache.metadata_hit_ratio` | Gauge | Metadata cache hit ratio | < 95% |

### Data Ingestion Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `ingestion.rows_loaded` | Counter | Rows loaded per minute | < expected baseline |
| `ingestion.bytes_loaded` | Counter | Compressed bytes loaded per minute | < expected baseline |
| `ingestion.load_latency` | Histogram | End-to-end load operation duration | > 5 min for micro-batch |
| `ingestion.error_count` | Counter | Rows/files rejected during load | > 0 (investigate data quality) |
| `ingestion.freshness_lag` | Gauge | Seconds since last successful load commit | > freshness SLO |

### Golden Signals Summary

| Signal | Primary Metric | Interpretation |
|--------|---------------|----------------|
| **Latency** | `query.latency.p99` | Measures user-perceived performance; split by query class (light/medium/heavy) |
| **Traffic** | `query.throughput` | Query volume; sudden drops indicate upstream failures; spikes may overwhelm compute |
| **Errors** | `query.error_rate` | Authorization failures, timeout, OOM; exclude client-side syntax errors |
| **Saturation** | `warehouse.cpu_utilization` + `warehouse.spill_ratio` | CPU > 85% or spill > 20% indicates insufficient resources |

### Cost-Specific Metrics (Unique to Data Warehouses)

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `cost.compute_credits_hourly` | Counter | Compute credits consumed per hour | > 2x daily average |
| `cost.bytes_scanned_hourly` | Counter | Total bytes scanned per hour | > 3x daily average |
| `cost.per_query_average` | Gauge | Average cost per query (compute time × rate) | Informational (trend tracking) |
| `cost.warehouse_idle_hours` | Counter | Hours warehouse running with < 5% utilization | > 4 hours/day |
| `cost.storage_time_travel` | Gauge | Storage consumed by time travel snapshots | > 2x active data |
| `cost.recluster_credits` | Counter | Credits consumed by automatic re-clustering | > 10% of query compute |

### Monitoring Anti-Patterns

| Anti-Pattern | Problem | Better Approach |
|-------------|---------|-----------------|
| Alerting on average latency | Hides tail latency spikes; 5% of slow queries go unnoticed | Alert on p99 latency by query class |
| Single dashboard for all warehouses | Different workloads have different baselines | Per-warehouse dashboards with workload-specific thresholds |
| Ignoring scan-to-return ratio | Missing the most actionable optimization signal | Track bytes_scanned / rows_returned; high ratio = missing filters or Cutting off unnecessary steps |
| No cost attribution | "Compute cost is high" is not actionable | Per-query, per-user, per-warehouse cost breakdown |
| Alerting on cache hit rate alone | Low cache hit may be expected for new query patterns | Combine cache hit rate with query latency impact |

---

## Dashboard Design

### Dashboard 1: Executive Overview

| Panel | Visualization | Data Source |
|-------|---------------|-------------|
| Query Success Rate | Single stat with threshold coloring | `query.error_rate` |
| Active Warehouses | Count badge | `warehouse.node_count` |
| Total Storage | Trend line (30 days) | `storage.total_bytes` |
| Daily Query Volume | Bar chart by hour | `query.throughput` |
| Cost Estimate (compute + storage) | Trend line with budget line | Derived from warehouse uptime + storage |
| Top 10 Slowest Queries | Table with user, SQL hash, duration | Query history |

### Dashboard 2: Query Performance

| Panel | Visualization | Data Source |
|-------|---------------|-------------|
| Query Latency Distribution | Histogram (p50, p95, p99) | `query.latency` |
| Queue Time Trend | Time series | `query.queue_time` |
| Queries by Status | Pie chart (running, queued, completed, failed) | Query history |
| Scan Efficiency | Scatter plot (bytes scanned vs. rows returned) | Per-query metadata |
| Partition Cutting off unnecessary steps Rate | Distribution histogram | `partitions_pruned / partitions_total` |
| Spill-to-Disk Events | Time series with threshold line | `warehouse.spill_to_disk_bytes` |

### Dashboard 3: Storage & Ingestion

| Panel | Visualization | Data Source |
|-------|---------------|-------------|
| Storage Growth Trend | Stacked area (active, time travel, staging) | `storage.*_bytes` |
| Clustering Health | Heatmap by table (depth as color) | `storage.clustering_depth` |
| Ingestion Throughput | Time series (rows/min, bytes/min) | `ingestion.*` |
| Data Freshness | Single stat per source | `ingestion.freshness_lag` |
| Load Errors | Bar chart by error type | `ingestion.error_count` |

### Dashboard 4: Cache & Cost

| Panel | Visualization | Data Source |
|-------|---------------|-------------|
| Cache Hit Ratios | Gauge (result, SSD, metadata) | `cache.*_hit_ratio` |
| SSD Cache Utilization | Time series per node | `cache.ssd_utilization` |
| Compute Credit Consumption | Stacked bar by warehouse | Warehouse uptime × size |
| Storage Cost Breakdown | Pie chart (active, time travel, staging) | Storage billing |
| Cost per Query (distribution) | Histogram | Derived: compute time × rate / query count |

---

## Logging

### What to Log

| Event Type | Log Level | Content |
|-----------|-----------|---------|
| Query submission | INFO | Query ID, user, SQL hash, warehouse, timestamp |
| Query completion | INFO | Query ID, duration, rows returned, bytes scanned, partitions pruned |
| Query failure | ERROR | Query ID, error code, error message, partial execution stats |
| Warehouse scaling | INFO | Warehouse ID, old size → new size, trigger reason |
| Data load | INFO | Load ID, table, files processed, rows loaded, duration |
| Load error | WARN | Load ID, file path, row number, error detail |
| Cache eviction | DEBUG | Cache type, key evicted, reason (LRU, invalidation) |
| Partition Cutting off unnecessary steps | DEBUG | Query ID, table, total partitions, pruned, scanned |

### Structured Log Format

```json
{
  "timestamp": "2025-03-15T14:30:22.456Z",
  "level": "INFO",
  "service": "query-engine",
  "node_id": "compute-07",
  "warehouse_id": "wh-bi-prod",
  "event": "query.completed",
  "query_id": "q-abc-123-def",
  "user": "analyst@company.com",
  "sql_hash": "sha256:a3f2b9c1...",
  "duration_ms": 2340,
  "rows_returned": 1247,
  "bytes_scanned": 720000000,
  "partitions_total": 12045,
  "partitions_scanned": 245,
  "partitions_pruned": 11800,
  "cache_hit": false,
  "spill_bytes": 0,
  "compilation_ms": 85
}
```

### Log Levels Strategy

| Level | When to Use | Volume |
|-------|-------------|--------|
| ERROR | Query failure, node crash, data corruption | Low |
| WARN | Load rejection, performance degradation, approaching limits | Low-Medium |
| INFO | Query lifecycle events, scaling events, load completions | Medium |
| DEBUG | Partition Cutting off unnecessary steps details, cache events, plan selection | High (sampling) |

---

## Query Profiling

### Query Profile Structure

Every completed query produces a detailed execution profile:

```
Query Profile: q-abc-123-def
├── Compilation: 85 ms
│   ├── Parsing: 12 ms
│   ├── Optimization: 68 ms (join reorder: 45 ms, MV matching: 23 ms)
│   └── Code generation: 5 ms
├── Execution: 2,255 ms
│   ├── Scan(sales): 1,200 ms
│   │   ├── Partitions: 245 scanned / 12,045 total (98% pruned)
│   │   ├── Bytes: 720 MB scanned / 45 GB total (98.4% pruned)
│   │   ├── Source: 30% SSD cache, 70% object storage
│   │   └── Decompression: 180 ms
│   ├── Filter(sale_date, region): 120 ms
│   │   └── Rows: 12M input → 1.2M output (90% filtered)
│   ├── HashJoin(sales ⟕ products): 450 ms
│   │   ├── Build side: products (50K rows, 4 MB)
│   │   ├── Probe side: 1.2M rows
│   │   ├── Strategy: broadcast join
│   │   └── Spill: none
│   ├── Aggregate(SUM, GROUP BY region): 350 ms
│   │   └── Groups: 1.2M input → 8 output
│   └── Sort(revenue DESC): 5 ms
│       └── Rows: 8
└── Result: 8 rows, 320 bytes
```

### Slow Query Analysis

Queries exceeding latency thresholds are automatically profiled with additional detail:

| Analysis | Details |
|----------|---------|
| **Partition Cutting off unnecessary steps effectiveness** | How many partitions were scanned vs. pruned; suggests clustering improvements |
| **Spill analysis** | Which operators spilled, how much, and whether a larger warehouse would eliminate spills |
| **Scan source breakdown** | SSD cache vs. object storage reads; identifies cache warming opportunities |
| **Join strategy evaluation** | Whether the optimizer chose the best join strategy; highlights potential hash table size issues |
| **Resource wait time** | Time spent waiting for compute, network, or I/O resources |

---

## Distributed Tracing

### Trace Propagation

Query traces span multiple components:

```
[Client] → [Cloud Services: parse, optimize] → [Workload Manager: route]
  → [Compute Node 1: scan partitions 1-100, filter, partial aggregate]
  → [Compute Node 2: scan partitions 101-200, filter, partial aggregate]
  → [Coordinator: merge aggregates, sort, return result]
```

### Spans to Instrument

| Span | Parent | Key Attributes |
|------|--------|----------------|
| `query.submission` | Root | user, sql_hash, warehouse_id |
| `query.compilation` | submission | parse_ms, optimize_ms, plan_cache_hit |
| `query.routing` | submission | warehouse_id, cluster_id, queue_wait_ms |
| `fragment.scan` | routing | node_id, partitions, bytes_scanned, cache_hit_ratio |
| `fragment.filter` | scan | rows_in, rows_out, selectivity |
| `fragment.join` | routing | strategy, build_size, probe_size, spill_bytes |
| `fragment.aggregate` | routing | groups_in, groups_out, partial_vs_final |
| `fragment.shuffle` | routing | bytes_transferred, target_nodes |
| `query.result` | submission | rows_returned, total_duration_ms |

---

## Alerting

### Critical Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| Query error rate spike | `query.error_rate > 5%` for 5 min | Page on-call; investigate metadata service and compute health |
| Warehouse unresponsive | No heartbeat from any node for 30s | Auto-restart warehouse; page if restart fails |
| Data freshness SLO breach | `ingestion.freshness_lag > SLO` for 15 min | Alert data engineering; check ETL pipeline |
| Storage approaching limit | `storage.total_bytes > 90% quota` | Alert account admin; review retention policies |
| Metadata store quorum loss | Less than 2 of 3 replicas healthy | Page infrastructure; all queries will fail soon |

### Warning Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| High query queue time | `query.queue_time.p95 > 10s` for 10 min | Consider adding compute clusters or scaling up |
| Spill-to-disk ratio elevated | `warehouse.spill_ratio > 20%` for 30 min | Consider larger warehouse size |
| SSD cache hit ratio low | `cache.ssd_hit_ratio < 50%` for 1 hour | Review query patterns; consider pre-warming |
| Clustering depth degraded | `storage.clustering_depth > 20` | Trigger re-clustering on affected tables |
| Abnormal scan volume | `storage.bytes_scanned > 3x daily average` | Investigate — possible runaway query or missing filters |

### Runbook References

| Alert | Runbook |
|-------|---------|
| Query error rate spike | Check metadata service health → check compute node status → review error codes in query log |
| Warehouse unresponsive | Verify network connectivity → check cloud provider status → force restart → provision replacement |
| Data freshness breach | Check ETL pipeline status → verify source system availability → check load error log |
| High spill ratio | Identify spilling queries → evaluate warehouse size → check for missing partition Cutting off unnecessary steps |
| Clustering degradation | Review clustering key effectiveness → evaluate table size → trigger manual recluster |

---

## SLO Dashboard (ASCII Mockup)

```
╔═══════════════════════════════════════════════════════════════════╗
║  DATA WAREHOUSE SLO DASHBOARD               Updated: 5 min ago  ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  AVAILABILITY     ████████████████████░  99.97%  Target: 99.95%  ║
║  QUERY p99 (BI)   ████████████████░░░░░  3.2s    Target: < 5s    ║
║  QUERY p99 (adhoc)█████████████████░░░░  22s     Target: < 30s   ║
║  DATA FRESHNESS   ████████████████████░  42s     Target: < 60s   ║
║  ERROR RATE       ████████████████████░  0.03%   Target: < 0.1%  ║
║                                                                   ║
║  ERROR BUDGET (30-day rolling):                                   ║
║  ├─ Availability:  74% remaining (19.7 min left of 26.3 min)     ║
║  ├─ BI Latency:    89% remaining                                  ║
║  ├─ Ad-hoc Latency: 65% remaining                                 ║
║  └─ Freshness:     92% remaining                                  ║
║                                                                   ║
║  TOP COST DRIVERS (today):                                        ║
║  ├─ warehouse_bi_prod:     1,240 credits (45%)                    ║
║  ├─ warehouse_etl:           820 credits (30%)                    ║
║  ├─ warehouse_adhoc:         450 credits (16%)                    ║
║  └─ warehouse_dev:           250 credits (9%)                     ║
║                                                                   ║
║  OPTIMIZATION OPPORTUNITIES:                                      ║
║  ├─ 3 tables with clustering depth > 20 (potential 5x savings)   ║
║  ├─ warehouse_dev idle 18h/day (auto-suspend recommended)        ║
║  └─ 12 queries scanning >1 TB without partition Cutting off unnecessary steps           ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### Error Budget Policy

```
FUNCTION evaluate_error_budget(slo_metrics, period=30_DAYS):
    budget_remaining = {}

    FOR EACH slo IN slo_metrics:
        total_budget = slo.target_error_rate * period.total_minutes
        consumed = count_violations(slo, period)
        remaining_pct = (total_budget - consumed) / total_budget * 100
        budget_remaining[slo.name] = remaining_pct

        IF remaining_pct < 10:
            // Critical: freeze all non-essential changes
            alert(CRITICAL, "SLO error budget nearly exhausted: " + slo.name)
            freeze_deployments(slo.affected_warehouses)

        ELSE IF remaining_pct < 25:
            // Warning: slow down changes
            alert(WARNING, "SLO error budget below 25%: " + slo.name)

    RETURN budget_remaining
```

---

## Operational Runbooks

### Runbook 1: High Query Latency Investigation

```
1. CHECK query profile for the slow query:
   - Is partition Cutting off unnecessary steps effective? (target > 95%)
   - Is there spill-to-disk? (should be 0 for normal queries)
   - What is the SSD cache hit ratio? (target > 80%)
   - Is there data skew in join/aggregation operators?

2. IF Cutting off unnecessary steps < 50%:
   - Check clustering depth for filtered columns
   - Consider adding or changing clustering keys
   - Verify predicates are sargable (no functions on columns)

3. IF spill > 0:
   - Compare estimated vs. actual cardinality at pipeline breakers
   - Consider scaling up warehouse (more memory per node)
   - Check for cross join or missing join predicate

4. IF cache hit < 50%:
   - Is this a new query pattern? (expected cold cache)
   - Is cache being thrashed by large scan queries?
   - Consider pre-warming cache with known hot queries

5. IF data skew detected:
   - Check join key cardinality distribution
   - Consider skew join hint or pre-aggregation
```

### Runbook 2: Cost Spike Investigation

```
1. IDENTIFY the source:
   - Which warehouse consumed the most credits?
   - Which user/role submitted the expensive queries?
   - What changed? (new queries, new data volume, configuration change)

2. ANALYZE top 10 most expensive queries:
   - Are they scanning more data than expected? (missing Cutting off unnecessary steps)
   - Are they running longer than expected? (spill, skew, stale MV)
   - Are they repeating unnecessarily? (missing result cache)

3. REMEDIATE:
   - Add/fix clustering keys for tables with poor Cutting off unnecessary steps
   - Create materialized views for repeated expensive patterns
   - Enable auto-suspend on idle warehouses
   - Set per-query resource limits (scan bytes, timeout)
   - Educate users on SELECT * vs. specific columns
```

### Runbook 3: Data Freshness SLO Breach

```
1. CHECK ingestion pipeline:
   - Is the source system available?
   - Is the CDC connector running?
   - Are there ingestion errors? (schema mismatch, data quality)

2. CHECK warehouse capacity:
   - Is the ETL warehouse suspended? (auto-resume may not trigger for background loads)
   - Is the loading queue backed up? (too many concurrent loads)

3. CHECK staging area:
   - Are files accumulating in the landing zone?
   - Is there a file format issue? (Parquet version mismatch, corrupt files)

4. REMEDIATE:
   - Restart failed CDC connector
   - Resume ETL warehouse if suspended
   - Skip bad files (with error logging) to unblock pipeline
   - Scale up ETL warehouse if loading is throughput-bound
```

---

## Dashboard 5: Security & Access

| Panel | Visualization | Data Source |
|-------|---------------|-------------|
| Authentication Failures | Time series by reason (bad password, expired token, IP blocked) | Audit log |
| RLS Policy Activations | Counter by table and policy | Query execution metadata |
| Data Masking Events | Counter by column and masking type | Query execution metadata |
| Privileged Access | Timeline of admin/break-glass actions | Audit log |
| Cross-Tenant Access Attempts | Alert list (should be zero) | RLS audit log |
| Data Download Volume | Time series by user (bytes downloaded) | Query result metadata |

### Dashboard 6: Ingestion Pipeline Health

| Panel | Visualization | Data Source |
|-------|---------------|-------------|
| Data Freshness per Source | Multi-line time series | `ingestion.freshness_lag` per source |
| Load Success Rate | Stacked bar (success, partial, failed) | Ingestion audit log |
| Schema Drift Events | Alert counter | Schema validation failures |
| Staging Area Size | Time series | Staging object storage metrics |
| Rows Loaded per Hour | Area chart by source system | `ingestion.rows_loaded` |
| Load Duration Distribution | Histogram | `ingestion.load_latency` |

---

## Data Quality Monitoring

| Check | Frequency | Method | Alert Condition |
|-------|-----------|--------|----------------|
| Row count anomaly | Per-load | Compare loaded rows vs. expected (±20% tolerance) | Count deviates > 20% from rolling average |
| Null rate spike | Per-load | Track null percentage per column | Null rate increases > 5% vs. 7-day average |
| Unique key violation | Per-load | Post-load distinct count vs. row count on key columns | Distinct count < row count |
| Schema drift | Per-load | Compare source schema with target schema | New columns, type changes, or dropped columns |
| Value distribution shift | Daily | Histogram comparison (KL divergence) | Distribution divergence exceeds threshold |
| Freshness violation | Continuous | Time since last successful load | Freshness > SLO target |

### Capacity Planning Metrics

| Metric | Frequency | Purpose |
|--------|-----------|---------|
| Storage growth rate (TB/month) | Weekly | Forecast storage costs; plan archival |
| Query volume trend (QPS) | Daily | Forecast compute capacity needs |
| Peak concurrent query trend | Weekly | Determine multi-cluster scaling needs |
| SSD cache hit rate trend | Weekly | Determine if cache is keeping up with working set growth |
| Partition count growth rate | Weekly | Forecast metadata service scaling needs |
| Re-clustering credits trend | Weekly | Determine if clustering keys are effective or over-aggressive |

### Health Check Endpoint

```
GET /api/v1/health

Response:
{
  "status": "healthy",
  "components": {
    "cloud_services": {"status": "healthy", "latency_ms": 2},
    "metadata_store": {
      "status": "healthy",
      "leader": "meta-node-1",
      "replication_lag_ms": 0,
      "version": 1523847
    },
    "result_cache": {"status": "healthy", "hit_ratio": 0.72},
    "warehouses": {
      "wh-bi-prod": {"status": "running", "nodes": 8, "active_queries": 12},
      "wh-etl": {"status": "suspended", "last_activity": "2025-03-15T08:45:00Z"},
      "wh-adhoc": {"status": "running", "nodes": 4, "active_queries": 3}
    },
    "ingestion": {
      "freshness_lag_seconds": 42,
      "last_load_status": "success",
      "pending_files": 0
    }
  },
  "timestamp": "2025-03-15T14:30:22Z"
}
```
