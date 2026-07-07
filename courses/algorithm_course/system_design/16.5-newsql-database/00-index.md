# 16.5 Design a NewSQL Database

## Overview

A NewSQL database is a distributed relational database system that combines the horizontal scalability of NoSQL with the full ACID transactional guarantees and SQL compatibility of traditional relational databases. Unlike single-node RDBMS systems that scale only vertically, a NewSQL database partitions data into ranges (contiguous key spans), replicates each range across multiple nodes using consensus protocols like Raft, and coordinates distributed transactions using techniques like two-phase commit with parallel optimizations. The SQL query layer sits atop a distributed key-value storage engine, translating relational operations into distributed key-value reads and writes while maintaining serializable isolation through multi-version concurrency control (MVCC) and hybrid logical clocks. This architecture enables systems to serve globally distributed OLTP workloads — financial transactions, inventory management, user accounts — with strong consistency, automatic failover, and online schema changes, all while presenting a familiar SQL interface to applications.

## Key Characteristics

| Characteristic | Description |
|----------------|-------------|
| **Distributed ACID** | Full ACID transactions spanning multiple nodes and ranges, using consensus-based replication and distributed commit protocols |
| **SQL-compatible** | Standard SQL interface with wire-protocol compatibility to existing databases (PostgreSQL/MySQL), enabling migration without application rewrites |
| **Range-based sharding** | Data automatically partitioned into contiguous key ranges that split and merge dynamically based on size and load |
| **Consensus replication** | Each range independently replicated via Raft consensus groups, providing fault tolerance without a single point of failure |
| **Serializable isolation** | Default serializable or serializable snapshot isolation using MVCC with timestamp ordering, preventing all anomalies |
| **Geo-distribution** | Multi-region deployment with configurable data placement, locality-aware reads, and survivability guarantees |
| **Online operations** | Schema changes, index creation, range rebalancing, and version upgrades without downtime |
| **Horizontal scalability** | Linear throughput scaling by adding nodes; automatic range splitting and rebalancing distribute load evenly |

## Complexity Rating: **Very High**

Designing a NewSQL database requires solving several interlocking distributed systems challenges simultaneously: maintaining serializable transactions across ranges that may reside on different continents, coordinating clocks without specialized hardware (TrueTime vs. hybrid logical clocks), optimizing a SQL query planner that must account for data distribution and network topology, and performing range splits and merges without blocking ongoing transactions. The interaction between the consensus layer, the transaction layer, and the SQL layer creates a three-dimensional design space where a suboptimal choice in any dimension cascades to the others.

---

## What Differentiates Naive vs. Production

| Dimension | Naive Approach | Production Reality |
|---|---|---|
| **Sharding** | Application-level hash partitioning with static shard count | Range-based automatic sharding with dynamic split/merge; load-based splitting bisects QPS, not just key space |
| **Transactions** | Two-phase commit with sequential prepare→commit rounds | Parallel commits: STAGING record + intent verification in one consensus round-trip; async intent resolution by any encountering node |
| **Clock Sync** | "Timestamps are monotonic" assumption | Hybrid logical clocks with read uncertainty intervals; observed timestamp narrowing; node self-quarantine on excessive skew |
| **Reads** | "Just read from any replica" | Leaseholder-only strong reads; follower reads only with bounded staleness; lease epoch verification before every read |
| **Schema Changes** | ALTER TABLE with table lock | Online schema changes via two-version Rule that never changes: background backfill + schema version fence ensuring no two nodes are more than one version apart |
| **Compaction** | "Background process handles it" | Rate-limited compaction with I/O budget; admission control throttles writes at Level 0 saturation; tiered vs. leveled strategy per workload profile |
| **Hot Spots** | "Add more nodes" | Adding nodes does not help — hot ranges must be split; hash-sharded indexes scatter sequential inserts; application-level bucketing for global counters |
| **Failure Recovery** | Manual failover with downtime | Per-range Raft leader election (<10s); parallel re-election across all affected ranges; learner replicas for zero-disruption rebalancing |

---

## System Overview

A NewSQL database solves a specific and difficult problem: providing the full SQL interface and ACID transactional guarantees that applications expect from a relational database, while distributing data transparently across many nodes for horizontal scalability. The engineering challenge is that distribution and transactions are fundamentally in tension — distributing data across nodes means transactions must coordinate across network boundaries, and coordinating across networks means consensus protocols (Raft), clock synchronization (HLC), and distributed commit protocols (parallel commits) become critical-path components of every query.

---

## Quick Links

| # | Section | Description |
|---|---------|-------------|
| 01 | [Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| 02 | [High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| 03 | [Low-Level Design](./03-low-level-design.md) | Data model, API design, core algorithms (Step-by-step plan in plain English) |
| 04 | [Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Clock skew, distributed deadlocks, range splits, cross-range transactions |
| 05 | [Scalability & Reliability](./05-scalability-and-reliability.md) | Range-based sharding, Raft replication, multi-region deployment |
| 06 | [Security & Compliance](./06-security-and-compliance.md) | Threat model, RBAC, encryption, SQL injection prevention |
| 07 | [Observability](./07-observability.md) | Raft health metrics, query latency, distributed tracing |
| 08 | [Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-off frameworks |
| 09 | [Insights](./09-insights.md) | Key architectural insights and non-obvious lessons |

## What Makes This System Unique

### Three-Layer Coordination Challenge

Unlike a key-value store (one distributed layer) or a traditional RDBMS (one compute layer), a NewSQL database coordinates across three interdependent layers: the **SQL layer** (query planning and distributed execution), the **transaction layer** (distributed ACID with timestamp ordering and conflict detection), and the **storage layer** (Raft consensus per range, LSM-tree persistence). A performance regression in any layer cascades to the others: a slow Raft group increases transaction latency, which increases intent dwell time, which increases read latency across the SQL layer. This three-dimensional coupling is what makes NewSQL database design uniquely challenging.

### The Range as Universal Abstraction

Every operational property — replication factor, latency, throughput, fault tolerance, placement — is defined at the range level, not at the table, node, or cluster level. This creates a design space where schema decisions (choosing a primary key) directly determine operational characteristics (which ranges exist, how they split, where they are placed). The schema designer is implicitly designing the range topology.

### Clock Synchronization as a Performance Variable

Systems with atomic clocks (Spanner-class) trade a deterministic latency cost (~7ms commit-wait) for guaranteed external consistency. Systems with commodity clocks (NTP/HLC) trade a probabilistic restart cost (2-5% of transactions with default NTP, <0.1% with PTP) for zero-hardware infrastructure. This is not just an infrastructure choice — it is a fundamental performance trade-off that affects every transaction.

---

## Technology Landscape

| Category | Representative Systems | Approach |
|----------|----------------------|----------|
| Geo-Distributed SQL | CockroachDB, Spanner-derivatives | Range-based sharding, Raft consensus, hybrid logical clocks, parallel commits |
| HTAP NewSQL | TiDB (TiKV + TiFlash) | Separated compute/storage, Raft per region, columnar replicas for analytics |
| Distributed PostgreSQL | YugabyteDB (DocDB) | Tablet-based sharding, per-tablet Raft groups, PostgreSQL-compatible SQL layer |
| Cloud-Native NewSQL | PlanetScale (Vitess), Aurora | MySQL-compatible, horizontal sharding with VTGate routing |
| Academic / Research | Calvin, FaunaDB | Deterministic transaction ordering, Calvin-style pre-ordering |
| Embedded NewSQL | FoundationDB + SQL layers | Ordered key-value foundation with layered SQL semantics |

## Key Concepts Referenced

- **Range** — A contiguous span of the sorted keyspace; the unit of replication, sharding, and load balancing
- **Raft Consensus** — Per-range consensus protocol ensuring replicated state machine agreement across nodes
- **Leaseholder** — The range replica that holds the lease and coordinates all reads and writes for that range
- **MVCC (Multi-Version Concurrency Control)** — Each write creates a new timestamped version; reads see a consistent snapshot
- **Hybrid Logical Clock (HLC)** — Combines physical time (NTP) with a logical counter to establish causal ordering without specialized hardware
- **Parallel Commits** — Optimization that commits a distributed transaction in one consensus round-trip instead of two
- **Range Split / Merge** — Automatic division of ranges that grow too large and merging of underutilized ranges
- **Intent** — A provisional write (MVCC value) that indicates an uncommitted transaction, resolved on commit or abort
- **Write Amplification** — Ratio of bytes written to storage vs. bytes written by the application; driven by LSM compaction
- **Read Amplification** — Number of SST files/levels checked per read; reduced by bloom filters and compaction
- **Observed Timestamp** — Timestamp tracked per leaseholder that narrows the read uncertainty window for subsequent reads
- **Two-Version Rule that never changes** — Constraint that at most two adjacent schema versions may coexist during online schema changes
- **Lease Epoch** — Monotonic counter associated with range leases; prevents stale leaseholders from serving reads after lease transfer

---

## Architecture Evolution (2024–2026)

Key trends shaping NewSQL database architecture:

- **Serverless NewSQL:** Separation of compute and storage enables scale-to-zero for development clusters and burst scaling for production; compute nodes become ephemeral while ranges persist in shared object storage with local NVMe caching
- **AI-Integrated Query Optimization:** ML models replace hand-tuned cardinality estimators; learned indexes predict key distribution for range split decisions; workload forecasting drives proactive rebalancing before hot spots emerge
- **Disaggregated Storage with Tiered Persistence:** Hot ranges on local NVMe, warm ranges on network-attached SSD, cold ranges on object storage; automatic promotion/demotion based on access frequency with sub-second promotion latency
- **Native Vector Column Support:** NewSQL databases add vector data types and approximate nearest neighbor (ANN) indexes alongside relational columns, enabling hybrid transactional-analytical-vector workloads without external vector databases
- **Zero-Downtime Major Version Upgrades:** Rolling upgrades across schema versions with backward-compatible Raft protocol negotiation; each node can run a different binary version during the upgrade window
- **eBPF-Based Observability:** Kernel-level tracing of I/O latency, network packet loss, and syscall contention without application instrumentation overhead; enables microsecond-resolution storage latency profiling

---

## Related Patterns

| Related Topic | Connection | Link |
|---|---|---|
| Event Sourcing System | Raft log is an event-sourced replicated log; MVCC version history provides natural event stream | [View](../1.18-event-sourcing-system/00-index.md) |
| Change Data Capture System | CDC extracts row-level changes from the MVCC layer for downstream consumers | [View](../16.8-change-data-capture-system/00-index.md) |
| Distributed Consensus | Raft consensus per range is the foundation of all replication and fault tolerance | [View](../1.5-distributed-consensus/00-index.md) |
| Data Warehouse Architecture | NewSQL HTAP capabilities blur the boundary between OLTP and analytical workloads | [View](../16.6-data-warehouse-architecture/00-index.md) |
| Service Discovery System | Range descriptor cache serves as a specialized service discovery layer mapping keys to nodes | [View](../1.10-service-discovery-system/00-index.md) |
| Time-Series Database | Time-series workloads on NewSQL require hash-sharded indexes to avoid sequential insert hot spots | [View](../16.1-time-series-database/00-index.md) |
| API Gateway Design | SQL gateway layer handles connection pooling, authentication, and query routing similar to an API gateway | [View](../1.14-api-gateway-design/00-index.md) |
| Data Mesh Architecture | NewSQL databases serve as domain-owned data products within a data mesh topology | [View](../16.9-data-mesh-architecture/00-index.md) |
