# Scalability & Reliability — Graph Database

## Scalability

### Horizontal vs. Vertical Scaling

| Aspect | Vertical Scaling | Horizontal Scaling |
|--------|-----------------|-------------------|
| Approach | Larger machines (more RAM, faster SSDs) | More machines with graph partitioned across them |
| Traversal performance | Optimal — all data local | Degraded by cross-partition hops |
| Capacity ceiling | ~2 TB RAM, ~100 TB NVMe | Theoretically unlimited |
| Operational complexity | Simple (single instance) | Complex (distributed transactions, rebalancing) |
| Cost efficiency | Expensive at scale | Cost-effective with commodity hardware |
| When to use | Graphs < 100B edges, single datacenter | Graphs > 100B edges or multi-region |

**Strategy:** Favor vertical scaling as long as possible. A single machine with 2 TB RAM can hold a graph with ~30B edges entirely in memory. Horizontal scaling introduces the graph partitioning problem, which fundamentally degrades traversal performance for cross-partition edges.

### Graph Partitioning Strategy

#### Phase 1: Offline Community Detection

```
FUNCTION partition_graph(graph, num_partitions):
    // Step 1: Detect communities using Louvain algorithm
    communities = louvain_community_detection(graph)

    // Step 2: Merge small communities, split large ones
    balanced_communities = balance_partitions(communities, num_partitions)

    // Step 3: Assign communities to partitions minimizing edge cuts
    assignment = min_cut_assignment(balanced_communities, num_partitions)

    // Step 4: Create ghost replicas for high-traffic cross-partition edges
    ghost_nodes = identify_border_nodes(graph, assignment)
    FOR EACH ghost IN ghost_nodes:
        replicate_to_neighbor_partition(ghost, assignment)

    RETURN assignment

// Run periodically (daily/weekly) as rebalancing is expensive
```

#### Phase 2: Online Assignment for New Nodes

```
FUNCTION assign_new_node(node, existing_neighbors):
    IF existing_neighbors is empty:
        // Hash-based assignment for isolated nodes
        RETURN hash(node.id) MOD num_partitions

    // Count neighbors per partition
    partition_counts = count_neighbors_per_partition(existing_neighbors)

    // Assign to partition with most neighbors (gravity)
    best_partition = partition_with_max_count(partition_counts)

    // Check balance constraint
    IF partition_load(best_partition) > 1.2 * average_load:
        // Overflow to second-best partition
        best_partition = second_best(partition_counts)

    RETURN best_partition
```

### Database Scaling Strategy

#### Read Replicas

| Replica Type | Consistency | Use Case | Replication |
|-------------|-------------|----------|-------------|
| Synchronous follower | Strong read | OLTP traversals requiring latest data | WAL streaming, quorum ACK |
| Asynchronous follower | Eventual read | Analytics, reporting, batch jobs | WAL streaming, no ACK wait |
| Read-only snapshot | Point-in-time | Backup, testing, time-travel queries | Periodic snapshot copy |

#### Sharding Architecture

```
┌─────────────────────────────────────────────────┐
│ Query Router (stateless)                        │
│ - Parses query, identifies starting nodes       │
│ - Routes to owning partition(s)                 │
│ - Merges results from multiple partitions       │
└───────────┬───────────┬───────────┬─────────────┘
            │           │           │
    ┌───────▼──┐  ┌─────▼────┐  ┌──▼───────┐
    │Partition 1│  │Partition 2│  │Partition 3│
    │ Leader    │  │ Leader    │  │ Leader    │
    │ + 2 Foll. │  │ + 2 Foll. │  │ + 2 Foll. │
    │           │  │           │  │           │
    │ Ghost     │  │ Ghost     │  │ Ghost     │
    │ replicas  │  │ replicas  │  │ replicas  │
    │ of border │  │ of border │  │ of border │
    │ nodes     │  │ nodes     │  │ nodes     │
    └──────────┘  └──────────┘  └──────────┘
```

### Caching Layers

| Layer | Component | Strategy | Size |
|-------|-----------|----------|------|
| L1 | Query result cache | LRU with write-invalidation | 8 GB per node |
| L2 | Buffer cache (pages) | Clock-sweep eviction | 80% of available RAM |
| L3 | Neighbor cache | Cache deserialized adjacency lists for hot nodes | 16 GB per node |
| L4 | Property cache | LRU for frequently accessed properties | 8 GB per node |

### Hot Spot Mitigation

| Hot Spot Type | Cause | Mitigation |
|--------------|-------|------------|
| Supernode read | Celebrity/company node traversed by many queries | Ghost replicas across partitions; vertex-centric indexes |
| Supernode write | High-rate edge creation (new followers) | Append-only relationship groups; batch coalescing |
| Index hot key | Many queries start from same property value | Shard the index entry; route reads to replicas |
| Partition imbalance | Organic growth concentrates activity | Periodic rebalancing with online partition migration |

### Auto-Scaling Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| CPU utilization | > 70% sustained 10 min | Add read replica |
| Buffer cache hit ratio | < 85% | Add RAM (vertical) or partition split (horizontal) |
| Cross-partition query ratio | > 30% | Trigger rebalancing / repartitioning |
| Query queue depth | > 100 | Add read replica or scale compute |
| Disk utilization | > 75% | Expand storage or add partition |

---

## Reliability & Fault Tolerance

### Single Points of Failure

| Component | SPOF Risk | Mitigation |
|-----------|-----------|------------|
| Partition leader | Loss stops writes to that partition | Raft consensus: automatic leader election in < 10s |
| Query router | Loss stops all queries | Stateless; multiple instances behind load balancer |
| WAL storage | Loss risks data loss | WAL on durable storage with replication |
| Metadata store | Loss prevents cluster coordination | Replicated metadata store (3-5 nodes) |
| Network between partitions | Loss creates split brain | Raft quorum prevents split-brain; partition leaders require majority |

### Redundancy Strategy

- **3x replication** for each partition (1 leader + 2 followers)
- **Cross-AZ deployment** — each replica in a different availability zone
- **Stateless query routers** — 3+ instances with health-check-based routing
- **WAL** stored on separate durable storage with its own replication

### Failover Mechanisms

**Leader Failure:**

```
1. Follower detects leader heartbeat timeout (5 seconds)
2. Follower starts Raft election with incremented term
3. Candidate receives majority votes from partition's replica set
4. New leader begins accepting writes
5. In-flight transactions on old leader are aborted
6. Clients retry failed writes (idempotency keys prevent duplication)

Total failover time: 5-15 seconds
```

**Read Replica Failure:**

```
1. Load balancer detects health check failure (3 consecutive failures)
2. Replica removed from rotation
3. Reads redistributed to remaining replicas
4. New replica provisioned from latest snapshot + WAL replay
5. New replica catches up and is added to rotation

Zero downtime for reads (assuming N >= 2 healthy replicas)
```

### Circuit Breaker Pattern

| Circuit | Trigger | Open Duration | Fallback |
|---------|---------|---------------|----------|
| Cross-partition call | > 50% failures in 30s | 30 seconds | Return partial results with "incomplete" flag |
| Analytics engine | > 3 timeouts in 60s | 60 seconds | Reject analytics queries, OLTP continues |
| External index (full-text) | > 5 failures in 60s | 60 seconds | Disable text search, property lookups still work |
| CDC pipeline | > 10 failures in 120s | 120 seconds | Buffer mutations locally, replay when circuit closes |

### Retry Strategy

| Operation | Retry Count | Backoff | Notes |
|-----------|-------------|---------|-------|
| Read query | 3 | Exponential (100ms, 200ms, 400ms) | Retry on different replica |
| Write transaction | 2 | Exponential (200ms, 500ms) | Only for transient errors, not constraint violations |
| Cross-partition hop | 3 | Fixed (50ms) | With speculative prefetch on retry |
| WAL replication | Unlimited | Exponential with cap (100ms → 10s) | Must eventually succeed for durability |

### Graceful Degradation

| Severity | Condition | Degradation |
|----------|-----------|-------------|
| Level 1 | Single replica down | Read traffic redistributed; no user impact |
| Level 2 | Partition leader down | Writes paused 5-15s during election; reads continue |
| Level 3 | Cross-partition network issue | Multi-partition queries return partial results |
| Level 4 | > 50% cluster unreachable | Read-only mode on surviving partitions |
| Level 5 | Full cluster failure | Serve cached results from edge cache (stale but available) |

### Bulkhead Pattern

Separate resource pools for different workload types:

| Bulkhead | Resources | Purpose |
|----------|-----------|---------|
| OLTP traversals | 60% of threads, 50% of buffer cache | Protect latency-sensitive queries |
| Analytics queries | 20% of threads, 30% of buffer cache | Prevent analytics from starving OLTP |
| Admin operations | 10% of threads, 10% of buffer cache | Schema changes, index builds |
| Background maintenance | 10% of threads, 10% of buffer cache | Compaction, statistics refresh |

---

## Disaster Recovery

### Recovery Objectives

| Metric | Target | Strategy |
|--------|--------|----------|
| RPO (Recovery Point Objective) | < 1 second | Synchronous WAL replication to 2+ replicas |
| RTO (Recovery Time Objective) | < 30 seconds | Raft-based automatic failover |
| RPO (cross-region) | < 5 seconds | Asynchronous WAL shipping to standby region |
| RTO (cross-region) | < 5 minutes | Promoted standby + DNS failover |

### Backup Strategy

| Backup Type | Frequency | Retention | Method |
|-------------|-----------|-----------|--------|
| Incremental | Continuous | 7 days | WAL archival to object storage |
| Full snapshot | Daily | 30 days | Online snapshot (copy-on-write) |
| Cross-region | Continuous | 3 days | Async WAL shipping + daily snapshot |
| Long-term archive | Weekly | 1 year | Compressed snapshot to cold storage |

### Multi-Region Considerations

| Topology | Write Latency | Read Latency | Consistency | Complexity |
|----------|--------------|-------------|-------------|------------|
| Single-region, multi-AZ | Low (< 5ms) | Low (< 2ms) | Strong | Low |
| Active-passive cross-region | Low in primary | Higher in standby | Strong in primary | Medium |
| Active-active cross-region | Medium (quorum across regions) | Low (local reads) | Eventual | Very High |

**Recommendation:** Active-passive for most use cases. Active-active only when reads must be served from multiple regions with sub-10ms latency. Graph traversal across regions is impractical (each hop adds cross-region latency), so active-active requires full graph replicas in each region.

---

## Multi-Region Deployment Strategy

### Why Multi-Region Is Uniquely Hard for Graph Databases

Graph databases face a challenge that key-value and document stores do not: **traversal locality**. A single graph query may touch dozens of nodes in a chain, and if those nodes span regions, every hop adds 50-150ms of cross-region latency. A 4-hop query that crosses regions twice becomes 100-300ms slower — violating SLOs that assume local traversal.

### Deployment Topologies

#### Topology 1: Full Replication (Active-Passive)

```
Region A (Primary)                Region B (Standby)
┌─────────────────────┐           ┌─────────────────────┐
│ Query Router (RW)   │           │ Query Router (RO)   │
│ Full Graph Store    │──async──→ │ Full Graph Store    │
│ WAL                 │   WAL     │ WAL                 │
└─────────────────────┘  stream   └─────────────────────┘
```

- **Pros:** Zero cross-region traversals; simple failover (promote standby)
- **Cons:** Full storage cost in each region; write latency if synchronous; data lag if async
- **Best for:** Graphs under 10TB where full replication is feasible

#### Topology 2: Full Replication (Active-Active with CRDT)

```
Region A                          Region B
┌─────────────────────┐           ┌─────────────────────┐
│ Query Router (RW)   │←──CRDT──→ │ Query Router (RW)   │
│ Full Graph Store    │  conflict │ Full Graph Store    │
│ Vector Clock        │  resoltn  │ Vector Clock        │
└─────────────────────┘           └─────────────────────┘
```

- **Conflict resolution for graphs:** Use last-writer-wins for property updates, add-wins semantics for edges (concurrent edge creation both succeed), and application-level conflict resolution for semantic conflicts
- **Pros:** Local reads AND writes in both regions
- **Cons:** Conflict resolution complexity; eventual consistency for cross-region reads
- **Best for:** Applications that can tolerate eventual consistency (social feeds, recommendations)

#### Topology 3: Geo-Partitioned Graph

```
Region A (US Users)               Region B (EU Users)
┌─────────────────────┐           ┌─────────────────────┐
│ US partition of      │           │ EU partition of      │
│ the graph           │←─ghost──→ │ the graph           │
│ + ghost replicas    │  replicas │ + ghost replicas    │
│   of EU border nodes │           │   of US border nodes │
└─────────────────────┘           └─────────────────────┘
```

- **Ghost replicas:** Nodes near the partition boundary are replicated (read-only) to the other region. Cross-region traversals start locally and only cross when they reach the edge of the ghost set.
- **Pros:** Data sovereignty (EU data stays in EU); reduced cross-region traffic
- **Cons:** Cross-region traversals still slow; ghost replica staleness
- **Best for:** GDPR-constrained applications with geographic locality in the graph structure

### Cross-Region Consistency Protocol

```
FUNCTION cross_region_write(mutation, primary_region, standby_regions):
    // Phase 1: Commit locally
    local_result = commit_to_local_wal(mutation)

    IF mutation.consistency == STRONG:
        // Phase 2a: Synchronous cross-region replication
        acks = 0
        FOR EACH region IN standby_regions:
            result = replicate_wal_entry(region, mutation, timeout=200ms)
            IF result.success:
                acks = acks + 1

        IF acks < required_quorum:
            rollback_local(mutation)
            RETURN error("cross-region quorum not achieved")

    ELSE:  // EVENTUAL consistency
        // Phase 2b: Asynchronous replication
        FOR EACH region IN standby_regions:
            enqueue_replication(region, mutation)

    RETURN local_result
```

---

## Back-Pressure Mechanisms

### Why Back-Pressure Is Critical for Graph Databases

Graph queries have highly variable cost — a simple 1-hop lookup takes 1ms while a 6-hop traversal with supernode fan-out can take 30 seconds. Without back-pressure, a burst of expensive queries can saturate the thread pool, causing simple queries to queue behind complex ones.

### Multi-Level Back-Pressure Strategy

| Level | Mechanism | Trigger | Action |
|-------|-----------|---------|--------|
| **L1: Query admission** | Cost-based admission control | Estimated query cost exceeds threshold | Reject with "server busy" (HTTP 503) |
| **L2: Concurrency limit** | Semaphore per query type | Active OLTP queries > 80% of threads | Queue new queries; reject after 5s |
| **L3: Memory pressure** | Per-query memory budget | Total query memory > 70% of heap | Spill intermediate results to disk |
| **L4: Buffer cache pressure** | Eviction rate monitoring | Eviction rate > 10K pages/sec | Throttle new queries by adding delay |
| **L5: Replication pressure** | WAL replication lag | Follower lag > 10 seconds | Throttle writes to allow followers to catch up |

### Adaptive Query Cost Estimation for Admission Control

```
FUNCTION admit_query(query, current_load):
    estimated_cost = query_planner.estimate_cost(query)

    // Classify query by cost tier
    IF estimated_cost < LOW_COST_THRESHOLD:
        tier = "fast"        // Simple lookups, 1-hop traversals
    ELSE IF estimated_cost < MEDIUM_COST_THRESHOLD:
        tier = "medium"      // 2-3 hop traversals, simple patterns
    ELSE:
        tier = "expensive"   // Multi-hop paths, analytics, full patterns

    // Check per-tier concurrency limits
    active_in_tier = count_active_queries(tier)
    IF active_in_tier >= tier_limits[tier]:
        IF tier == "fast":
            // Never reject fast queries — queue them
            RETURN queue(query, max_wait=1000ms)
        ELSE:
            RETURN reject(query, reason="tier_limit_exceeded")

    // Check overall system load
    IF current_load.cpu > 90% OR current_load.memory > 85%:
        IF tier != "fast":
            RETURN reject(query, reason="system_overloaded")

    RETURN admit(query)
```

---

## Capacity Planning Formulas

### Storage Capacity

```
// Total graph storage
storage_nodes = num_nodes × NODE_RECORD_SIZE (64 bytes)
storage_edges = num_edges × EDGE_RECORD_SIZE (64 bytes)
storage_props = (num_nodes + num_edges) × avg_props_per_entity × PROP_RECORD_SIZE (128 bytes)
storage_indexes = num_indexed_properties × index_size_per_property

total_storage = (storage_nodes + storage_edges + storage_props + storage_indexes) × replication_factor
```

### Memory Capacity

```
// Buffer cache sizing (target: 95%+ hit ratio)
hot_set_nodes = num_active_nodes × NODE_RECORD_SIZE
hot_set_edges = num_active_nodes × avg_degree × EDGE_RECORD_SIZE
hot_set_props = traversal_result_size × concurrent_queries

required_memory = (hot_set_nodes + hot_set_edges + hot_set_props) / target_hit_ratio
// Add 20% for query working memory, OS caches, and overhead
total_memory = required_memory × 1.2
```

### Throughput Capacity

```
// Maximum traversal QPS per node
max_traversal_qps = (num_cores × cache_hit_ratio) / avg_hops_per_query

// For a 64-core machine with 95% cache hit ratio and 3-hop average:
// max_traversal_qps = (64 × 0.95) / 3 ≈ 20K QPS per machine

// Account for write overhead (writes consume 6x the I/O of reads)
effective_qps = max_traversal_qps × (1 - (write_ratio × 6))
```

### Cluster Sizing Example

```
Given:
  - 500M nodes, 50B edges, 200 avg degree
  - 500K read QPS, 50K write QPS
  - Target: 95% cache hit ratio, p99 < 50ms

Storage:
  - Node store: 500M × 64B = 32 GB
  - Edge store: 50B × 64B = 3.2 TB
  - Property store: 100B × 128B = 12.8 TB
  - Index store: ~4 TB
  - Total: ~20 TB × 3 (replication) = 60 TB

Memory (per node):
  - Hot set: top 10% of nodes = 50M nodes × (64B + 200 × 64B) ≈ 640 GB
  - 20 nodes × 256 GB RAM ≈ 5 TB total cluster memory → 640 GB fits in ~3 nodes

Compute:
  - 500K QPS / 20K QPS per node = 25 nodes for reads
  - 50K write QPS × 6 write amplification / 100K IOPS per SSD = 3 SSDs per node
  - Total: 25 nodes for reads + write headroom → 30 nodes

Final: 30 machines, each with 64 cores, 256 GB RAM, 2 TB NVMe SSD
```

---

## Real-World: Knowledge Graph at Scale

A major search engine operates a knowledge graph with 500+ billion facts (triples) and 5+ billion entities. The system serves real-time queries for search result enrichment (knowledge panels, entity cards).

- **Architecture:** The knowledge graph is not stored in a single graph database but is partitioned into "entity shards" where each shard holds a cluster of related entities (e.g., all entities related to a movie: actors, directors, studios, awards). This preserves locality for the most common query pattern (fetch everything about one entity).
- **Serving tier:** A specialized in-memory serving system holds the most frequently accessed 10% of the graph (~500M entities, 50B facts) in compressed form. Cache hit ratio exceeds 99.5%.
- **Update pipeline:** Entity updates flow through a streaming pipeline with a 15-minute end-to-end latency from source change to serving tier. Critical updates (breaking news, stock prices) use a fast path with sub-minute latency.
- **Key metric:** p99 query latency for entity lookups is under 5ms, even for entities with 10K+ connected facts.

---

## Real-World: Professional Network Graph

A professional networking platform manages a graph of 1+ billion members with 30+ billion connections. Their graph powers features including "People You May Know," connection path display, and professional network analytics.

- **Architecture:** The social graph is stored in a custom graph service (not a commercial graph database) optimized for their specific access patterns: primarily 2nd and 3rd degree connection lookups.
- **Caching strategy:** Each member's 1st-degree connections are cached in a distributed cache layer. 2nd-degree lookups compute the intersection of two cached adjacency lists rather than performing a live graph traversal.
- **Partitioning:** Members are partitioned by geographic region (most connections are within the same country), reducing cross-partition edges to under 15%.
- **Key metric:** "People You May Know" recommendations require computing 2nd-degree connections for 700M+ daily active users, generating 200B+ graph lookups per day.

---

## Graph-Specific Scaling Patterns

### Pattern 1: Edge Bucketing for Temporal Supernodes

When supernodes grow primarily through time-ordered edges (e.g., a popular merchant receiving millions of transactions), divide edges into time-based buckets:

```
Supernode: merchant_42 (10M transaction edges)
  ├── Bucket: 2026-03-20 (25K edges)  ← hot, in memory
  ├── Bucket: 2026-03-19 (23K edges)  ← warm, SSD
  ├── Bucket: 2026-03-18 (24K edges)  ← warm, SSD
  ├── ...
  └── Bucket: 2025-01-01 (15K edges)  ← cold, object storage
```

**Benefit:** Fraud detection queries ("check recent transactions") only scan the hot bucket (25K edges) instead of all 10M edges. Historical analytics can access cold buckets on demand.

### Pattern 2: Ghost Replication for High-Value Border Nodes

When community-based partitioning places a partition boundary near a high-value node (e.g., a large company that many users in different communities work at), replicate that node as a "ghost" to all neighboring partitions:

```
Partition A:                    Partition B:
  user_1 ──WORKS_AT──┐          user_5 ──WORKS_AT──┐
  user_2 ──WORKS_AT──┤          user_6 ──WORKS_AT──┤
  user_3 ──WORKS_AT──┼─ ACME ◁─ user_7 ──WORKS_AT──┼─ ACME (ghost)
  user_4 ──WORKS_AT──┘          user_8 ──WORKS_AT──┘
```

**Ghost node consistency:** The ghost is read-only and refreshed via CDC from the primary copy. Writes always go to the primary, with a small staleness window (typically < 1 second).

### Pattern 3: Query Routing by Traversal Shape

Instead of routing all queries to any available node, analyze the query's traversal pattern and route to the partition most likely to serve it locally:

```
FUNCTION route_query(query):
    start_nodes = extract_starting_nodes(query)

    IF all start_nodes IN same_partition:
        RETURN route_to_partition_leader(start_nodes[0].partition)

    IF query.estimated_hops <= 2:
        // Short traversal: route to the partition with the most start nodes
        RETURN route_to_majority_partition(start_nodes)

    ELSE:
        // Deep traversal: route to query coordinator that manages distributed execution
        RETURN route_to_coordinator()
```

### Pattern 4: Incremental Repartitioning

Full graph repartitioning is expensive (O(V + E) per Louvain iteration). Incremental repartitioning reduces cost by only reassigning nodes that have significantly changed their connectivity since the last partition:

```
FUNCTION incremental_repartition(graph, current_assignment, changed_nodes):
    // Only consider nodes whose edge distribution across partitions
    // has changed significantly since last partitioning
    candidates = []
    FOR EACH node IN changed_nodes:
        current_partition = current_assignment[node.id]
        neighbor_partitions = count_neighbors_per_partition(node)

        // If >50% of neighbors are in a different partition, consider moving
        IF neighbor_partitions[current_partition] < 0.5 * node.degree():
            best_partition = max_count_partition(neighbor_partitions)
            IF partition_has_capacity(best_partition):
                candidates.append((node, best_partition))

    // Apply moves in descending order of expected improvement
    sort(candidates, by=expected_edge_cut_reduction, descending)

    FOR EACH (node, target_partition) IN candidates:
        // Online migration: copy node + edges to target, then redirect
        migrate_node_online(node, current_assignment[node.id], target_partition)
        current_assignment[node.id] = target_partition

    RETURN current_assignment
```

**Frequency:** Run daily during low-traffic windows. Full repartitioning (Louvain) runs weekly or monthly.
