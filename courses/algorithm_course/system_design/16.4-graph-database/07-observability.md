# Observability — Graph Database

## Metrics (USE/RED)

### Key Metrics to Track

#### Storage Engine Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `graph.nodes.total` | Gauge | Total node count by label | — |
| `graph.edges.total` | Gauge | Total edge count by type | — |
| `graph.store.size_bytes` | Gauge | Store file sizes (node, rel, prop, index) | > 80% disk |
| `graph.buffer_cache.hit_ratio` | Gauge | Buffer cache hit rate | < 85% |
| `graph.buffer_cache.evictions_per_sec` | Rate | Page evictions from buffer cache | > 10K/s |
| `graph.wal.size_bytes` | Gauge | WAL size since last checkpoint | > 10 GB |
| `graph.wal.fsync_latency_ms` | Histogram | WAL fsync duration | p99 > 50ms |
| `graph.compaction.active` | Gauge | Number of active compaction threads | — |
| `graph.store.fragmentation_ratio` | Gauge | Ratio of dead to live records | > 30% |

#### Query Engine Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `query.latency_ms` | Histogram | Query execution time (by type: read/write/analytics) | p99 > 100ms (read) |
| `query.throughput` | Rate | Queries per second by type | — |
| `query.errors` | Counter | Failed queries by error type | > 0.1% error rate |
| `query.plan_cache.hit_ratio` | Gauge | Plan cache reuse rate | < 80% |
| `query.active` | Gauge | Currently executing queries | > 80% of thread pool |
| `query.queue_depth` | Gauge | Queries waiting for execution thread | > 50 |
| `query.timeout_count` | Counter | Queries terminated by timeout | > 10/min |
| `query.killed_count` | Counter | Queries killed by query guard | > 5/min |

#### Traversal-Specific Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `traversal.hops_per_query` | Histogram | Number of hops per traversal | p99 > 10 |
| `traversal.nodes_expanded` | Histogram | Nodes visited per query | p99 > 100K |
| `traversal.edges_traversed` | Histogram | Edges followed per query | p99 > 500K |
| `traversal.cross_partition_hops` | Counter | Hops requiring network call | > 30% of total hops |
| `traversal.supernode_hits` | Counter | Traversals touching supernodes | — (informational) |
| `traversal.depth_limit_reached` | Counter | Queries hitting max depth | > 100/min |

#### Transaction Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `tx.active` | Gauge | Open transactions | > 500 |
| `tx.commit_latency_ms` | Histogram | Time to commit | p99 > 100ms |
| `tx.rollback_rate` | Rate | Rollback rate | > 5% |
| `tx.deadlock_count` | Counter | Deadlocks detected | > 10/min |
| `tx.lock_wait_time_ms` | Histogram | Time spent waiting for locks | p99 > 200ms |

#### Replication Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `replication.lag_bytes` | Gauge | WAL bytes behind leader | > 100 MB |
| `replication.lag_seconds` | Gauge | Estimated seconds behind leader | > 5s |
| `replication.follower_health` | Gauge | Healthy followers per partition | < 2 |
| `replication.leader_elections` | Counter | Leader election events | > 1/hour |

### Dashboard Design

**Dashboard 1: Cluster Overview**
- Total nodes/edges (gauge)
- Query throughput (time series)
- Active transactions (gauge)
- Buffer cache hit ratio (gauge)
- Replication lag per partition (heatmap)

**Dashboard 2: Query Performance**
- Query latency distribution (histogram by type)
- Slowest queries (top-K table)
- Plan cache hit ratio (gauge)
- Traversal depth distribution (histogram)
- Cross-partition hop ratio (time series)

**Dashboard 3: Storage & Capacity**
- Store file sizes over time (stacked area)
- WAL size and checkpoint frequency (time series)
- Fragmentation ratio (gauge per store)
- Disk I/O throughput (read/write breakdown)
- Buffer cache usage and eviction rate (time series)

**Dashboard 4: Supernode Monitor**
- Top 100 supernodes by edge count (table)
- Supernode access frequency (heatmap)
- Vertex-centric index utilization (gauge)
- Lock contention on supernodes (time series)

---

## Logging

### What to Log

| Event | Log Level | Content |
|-------|-----------|---------|
| Query execution | INFO | Query template (parameters redacted), execution time, rows returned, plan used |
| Slow query | WARN | Full query plan, actual vs. estimated cardinalities, wait events |
| Transaction commit/rollback | INFO | Transaction ID, duration, affected node/edge count |
| Deadlock detection | WARN | Transaction IDs involved, lock resources, resolution (which TX aborted) |
| Schema change | INFO | DDL statement, user, before/after schema version |
| Authentication failure | WARN | Client IP, username attempted, failure reason |
| Authorization denial | WARN | User, denied operation, resource, policy that denied |
| Query guard kill | WARN | Query template, resources consumed, kill reason |
| Leader election | INFO | Partition ID, old leader, new leader, election duration |
| Compaction event | DEBUG | Store file, records compacted, space reclaimed |

### Log Levels Strategy

| Level | Production Volume | Use Case |
|-------|------------------|----------|
| ERROR | < 100/min | System failures, data corruption, replication failures |
| WARN | < 1,000/min | Slow queries, auth failures, deadlocks, capacity warnings |
| INFO | < 10,000/min | Query execution summaries, transactions, leader elections |
| DEBUG | Disabled in prod | Traversal step-by-step, buffer cache operations, lock acquisition |
| TRACE | Never in prod | Per-record reads, pointer chain walks, WAL entry details |

### Structured Logging Format

```
{
  "timestamp": "2026-03-10T14:32:01.234Z",
  "level": "WARN",
  "component": "query_engine",
  "event": "slow_query",
  "query_id": "q-abc-123",
  "database": "social_graph",
  "query_template": "MATCH (a:Person)-[:KNOWS*2..3]->(b) WHERE a.id = $id RETURN b",
  "execution_time_ms": 1250,
  "rows_returned": 4521,
  "nodes_expanded": 125000,
  "edges_traversed": 380000,
  "plan": "IndexSeek(a) -> Expand(*2..3) -> Filter",
  "cross_partition_hops": 12,
  "supernode_hits": 3,
  "user": "app-service-prod",
  "client_ip": "10.0.1.42"
}
```

---

## Distributed Tracing

### Trace Propagation Strategy

Graph queries are unique in tracing because a single query may fan out to multiple storage nodes, creating a tree-shaped trace rather than a linear chain.

**Trace context propagation:**

```
Client Request
  └── Query Router (parse, plan)
        └── Partition 1: Traversal (local hops)
        └── Partition 2: Traversal (remote hop from P1)
        └── Partition 3: Property fetch (from P2 result)
        └── Merge Results
              └── Response to Client
```

### Key Spans to Instrument

| Span | Parent | Key Attributes |
|------|--------|---------------|
| `query.parse` | Root | query_template, parameter_count |
| `query.plan` | Root | plan_type, estimated_cost, plan_cache_hit |
| `query.execute` | Root | total_rows, execution_time |
| `traversal.expand` | execute | hop_number, partition_id, nodes_expanded |
| `traversal.remote_hop` | expand | source_partition, target_partition, latency |
| `storage.page_read` | expand | store_type (node/rel/prop), cache_hit |
| `tx.lock_acquire` | execute | lock_type, resource_id, wait_time |
| `tx.wal_write` | execute | wal_bytes, fsync_time |
| `replication.send` | wal_write | target_follower, bytes_sent |

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| **Replication lag critical** | lag_seconds > 30s for > 5 min | P1 | Check follower health, network, WAL throughput |
| **Leader election failure** | No leader elected after 60s | P1 | Manual intervention; check quorum, network |
| **Data corruption detected** | Consistency check failure | P1 | Stop writes; initiate restore from backup |
| **Buffer cache exhaustion** | hit_ratio < 70% for > 10 min | P1 | Identify memory-heavy queries; add capacity |
| **Cluster quorum lost** | < majority of replicas healthy | P1 | Network investigation; consider manual failover |

### Warning Alerts

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| **Slow query spike** | p99 latency > 500ms for > 5 min | P2 | Review slow query log; check plan cache |
| **High deadlock rate** | > 50 deadlocks/min for > 5 min | P2 | Review concurrent write patterns; optimize lock ordering |
| **WAL growth** | WAL size > 10 GB | P2 | Trigger checkpoint; verify checkpoint process is running |
| **Disk space warning** | > 75% utilization | P2 | Plan capacity expansion; review data retention |
| **Supernode growth** | Node degree exceeds 1M | P3 | Review data model; consider splitting supernode |
| **Cross-partition ratio high** | > 40% of hops cross partitions | P3 | Schedule repartitioning; review access patterns |
| **Query guard kills** | > 50 killed queries/hour | P3 | Review application query patterns; optimize or add limits |

### Runbook References

| Runbook | Scenario | Key Steps |
|---------|----------|-----------|
| RB-001 | Leader failover | Verify quorum → Check follower WAL positions → Confirm election → Validate client reconnection |
| RB-002 | Buffer cache tuning | Identify top queries by cache misses → Adjust cache allocation → Monitor hit ratio |
| RB-003 | Supernode mitigation | Identify affected queries → Add vertex-centric index → Consider relationship grouping → Monitor performance |
| RB-004 | Repartitioning | Trigger community detection → Generate new partition plan → Execute online migration → Verify edge cut ratio |
| RB-005 | Consistency repair | Stop cluster → Run consistency checker → Repair from WAL or backup → Restart and verify |

---

## SLO Dashboard Design

### SLO 1: Traversal Latency

```
SLO: 99.9% of 3-hop traversal queries complete within 50ms (p99)

Metric: histogram_quantile(0.999, graph_query_latency_ms{type="traversal", hops="3"})

Dashboard elements:
- Current compliance percentage (last 30 days) — large gauge
- Error budget remaining — burn-down chart
- Latency percentiles over time (p50, p95, p99, p999) — multi-line chart
- Top 10 slowest queries — table with query template, latency, plan used
- Buffer cache hit ratio correlation — scatter plot (hit ratio vs. latency)

Alert: SLO burn rate > 2x for 15 minutes → P2
Alert: SLO burn rate > 10x for 5 minutes → P1
```

### SLO 2: Write Latency

```
SLO: 99.9% of single node/edge writes complete within 20ms

Metric: histogram_quantile(0.999, graph_write_latency_ms{type="single"})

Dashboard elements:
- Current compliance percentage — large gauge
- Write latency breakdown (WAL fsync, pointer update, index update, replication)
- WAL fsync latency trend — early indicator of disk issues
- Lock wait time distribution — identifies contention patterns
```

### SLO 3: Availability

```
SLO: 99.99% of query attempts succeed (non-5xx responses within latency budget)

Metric: 1 - (rate(graph_query_errors{code=~"5.*"}[5m]) / rate(graph_query_total[5m]))

Dashboard elements:
- Availability gauge (current, trailing 7d, trailing 30d)
- Error rate by type (timeout, OOM, deadlock, unavailable)
- Leader election events — each election costs ~10s of write availability
- Partition health matrix — green/yellow/red per partition per replica
```

### SLO 4: Data Freshness

```
SLO: 99% of writes visible on read replicas within 100ms

Metric: histogram_quantile(0.99, graph_replication_lag_ms)

Dashboard elements:
- Replication lag heatmap (partition × replica)
- WAL throughput (bytes/sec) vs. replication throughput
- Lag trend with capacity planning projection
```

---

## Graph-Specific Observability Patterns

### Query Fingerprinting

Graph queries exhibit a unique observability challenge: the same query template can have wildly different execution characteristics depending on the starting node (regular node vs. supernode) and the data distribution.

```
Query template: MATCH (a:Person {id: $id})-[:KNOWS*2]->(b) RETURN b

When $id = regular_user:
  - Execution time: 3ms
  - Nodes expanded: 40,000
  - Buffer cache hits: 99.8%
  - Cross-partition hops: 0

When $id = celebrity_user:
  - Execution time: 2,500ms
  - Nodes expanded: 12,000,000
  - Buffer cache hits: 72.3%
  - Cross-partition hops: 45
```

**Observability implication:** Track metrics per query template AND per starting node degree class (regular, high-degree, supernode). Alert on latency per query template, not just global p99.

### Traversal Flamegraph

Visualize where a slow query spends its time in a flamegraph-like format specific to graph traversal:

```
Query: MATCH (a:Person {name: "Alice"})-[:KNOWS]->(b)-[:WORKS_AT]->(c:Company) RETURN c

Traversal Flamegraph:
├── IndexSeek(a, Person.name = "Alice")                    [0.5ms]
├── Expand(a -[:KNOWS]-> b)                                [2.1ms]
│   ├── 247 neighbors found
│   ├── 12 cross-partition hops                            [8.4ms]  ← Slowest part of the process
│   └── 3 buffer cache misses                              [0.3ms]
├── Expand(b -[:WORKS_AT]-> c)                             [1.2ms]
│   └── 198 WORKS_AT edges found
├── Filter(c:Company)                                      [0.1ms]
│   └── 184 Company nodes passed filter
└── Result assembly (184 rows, 12 property fetches)        [0.8ms]

Total: 13.4ms | Slowest part of the process: cross-partition hops (63% of time)
```

### Graph Health Metrics

Beyond standard database metrics, graph databases have unique structural health indicators:

| Metric | Description | Healthy Range | Degradation Signal |
|--------|-------------|--------------|-------------------|
| Edge cut ratio | % of edges crossing partition boundaries | < 20% | > 30% means repartitioning needed |
| Supernode count | Nodes with degree > 100K | Stable or slowly growing | Rapid growth signals data model issue |
| Average path length | Mean shortest path between random node pairs | Stable | Increasing means graph fragmentation |
| Clustering coefficient | Ratio of actual vs. possible triangles | Domain-specific | Sudden changes signal data quality issues |
| Connected component count | Number of disconnected subgraphs | Stable | Growing means graph is fragmenting |
| Relationship chain length (avg) | Average linked list length per node | < 1000 | > 10K on non-supernodes means data model concern |
| Ghost replica staleness | Age of oldest ghost replica | < 5 minutes | > 15 min means cross-partition queries see stale data |
| Version chain depth | MVCC version chain length | < 10 | > 50 means GC is falling behind |

---

## Incident Detection Playbooks

### Playbook 1: Latency Spike Caused by Supernode Traversal

**Detection signals:**
- `query.latency_ms` p99 spikes above 500ms
- `traversal.supernode_hits` increases concurrently
- `traversal.nodes_expanded` p99 exceeds 100K

**Investigation steps:**
1. Identify the supernode: query the `traversal.supernode_hits` metric with node ID dimensions
2. Check if vertex-centric index exists for the relevant edge type
3. Check if the query pushes LIMIT before the supernode expansion
4. Verify the query planner's cardinality estimate for the supernode

**Resolution:**
- Immediate: add query hint to limit fan-out at the supernode
- Short-term: create vertex-centric index on the supernode's dominant edge type
- Long-term: consider edge bucketing (splitting the supernode into regional sub-nodes)

### Playbook 2: Buffer Cache Hit Ratio Degradation

**Detection signals:**
- `graph.buffer_cache.hit_ratio` drops below 85%
- `graph.buffer_cache.evictions_per_sec` spikes
- `query.latency_ms` p50 increases (not just p99)

**Investigation steps:**
1. Check for new query patterns: are analytics queries running on the OLTP cluster?
2. Check for index build operations: background index creation evicts cache
3. Check data growth: has the working set outgrown the buffer cache?
4. Check for bulk import: large data loads can flush the cache

**Resolution:**
- Immediate: identify and kill/throttle the cache-polluting queries
- Short-term: increase buffer cache allocation or add read replicas
- Long-term: implement workload isolation (separate OLTP and OLAP buffer pools)

### Playbook 3: Replication Lag Spike

**Detection signals:**
- `replication.lag_seconds` exceeds 10s
- `replication.lag_bytes` growing faster than `replication.apply_rate`

**Investigation steps:**
1. Check follower CPU/IO: is the follower overwhelmed applying WAL?
2. Check network: is there packet loss between leader and follower?
3. Check WAL write rate on leader: has write throughput spiked?
4. Check for large transactions: single large tx can stall replication

**Resolution:**
- Immediate: throttle writes on leader to let follower catch up
- Short-term: add follower resources (CPU, IOPS)
- Long-term: implement parallel WAL replay on followers

---

## Capacity Planning Observability

### Predictive Metrics

| Metric | Projection Method | Action Trigger |
|--------|-------------------|---------------|
| Storage growth rate | Linear regression on `graph.store.size_bytes` over 30 days | < 90 days until capacity limit |
| Query throughput trend | Exponential smoothing on `query.throughput` | Projected to exceed cluster capacity in < 60 days |
| Buffer cache pressure | Trend on `graph.buffer_cache.hit_ratio` | Projected to drop below 85% in < 30 days |
| Supernode growth | Monitor `graph.nodes.max_degree` over time | New supernode candidates emerging |
| Cross-partition ratio trend | Linear regression on `traversal.cross_partition_hops / traversal.total_hops` | Projected to exceed 30% → schedule repartitioning |

### Operational Health Scorecard

A daily-generated scorecard aggregating graph database health across all dimensions:

| Dimension | Green | Yellow | Red |
|-----------|-------|--------|-----|
| **Availability** | > 99.99% | 99.9% - 99.99% | < 99.9% |
| **Latency** | p99 < 50ms | p99 50-200ms | p99 > 200ms |
| **Buffer cache** | Hit ratio > 95% | 85% - 95% | < 85% |
| **Replication** | Lag < 1s | 1s - 10s | > 10s |
| **Storage** | < 60% capacity | 60% - 80% | > 80% |
| **Errors** | < 0.01% | 0.01% - 0.1% | > 0.1% |
| **Deadlocks** | < 10/hour | 10 - 100/hour | > 100/hour |
| **Partition balance** | All partitions within 20% of avg size | 20% - 50% variance | > 50% variance |

### Graph Topology Monitoring

Track structural changes in the graph itself — not just database operational metrics:

| Metric | Why It Matters | Collection Frequency |
|--------|---------------|---------------------|
| Node count per label | Detects label growth anomalies (spam, bots) | Every 5 minutes |
| Edge count per type | Detects relationship creation anomalies | Every 5 minutes |
| Average degree per label | Tracks graph density evolution | Hourly |
| Degree distribution percentiles | Monitors power-law skew; detects emerging supernodes | Hourly |
| Connected component count | Detects graph fragmentation | Daily |
| Diameter estimate | Monitors "small world" property | Daily |
| Triangle count trend | Monitors clustering density | Daily |

---

## Anomaly Detection for Graph Databases

### Write Pattern Anomalies

| Anomaly | Detection Method | Possible Cause |
|---------|-----------------|---------------|
| Sudden spike in edge creation | Rate exceeds 3σ above rolling 24h average | Bot activity, spam, data import gone wrong |
| Single node receiving 10x normal edge rate | Per-node edge creation rate tracking | Coordinated attack, viral content, data model issue |
| New label type appearing | Monitor set of active labels | Unauthorized schema change, injection attempt |
| Unusual relationship type distribution | Chi-squared test against baseline | Application bug creating wrong edge types |
| Property value distribution shift | KS test on property value histograms | Data quality regression, schema evolution issue |

### Query Pattern Anomalies

| Anomaly | Detection Method | Possible Cause |
|---------|-----------------|---------------|
| Query touching >100K nodes | Monitor `traversal.nodes_expanded` p99 | Missing LIMIT, supernode traversal, unbounded path |
| New query template appearing | Track set of active query fingerprints | New application feature, SQL injection attempt |
| Cross-partition ratio spike | Monitor `traversal.cross_partition_hops / total_hops` | Data migration artifact, partition imbalance |
| Query latency bimodal distribution | Detect bimodality in latency histogram | Hot/cold cache behavior, supernode presence |
| Read-after-write consistency violation | Application-reported staleness counter | Replication lag, routing error, clock skew |
