# Deep Dive & Bottlenecks — NewSQL Database

## Critical Component 1: Clock Skew and Read Uncertainty

### Why Is This Critical?

Serializable isolation in a distributed database requires a total ordering of all transactions. Without perfectly synchronized clocks, two nodes may assign timestamps that disagree about the order of concurrent events. If Node A commits a write at physical time T=100 and Node B starts a read at physical time T=101, but Node B's clock is actually 5ms behind Node A's clock, Node B might miss the write — violating serializability. The clock synchronization strategy fundamentally determines the system's consistency guarantees and transaction latency.

### How It Works Internally

**Hybrid Logical Clocks (HLC)** combine physical time with a logical counter:

```
HLC = (wall_time_ns, logical_counter)

Ordering rules:
  1. Compare wall_time first
  2. If wall_time equal, compare logical_counter
  3. On each local event, increment logical_counter
  4. On receiving a remote message, advance wall_time to
     max(local_wall_time, remote_wall_time) and adjust logical_counter
```

**Read uncertainty interval:** Each transaction maintains a `max_timestamp` that represents the upper bound of clock uncertainty (typically `read_timestamp + max_clock_offset`, where `max_clock_offset` is ~250ms for NTP).

```
Read Uncertainty Window:
  read_ts ──────────[uncertainty interval]──────────── max_ts
            ▲                                            ▲
        Transaction                                  Upper bound
        start time                                   of real time
```

When a reader encounters a value with a timestamp between `read_ts` and `max_ts`, it cannot determine whether this value was committed before or after the read started. The reader must **restart the transaction at a higher timestamp** to resolve the ambiguity.

### Performance Impact

| Clock Skew | Uncertainty Window | Restart Probability | Latency Impact |
|-----------|-------------------|--------------------|--------------------|
| < 1ms (PTP) | 1ms | < 0.01% | Negligible |
| < 10ms (NTP well-tuned) | 10ms | ~0.1% | Minimal |
| < 250ms (NTP default) | 250ms | ~2-5% | Noticeable on write-heavy workloads |
| > 500ms (NTP degraded) | 500ms | ~10%+ | Significant latency spikes |

### Failure Modes

1. **NTP server failure** — If the NTP source becomes unavailable, node clocks drift at their hardware rate (~30ppm = 2.6s/day). The HLC continues advancing but the uncertainty window grows unboundedly.
   - **Mitigation:** Nodes self-quarantine when detected clock offset exceeds a threshold. Multiple NTP sources with cross-validation.

2. **Clock jump** — A sudden NTP correction jumps physical time forward or backward. A forward jump is safe (HLC advances). A backward jump is dangerous — it could violate the monotonicity Rule that never changes.
   - **Mitigation:** HLC always takes the maximum of physical clock and current HLC wall_time, so backward jumps are absorbed. However, a backward jump causes the logical counter to increment rapidly until physical time catches up, which is harmless but wastes timestamp space.

3. **Read restart storm** — Under high contention, many readers encounter uncertain values and restart, creating a cascade of retried transactions.
   - **Mitigation:** Observed timestamp tracking — once a leaseholder serves a read at timestamp T, it records T as an observed timestamp. Future reads from the same node can narrow the uncertainty window since the leaseholder guarantees no committed writes exist between its observed timestamp and the read timestamp.

---

## Critical Component 2: Range Splits and Merges

### Why Is This Critical?

Ranges are the fundamental unit of data distribution. A range that grows too large (>512 MB default) slows compaction, increases replication costs, and creates hot spots. A range that becomes too small wastes Raft group resources (each range maintains its own Raft state machine, WAL, and leader election overhead). The system must continuously split large ranges and merge underutilized ones — all while serving ongoing reads and writes without interruption.

### How It Works Internally

**Range Split Process:**

```
FUNCTION split_range(range, split_key):
    // Step 1: Choose split point (midpoint of range by size or key count)
    IF split_key is NULL:
        split_key = find_midpoint(range)

    // Step 2: Propose split via Raft (must be committed by quorum)
    split_command = RaftCommand(
        type = SPLIT,
        original_range_id = range.id,
        new_range_id = allocate_range_id(),
        split_key = split_key
    )

    raft_propose(range, split_command)

    // Step 3: On commit, atomically create two range descriptors
    //   Left range:  [original.start_key, split_key)
    //   Right range: [split_key, original.end_key)
    //
    //   Both ranges initially share the same replicas
    //   Raft state is forked: right range starts with a snapshot

    // Step 4: Both ranges begin independent Raft operation
    //   Reads/writes to keys < split_key → left range
    //   Reads/writes to keys >= split_key → right range

    // Step 5: Rebalancer may later move one range to a different node
```

**Range Merge Process (reverse of split):**

```
FUNCTION merge_ranges(left_range, right_range):
    // Preconditions:
    //   - Ranges are adjacent (left.end_key == right.start_key)
    //   - Both ranges are below minimum size threshold
    //   - Both ranges have the same replica placement

    // Step 1: Freeze the right range (stop accepting writes)
    freeze(right_range)

    // Step 2: Transfer right range's data to left range via Raft
    merge_command = RaftCommand(
        type = MERGE,
        left_range_id = left_range.id,
        right_range_id = right_range.id
    )

    raft_propose(left_range, merge_command)

    // Step 3: On commit, left range expands to cover both key spans
    //   left_range.end_key = right_range.end_key
    //   right_range is deleted

    // Step 4: Right range's Raft group is disbanded
```

### Split/Merge Decision Criteria

| Trigger | Action | Threshold |
|---------|--------|-----------|
| Range size exceeds max | Split | > 512 MB (configurable) |
| Range QPS exceeds limit | Split | > 2,500 QPS per range |
| Range CPU time exceeds limit | Split | > 500ms/s CPU per range |
| Two adjacent ranges below min | Merge | Both < 10 MB and < 50 QPS |
| Range split count exceeds limit | Backpressure | System-wide range budget |

### Split Decision Algorithm

```
FUNCTION choose_split_point(range):
    // Three strategies, applied in priority order

    // Strategy 1: Load-based split (preferred for hot ranges)
    IF range.qps > MAX_RANGE_QPS:
        // Sample last 10 minutes of request keys
        samples = collect_key_samples(range, window=10_min)
        // Find the key that bisects the QPS load
        split_key = find_load_median(samples)
        // Verify both halves will have >20% of the load
        //   (prevents pathological splits where 99% goes to one side)
        IF min_half_ratio(samples, split_key) > 0.2:
            RETURN split_key

    // Strategy 2: Size-based split (for large ranges)
    IF range.size > MAX_RANGE_SIZE:
        // Find the key that bisects the data size
        split_key = find_size_midpoint(range)
        RETURN split_key

    // Strategy 3: Account-based split (for multi-tenant)
    IF range.has_tenant_key_prefix:
        // Split at tenant boundary to avoid cross-tenant ranges
        split_key = find_tenant_boundary(range)
        IF split_key IS NOT NULL:
            RETURN split_key

    RETURN NULL  // no split needed
```

### Failure Modes

1. **Split during active transaction** — A transaction writes intents to a range, then the range splits. The intents now span two ranges.
   - **Mitigation:** The split operation is atomic via Raft. Intents are logically associated with their keys, not their range. After split, each range owns the intents for its key span. The transaction coordinator resolves intents on both ranges during commit.

2. **Cascading splits** — A hot range splits, but the hot key is near the split point. Both child ranges receive equal load and immediately need to split again.
   - **Mitigation:** Load-based splitting chooses split points that bisect the load distribution, not just the key space. Hot key detection uses QPS sampling to find the optimal split point.

3. **Merge blocked by schema change** — Two adjacent ranges qualify for merging, but an ongoing schema change requires consistent range boundaries across versions.
   - **Mitigation:** Merge operations are paused during active schema changes. The system waits for the schema change to complete before resuming merge evaluation.

---

## Critical Component 3: Distributed Deadlock Detection

### Why Is This Critical?

In a single-node database, deadlock detection uses a local wait-for graph. In a distributed NewSQL database, transaction A on Node 1 may wait for transaction B on Node 2, which waits for transaction C on Node 3, which waits for transaction A — a distributed deadlock cycle that no single node can detect.

### How It Works Internally

**Push-based deadlock detection:**

Rather than building a global wait-for graph (expensive in a distributed system), NewSQL databases use a push-based approach:

```
FUNCTION handle_write_conflict(reader_txn, blocking_txn):
    // Reader encounters a write intent from blocking_txn

    // Step 1: Check if blocking_txn is still active
    txn_record = read_txn_record(blocking_txn.id)

    IF txn_record.status == COMMITTED:
        resolve_intent_as_committed()
        RETURN PROCEED

    IF txn_record.status == ABORTED:
        resolve_intent_as_aborted()
        RETURN PROCEED

    // Step 2: Determine who should wait (priority-based)
    IF reader_txn.priority > blocking_txn.priority:
        // Reader has higher priority: PUSH the blocker
        push_txn_timestamp(blocking_txn)  // force blocker to restart
        RETURN PROCEED
    ELSE:
        // Reader has lower priority: WAIT
        wait_for_txn(blocking_txn, timeout=5s)

        IF timeout_exceeded:
            // Potential deadlock — abort reader and retry
            abort_and_retry(reader_txn)

// Priority assignment:
//   - Each transaction starts with a random priority
//   - On restart, priority increases (prevents starvation)
//   - System transactions get highest priority
```

**Deadlock prevention via wound-wait:**

| Scenario | Higher Priority Txn (older) | Lower Priority Txn (younger) |
|----------|---------------------------|------------------------------|
| Higher wants lock held by Lower | Wound: abort the younger txn | — |
| Lower wants lock held by Higher | — | Wait: block until higher completes |

### Failure Modes

1. **Phantom deadlock** — A transaction is detected as part of a deadlock cycle, but the blocking transaction already committed (stale information). The system aborts a transaction unnecessarily.
   - **Mitigation:** Always verify the blocking transaction's current status before aborting. Use the transaction heartbeat mechanism — if a transaction's heartbeat is recent, it is still active.

2. **Priority inversion** — A low-priority long-running analytics transaction holds locks that block high-priority OLTP transactions.
   - **Mitigation:** OLTP and analytics workloads use separate transaction pools. Analytics queries use historical (follower) reads that never block writes.

---

## Concurrency & Race Conditions

### Race Condition 1: Write-Write Conflict Across Ranges

**Scenario:** Two transactions both read the same row, then attempt to update it. Without detection, the later write overwrites the earlier one (lost update).

**Resolution:** Serializable snapshot isolation (SSI) detects this at commit time. Each transaction reads at its start timestamp and writes at its commit timestamp. If Transaction B attempts to commit a write to a key that was written by Transaction A after B's read timestamp, B's commit is rejected with a "serialization failure" error. The client retries the transaction, which sees A's committed write.

### Race Condition 2: Intent Resolution During Commit

**Scenario:** Transaction A writes an intent to key K. A reader encounters the intent and checks A's transaction record. Between the read of the transaction record and the intent resolution, A commits.

**Resolution:** The intent resolution process is idempotent. If the reader resolves the intent as "pending" but A has since committed, the reader's resolution attempt simply converts the intent to a committed value (the correct outcome). If A had aborted, the resolution removes the intent. Both paths converge to the correct state.

### Race Condition 3: Lease Transfer During Read

**Scenario:** A client sends a read to the leaseholder. While the read is in progress, the lease transfers to a different replica. The old leaseholder may serve a stale read.

**Resolution:** Leases are tied to a specific epoch. Before serving a read, the leaseholder verifies its lease is still valid by checking the lease expiration timestamp. If the lease has expired, the read is rejected and the client retries against the new leaseholder. Lease transfers include a lease start timestamp that prevents the new leaseholder from serving reads at timestamps earlier than the old lease's last served read timestamp.

### Race Condition 4: Concurrent Range Split and Transaction

**Scenario:** Transaction T writes intents to keys K1 and K2 in range R1. Meanwhile, R1 splits at a key between K1 and K2, creating R1-left (containing K1) and R1-right (containing K2).

**Resolution:** The split is proposed via Raft, so it is serialized with respect to all other operations on the range. After the split, K1's intent belongs to R1-left and K2's intent belongs to R1-right. The transaction coordinator's intent list still references both keys by their encoded form — the range split is transparent. When the coordinator commits, it resolves intents by looking up the current range for each key (which may now be a different range than when the intent was written). The range descriptor cache is updated on split, so the coordinator discovers the new range mapping on the next lookup.

### Race Condition 5: MVCC GC Deletes Version Needed by Active Transaction

**Scenario:** Transaction T starts at timestamp T=100. GC runs and deletes all versions older than T=90. T then reads a key whose latest version before T=100 was written at T=85. The version has been garbage collected.

**Resolution:** Protected timestamps. Long-running transactions, backups, and CDC cursors register a protected timestamp with the GC system. The GC process checks protected timestamps before deleting versions and never removes a version at or above any active protected timestamp. If a transaction fails to maintain its heartbeat (indicating abandonment), the protected timestamp is released. This creates a trade-off: many long-running transactions increase GC lag and storage bloat. Production systems set a maximum transaction duration (e.g., 1 hour) and abort transactions that exceed it.

### Locking Strategy

| Operation | Lock Type | Granularity |
|-----------|-----------|-------------|
| Point read | No lock (MVCC snapshot) | Key-level timestamp check |
| Range scan | No lock (MVCC snapshot) | Scanned key range timestamp check |
| Single-key write | Exclusive intent | Key-level (write intent) |
| Multi-key transaction | Exclusive intents | Per-key intents across ranges |
| Schema change | Distributed lease | Table-level (schema change lease) |
| Range split/merge | Raft proposal | Range-level (via Raft consensus) |
| Leaseholder read | Lease epoch check | Range-level (lease validity) |

---

## Slowest part of the process Analysis

### Slowest part of the process 1: Hot Range (Single Range Receives Disproportionate Traffic)

**Problem:** A single range containing a popular key (e.g., a global counter, a frequently updated row) receives write QPS that exceeds the Raft consensus throughput for that range (~2,500 writes/sec per range).

**Impact:** Writes queue behind Raft consensus; latency spikes from milliseconds to seconds.

**Mitigation:**
- Load-based range splitting: automatically split the hot range to distribute writes across multiple Raft groups
- Hash-sharded indexes for sequential keys: add a hash prefix to distribute sequential inserts (auto-increment IDs, timestamps) across ranges
- Application-level bucketing: partition counters into N buckets, each in a different range, and sum on read

### Slowest part of the process 2: Cross-Range Transaction Latency

**Problem:** A transaction touching 10 ranges requires intents on all 10, followed by a commit. Even with parallel commits, the latency is bounded by the slowest Raft group.

**Impact:** Tail latency (p99) is dominated by the slowest range replica.

**Mitigation:**
- Locality-aware schema design: design primary keys to co-locate related data within a single range
- Transaction pipelining: pipeline Raft proposals so that the next intent write begins before the previous one is acknowledged
- Read-only optimization: single-range read-only transactions bypass the transaction coordinator entirely

### Slowest part of the process 3: LSM-Tree Compaction Stalls

**Problem:** Background compaction (merging SST files across levels) consumes CPU and disk I/O. During heavy compaction, foreground read/write latency increases due to resource contention.

**Impact:** Latency spikes during compaction; write stalls if Level 0 file count exceeds threshold.

**Mitigation:**
- Rate-limited compaction: bound compaction I/O to a fraction of available disk bandwidth
- Tiered compaction for write-heavy workloads (reduces write amplification)
- Leveled compaction for read-heavy workloads (reduces space amplification and read amplification)
- Separate disk I/O queues for foreground operations and background compaction

### Slowest part of the process 4: Global Secondary Index Maintenance

**Problem:** A global secondary index (distributed across its own ranges, separate from the base table) requires that every INSERT/UPDATE/DELETE to the base table also writes to the index ranges. A single base table write may require intent writes to 2+ additional ranges (one per global index), turning a single-range operation into a distributed transaction.

**Impact:** Write latency increases linearly with the number of global secondary indexes; each additional index adds one Raft consensus round to the write path.

**Mitigation:**
- Use local indexes when the query pattern always includes the primary key prefix (e.g., tenant_id)
- Limit global secondary indexes to columns that truly require cross-partition lookups
- Use covering indexes to avoid a second lookup from the index back to the base table
- Consider partial indexes that only index rows matching a filter predicate (reduces index size and write overhead)
- For high-write tables: evaluate if the query can tolerate eventually consistent index views (async index maintenance)

### Slowest part of the process 5: Large Range Scan with High MVCC Version Count

**Problem:** A range scan that must examine millions of rows also checks all MVCC versions per key. With a 25-hour GC window and 100 writes/sec to a key, each key has ~9,000 versions. The scan must iterate through and skip all but the latest version visible at the read timestamp.

**Impact:** Scan throughput drops from 500K rows/sec (single version per key) to 50K rows/sec (100 versions per key).

**Mitigation:**
- Reduce GC window to the minimum needed for operational requirements (point-in-time recovery, CDC lag)
- Use compaction filters that aggressively remove versions below the lowest active read timestamp
- For analytics queries: use follower reads at bounded staleness, which limits the version window
- Index-only scans avoid touching the base table MVCC versions entirely
- Consider HTAP columnar replicas for heavy scan workloads

---

## Deep Dive 4: Multi-Region Transaction Latency

### Why Is This Critical?

In a multi-region deployment, a distributed transaction must achieve Raft quorum across regions. The speed of light imposes a floor on cross-region latency that no software optimization can reduce. Understanding this floor is essential for capacity planning and schema design.

### Cross-Region Latency Budget

| Region Pair | One-Way Latency | Raft RTT (quorum) | Impact on Writes |
|-------------|----------------|-------------------|-----------------|
| US-East ↔ US-West | 30-40ms | 60-80ms | Minimum write latency for cross-continent quorum |
| US-East ↔ EU-West | 70-90ms | 140-180ms | Transatlantic quorum |
| US-West ↔ AP-Southeast | 120-150ms | 240-300ms | Trans-Pacific quorum |
| Same region, cross-AZ | 1-3ms | 2-6ms | Negligible overhead |

### Latency Optimization Techniques

| Technique | Latency Reduction | Trade-off |
|-----------|------------------|-----------|
| **Local quorum (3-of-5 in primary region)** | Write latency = local RTT (~3ms) | Losing primary region loses quorum |
| **Leaseholder pinning** | Read latency = local (~1ms) | Non-local reads pay cross-region RTT |
| **Transaction pipelining** | Overlap intent writes with consensus | Complexity; intents may need rollback |
| **Follower reads** | Read latency = local (~1ms) | Bounded staleness (seconds) |
| **Regional tables** | Write latency = local quorum | Cross-region queries require federation |

### Failure Mode: Quorum Asymmetry

With 5 replicas (2 US-East, 2 US-West, 1 EU-West), losing US-East means the surviving replicas (2 US-West + 1 EU-West = 3/5 quorum) can still serve writes — but write latency jumps from ~3ms (local US-East quorum) to ~160ms (US-West → EU-West for quorum). This "latency cliff" during failover is often discovered only during disaster recovery testing.

---

## Deep Dive 5: Intent Resolution Pipeline

### Why Is This Critical?

After a transaction commits via parallel commits, its write intents remain as provisional values in the LSM-tree. Every reader that encounters an unresolved intent must check the transaction's status — a cross-range RPC that adds latency. The intent resolution pipeline determines how quickly these provisional values are converted to final committed values.

### Resolution Flow

```
FUNCTION resolve_intents_for_committed_txn(txn):
    // Called after parallel commit returns COMMITTED to client

    intents = txn.intent_keys
    batch_size = 100  // resolve in batches for efficiency

    FOR EACH batch IN chunk(intents, batch_size):
        // Group intents by range to minimize cross-range RPCs
        range_batches = group_by_range(batch)

        PARALLEL FOR EACH (range, keys) IN range_batches:
            // Resolve all intents in this range atomically
            resolve_request = ResolveIntentBatch(
                txn_id = txn.id,
                status = COMMITTED,
                commit_ts = txn.write_ts,
                keys = keys
            )

            // Propose resolution via Raft
            //   This rewrites each intent as a committed MVCC value
            raft_propose(range, resolve_request)

    // After all intents resolved, delete the transaction record
    delete_txn_record(txn.id)

// Intent encountered by a reader:
FUNCTION handle_intent_on_read(intent, read_ts):
    txn_record = read_txn_record(intent.txn_id)

    SWITCH txn_record.status:
        CASE COMMITTED:
            // Intent should be visible; resolve it as committed
            resolve_intent(intent, COMMITTED, txn_record.write_ts)
            RETURN intent.value  // visible to reader

        CASE ABORTED:
            // Intent should be ignored; resolve it as aborted
            resolve_intent(intent, ABORTED)
            RETURN skip  // not visible to reader

        CASE STAGING:
            // Check if all intents are present (implicit commit check)
            IF verify_all_intents_present(txn_record):
                // Transaction committed — resolve as committed
                resolve_intent(intent, COMMITTED, txn_record.write_ts)
                RETURN intent.value
            ELSE:
                // Transaction may have aborted — wait for coordinator
                wait_for_txn_completion(intent.txn_id, timeout=5s)

        CASE PENDING:
            // Transaction still in progress
            IF reader_priority > txn_priority:
                push_txn_timestamp(intent.txn_id)  // force restart
            ELSE:
                wait_for_txn_completion(intent.txn_id, timeout=5s)
```

### Performance Impact of Intent Backlog

| Intent Count per Range | Read Latency Impact | Resolution Rate Needed |
|------------------------|--------------------|-----------------------|
| < 100 | < 0.1ms additional | Background resolution sufficient |
| 100-1,000 | 0.1-1ms (occasional intent encounters) | Aggressive background resolution |
| 1,000-10,000 | 1-10ms (frequent encounters) | Priority resolution threads |
| > 10,000 | 10ms+ (every read hits intents) | Critical: throttle new writes until cleared |

---

## Deep Dive 6: LSM Compaction Strategies

### Why Is This Critical?

The LSM-tree storage engine underlies every read and write operation. Compaction — the process of merging sorted runs across levels — determines three critical metrics: write amplification (how much extra I/O writes cause), read amplification (how many files a read must check), and space amplification (how much extra storage is consumed by redundant data).

### Compaction Strategy Comparison

| Strategy | Write Amp | Read Amp | Space Amp | Best For |
|----------|----------|----------|-----------|----------|
| **Leveled** | 10-30x | 1x per level | ~1.1x | Read-heavy workloads (user queries, lookups) |
| **Tiered (Size)** | 2-4x | 5-10x per level | ~2-3x | Write-heavy workloads (logging, IoT) |
| **FIFO (First-In-First-Out, like a line at a store)** | 1x | N/A | 1x | Time-series with TTL (auto-expire old data) |
| **Hybrid (Leveled + Tiered)** | 5-15x | 2-3x per level | ~1.5x | Mixed workloads |

### Compaction Tuning Parameters

| Parameter | Default | Effect of Increase | Effect of Decrease |
|-----------|---------|-------------------|-------------------|
| `max_bytes_for_level_base` | 256 MB | Larger L1 → fewer levels → lower read amp | Smaller L1 → more levels → higher read amp |
| `level_compaction_dynamic_level_bytes` | true | Each level sized proportionally → better space utilization | Static sizing → possible imbalance |
| `max_compaction_bytes` | 2 GB | Larger compaction jobs → better throughput, longer pauses | Smaller jobs → more frequent, shorter pauses |
| `compaction_rate_limit` | unlimited | N/A | Limits compaction I/O to protect foreground latency |

---

## Algorithm Complexity Analysis

| Algorithm | Time Complexity (Speed of the algorithm) | Space Complexity (Memory usage of the algorithm) | Notes |
|-----------|----------------|-----------------|-------|
| Point read (LSM) | O(L × log(N)) | O(1) | L = levels, N = entries per level; bloom filters reduce to O(L) |
| Range scan | O(K + L × log(N)) | O(K) | K = result size; merge of L iterators |
| Write (single key) | O(1) amortized | O(1) | Append to memtable; compaction cost amortized |
| Raft consensus | O(R) | O(log_size) | R = replica count; parallel AppendEntries |
| Range split | O(1) metadata + O(N) data | O(N) | Metadata change is O(1); data remains in place |
| Intent resolution | O(I) | O(1) | I = number of intents to resolve |
| MVCC GC | O(V) | O(1) | V = number of expired versions; runs during compaction |
| Distributed join | O(N × M / P) | O(N + M) | N, M = table sizes; P = parallelism (range count) |
| HLC update | O(1) | O(1) | Compare-and-advance, always Constant Time (Same time regardless of data size) |
| Schema backfill | O(R × B) | O(B) | R = total rows; B = batch size; rate-limited |

---

## Edge Cases

### Edge Case (Unusual or extreme situation) 1: Transaction Spanning Maximum Clock Uncertainty

A transaction starts at timestamp T on a node with a 250ms uncertainty window. It reads key K and finds a value at timestamp T+200ms. The value falls within the uncertainty interval. The transaction restarts at T+201ms. But the new timestamp is now higher, and additional values at T+201ms through T+450ms fall within the new uncertainty window. In pathological cases, a transaction can restart multiple times.

**Mitigation:** On each restart, the transaction records the observed timestamp for the range's leaseholder. Future reads from the same leaseholder use the observed timestamp to narrow the uncertainty window. After 2-3 restarts, the window is fully narrowed and the transaction completes.

### Edge Case (Unusual or extreme situation) 2: Bulk Load Creates Range Imbalance

A bulk data import inserts 1B rows with sequential keys. All inserts land in a single range (the right-most range, which expands as keys grow). Even with load-based splitting, the split rate cannot keep up with the insert rate, creating a persistent hot spot.

**Mitigation:** Pre-split: before the bulk load, create empty ranges at evenly spaced key boundaries. If loading keys 1 to 1B, pre-split at 100M, 200M, ..., 900M, creating 10 parallel insert targets. Use `IMPORT` or `COPY` commands that natively scatter data across pre-split ranges.

### Edge Case (Unusual or extreme situation) 3: Long-Running Analytics Query Blocks GC

A reporting query reads at timestamp T=1000 and runs for 30 minutes. During this time, MVCC GC cannot delete any versions at or above T=1000, because the query might still need them. The GC backlog grows, increasing storage consumption and read amplification.

**Mitigation:** Limit maximum transaction/query duration (default 1 hour). For analytics, use follower reads at a bounded staleness (e.g., 5 seconds) — these do not hold protected timestamps because the staleness window is short and well-bounded. Alternatively, route analytics queries to HTAP columnar replicas that have their own GC lifecycle.

### Edge Case (Unusual or extreme situation) 4: Leaseholder Starvation Under High Write Load

A leaseholder receiving 3,000 writes/sec (above the 2,500 Raft throughput ceiling) queues proposals faster than Raft can commit them. The Raft proposal queue grows unboundedly, consuming memory and causing read latency to spike as lease verification contends with proposal processing.

**Mitigation:** Admission control at the range level: when proposal queue depth exceeds a threshold (e.g., 200 entries), the leaseholder returns a backpressure signal to the SQL layer. The SQL layer retries after a short delay or routes to an alternate range (if the schema allows). Additionally, automatic load-based splitting detects the overload and splits the range within seconds.

### Edge Case (Unusual or extreme situation) 5: Node Rejoining with Stale Raft Log

A node fails and rejoins after 2 hours. Its Raft log for many ranges is far behind. Catching up via log replay for 100+ ranges simultaneously overwhelms the node's I/O bandwidth, causing it to appear healthy (heartbeats work) but unable to serve reads (data is stale).

**Mitigation:** Raft snapshot transfer: instead of replaying hours of log entries, the leader sends a snapshot of the current range state to the rejoining follower. The follower applies the snapshot and then replays only log entries after the snapshot point. Snapshot transfers are rate-limited and prioritized: system ranges first, then user ranges ordered by access frequency. The node is not promoted to a voter until it has caught up.

### Edge Case (Unusual or extreme situation) 6: Distributed Transaction Timeout During Network Partition

A transaction writes intents to ranges R1 (in AZ-1) and R2 (in AZ-2). A network partition separates AZ-1 and AZ-2. The transaction coordinator in AZ-1 cannot reach R2 to verify its intent. The transaction enters an ambiguous state: intents are written but the coordinator cannot commit or abort cleanly.

**Mitigation:** Transaction heartbeat mechanism: the coordinator periodically heartbeats its transaction record. If the coordinator crashes or is partitioned, the heartbeat expires after 10 seconds. Any node that encounters a heartbeat-expired transaction can push its timestamp (forcing a restart) or abort it. When the partition heals, the coordinator discovers its transaction was aborted and returns an error to the client, which retries. The key Rule that never changes is that an abandoned transaction is always cleaned up — it never permanently blocks other transactions.
