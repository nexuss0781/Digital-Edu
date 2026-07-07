# Deep Dive & Bottlenecks — Graph Database

## Critical Component 1: Index-Free Adjacency Engine

### Why Is This Critical?

Index-free adjacency is the defining architectural property that separates a native graph database from a graph abstraction layer over a relational or document store. Every traversal operation — the core value proposition — depends on following physical pointers between node and relationship records rather than performing index lookups. If this mechanism is slow, the entire system's traversal performance degrades from O(1) per hop to O(log n), eliminating the graph database's advantage.

### How It Works Internally

Each node record contains a pointer to the head of its relationship chain. Each relationship record contains four pointers forming two doubly-linked lists (one per endpoint node). Traversal means reading the node record, following the `first_rel_id` pointer to the first relationship record, then walking the `start_next` / `end_next` chain to enumerate neighbors.

**Record layout on disk:**

```
Node Store File:
  Offset = node_id × RECORD_SIZE (64 bytes)
  → Direct positional access, no index needed

Relationship Store File:
  Offset = rel_id × RECORD_SIZE (64 bytes)
  → Direct positional access via pointer from node record

Property Store File:
  Offset = prop_id × RECORD_SIZE (128 bytes)
  → Accessed via pointer chain from node/relationship record
```

**Traversal cost model:**

| Operation | Disk Reads (cold) | Cache Reads (warm) | Cost |
|-----------|-------------------|-------------------|------|
| Read node record | 1 | 0 | O(1) |
| Read first relationship | 1 | 0 | O(1) |
| Walk to next relationship | 1 per step | 0 per step | O(degree) |
| Read property | 1 per property | 0 per property | O(properties) |
| 3-hop traversal (cold) | ~3 + fan-out | — | O(d^3) where d = avg degree |
| 3-hop traversal (warm) | 0 | All from cache | O(d^3) but microseconds each |

### Failure Modes

1. **Cache miss storm** — When a traversal touches nodes not in the buffer cache, each hop becomes a random disk read. With SSD latency of ~100μs per read, a 3-hop traversal touching 1000 nodes could take 100ms instead of 1ms.
   - **Mitigation:** Pre-warm buffer cache on startup by scanning relationship chains for high-degree nodes. Use read-ahead: when reading a relationship chain, prefetch the next N relationship records speculatively.

2. **Store file fragmentation** — Over time, insertions and deletions fragment the fixed-size record files, spreading logically adjacent records (a node's relationship chain) across distant disk locations.
   - **Mitigation:** Background compaction that rewrites relationship chains in traversal order. "Defragmentation" pass that colocates a node's relationships contiguously on disk.

3. **Pointer staleness after compaction** — When records are moved during compaction, all pointers referencing those records must be updated atomically.
   - **Mitigation:** Use indirection: records reference logical IDs that are resolved through a mapping table, not physical offsets. The mapping table is small and cache-friendly.

---

## Critical Component 2: Supernode Handling

### Why Is This Critical?

Real-world graphs follow power-law degree distributions: a few nodes (celebrities, companies, popular products) have millions of edges while most nodes have hundreds. These "supernodes" create asymmetric performance: a traversal that happens to touch a supernode suddenly needs to scan millions of relationship records, creating latency spikes and memory pressure that can cascade to affect other queries.

### How It Works Internally

**Detection:** A node is classified as "dense" (supernode) when its edge count exceeds a configurable threshold (typically 10,000-50,000 edges). The `dense_flag` in the node record triggers alternative data structures.

**Relationship Groups:** For dense nodes, relationships are organized into relationship groups indexed by relationship type:

```
Dense Node Record
  └── group_ptr → Relationship Group: FOLLOWS (1.2M edges)
                    └── B+ tree index on (timestamp, target_id)
                  Relationship Group: LIKES (800K edges)
                    └── B+ tree index on (timestamp, target_id)
                  Relationship Group: POSTED (50K edges)
                    └── B+ tree index on (created_at, target_id)
```

**Vertex-Centric Index:** Each relationship group maintains a B+ tree that indexes edge properties, enabling queries like "find the 10 most recent FOLLOWS relationships" without scanning all 1.2M FOLLOWS edges.

### Performance Comparison

| Query | Regular Node (1K edges) | Supernode Without VC Index | Supernode With VC Index |
|-------|------------------------|--------------------------|------------------------|
| All neighbors | 1ms (chain walk) | 10s (scan 1.2M records) | N/A (use chain for full scan) |
| Neighbors of type T | 0.5ms | 5s (scan + filter) | 2ms (skip to group) |
| Top 10 newest of type T | 0.5ms | 5s (scan + sort) | 0.1ms (B+ tree seek) |
| Count of type T | 0.5ms | 5s | 0.01ms (stored count) |

### Failure Modes

1. **Supernode lock contention** — When multiple transactions concurrently modify a supernode's relationship chain, lock contention serializes writes.
   - **Mitigation:** Use append-only relationship groups with group-level (not node-level) locks. New relationships append to the group's B+ tree without locking the entire chain.

2. **Memory amplification** — Loading a supernode's relationship group into the buffer cache may evict many regular nodes, degrading performance for other queries.
   - **Mitigation:** Separate buffer pool for supernode data with bounded allocation. Supernode traversals use streaming reads that don't cache every record.

3. **Fan-out explosion** — A 2-hop traversal from a supernode with 1M edges to other supernodes could attempt to visit 10^12 nodes.
   - **Mitigation:** Query planner detects supernode fan-out and automatically applies sampling or limit-based Cutting off unnecessary steps. The LIMIT clause is pushed down to the traversal engine before fan-out.

---

## Critical Component 3: Query Planner and Cost-Based Optimizer

### Why Is This Critical?

The same graph query can have execution plans with costs differing by orders of magnitude. For example, `MATCH (a:Person)-[:KNOWS]->(b:Person)-[:WORKS_AT]->(c:Company {name: "Acme"})` could start from Person nodes (millions) and fan out, or start from the single "Acme" Company node and traverse inward. The optimizer's ability to choose the right plan determines whether the query completes in 5ms or 50 seconds.

### How It Works Internally

**Query Planning Pipeline:**

```
Raw Query Text
    │
    ▼
[1. Parser] → AST (Abstract Syntax Tree)
    │
    ▼
[2. Semantic Analysis] → Resolved AST (labels, types validated)
    │
    ▼
[3. Logical Planner] → Logical Plan (pattern → join tree)
    │
    ▼
[4. Cost Estimator] → Annotated Plan (cardinality estimates)
    │
    ▼
[5. Physical Planner] → Physical Plan (index choices, join order)
    │
    ▼
[6. Plan Cache] → Check for reusable compiled plan
    │
    ▼
[7. Execution Engine] → Iterate and produce results
```

**Cardinality estimation sources:**

| Source | What It Provides |
|--------|-----------------|
| Label statistics | Count of nodes per label |
| Property histograms | Distribution of property values (equi-depth histograms) |
| Relationship type counts | Count of edges per type, per label pair |
| Index selectivity | Estimated fraction of nodes matching a predicate |
| Degree distribution | Percentiles of node degree (p50, p95, p99) |
| Supernode registry | List of known supernodes and their group sizes |

**Plan selection strategies:**

| Strategy | Description | When Used |
|----------|-------------|-----------|
| Index seek | Start from indexed property lookup | Unique or highly selective predicate |
| Label scan | Scan all nodes with a given label | Low-selectivity queries |
| Expand from anchor | Start from the most selective node, expand outward | Pattern matching |
| Bidirectional expand | Expand from both ends of a path pattern | Shortest path queries |
| Hash join | Hash one side, probe with the other | Large pattern matches |

### Failure Modes

1. **Stale statistics** — If cardinality estimates are outdated (e.g., after bulk load), the optimizer may choose a catastrophically bad plan.
   - **Mitigation:** Trigger statistics refresh after bulk operations. Maintain running HyperLogLog counters for approximate cardinality that update in real time.

2. **Plan cache pollution** — A cached plan that was optimal for one set of parameters may be suboptimal for different parameters with different selectivity.
   - **Mitigation:** Adaptive plan caching: monitor actual vs. estimated row counts during execution. If the ratio exceeds a threshold (10x), evict the cached plan and re-optimize.

3. **Exponential plan space** — Complex patterns with many nodes produce a combinatorial explosion of possible join orders.
   - **Mitigation:** Use Practical rule of thumb Cutting off unnecessary steps (greedy join ordering) for patterns with >6 nodes. For patterns with <=6 nodes, exhaustive enumeration with dynamic programming.

---

## Concurrency & Race Conditions

### Race Condition 1: Concurrent Edge Creation on Same Node

**Scenario:** Two transactions simultaneously create edges to the same node, both trying to update the `first_rel_id` pointer.

**Resolution:** Use compare-and-swap (CAS) on the node's `first_rel_id` pointer. The new relationship's `start_next` is set to the current `first_rel_id`, then CAS updates `first_rel_id` to the new relationship. If CAS fails (another transaction won), retry with the updated pointer.

### Race Condition 2: Read-During-Compaction

**Scenario:** A traversal is following a relationship chain while the compaction thread is rewriting records to new locations.

**Resolution:** Copy-on-write compaction: the compaction thread writes records to new locations without modifying the originals. Once all records are written, a single atomic pointer swap redirects new readers to the compacted version. In-flight readers continue using the old version (MVCC-style).

### Race Condition 3: Ghost Relationships (Dangling Pointers)

**Scenario:** Transaction A deletes a node while Transaction B creates a relationship pointing to that node.

**Resolution:** Lock ordering protocol: always acquire locks in node-ID order. Delete operations acquire exclusive locks on the node and all its relationships. The creating transaction's lock request blocks until the delete commits or aborts.

### Locking Strategy

| Operation | Lock Type | Granularity |
|-----------|-----------|-------------|
| Node read | Shared | Node record |
| Node write | Exclusive | Node record |
| Relationship creation | Exclusive | Both endpoint nodes + relationship record |
| Relationship deletion | Exclusive | Both endpoint nodes + relationship record |
| Property update | Exclusive | Property record + owning entity |
| Schema DDL | Exclusive | Database-level |

**Deadlock detection:** The transaction manager maintains a wait-for graph (itself a graph!) and detects cycles. When a deadlock is found, the youngest transaction is aborted and retried.

---

## Slowest part of the process Analysis

### Slowest part of the process 1: Cross-Partition Traversal in Distributed Deployment

**Problem:** In a distributed graph database, edges that span partition boundaries require network hops. A 3-hop traversal might cross partitions at each hop, turning a 3ms local traversal into a 30ms distributed query.

**Impact:** Latency increases by 5-10x for cross-partition edges; throughput drops as each traversal consumes network bandwidth.

**Mitigation:**
- Community-based partitioning to minimize edge cuts (Metis/Louvain algorithm)
- Speculative prefetch: when expanding a node, simultaneously fetch the next hop's data from remote partitions
- Edge colocation hints: application provides hints about frequently co-traversed paths
- Local caching of remote partition data with invalidation via change notifications

### Slowest part of the process 2: Write Amplification on Highly Connected Nodes

**Problem:** Creating a single relationship requires updating 6 records: the relationship record itself, both endpoint node records (first_rel pointers), and up to 3 existing relationship records (prev/next pointer updates in the doubly-linked lists).

**Impact:** Write throughput is ~6x lower than the theoretical maximum based on storage IOPS.

**Mitigation:**
- Batch writes: group multiple relationship creations to the same node into a single transaction with a single pointer chain update
- Append-only relationship groups for supernodes (new relationships append without updating existing records)
- WAL coalescing: combine multiple pointer updates into a single WAL entry

### Slowest part of the process 3: Memory Pressure from Large Traversal Result Sets

**Problem:** A variable-length path query like `MATCH p = (a)-[:KNOWS*1..6]->(b)` may expand exponentially, consuming gigabytes of memory for intermediate results.

**Impact:** Out-of-memory errors or aggressive garbage collection pauses that affect all queries on the server.

**Mitigation:**
- Streaming execution: produce results incrementally without materializing the full result set
- Memory budgets per query: abort queries that exceed a configurable memory threshold
- Early termination: push LIMIT and DISTINCT operators as close to the traversal as possible
- Query guard: automatic detection of runaway queries (>N seconds or >M rows expanded) with configurable action (warn, throttle, kill)

### Slowest part of the process 4: WAL Replay Latency During Recovery

**Problem:** After a crash, the database replays the WAL to reconstruct uncommitted state. With high write throughput (50K+ writes/sec), the WAL can accumulate gigabytes of entries between checkpoints, leading to multi-minute recovery times.

**Impact:** Extended RTO beyond the 30-second target; extended unavailability during leader failover if the new leader must replay a large WAL segment.

**Mitigation:**
- Frequent checkpoints: trigger a checkpoint every 100 MB of WAL or every 60 seconds
- Parallel WAL replay: group-commit structure in WAL allows concurrent replay of non-conflicting transactions
- Fuzzy checkpoints: write dirty pages incrementally (not all at once) to avoid checkpoint storms that spike write latency
- WAL segment pre-allocation: pre-allocate WAL segments to avoid filesystem allocation latency during writes

### Slowest part of the process 5: Index Build Contention

**Problem:** Creating a new index on an existing property requires scanning all nodes/edges with that property — a full-store scan that competes with production queries for buffer cache and I/O bandwidth.

**Impact:** During index creation, buffer cache hit ratio drops as the scan evicts hot pages, causing latency spikes on concurrent OLTP queries.

**Mitigation:**
- Background index population: scan at throttled rate (e.g., 10% of I/O bandwidth)
- Index build uses a separate buffer pool to avoid evicting OLTP hot pages
- Online index creation: new index becomes available for writes immediately but only used by the planner after population completes
- Incremental index build: prioritize indexing high-degree nodes and supernodes first (they generate the most query benefit)

---

## Edge Cases and Their Handling

### Edge Case (Unusual or extreme situation) 1: Circular Relationship Chains

**Scenario:** A bug in pointer management creates a cycle in a node's relationship linked list (the chain loops back to a previously visited relationship record).

**Detection:** The traversal engine maintains a visited-set bounded by the node's stored relationship count. If the traversal visits more relationships than the stored count, a circular chain is detected.

**Recovery:** Mark the node's chain as corrupted in the metadata store. Rebuild the chain from the WAL by replaying all relationship creation events for that node. Alert the operator via the corruption detection metric.

### Edge Case (Unusual or extreme situation) 2: Orphaned Relationship Records

**Scenario:** A crash occurs after writing a relationship record but before updating both endpoint nodes' pointers. The relationship record exists on disk but is unreachable from either endpoint.

**Detection:** Periodic consistency checker scans the relationship store and verifies that each active relationship is reachable from both endpoint nodes' chains.

**Recovery:** Either complete the interrupted pointer update (if WAL contains the intent) or mark the orphaned relationship as inactive and reclaim the space during compaction.

### Edge Case (Unusual or extreme situation) 3: Property Overflow Chain Corruption

**Scenario:** A large property value spans multiple overflow records. If an overflow pointer is corrupted, the property is truncated or returns garbage.

**Detection:** Each overflow record includes a checksum of its content. Property reads validate checksums and flag corruption.

**Recovery:** Restore the property from the WAL or backup. For non-critical properties, return NULL with a warning rather than failing the entire query.

### Edge Case (Unusual or extreme situation) 4: Split-Brain During Network Partition

**Scenario:** A network partition isolates the leader from the majority of followers. The old leader continues accepting writes (briefly) while the followers elect a new leader.

**Detection:** Raft's term-based fencing prevents the old leader from committing writes after a new leader is elected. The old leader's writes fail at the WAL replication step (cannot achieve quorum).

**Recovery:** When the partition heals, the old leader detects it has a stale term, aborts any in-flight transactions, and becomes a follower. It replays the new leader's WAL to converge.

### Edge Case (Unusual or extreme situation) 5: Time-Travel Query on Compacted Data

**Scenario:** A user requests a historical snapshot of the graph (e.g., "graph state as of 2 hours ago"), but compaction has already overwritten the old record versions.

**Handling:** The system maintains a configurable retention window for MVCC versions (default: 1 hour). Queries requesting snapshots beyond the retention window receive an error. For longer time-travel, periodic snapshots stored in object storage support point-in-time recovery.

---

## Algorithm Complexity Deep-Dives

### Complexity of Core Operations

| Operation | Best Case | Average Case | Worst Case | Slowest part of the process |
|-----------|-----------|-------------|-----------|-----------|
| Single-hop traversal | O(1) | O(1) | O(1) | Buffer cache miss |
| k-hop BFS traversal | O(d^k) | O(d^k) | O(V + E) | Supernode fan-out |
| Shortest path (Dijkstra) | O(d * log V) | O(V * log V) | O(V * log V + E) | Priority queue operations |
| Bidirectional shortest path | O(d * sqrt(V)) | O(sqrt(V) * log V) | O(V * log V + E) | Meeting point detection |
| Pattern matching (k nodes) | O(k * d) | O(d^k) | O(V^k) (NP-complete) | Subgraph isomorphism |
| PageRank (1 iteration) | O(V + E) | O(V + E) | O(V + E) | Memory for rank vectors |
| Community detection (Louvain) | O(V + E) | O(V * log V) | O(V^2) | Modularity computation |
| Relationship chain append | O(1) amortized | O(1) amortized | O(1) | CAS retry on contention |
| Property update | O(1) | O(chain_length) | O(chain_length) | Property chain scan |
| Index lookup (B+ tree) | O(log n) | O(log n) | O(log n + k) | Leaf page I/O |

### Why Bidirectional Search Dominates in Graph Databases

Standard Dijkstra from source explores all nodes within distance `d` of the source — roughly O(b^d) nodes where b is the branching factor and d is the path length. Bidirectional Dijkstra explores from both source and target simultaneously, meeting in the middle. Each direction explores O(b^(d/2)) nodes, and the total work is O(2 * b^(d/2)) = O(b^(d/2)).

For a social graph with branching factor 200 and path length 6:
- Unidirectional: 200^6 = 6.4 × 10^13 nodes explored
- Bidirectional: 2 × 200^3 = 1.6 × 10^7 nodes explored
- Speedup: ~4 million times faster

This explains why shortest-path queries in social graphs (which typically have diameter 6-7) are tractable despite the enormous graph size.

### Query Plan Cost Model

The cost-based optimizer uses the following cost model for plan selection:

```
FUNCTION estimate_plan_cost(plan):
    total_cost = 0

    FOR EACH operator IN plan.operators:
        SWITCH operator.type:
            CASE IndexSeek:
                // B+ tree traversal: log(n) page reads + result scan
                cost = log2(index_size) * PAGE_READ_COST + selectivity * index_size * TUPLE_COST

            CASE LabelScan:
                // Sequential scan of all nodes with label
                cost = label_count * TUPLE_COST

            CASE Expand:
                // Follow relationship chain
                input_cardinality = operator.input.estimated_rows
                avg_degree = stats.avg_degree(operator.rel_type)
                cost = input_cardinality * avg_degree * TRAVERSAL_HOP_COST

                // Penalty for supernode risk
                IF stats.p99_degree(operator.rel_type) > SUPERNODE_THRESHOLD:
                    cost = cost * SUPERNODE_PENALTY_FACTOR

            CASE Filter:
                // Apply predicate to each row
                cost = operator.input.estimated_rows * PREDICATE_EVAL_COST

            CASE HashJoin:
                // Build hash table + probe
                build_cost = operator.build_input.estimated_rows * HASH_BUILD_COST
                probe_cost = operator.probe_input.estimated_rows * HASH_PROBE_COST
                cost = build_cost + probe_cost

        total_cost = total_cost + cost

    // Add cross-partition penalty
    IF plan.crosses_partitions:
        total_cost = total_cost + plan.partition_crossings * NETWORK_HOP_COST

    RETURN total_cost

// Cost constants (calibrated per hardware)
PAGE_READ_COST = 1.0        // baseline: one page read from buffer cache
TUPLE_COST = 0.01           // processing one record
TRAVERSAL_HOP_COST = 0.1    // following one relationship pointer
PREDICATE_EVAL_COST = 0.05  // evaluating one filter predicate
HASH_BUILD_COST = 0.02      // inserting one entry into hash table
HASH_PROBE_COST = 0.01      // probing hash table for one key
NETWORK_HOP_COST = 100.0    // one cross-partition network call
SUPERNODE_PENALTY_FACTOR = 5.0  // multiplier for potential supernode fan-out
```

### Adaptive Query Execution

When the cost-based optimizer makes a wrong estimate (stale statistics, skewed data), adaptive execution detects the mismatch at runtime and adjusts:

```
FUNCTION adaptive_execute(plan, monitor):
    FOR EACH operator IN plan.execution_order:
        actual_rows = execute_operator(operator)
        estimated_rows = operator.estimated_rows

        ratio = actual_rows / estimated_rows

        IF ratio > 10 OR ratio < 0.1:
            // Cardinality estimate is off by 10x+
            monitor.flag_plan_regression(plan.id, operator, ratio)

            IF ratio > 100:
                // Catastrophic misestimate — re-optimize remaining plan
                remaining_ops = plan.operators_after(operator)
                new_plan = re_optimize(remaining_ops, actual_cardinalities)
                RETURN execute_plan(new_plan)

            IF actual_rows > MEMORY_BUDGET:
                // Switch from materialized to streaming execution
                operator.switch_to_streaming()

        // Update running statistics for future plans
        stats.update_histogram(operator.label, operator.property, actual_rows)

    RETURN results
```

---

## Real-World: Social Network Graph at Scale

A major social network manages a graph with 2+ billion nodes and 1+ trillion edges. Their graph storage handles 10 million+ read QPS at p99 latency under 10ms. Key architecture decisions:

- **TAO-style caching**: A distributed, write-through cache layer sits in front of the graph storage, caching both objects (nodes) and associations (edges). Cache serves 99.9% of reads.
- **Association lists**: Edges from a single node are stored as a sorted list in a single storage row, rather than individual records. This enables efficient range queries ("most recent 100 friends") without scanning.
- **Shard by node ID**: Despite the theoretical problems with hash partitioning, at this scale the cache absorption rate is so high that cross-shard traversals are rare at the storage layer — most multi-hop queries are served entirely from cache.
- **Write-through with async fan-out**: Writes update the primary store synchronously but fan out cache invalidations asynchronously. The system tolerates brief inconsistency windows (< 1 second) for read-after-write on different cache servers.

**Key metric:** Cache hit ratio of 99.9% transforms what would be a 10ms per-hop storage latency into a 0.1ms cache read, making 4-hop traversals complete in < 1ms.

---

## Real-World: Financial Fraud Detection Graph

A global payment processor uses a real-time graph database to detect fraud rings. Their system processes 300K+ transactions per second, each requiring a 3-4 hop graph traversal to check for known fraud patterns.

- **Pattern**: Each transaction creates a temporary edge between buyer, seller, device, IP address, and payment instrument. The system looks for rings (cycles) of length 3-5 that match known fraud typologies.
- **Latency budget**: The fraud check must complete within 50ms to avoid blocking the payment. This budget covers the graph traversal (30ms), scoring model (15ms), and network overhead (5ms).
- **Hot-warm-cold architecture**: The last 24 hours of transaction edges are "hot" (in-memory), the last 30 days are "warm" (SSD), and older data is archived. 95% of fraud detection queries touch only hot data.
- **Supernode problem**: Large merchants (receiving millions of payments) create supernodes. The system uses edge-type bucketing: merchant-to-transaction edges are partitioned by hour, so a fraud check only scans the current hour's edges (thousands) rather than all-time edges (millions).

**Key metric:** Graph-based fraud detection catches 60% more fraud rings than rules-based systems, with a 30% lower false-positive rate, because graph traversal reveals indirect relationships that rule engines cannot express.

---

## Failure Mode Analysis

### Failure Mode 1: Cascading Buffer Cache Eviction

**Trigger:** A single analytics query scans 10M+ nodes, evicting the hot OLTP working set from the buffer cache.

**Cascade:**
1. Analytics scan fills the buffer cache with cold pages
2. Hot OLTP pages are evicted
3. Subsequent OLTP traversals experience cache misses
4. OLTP latency spikes from 5ms → 500ms
5. Upstream services hit timeouts, generate retries
6. Retry storm amplifies load, worsening eviction

**Prevention:**
- Separate buffer pools for OLTP and analytics workloads (bulkhead pattern)
- Analytics queries use streaming reads that bypass the buffer cache entirely
- Admission control: analytics queries checked against available buffer pool before execution
- Query cost estimation blocks analytics queries during high OLTP load periods

### Failure Mode 2: Replication Lag Spiral

**Trigger:** A burst of write traffic causes replication lag on followers. Read queries redirect to the leader, increasing leader load, which further increases lag.

**Cascade:**
1. Write burst (e.g., bulk import) saturates leader's WAL throughput
2. Followers fall behind applying WAL entries
3. Read queries configured for "strong consistency" redirect from lagging followers to leader
4. Leader CPU and I/O increase from serving both reads and writes
5. WAL generation slows, but followers still can't catch up because the lag has compounded
6. Eventually, follower lag exceeds the WAL retention window, requiring full resync

**Prevention:**
- Write throttling: limit write QPS when follower lag exceeds threshold (e.g., 5 seconds)
- Stale-read tolerance: allow queries to declare acceptable staleness ("I can tolerate 10s lag")
- WAL compression: reduce replication bandwidth by compressing WAL entries
- Follower read routing with staleness-aware load balancer: only route to followers within acceptable lag

### Failure Mode 3: Deadlock Storm on Hot Subgraph

**Trigger:** Multiple concurrent transactions mutate edges in a densely connected subgraph (e.g., a viral social media post receiving thousands of reactions simultaneously).

**Cascade:**
1. 100+ transactions attempt to create edges to the same hot node
2. Lock ordering prevents most deadlocks, but some arise from multi-node patterns
3. Deadlock detection aborts the youngest transaction in each cycle
4. Aborted transactions retry, finding the same hot node still contended
5. Retry-abort cycle creates a deadlock storm where throughput drops to near-zero

**Prevention:**
- Lock-free append for supernodes: use CAS-based append-only relationship groups instead of exclusive locks
- Batch coalescing: group concurrent edge creations to the same node into a single batch transaction
- Exponential backoff with jitter: aborted transactions wait increasingly long before retry
- Circuit breaker: if abort rate on a specific node exceeds threshold, queue mutations for batch application

### Failure Mode 4: Query Planner Regression After Bulk Load

**Trigger:** A bulk data load changes the statistical properties of the graph (new labels, different cardinality distribution) without refreshing the query planner's statistics.

**Impact:**
- The planner uses stale cardinality estimates, choosing plans that were optimal for the pre-load distribution
- A query that took 5ms now takes 50 seconds because the planner selects a full label scan instead of an index seek
- Multiple queries regress simultaneously, saturating the query thread pool

**Prevention:**
- Automatic statistics refresh after bulk operations (trigger on "WAL bytes written > threshold")
- Plan regression detection: compare actual vs. estimated cardinality during execution; if >10x off, invalidate cached plan
- Statistics sampling: maintain approximate statistics updated in real-time via HyperLogLog counters
- Query regression testing: run a suite of representative queries after bulk loads and alert on latency regression

---

## Consistency Guarantees Deep-Dive

### Transaction Isolation Levels for Graph Queries

| Isolation Level | Behavior | Use Case | Performance Impact |
|----------------|----------|----------|-------------------|
| **READ UNCOMMITTED** | Traversals may see uncommitted edges (dirty reads) | Never recommended for graph databases | Lowest overhead |
| **READ COMMITTED** | Each statement sees only committed data | Simple lookups, non-critical traversals | Low overhead |
| **SNAPSHOT (REPEATABLE READ)** | Entire traversal sees consistent snapshot | Multi-hop traversals that must see a coherent graph | Medium (MVCC overhead) |
| **SERIALIZABLE** | Transactions appear to execute sequentially | Financial graphs, audit trails | High (conflict detection) |

**Why SNAPSHOT is the recommended default for graphs:** A multi-hop traversal under READ COMMITTED could see inconsistent state: hop 1 sees pre-commit state while hop 3 sees post-commit state. This can produce phantom paths — a traversal that returns a path A→B→C→D where the A→B edge existed before a concurrent modification and the C→D edge was created by that modification. SNAPSHOT isolation prevents this by ensuring the entire traversal sees the graph as of a single point in time.

### Linearizability for Single-Node Operations

While full serializable isolation is expensive, single-node operations (read or write a specific node) can provide linearizability efficiently:

```
FUNCTION linearizable_read(node_id):
    // Ensure we read the latest committed version
    // Option 1: Read from leader (always has latest state)
    IF routing_to_leader:
        RETURN leader.read(node_id)

    // Option 2: Read from follower with lease check
    IF follower.lease_is_valid():
        // Leader hasn't revoked our lease; our data is current
        RETURN follower.read(node_id)
    ELSE:
        // Lease expired; forward to leader
        RETURN leader.read(node_id)
```
