# Deep Dive & Bottlenecks — Data Warehouse

## Critical Component 1: Columnar Compression and Encoding Engine

### Why Is This Critical?

Compression is not merely a storage optimization — it is the mechanism that transforms a network-bound system into a CPU-bound one. In a separated compute/storage architecture, every byte of data must traverse the network from object storage to compute nodes. A 10:1 compression ratio means 10x less network transfer, 10x more effective cache capacity, and 10x less I/O wait. The encoding engine's ability to select optimal encodings per column directly determines query performance, storage cost, and network bandwidth consumption.

### How It Works Internally

The encoding engine analyzes each column's data characteristics during micro-partition creation and selects the optimal encoding:

```
Column Analysis Pipeline:

1. Sample first 10,000 values of each column
2. Compute statistics:
   - Cardinality (distinct count via HyperLogLog)
   - Sortedness (fraction of adjacent pairs in order)
   - Null fraction
   - Value range (min, max)
   - Average value length (for strings)
3. Select encoding based on decision tree:

   IF cardinality < 0.1 * row_count → DICTIONARY encoding
   ELSE IF sortedness > 0.9 → RLE + DELTA hybrid
   ELSE IF type == INTEGER AND (max - min) < 2^16 → BIT-PACKING
   ELSE IF type == TIMESTAMP → DELTA encoding (on epoch microseconds)
   ELSE → PLAIN encoding with Zstd compression
```

**Compression chain (applied in order):**

| Stage | Operation | Example |
|-------|-----------|---------|
| 1. Encoding | Dictionary, RLE, Delta, Bit-pack | "USA","USA","CAN" → [0, 0, 1] + dict{0:"USA", 1:"CAN"} |
| 2. Bit-packing | Pack encoded values into minimal bits | [0, 0, 1] with 1-bit → packed into 3 bits |
| 3. General compression | Zstd or LZ4 on encoded byte stream | Further 2-4x reduction on already-encoded data |

**Net result:** A column of country codes (200 distinct values across 100M rows) compresses from 800 MB (8 bytes per string avg) to ~2 MB (dictionary + 8-bit codes + Zstd). That is a 400:1 compression ratio.

### Failure Modes

1. **Dictionary overflow** — A column initially has low cardinality but grows beyond the dictionary size limit (e.g., free-text fields misclassified as low-cardinality).
   - **Mitigation:** Fall back to plain encoding mid-partition. Monitor dictionary cardinality growth across partitions and switch encoding proactively during re-clustering.

2. **Encoding skew across partitions** — Different partitions of the same column use different encodings (e.g., old partitions use dictionary, new ones use plain), causing inconsistent scan performance.
   - **Mitigation:** Automatic re-clustering service periodically re-encodes partitions with suboptimal encoding. Store encoding metadata in the partition footer so the scan engine adapts per partition.

3. **Decompression CPU Slowest part of the process** — With high compression ratios, the compute node may spend more time decompressing than scanning, shifting the Slowest part of the process from I/O to CPU.
   - **Mitigation:** Use lightweight compression (LZ4 over Zstd) for hot partitions. Vectorized decompression using SIMD instructions. Skip decompression entirely for predicate evaluation on dictionary-encoded columns (compare against dictionary codes, not raw values).

---

## Critical Component 2: Query Execution Engine (Vectorized vs. Volcano)

### Why Is This Critical?

The execution engine determines how efficiently CPU cores process the data after it has been read from storage. The traditional Volcano (iterator) model processes data one row at a time, incurring function-call overhead for every row at every operator. Vectorized execution processes data in columnar batches of 1,000-4,000 values, amortizing function-call overhead and enabling CPU-cache-friendly access patterns and SIMD parallelism.

### How It Works Internally

**Volcano Model (traditional):**

```
FOR EACH row from child operator:
    apply operator logic to single row
    emit row to parent operator

Cost per row: ~10 virtual function calls + branch mispredictions
At 1 billion rows: 10 billion function calls → ~5 seconds of overhead alone
```

**Vectorized Model (modern):**

```
FOR EACH batch (1024 rows) from child operator:
    apply operator logic to entire column batch at once
    emit batch to parent operator

Cost per batch: 1 function call + tight loop over 1024 values
At 1 billion rows: ~1 million function calls → ~0.5ms of overhead
```

**Performance comparison:**

| Metric | Volcano (row-at-a-time) | Vectorized (batch) | Improvement |
|--------|------------------------|--------------------|-------------|
| Function calls per 1B rows | 10B | 1M | 10,000x |
| L1 cache hit rate | ~60% (random access) | ~95% (sequential) | 1.6x |
| SIMD utilization | None | Full (AVX-512) | 8-16x per operation |
| Branch predictions | Poor (data-dependent) | Excellent (tight loops) | 2-3x |
| Overall scan throughput | 100 MB/s per core | 2 GB/s per core | 20x |

**Pipeline breakers:** Certain operations (hash table builds, sorts, window function evaluations) require materializing intermediate results. The execution engine inserts pipeline breakers at these points, buffering data in memory or spilling to local disk.

### Failure Modes

1. **Memory exhaustion from pipeline breakers** — A large hash join builds a hash table that exceeds available memory.
   - **Mitigation:** Graceful spill-to-disk: partition the hash table into memory-sized chunks, spill overflow to local SSD, and probe in passes. Monitor spill ratio as a key performance metric.

2. **Skewed parallelism** — One compute node processes a disproportionately large partition (data skew), becoming the Slowest part of the process while other nodes idle.
   - **Mitigation:** Dynamic work stealing: idle nodes request work from busy nodes. Sub-partition large partitions into smaller units distributed across nodes.

3. **Query compilation latency** — Complex queries with many joins take hundreds of milliseconds to compile into vectorized execution plans.
   - **Mitigation:** Plan caching keyed by parameterized query signature. Warm caches for known dashboard queries during warehouse startup.

---

## Critical Component 3: Micro-Partition Cutting off unnecessary steps and Zone Maps

### Why Is This Critical?

Partition Cutting off unnecessary steps is the single most impactful optimization in a data warehouse. A query against a 10 TB table that prunes 98% of partitions scans only 200 GB — a 50x reduction in I/O, network transfer, and compute cost. Zone maps (per-partition min/max statistics) enable this Cutting off unnecessary steps without any additional storage overhead beyond the partition footer metadata.

### How It Works Internally

```
Zone Map Cutting off unnecessary steps Decision Flow:

Query: SELECT * FROM sales WHERE sale_date = '2024-06-15' AND region = 'EU'

Partition 0001: sale_date [2024-01-01, 2024-01-31], region ['AP', 'NA']
  → PRUNED (date outside range AND region outside range)

Partition 0042: sale_date [2024-06-01, 2024-06-30], region ['EU', 'NA']
  → CANDIDATE (date range includes target, region range includes target)

Partition 0043: sale_date [2024-06-01, 2024-06-30], region ['AP', 'AP']
  → PRUNED (region outside range even though date matches)
```

**Clustering depth metric:** Measures the average overlap of micro-partitions for a given column. A clustering depth of 1.0 means each value range appears in exactly one partition (perfect Cutting off unnecessary steps). A depth of 50 means each value range spans 50 partitions (poor Cutting off unnecessary steps).

**Cutting off unnecessary steps effectiveness by scenario:**

| Scenario | Clustering Depth | Partitions Scanned | Cutting off unnecessary steps Rate |
|----------|-----------------|-------------------|--------------|
| Query on clustering key with good clustering | 1-2 | 2 of 10,000 | 99.98% |
| Query on clustering key with moderate clustering | 10-20 | 20 of 10,000 | 99.8% |
| Query on non-clustered column | 5,000-10,000 | ~5,000 of 10,000 | 50% |
| Query with no filterable predicates | N/A | 10,000 of 10,000 | 0% |

### Failure Modes

1. **Clustering degradation over time** — As new data is loaded, micro-partitions accumulate with overlapping value ranges, reducing Cutting off unnecessary steps effectiveness.
   - **Mitigation:** Automatic re-clustering service monitors clustering depth and merges/re-sorts partitions when depth exceeds a threshold. Prioritize re-clustering for tables with frequent filtered queries.

2. **Zone map ineffectiveness for high-cardinality columns** — A column with unique values (e.g., user_id) has zone maps where min/max ranges overlap heavily across all partitions.
   - **Mitigation:** Use Bloom filters for high-cardinality equality predicates. Bloom filters add ~1% storage overhead but enable Cutting off unnecessary steps for columns where zone maps cannot.

3. **Predicate on computed expressions** — A query like `WHERE EXTRACT(MONTH FROM sale_date) = 6` cannot use zone maps because the predicate is on a function of the column, not the column itself.
   - **Mitigation:** The query optimizer rewrites function-based predicates into range predicates where possible (e.g., `MONTH(sale_date) = 6` → `sale_date >= '2024-06-01' AND sale_date < '2024-07-01'`). Alternatively, define a virtual clustering key on the expression.

---

## Critical Component 4: Cardinality Estimation and Its Cascading Impact

### Why Is This Critical?

The cost-based optimizer selects join strategies, join ordering, and parallelism levels based on cardinality estimates — predictions of how many rows each operator will produce. A 10x cardinality underestimate can cause the optimizer to choose a broadcast join (copy small table to all nodes) for a table that is actually large, exhausting memory. A 10x overestimate can cause an unnecessary hash repartition join when a broadcast would have been 50x faster. Cardinality estimation errors compound multiplicatively through a query plan: if each of 5 joins has a 3x error, the final estimate can be off by 3^5 = 243x.

### How It Works Internally

```
Cardinality Estimation Pipeline:

1. Base table statistics (maintained by automatic analyze):
   - Row count per table
   - Distinct count per column (HyperLogLog)
   - Histogram buckets (equi-depth, 256 buckets)
   - Null fraction per column
   - Average column width

2. Predicate selectivity estimation:
   - Equality: selectivity = 1 / NDV (number of distinct values)
   - Range: selectivity = (range_width / total_range) adjusted by histogram
   - LIKE: selectivity = Practical rule of thumb (default 10% for prefix match)
   - IN list: selectivity = list_size / NDV
   - OR: P(A) + P(B) - P(A)*P(B) (independence assumption)
   - AND: P(A) * P(B) (independence assumption — DANGEROUS for correlated columns)

3. Join cardinality:
   - Inner join: |A| * |B| * selectivity(join_predicate)
   - Where selectivity = 1 / MAX(NDV(A.key), NDV(B.key))
   - Adjusted for foreign key relationships (if detected)

4. Known failure modes:
   - Correlated predicates: WHERE country='US' AND state='CA' are NOT independent
   - Skewed distributions: a few values dominate (Zipf's law)
   - Post-join predicates: selectivity after join is hard to estimate
```

### Failure Modes

1. **Correlated column blindness** — The optimizer assumes `WHERE country='US' AND currency='USD'` have independent selectivity (e.g., 1/200 * 1/150 = tiny), when in reality they are strongly correlated (selectivity closer to 1/200).
   - **Mitigation:** Multi-column statistics (column groups) that capture joint distributions. Alternatively, post-execution feedback: if actual cardinality deviates >10x from estimate, update statistics and re-optimize on next execution.

2. **Stale statistics** — Statistics computed days ago do not reflect recent bulk loads. A table that was 1M rows when analyzed is now 100M rows.
   - **Mitigation:** Lightweight statistics maintenance during ingestion: update row counts and zone maps atomically with partition metadata. Full histogram rebuild on a schedule (e.g., weekly or after >10% data change).

3. **Estimation error amplification** — A 3x error at the scan level becomes a 9x error after a join, becomes a 27x error after a second join.
   - **Mitigation:** Adaptive query execution: mid-flight plan adjustment based on observed intermediate cardinalities. If actual cardinality at a pipeline breaker is >5x different from estimate, re-optimize the remaining plan.

---

## Critical Component 5: Data Spill Management

### Why Is This Critical?

When an operator (hash join, sort, aggregation) exceeds its memory budget, intermediate data must be spilled to local disk. Spill transforms a memory-bound operation into a disk-I/O-bound operation, often causing 10-20x slowdown. The spill strategy — how data is partitioned, when spill triggers, and how spilled data is read back — directly determines whether a large query completes in 30 seconds or 10 minutes.

### How It Works Internally

```
FUNCTION hash_join_with_spill(build_side, probe_side, memory_budget):
    // Phase 1: Partition both sides by hash of join key
    num_partitions = CEIL(estimated_build_size / memory_budget) * 2
    build_partitions = partition_by_hash(build_side, num_partitions)
    probe_partitions = partition_by_hash(probe_side, num_partitions)

    result = []
    FOR i IN 0..num_partitions:
        IF build_partitions[i].fits_in_memory(memory_budget):
            // In-memory hash join for this partition
            hash_table = build_hash_table(build_partitions[i])
            FOR EACH row IN probe_partitions[i]:
                matches = hash_table.probe(row.join_key)
                result.extend(matches)
        ELSE:
            // Recursive partitioning: sub-partition and retry
            sub_build = partition_by_hash(build_partitions[i], num_partitions)
            sub_probe = partition_by_hash(probe_partitions[i], num_partitions)
            // Write sub-partitions to local SSD (spill)
            spill_to_disk(sub_build, sub_probe)
            // Process sub-partitions one at a time
            FOR j IN 0..num_partitions:
                result.extend(in_memory_hash_join(
                    read_from_disk(sub_build[j]),
                    read_from_disk(sub_probe[j])
                ))

    RETURN result

// Spill indicators to monitor:
//   spill_bytes: total bytes written to local disk
//   spill_passes: number of recursive partitioning rounds (>2 = severe)
//   spill_ratio: spill_bytes / total_data_processed (>20% = resize warehouse)
```

---

## Concurrency & Race Conditions

### Race Condition 1: Concurrent Reads During Data Loading

**Scenario:** A bulk load is creating new micro-partitions while concurrent queries scan the same table.

**Resolution:** Snapshot isolation via metadata versioning. Each query sees a consistent snapshot of the metadata catalog at query start time. New partitions become visible only after the load transaction commits an atomic metadata pointer swap. In-flight queries continue reading the old partition set.

### Race Condition 2: Concurrent Materialized View Refresh and Query

**Scenario:** A materialized view refresh is writing new partitions while a query reads the view.

**Resolution:** Double-buffering: the refresh writes new partitions under a new version ID. When refresh completes, an atomic metadata update swaps the current version pointer. Queries in flight continue reading the old version; new queries see the refreshed version.

### Race Condition 3: Time Travel Snapshot vs. Partition Garbage Collection

**Scenario:** A time travel query requests data as of 48 hours ago, but partition garbage collection has already deleted old partitions beyond the retention window.

**Resolution:** Time travel retention policy is enforced at the garbage collection level. The GC process checks all active time travel retention windows before deleting any partition. Partitions are deleted only when they are outside ALL active retention windows.

### Race Condition 4: Concurrent Re-Clustering and Data Loading

**Scenario:** The automatic re-clustering service is merging and re-sorting partitions for table T while a concurrent COPY INTO operation is loading new data into the same table.

**Resolution:** The re-clustering service operates on a snapshot of the partition list. New partitions added by the COPY operation are invisible to the in-progress re-clustering job. When re-clustering commits its metadata swap, it performs an optimistic concurrency check: if the partition list has changed (new partitions added), it merges its changes with the concurrent additions. If a conflict occurs (e.g., both operations replaced the same partition), the re-clustering job retries with the updated partition list.

### Race Condition 5: Warehouse Suspend During Active Query

**Scenario:** Auto-suspend triggers while a long-running query is still executing. The warehouse begins shutting down compute nodes that are processing query fragments.

**Resolution:** The auto-suspend mechanism checks for active queries before initiating shutdown. Suspend is deferred until all in-flight queries complete or until the maximum defer time (configurable, default 30 minutes) is reached. If the defer limit is exceeded, the longest-running query is terminated with a warning and the warehouse suspends. A `warehouse.suspend_deferred` metric tracks how often this occurs.

### Locking Strategy

| Operation | Lock Type | Granularity | Notes |
|-----------|-----------|-------------|-------|
| SELECT query | None (snapshot isolation) | Table-level snapshot | Reads never block writes |
| INSERT / COPY | Table-level metadata lock | Metadata catalog entry | Short-duration lock during commit |
| UPDATE / DELETE | Partition-level write lock | Affected partitions | Copy-on-write creates new partitions |
| DDL (ALTER TABLE) | Schema-level exclusive lock | Table schema | Blocks concurrent DDL on same table |
| Materialized view refresh | View-level write lock | View metadata | Concurrent reads continue on old version |
| Re-clustering | Partition-group write lock | Subset of partitions | Optimistic concurrency with retry |

---

## Slowest part of the process Analysis

### Slowest part of the process 1: Network Bandwidth Between Compute and Storage

**Problem:** In a separated architecture, every un-cached data access requires a network fetch from object storage. A single compute node scanning 1 TB of data at 10 Gbps takes 800 seconds — far exceeding query latency targets.

**Impact:** Queries on cold data (not in local cache) are 10-50x slower than queries on cached data.

**Mitigation:**
- Columnar storage with compression reduces data transfer by 10x (1 TB raw → 100 GB on wire)
- Column Cutting off unnecessary steps skips irrelevant columns (query touches 3 of 50 columns → 94% reduction)
- Partition Cutting off unnecessary steps skips irrelevant partitions (WHERE clause eliminates 95%+)
- Local SSD cache stores frequently accessed partitions (cache hit ratio target > 80%)
- Prefetching: read-ahead of adjacent partitions while processing current batch
- Net effect: 1 TB raw → 100 GB compressed → 6 GB after column Cutting off unnecessary steps → 300 MB after partition Cutting off unnecessary steps → served from SSD cache in most cases

### Slowest part of the process 2: Spill-to-Disk During Large Joins and Sorts

**Problem:** Hash joins and ORDER BY operations that exceed available memory must spill intermediate results to local disk, dramatically increasing query latency.

**Impact:** A query that fits in memory completes in 5 seconds; the same query with spill may take 60 seconds due to disk I/O overhead.

**Mitigation:**
- Right-size compute warehouses: larger warehouses have more memory per node
- Partial aggregation before joins reduces intermediate result sizes
- Bloom filter pre-filtering: build a Bloom filter on the smaller join side and filter the larger side before building the hash table
- Monitor spill-to-disk ratio as a key metric; alert when spill exceeds 10% of total data processed

### Slowest part of the process 3: Metadata Service Hot Path

**Problem:** Every query consults the metadata service for table schemas, zone maps, and access control policies. At 50+ concurrent queries per second, the metadata service becomes a Slowest part of the process.

**Impact:** Metadata lookups add 50-200ms to query compilation time; under contention, this grows to seconds.

**Mitigation:**
- Aggressive metadata caching in the cloud services layer (most metadata changes infrequently)
- Read replicas of the metadata store for read-heavy workload
- Batch metadata lookups: a single query touching 5 tables fetches all schemas in one round trip
- Partition statistics are cached and invalidated only on data change events

### Slowest part of the process 4: Object Storage GET Request Rate

**Problem:** Object storage services impose rate limits (typically 5,000-50,000 GET requests per second per bucket prefix). A large scan query reading 10,000 partitions with 50 columns each generates 500,000 GET requests. At scale, multiple concurrent queries can exhaust the rate limit.

**Impact:** Request throttling from object storage causes exponential backoff delays, turning a 10s query into a 60s query.

**Mitigation:**
- Column chunks colocated in fewer, larger files (reduce GET count per partition)
- Request hedging: send parallel requests to multiple object storage endpoints; use first response
- SSD cache absorbs repeated access patterns (80%+ cache hit rate eliminates most GET requests)
- Prefix sharding: distribute partitions across multiple bucket prefixes to multiply the rate limit
- Column chunk coalescing: read adjacent column chunks in a single GET with byte-range requests

### Slowest part of the process 5: Data Skew in Distributed Joins

**Problem:** When the join key has a skewed distribution (e.g., 30% of orders belong to the top 1% of customers), hash repartition sends a disproportionate amount of data to one node, creating a Slowest part of the process.

**Impact:** One node processes 30% of the join while 15 other nodes sit idle, making the query 5x slower than evenly distributed.

**Mitigation:**
- Skew detection in the optimizer: if a join key's histogram shows > 10x frequency skew, activate skew handling
- Skew join: broadcast the heavy-hitter keys to all nodes; hash-partition only the long-tail keys
- Dynamic work stealing: idle nodes pull work from overloaded nodes mid-execution
- Pre-aggregation: if the query aggregates after the join, push partial aggregation before the join to reduce skew impact

---

## Algorithm Complexity Analysis

| Algorithm | Time Complexity (Speed of the algorithm) | Space Complexity (Memory usage of the algorithm) | Notes |
|-----------|----------------|------------------|-------|
| Zone map Cutting off unnecessary steps | O(P) | O(1) | P = total partitions; compare predicate against min/max |
| Bloom filter probe | O(k) per value | O(m) per filter | k = hash functions, m = filter bits |
| Columnar scan (vectorized) | O(S × C) | O(batch_size) | S = surviving rows, C = predicate columns |
| Hash join (in-memory) | O(B + P) | O(B) | B = build side rows, P = probe side rows |
| Hash join (with spill) | O((B + P) × passes) | O(memory_budget) | passes = recursive partitioning rounds |
| Sort-merge join | O(N × log N) | O(N) | N = rows to sort |
| Broadcast join | O(S × L) | O(S) on each node | S = small table, L = large table per node |
| DP join enumeration | O(2^n) | O(2^n) | n = number of tables (capped at 10) |
| Greedy join ordering | O(n²) | O(n) | n = number of tables (for > 10 tables) |
| Re-clustering (one group) | O(G × N × log N) | O(G × N) | G = partitions in group, N = rows per partition |
| Materialized view match | O(V × Q) | O(V) | V = views, Q = query subexpressions |
| Cardinality estimation | O(H) | O(H) | H = histogram buckets (typically 256) |

---

## Edge Cases

### Edge Case (Unusual or extreme situation) 1: Schema Evolution During Time Travel Query

**Scenario:** A user runs `SELECT * FROM orders AT TIMESTAMP '2024-01-15'`, but the table had a different schema on that date (column `discount_pct` has since been added).

**Handling:** The time travel engine resolves the schema at the requested timestamp from the metadata version history. Columns that did not exist at that time are returned as NULL. Columns that have been dropped are included if they existed at that time. The query operates against the historical schema, not the current one.

### Edge Case (Unusual or extreme situation) 2: Partition Size Explosion from High-Cardinality Clustering Key

**Scenario:** A table clustered on `user_id` (100M distinct values) creates micro-partitions so fine-grained that partition count exceeds 500K, causing metadata operations to slow dramatically.

**Handling:** The re-clustering engine enforces a minimum partition size (50 MB). If the clustering key cardinality would create sub-minimum partitions, it groups adjacent key ranges into composite partitions. A warning metric (`partition_count_excessive`) alerts operators when partition count exceeds 100K per table.

### Edge Case (Unusual or extreme situation) 3: Result Cache Invalidation Storm

**Scenario:** A large bulk load touches 50 tables simultaneously. All result cache entries for those tables are invalidated, causing a cache miss storm where 200 dashboard queries simultaneously hit object storage.

**Handling:** Staggered invalidation: invalidate cache entries over a 5-second window rather than atomically. Priority-based re-warming: pre-execute the top 50 most-cached queries in the background immediately after the load commits. Cache grace period: serve slightly stale results for 10 seconds while re-warming (configurable, opt-in).

### Edge Case (Unusual or extreme situation) 4: Cross-Warehouse Query Coordination

**Scenario:** A query references both a table in the analytics database and a shared table from another organization. The two datasets reside in different warehouses with different compute clusters.

**Handling:** The coordinator decomposes the query into sub-plans: local scans execute on the local warehouse's compute, remote scans execute via the data sharing API, and intermediate results are shuffled to the coordinator for the join. The query plan explicitly models network cost for cross-warehouse data transfer.

### Edge Case (Unusual or extreme situation) 5: Dictionary Encoding Overflow Mid-Partition

**Scenario:** During ingestion, a string column starts with low cardinality (country codes) but a batch includes a free-text field misrouted to this column, causing dictionary size to exceed the 64K entry limit.

**Handling:** The encoder detects dictionary overflow and falls back to plain encoding for the remaining values in the partition. The partition footer records a mixed encoding marker. Subsequent partitions analyze the new data distribution and may select plain encoding from the start. A data quality alert is raised for the unexpected cardinality spike.

### Edge Case (Unusual or extreme situation) 6: Zombie Warehouse (Auto-Resume Loop)

**Scenario:** A warehouse is configured with auto-suspend after 5 minutes and auto-resume on query. A monitoring dashboard sends a health-check query every 4 minutes, preventing the warehouse from ever suspending.

**Handling:** The workload manager classifies health-check queries (metadata-only, zero-scan queries) and excludes them from the auto-suspend activity timer. Only user-initiated queries that actually scan data reset the suspend timer. A cost alert warns when a warehouse has been running continuously for >24 hours with <10% utilization.

---

## Real-World Case Studies

### Real-World: Pinterest

Pinterest migrated from a coupled MPP warehouse to a cloud-native separated architecture. Previous system required 3-day advance notice for resizing with peak concurrency capped at 40 queries. After migration: on-demand scaling from 4 to 64 nodes in under 60 seconds, supporting 200+ concurrent queries. Key numbers: 30 PB analytical data, 15,000 daily queries from 800 analysts, p95 latency reduced from 45s to 8s. Engineering decision: invested in clustering key optimization, achieving 98% average partition Cutting off unnecessary steps across top 100 tables.

### Real-World: Capital One

Capital One's warehouse supports regulatory reporting across 65 million customer accounts. Critical requirement: any two analysts running the same query at the same time must see identical results (audit consistency). Architecture uses snapshot isolation with immutable micro-partitions. Key numbers: 40 TB compressed, 500 concurrent BI users, sub-5s compliance dashboard latency, zero inconsistency incidents across 3 years of SOC 2 audits. Engineering decision: customer-managed encryption keys with automatic rotation, ensuring even the warehouse operator cannot access unencrypted data.

### Real-World: Instacart

Instacart processes 500 million grocery transactions daily for real-time demand forecasting and pricing. Primary challenge: pricing decisions required sub-60s data freshness, but batch loading had 15-minute latency. Redesigned to streaming micro-batches achieving 30-second freshness. Key numbers: 8 PB total, 50 TB daily ingestion, 90s average freshness, 120 QPS peak during Sunday evening orders. Engineering decision: separate warehouses for real-time pricing (small, always-hot, low latency) and historical analytics (large, elastic, cost-optimized).

### Real-World: Spotify

Spotify's streaming events table contains 1.5 trillion rows across 6 years of listening history. Multi-column clustering on (date, market, content_type) achieved 99.5% Cutting off unnecessary steps for the most common query pattern (daily streams by market). Without clustering: top 50 dashboards consumed 8,000 compute-seconds daily; after: 80 compute-seconds — a 100x cost reduction. Key numbers: 600 PB object storage, 500 TB compressed primary warehouse, 2,000 daily users, 50,000 daily queries. Engineering decision: clustering key selection alone produced $3M annual cost savings.
