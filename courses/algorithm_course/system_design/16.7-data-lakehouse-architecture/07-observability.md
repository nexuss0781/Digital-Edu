# Observability — Data Lakehouse Architecture

## Metrics

### Storage & Metadata Metrics (USE Framework)

| Metric | Type | Description | Alert Threshold |
|:---|:---|:---|:---|
| `table.total_files` | Gauge | Total data files in current snapshot | > 10 M (metadata stress) |
| `table.total_size_bytes` | Gauge | Total data size on object storage | Informational |
| `partition.file_count` | Gauge | Files per partition | > 5 000 (small-file warning) |
| `partition.small_file_count` | Gauge | Files < 10 MB per partition | > 1 000 (compaction needed) |
| `partition.avg_file_size_mb` | Gauge | Average file size per partition | < 32 MB (trigger compaction) |
| `snapshot.count` | Gauge | Total snapshots retained | > 50 000 (expiration needed) |
| `snapshot.age_hours` | Gauge | Age of oldest retained snapshot | > retention_policy * 1.5 |
| `manifest.count` | Gauge | Total manifest files | > 100 K (manifest merging needed) |
| `manifest.total_size_mb` | Gauge | Total size of all manifest files | > 10 GB (planning overhead) |

### Query Engine Metrics (RED Framework)

| Metric | Type | Description | Alert Threshold |
|:---|:---|:---|:---|
| `query.rate` | Counter | Queries per second | Informational |
| `query.latency_p50_ms` | Histogram | Median query latency | > 3 000 ms |
| `query.latency_p99_ms` | Histogram | 99th percentile query latency | > 15 000 ms |
| `query.error_rate` | Counter | Failed queries per second | > 1% of total |
| `query.files_scanned` | Histogram | Data files read per query | Informational (track trends) |
| `query.files_skipped_ratio` | Gauge | Fraction of files skipped via data skipping | < 0.5 (poor clustering) |
| `query.bytes_scanned` | Counter | Total bytes read from storage | Cost tracking |
| `query.planning_time_ms` | Histogram | Time spent in metadata loading + Cutting off unnecessary steps | > 5 000 ms |
| `query.execution_time_ms` | Histogram | Time spent reading and processing data | Informational |

### Ingestion Metrics

| Metric | Type | Description | Alert Threshold |
|:---|:---|:---|:---|
| `ingest.commit_rate` | Counter | Commits per minute | Informational |
| `ingest.commit_latency_ms` | Histogram | Time from data write to successful CAS | > 5 000 ms |
| `ingest.conflict_rate` | Counter | CAS failures per minute | > 10% of commit attempts |
| `ingest.rows_per_second` | Counter | Ingestion throughput | < target throughput |
| `ingest.lag_seconds` | Gauge | Delay between event timestamp and query visibility | > 120 s |
| `ingest.orphan_files` | Gauge | Data files written but not committed | > 1 000 (cleanup needed) |

### Compaction Metrics

| Metric | Type | Description | Alert Threshold |
|:---|:---|:---|:---|
| `compaction.last_run_age_hours` | Gauge | Time since last compaction per partition | > 4 hours (active partitions) |
| `compaction.files_rewritten` | Counter | Files merged per compaction cycle | Informational |
| `compaction.bytes_rewritten` | Counter | Total bytes processed | Cost tracking |
| `compaction.duration_minutes` | Histogram | Wall-clock time per compaction job | > 60 min |
| `compaction.backlog_files` | Gauge | Small files awaiting compaction | > 10 000 |
| `compaction.conflicts` | Counter | Compaction commits that failed due to concurrent writes | > 5 per hour |

### Catalog Metrics

| Metric | Type | Description | Alert Threshold |
|:---|:---|:---|:---|
| `catalog.request_rate` | Counter | API requests per second | Informational |
| `catalog.commit_latency_ms` | Histogram | CAS operation latency | > 1 000 ms |
| `catalog.error_rate` | Counter | Failed API requests per second | > 0.1% |
| `catalog.replication_lag_ms` | Gauge | Lag between primary and replica catalog | > 500 ms |
| `catalog.credential_vend_rate` | Counter | Credentials vended per second | Informational |
| `catalog.credential_vend_latency_ms` | Histogram | Time to generate scoped credential | > 500 ms |

### Table Health Metrics (Composite)

| Metric | Type | Description | Alert Threshold |
|:---|:---|:---|:---|
| `table.health_score` | Gauge | Composite score (0–100) combining file size, clustering quality, metadata overhead | < 60 |
| `table.clustering_quality` | Gauge | Ratio of non-overlapping file ranges to total files (0.0–1.0) | < 0.3 (poor clustering) |
| `table.data_skipping_effectiveness` | Gauge | Avg fraction of files skipped across recent queries | < 0.5 (action needed) |
| `table.time_since_last_optimization` | Gauge | Hours since last compaction or clustering on any active partition | > 24 hours |
| `table.metadata_to_data_ratio` | Gauge | Metadata size / data size | > 0.05 (5%) |

## Dashboard Design

### Dashboard 1: Table Health Overview

**Purpose**: Single-pane view of all tables' health status.

| Panel | Visualization | Data Source |
|:---|:---|:---|
| Table inventory | Table with file count, size, last commit | `table.total_files`, `table.total_size_bytes` |
| Small-file heatmap | Heatmap by partition × time | `partition.small_file_count` |
| Snapshot growth | Time-series line chart | `snapshot.count` over time |
| Compaction backlog | Stacked bar by partition | `compaction.backlog_files` |
| Data freshness | Gauge per table | `ingest.lag_seconds` |

### Dashboard 2: Query Performance

**Purpose**: Real-time query performance and data-skipping effectiveness.

| Panel | Visualization | Data Source |
|:---|:---|:---|
| Query latency distribution | Histogram (p50, p90, p99) | `query.latency_p50_ms`, `query.latency_p99_ms` |
| Files skipped ratio | Time-series gauge | `query.files_skipped_ratio` |
| Planning vs. execution time | Stacked area chart | `query.planning_time_ms`, `query.execution_time_ms` |
| Error rate | Time-series with threshold line | `query.error_rate` |
| Top slow queries | Table sorted by latency | Query log |

### Dashboard 3: Ingestion & Commit Health

**Purpose**: Monitor ingestion throughput and commit contention.

| Panel | Visualization | Data Source |
|:---|:---|:---|
| Commit rate | Time-series line | `ingest.commit_rate` |
| Commit latency | Histogram | `ingest.commit_latency_ms` |
| Conflict rate | Time-series with threshold | `ingest.conflict_rate` |
| Ingestion lag | Gauge per source | `ingest.lag_seconds` |
| Orphan file count | Time-series | `ingest.orphan_files` |

### Dashboard 4: Storage & Cost

**Purpose**: Track storage growth and cost attribution.

| Panel | Visualization | Data Source |
|:---|:---|:---|
| Total storage by table | Stacked area chart | `table.total_size_bytes` |
| Bytes scanned per day | Bar chart | `query.bytes_scanned` aggregated daily |
| Compaction I/O cost | Bar chart | `compaction.bytes_rewritten` |
| Retained snapshot storage | Time-series | Snapshot count × avg snapshot delta size |
| Cost per query (estimated) | Table | Bytes scanned × per-GB cost |

## Logging Strategy

### What to Log

| Event | Log Level | Fields |
|:---|:---|:---|
| Query submitted | INFO | query_id, user, table, SQL hash, timestamp |
| Query completed | INFO | query_id, duration_ms, files_scanned, files_skipped, rows_returned |
| Query failed | ERROR | query_id, error_type, error_message, stack trace |
| Commit attempted | INFO | table, snapshot_id, operation, file_count, user |
| Commit succeeded | INFO | table, new_snapshot_id, files_added, files_deleted |
| Commit conflict | WARN | table, base_snapshot, conflicting_snapshot, retry_count |
| Compaction started | INFO | table, partition, file_count, estimated_size |
| Compaction completed | INFO | table, partition, files_in, files_out, duration |
| Schema evolved | INFO | table, change_type, columns_affected, user |
| Vacuum executed | INFO | table, files_deleted, bytes_freed, snapshots_expired |
| Access denied | WARN | user, table, operation, reason |

### Log Level Volume Targets

| Level | Target Rate | Rationale |
|:---|:---|:---|
| ERROR | < 50 / min | Actionable failures only |
| WARN | < 500 / min | Conflicts, access denials, degraded conditions |
| INFO | < 10 000 / min | Operational events (commits, queries, compaction) |
| DEBUG | Disabled in production | Enable per-table for troubleshooting |

### Structured Log Format

```json
{
  "timestamp": "2025-11-15T08:23:41.127Z",
  "level": "INFO",
  "service": "lakehouse-catalog",
  "event": "commit_succeeded",
  "table": "analytics.events",
  "snapshot_id": 4312,
  "files_added": 48,
  "files_deleted": 0,
  "rows_added": 2450000,
  "duration_ms": 1243,
  "user": "ingestion-service-prod",
  "trace_id": "abc123def456",
  "span_id": "789ghi012"
}
```

## Distributed Tracing

### Trace Propagation

A single query generates a trace that spans multiple systems:

```
Query Trace (root span)
├── catalog.resolve_table (50 ms)
│     └── catalog.load_snapshot (20 ms)
├── planner.load_manifests (200 ms)
│     ├── planner.partition_prune (10 ms)
│     └── planner.file_prune (50 ms)
├── executor.scan_files (parallel spans)
│     ├── executor.read_file[0] (150 ms)
│     ├── executor.read_file[1] (120 ms)
│     ├── executor.read_file[2] (180 ms)
│     └── executor.merge_deletes (30 ms)  // MoR only
└── executor.assemble_result (20 ms)
```

### Key Spans to Instrument

| Span | Parent | Key Attributes |
|:---|:---|:---|
| `catalog.resolve_table` | root | table_name, snapshot_id, cache_hit |
| `planner.load_manifests` | root | manifest_count, total_size_bytes |
| `planner.partition_prune` | load_manifests | manifests_before, manifests_after |
| `planner.file_prune` | load_manifests | files_before, files_after, stats_used |
| `executor.read_file` | root | file_path, file_size, format, rows_read |
| `executor.merge_deletes` | root | delete_file_count, rows_deleted |
| `executor.assemble_result` | root | total_rows, total_bytes |
| `commit.compare_and_swap` | root (write path) | table, base_snapshot, success, retry_count |

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Runbook |
|:---|:---|:---|
| Catalog unavailable | Health check fails for > 60 s | Initiate catalog failover; check replication status |
| Commit failure spike | Conflict rate > 50% for 5 min | Investigate concurrent writers; increase commit batching |
| Data freshness breach | Ingestion lag > 10 min | Check ingestion pipeline; verify source availability |
| Object storage errors | Error rate > 1% for 5 min | Check storage health; switch to replica region |
| Snapshot count critical | > 100 000 snapshots without expiration | Run emergency vacuum; enable auto-expiration |

### Warning Alerts

| Alert | Condition | Action |
|:---|:---|:---|
| Compaction backlog growing | Small files > 10 000 in any partition | Trigger manual compaction; review scheduling |
| Query p99 degraded | p99 > 15 s for 15 min | Check file sizes; review data-skipping effectiveness |
| Manifest size large | Total manifests > 10 GB | Schedule manifest merging |
| Orphan files accumulating | > 5 000 uncommitted files | Investigate failed writers; run cleanup |
| Catalog replication lag | > 5 s for 10 min | Check network; verify replica health |
| Disk cache hit ratio low | < 80% for 30 min | Increase cache size; review access patterns |
| Schema evolution frequency | > 10 changes per day on same table | Review pipeline; may indicate upstream instability |

### Runbooks

| Runbook | Trigger | Steps |
|:---|:---|:---|
| Catalog failover | Catalog primary unreachable | 1. Verify primary down. 2. Promote replica. 3. Update DNS. 4. Verify commits succeed. 5. Investigate root cause. |
| Emergency compaction | Small-file count critical | 1. Identify top-10 affected partitions. 2. Pause non-critical ingestion. 3. Run compaction with elevated resources. 4. Verify file counts. 5. Resume ingestion. |
| Snapshot expiration | Snapshot count > threshold | 1. Verify retention policy. 2. Run expire_snapshots with safe retention. 3. Run remove_orphan_files. 4. Verify metadata size reduction. |
| Conflict storm mitigation | Commit conflict rate > 50% | 1. Identify contending writers. 2. Stagger commit intervals. 3. Partition writes by file group. 4. Increase commit batch size. 5. Monitor conflict rate. |
| Data corruption recovery | Checksum mismatch on read | 1. Identify affected files via manifest. 2. Roll back to last known-good snapshot. 3. Re-ingest from source for affected time range. 4. Validate checksums. 5. Post-mortem. |

## Operational Runbooks (Expanded)

### Runbook 1: Query Performance Degradation

**Trigger**: `query.latency_p99` > 15 s for 15 minutes.

| Step | Action | Expected Outcome |
|:---|:---|:---|
| 1 | Check `query.files_skipped_ratio` | If < 0.5 → data skipping ineffective; proceed to step 2 |
| 2 | Check `partition.small_file_count` | If > 1 000 per partition → small-file problem; trigger compaction |
| 3 | Check `table.clustering_quality` | If < 0.3 → poor clustering; schedule Z-ordering or Liquid Clustering |
| 4 | Check `query.planning_time_ms` | If > 5 s → metadata overhead; check manifest count and size |
| 5 | Check `manifest.count` | If > 10 000 → trigger manifest merging |
| 6 | Check query engine resource utilization | If CPU > 90% → scale out query workers |
| 7 | Review top slow queries | Identify table/column patterns; optimize partitioning or add bloom filters |

### Runbook 2: Compaction Falling Behind

**Trigger**: `compaction.backlog_files` > 10 000 in any partition.

| Step | Action | Expected Outcome |
|:---|:---|:---|
| 1 | Identify top-10 partitions by small-file count | Focus compaction resources on highest-debt partitions |
| 2 | Check compaction worker utilization | If maxed → spawn additional compaction workers |
| 3 | Check for compaction conflicts | If `compaction.conflicts` > 5/hr → stagger ingestion commit intervals |
| 4 | Reduce streaming commit frequency | Increase micro-batch interval from 30 s to 60 s (fewer, larger files) |
| 5 | Enable write-side buffering | Buffer data in memory until 64 MB before flushing (fewer small files created) |
| 6 | Run emergency compaction with elevated resources | Dedicated large-memory instances for bin-packing |
| 7 | Monitor until backlog < 1 000 per partition | Return to normal compaction schedule |

### Runbook 3: Catalog Commit Contention Storm

**Trigger**: `ingest.conflict_rate` > 20% for 5 minutes.

| Step | Action | Expected Outcome |
|:---|:---|:---|
| 1 | Identify contending writers via audit log | Determine if writers overlap on same table/partition |
| 2 | If all writers append to different partitions | This should auto-rebase; check if rebase logic is enabled |
| 3 | If writers overlap on same partition | Assign file-group-level concurrency; each writer owns distinct file groups |
| 4 | Increase commit batch size | Reduce commit frequency from 30 s to 120 s |
| 5 | Add backoff with jitter to writer retry logic | Prevent synchronized retries that amplify contention |
| 6 | If sustained > 50%: pause non-critical writers | Let critical ingestion clear the contention window |

## SLO Dashboard Design

### Table Health Scorecard

| SLO | Target | Measurement | Burn Rate Alert |
|:---|:---|:---|:---|
| Query freshness | Data queryable within 60 s | `ingest.lag_seconds` | > 5× error budget consumed in 1 hr |
| Interactive query p99 | < 15 s | `query.latency_p99_ms` | > 3× error budget consumed in 6 hr |
| Commit success rate | > 99.9% | `1 - (ingest.conflict_rate × retry_exhaustion_rate)` | > 2× budget in 1 hr |
| Compaction freshness | Compacted within 4 hr | `compaction.last_run_age_hours` | Any partition > 8 hr |
| Data skipping effectiveness | > 70% files skipped | `query.files_skipped_ratio` | Weekly avg < 50% |

### Cost Attribution Dashboard

| Panel | Metric | Granularity | Purpose |
|:---|:---|:---|:---|
| Storage cost by table | `table.total_size_bytes × cost_per_GB` | Per table | Identify expensive tables |
| Scan cost by query | `query.bytes_scanned × cost_per_GB_scanned` | Per query | Chargeback to teams |
| Compaction cost | `compaction.bytes_rewritten × cost_per_GB_written` | Per table | Justify compaction investment |
| Snapshot retention cost | `retained_snapshot_bytes × cost_per_GB` | Per table | Optimize retention policies |
| API request cost | `catalog.request_rate × cost_per_request` | Per engine | Identify metadata-heavy engines |

## Log Retention Strategy

| Log Type | Retention | Storage | Rationale |
|:---|:---|:---|:---|
| Query logs | 30 days hot, 90 days warm | Lakehouse table (self-hosted) | Performance analysis, query pattern mining |
| Commit logs | 1 year | Lakehouse table | Audit trail, debugging |
| Access audit logs | 7 years | Immutable append-only table | Regulatory compliance (SOC 2, financial) |
| Compaction logs | 30 days | Lakehouse table | Operational debugging |
| Error logs | 90 days | Centralized log aggregation | Incident investigation |
| Security events | 1 year hot, 7 years archive | SIEM integration | Threat detection, forensics |

## Trace Sampling Strategy

| Trace Type | Sampling Rate | Rationale |
|:---|:---|:---|
| All queries (normal) | 1% | Baseline performance monitoring |
| Slow queries (p99+) | 100% | Every slow query needs root cause analysis |
| Failed queries | 100% | Every failure needs investigation |
| Commit operations | 100% | Critical path; low volume |
| Compaction operations | 100% | Long-running; operational visibility |
| Credential vending | 10% | Security monitoring; moderate volume |

## Capacity Planning Metrics

| Metric | Formula | Action Threshold |
|:---|:---|:---|
| Days until storage full | `(capacity - used) / daily_growth_rate` | < 30 days |
| Compaction debt ratio | `small_files / total_files` | > 0.3 (30% small files) |
| Metadata growth rate | `delta(manifest_size) / delta(time)` | > 1 GB/day |
| Query concurrency headroom | `max_concurrent - avg_concurrent` | < 20% headroom |
| Commit throughput utilization | `actual_commits / max_commits_per_min` | > 70% (approaching contention) |

## Performance Regression Detection

### Automated Regression Detection

```
FUNCTION detect_regression(metric, window_hours=24, threshold_stddev=2):
    baseline = compute_baseline(metric, past_7_days, exclude_last_24h)
    recent = compute_recent(metric, last_hours=window_hours)

    deviation = (recent.p50 - baseline.p50) / baseline.stddev

    IF deviation > threshold_stddev:
        ALERT(
            severity = WARNING if deviation < 3 else CRITICAL,
            message = f"{metric} regressed by {deviation:.1f}σ",
            baseline = baseline.p50,
            current = recent.p50,
            likely_cause = correlate_with_changes(metric, window_hours)
        )
```

### Regression Correlation Sources

| Change Event | Metrics Affected | Investigation Path |
|:---|:---|:---|
| Schema evolution | `query.planning_time_ms`, `query.files_skipped_ratio` | Check if new columns lack statistics |
| Partition evolution | `query.planning_time_ms`, `query.files_scanned` | Check mixed-spec planning overhead |
| Compaction skipped | `query.latency_p99`, `query.files_scanned` | Check small-file counts |
| New writer added | `ingest.conflict_rate`, `ingest.commit_latency_ms` | Check commit contention |
| Query engine upgrade | `query.latency_p50`, `query.files_skipped_ratio` | Check statistics interpretation changes |
| Data volume spike | `query.bytes_scanned`, `query.latency_p99` | Check if partition Cutting off unnecessary steps effective |

## Table Optimization Recommendations Engine

### Automated Recommendations

```
FUNCTION generate_recommendations(table):
    recommendations = []
    health = compute_table_health(table)

    // Check small-file problem
    small_files = count_files_below(table, threshold=10MB)
    IF small_files > 1000:
        recommendations.APPEND({
            severity: "HIGH",
            action: "RUN COMPACTION",
            reason: f"{small_files} files below 10 MB",
            estimated_benefit: f"Reduce query planning time by ~{small_files/total_files*100:.0f}%"
        })

    // Check clustering quality
    IF table.clustering_quality < 0.3:
        recommendations.APPEND({
            severity: "MEDIUM",
            action: "RUN Z-ORDER or LIQUID CLUSTERING",
            columns: top_filtered_columns(table, n=3),
            reason: f"Clustering quality {table.clustering_quality:.2f} is below 0.3",
            estimated_benefit: "Improve data skipping from ~30% to ~80% files skipped"
        })

    // Check snapshot retention
    snapshots = count_snapshots(table)
    IF snapshots > 50000:
        recommendations.APPEND({
            severity: "HIGH",
            action: "RUN EXPIRE SNAPSHOTS",
            reason: f"{snapshots} snapshots accumulated",
            estimated_benefit: f"Reduce metadata size by ~{(snapshots-1000)*avg_snapshot_delta_MB:.0f} MB"
        })

    // Check delete file accumulation (MoR)
    delete_ratio = table.delete_files / table.data_files
    IF delete_ratio > 0.2:
        recommendations.APPEND({
            severity: "HIGH",
            action: "RUN COMPACTION (apply deletes)",
            reason: f"Delete file ratio {delete_ratio:.2f} exceeds 0.2",
            estimated_benefit: "Eliminate read-time merge overhead"
        })

    // Check orphan files
    orphans = count_orphan_files(table)
    IF orphans > 1000:
        recommendations.APPEND({
            severity: "LOW",
            action: "RUN REMOVE ORPHAN FILES",
            reason: f"{orphans} orphan files from failed commits",
            estimated_benefit: f"Reclaim ~{orphans * avg_file_size_MB:.0f} MB storage"
        })

    RETURN recommendations
```

## Data Freshness Monitoring

### End-to-End Latency Tracking

| Stage | Metric | SLO |
|:---|:---|:---|
| Source → CDC connector | `cdc.source_lag_ms` | < 5 s |
| CDC → Stream processor | `stream.processing_lag_ms` | < 10 s |
| Stream processor → Buffer | `buffer.accumulation_ms` | < 30 s (or target file size reached) |
| Buffer → Object storage write | `write.duration_ms` | < 5 s |
| Object storage → Catalog commit | `commit.duration_ms` | < 2 s |
| Commit → Query visible | `visibility.lag_ms` | < 5 s (metadata cache refresh) |
| **Total end-to-end** | `freshness.total_lag_s` | **< 60 s** |

### Freshness Alert Escalation

| Lag | Severity | Action |
|:---|:---|:---|
| 60–120 s | Warning | Investigate; check each stage's lag |
| 120–300 s | High | Page data engineering; check stream processor health |
| > 300 s | Critical | Check source database; verify CDC connector; check for commit contention |

## Object Storage Cost Observability

### Cost-Per-Query Tracking

Each query generates cost attribution metadata:

```
QueryCostReport {
    query_id           : string
    user               : string
    table              : string
    bytes_scanned      : int64    // billable bytes read from storage
    files_read         : int32    // number of GET requests
    files_skipped      : int32    // files eliminated by data skipping
    metadata_bytes     : int64    // manifest bytes loaded
    estimated_cost     : decimal  // bytes_scanned × cost_per_GB + files_read × cost_per_request
}

// Aggregated daily:
//   - Top 10 most expensive queries
//   - Top 10 most expensive tables (by total scan cost)
//   - Top 10 most expensive users
//   - Data skipping savings: cost_avoided = files_skipped × avg_file_size × cost_per_GB
```

### Storage Waste Detection

| Waste Type | Detection | Metric | Remediation |
|:---|:---|:---|:---|
| Orphan files | Files on storage not in any manifest | `orphan_file_count`, `orphan_bytes` | Run `remove_orphan_files` |
| Expired snapshots | Snapshots beyond retention policy | `expired_snapshot_count` | Run `expire_snapshots` |
| Redundant retention | Snapshots retained longer than policy | `excess_retention_bytes` | Adjust retention policy |
| Unclustered data | Files with overlapping value ranges | `clustering_quality < 0.3` | Run Z-ordering or Liquid Clustering |
| Over-replicated metadata | Duplicate manifests from failed merges | `duplicate_manifest_count` | Run manifest merging |
