# High-Level Design — NewSQL Database

## System Architecture

```mermaid
---
config:
  theme: base
  look: neo
  themeVariables:
    primaryColor: "#e8f5e9"
    primaryBorderColor: "#2e7d32"
---
flowchart TB
    subgraph Clients["Client Layer"]
        C1[Application Client]
        C2[Admin Console]
        C3[CDC Consumer]
    end

    subgraph SQLLayer["SQL Layer (Stateless)"]
        PG[SQL Gateway / Wire Protocol]
        QP[Query Parser & Optimizer]
        DE[Distributed Executor]
        SC[Schema Cache]
    end

    subgraph TxnLayer["Transaction Layer"]
        TC[Transaction Coordinator]
        TM[Timestamp Oracle / HLC]
        IR[Intent Resolver]
    end

    subgraph KVLayer["Distributed KV Storage"]
        subgraph Node1["Node 1"]
            L1[Leaseholder R1]
            F1a[Follower R3]
        end
        subgraph Node2["Node 2"]
            L2[Leaseholder R2]
            F2a[Follower R1]
        end
        subgraph Node3["Node 3"]
            L3[Leaseholder R3]
            F3a[Follower R2]
        end
    end

    subgraph StorageEngine["Storage Engine (per Node)"]
        LSM[LSM-Tree / Sorted Store]
        WAL[Write-Ahead Log]
        BC[Block Cache]
    end

    subgraph ClusterMgmt["Cluster Management"]
        MD[Metadata / Placement Driver]
        RB[Range Rebalancer]
        HL[Health Monitor]
    end

    C1 & C2 --> PG
    PG --> QP --> DE
    DE --> SC
    DE --> TC
    TC --> TM
    TC --> IR
    TC --> L1 & L2 & L3
    L1 --> F2a
    L2 --> F3a
    L3 --> F1a
    L1 & L2 & L3 --> LSM
    LSM --> WAL
    LSM --> BC
    MD --> RB --> HL
    C3 -.-> L1 & L2 & L3

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class C1,C2,C3 client
    class PG,QP gateway
    class DE,TC,TM,IR service
    class L1,L2,L3,F1a,F2a,F3a,LSM data
    class SC,BC cache
    class WAL,MD,RB,HL queue
```

---

## Component Descriptions

| Component | Role |
|-----------|------|
| **SQL Gateway** | Accepts client connections via PostgreSQL/MySQL wire protocol; authenticates, parses SQL, and routes to the query optimizer |
| **Query Parser & Optimizer** | Transforms SQL into a logical plan, applies cost-based optimization considering range distribution, and produces a distributed physical plan |
| **Distributed Executor** | Executes the physical plan by sending KV operations to the leaseholders of relevant ranges; coordinates parallel scans and distributed joins |
| **Transaction Coordinator** | Manages the lifecycle of distributed transactions: assigns timestamps, tracks write intents across ranges, coordinates commit via parallel commits or 2PC |
| **Timestamp Oracle / HLC** | Issues hybrid logical clock timestamps combining physical time (NTP) with a logical counter for causal ordering across nodes |
| **Intent Resolver** | Resolves encountered write intents from other transactions — checks if the intent's transaction committed or aborted, then cleans up accordingly |
| **Leaseholder** | The designated replica in each range's Raft group that serves reads and coordinates writes; typically co-located with the Raft leader |
| **LSM-Tree Storage** | Log-structured merge-tree that stores MVCC key-value pairs sorted by key and timestamp; supports efficient range scans and point lookups |
| **Block Cache** | In-memory cache for frequently accessed data blocks from the LSM-tree; sized to hold the hot working set |
| **Metadata / Placement Driver** | Stores cluster topology, range-to-node mapping, and zone configuration; directs range placement and rebalancing decisions |

---

## Data Flow

### Write Path (Distributed Transaction)

```mermaid
---
config:
  theme: base
  look: neo
---
sequenceDiagram
    participant Client
    participant SQL as SQL Gateway
    participant Coord as Txn Coordinator
    participant HLC as HLC Clock
    participant LH1 as Leaseholder R1
    participant LH2 as Leaseholder R2
    participant Raft1 as Raft Group R1
    participant Raft2 as Raft Group R2

    Client->>SQL: BEGIN; INSERT INTO orders...; UPDATE accounts...; COMMIT;
    SQL->>Coord: Begin transaction
    Coord->>HLC: Assign provisional timestamp
    HLC-->>Coord: ts = (wall_time, logical_counter)

    Note over Coord: INSERT maps to Range R1, UPDATE maps to Range R2

    par Write intents in parallel
        Coord->>LH1: Write intent (key, value, txn_id, ts)
        LH1->>Raft1: Propose intent via Raft
        Raft1-->>LH1: Quorum ACK
        LH1-->>Coord: Intent written
    and
        Coord->>LH2: Write intent (key, value, txn_id, ts)
        LH2->>Raft2: Propose intent via Raft
        Raft2-->>LH2: Quorum ACK
        LH2-->>Coord: Intent written
    end

    Note over Coord: Parallel Commits: write STAGING record + verify intents concurrently

    par Commit in parallel
        Coord->>LH1: Mark txn record STAGING
        LH1->>Raft1: Replicate txn record
        Raft1-->>LH1: Quorum ACK
    and
        Coord->>LH2: Verify intent on R2 succeeded
    end

    Coord-->>Client: Transaction committed
    Note over Coord: Async: resolve intents → remove txn record
```

**Write path key points:**

1. **Intent-based writes** — Each write creates an MVCC intent (provisional value) associated with the transaction ID, not a final committed value
2. **Parallel Raft consensus** — Write intents to different ranges replicate through their respective Raft groups concurrently
3. **Parallel commits** — Instead of sequential 2PC, the transaction record transitions to STAGING while verifying all intents succeeded, completing commit in one consensus round-trip
4. **Async intent resolution** — After commit, intents are asynchronously resolved (rewritten as committed MVCC values) by background processes or encountering transactions

### Read Path (Consistent Read)

```mermaid
---
config:
  theme: base
  look: neo
---
sequenceDiagram
    participant Client
    participant SQL as SQL Gateway
    participant Opt as Query Optimizer
    participant Exec as Distributed Executor
    participant LH as Leaseholder
    participant LSM as LSM-Tree
    participant Cache as Block Cache

    Client->>SQL: SELECT * FROM orders WHERE user_id = 42
    SQL->>Opt: Parse SQL → logical plan
    Opt->>Opt: Cost-based optimization (range lookup, index selection)
    Opt->>Exec: Physical plan: IndexScan(orders_user_idx, key=42)
    Exec->>LH: KV Scan(start_key, end_key, timestamp)
    LH->>LH: Verify lease is valid (not expired)
    LH->>Cache: Lookup in block cache
    alt Cache hit
        Cache-->>LH: Return cached blocks
    else Cache miss
        LH->>LSM: Read from LSM-tree (check memtable → L0 → L1 → ...)
        LSM-->>LH: Return MVCC versions
    end
    LH->>LH: Filter MVCC versions visible at read timestamp
    LH->>LH: Check for write intents → resolve if encountered
    LH-->>Exec: Return qualifying rows
    Exec-->>SQL: Merge results from multiple ranges (if needed)
    SQL-->>Client: Result set
```

**Read path key points:**

1. **Leaseholder-only reads** — Only the leaseholder serves consistent reads, avoiding the need for a Raft round-trip on the read path
2. **MVCC visibility** — The reader evaluates all versions of a key and returns the latest version whose timestamp is less than or equal to the read timestamp
3. **Intent resolution on read** — If the reader encounters an uncommitted intent, it must determine the intent's transaction status (committed, aborted, or pending) before proceeding
4. **Block cache** — The LSM-tree's block cache eliminates disk I/O for hot data; bloom filters skip SST files that definitely do not contain the key

---

## Key Architectural Decisions

### 1. Sorted Key-Value Store vs. B-Tree Storage Engine

| Aspect | LSM-Tree (Log-Structured Merge) | B-Tree (Traditional) |
|--------|-------------------------------|---------------------|
| Write performance | Excellent — sequential writes to memtable | Moderate — random I/O for page updates |
| Read performance | Good with bloom filters | Excellent — single-page reads |
| Space amplification | Higher (multiple SST levels) | Lower (in-place updates) |
| Write amplification | Higher (compaction rewrites) | Lower |
| MVCC fit | Natural — append-only versioning | Requires additional version chains |
| Compaction overhead | Background CPU and I/O | No compaction needed |

**Decision:** LSM-tree storage engine. The append-only nature aligns perfectly with MVCC (each version is a new entry), write throughput is critical for Raft replication (each replica must persist every write), and range scans over sorted keys map directly to the LSM's sorted run structure.

### 2. TrueTime (Atomic Clocks) vs. Hybrid Logical Clocks

| Aspect | TrueTime | Hybrid Logical Clock (HLC) |
|--------|----------|---------------------------|
| Accuracy | < 7ms uncertainty interval | NTP-based (~100-250ms uncertainty) |
| Infrastructure | Requires GPS + atomic clocks in every datacenter | Standard NTP; no special hardware |
| Commit latency | Must wait out uncertainty interval (~7ms) | No commit-wait, but must handle clock skew |
| External consistency | Guaranteed via commit-wait | Causal consistency; serializable via conflict detection |
| Deployment complexity | High (specialized hardware) | Low (software-only) |

**Decision:** Hybrid logical clocks for commodity deployments. HLC provides causal ordering guarantees sufficient for serializable isolation without specialized hardware. Clock skew is handled by uncertainty intervals in the transaction protocol: if two transactions' timestamps are within the uncertainty window, conflict detection determines ordering.

### 3. Replication: Raft vs. Paxos vs. Primary-Backup

| Aspect | Raft | Multi-Paxos | Primary-Backup |
|--------|------|-------------|----------------|
| Understandability | High (designed for clarity) | Low (complex protocol) | High |
| Leader election | Built-in, fast | Separate protocol needed | External failover |
| Log ordering | Strict sequential | Allows gaps | Sequential |
| Production adoption | CockroachDB, TiKV, YugabyteDB | Spanner, Chubby | Traditional RDBMS |
| Throughput | Good (pipeline-able) | Excellent (parallel slots) | Highest (no consensus overhead) |

**Decision:** Raft consensus per range. Industry standard for NewSQL, with clear leader election semantics and well-understood failure modes. Each range operates an independent Raft group, allowing the cluster to run thousands of Raft groups concurrently.

### 4. Transaction Protocol: 2PC vs. Parallel Commits

| Aspect | Traditional 2PC | Parallel Commits |
|--------|-----------------|-----------------|
| Consensus rounds | 2 sequential (prepare + commit) | 1 (prepare + commit in parallel) |
| Latency | 2x consensus latency | 1x consensus latency |
| Complexity | Simple, well-understood | More complex intent resolution |
| Recovery | Coordinator failure blocks resolution | STAGING record enables recovery by any node |

**Decision:** Parallel commits as the default protocol. By writing a STAGING transaction record concurrently with the final intent writes, the commit completes in one consensus round-trip — halving distributed transaction latency compared to traditional 2PC.

### 5. Caching Strategy

| Cache Layer | What It Caches | Eviction Policy |
|-------------|---------------|-----------------|
| Block cache | LSM-tree data blocks and index blocks | LRU with partitioned pools |
| Row cache | Deserialized rows for point lookups | LRU with TTL, invalidated on write |
| SQL plan cache | Compiled query execution plans | LRU, invalidated on schema change |
| Range descriptor cache | Range-to-node mapping for routing | Invalidated on range split/merge/move |
| Lease cache | Active lease information per range | Invalidated on lease transfer |

---

## Component Dependency Matrix

| Component | Depends On | Depended On By | Failure Impact |
|-----------|-----------|----------------|----------------|
| SQL Gateway | Range descriptor cache | Clients, CDC consumers | Client connections drop; reconnect to another node |
| Query Optimizer | Schema cache, statistics | Distributed executor | Queries use stale plans until optimizer restarts |
| Distributed Executor | Transaction coordinator, leaseholders | SQL gateway | Multi-range queries fail; single-range queries unaffected |
| Transaction Coordinator | HLC, intent resolver, leaseholders | Distributed executor | New transactions rejected; in-flight transactions may timeout |
| HLC | NTP source, peer node clocks | Transaction coordinator, Raft | Clock drift; node self-quarantines if offset exceeds threshold |
| Intent Resolver | Transaction records, range leaseholders | Readers encountering intents | Reads to intent-heavy ranges block; intent cleanup stalls |
| Leaseholder | Raft group, storage engine | All read/write paths | Range unavailable until new leader elected (~5-10s) |
| Storage Engine (LSM) | Disk I/O, block cache | Leaseholder, Raft | Reads/writes to affected ranges fail; compaction stalls cause write backpressure |
| Placement Driver | System ranges, node health | Rebalancer, schema changes | Rebalancing stops; no new range movements; schema changes stall |

### Critical Path vs Non-Critical Path

**Critical path** (directly affects query latency):
1. SQL Gateway → Query Optimizer → Distributed Executor → Transaction Coordinator → Leaseholder → Raft Consensus → Storage Engine

**Non-critical path** (eventual consistency acceptable):
1. Intent resolution (async cleanup of committed intents)
2. Range rebalancing (periodic, not urgent unless severely imbalanced)
3. MVCC garbage collection (deferred, runs in background)
4. Statistics collection (periodic refresh, stale stats cause suboptimal plans but correct results)
5. CDC event emission (async, buffered locally during outages)

---

## Technology Selection Guidelines

| Component | Decision | Rationale |
|-----------|----------|-----------|
| Storage engine | LSM-tree (RocksDB/Pebble) | Append-only writes align with MVCC versioning and Raft log replay; sorted runs enable efficient range scans |
| Consensus protocol | Raft per range | Industry standard; clear leader semantics; well-understood failure modes; per-range independence |
| Clock synchronization | HLC over NTP | No hardware dependency; causal ordering sufficient for serializable isolation; commodity deployment |
| Wire protocol | PostgreSQL/MySQL compatible | Migration path from existing RDBMS; ecosystem of tools, drivers, ORMs |
| Serialization format | Protobuf for internal RPC | Compact binary encoding; schema evolution; cross-language support for tooling |
| Compression | LZ4 for SST blocks, Snappy for Raft snapshots | LZ4: fast decompression critical for read latency; Snappy: good balance for bulk data transfer |
| Internal RPC | gRPC | HTTP/2 multiplexing; bidirectional streaming for CDC; protobuf integration |
| Monitoring | Prometheus-compatible metrics | Industry standard; time-series metrics with per-range labels; Grafana dashboards |

---

## Real-World Case Studies

### Case Study 1: Financial Services Migration from Sharded MySQL

**Context:** A payment processing platform with 200M accounts migrating from 64 manually sharded MySQL instances to a NewSQL database.

**Architecture decisions:**
- Wire protocol compatibility (MySQL) allowed incremental migration: one table at a time, with the application connecting to the NewSQL cluster via the same MySQL driver
- Primary key design changed from auto-increment (hot range) to `(tenant_id, account_id)` composite key, co-locating each tenant's accounts within 1-3 ranges for fast single-tenant transactions
- Cross-shard transactions (previously impossible in sharded MySQL — required application-level sagas) became transparent distributed transactions
- 64 shards → ~50K ranges: eliminated manual shard mapping, application-level routing, and shard-aware backup scripts

**Results:**
- Cross-shard transaction latency: 850ms (application saga) → 15ms (native distributed transaction)
- Operational burden: 64 backup schedules → 1 automated incremental backup
- Schema changes: 64 sequential ALTERs over 6 hours → 1 online schema change in 20 minutes

### Case Study 2: Multi-Region SaaS Platform

**Context:** A SaaS platform serving customers in US, EU, and APAC requiring GDPR-compliant data residency and sub-10ms read latency globally.

**Architecture decisions:**
- Zone configurations pinned EU customer data to EU-West region (GDPR compliance) and US customer data to US-East
- Leaseholder preferences ensured each region's data had its leaseholder local to that region
- Global configuration tables used 5-replica cross-region Raft groups with follower reads for low-latency access from all regions
- Per-region Raft quorum (3 replicas in the primary region, 1 each in secondary regions) achieved local write latency for region-pinned data

**Results:**
- Read latency: <3ms for local data, <5ms for global config (follower reads)
- Write latency: <8ms for region-pinned data, ~80ms for global tables (cross-region quorum)
- GDPR compliance: EU data never leaves EU region for read or write operations; replication only within EU
- Regional failover: automatic within-region failover in <10s; cross-region failover for global tables in <30s

### Case Study 3: IoT Device Registry Migration

**Context:** An IoT platform managing 100M device records migrated from a single PostgreSQL instance that reached vertical scaling limits (16 TB, 50K QPS).

**Architecture decisions:**
- Primary key: `(device_type_hash, device_id)` — hash prefix prevents sequential insert hot spots from device registration bursts
- Zone configuration pinned device data to the region closest to the device fleet's geographic concentration
- CDC pipeline exported device state changes to a time-series database for telemetry dashboards
- Follower reads served device status queries from all regions with 5-second staleness (acceptable for dashboard views)

**Results:**
- Scaled from 50K to 800K QPS without schema redesign
- Device registration (write-heavy bursts during fleet rollouts) handled via hash-sharded distribution across 200+ ranges
- Cross-region device state queries: <5ms via follower reads (previously required separate read replicas with unbounded staleness)

---

---

### Online Schema Change Flow

```mermaid
---
config:
  theme: base
  look: neo
  themeVariables:
    primaryColor: "#e8f5e9"
    primaryBorderColor: "#2e7d32"
---
sequenceDiagram
    participant DBA as DBA Client
    participant Coord as Schema Coordinator
    participant N1 as Node 1
    participant N2 as Node 2
    participant N3 as Node 3
    participant BF as Backfill Job

    DBA->>Coord: ALTER TABLE orders ADD COLUMN status VARCHAR DEFAULT 'pending'

    Note over Coord: Stage 1: DELETE-ONLY
    Coord->>N1: Publish schema v2 (DELETE_ONLY)
    Coord->>N2: Publish schema v2 (DELETE_ONLY)
    Coord->>N3: Publish schema v2 (DELETE_ONLY)
    N1-->>Coord: Adopted v2
    N2-->>Coord: Adopted v2
    N3-->>Coord: Adopted v2

    Note over Coord: Stage 2: WRITE-ONLY (new writes populate column)
    Coord->>N1: Advance to WRITE_ONLY
    Coord->>N2: Advance to WRITE_ONLY
    Coord->>N3: Advance to WRITE_ONLY
    N1-->>Coord: Adopted
    N2-->>Coord: Adopted
    N3-->>Coord: Adopted

    Note over Coord: Stage 3: BACKFILL existing rows
    Coord->>BF: Start backfill job
    BF->>N1: Backfill range R1 (batch of 1000 rows)
    BF->>N2: Backfill range R2 (batch of 1000 rows)
    BF->>N3: Backfill range R3 (batch of 1000 rows)
    N1-->>BF: R1 backfilled
    N2-->>BF: R2 backfilled
    N3-->>BF: R3 backfilled

    Note over Coord: Stage 4: PUBLIC (column visible to reads)
    Coord->>N1: Advance to PUBLIC
    Coord->>N2: Advance to PUBLIC
    Coord->>N3: Advance to PUBLIC

    Coord-->>DBA: Schema change complete (zero downtime)
```

---

## Architecture Pattern Checklist

- [x] **Sync vs Async communication** — Synchronous for transactional reads/writes; async for CDC, intent resolution, and analytics replication
- [x] **Event-driven vs Request-response** — Request-response for SQL queries; event-driven CDC for downstream consumers
- [x] **Push vs Pull model** — Push-based Raft replication (leader pushes log entries); pull-based compaction triggers
- [x] **Stateless vs Stateful services** — SQL gateway is stateless (any node can serve any query); KV storage nodes are stateful (own their ranges)
- [x] **Read-heavy vs Write-heavy** — Read-heavy (8:1); leaseholder reads avoid Raft round-trips; block cache optimizes hot data
- [x] **Real-time vs Batch processing** — Real-time for OLTP; batch for MVCC garbage collection and range rebalancing
- [x] **Edge vs Origin processing** — Origin processing; query pushdown moves computation to the storage nodes holding the data

---

## Failure Domain Analysis

| Failure Domain | Components Affected | Blast Radius | Recovery Strategy |
|---------------|-------------------|-------------|-------------------|
| **Single process** | One range's leaseholder | 0.01% of data (one range) | Raft leader election (~5-10s) |
| **Single node** | All ranges with replicas on this node | ~6-7% of ranges (1/15 nodes) | Parallel leader elections for all affected ranges |
| **Availability zone** | All nodes in one AZ (~33% of cluster) | ~33% of leaseholders | Automatic failover; surviving AZs have quorum |
| **Region** | All nodes in one region | Region's data if quorum lost | Cross-region replicas serve as new primaries |
| **Network partition** | Connectivity between AZs or regions | Minority partition loses quorum | Majority partition continues; minority becomes read-only |
| **Clock source** | NTP servers serving the cluster | All nodes' uncertainty windows grow | Multiple NTP sources; auto-quarantine on drift |
| **Storage subsystem** | NVMe drives on affected nodes | Ranges on failed drives | Raft replicas on healthy nodes; re-replicate from surviving copies |

### Data Flow: Read vs. Write Asymmetry

| Characteristic | Read Path | Write Path |
|---------------|-----------|------------|
| **Raft involvement** | None (leaseholder serves directly) | Required (quorum must acknowledge) |
| **Minimum latency** | ~1ms (local leaseholder + cache hit) | ~3-5ms (local Raft quorum) |
| **Cross-region minimum** | ~1ms (leaseholder pinned locally) | ~40-150ms (cross-region quorum) |
| **Slowest part of the process** | Block cache miss rate; LSM read amplification | Raft proposal throughput (~2,500/range) |
| **Scalability** | Follower reads add linear read capacity | Range splitting adds linear write capacity |
| **Consistency guarantee** | Always latest committed (leaseholder) or bounded-stale (follower) | Serializable via MVCC + Raft |
