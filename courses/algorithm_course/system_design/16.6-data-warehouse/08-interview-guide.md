# Interview Guide — Data Warehouse

## Interview Pacing (45-min Format)

| Time | Phase | Focus | Key Points |
|------|-------|-------|------------|
| 0-5 min | **Clarify** | Scope the problem | What data types? What query patterns (BI vs. ad-hoc)? Scale (TB vs. PB)? Latency tolerance? Cost sensitivity? |
| 5-15 min | **High-Level** | Core architecture | Three-layer architecture (cloud services, elastic compute, durable storage); separation of compute and storage; immutable micro-partitions |
| 15-30 min | **Deep Dive** | 1-2 critical components | Pick: columnar storage internals, query execution engine, or partition Cutting off unnecessary steps. Go deep on internals. |
| 30-40 min | **Scale & Trade-offs** | Elasticity and cost | Elastic compute scaling, multi-cluster warehouses, cost optimization (Cutting off unnecessary steps → caching → right-sizing), workload isolation |
| 40-45 min | **Wrap Up** | Summary + follow-ups | Summarize key trade-offs; discuss monitoring, security (RLS, masking), and operational concerns |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **The decoupled compute paradox:** Separating compute from storage eliminates resource contention but introduces network latency for every data access. The entire caching hierarchy (result cache → metadata cache → SSD cache → object storage) exists to bridge this gap, and the system's performance is determined by cache hit ratios more than raw compute power.

2. **Cost is a first-class design constraint:** Unlike OLTP databases where the primary metric is latency, a data warehouse's cost is directly proportional to bytes scanned and compute seconds consumed. Every architectural decision — columnar storage, partition Cutting off unnecessary steps, materialized views, result caching — is simultaneously a performance optimization and a cost optimization.

3. **Immutability enables everything:** The decision to make micro-partitions immutable (append-only, copy-on-write for updates) cascades through the entire design: zero-contention snapshot isolation, free time travel, trivial replication, excellent compression, and simple cache invalidation. The trade-off is expensive UPDATE/DELETE operations.

4. **The optimizer is the product:** Two users writing logically equivalent SQL can experience 100x different performance depending on whether partition Cutting off unnecessary steps activates, which join strategy is selected, and whether a materialized view is matched. The cost-based optimizer determines the user experience more than any other component.

### Where to Spend Most Time

- **Separation of compute and storage:** This is the defining architectural property — explain the three-layer architecture and why it enables independent scaling, workload isolation, and pay-per-query economics
- **Columnar storage and partition Cutting off unnecessary steps:** Demonstrate deep understanding of how columnar encoding, zone maps, and clustering keys reduce I/O by 10-100x
- **Query execution:** Explain vectorized execution and why it outperforms row-at-a-time processing for analytical workloads

### How to Approach This Problem

1. Start by clarifying the workload (OLAP not OLTP) and scale (TB to PB)
2. Propose the three-layer architecture (cloud services → compute → storage)
3. Explain columnar storage with micro-partitions and encoding
4. Design the query path (parse → optimize → distribute → execute → return)
5. Address scaling (elastic compute, multi-cluster, auto-suspend)
6. Discuss cost optimization (Cutting off unnecessary steps, caching, materialized views)
7. Cover security (RLS, column security, masking)

---

## Trade-offs Discussion

### Decision 1: Separated vs. Coupled Compute and Storage

| Aspect | Separated | Coupled (Traditional MPP) |
|--------|-----------|--------------------------|
| Pros | Independent scaling; workload isolation; pay-per-use; zero-copy data sharing; instant elasticity | Data locality — no network overhead; predictable latency; simpler architecture |
| Cons | Network latency for cold data; cache warm-up needed; more complex caching hierarchy | Wasted resources when idle; scaling requires data redistribution; workload contention |
| **Recommendation** | **Choose separated** for cloud-native deployments where elasticity and cost efficiency matter more than predictable single-query latency |

### Decision 2: Immutable Micro-Partitions vs. Mutable Storage

| Aspect | Immutable (Copy-on-Write) | Mutable (In-Place Updates) |
|--------|--------------------------|--------------------------|
| Pros | Zero-contention reads; free time travel; excellent compression; simple replication | Cheap single-row updates; lower write amplification |
| Cons | Expensive UPDATE/DELETE (rewrite partition); storage amplification from old versions | Lock contention; complex crash recovery; poor compression |
| **Recommendation** | **Choose immutable** for analytical workloads where data is append-heavy and updates are rare. The UPDATE cost is acceptable because analytical tables are loaded in bulk, not row-by-row. |

### Decision 3: Vectorized Execution vs. Code Generation (JIT Compilation)

| Aspect | Vectorized (Columnar Batches) | Code Generation (JIT) |
|--------|------------------------------|----------------------|
| Pros | Cache-friendly; SIMD-enabled; predictable performance; works well with columnar storage | Eliminates interpretation overhead; can fuse multiple operators; near-native speed |
| Cons | Still has some interpretation overhead per batch; operator boundaries not fused | Compilation latency (100ms+); code cache management; harder to debug |
| **Recommendation** | **Vectorized with selective code generation.** Use vectorized execution for the common path (scans, filters, aggregates) and JIT compilation for complex expressions and UDFs. |

### Decision 4: Pre-Computed Materialized Views vs. On-Demand Caching

| Aspect | Materialized Views | Result Cache Only |
|--------|-------------------|-------------------|
| Pros | Guaranteed fast queries for known patterns; incremental refresh; optimizer can rewrite queries to use them | Zero maintenance; no storage overhead; adapts to any query pattern |
| Cons | Storage cost; refresh latency; maintenance complexity; only helps known query patterns | Cache miss is full-cost query; invalidated on any data change; no partial reuse |
| **Recommendation** | **Both.** Materialized views for known high-frequency aggregation patterns (dashboards). Result cache for ad-hoc queries. The optimizer should transparently match queries to materialized views when available. |

### Decision 5: Star Schema vs. Denormalized Wide Tables

| Aspect | Star Schema (Fact + Dimensions) | Denormalized Wide Table |
|--------|-------------------------------|----------------------|
| Pros | Normalized; less storage; flexible query patterns; dimension updates propagate automatically | No joins needed; simpler queries; faster scans |
| Cons | Join cost at query time; more complex ETL | Data duplication; dimension updates require full reload; 100+ columns |
| **Recommendation** | **Star schema** for general-purpose warehouses. The query optimizer handles joins efficiently (broadcast small dimensions), and normalized storage enables dimension evolution without reloading fact tables. |

---

## Trap Questions & How to Handle

### Trap 1: "Why not just use a transactional database for analytics?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of OLAP vs. OLTP trade-offs | Transactional databases store data row-by-row — to compute SUM(revenue) across 1 billion rows, the engine reads entire rows (50 columns × 1B rows = 400 GB I/O) even though it needs only one column (8 GB). A columnar warehouse reads only the revenue column (8 GB) and applies compression (→ 800 MB actual I/O). That is a 500x I/O difference. Add vectorized execution (20x CPU efficiency) and partition Cutting off unnecessary steps (skip 95% of data), and the total speedup is 10,000x for a typical analytical query. The trade-off is that single-row lookups and updates are slower in columnar storage. |

### Trap 2: "How do you handle updates in an append-only system?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of copy-on-write mechanics | Updates are implemented as copy-on-write: the system identifies affected micro-partitions, reads them, applies changes, writes new partitions with modifications, and atomically swaps metadata pointers. Old partitions are retained for time travel. This is expensive for single-row updates (rewriting 500 MB for one row) but efficient for bulk updates (merge operations). For CDC-style incremental updates, a merge/upsert operation groups changes by partition to minimize rewrites. The key insight is that analytical tables rarely need single-row updates — most "updates" are periodic bulk refreshes. |

### Trap 3: "What if a single query takes all the resources?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test workload management understanding | This is the "noisy neighbor" problem. The solution is workload isolation: separate compute warehouses for different workload types (BI, ETL, ad-hoc). Within a warehouse, resource governance enforces per-query memory limits, maximum execution time, and maximum bytes scanned. Queries exceeding limits are queued or terminated. Multi-cluster warehouses add compute capacity automatically when queries queue, preventing a burst of queries from degrading latency. The key metric is query queue time — if it exceeds the SLO, add clusters. |

### Trap 4: "How does partition Cutting off unnecessary steps work and when does it fail?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test deep understanding of zone maps | Each micro-partition stores min/max statistics (zone maps) for every column. The optimizer evaluates query predicates against zone maps and skips partitions where the predicate cannot match. Cutting off unnecessary steps fails in three cases: (1) query predicates are on non-clustered columns with overlapping ranges across partitions, (2) predicates use functions on columns (e.g., `MONTH(date) = 6`) which prevent zone map evaluation, (3) predicates use OR conditions that span the full value range. The fix is clustering keys that physically sort data by the most-queried columns, and optimizer rewrites that convert function predicates to range predicates. |

### Trap 5: "How do you optimize cost?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test practical production thinking | Cost optimization operates at three levels. Storage: columnar compression (10x reduction), tiered storage lifecycle (hot → warm → cold), time travel retention tuning. Compute: auto-suspend idle warehouses, right-size warehouses based on actual utilization, use economy scaling mode. Query: partition Cutting off unnecessary steps (reduce bytes scanned), materialized views (avoid redundant computation), result caching (avoid redundant execution). The single highest-impact optimization is clustering keys — a well-clustered table with 99% Cutting off unnecessary steps rate scans 100x less data than an unclustered table, directly reducing compute time and cost. |

### Trap 6: "How do you handle real-time analytics?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of freshness vs. latency trade-offs | A data warehouse is not a real-time system — it is a near-real-time system. Sub-second freshness requires a streaming architecture (Druid, Pinot) with pre-materialized aggregates. A warehouse achieves sub-minute freshness via continuous micro-batch ingestion: CDC captures row changes from the source database transaction log, a stream processor buffers changes into micro-batches (10-60 seconds), and the warehouse loads each micro-batch as new immutable micro-partitions. The key insight is that "real-time" in the warehouse context means "how quickly does new data become queryable," not "how quickly does the query execute." The query itself is still seconds to minutes. |

### Trap 7: "What happens when the optimizer makes a bad choice?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of query plan quality risks | The optimizer is only as good as its statistics. Bad choices happen when: (1) statistics are stale (table grew 10x since last analyze), (2) columns are correlated but assumed independent, (3) user-defined functions have unknown selectivity. Mitigations: adaptive query execution that monitors actual cardinality at pipeline breakers and re-optimizes mid-flight; query feedback loop that updates statistics based on observed execution; plan pinning for known-critical queries to prevent optimizer regressions. The key trade-off in adaptive execution is the re-planning cost (50-200ms) vs. the potential savings (minutes for severely misoptimized plans). |

### Trap 8: "Why not just use a data lake?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of warehouse vs. lakehouse positioning | A data lake stores raw, schema-on-read data in open formats. A warehouse stores transformed, schema-on-write data in optimized columnar format. The warehouse wins on: query performance (10-100x faster due to columnar encoding, zone maps, and vectorized execution), cost predictability (compute costs are bounded by scan reduction), and governance (RLS, masking, audit logging built in). The lake wins on: flexibility (store anything, analyze later), cost (raw storage is cheaper), and multi-engine access. Lakehouse architectures attempt to bridge this gap by adding ACID, zone maps, and columnar optimization to open table formats. The remaining gap: lakehouses cannot match warehouse query performance because proprietary columnar formats with metadata integration enable deeper optimization than open formats allow. |

### When NOT to Use a Data Warehouse

| Scenario | Better Alternative | Why |
|----------|-------------------|-----|
| Sub-millisecond point lookups | Key-value store or OLTP database | Row-based storage is 1000x faster for single-row access |
| Sub-second streaming analytics | Real-time OLAP (Druid, Pinot, ClickHouse) | Pre-materialized aggregates avoid query-time computation |
| Unstructured data (images, video) | Object storage + ML pipeline | Warehouse cannot index or query unstructured content |
| Graph traversal queries | Graph database | Columnar storage cannot efficiently traverse relationships |
| < 100 GB total data | Embedded analytics (DuckDB, SQLite) | Distributed architecture overhead not justified at small scale |
| Highly variable schema | Data lake with schema-on-read | Warehouse schema-on-write is too rigid for exploratory data |

### Key Numbers to Remember

| Metric | Value | Context |
|--------|-------|---------|
| Columnar compression ratio | 10:1 typical | vs. 3:1 for row storage |
| Partition Cutting off unnecessary steps target | > 95% | Clustered table with good predicates |
| Vectorized scan throughput | 2 GB/s per core | vs. 100 MB/s per core for Volcano model |
| Zone map overhead | 100 bytes per column per partition | ~0.005% of data size |
| Dictionary encoding ratio | 10-50x for low-cardinality | Country codes, status enums |
| SSD cache hit target | > 80% | Below 60% indicates insufficient cache |
| Query compilation target | < 500 ms | DP join enumeration capped at 10 tables |
| Micro-partition size | 50-500 MB uncompressed | 50K-500K rows per partition |
| Broadcast join threshold | < 10 MB small side | Above this, use hash repartition |
| Time travel retention | 1-90 days configurable | Storage cost increases linearly |
| Auto-suspend default | 5-10 minutes | Balance cost savings vs. resume latency |
| Object storage first-byte latency | ~50 ms | vs. ~0.1 ms for NVMe SSD |

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|---------------|-----------------|
| Designing row-based storage for analytical workloads | Misses the fundamental I/O advantage of columnar storage | Start with columnar; explain why analytical queries benefit from reading only needed columns |
| Ignoring separation of compute and storage | Assumes coupled architecture, misses elasticity discussion | Lead with the three-layer architecture; explain why decoupling enables independent scaling |
| No partition Cutting off unnecessary steps discussion | Misses the single most impactful optimization | Explain zone maps, clustering keys, and Cutting off unnecessary steps effectiveness early |
| Treating updates like OLTP | Single-row update patterns don't apply to analytical workloads | Explain copy-on-write and merge operations for bulk updates |
| Ignoring cost optimization | Cost is a first-class concern, not an afterthought | Discuss how every architectural decision (Cutting off unnecessary steps, caching, compression) directly affects cost |
| Single warehouse for all workloads | Creates the noisy neighbor problem | Design workload isolation with separate warehouses from the start |
| No caching hierarchy | Assumes compute always reads from object storage | Design multi-tier caching: result cache → SSD cache → object storage |

---

## Questions to Ask Interviewer

| Question | Why It Matters |
|----------|---------------|
| What is the primary workload? (BI dashboards, ad-hoc, ETL) | Determines warehouse sizing and caching strategy |
| What is the data volume and growth rate? | Determines storage tier strategy and partition sizing |
| How fresh must the data be? (minutes, hours, daily) | Determines ingestion strategy (micro-batch vs. daily bulk) |
| Are there compliance requirements? (GDPR, PCI, HIPAA) | Determines security architecture (RLS, masking, encryption) |
| How many concurrent users/queries? | Determines multi-cluster and workload management design |
| Is cost sensitivity primary or secondary? | Determines whether to optimize for performance or cost |
| Will this replace an existing system or be greenfield? | Determines migration strategy and backward compatibility |
| Is data sharing across teams required? | Determines zero-copy sharing and governance design |

---

## Scoring Rubric

### Level: Strong Hire (Senior/Staff Engineer)

| Dimension | Criteria |
|-----------|----------|
| **Architecture** | Articulates three-layer separation (cloud services, compute, storage) and explains why each layer must be independently scalable. Mentions workload isolation as a first-class concern. |
| **Storage internals** | Explains columnar encoding (dictionary, RLE, delta), zone maps, and clustering depth. Can calculate Cutting off unnecessary steps effectiveness given clustering depth and predicate selectivity. |
| **Query execution** | Distinguishes vectorized from row-at-a-time execution. Explains join strategy selection (broadcast vs. hash repartition) and when each is optimal. |
| **Cost awareness** | Connects architectural decisions to cost: Cutting off unnecessary steps reduces bytes scanned, caching avoids redundant computation, auto-suspend eliminates idle cost. Treats cost as a first-class design constraint. |
| **Operational maturity** | Discusses SSD cache hit ratios, spill-to-disk monitoring, clustering depth degradation, and materialized view freshness. Knows what to monitor and why. |
| **Security** | Mentions RLS, column-level security, and dynamic data masking as distinct mechanisms. Understands that security policies are enforced at the scan level, not the application level. |

### Level: Hire (Mid-Level Engineer)

| Dimension | Criteria |
|-----------|----------|
| **Architecture** | Proposes separation of compute and storage but may not articulate all three layers. Understands that compute is stateless. |
| **Storage** | Knows data is columnar and compressed. May not detail encoding strategies. Understands partition Cutting off unnecessary steps at a high level. |
| **Execution** | Knows queries run in parallel across nodes. May not distinguish vectorized vs. Volcano execution. |
| **Cost** | Understands that scanning less data is cheaper. May not connect Cutting off unnecessary steps and clustering to cost. |

### Level: No Hire — Red Flags

| Red Flag | Why It Matters |
|----------|---------------|
| Proposes row-based storage for analytical workloads | Misses the fundamental design principle |
| No mention of partition Cutting off unnecessary steps or columnar scan | The single most impactful optimization is absent |
| Treats the system like OLTP (single-row updates, point lookups) | Does not understand the analytical workload profile |
| No caching hierarchy | Ignores the primary latency mitigation for separated architecture |
| No workload isolation discussion | Will produce a design with noisy-neighbor problems |
| Cannot explain why immutability matters | Misses the cascading benefits (snapshot isolation, time travel, compression) |

---

## Advanced Discussion Topics

### Topic 1: Adaptive Query Execution

How should the warehouse handle a query where the optimizer's cardinality estimate is 100x wrong? Discuss mid-flight plan adaptation: the execution engine monitors actual vs. estimated cardinality at pipeline breakers, and if divergence exceeds a threshold (e.g., 10x), it re-optimizes the remaining plan with updated statistics. Trade-off: adaptive re-planning adds compilation latency (50-200ms) but can save minutes on misoptimized queries.

### Topic 2: Open Table Format Integration

How does the warehouse interact with open table formats (e.g., Iceberg, Delta Lake) stored in object storage? Discuss: external table scanning (the warehouse reads Iceberg manifests and applies its own query engine), native table conversion (data imported into the warehouse's proprietary micro-partition format for full optimization), and hybrid approaches (read external formats directly but materialize hot tables into native format). Trade-offs: native format enables maximum Cutting off unnecessary steps and compression; external format enables multi-engine access.

### Topic 3: Data Sharing Without Data Movement

Design zero-copy data sharing between two organizational units. Key considerations: the sharing producer defines a share (metadata pointers to specific tables/views), the consumer mounts the share as a read-only database, queries execute on the consumer's compute against the producer's storage. Security constraints: row-level security policies in the share definition; column masking policies applied at the consumer side; audit logging of all cross-organization data access. Challenge: the consumer's queries are invisible to the producer unless audit logs are shared.

### Topic 4: Automatic Physical Design Advisor

How would you build a system that automatically recommends clustering keys, materialized views, and partition sizes? Approach: analyze query history to identify most-frequent predicate columns (clustering key candidates), most-repeated aggregation patterns (materialized view candidates), and optimal partition sizes based on scan/load ratios. Challenge: recommendations must account for re-clustering cost — a key that provides 99% Cutting off unnecessary steps but requires $1M/year in re-clustering costs may be worse than a key with 90% Cutting off unnecessary steps and $10K re-clustering cost.

### Topic 5: Multi-Tenant Cost Attribution

Design a system where each business unit pays only for its actual data warehouse usage. Key challenges: shared tables queried by multiple teams (how to attribute the scan cost?), shared materialized views (who pays for refresh?), and shared object storage (split by data ownership or query access?). Approaches: per-query cost metering (attribute each query's compute and scan cost to the submitting team), per-table ownership (the team that loads data pays for storage; the team that queries pays for compute), and chargeback dashboards with drill-down by team, warehouse, and query pattern.

### Topic 6: Time Travel and Cloning for Development Workflows

How would you design a zero-copy clone capability that enables developers to create a full copy of a production database for testing without duplicating any data? Key insight: because micro-partitions are immutable, a clone simply creates a new metadata pointer set that references the same partitions. Writes to the clone create new partitions (copy-on-write), leaving the production data untouched. Challenges: access control (clone should inherit security policies from source), cost attribution (clone storage is only the delta writes), and staleness (clones diverge from production over time and must be refreshed).

### Topic 7: Warehouse Migration Strategy

Discuss how to migrate from an on-premise MPP warehouse to a cloud-native separated architecture. Phased approach: (1) export data to open columnar format (Parquet) in object storage, (2) create external tables in the new warehouse pointing to exported data, (3) run validation queries comparing results between old and new systems, (4) gradually migrate workloads by query pattern (start with BI dashboards, then ad-hoc, then ETL), (5) decommission on-premise system. Key risk: the new system's optimizer has no historical statistics — expect 2-4 weeks of suboptimal query performance while statistics accumulate.

---

## Quick Reference Card

```
DATA WAREHOUSE DESIGN CHEATSHEET
──────────────────────────────────
Architecture: Three layers — cloud services, elastic compute, durable storage
Storage: Columnar micro-partitions (50-500 MB), immutable, append-only
Encoding: Dictionary, RLE, Delta, Bit-pack + Zstd/LZ4 compression
Cutting off unnecessary steps: Zone maps (min/max per partition per column) + clustering keys
Execution: Vectorized (column batches of 1K-4K values), SIMD-enabled
Joins: Broadcast (small), Hash repartition (large), Co-located (pre-partitioned)
Scaling: Elastic compute clusters, independent of storage
Isolation: Separate warehouses per workload class
Caching: Result cache (shared) → SSD cache (per node) → object storage
Concurrency: Snapshot isolation via immutable partitions + metadata versioning
Materialized Views: Incremental refresh for additive aggregates
Security: RBAC + RLS + Column-level security + Dynamic data masking
Cost Levers: Partition Cutting off unnecessary steps > clustering > caching > right-sizing > auto-suspend
Key Metric: Partition Cutting off unnecessary steps rate (target > 95% for filtered queries)
Key Trade-off: Separation latency vs. elasticity benefit
```

---

## Comparison with Related Systems

| Dimension | Data Warehouse | Data Lakehouse | Real-Time OLAP | OLTP Database |
|-----------|---------------|---------------|---------------|---------------|
| Primary workload | Batch/interactive analytics | Unified analytics + ML | Sub-second dashboards | Transactional read/write |
| Storage format | Proprietary columnar | Open table format (Iceberg, Delta) | Columnar with pre-aggregation | Row-oriented |
| Query latency | 1-60 seconds | 2-120 seconds | 100ms - 5 seconds | 1-50 ms |
| Data freshness | Seconds to minutes | Minutes to hours | Real-time (sub-second) | Real-time |
| Schema | Schema-on-write (star schema) | Schema-on-read/write | Pre-defined aggregates | Normalized (3NF) |
| Concurrency | 100-1,000+ queries | 10-100 queries | 1,000-10,000+ queries | 10,000-100,000+ transactions |
| Update pattern | Append + periodic merge | Append + merge-on-read or copy-on-write | Append-only | In-place updates |
| Cost model | Per-query (bytes scanned + compute time) | Per-query + storage | Per-cluster (always-on) | Per-transaction |
| When to choose | BI dashboards, regulatory reporting, ad-hoc analytics | ML pipelines + analytics on raw data | Operational dashboards, user-facing analytics | Application backends, CRUD operations |
