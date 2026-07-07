# Interview Guide — Data Lakehouse Architecture

## 45-Minute Interview Pacing

| Phase | Time | Focus | Deliverable |
|:---|:---|:---|:---|
| **1. Clarify** | 0 – 5 min | Scope the problem: batch vs. streaming, scale, workload mix | Written requirements list; confirm ACID is non-negotiable |
| **2. High-Level Design** | 5 – 15 min | Draw catalog → table format → object storage architecture | Architecture diagram with data flow arrows |
| **3. Deep Dive** | 15 – 30 min | ACID commit protocol, MoR vs. CoW, compaction strategy | Step-by-step plan in plain English for OCC commit; file layout diagram |
| **4. Scale & Trade-offs** | 30 – 40 min | Metadata scalability, multi-engine access, partition evolution | Slowest part of the process analysis; trade-off decisions |
| **5. Wrap-up** | 40 – 45 min | Observability, operational concerns, questions | Key metrics; monitoring approach |

## Meta-Commentary

### What Makes This Problem Unique

1. **ACID on non-ACID storage** — the core intellectual challenge is explaining how immutable object storage achieves transactional semantics through metadata layering and optimistic concurrency.
2. **Three-layer metadata hierarchy** — candidates must understand why a single-file catalog is insufficient and why the snapshot → manifest-list → manifest → data-file hierarchy exists.
3. **Write amplification vs. read amplification trade-off** — CoW vs. MoR is not a binary choice; it is a continuous spectrum controlled by compaction frequency.
4. **Open format ecosystem complexity** — the interviewer may probe awareness of multiple table formats and their design trade-offs rather than deep knowledge of one.

### Key Insights to Demonstrate

| # | Insight | Why It Impresses |
|:---|:---|:---|
| 1 | The metadata hierarchy is the load-bearing wall, not incidental complexity | Shows you understand the "why" behind the architecture |
| 2 | Compaction is a first-class design parameter, not maintenance | Signals production experience |
| 3 | MoR and CoW are a spectrum controlled by compaction frequency | Avoids the binary thinking trap |
| 4 | Object storage eventual consistency is bypassed, not solved | Demonstrates deep understanding of the consistency model |
| 5 | The catalog's simplicity is deceptive — it's a critical-path SPOF | Shows operational awareness |

### Where to Spend Time

- **Start with the commit protocol** — this is where most candidates differentiate. Draw the write path: write files → build manifests → CAS on catalog pointer. Explain what happens on conflict.
- **Data skipping is your performance story** — show the progressive Cutting off unnecessary steps: partition bounds → manifest file stats → column statistics → row-group-level filtering.
- **Compaction is your operational maturity signal** — interviewers at senior/staff level expect you to discuss why compaction is necessary, how it interacts with concurrent reads and writes, and how to schedule it.
- **Use concrete numbers** — "A 500 TB table with 256 MB files has 2 million files; loading 2 million manifest entries at 200 bytes each is 400 MB of metadata."

### Clarification Questions to Ask

| # | Question | Why It Matters |
|:---|:---|:---|
| 1 | Is this primarily read-heavy (BI) or write-heavy (streaming CDC)? | Determines CoW vs. MoR strategy |
| 2 | What is the data freshness requirement — minutes or hours? | Drives commit frequency and small-file management |
| 3 | How many query engines need to access the same tables? | Determines catalog complexity and cross-engine consistency requirements |
| 4 | What is the regulatory environment — GDPR, CCPA, financial? | Affects retention policies, erasure workflows, audit requirements |
| 5 | Is this greenfield or migration from an existing Hive data lake? | Changes the architecture approach significantly |
| 6 | What is the expected peak concurrent query load? | Sizes the compute layer and caching strategy |

### How to Approach

- **Think out loud about the metadata hierarchy** — interviewers want to see you reason about why each layer exists, not just recite it.
- **Use concrete numbers** — "A 500 TB table with 256 MB files has 2 million files; loading 2 million manifest entries at 200 bytes each is 400 MB of metadata."
- **Acknowledge the ecosystem** — mention that this is an active design space with multiple competing formats, then pick one to go deep on.

## Trade-Offs Discussion

### Trade-off 1: Copy-on-Write vs. Merge-on-Read

| Dimension | CoW | MoR |
|:---|:---|:---|
| **Pros** | Zero read-time merge overhead; simple scan logic; predictable query performance | Minimal write amplification; fast upserts; supports streaming CDC natively |
| **Cons** | Rewrites entire files for single-row changes; high write amplification | Read-time merge adds CPU; performance degrades without compaction; more complex planning |
| **When to choose** | Read-dominant BI workloads; infrequent updates | Write-heavy CDC; streaming ingestion; low-latency upsert requirements |

**Senior/staff signal**: Explain that MoR and CoW are two ends of a spectrum, and compaction frequency is the knob that moves a table along it. A freshly compacted MoR table reads identically to CoW.

### Trade-off 2: Centralized Catalog vs. Storage-Level Metadata

| Dimension | Centralized Catalog | Storage-Level (file-system catalog) |
|:---|:---|:---|
| **Pros** | Single authority for governance and atomic commits; supports credential vending; multi-engine consistency | No external dependency; metadata co-located with data; simpler deployment |
| **Cons** | Catalog is an availability dependency; requires operational management | No cross-engine consistency; directory listing is eventually consistent; no centralized ACLs |
| **When to choose** | Multi-engine, governed enterprise deployments | Single-engine, development/exploration environments |

### Trade-off 3: Hidden Partitioning vs. Explicit Partitioning

| Dimension | Hidden Partitioning | Explicit (Hive-Style) Partitioning |
|:---|:---|:---|
| **Pros** | Users query on source columns; layout evolvable without data rewrite; no partition-column maintenance in queries | Widely understood; directory-based discovery; simple tooling compatibility |
| **Cons** | Requires engine support for transform-based Cutting off unnecessary steps; slightly more complex planning | Locked at creation; changing granularity requires full rewrite; user must filter on partition columns explicitly |
| **When to choose** | New lakehouse tables; long-lived tables likely to evolve | Legacy compatibility; simple, static workloads |

### Trade-off 4: Frequent Small Commits vs. Batched Large Commits

| Dimension | Frequent Small Commits | Batched Large Commits |
|:---|:---|:---|
| **Pros** | Lower data latency; fresher data visible sooner | Fewer total commits; less catalog contention; fewer small files |
| **Cons** | Creates many small files; higher compaction load; more catalog contention | Higher end-to-end latency; burst commit sizes may be large |
| **When to choose** | Low-latency streaming requirements (< 60 s) | Batch ETL; hourly or daily pipelines; high-throughput bulk loads |

### Trade-off 5: Parquet vs. ORC as Default File Format

| Dimension | Parquet | ORC |
|:---|:---|:---|
| **Pros** | Widest engine support; strong ecosystem; efficient nested-data handling | Better predicate pushdown in some engines; ACID-aware originally; lightweight built-in indexes |
| **Cons** | No built-in indexes (relies on external stats); large footer overhead for many columns | Narrower engine support; less common in Python/ML ecosystems |
| **When to choose** | Default for most lakehouse deployments; required for broadest multi-engine access | Legacy Hive environments; deeply nested data with heavy predicate pushdown |

## Trap Questions

### Trap 1: "Can we just use object storage's versioning for time travel?"

**Interviewer intent**: Test whether the candidate understands that object-level versioning operates on individual files, not on table-level snapshots.

**Best answer**: Object storage versioning tracks changes to individual objects, but a lakehouse snapshot captures the set of files that constitute a table at a point in time. Rolling back a table requires restoring the complete file set, not individual file versions. Additionally, object versioning has no concept of atomicity across multiple files — you cannot restore "all files as of time T" atomically. The table format's snapshot chain provides this table-level consistency.

### Trap 2: "Why not just use a distributed database as the catalog?"

**Interviewer intent**: Probe understanding of the catalog's simplicity requirement.

**Best answer**: The catalog only needs to store one pointer per table (current metadata location) and perform one atomic operation (CAS). A distributed database is viable and some implementations use one, but it is over-provisioned for this use case. The critical requirement is **atomicity of the pointer swap**, not distributed transactions. A lightweight key-value store, a consensus-based service, or even a relational database suffices. The complexity budget should go into the table format layer, not the catalog.

### Trap 3: "If compute is decoupled from storage, doesn't every query have high latency?"

**Interviewer intent**: Test understanding of caching and data locality strategies.

**Best answer**: Decoupled compute does add network latency compared to local-disk access. However, several mechanisms mitigate this: (1) columnar formats with predicate pushdown minimize bytes transferred; (2) data skipping eliminates 90–99% of files before any I/O; (3) local SSD caching on query workers stores hot data files and manifests; (4) parallel file fetches overlap network latency across multiple files. In practice, well-optimized lakehouse queries on cached data perform within 2–3x of co-located storage, and the cost and flexibility advantages outweigh the latency gap for analytical workloads.

### Trap 4: "Isn't compaction just a waste of resources since we're rewriting data?"

**Interviewer intent**: Test understanding of the read/write amplification trade-off.

**Best answer**: Compaction trades write amplification (rewriting data) for reduced read amplification (fewer files to scan, better statistics, no delete-file merging). Without compaction, read performance degrades proportionally to the number of small files and delete files. The total cost (write-side compaction + read-side scanning) is minimized at some optimal compaction frequency — too frequent wastes write I/O; too infrequent wastes read I/O. The key is monitoring the files-skipped ratio and read latency to find the right cadence per table.

### Trap 5: "How do you handle exactly-once semantics for streaming ingestion?"

**Interviewer intent**: Probe understanding of idempotent commits.

**Best answer**: The table format provides idempotent commits through snapshot-based conflict detection. A streaming writer checkpoints its source offset alongside each commit. On failure and restart, the writer resumes from its last checkpointed offset. If the writer re-produces files that were already committed (due to a crash after data write but before checkpoint), the commit either succeeds idempotently (if using an idempotency key) or fails on CAS (if the snapshot already advanced), and the writer reloads the latest snapshot and reconciles. The combination of source checkpointing and atomic commits provides effectively exactly-once semantics.

## Senior vs. Staff-Level Depth

| Topic | Senior Expectation | Staff+ Expectation |
|:---|:---|:---|
| **Commit protocol** | Explain OCC + CAS; describe conflict detection | Explain automatic rebase for non-overlapping changes; discuss conflict resolution strategies for compaction vs. ingestion |
| **MoR vs. CoW** | Articulate the trade-off; pick one with justification | Explain the spectrum model; discuss deletion vectors as a hybrid; quantify break-even points |
| **Data skipping** | Describe partition Cutting off unnecessary steps + column stats | Explain bloom filters in Puffin files, NDV sketches for join planning; discuss Z-ordering limitations beyond 3 columns |
| **Metadata scalability** | Discuss manifest caching and snapshot expiration | Quantify metadata size at scale; discuss manifest merging strategies; explain lazy loading |
| **Multi-engine access** | Describe catalog-based coordination | Discuss cross-engine consistency challenges; explain credential vending; discuss format compatibility gates |
| **Compaction** | Describe bin-packing and scheduling | Discuss adaptive compaction algorithms; explain Liquid Clustering vs. Z-ordering trade-offs; quantify compaction compute budget |
| **Compliance** | Mention GDPR and time-travel tension | Walk through the full erasure workflow (delete → compact → vacuum → verify); discuss data residency enforcement |
| **Cost optimization** | Mention storage tiering | Derive cost formulas for scan cost, compaction cost, retention cost; discuss cost attribution per team |

## Follow-Up Questions to Expect

| # | Question | Good Answer Direction |
|:---|:---|:---|
| 1 | "How would you handle a table with 10 billion rows and 100 million files?" | Manifest merging, lazy loading, hierarchical caching, partition-level manifest grouping |
| 2 | "What happens if compaction and ingestion both target the same partition?" | OCC detects conflict at commit; compaction retries with rebased file set; file-group-level concurrency prevents overlap |
| 3 | "How do you ensure GDPR compliance with time travel enabled?" | Short retention (< 30 days), forced compaction after erasure, vacuum with zero retention on affected snapshots |
| 4 | "How would you migrate a 500 TB Hive data lake to this architecture?" | In-place metadata migration (Phase 1), dual-write validation (Phase 2), cutover (Phase 3), optimization (Phase 4) |
| 5 | "How do you decide between Z-ordering and Liquid Clustering?" | Z-ordering: full rewrite, best for static tables with known query patterns. Liquid Clustering: incremental, adapts to changing patterns, lower ongoing cost |

## Common Mistakes

| # | Mistake | Why It Fails |
|:---|:---|:---|
| 1 | Ignoring the metadata hierarchy | Treating lakehouse as "Parquet files on object storage" misses the entire ACID and governance story |
| 2 | Assuming object storage has strong consistency for listings | Some stores are eventually consistent for LIST operations; the table format bypasses listing entirely |
| 3 | Choosing MoR without discussing compaction | MoR without compaction is a ticking time bomb for read performance |
| 4 | Over-partitioning | Partitioning by high-cardinality columns creates millions of tiny partitions, each with tiny files |
| 5 | Ignoring the catalog as an availability dependency | The catalog is on the critical path for every commit and every first query; it needs high availability |
| 6 | Treating Z-ordering as free | Z-ordering requires a full data rewrite (sort + write); it is a compaction operation with significant cost |
| 7 | Not discussing schema evolution | Real-world tables evolve; ignoring this signals lack of production experience |
| 8 | Proposing a distributed database as the catalog | Over-engineering; the catalog needs one CAS per table, not distributed transactions |
| 9 | Ignoring the small-file problem | Streaming without compaction creates 30 000+ files/day per writer |
| 10 | Conflating format choice with architecture quality | Delta/Iceberg/Hudi have converged; the differentiator is the catalog and governance layer |

## Anti-Patterns to Call Out

| # | Anti-Pattern | Better Approach |
|:---|:---|:---|
| 1 | **"Just use object storage versioning for time travel"** | Object versioning is per-file, not per-table; no atomic multi-file rollback |
| 2 | **"Partition by user_id for user-level queries"** | Use `bucket(256, user_id)` to bound partition count while preserving locality |
| 3 | **"Run compaction after every write"** | Amortize compaction cost; schedule based on small-file count threshold, not write frequency |
| 4 | **"Store statistics in a separate database"** | Co-locate statistics with manifests for single-fetch planning; external stats add a dependency |
| 5 | **"Use a message queue between catalog and engines"** | Engines pull metadata from catalog; adding async messaging increases complexity without clear benefit |

## Estimation Quick-Reference

| Parameter | Value | Derivation |
|:---|:---|:---|
| Files per TB (256 MB avg) | 4 000 | 1 TB / 256 MB |
| Manifest entry size | 200 bytes | Avro-serialized file path + stats |
| Manifest size per 1 000 files | 200 KB | 1 000 × 200 B |
| Planning memory per 1M files | ~200 MB | 1M × 200 B overhead + Avro parsing |
| Parquet footer size | ~10 KB | Schema + row group metadata |
| Compression ratio (raw → Parquet) | 4:1 | Typical for structured analytical data |
| Object storage GET latency | 20–50 ms | Per-file HTTP round trip |
| Catalog CAS latency | 50–200 ms | Single atomic operation |
| Compaction throughput | 0.5 GB/vCPU-hour | Read + sort + write |
| Small files per day (streaming, 30s interval, 10 partitions) | 28 800 | 10 × 2/min × 60 × 24 |

## Architecture Sketch Guide

When drawing the lakehouse architecture on a whiteboard:

1. **Start with three layers**: Client → Catalog → Object Storage (vertical stack)
2. **Add the table format layer** between catalog and storage (the metadata hierarchy)
3. **Draw the write path**: Writer → data files to storage → manifest + snapshot to metadata → CAS to catalog
4. **Draw the read path**: Reader → catalog (get snapshot pointer) → manifests (prune) → data files (scan)
5. **Add the compaction service** as a background actor touching both metadata and storage
6. **Highlight the CAS** as the atomicity primitive (draw it as a lock icon on the catalog pointer)
7. **Show multi-engine access**: Multiple engine boxes all pointing to the same catalog

**Key annotation points**:
- Mark the CAS on the catalog pointer: "This is where ACID lives"
- Mark manifests: "This is where performance lives (data skipping)"
- Mark compaction: "This is where operational cost lives"

## Discussion Talking Points

### For Senior-Level Candidates

| # | Talking Point | What It Demonstrates |
|:---|:---|:---|
| 1 | "The metadata hierarchy is not incidental complexity — it's the load-bearing wall" | Understands the fundamental architecture |
| 2 | "Compaction frequency is the knob that moves a table along the MoR-CoW spectrum" | Sees the continuous trade-off, not a binary choice |
| 3 | "Object storage eventual consistency is bypassed, not solved" | Deep understanding of the consistency model |
| 4 | "The catalog's credential-vending function makes it a security-critical component, not just an availability concern" | Sees beyond the obvious SPOF analysis |
| 5 | "Z-ordering ROI depends entirely on query patterns — analyze the query log before committing" | Data-driven engineering, not cargo-cult optimization |

### For Staff-Level Candidates

| # | Talking Point | What It Demonstrates |
|:---|:---|:---|
| 1 | "Liquid Clustering replaces both Z-ordering and explicit partitioning with incremental, adaptive re-clustering" | Awareness of latest industry direction |
| 2 | "Format interoperability (UniForm/XTable) makes the table format itself a commodity — the competitive moat is the catalog and governance layer" | Strategic thinking about ecosystem dynamics |
| 3 | "The GDPR erasure workflow requires delete → compact → vacuum, and the time between steps must be bounded by the compliance window" | Production compliance experience |
| 4 | "Cross-engine write format divergence is a subtle consistency threat — catalog-enforced write policies prevent it" | Anticipates real-world multi-engine challenges |
| 5 | "Cost attribution requires per-query scan cost tracking, not just per-table storage cost" | Understands organizational incentive alignment |

## Trap Question 6: "Why not use a distributed file system instead of object storage?"

**Interviewer intent**: Test understanding of the economics and operational trade-offs.

**Best answer**: A distributed file system (like HDFS) provides strong consistency and low-latency access but requires cluster management, capacity planning, and hardware procurement. Object storage provides effectively infinite capacity at commodity cost with zero operational overhead for scaling. The lakehouse architecture was specifically designed to work around object storage's limitations (eventual consistency, high per-request latency) through metadata-based file tracking and local SSD caching. The economic advantage of object storage (often 10x cheaper per TB) and the operational advantage (zero hardware management) outweigh the latency gap for analytical workloads. For organizations with existing HDFS infrastructure, the lakehouse works on both — but the long-term trend is toward object storage.

## Trap Question 7: "How do you handle queries that need to join across multiple lakehouse tables?"

**Interviewer intent**: Probe understanding of cross-table consistency guarantees.

**Best answer**: Each table's snapshot is independent — there is no built-in cross-table snapshot isolation. A query joining tables A and B pins snapshot S_A and S_B independently. If table B is committed between the resolution of A and B, the query may see a slightly newer B than A. For most analytical workloads, this is acceptable because the data is already stale by ingestion latency. For use cases requiring strict cross-table consistency (e.g., financial reconciliation), the catalog can support multi-table transactions that atomically commit snapshots across tables, or the query engine can resolve all table snapshots at a single wall-clock time using time-travel. The trade-off is that multi-table transactions increase catalog contention and complexity.

## 30-Second Elevator Pitch

> A lakehouse places an open metadata layer — snapshots, manifests with per-file statistics, and a catalog pointer — on top of commodity object storage. Every write creates immutable Parquet files and atomically swaps the catalog pointer via compare-and-swap, giving ACID transactions on non-ACID storage. Reads exploit the metadata hierarchy for progressive Cutting off unnecessary steps: partition bounds eliminate manifests, column statistics eliminate files, and only surviving files are scanned. This architecture decouples compute from storage, supports multiple query engines against the same governed data, and enables schema evolution and time travel as metadata-only operations.

## Questions to Ask the Interviewer

1. What is the primary workload: BI reporting, ML feature engineering, or both?
2. What is the expected data freshness requirement — minutes, hours, or daily?
3. Are there regulatory constraints on data residency or retention?
4. How many concurrent query engines need access to the same tables?
5. What is the expected update/delete frequency relative to appends?
6. Is there an existing data platform this lakehouse must integrate with?
7. What is the acceptable cost model — optimize for storage cost, query cost, or latency?
8. Are there existing partitioning or schema conventions that must be preserved?
9. What is the scale — gigabytes, terabytes, or petabytes?
10. Are there data quality validation requirements before data becomes queryable (WAP)?

## Deep Dive Preparation Questions

### Commit Protocol

1. How does the catalog ensure atomicity when object storage has no native locking?
2. What happens when two writers commit simultaneously to the same table?
3. When can a failed commit be automatically rebased vs. when must it be rejected?
4. How does the idempotency key prevent duplicate data from streaming retries?

### Data Skipping & Performance

1. Walk through the Cutting off unnecessary steps cascade: manifest list → manifests → files → row groups.
2. When would you add bloom filters to a table, and what is the storage overhead?
3. How do you decide between Z-ordering and Liquid Clustering for a given table?
4. What metrics would you monitor to know if data skipping is effective?

### Operational Concerns

1. How would you design a compaction scheduling algorithm that prioritizes the right tables?
2. Walk through the GDPR erasure workflow from delete request to physical removal.
3. How do you handle migration from a Hive data lake without downtime?
4. What observability would you add to detect a compaction-falling-behind scenario?

## Quick Reference Card

| Decision | Recommended Default | Override When |
|:---|:---|:---|
| File format | Parquet | Legacy ORC ecosystem |
| Write strategy | MoR with scheduled compaction | Read-dominant, rarely-updated tables → CoW |
| Partition granularity | day(timestamp) | High cardinality → coarser; low volume → unpartitioned |
| Target file size | 128 – 256 MB | Streaming low-latency → 64 MB; bulk batch → 512 MB |
| Compaction frequency | Every 4 hours | Streaming tables → every 1 hour; batch-only → daily |
| Snapshot retention | 7 days | Compliance → longer; cost-sensitive → 3 days |
| Z-ordering columns | 1 – 3 most-filtered columns | > 3 columns → diminishing returns |
| Catalog type | REST catalog with credential vending | Single-engine dev → file-system catalog |
| Delete strategy | Deletion vectors | Very high update rate → MoR with position deletes |
| Statistics | Min/max per column | High-cardinality point lookups → add bloom filters |
| Ingestion pattern | Micro-batch (30 s interval) | Low latency (< 10 s) → continuous with inline compaction |
| Metadata caching | In-memory with TTL-based refresh | Hot tables with many manifests → dedicated SSD cache tier |

## Format Selection Guide (For Interview)

| Criterion | Choose Iceberg | Choose Delta Lake | Choose Hudi |
|:---|:---|:---|:---|
| Multi-engine access | ✓✓✓ (widest support) | ✓✓ (via UniForm) | ✓✓ (growing) |
| Spark-centric stack | ✓✓ | ✓✓✓ (native) | ✓✓ |
| Streaming CDC | ✓✓ | ✓✓ | ✓✓✓ (designed for it) |
| Hidden partitioning | ✓✓✓ (pioneered it) | ✓✓ (Liquid Clustering) | ✓ (partial) |
| Catalog standard | ✓✓✓ (REST catalog) | ✓✓ (Unity Catalog) | ✓ (HMS compatible) |
| Branching / WAP | ✓✓✓ (native) | ✓ (partial) | ✓ (timeline-based) |
| Community momentum | ✓✓✓ (accelerating) | ✓✓✓ (Databricks-backed) | ✓✓ (rebuilding with 1.0) |

**Interview-safe answer**: "The formats have converged significantly. I'd choose based on ecosystem fit: Iceberg for multi-engine environments, Delta for Spark-centric stacks, Hudi for streaming-first CDC workloads. The table format itself is becoming a commodity — the real differentiator is the catalog, governance layer, and operational tooling."
