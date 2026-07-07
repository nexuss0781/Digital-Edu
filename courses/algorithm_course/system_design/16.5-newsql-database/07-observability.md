# Observability — NewSQL Database

## Metrics (USE/RED)

### Key Metrics to Track

#### SQL Layer Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `sql.query.latency_ms` | Histogram | Query execution time by type (SELECT, INSERT, UPDATE, DELETE) | p99 > 50ms (point), > 500ms (complex) |
| `sql.query.throughput` | Rate | Queries per second by type | — |
| `sql.query.errors` | Counter | Failed queries by error class (serialization, timeout, syntax) | > 0.1% error rate |
| `sql.connections.active` | Gauge | Active client connections | > 80% of max_connections |
| `sql.connections.waiting` | Gauge | Connections waiting for execution slot | > 50 |
| `sql.plan_cache.hit_ratio` | Gauge | SQL plan cache reuse rate | < 80% |
| `sql.txn.commit_latency_ms` | Histogram | End-to-end transaction commit time | p99 > 100ms |
| `sql.txn.abort_rate` | Rate | Transaction abort rate (serialization failures, deadlocks) | > 5% |
| `sql.txn.restart_count` | Counter | Transaction restarts due to read uncertainty or conflicts | > 100/min |

#### Distributed KV Layer Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `kv.range.count` | Gauge | Total ranges in cluster | — |
| `kv.range.splits_per_min` | Rate | Range split frequency | > 100/min (excessive) |
| `kv.range.merges_per_min` | Rate | Range merge frequency | — |
| `kv.intent.count` | Gauge | Outstanding write intents (unresolved) | > 100K |
| `kv.intent.resolve_latency_ms` | Histogram | Time to resolve write intents | p99 > 500ms |
| `kv.leaseholder.transfers_per_min` | Rate | Lease transfers between nodes | > 50/min |
| `kv.request.latency_ms` | Histogram | KV request latency (Get, Put, Scan) | p99 > 20ms |
| `kv.batch.request_size` | Histogram | Bytes per KV batch request | — |

#### Raft Consensus Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `raft.leader.count_per_node` | Gauge | Raft leaders on each node | Imbalance > 20% |
| `raft.proposal.latency_ms` | Histogram | Time from proposal to commit | p99 > 50ms |
| `raft.proposal.dropped` | Counter | Proposals dropped (no leader, queue full) | > 10/min |
| `raft.log.behind` | Gauge | Entries follower is behind leader | > 1000 entries |
| `raft.heartbeat.failures` | Counter | Missed heartbeats | > 5/min per group |
| `raft.elections` | Counter | Leader elections triggered | > 5/hour |
| `raft.snapshot.sent` | Counter | Raft snapshots sent to catch up followers | > 10/hour |
| `raft.apply.latency_ms` | Histogram | Time to apply committed entries to state machine | p99 > 20ms |

#### Storage Engine Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `storage.block_cache.hit_ratio` | Gauge | LSM block cache hit rate | < 85% |
| `storage.compaction.pending_bytes` | Gauge | Bytes pending compaction | > 10 GB |
| `storage.compaction.write_amp` | Gauge | Write amplification factor (bytes written / bytes ingested) | > 30x |
| `storage.lsm.read_amp` | Gauge | Read amplification (files checked per read) | > 20 |
| `storage.wal.fsync_latency_ms` | Histogram | WAL fsync duration | p99 > 20ms |
| `storage.disk.utilization` | Gauge | Disk space usage percentage | > 70% |
| `storage.disk.iops` | Gauge | Disk I/O operations per second | > 80% of max |

#### Clock and Timestamp Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `clock.offset_ms` | Gauge | Estimated clock offset from cluster peers | > 150ms |
| `clock.uncertainty_interval_ms` | Gauge | Current read uncertainty window size | > 500ms |
| `txn.read_restarts` | Counter | Transactions restarted due to clock uncertainty | > 50/min |
| `clock.ntp_status` | Gauge | NTP synchronization status (0=synced, 1=degraded, 2=lost) | > 0 |

### Dashboard Design

**Dashboard 1: Cluster Overview**
- Total nodes, ranges, and replicas (gauges)
- Query throughput by type (time series)
- Active transactions (gauge)
- Cluster-wide latency percentiles (time series)
- Node health matrix (heatmap)

**Dashboard 2: Query Performance**
- Query latency distribution (histogram by type)
- Top 10 slowest query fingerprints (table)
- Plan cache hit ratio (gauge)
- Transaction abort/restart rate (time series)
- Serialization conflicts (counter)

**Dashboard 3: Raft Health**
- Leader distribution across nodes (bar chart)
- Proposal latency (time series by percentile)
- Elections per hour (counter)
- Replication lag per range (heatmap)
- Raft snapshot frequency (counter)

**Dashboard 4: Storage & Capacity**
- Disk usage per node (stacked bar)
- Block cache hit ratio (gauge per node)
- Compaction throughput and pending bytes (time series)
- Write amplification trend (time series)
- LSM level sizes (stacked area)

**Dashboard 5: Clock & Transaction Integrity**
- Clock offset per node (time series)
- Read uncertainty interval (gauge)
- Transaction restart rate (time series)
- Intent count and resolution rate (time series)

**Dashboard 6: Multi-Region Health**
- Per-region leaseholder count (bar chart)
- Cross-region write latency by region pair (time series)
- Follower read staleness distribution (histogram)
- Under-replicated ranges by region (counter)
- Cross-region network bandwidth (time series)

**Dashboard 7: Schema Change Progress**
- Active schema changes and their stage (table)
- Backfill progress by range (progress bar)
- Schema version distribution across nodes (bar chart)
- Schema change estimated time remaining (gauge)

---

### Golden Signals Summary

| Signal | Primary Metric | Secondary Metrics |
|--------|---------------|-------------------|
| **Latency** | `sql.query.latency_ms` p99 by type | `kv.request.latency_ms`, `raft.proposal.latency_ms` |
| **Traffic** | `sql.query.throughput` (QPS by type) | `kv.batch.request_size`, active connections |
| **Errors** | `sql.query.errors` by error class | `sql.txn.abort_rate`, `raft.proposal.dropped` |
| **Saturation** | CPU utilization, disk I/O %, memory pressure | `storage.compaction.pending_bytes`, `kv.intent.count`, ranges per node |

**Interpretation guide:**
- High latency + low error rate = likely contention (check intent count and transaction conflicts)
- High latency + high error rate = likely resource exhaustion (check CPU, disk, memory)
- Normal latency + rising saturation = approaching capacity cliff (proactive scaling needed)
- Low latency + rising errors = clock skew or network issues (check `clock.offset_ms`, Raft heartbeat failures)

---

## Logging

### What to Log

| Event | Log Level | Content |
|-------|-----------|---------|
| Query execution | INFO | Query fingerprint (parameters redacted), latency, rows affected, plan used |
| Slow query | WARN | Full query plan, actual vs. estimated rows, ranges touched, wait events |
| Transaction commit/abort | INFO | Transaction ID, duration, ranges touched, abort reason (if aborted) |
| Serialization conflict | WARN | Conflicting transaction IDs, contended key, resolution (push/abort) |
| Read uncertainty restart | INFO | Transaction ID, original timestamp, new timestamp, conflicting value timestamp |
| Range split/merge | INFO | Range ID, split key, new range IDs, trigger reason |
| Raft leader election | INFO | Range ID, old leader, new leader, election duration, reason |
| Schema change | INFO | DDL statement, user, job ID, progress |
| Authentication failure | WARN | Client IP, username, failure reason |
| Node join/leave | INFO | Node ID, address, join/decommission status |

### Log Levels Strategy

| Level | Production Volume | Use Case |
|-------|------------------|----------|
| ERROR | < 100/min | Data corruption, Raft quorum loss, unrecoverable failures |
| WARN | < 1,000/min | Slow queries, serialization conflicts, clock skew, auth failures |
| INFO | < 10,000/min | Query summaries, transaction outcomes, range operations |
| DEBUG | Disabled in prod | Raft message details, KV request tracing, optimizer decisions |
| TRACE | Never in prod | Per-key MVCC lookups, block cache operations, intent resolution steps |

### Structured Logging Format

```
{
  "timestamp": "2026-03-10T14:32:01.234Z",
  "level": "WARN",
  "component": "sql_executor",
  "event": "slow_query",
  "query_id": "q-abc-123",
  "node_id": "n3",
  "query_fingerprint": "SELECT * FROM orders WHERE user_id = $1 AND status = $2",
  "execution_time_ms": 850,
  "rows_returned": 1247,
  "ranges_touched": 8,
  "cross_range_requests": 3,
  "plan": "DistScan(orders@idx_user_status) → Filter → Limit",
  "estimated_rows": 100,
  "actual_rows": 1247,
  "intent_encounters": 2,
  "user": "app-service-prod",
  "client_ip": "10.0.1.42"
}
```

---

### Anti-Patterns in Monitoring

| Anti-Pattern | Problem | Better Approach |
|-------------|---------|----------------|
| Alerting on raw QPS | QPS changes don't indicate problems — load varies naturally | Alert on error rate, latency percentiles, and SLO burn rate |
| Monitoring only averages | Averages hide tail latency; p50=5ms but p99=500ms looks fine on average | Monitor p50, p95, p99, and p99.9 separately |
| Per-node alerts only | A problem on one range affects a different set of nodes depending on replica placement | Add per-range metrics alongside per-node metrics |
| Alerting on clock offset without context | Small offset spikes during NTP sync are normal | Alert on sustained offset + correlation with read restart rate |
| Monitoring compaction by job count | Many small compactions are fine; one stalled large compaction is critical | Monitor pending compaction bytes and L0 file count, not job count |
| No baseline for normal behavior | Every metric change triggers investigation | Establish baselines per workload; alert on deviation from baseline |

---

## Distributed Tracing

### Trace Propagation Strategy

A single SQL query in a NewSQL database may touch multiple nodes, ranges, and Raft groups. The trace forms a tree rooted at the SQL gateway, with branches to each range involved in the query.

```
Client Request (SELECT ... JOIN ... WHERE ...)
  └── SQL Gateway (parse, optimize, distribute)
        ├── KV Request to Range R1 (Node 1)
        │     └── LSM-Tree read (block cache hit/miss)
        ├── KV Request to Range R2 (Node 2)
        │     ├── LSM-Tree read
        │     └── Intent resolution (check txn record on Node 3)
        ├── KV Request to Range R3 (Node 3)
        │     └── LSM-Tree read
        └── Merge Results → Return to Client
```

### Key Spans to Instrument

| Span | Parent | Key Attributes |
|------|--------|---------------|
| `sql.parse` | Root | query_fingerprint, parameter_count |
| `sql.optimize` | Root | plan_type, estimated_cost, plan_cache_hit |
| `sql.execute` | Root | total_rows, execution_time, ranges_touched |
| `kv.batch_request` | execute | target_node, range_id, request_type |
| `kv.get` / `kv.scan` | batch_request | key, bytes_read, cache_hit |
| `raft.propose` | kv.put | range_id, proposal_size, consensus_latency |
| `raft.apply` | propose | apply_latency, state_machine_bytes |
| `txn.resolve_intent` | kv.get | blocking_txn_id, resolution, wait_time |
| `storage.lsm_read` | kv.get | levels_checked, bloom_filter_hit, block_cache_hit |

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| **Raft quorum loss** | Range has < majority healthy replicas for > 60s | P1 | Check node health; restore or replace failed replicas |
| **Node unreachable** | Node heartbeat missed for > 30s | P1 | Check node process, network; initiate decommission if unrecoverable |
| **Clock skew critical** | Node clock offset > 500ms | P1 | Check NTP; quarantine node if offset grows |
| **Data corruption** | Consistency check failure | P1 | Stop writes to affected range; restore from backup |
| **Disk full** | > 95% disk utilization | P1 | Emergency: expand storage or drop non-critical data |

### Warning Alerts

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| **High transaction abort rate** | > 10% abort rate for > 5 min | P2 | Review contention patterns; optimize hot keys |
| **Slow query spike** | p99 latency > 500ms for > 5 min | P2 | Review slow query log; check plan cache, stats freshness |
| **Replication lag** | Raft follower > 30s behind leader | P2 | Check follower node I/O; consider snapshot |
| **Compaction backlog** | Pending compaction > 50 GB | P2 | Check I/O bandwidth; adjust compaction priority |
| **Block cache degradation** | Hit ratio < 80% for > 10 min | P3 | Review working set size; consider adding memory |
| **Range imbalance** | Range count variance > 30% across nodes | P3 | Trigger rebalancing; check for split/merge issues |
| **Excessive elections** | > 20 elections/hour | P3 | Check network stability; review heartbeat timeouts |

### Runbook References

| Runbook | Scenario | Key Steps |
|---------|----------|-----------|
| RB-001 | Raft leader failover | Verify quorum → Check follower logs → Confirm election → Validate client recovery |
| RB-002 | Clock skew remediation | Verify NTP sources → Check offset trend → Quarantine if growing → Restart NTP |
| RB-003 | Hot range mitigation | Identify hot range → Check key distribution → Apply hash-sharded index or manual split |
| RB-004 | Compaction stall | Check Level 0 file count → Adjust compaction priority → Throttle writes if necessary |
| RB-005 | Serialization conflict storm | Identify contended keys → Review transaction patterns → Batch writes or redesign schema |
| RB-006 | Intent backlog accumulation | Check intent count → Verify resolver threads running → Restart resolver if stalled → Throttle new writes |
| RB-007 | Cross-region latency spike | Check network connectivity → Verify Raft quorum placement → Route traffic to local leaseholders |
| RB-008 | MVCC GC lag | Check GC protected timestamps → Identify long-running transactions → Abort stale transactions → Resume GC |

---

## SLO Dashboard Design

### Primary SLO Panel

```
╔══════════════════════════════════════════════════════════════════╗
║ NEWSQL DATABASE SLO DASHBOARD                    [Last 24h]     ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Availability     ████████████████████████░  99.997%  (SLO: 99.999%)║
║  Read Latency p99 ████████████████████████▓  8.2ms   (SLO: <10ms)  ║
║  Write Latency p99████████████████████░░░░░  16.4ms  (SLO: <20ms)  ║
║  Txn Latency p99  ████████████████████████░  42ms    (SLO: <50ms)  ║
║  Error Rate       █░░░░░░░░░░░░░░░░░░░░░░░  0.0003% (SLO: <0.001%)║
║                                                                  ║
║  Error Budget Remaining:                                         ║
║  ├── Availability:  72% remaining (1.4 min used of 5.26 min)    ║
║  ├── Read Latency:  81% remaining                                ║
║  └── Write Latency: 45% remaining ⚠️ (burn rate: 2.1x)          ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### Error Budget Policy

```
FUNCTION evaluate_error_budget(slo, window=30_days):
    budget_total = (1.0 - slo.target) × window
    budget_consumed = count_violations(slo, window) / total_requests(window)
    budget_remaining = 1.0 - (budget_consumed / (1.0 - slo.target))

    // Fast burn: >2% budget consumed in 1 hour
    IF burn_rate(slo, window=1_hour) > 14.4:  // 14.4x = 2% in 1hr
        ALERT severity=P1, message="Fast error budget burn"
        ACTION: freeze non-critical deployments

    // Slow burn: >5% budget consumed in 6 hours
    IF burn_rate(slo, window=6_hours) > 6.0:
        ALERT severity=P2, message="Sustained error budget burn"
        ACTION: investigate root cause

    // Budget exhausted
    IF budget_remaining <= 0:
        ALERT severity=P1, message="Error budget exhausted"
        ACTION: halt all changes; focus on reliability
```

---

## Operational Runbooks

### Runbook 1: High Transaction Abort Rate (>10% for >5 minutes)

**Severity:** SEV-2

**Symptoms:**
- `sql.txn.abort_rate` exceeds 10% sustained
- `sql.txn.restart_count` spikes
- Application-side "serialization failure" errors increase

**Diagnosis steps:**
1. Identify contended keys: `SELECT key, count(*) FROM system.contention_events GROUP BY key ORDER BY count DESC LIMIT 10`
2. Check if contention is from transaction conflicts or read restarts (clock uncertainty)
3. Review slow query log for transactions holding intents for extended periods
4. Check for lock-step transaction patterns (multiple clients writing to the same key in tight loops)

**Resolution:**
- If key contention: redesign schema to distribute writes (hash-sharded index, application bucketing)
- If clock-related restarts: check NTP synchronization; upgrade to chrony/PTP
- If long-running transactions: add statement timeout; break large transactions into smaller batches
- If deadlock cycles: review transaction ordering; apply consistent key ordering in application

### Runbook 2: Raft Quorum Loss for System Range

**Severity:** SEV-1 (Critical)

**Symptoms:**
- `raft.quorum.loss` alert fires for system ranges
- Cluster cannot process new range lookups
- All writes stall (dependent on metadata ranges)

**Diagnosis steps:**
1. Identify affected system range: `SHOW RANGES FROM TABLE system.descriptors WHERE status = 'unavailable'`
2. Check which nodes hosted the lost replicas
3. Verify network connectivity between surviving nodes
4. Check if surviving replicas have current Raft log

**Resolution:**
1. **If 1 replica lost (2 of 3 survive):** Quorum intact — monitor automatic re-replication. No immediate action.
2. **If 2 replicas lost (1 of 3 survives):** Quorum lost. Attempt unsafe recovery:
   - Verify surviving replica has the latest committed log entries
   - Use manual recovery tool to designate surviving replica as sole voter
   - Add new replicas from the surviving copy
   - **WARNING:** This may lose uncommitted transactions
3. **If all 3 replicas lost:** Restore from backup; data since last backup is lost

### Runbook 3: Compaction Stall (L0 Files >30)

**Severity:** SEV-2

**Symptoms:**
- `storage.compaction.pending_bytes` exceeds 50 GB
- `storage.lsm.level0_files` exceeds 30
- Write latency increasing (admission control throttling)
- `storage.compaction.write_amp` may be elevated

**Diagnosis steps:**
1. Check which node and store has the compaction backlog
2. Review disk I/O utilization: is the disk saturated?
3. Check if a large range split or rebalancing operation created a burst of L0 files
4. Review compaction rate limits: are they too restrictive?

**Resolution:**
1. Temporarily increase compaction thread count and I/O budget
2. If disk is saturated: reduce foreground write rate via admission control
3. If single range is generating excessive writes: split the hot range
4. If sustained: add storage capacity or switch to tiered compaction for write-heavy workload

---

## End-to-End Transaction Tracing

### Annotated Distributed Transaction Trace

```
Trace ID: txn-abc-123   Duration: 18.4ms   Ranges touched: 3

Timeline:
  0.0ms  [SQL Gateway]      Parse SQL: "BEGIN; INSERT INTO orders...; UPDATE accounts...; COMMIT"
  0.2ms  [Query Optimizer]   Plan: INSERT→R1, UPDATE→R2; parallel execution
  0.4ms  [Txn Coordinator]   Assign HLC timestamp: (1709856000.000, 42)
  0.5ms  [Txn Coordinator]   Begin parallel intent writes

  0.5ms  ├─[KV → Range R1]   Write intent (orders, key=1001, txn=abc-123)
  0.6ms  │  ├─[Raft R1]      Propose entry #4521 to 3 replicas
  1.0ms  │  ├─[Raft R1]      Follower Node2 ACK (0.4ms network)
  1.2ms  │  ├─[Raft R1]      Follower Node3 ACK (0.6ms network)
  1.2ms  │  ├─[Raft R1]      Quorum achieved (2/3)
  1.3ms  │  └─[LSM R1]       Apply to memtable + WAL fsync (0.1ms)
  1.4ms  │  Intent written successfully

  0.5ms  ├─[KV → Range R2]   Write intent (accounts, key=42, txn=abc-123)
  0.7ms  │  ├─[Raft R2]      Propose entry #7832 to 3 replicas
  1.1ms  │  ├─[Raft R2]      Follower Node1 ACK (0.4ms)
  3.5ms  │  ├─[Raft R2]      Follower Node3 ACK (2.8ms — slow disk)  ← SLOW REPLICA
  1.1ms  │  ├─[Raft R2]      Quorum achieved (2/3, didn't wait for slow replica)
  1.2ms  │  └─[LSM R2]       Apply to memtable + WAL fsync
  1.3ms  │  Intent written successfully

  1.5ms  [Txn Coordinator]   All intents written; begin parallel commit

  1.5ms  ├─[KV → Range R1]   Write STAGING txn record (txn=abc-123)
  1.6ms  │  ├─[Raft R1]      Propose STAGING record
  2.0ms  │  └─[Raft R1]      Quorum achieved
  2.1ms  │  STAGING record durable

  1.5ms  ├─[Verify]          Verify all intents present (already confirmed)

  2.1ms  [Txn Coordinator]   STAGING + all intents durable → COMMITTED
  2.2ms  [SQL Gateway]       Return "COMMIT OK" to client

  === Async intent resolution (after client response) ===
  2.5ms  [Resolver]          Resolve intent on R1: convert to committed MVCC value
  3.0ms  [Resolver]          Resolve intent on R2: convert to committed MVCC value
 18.4ms  [Resolver]          Delete txn record (abc-123) → COMMITTED final

Total client-visible latency: 2.2ms
Background cleanup: 16.2ms (invisible to client)
```

### Trace-Based Alerting Rules

| Rule | Condition | Severity |
|------|-----------|----------|
| Slow Raft consensus | Any Raft proposal > 50ms | P3 |
| Intent encounter on read | Read blocked >5ms waiting for intent resolution | P3 (>10/min: P2) |
| Cross-range transaction >100ms | Distributed transaction exceeds 100ms total | P2 |
| WAL fsync >20ms | Storage engine fsync exceeds 20ms | P2 |
| Lease transfer during transaction | Active transaction disrupted by lease transfer | P3 |
| Clock uncertainty restart | Transaction restarted due to read uncertainty | P3 (>50/min: P2) |

---

## Data Quality Monitoring

### Database Integrity Checks

| # | Check | Frequency | Method |
|---|-------|-----------|--------|
| 1 | **Range coverage completeness** | Hourly | Verify all table key spans are covered by exactly one range with no gaps or overlaps |
| 2 | **Replica consistency** | Daily | Compare checksums of range data across replicas; flag divergence |
| 3 | **Intent orphan detection** | Every 6 hours | Find intents whose transaction record no longer exists (abandoned transactions) |
| 4 | **Schema version consistency** | Continuous | Verify all nodes are within 1 schema version of each other |
| 5 | **Raft log consistency** | Daily | Compare committed Raft log entries across replicas for divergence |
| 6 | **Statistics freshness** | Hourly | Alert if table statistics are older than 24 hours (may cause suboptimal query plans) |

### Capacity Planning Metrics

| Metric | What to Track | Why |
|--------|-------------|-----|
| Range growth rate | New ranges per day (splits minus merges) | Predicts when nodes will hit the ranges-per-node ceiling |
| Storage growth rate | TB added per week across cluster | Predicts when additional storage or nodes needed |
| MVCC version ratio | Total MVCC bytes / logical data bytes | >3x indicates GC is falling behind or window is too long |
| Cross-range transaction % | Percentage of transactions touching >1 range | >50% suggests schema redesign may improve performance |
| Intent accumulation rate | Net intent creation rate (created minus resolved per second) | Positive trend indicates resolver backlog building |
| Compaction debt | Pending compaction bytes / compaction throughput | >30 minutes of debt risks write stalls |

### Health Check Endpoint Design

```
GET /health/ready → 200 OK (node is accepting SQL connections)
GET /health/live  → 200 OK (process is alive; may be starting up)
GET /health/deep  → JSON with subsystem status:

{
  "status": "healthy",
  "node_id": "n3",
  "checks": {
    "raft": {"status": "ok", "leader_ranges": 342, "follower_ranges": 658},
    "storage": {"status": "ok", "disk_used_pct": 45, "compaction_pending_gb": 2.1},
    "clock": {"status": "ok", "offset_ms": 12, "ntp_synced": true},
    "sql": {"status": "ok", "active_connections": 87, "active_queries": 23},
    "replication": {"status": "warning", "under_replicated_ranges": 3}
  },
  "version": "v24.2.1",
  "uptime_seconds": 864000
}
```
