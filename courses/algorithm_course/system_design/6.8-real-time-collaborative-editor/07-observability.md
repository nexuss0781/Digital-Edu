# Observability

## Metrics (USE/RED)

### Key Metrics

| Category | Metric | Type | Description |
|----------|--------|------|-------------|
| **Utilization** | `sync_server.active_documents` | Gauge | Documents loaded in memory per server |
| **Utilization** | `ws_gateway.connections` | Gauge | Active WebSocket connections |
| **Utilization** | `sync_server.crdt_memory_mb` | Gauge | Memory used by CRDT state |
| **Saturation** | `merge_queue.depth` | Gauge | Pending offline merges |
| **Saturation** | `ws_gateway.connections_rejected` | Counter | Connections rejected (capacity) |
| **Errors** | `sync_server.merge_errors` | Counter | CRDT merge failures |
| **Errors** | `oplog.write_failures` | Counter | Operation log write failures |
| **Rate** | `sync_server.operations_per_sec` | Rate | Operations processed per second |
| **Rate** | `ws_gateway.messages_per_sec` | Rate | WebSocket messages per second |
| **Duration** | `sync_server.merge_latency_ms` | Histogram | Time to merge a remote update |
| **Duration** | `sync_server.broadcast_latency_ms` | Histogram | Time from receive to all-client broadcast |
| **Duration** | `document.load_latency_ms` | Histogram | Document initial load time |
| **Duration** | `offline_merge.duration_ms` | Histogram | Offline merge reconciliation time |

### Collaboration-Specific Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `crdt.convergence_check_failures` | Periodic convergence verification failures | Any > 0 (critical) |
| `crdt.tombstone_ratio` | Ratio of tombstoned to live items | > 50% (warning) |
| `document.concurrent_editors` | Editors per document | > 200 (scale alert) |
| `presence.stale_cursors` | Cursors not updated in > 30s | > 10% of total (warning) |
| `offline.pending_merges` | Clients with unsynced offline changes | > 1000 (capacity alert) |
| `sync.state_vector_size` | Size of state vectors being exchanged | > 1MB (bloat alert) |
| `block_tree.depth` | Maximum nesting depth per document | > 15 (potential perf issue) |
| `block_tree.orphaned_blocks` | Blocks with no valid parent | Any > 0 (bug indicator) |

### Dashboard Design

#### Primary Dashboard: Real-Time Collaboration Health

```
┌─────────────────────────────────────────────────────────┐
│ REAL-TIME COLLABORATION DASHBOARD                        │
├─────────────────┬──────────────────┬────────────────────┤
│ Active Docs     │ Concurrent Users │ Operations/sec     │
│ 342,891         │ 1,247,003        │ 3,891,204          │
│ ▲ 12% vs 1h ago│ ▲ 8%             │ ▼ 3%               │
├─────────────────┴──────────────────┴────────────────────┤
│ EDIT PROPAGATION LATENCY (p50/p95/p99)                  │
│ ████████████ 23ms / 89ms / 187ms                        │
├─────────────────────────────────────────────────────────┤
│ MERGE ERRORS (last 1h)           │ CONVERGENCE CHECKS  │
│ ░░░░░░░░░░░░░░░░░░ 0            │ ████████ All Pass    │
├──────────────────────────────────┴──────────────────────┤
│ OFFLINE CLIENTS PENDING SYNC                             │
│ ████████░░░░░░░░░░ 2,341 clients (0.19% of total)      │
├─────────────────────────────────────────────────────────┤
│ TOP 10 DOCUMENTS BY CONCURRENT EDITORS                   │
│ Doc-abc123: 147 editors │ Doc-def456: 89 editors │ ...  │
└─────────────────────────────────────────────────────────┘
```

#### Secondary Dashboard: CRDT Health

```
┌─────────────────────────────────────────────────────────┐
│ CRDT ENGINE HEALTH                                       │
├─────────────────┬──────────────────┬────────────────────┤
│ Avg CRDT Memory │ Tombstone Ratio  │ GC Runs (1h)       │
│ 2.3 MB/doc      │ 18%              │ 1,247              │
├─────────────────┴──────────────────┴────────────────────┤
│ OPERATION TYPES DISTRIBUTION                             │
│ text_insert: 45% | text_delete: 22% | block_ops: 18%   │
│ format: 10% | move: 3% | property: 2%                  │
├─────────────────────────────────────────────────────────┤
│ SNAPSHOT CREATION                    │ OP LOG WRITES     │
│ Rate: 1,200/min  Failures: 0        │ 8.1M/sec  OK      │
├──────────────────────────────────────┴──────────────────┤
│ STATE VECTOR SIZE DISTRIBUTION                           │
│ p50: 128B | p95: 2KB | p99: 12KB | max: 89KB           │
└─────────────────────────────────────────────────────────┘
```

### Alerting Thresholds

| Severity | Metric | Threshold | Action |
|----------|--------|-----------|--------|
| **P0 Critical** | `crdt.convergence_check_failures` | > 0 | Page on-call; potential data corruption |
| **P0 Critical** | `oplog.write_failures` sustained | > 0 for 30s | Page on-call; durability at risk |
| **P1 High** | `sync_server.broadcast_latency_ms` p99 | > 500ms | Investigate sync server load |
| **P1 High** | `merge_queue.depth` | > 200 | Scale merge workers |
| **P2 Medium** | `document.load_latency_ms` p99 | > 2s | Check snapshot availability, cache hit rates |
| **P2 Medium** | `ws_gateway.connections_rejected` | > 100/min | Scale WebSocket gateways |
| **P3 Low** | `crdt.tombstone_ratio` | > 40% | Schedule garbage collection |
| **P3 Low** | `presence.stale_cursors` | > 20% | Check presence heartbeat config |

---

## Logging

### What to Log

| Event | Level | Fields | Purpose |
|-------|-------|--------|---------|
| Document opened | INFO | doc_id, user_id, load_time_ms, source (cache/snapshot/replay) | Performance tracking |
| WebSocket connected | INFO | user_id, doc_id, client_id, region | Connection monitoring |
| WebSocket disconnected | INFO | user_id, doc_id, reason, duration | Session analysis |
| Operation merged | DEBUG | doc_id, op_type, op_size_bytes, merge_time_us | Debugging (sampled 1%) |
| Offline merge started | INFO | user_id, doc_id, ops_count, offline_duration | Offline pattern analysis |
| Offline merge completed | INFO | user_id, doc_id, merge_time_ms, conflicts_count | Merge performance |
| Permission denied | WARN | user_id, doc_id, attempted_action | Security monitoring |
| CRDT merge error | ERROR | doc_id, error_type, op_data (redacted), stack_trace | Bug investigation |
| Convergence check failed | CRITICAL | doc_id, client_states_hash, server_state_hash | Data integrity |
| Snapshot created | INFO | doc_id, snapshot_size, ops_since_last | Storage management |

### Structured Log Format

```
{
  "timestamp": "2026-03-08T14:23:45.123Z",
  "level": "INFO",
  "service": "sync-server",
  "instance": "sync-us-east-1-a-003",
  "trace_id": "abc123def456",
  "span_id": "789ghi",
  "event": "offline_merge_completed",
  "doc_id": "doc-uuid-abc",
  "user_id": "user-uuid-xyz",
  "client_id": "device-123",
  "ops_count": 247,
  "offline_duration_hours": 2.5,
  "merge_time_ms": 340,
  "conflicts_resolved": 3,
  "final_doc_size_blocks": 156
}
```

### Log Levels Strategy

| Level | When | Sampling |
|-------|------|----------|
| CRITICAL | Data integrity issues, convergence failures | 100% (always) |
| ERROR | Merge failures, write failures, crash recovery | 100% |
| WARN | Permission denials, rate limiting, large documents | 100% |
| INFO | Session lifecycle, offline merges, snapshots | 100% |
| DEBUG | Individual operations, CRDT state details | 1% sampling (configurable) |

---

## Distributed Tracing

### Trace Propagation

```
Client Edit → WebSocket Gateway → Sync Server → Operation Log
     ↓              ↓                 ↓              ↓
  [span:          [span:           [span:         [span:
   client_edit]    ws_receive]      crdt_merge]    oplog_write]
                                     ↓
                                  [span:
                                   broadcast]
                                     ↓
                               [span: peer_receive] (per client)
```

Trace context is embedded in every WebSocket message as a header, propagated through the sync server to the operation log and broadcast path.

### Key Spans to Instrument

| Span | Parent | What It Captures |
|------|--------|-----------------|
| `client.edit` | Root | User action to local CRDT apply (client-side) |
| `ws.send` | `client.edit` | Network send time |
| `gateway.receive` | `ws.send` | Gateway processing (auth check, routing) |
| `sync.merge` | `gateway.receive` | CRDT merge processing time |
| `sync.validate` | `sync.merge` | Permission and schema validation |
| `oplog.write` | `sync.merge` | Operation log persistence |
| `sync.broadcast` | `sync.merge` | Fan-out to all connected clients |
| `peer.receive` | `sync.broadcast` | Per-client delivery and render |
| `offline.merge` | Root | Full offline reconciliation flow |
| `snapshot.create` | Root | Periodic snapshot creation |

### Critical Trace: End-to-End Edit Propagation

```
Total latency budget: 300ms (p99 target)

Client edit:        5ms  ████
Network send:      30ms  ██████████████
Gateway receive:    2ms  █
CRDT merge:        10ms  ████████
Validation:         3ms  ██
OpLog write:       15ms  ██████████
Broadcast (fan):   20ms  █████████████
Network deliver:   30ms  ██████████████
Peer CRDT merge:   10ms  ████████
Peer render:        5ms  ████
─────────────────────────
Total:            130ms  (typical)
```

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Runbook |
|-------|-----------|---------|
| **CRDT Convergence Failure** | Any convergence check fails | Isolate affected document; compare client/server states; trigger forced snapshot reconciliation |
| **Operation Log Write Failure** | Write failures > 0 for 30s | Check storage health; verify replication; failover to standby partition |
| **Sync Server OOM** | Memory > 90% on any sync server | Identify oversized documents; trigger CRDT garbage collection; evict inactive docs |
| **WebSocket Mass Disconnect** | > 10% connections drop in 1 min | Check gateway health; verify network; potential deployment issue |

### Warning Alerts

| Alert | Condition | Response |
|-------|-----------|----------|
| Edit propagation latency high | p99 > 500ms for 5 min | Check sync server load distribution; identify hot documents |
| Merge queue backing up | Depth > 100 for 5 min | Scale merge workers; check for stuck merges |
| Tombstone ratio high | > 40% on any document | Schedule targeted garbage collection |
| Cache hit rate dropping | < 80% for 10 min | Check cache health; warm cache from snapshots |
| Large offline merge | > 10K ops in single merge | Monitor completion; prepare for potential slow merge |

### Runbook References

| Scenario | Runbook |
|----------|---------|
| Document corruption detected | `runbook/crdt-corruption-recovery.md` |
| Sync server failover | `runbook/sync-server-failover.md` |
| Mass offline reconnection storm | `runbook/reconnection-storm.md` |
| WebSocket gateway scaling | `runbook/ws-gateway-scaling.md` |
| Operation log partition full | `runbook/oplog-partition-management.md` |
| CRDT memory pressure | `runbook/crdt-memory-management.md` |

---

## SLO Monitoring with Error Budgets

| SLO | Target | Error Budget (30-day) | Budget Policy |
|-----|--------|----------------------|---------------|
| Edit propagation p99 < 300ms | 99.9% | 43 minutes | Fast burn: 2% in 1h → page; slow burn: 10% in 24h → ticket |
| Document load p99 < 1s | 99.5% | 3.6 hours | Fast burn: 5% in 1h → page; slow burn: 20% in 24h → investigate |
| CRDT convergence | 100% | 0 (any failure is P0) | Any failure → immediate page, document isolation |
| Operation log durability | 99.999% | 26 seconds | Any write failure sustained > 10s → page |
| WebSocket availability | 99.95% | 21.6 minutes | Fast burn: 5% in 1h → page |
| Offline merge success rate | 99.9% | 43 minutes | Merge failure → retry with full snapshot; 3 failures → page |

### Error Budget Burn Rate Alerts

```
Fast Burn (1-hour window):
  Burn rate > 14.4× → Alert immediately (exhausts 30-day budget in 50 hours)
  Typical cause: Deployment regression, infrastructure failure

Medium Burn (6-hour window):
  Burn rate > 6× → Alert within 30 min
  Typical cause: Gradual performance degradation, cache warming failure

Slow Burn (24-hour window):
  Burn rate > 3× → Create ticket for next business day
  Typical cause: Growing document sizes, tombstone accumulation, traffic growth
```

---

## Synthetic Monitoring

| Test | Frequency | What It Validates | Alert On |
|------|-----------|-------------------|----------|
| **Synthetic edit round-trip** | Every 30s | Full path: create edit → WebSocket → sync server → broadcast → peer receives | Latency > 500ms or failure |
| **Document load** | Every 1 min | Load a test document via API; verify CRDT state integrity | Latency > 2s or wrong content |
| **Offline merge simulation** | Every 5 min | Disconnect synthetic client, make edits, reconnect, verify merge | Merge failure or divergence |
| **WebSocket connection** | Every 30s | Open WebSocket, authenticate, receive sync_init | Connection failure or timeout > 5s |
| **Cross-region sync** | Every 2 min | Edit in Region A, verify propagation to Region B | Latency > 2s or content mismatch |
| **Snapshot creation** | Every 5 min | Trigger snapshot for test document; verify it loads correctly | Snapshot corrupt or creation failure |
| **Search indexing lag** | Every 5 min | Edit document, search for new content | Content not searchable within 60s |

---

## Detailed Runbook Templates

### Runbook: CRDT Convergence Failure

```
Trigger: crdt.convergence_check_failures > 0

Severity: P0 (Critical) — potential data corruption

Immediate Actions (< 5 min):
  1. Identify affected document(s) from alert metadata
  2. Capture diagnostic snapshot:
     - Server CRDT state hash
     - All connected clients' state vector hashes (via WebSocket query)
     - Last 1000 operations from operation log
  3. Isolate the document:
     - Set document to read-only mode (reject new operations)
     - Notify connected users: "Sync temporarily paused, your edits are saved locally"

Investigation (< 30 min):
  4. Compare server state hash vs client state hashes
     - If server matches most clients: one client has diverged
       → Force-sync that client from server snapshot
     - If clients match each other but not server: server state corrupted
       → Rebuild server state from operation log replay
     - If no consensus: collect full CRDT state from each replica for offline analysis
  5. Check operation log integrity:
     - Replay operations from last known-good snapshot
     - Compare replayed state hash with current state hash
     - Identify the divergence point (which operation caused the split)

Resolution:
  6. Apply fix (force-sync, replay, or manual reconciliation)
  7. Run convergence check on all documents on affected sync server shard
  8. Resume read-write mode for the document
  9. Post-incident: file bug report with CRDT operation trace for root cause analysis

Common Causes:
  - CRDT library bug (rare but catastrophic)
  - Binary encoding corruption in transit (check TLS errors)
  - Race condition in snapshot + operation log overlap
  - Clock skew causing incorrect causal ordering
```

### Runbook: Mass Offline Reconnection Storm

```
Trigger: offline.pending_merges > 1000 OR merge_queue.depth > 200 sustained for 5 min

Severity: P1 (High) — merge queue saturation risk

Immediate Actions (< 5 min):
  1. Check cause: Is this a known event (office network restored, ISP outage recovery)?
  2. Scale merge workers to 3× current capacity
  3. Enable reconnection rate limiting:
     - Accept max 100 reconnections/sec per sync server shard
     - Excess clients receive "Retry-After: 30" header
     - Client exponential backoff handles this gracefully

Monitoring During Storm:
  4. Watch merge_queue.depth — should start declining within 10 min
  5. Watch sync_server.crdt_memory_mb — large offline merges can spike memory
  6. Watch oplog.write_latency_ms — sustained spike indicates storage saturation
  7. If memory > 80% on any sync server: evict inactive documents to free capacity

Post-Storm:
  8. Verify all pending merges completed (queue depth = 0)
  9. Run convergence checks on all documents that had offline merges
  10. Review metrics: max offline duration, max ops per merge, any merge failures
  11. Scale merge workers back to normal after 30 min cooldown
```

### Runbook: Sync Server Out-of-Memory

```
Trigger: sync_server.crdt_memory_mb > 90% of allocated memory

Severity: P1 (High) — risk of OOM kill and document failover cascade

Immediate Actions (< 5 min):
  1. Identify top-10 documents by CRDT memory consumption
  2. For oversized documents (> 50MB CRDT state):
     - Trigger emergency CRDT garbage collection (remove eligible tombstones)
     - Expected memory reduction: 20-40%
  3. Evict inactive documents (no edits in last 15 min):
     - Create snapshot before eviction
     - Release memory
     - Documents will reload from snapshot on next access

If Memory Still Critical (> 85% after eviction):
  4. Rebalance: move documents to less-loaded sync server shards
  5. If no capacity: spin up additional sync server instance
  6. As last resort: force document rotation (save snapshot, restart CRDT state from scratch)

Investigation:
  7. Check for tombstone ratio on top consumers (> 50% indicates GC overdue)
  8. Check for abnormally large documents (> 10K blocks may need lazy loading)
  9. Review recent traffic patterns for unusual activity (bot, bulk import)

Prevention:
  - Tune GC frequency based on document access patterns
  - Set per-document memory limit (50MB default); documents exceeding it trigger GC
  - Add proactive alerting at 70% threshold (P2) to catch before crisis
```

---

## Cost of Observability

| Component | Estimated Cost | Notes |
|-----------|---------------|-------|
| Metrics collection & storage | ~8% of compute | High-cardinality metrics (per-document) require careful aggregation |
| Log ingestion & retention | ~5% of storage | DEBUG-level sampling (1%) keeps cost manageable |
| Distributed tracing | ~3% of compute | Trace sampling: 100% for errors, 10% for slow, 1% for normal |
| Synthetic monitoring | ~1% of compute | Dedicated synthetic clients in each region |
| Convergence checks | ~2% of compute | Periodic hash comparison across replicas |
| **Total observability overhead** | **~12% of infrastructure** | Justified by CRDT complexity and data integrity criticality |

The highest-cost item is convergence checking, which is unique to CRDT-based systems. Unlike traditional systems where you can trust the database as source of truth, CRDT systems must continuously verify that distributed replicas have converged. This verification cost is the "price of offline-first."

---

## Observability Anti-Patterns for Collaborative Editors

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Logging every CRDT operation at INFO level | At 4M ops/sec, log storage explodes; signal drowned in noise | Log operations at DEBUG level with 1% sampling; log merge events and errors at INFO |
| Per-character metrics (operations by character position) | Unbounded cardinality; metrics system collapses | Per-block or per-document aggregation; character-level detail only in traces |
| Alerting on absolute operation count | Normal variation (business hours vs. off-hours) triggers false positives | Alert on rate-of-change or anomaly detection relative to time-of-day baseline |
| Tracing every WebSocket message | Trace storage fills rapidly; trace query latency degrades | Sample: 100% for errors, 10% for slow (>100ms), 1% for normal operations |
| Monitoring sync server CPU only | CRDT workloads are memory-bound, not CPU-bound | Monitor memory (CRDT state), not just CPU; alert on tombstone ratio and document count |
| Single convergence check strategy | Checking every document on every cycle is too expensive at 800K active docs | Tiered: check hot documents every 5 min, warm every 30 min, cold documents weekly |

**Rule of thumb**: For CRDT-based systems, spend 60% of observability effort on data integrity (convergence checks, hash verification, tombstone monitoring) and 40% on performance. Traditional systems invert this ratio. The reason: in a traditional system, the database guarantees correctness; in a CRDT system, correctness must be continuously verified because every client is an independent writer.
