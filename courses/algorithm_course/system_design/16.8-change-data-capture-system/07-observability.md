# Observability — Change Data Capture (CDC) System

## Metrics (USE/RED)

### Key Metrics to Track

#### Source Capture Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `cdc.source.lag_ms` | Gauge | Time difference between source commit timestamp and CDC processing timestamp | > 5,000 ms |
| `cdc.source.lag_bytes` | Gauge | Bytes behind in the transaction log (LSN difference) | > 1 GB |
| `cdc.source.events_per_sec` | Rate | Change events captured per second | — (baseline) |
| `cdc.source.wal_disk_usage_bytes` | Gauge | WAL/binlog disk usage on source database | > 80% disk |
| `cdc.source.replication_slot_active` | Gauge | Whether the replication slot is actively being consumed | 0 (inactive) |
| `cdc.source.snapshot_rows_remaining` | Gauge | Rows left to process in current snapshot | — (progress tracking) |
| `cdc.source.snapshot_duration_sec` | Gauge | Elapsed time of current snapshot | > SLA threshold |

#### Connector Health Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `cdc.connector.status` | Gauge | Connector state (0=stopped, 1=running, 2=paused, 3=failed) | != 1 (not running) |
| `cdc.connector.task_count` | Gauge | Number of active tasks per connector | 0 (all tasks dead) |
| `cdc.connector.restarts_total` | Counter | Cumulative connector/task restarts | > 3/hour |
| `cdc.connector.uptime_seconds` | Gauge | Time since last restart | < 60s (frequent restarts) |
| `cdc.connector.errors_total` | Counter | Errors by error type (serialization, connection, schema) | > 10/min |
| `cdc.connector.worker_rebalances` | Counter | Number of task rebalancing events | > 2/hour |

#### Event Pipeline Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `cdc.events.produced_total` | Counter | Total events published to streaming platform by operation type (c/u/d/r) | — |
| `cdc.events.produced_per_sec` | Rate | Event production rate | — (baseline) |
| `cdc.events.size_bytes` | Histogram | Event payload size distribution | p99 > 100 KB |
| `cdc.events.serialization_errors` | Counter | Events that failed schema serialization | > 0 |
| `cdc.events.filtered_total` | Counter | Events dropped by filter rules | — (informational) |
| `cdc.events.dead_letter_total` | Counter | Events routed to dead-letter topic | > 100/hour |
| `cdc.events.duplicate_detected` | Counter | Duplicates detected by idempotent producer | — (informational) |

#### Offset Management Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `cdc.offset.last_committed_lsn` | Gauge | Last durably committed log position | — |
| `cdc.offset.commit_latency_ms` | Histogram | Time to commit offset | p99 > 500 ms |
| `cdc.offset.commit_failures` | Counter | Failed offset commits | > 3 consecutive |
| `cdc.offset.lag_behind_source` | Gauge | Difference between source LSN and committed LSN | Growing trend |

#### Schema Registry Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `cdc.schema.versions_total` | Gauge | Total schema versions registered per subject | — |
| `cdc.schema.compatibility_failures` | Counter | Schema changes rejected by compatibility check | > 0 |
| `cdc.schema.lookup_latency_ms` | Histogram | Schema lookup time (including cache) | p99 > 50 ms |
| `cdc.schema.cache_hit_ratio` | Gauge | Schema cache hit rate | < 90% |
| `cdc.schema.registry_errors` | Counter | Schema registry communication errors | > 5/min |

#### Consumer Lag Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `cdc.consumer.lag_messages` | Gauge | Messages behind latest offset per consumer group | > 100K messages |
| `cdc.consumer.lag_seconds` | Gauge | Estimated time behind latest event | > 60 seconds |
| `cdc.consumer.processing_rate` | Rate | Events processed per second per consumer | — (baseline) |
| `cdc.consumer.errors_total` | Counter | Consumer processing errors | > 1% error rate |

### Dashboard Design

**Dashboard 1: CDC Pipeline Overview**

- End-to-end latency (source commit → consumer delivery) — time series
- Total events per second by operation type (create/update/delete) — stacked area
- Active connectors and their status — status grid
- Consumer group lag across all sinks — bar chart
- Error rate across pipeline stages — time series

**Dashboard 2: Connector Health**

- Per-connector status (running/paused/failed) — status indicators
- Per-connector capture rate (events/sec) — time series
- Per-connector lag (ms and bytes) — time series with threshold lines
- Rebalancing events timeline — event annotations
- Task distribution across workers — table

**Dashboard 3: Source Database Impact**

- Replication slot lag (bytes and time) — dual-axis time series
- WAL disk usage (%) — gauge with threshold
- Replication connection count — time series
- Snapshot progress (rows completed vs. total) — progress bars
- Source database CPU/IO correlation with CDC activity — overlay chart

**Dashboard 4: Schema & Data Quality**

- Schema versions timeline per table — event annotations
- Compatibility check results — pass/fail counters
- Dead-letter topic growth — time series
- Event size distribution — histogram
- Serialization error rate — time series

---

## Logging

### What to Log

| Event | Log Level | Content |
|-------|-----------|---------|
| Connector start/stop | INFO | Connector name, config hash, assigned worker, starting offset |
| Snapshot begin/complete | INFO | Tables, estimated rows, snapshot LSN, duration |
| Schema change detected | INFO | Table name, DDL statement (sanitized), old schema version, new schema version |
| Offset committed | DEBUG | Connector name, LSN, timestamp, events since last commit |
| Event processing error | WARN | Table, event key (redacted), error type, stack trace summary |
| Schema incompatibility | ERROR | Table, old schema, new schema, compatibility violations |
| Connector failure | ERROR | Connector name, error type, last known offset, task state |
| Rebalancing event | INFO | Trigger reason, tasks reassigned, new worker assignments |
| Replication slot issue | WARN | Slot name, status change (active → inactive), lag at time of issue |
| Dead-letter event | WARN | Table, event key (redacted), failure reason, dead-letter topic |

### Log Levels Strategy

| Level | Production Volume | Use Case |
|-------|------------------|----------|
| ERROR | < 50/min | Connector failures, data corruption, replication slot loss |
| WARN | < 500/min | Slow processing, schema issues, replication lag, dead-letter events |
| INFO | < 5,000/min | Lifecycle events, snapshots, schema changes, rebalancing |
| DEBUG | Disabled in prod | Offset commits, per-event processing, WAL entry details |
| TRACE | Never in prod | Raw WAL bytes, serialization details, network packet inspection |

### Structured Logging Format

```
{
  "timestamp": "2026-03-10T14:32:01.234Z",
  "level": "WARN",
  "component": "log_capture_engine",
  "event": "replication_lag_high",
  "connector": "pg-orders-connector",
  "source_db": "orders",
  "current_lsn": "0/1A4B3C80",
  "committed_lsn": "0/1A4B0000",
  "lag_bytes": 244864,
  "lag_ms": 3421,
  "events_buffered": 1250,
  "worker_id": "worker-03",
  "task_id": 0
}
```

---

## Distributed Tracing

### Trace Propagation Strategy

CDC pipelines have a unique tracing challenge: the "request" originates at the source database (a commit) and flows asynchronously through multiple stages before reaching consumers. Traces must be correlated across these asynchronous boundaries.

**Trace context propagation:**

```
Source DB Commit (trace origin)
  └── Log Capture (read WAL entry → create trace)
        └── Event Building (build envelope → add trace headers)
              └── Schema Resolution (lookup/register schema)
              └── Publish to Streaming Platform (event with trace headers)
                    └── Consumer A: Search Indexer (extract trace → create child span)
                    └── Consumer B: Cache Updater (extract trace → create child span)
                    └── Consumer C: Analytics Sink (extract trace → create child span)
```

### Key Spans to Instrument

| Span | Parent | Key Attributes |
|------|--------|---------------|
| `cdc.wal_read` | Root | source_db, lsn, batch_size, read_latency_ms |
| `cdc.event_build` | wal_read | table, operation, event_size_bytes |
| `cdc.schema_resolve` | event_build | subject, schema_id, cache_hit |
| `cdc.serialize` | event_build | format (avro/json), serialized_size_bytes |
| `cdc.publish` | event_build | topic, partition, offset, publish_latency_ms |
| `cdc.offset_commit` | wal_read | connector, lsn, commit_latency_ms |
| `cdc.consume` | publish | consumer_group, processing_latency_ms |
| `cdc.sink_write` | consume | sink_type, target, write_latency_ms |

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| **Connector down** | connector.status != RUNNING for > 5 min | P1 | Check worker health → Restart task → Check source DB connectivity |
| **WAL disk critical** | source WAL disk > 90% | P1 | Check replication slot lag → Drop stale slots if needed → Investigate connector |
| **Replication slot lost** | Slot status = "lost" or slot deleted | P1 | Re-create slot → Trigger re-snapshot → Verify no data loss |
| **Zero events captured** | events_per_sec = 0 for > 10 min (on active source) | P1 | Check source writes → Check connector → Check replication connection |
| **Offset commit failure** | > 5 consecutive commit failures | P1 | Check streaming platform health → Restart connector → Manual offset reset |

### Warning Alerts

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| **High replication lag** | lag_ms > 30,000 for > 5 min | P2 | Check connector throughput → Check source write rate → Scale resources |
| **Consumer lag growing** | consumer_lag_messages increasing for > 15 min | P2 | Check consumer health → Scale consumers → Check sink connectivity |
| **Schema incompatibility** | compatibility_failures > 0 | P2 | Review DDL change → Update schema compatibility → Coordinate with producers |
| **Dead-letter growth** | dead_letter_total > 1000/hour | P2 | Investigate failure reasons → Fix schema/transform issues → Replay if possible |
| **Frequent restarts** | connector restarts > 3/hour | P3 | Check error logs → Investigate root cause → Check resource limits |
| **Snapshot slow** | snapshot duration > 2x estimated time | P3 | Check source DB load → Increase chunk size → Add snapshot parallelism |
| **Event size spike** | p99 event size > 100 KB | P3 | Identify large-column tables → Add column filtering → Monitor source schema |

### Runbook References

| Runbook | Scenario | Key Steps |
|---------|----------|-----------|
| RB-001 | Connector failure recovery | Check error logs → Identify failure type → Restart task → Verify offset → Monitor lag |
| RB-002 | WAL disk pressure | Identify lagging slots → Assess slot importance → Advance or drop slot → Monitor disk recovery |
| RB-003 | Schema change handling | Review DDL → Check compatibility → Update registry if needed → Monitor affected consumers |
| RB-004 | Consumer lag remediation | Identify slow consumers → Check sink health → Scale consumers → Consider partition increase |
| RB-005 | Full re-snapshot | Stop connector → Reset offset → Configure snapshot mode → Restart → Monitor progress → Verify completeness |

---

## SLO Dashboard Design

```
┌──────────────────────────────────────────────────────────────────┐
│                    CDC PIPELINE SLO DASHBOARD                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  AVAILABILITY (target: 99.99%)                                     │
│  ┌────────────────────────────────────────────┐                   │
│  │ Current: 99.994%  │ Budget: 5.26 min/month │ Remaining: 3.1m  │
│  │ ████████████████████████████████████████░░░░│ 84% budget left  │
│  └────────────────────────────────────────────┘                   │
│                                                                    │
│  END-TO-END LATENCY (target: p99 < 2s)                            │
│  ┌────────────────────────────────────────────┐                   │
│  │ Current p50: 180ms │ p95: 620ms │ p99: 1.2s │ Status: OK      │
│  │ ████████████████████████████████████████████│ Within SLO       │
│  └────────────────────────────────────────────┘                   │
│                                                                    │
│  EVENT LOSS RATE (target: 0%)                                      │
│  ┌────────────────────────────────────────────┐                   │
│  │ Lost events (30d): 0  │ Verification: hourly audit              │
│  │ ████████████████████████████████████████████│ Perfect           │
│  └────────────────────────────────────────────┘                   │
│                                                                    │
│  CONNECTOR HEALTH                                                  │
│  ┌────────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │ pg-orders  │ pg-users │ pg-items │ mysql-inv│ mysql-pay│      │
│  │  RUNNING   │  RUNNING │  RUNNING │  RUNNING │ PAUSED   │      │
│  │  lag:180ms │  lag:90ms│  lag:2.1s│  lag:45ms│  lag:N/A │      │
│  │  3.2K/s    │  1.1K/s  │  8.5K/s  │  2.0K/s  │  0/s     │      │
│  └────────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                                                    │
│  TOP CONSUMER GROUPS BY LAG                                        │
│  search-indexer:    ██████░░░░  42K messages (3.2s behind)         │
│  cache-invalidator: ██░░░░░░░░  8K messages (0.6s behind)         │
│  warehouse-loader:  ████████░░  890K messages (12.1s behind)       │
│  analytics-stream:  ███░░░░░░░  15K messages (1.1s behind)        │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### SLO Error Budget Tracking

| SLO | Monthly Budget | Daily Equivalent | Burn Rate Alert |
|-----|---------------|-----------------|-----------------|
| Availability (99.99%) | 4.32 minutes | 8.6 seconds | > 6x burn rate for 1 hour |
| Latency p99 < 2s | 0.01% of events > 2s | ~860 events/day | > 100 violations/minute |
| Event loss 0% | 0 events | 0 events | Any loss is P1 |
| Duplicate rate < 0.01% | ~860 duplicates/day | ~36/hour | > 500 duplicates/hour |
| Connector recovery < 30s | N/A (per-event) | N/A | Any recovery > 60s |
| Schema propagation < 5s | N/A (per-event) | N/A | Any propagation > 10s |

### Error Budget Policies

| Budget Consumed | Policy |
|----------------|--------|
| 0-50% | Normal operations; feature development proceeds |
| 50-75% | Increased monitoring; freeze non-critical connector changes |
| 75-90% | Incident review required; reliability improvements prioritized |
| 90-100% | Change freeze on CDC infrastructure; all engineering focused on reliability |

---

## Incident Playbooks

### Playbook 1: Connector Failure with Unknown Offset (P1)

**Trigger:** Connector fails, and the offset topic returns no valid offset for the connector.

**Impact:** Cannot resume streaming; risk of data loss or full re-snapshot.

```
STEP 1: Check offset topic directly
  → Read __cdc_offsets topic for connector key
  → If offset exists but is corrupted: attempt to parse raw bytes
  → If offset genuinely missing: proceed to Step 2

STEP 2: Determine last known position
  → Check source database for replication slot status:
    SELECT restart_lsn, confirmed_flush_lsn FROM pg_replication_slots
    WHERE slot_name = '<connector_slot>';
  → If slot exists with valid LSN: use confirmed_flush_lsn as starting point
  → If slot lost: proceed to Step 3

STEP 3: Assess data loss window
  → Compare latest events in downstream topics with source database:
    Last event timestamp in topic → last known CDC position
    Current source LSN → current position
    Gap = events in the unprocessed window
  → If gap < 1 hour: incremental re-snapshot of affected tables
  → If gap > 1 hour: full re-snapshot required

STEP 4: Recovery
  → Create new replication slot at current LSN
  → Configure connector with snapshot_mode = "initial" (or "when_needed")
  → Start connector; monitor snapshot progress
  → Verify no gaps: compare row counts source vs. events emitted

STEP 5: Root cause analysis
  → Why was offset lost? (offset topic retention too short? compaction deleted?)
  → Why was replication slot lost? (max_slot_wal_keep_size exceeded?)
  → Update monitoring to detect offset health issues earlier
```

### Playbook 2: Schema Incompatibility Blocking Pipeline (P1)

**Trigger:** `cdc.schema.compatibility_failures > 0`; connector halted with SCHEMA_INCOMPATIBLE error.

**Impact:** All events for the affected table are blocked; lag growing.

```
STEP 1: Identify the breaking DDL
  → Read connector logs for the DDL statement
  → Check schema registry for the compatibility violation:
    GET /subjects/{table}-value/compatibility?verbose=true
  → Common causes: column type change (INT → VARCHAR), required column dropped

STEP 2: Assess downstream impact
  → Which consumers read this table's topic?
  → Can they handle the new schema? (check their code/configuration)

STEP 3: Resolution options
  A) Register compatible schema version:
     → Modify the new schema to maintain compatibility
     → POST /subjects/{table}-value/versions with adjusted schema
     → Restart connector; events resume with new schema ID

  B) Override compatibility (last resort):
     → PUT /config/{table}-value with compatibility = "NONE"
     → Register the breaking schema
     → PUT /config/{table}-value with compatibility = "BACKWARD" (restore)
     → WARNING: All consumers must be updated before events arrive

  C) Create new topic:
     → Reconfigure connector to route affected table to a new topic
     → New topic has no compatibility history
     → Consumers switch to new topic; old topic drained

STEP 4: Verify recovery
  → Monitor connector status: should return to RUNNING
  → Monitor lag: should decrease
  → Verify consumers are deserializing events correctly
```

### Playbook 3: Consumer Lag Crisis (P2)

**Trigger:** `cdc.consumer.lag_messages > 1,000,000` for any consumer group sustained 15 minutes.

**Impact:** Downstream system is increasingly stale; risk of streaming platform storage pressure if retention approaches.

```
STEP 1: Identify the lagging consumer group
  → Check dashboard: which group, which partitions?
  → Is lag growing or stable? (growing = capacity issue; stable = one-time spike)

STEP 2: Diagnose consumer health
  → Are all consumer instances running? Check consumer group membership.
  → Are consumers processing but slowly? Check consumer processing rate.
  → Is the sink healthy? Check sink connectivity and write performance.
  → Is there a poison pill event? Check consumer error logs for repeated failures.

STEP 3: Apply fix
  → Slow sink: scale sink (add Elasticsearch nodes, increase cache capacity)
  → Insufficient consumers: add consumer instances (up to partition count)
  → Poison pill: skip the failing event (route to dead letter); fix consumer bug
  → One-time spike: wait; lag will recover if current rate > production rate

STEP 4: Prevent recurrence
  → If lag caused by production spike: increase partition count for affected topics
  → If lag caused by slow consumer: implement consumer-side compaction (skip
    intermediate updates for same key)
  → Add auto-scaling for consumer groups based on lag threshold
```

### Playbook 4: WAL Disk Pressure Emergency (P1)

**Trigger:** Source database WAL disk usage > 85% AND at least one replication slot lagging > 10 GB.

**Impact:** Database outage risk — if disk fills, database stops accepting writes.

```
STEP 1: Immediate triage (< 2 minutes)
  → Identify stalled slots:
    SELECT slot_name, active,
           pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn))
    FROM pg_replication_slots ORDER BY pg_wal_lsn_diff DESC;
  → Check disk growth rate: how long until 100%?

STEP 2: Decision matrix
  ┌─────────────────────────┬────────────────────────┬──────────────┐
  │ Disk Usage              │ Slot Active?           │ Action       │
  ├─────────────────────────┼────────────────────────┼──────────────┤
  │ 85-90%                  │ Yes (consuming slowly) │ Monitor + scale│
  │ 85-90%                  │ No (connector down)    │ Restart conn │
  │ 90-95%                  │ Yes                    │ Throttle source│
  │ 90-95%                  │ No                     │ DROP SLOT    │
  │ > 95%                   │ Any                    │ DROP SLOT NOW│
  └─────────────────────────┴────────────────────────┴──────────────┘

STEP 3: If slot dropped
  → Record: slot name, last LSN, drop timestamp, disk usage at drop
  → Monitor disk: WAL files should start being recycled within minutes
  → Plan re-snapshot: determine which tables need re-snapshot based on gap

STEP 4: Recovery
  → Re-create replication slot
  → Trigger incremental snapshot for affected tables (watermark approach)
  → Monitor event continuity via row count audit

STEP 5: Prevention
  → Review max_slot_wal_keep_size setting (should be < 50% of WAL disk)
  → Add alerting at 50% and 75% disk thresholds
  → Implement heartbeat writes to advance idle slots
```

---

## Anomaly Detection

### Automated Anomaly Detection Rules

| Anomaly | Detection Logic | Response |
|---------|----------------|----------|
| Sudden throughput drop | events_per_sec < 50% of 24h rolling average for > 5 min | Alert + check source DB connectivity |
| Event size spike | p99 event size > 3x rolling median | Alert + investigate table schema changes |
| Unexpected schema registration | New schema version registered outside change window | Alert + audit DDL source |
| Consumer group membership change | Consumer count drops unexpectedly | Alert + check consumer health |
| Offset regression | Committed offset moves backward | P1 alert + investigate potential offset corruption |
| Dead-letter surge | Dead-letter events > 10x normal rate | Alert + investigate serialization/schema issues |
| Rebalancing frequency | > 3 rebalances in 1 hour | Alert + check worker stability |

### Cross-Pipeline Correlation

Correlate CDC metrics with source database metrics to identify root causes:

```
FUNCTION detect_cdc_source_correlation():
    // When CDC lag spikes, check if source write rate also spiked
    cdc_lag = query("cdc.source.lag_ms", window = "5m")
    source_writes = query("db.writes_per_sec", window = "5m")

    IF cdc_lag.trend == INCREASING AND source_writes.trend == INCREASING:
        diagnosis = "Source write rate increase causing lag — likely organic load"
        action = "Monitor; lag should stabilize when write rate normalizes"

    ELSE IF cdc_lag.trend == INCREASING AND source_writes.trend == STABLE:
        diagnosis = "CDC processing degradation — not caused by source load"
        action = "Investigate connector worker: CPU, memory, GC, network"

    ELSE IF cdc_lag.trend == STABLE AND source_writes.trend == INCREASING:
        diagnosis = "CDC keeping up despite increased load — healthy"
        action = "Monitor; proactively plan capacity if trend continues"

    RETURN diagnosis, action
```

---

## Observability Anti-Patterns

| Anti-Pattern | Why It's Wrong | Better Approach |
|-------------|---------------|-----------------|
| Alerting on event rate (absolute) | Normal rate varies by time of day and day of week | Alert on rate relative to rolling baseline |
| Ignoring consumer lag for "batch" consumers | Warehouse loaders are expected to lag, but unbounded growth is still dangerous | Set lag thresholds per consumer group based on their SLO, not a global threshold |
| Monitoring only connector status | A connector can be RUNNING but effectively stalled (processing 0 events/sec) | Monitor events_per_sec alongside status; alert on RUNNING + 0 events for active sources |
| Aggregating metrics across connectors | One lagging connector hidden by healthy aggregate | Always have per-connector dashboards and alerts |
| Not tracking schema registry health | Registry seems "always up" until it isn't, and the failure is catastrophic | Monitor registry latency, error rate, and cache hit ratio; alert on degradation |
| Treating dead-letter events as "expected" | Each dead-letter event represents a processing failure that needs investigation | Zero dead-letter events should be the target; investigate every occurrence |

---

## Pipeline Health Score

```
FUNCTION calculate_pipeline_health_score(metrics):
    scores = {
        capture_health: IF metrics.lag_ms < 5000 THEN 1.0
                        ELIF metrics.lag_ms < 30000 THEN 0.7
                        ELIF metrics.lag_ms < 120000 THEN 0.3
                        ELSE 0.0,

        wal_safety: IF metrics.wal_disk_pct < 60 THEN 1.0
                    ELIF metrics.wal_disk_pct < 80 THEN 0.5
                    ELSE 0.0,

        connector_health: metrics.running_connectors / metrics.expected_connectors,

        consumer_health: IF max(consumer_lag_seconds) < 60 THEN 1.0
                        ELIF max(consumer_lag_seconds) < 300 THEN 0.6
                        ELSE 0.2,

        error_health: IF metrics.error_rate < 0.001 THEN 1.0
                     ELIF metrics.error_rate < 0.01 THEN 0.7
                     ELSE 0.3
    }

    weights = {capture: 0.30, wal: 0.25, connector: 0.20, consumer: 0.15, error: 0.10}
    health = sum(scores[k] * weights[k] for k in scores)

    RETURN {
        score: health,
        grade: "A" if health > 0.9 else "B" if health > 0.7
               else "C" if health > 0.5 else "F",
        breakdown: scores
    }
```

### Golden Signals per Pipeline Stage

| Stage | Latency Signal | Error Signal | Saturation Signal | Traffic Signal |
|-------|---------------|-------------|-------------------|---------------|
| Source capture | `lag_ms` | `connection_errors` | `wal_disk_pct` | `events_per_sec` |
| Serialization | `serialize_latency_p99` | `schema_failures` | `schema_cache_hit_ratio` | `events_serialized_per_sec` |
| Publishing | `producer_send_latency_p99` | `producer_errors` | `producer_buffer_pct` | `bytes_produced_per_sec` |
| Consumer delivery | `consumer_lag_seconds` | `consumer_errors` | `consumer_group_lag_messages` | `events_consumed_per_sec` |
| Sink write | `sink_write_latency_p99` | `sink_write_errors` | `sink_queue_depth` | `sink_writes_per_sec` |

---

## End-to-End Consistency Auditing

### Continuous Verification Pipeline

CDC pipelines can silently lose or corrupt events without obvious symptoms. A consistency auditing system compares source and sink state to detect drift.

```
FUNCTION audit_cdc_consistency(source_db, sink_store, table, sample_pct):
    // Run periodically (hourly for critical tables, daily for others)

    // Step 1: Sample source rows
    source_count = source_db.query("SELECT COUNT(*) FROM {table}")
    sample_keys = source_db.query(
        "SELECT pk FROM {table} TABLESAMPLE BERNOULLI({sample_pct})"
    )

    // Step 2: Compare each sampled row
    mismatches = []
    missing_in_sink = []
    FOR EACH key IN sample_keys:
        source_row = source_db.get(table, key)
        sink_row = sink_store.get(table, key)

        IF sink_row IS NULL:
            missing_in_sink.append(key)
        ELIF NOT rows_equal(source_row, sink_row):
            // Allow for CDC lag: check if a recent event exists for this key
            last_event_ts = get_last_event_ts(table, key)
            IF (now() - last_event_ts) > lag_tolerance:
                mismatches.append({key, source_row, sink_row})

    // Step 3: Report
    mismatch_rate = (len(mismatches) + len(missing_in_sink)) / len(sample_keys)
    IF mismatch_rate > 0.001:  // > 0.1% mismatch
        alert("CDC consistency degradation", table, mismatch_rate)
    IF mismatch_rate > 0.05:  // > 5% mismatch
        trigger_incremental_snapshot(table)

    emit_metric("cdc.audit.mismatch_rate", mismatch_rate, table=table)
    emit_metric("cdc.audit.missing_in_sink", len(missing_in_sink), table=table)
```

### Audit Frequency by Table Criticality

| Table Tier | Examples | Audit Frequency | Sample Size | Action on Mismatch |
|-----------|---------|----------------|-------------|-------------------|
| Tier 1 (critical) | orders, payments, inventory | Every hour | 1% of rows | Alert + auto re-snapshot |
| Tier 2 (important) | users, products, reviews | Every 6 hours | 0.5% of rows | Alert + manual investigation |
| Tier 3 (standard) | logs, analytics, metadata | Daily | 0.1% of rows | Alert only |
