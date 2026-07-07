# 16.3 Observability

## Metrics (USE/RED)

### Key Metrics Dashboard

| Category | Metric | Target | Alert Threshold |
|---|---|---|---|
| **Search Latency** | Query p50 latency | < 20ms | > 50ms for 5 min |
| | Query p99 latency | < 500ms | > 1s for 5 min |
| | Fetch phase p99 latency | < 100ms | > 300ms for 5 min |
| **Search Throughput** | Queries per second (QPS) | Baseline +-30% | > 2x baseline (traffic spike) or < 0.5x baseline (possible issue) |
| | Query cache hit rate | > 30% | < 10% (cache ineffective or thrashing) |
| **Indexing** | Indexing rate (docs/sec) | Baseline +-20% | Drop to 0 for > 1 min (pipeline blocked) |
| | Indexing latency (p99) | < 100ms | > 500ms for 5 min |
| | Bulk rejection rate | < 0.1% | > 1% (backpressure) |
| **Segments** | Segment count per shard | < 50 | > 100 (merge falling behind) |
| | Merge rate (MB/sec) | Sustaining | < 50% of indexing rate (merge debt growing) |
| | Deleted doc percentage | < 20% | > 40% (force merge needed) |
| **Resources** | JVM heap usage | < 75% | > 85% (GC pressure) |
| | CPU utilization | < 70% | > 85% sustained |
| | Disk utilization | < 75% | > 85% (add nodes or delete data) |
| | File descriptors used | < 80% of limit | > 90% (segment count or shard count too high) |
| **Cluster Health** | Cluster status | Green | Yellow (unassigned replicas) or Red (unassigned primaries) |
| | Unassigned shards | 0 | > 0 for > 5 min |
| | Pending tasks | < 10 | > 100 (master overloaded) |

### Shard-Level Metrics

```
ShardMetrics {
    shard_id:               string
    index:                  string
    role:                   enum(PRIMARY, REPLICA)
    node:                   string

    // Size and docs
    store_size_bytes:       uint64
    doc_count:              uint32
    deleted_doc_count:      uint32

    // Indexing
    indexing_total:          uint64      // Cumulative indexed docs
    indexing_current:        uint32      // In-flight indexing operations
    indexing_failed:         uint64      // Failed indexing operations

    // Search
    query_total:            uint64      // Cumulative queries
    query_time_ms:          uint64      // Cumulative query time
    fetch_total:            uint64      // Cumulative fetch operations
    fetch_time_ms:          uint64      // Cumulative fetch time

    // Segments
    segment_count:          uint32
    segment_memory_bytes:   uint64      // Memory used by segment metadata

    // Translog
    translog_operations:    uint32      // Uncommitted translog ops
    translog_size_bytes:    uint64

    // Merge
    merge_total:            uint64
    merge_current:          uint32
    merge_total_time_ms:    uint64
    merge_total_size_bytes: uint64

    // Refresh
    refresh_total:          uint64
    refresh_total_time_ms:  uint64
}
```

---

## Logging

### What to Log

| Event | Log Level | Details |
|---|---|---|
| Search request received | DEBUG | Query hash, index, user, source IP |
| Search completed | INFO | Query hash, took_ms, total_hits, shards_queried, cache_hit |
| Slow query (> p95 threshold) | WARN | Full query body, took_ms, shard breakdown, segments_searched |
| Indexing error | ERROR | Document ID, index, error type, stack trace |
| Shard failure during query | WARN | Shard ID, node, error, whether partial results returned |
| Circuit breaker tripped | ERROR | Breaker name, limit, current_usage, request_size |
| Cluster state change | INFO | New master, shard relocations, index creation/deletion |
| Node join/leave | WARN | Node ID, node role, reason for departure |

### Structured Log Format

```
{
    "timestamp": "2026-03-10T14:23:45.678Z",
    "level": "WARN",
    "logger": "search.slow_log",
    "cluster": "prod-search-east",
    "node": "data-node-07",
    "message": "Slow query detected",
    "query_hash": "a1b2c3d4",
    "index": "products-2026.03",
    "took_ms": 847,
    "total_hits": 15234,
    "shards_total": 20,
    "shards_successful": 20,
    "source": "{\"query\":{\"bool\":{\"must\":[{\"match\":{\"title\":\"wireless headphones\"}}],\"filter\":[{\"range\":{\"price\":{\"lte\":100}}}]}}}",
    "user": "search-api-key-prod",
    "trace_id": "abc123def456"
}
```

### Slow Query Log Configuration

```
// Slow log thresholds (per-index setting)
index.search.slowlog.threshold.query.warn:    1s
index.search.slowlog.threshold.query.info:    500ms
index.search.slowlog.threshold.query.debug:   100ms

index.search.slowlog.threshold.fetch.warn:    500ms
index.search.slowlog.threshold.fetch.info:    200ms

index.indexing.slowlog.threshold.index.warn:  5s
index.indexing.slowlog.threshold.index.info:  1s

// Slow log captures the full query body for debugging
// IMPORTANT: sanitize PII from slow logs (same pipeline as audit logs)
```

---

## Distributed Tracing

### Key Spans to Instrument

```
Search Request Trace:
[coordinator] search_request (total)
  ├── [coordinator] parse_query
  ├── [coordinator] check_cache
  ├── [coordinator] scatter_query_phase
  │     ├── [data-node-1] shard_query (shard 0)
  │     │     ├── open_searcher
  │     │     ├── execute_query
  │     │     │     ├── term_lookup (FST traversal)
  │     │     │     ├── posting_list_scan
  │     │     │     └── bm25_scoring
  │     │     └── compute_aggregations
  │     ├── [data-node-2] shard_query (shard 1)
  │     └── [data-node-3] shard_query (shard 2)
  ├── [coordinator] merge_results
  ├── [coordinator] scatter_fetch_phase
  │     ├── [data-node-1] shard_fetch (doc_5, doc_2)
  │     │     ├── load_stored_fields
  │     │     └── highlight_generation
  │     └── [data-node-2] shard_fetch (doc_99)
  ├── [coordinator] assemble_response
  └── [coordinator] update_cache

Indexing Request Trace:
[coordinator] index_request (total)
  ├── [coordinator] route_to_primary
  ├── [primary-node] primary_index
  │     ├── analyze_document
  │     ├── write_translog
  │     └── add_to_memory_buffer
  ├── [replica-node-1] replica_index
  └── [replica-node-2] replica_index
```

### Trace Propagation

```
// Trace context propagated via HTTP headers
// X-Opaque-Id: client-provided request ID for correlation
// traceparent: W3C Trace Context header (version-traceid-spanid-flags)

// Use case: trace a slow search from client -> coordinator -> data nodes
// Identifies which shard/segment is the Slowest part of the process
// Example: one shard took 800ms (large segment, cold cache) while others took 20ms
```

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Runbook |
|---|---|---|
| **Cluster RED** | Any primary shard unassigned for > 2 min | Check node health; identify failed node; verify disk space; check allocation explain API |
| **All coordinators down** | Zero healthy coordinators for > 30s | Failover to backup coordinators; check load balancer health checks; verify network connectivity |
| **Indexing pipeline stopped** | Zero documents indexed for > 5 min during business hours | Check bulk queue rejections; verify upstream data pipeline; check translog errors |
| **Search latency spike** | p99 > 2s for > 5 min | Check slow query log; identify hot shards; check GC pauses; verify no merge storms |
| **Disk space critical** | Any data node > 90% disk | Enable watermark allocation (blocks writes at 95%); delete old indexes; add nodes; trigger ILM early |

### Warning Alerts

| Alert | Condition | Action |
|---|---|---|
| **Cluster YELLOW** | Replica shards unassigned for > 10 min | Check node capacity; verify zone awareness; review allocation filters |
| **High GC frequency** | > 5 old-gen GC pauses/min | Review heap usage; check for large aggregations; reduce field data cache size |
| **Merge debt growing** | Segment count per shard increasing steadily | Review refresh interval; check merge thread count; consider force-merge for read-only indexes |
| **Translog size large** | Translog > 1 GB on any shard | Check if flush is blocked; verify disk I/O; trigger manual flush if needed |
| **Query rejection rate** | > 1% of queries rejected (circuit breaker) | Reduce concurrent queries; increase heap; review query complexity |
| **Replication lag** | Cross-cluster replication lag > 30s | Check network between clusters; verify follower cluster capacity |

---

## Operational Runbooks

### Runbook: Recovering from Cluster RED

```
1. Identify unassigned primary shards:
   GET _cluster/health?level=shards (find RED shards)

2. Check allocation explanation:
   GET _cluster/allocation/explain?include_disk_info=true
   (shows WHY the shard cannot be allocated)

3. Common causes and fixes:
   a. Node down: wait for node recovery (translog replay)
   b. Disk full: free disk space or add nodes
   c. Allocation filter conflict: review index.routing.allocation settings
   d. Corruption: restore from snapshot (last resort)

4. Force allocate stale primary (DATA LOSS RISK):
   POST _cluster/reroute
   (only if no other copy exists; accepts data loss for availability)
```

### Runbook: Handling a Merge Storm

```
1. Identify affected shards:
   GET _cat/segments?v&s=shard,segment (count segments per shard)

2. Temporarily throttle merging:
   PUT _cluster/settings
   {"persistent": {"indices.store.throttle.max_bytes_per_sec": "20mb"}}

3. Increase refresh interval for heavy-write indexes:
   PUT /heavy-write-index/_settings
   {"index": {"refresh_interval": "30s"}}

4. After load subsides, force-merge read-only indexes:
   POST /old-index/_forcemerge?max_num_segments=1

5. Monitor: segment count should decrease, query latency should improve
```

### Runbook: Diagnosing a Slow Query

```
1. Identify the slow query from the slow query log:
   - Check index.search.slowlog (threshold: 500ms for warn)
   - Note: query hash, index, took_ms, shards_total

2. Profile the query:
   POST /index/_search?profile=true
   (returns per-shard breakdown: query phase time, fetch phase time,
    per-segment collector stats, scoring time)

3. Analyze the profile:
   a. Check "breakdown" for each shard:
      - build_scorer: high = complex scoring (many bool clauses)
      - next_doc: high = large posting lists being scanned
      - advance: high = inefficient intersection
      - score: high = expensive function scoring or LTR

   b. Check segment count per shard:
      - > 50 segments = merge debt; recommend force-merge

   c. Check if one shard is significantly slower (straggler):
      - Yes: check that node's CPU, I/O, GC pauses
      - Likely cause: merge in progress, GC pause, or cold cache

4. Common fixes:
   a. Leading wildcard query (e.g., "*phones"):
      - Rewrites to all matching terms → full posting list scan
      - Fix: use n-gram tokenizer instead of wildcard
   b. Deep nested bool with many clauses:
      - 1000+ clauses → O(n) query planning
      - Fix: use terms query (batch of exact matches) instead of bool/should
   c. Regex query with catastrophic backtracking:
      - Fix: set regex timeout; rewrite to simpler pattern
   d. Large aggregation on text field:
      - Fielddata loaded into heap → GC pressure
      - Fix: use keyword sub-field with doc_values
```

### Runbook: Recovering from Mapping Explosion

```
1. Identify the affected index:
   GET _cluster/state/metadata (check size; > 50MB is concerning)
   GET /affected-index/_mapping (check total field count)

2. Identify the source of new fields:
   - Check recent indexing patterns: which API keys are sending documents?
   - Diff the mapping against the last known good version
   - Common culprits: user-generated attributes, log fields, JSON blobs

3. Immediate mitigation:
   a. Set field limit: PUT /index/_settings
      {"index.mapping.total_fields.limit": 1000}
   b. Reject documents with unmapped fields (reject incoming bad data)

4. Long-term fix:
   a. Create a new index with strict mapping (dynamic: strict)
   b. Add a "flattened" field for arbitrary key-value data
   c. Reindex from old index to new index
   d. Update ingest pipelines to validate documents before indexing

5. Prevention:
   - Monitor field count per index as a metric (alert at 500+)
   - Require mapping review for new data sources
   - Use index templates with strict dynamic mapping for all new indexes
```

---

## SLO Dashboard Design

### Executive Dashboard (High-Level)

| Panel | Metric | Visualization | Threshold |
|---|---|---|---|
| Search availability | % of 1-min windows with > 95% success rate | Single-stat gauge (green/yellow/red) | Green > 99.99%, Yellow > 99.9%, Red < 99.9% |
| Search latency (p50) | 50th percentile query latency | Time-series line chart | Green < 20ms, Yellow < 50ms, Red > 50ms |
| Search latency (p99) | 99th percentile query latency | Time-series line chart | Green < 500ms, Yellow < 1s, Red > 1s |
| Error budget remaining | (1 - burn rate) × budget | Burn-down chart over 30-day window | Alert when < 50% remaining |
| Indexing freshness | Lag between last indexed document and current time | Time-series with threshold line | Green < 5s, Yellow < 30s, Red > 60s |
| Cluster health | Green/Yellow/Red status | Traffic light indicator | Any non-green = investigate |

### Operational Dashboard (Per-Node Detail)

| Panel | Metric | Visualization |
|---|---|---|
| Node CPU | Per-node CPU utilization | Heat map (nodes × time) |
| JVM heap | Per-node heap usage + GC pause frequency | Stacked area chart |
| Segment count | Per-shard segment count | Table with conditional coloring (> 50 = orange, > 100 = red) |
| Merge rate | MB/sec merged per node | Line chart with indexing rate overlay |
| Thread pool queues | Search, write, bulk queue sizes | Stacked bar chart per node |
| Disk I/O | Read/write IOPS and throughput per node | Dual-axis line chart |
| Cache hit rates | Query cache, request cache, fielddata cache | Percentage line charts |

### Search Quality Dashboard

| Panel | Metric | Source |
|---|---|---|
| Zero-result rate | % of queries returning 0 hits | Query logs |
| Click-through rate (CTR) | Clicks / search impressions | Application clickstream |
| Mean reciprocal rank (MRR) | 1/position of first click | Application clickstream |
| Query reformulation rate | % of queries followed by a refined query within 30s | Session analysis |
| Autocomplete acceptance rate | % of autocomplete suggestions accepted | Autocomplete logs |
| A/B test comparison | CTR/MRR between control and experiment | Experiment framework |

---

## Incident Playbooks

### Playbook: Search Latency Degradation (p99 > 2x normal)

```
Severity: P2 (High)
On-call action required within: 15 minutes

1. ASSESS: Check dashboard for correlation with:
   - Traffic spike (QPS increase)
   - Merge storm (segment count spike + high disk I/O)
   - GC pauses (JVM heap pressure)
   - Node failure (cluster yellow/red)

2. TRIAGE by root cause:
   a. Traffic spike → Scale coordinators; enable aggressive query caching;
      temporarily reject aggregation queries
   b. Merge storm → Increase refresh interval on high-write indexes;
      throttle merge I/O; separate indexing from query nodes
   c. GC pauses → Identify large aggregations via slow log;
      increase circuit breaker sensitivity; consider node restart
   d. Hot shard → Identify via per-shard latency metrics;
      check for unbalanced routing; rebalance cluster

3. MITIGATE:
   - If caused by a specific query pattern: add to query blocklist
   - If caused by a data node: cordon the node (exclude from allocation)
   - If cluster-wide: reduce replica count temporarily to reduce merge load

4. RESOLVE:
   - Root cause fix (e.g., fix query, rebalance, add capacity)
   - Verify p99 returns to normal
   - Update SLO dashboard and error budget

5. POST-INCIDENT:
   - Write incident report with timeline
   - Add chaos experiment for this failure mode
   - Update alerting thresholds if needed
```

### Playbook: Indexing Pipeline Stalled

```
Severity: P1 (Critical) if user-facing data is stale
Severity: P2 (High) if only analytics data is delayed

1. ASSESS: Check indexing rate metric
   - Dropped to 0? Check upstream pipeline (message queue, CDC connector)
   - Dropped by 50%? Check bulk rejection rate
   - Normal rate but documents not appearing in search? Check refresh cycle

2. TRIAGE:
   a. Upstream pipeline down → Check message queue lag; restart connectors
   b. Bulk rejections (429s) → Check thread pool queue sizes;
      data node disk watermarks; circuit breakers
   c. Refresh failing → Check for segment merge deadlock;
      verify disk space; check for mapping explosion
   d. Translog errors → Check disk I/O errors; verify file system health

3. MITIGATE:
   - Clear bulk queue by increasing thread pool or adding data nodes
   - If disk full: trigger ILM to move old indexes to warm/cold tier
   - If translog corrupt: recover shard from replica

4. RESOLVE:
   - Verify indexing rate returns to baseline
   - Verify newly indexed documents appear in search within 1 second
   - Check replication lag to follower clusters
```
