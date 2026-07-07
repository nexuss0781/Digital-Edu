# Scalability & Reliability — Data Lakehouse Architecture

## Storage Scaling

### Object Storage: Effectively Infinite

Object storage scales horizontally by design — the lakehouse inherits virtually unlimited capacity at commodity cost. The real scaling challenge is **not data volume but metadata volume**.

| Data Scale | Files (256 MB avg) | Manifest Entries | Planning Overhead |
|:---|:---|:---|:---|
| 1 TB | 4 000 | 4 K | < 1 s |
| 100 TB | 400 000 | 400 K | 2–5 s |
| 1 PB | 4 000 000 | 4 M | 10–30 s without optimization |
| 10 PB | 40 000 000 | 40 M | Minutes without caching / Cutting off unnecessary steps |

### Metadata Scaling Strategies

1. **Partition Cutting off unnecessary steps** — eliminates 90–99% of manifests for time-bounded queries. A well-partitioned 10 PB table behaves like a 100 GB table for queries with tight predicates.
2. **Manifest merging** — consolidate thousands of small manifests (from frequent commits) into fewer large ones. Reduces fan-out from O(commits) to O(partitions).
3. **Statistics tier** — maintain an aggregated statistics index (partition-level min/max) in the catalog or a dedicated sidecar file. Eliminates full manifest loading for highly selective queries.
4. **Snapshot expiration** — limit snapshot retention to bound metadata growth. A table with 1 M commits but 7-day retention only materializes ~10 K active snapshots.

## Compute Scaling

### Query Engine Elasticity

Because compute is decoupled from storage, query engines scale independently based on workload.

| Scaling Dimension | Mechanism | Trigger |
|:---|:---|:---|
| Horizontal (add nodes) | Add query workers to the cluster | Queue depth > threshold or p99 > target |
| Vertical (bigger nodes) | Increase memory/CPU per worker | Single-query memory pressure (large joins, aggregations) |
| Auto-scale down | Remove idle workers after cooldown | No queries for N minutes |
| Workload isolation | Separate clusters per workload class | BI dashboards vs. ML feature pipelines vs. ad-hoc exploration |
| Serverless | On-demand compute per query; no persistent cluster | Sporadic, unpredictable workloads |

### Compute Cost Optimization

| Strategy | Mechanism | Savings |
|:---|:---|:---|
| **Spot/preemptible instances** | Use interruptible instances for compaction and batch ETL | 60–80% compute cost reduction |
| **Right-sizing** | Match instance type to workload: memory-optimized for joins, compute-optimized for scans | 20–40% cost reduction |
| **Result caching** | Cache query results at the coordinator; invalidate on new snapshot | Eliminates redundant computation for repeated queries |
| **Manifest caching** | Cache parsed manifests in memory with TTL | Eliminates 50–80% of metadata I/O |
| **Predicate pushdown** | Push filters to storage layer; read only needed columns and row groups | 80–95% I/O reduction for selective queries |

### Ingestion Scaling

| Pattern | Mechanism | Throughput |
|:---|:---|:---|
| Single-writer batch | One Spark/Flink job | 1–10 GB/s depending on cluster size |
| Multi-writer parallel | Multiple jobs writing to disjoint partitions | Linearly scales with writer count |
| Streaming micro-batch | Continuous job with 10–60 s trigger intervals | 100 MB – 1 GB per interval per writer |
| File-group-level concurrency | Writers append to assigned file groups | Avoids commit contention across writers |

### Compaction Scaling

- Compaction is a compute-intensive background operation (read + sort + write).
- Scale by parallelizing across partitions — each partition compacted independently.
- Dedicated compaction cluster prevents resource contention with interactive queries.
- Budget compaction compute at ~20% of total ingestion compute.

## Multi-Engine Access

A core lakehouse promise: the same table is accessible from multiple engines without data duplication.

### How It Works

1. All engines communicate with the **same catalog** via the REST protocol.
2. The catalog returns the current metadata file location and vends temporary credentials scoped to the table's storage prefix.
3. Each engine loads manifests, performs its own planning (Cutting off unnecessary steps, skipping), and reads data files directly from object storage.
4. Engines may use different execution strategies (vectorized columnar, code-generated) but all interpret the same file format and statistics.

### Consistency Guarantees Across Engines

| Scenario | Guarantee |
|:---|:---|
| Engine A reads, Engine B writes concurrently | A sees the snapshot it pinned; B's commit is invisible to A's in-flight query |
| Engine A and B both write | Standard OCC: one commits, the other retries on conflict |
| Engine A compacts, Engine B queries | B continues reading old files until its next query pins the post-compaction snapshot |
| Engine A updates schema, Engine B reads | B sees the new schema on its next metadata refresh; in-flight queries use the pinned schema |

### Challenges

- **Statistics interpretation** — different engines may collect or interpret column statistics slightly differently, leading to suboptimal Cutting off unnecessary steps decisions.
- **Write format variations** — one engine's Parquet writer may use different compression, encoding, or page sizes than another, creating non-uniform file performance.
- **Catalog caching** — engines that aggressively cache metadata may serve stale snapshots; a TTL-based refresh policy balances freshness against catalog load.

## Fault Tolerance

### Single Points of Failure

| Component | Failure Mode | Mitigation |
|:---|:---|:---|
| Catalog service | Unavailable — no new commits, no snapshot resolution | Active-passive replication; read replicas for query planning |
| Object storage | Region outage | Cross-region replication; RPO = replication lag |
| Query engine coordinator | Node crash | Stateless coordinator with automatic restart; query retry |
| Compaction worker | Mid-compaction crash | Orphan files cleaned by vacuum; compaction restarts from scratch |
| Metadata files | Corruption or accidental deletion | Immutable metadata with version chain; restore from parent snapshot |

### Data Recovery Mechanisms

1. **Snapshot rollback** — revert to any previous snapshot by updating the catalog pointer. All data files from that snapshot are still on object storage (within retention period).
2. **Cherry-pick recovery** — selectively apply changes from one snapshot branch to another (WAP workflow).
3. **Orphan file cleanup** — vacuum process identifies files not referenced by any live snapshot and deletes them after a safety retention period (default 3–7 days).

### Failover Mechanisms

**Catalog failover**:
- Active catalog node fails → passive node promoted within 5–15 seconds.
- During failover: reads succeed using cached metadata; writes queue and retry after promotion.
- RTO: < 30 s. RPO: 0 (synchronous replication of catalog state).

**Query engine failover**:
- Worker node fails mid-query → coordinator reassigns that worker's scan splits to surviving workers.
- Coordinator fails → client retries with a new coordinator (stateless).

### Circuit Breaker Pattern

| Circuit | Trigger | Fallback |
|:---|:---|:---|
| Catalog commit | 3 consecutive CAS failures | Backoff with jitter; alert on-call |
| Object storage read | 5 consecutive timeouts on same prefix | Switch to replica region; degrade to cached results |
| Compaction | Compaction job fails 3 times on same partition | Skip partition; alert; manual investigation |
| Metadata refresh | Catalog unreachable for > 60 s | Serve queries from last cached snapshot; warn users of staleness |

### Graceful Degradation

| Severity | Condition | Behavior |
|:---|:---|:---|
| Level 0 — Normal | All systems operational | Full functionality |
| Level 1 — Degraded freshness | Catalog temporarily unreachable | Queries served from cached metadata; writes queued |
| Level 2 — Read-only | Catalog write path down | Queries continue; ingestion paused |
| Level 3 — Reduced scope | Object storage prefix throttled | Queries on unaffected partitions continue; throttled partitions return errors |
| Level 4 — Offline | Object storage region outage | All operations fail; failover to DR region initiated |

## Disaster Recovery

| Metric | Target | Mechanism |
|:---|:---|:---|
| RPO | < 1 hour | Cross-region metadata replication + object storage replication |
| RTO | < 30 minutes | Automated DNS failover + pre-warmed standby catalog |
| Backup frequency | Continuous (metadata); daily (full validation) | Metadata replicated synchronously; data files replicated asynchronously |
| Backup verification | Weekly | Automated restore test to isolated environment |

### Multi-Region Considerations

- **Active-passive**: Single write region; reads served from both. RPO = replication lag (minutes).
- **Active-active**: Both regions accept writes to different table subsets. Requires partition-level region ownership to avoid cross-region conflicts.
- **Metadata conflict resolution**: If both regions accept writes to the same table, snapshot IDs may diverge. Resolution requires a global ordering service or accepting last-writer-wins semantics.

### Cross-Region Replication Strategy

| Layer | Strategy | RPO | Notes |
|:---|:---|:---|:---|
| Catalog metadata | Synchronous to DR (within AZ), async to remote region | 0 (within AZ), minutes (cross-region) | Catalog state is small (< 100 GB) |
| Metadata files (manifests) | Replicated with data files | Minutes | Small files; replicate alongside data |
| Data files (Parquet) | Asynchronous object storage replication | Minutes to hours | Depends on replication lag and data volume |
| Audit logs | Synchronous append to both regions | 0 | Critical for compliance; must not lag |

### Storage Tiering

| Tier | Access Pattern | Storage Class | Cost Ratio | When to Use |
|:---|:---|:---|:---|:---|
| **Hot** | Frequently queried (< 30 days old) | Standard object storage | 1.0x | Active partitions, recent data |
| **Warm** | Occasionally queried (30–90 days) | Infrequent access class | 0.4x | Historical data queried weekly |
| **Cold** | Rarely queried (90+ days) | Archive class | 0.1x | Compliance retention, rare audits |
| **SSD Cache** | Cached hot data for low-latency | Local NVMe SSD | 5x (per GB) | Working set for BI dashboards |

**Tiering automation**: Table properties define lifecycle rules:
```
table.properties:
  lifecycle.hot_to_warm_days: 30
  lifecycle.warm_to_cold_days: 90
  lifecycle.cold_to_archive_days: 365
  lifecycle.delete_after_days: 2555  # 7 years for financial compliance
```

### Object Storage Cost Optimization

| Cost Component | Driver | Optimization |
|:---|:---|:---|
| **Storage** | Total bytes stored | Compaction removes duplicate data; vacuum reclaims expired snapshots |
| **PUT requests** | File writes (ingestion + compaction) | Batch micro-batches; increase target file size |
| **GET requests** | File reads (queries) | Data skipping reduces files read; caching avoids repeated fetches |
| **LIST requests** | Directory enumeration | Lakehouse never uses LIST — zero cost |
| **Data transfer** | Cross-AZ / cross-region reads | Pin compute to same AZ as storage; use regional endpoints |

## Hot-Spot Mitigation

| Hot Spot | Cause | Mitigation |
|:---|:---|:---|
| Single-partition write concentration | Time-partitioned table with all current writes to "today" partition | Add bucketing (hash on secondary key) within the hot partition |
| Catalog commit contention | High-frequency streaming commits to one table | Batch multiple micro-batches; increase commit interval |
| Object storage prefix throttling | All files under same prefix | Distribute files across prefixed paths using hash-based directory layout |
| Popular table metadata | Thousands of concurrent queries loading same manifests | Manifest caching at engine level; CDN-like metadata cache tier |

## Capacity Planning Formulas

### Storage Growth Projection

```
monthly_growth_TB = daily_ingestion_GB × 30 / 1024
retention_overhead = monthly_growth_TB × retention_days / 30
total_storage_TB = current_data_TB + monthly_growth_TB × months + retention_overhead

// Example: 500 TB current, 10 GB/day ingestion, 30-day retention
// monthly_growth = 10 × 30 / 1024 ≈ 0.3 TB/month
// retention_overhead = 0.3 × 30 / 30 = 0.3 TB
// Year 1 projection: 500 + 0.3 × 12 + 0.3 = 504 TB
```

### Metadata Size Projection

```
manifest_size_MB = total_files × 200 bytes / 1024 / 1024
manifest_files = total_files / avg_entries_per_manifest

// Example: 4M files, 1000 entries per manifest
// manifest_size = 4M × 200 / 1M = 800 MB
// manifest_files = 4M / 1000 = 4000 manifest files
```

### Compaction Compute Budget

```
daily_compaction_TB = daily_ingestion_TB × compaction_amplification_factor
// compaction_amplification = 2 (read + write)

compaction_vCPU_hours = daily_compaction_TB × 1024 / throughput_GB_per_vCPU_hour

// Example: 1 TB/day ingestion, 0.5 GB/vCPU-hour throughput
// daily_compaction = 1 × 2 = 2 TB
// compaction_vCPU_hours = 2 × 1024 / 0.5 = 4096 vCPU-hours
```

## Caching Strategy

| Cache Layer | What Is Cached | Location | TTL / Invalidation | Hit Rate Target |
|:---|:---|:---|:---|:---|
| **Catalog metadata cache** | Table → snapshot pointer | Query engine memory | On commit event or 30 s TTL | > 95% |
| **Manifest cache** | Parsed manifest entries | Query engine memory | On new snapshot | > 80% |
| **Data file cache** | Hot Parquet files | Local SSD on query workers | LRU eviction; size-bounded | > 60% |
| **Query result cache** | Result sets of recent queries | Coordinator memory | On new snapshot (table-level) | > 30% (dashboard queries) |
| **Footer cache** | Parquet footers (schema + stats) | Query engine memory | LRU eviction | > 90% |

### Cache Sizing Formulas

```
manifest_cache_GB = active_tables × avg_manifest_size_MB / 1024
data_cache_GB = working_set_fraction × total_data_TB × 1024
footer_cache_MB = active_files × avg_footer_size_KB / 1024

// Example: 50 active tables, 100 MB avg manifest, 10% working set on 500 TB
// manifest_cache = 50 × 100 / 1024 ≈ 5 GB
// data_cache = 0.10 × 500 × 1024 = 51,200 GB (50 TB — requires tiered caching)
// footer_cache = 400K × 10 KB / 1024 = 3.9 GB
```

## Migration Strategy (Hive → Lakehouse)

### Phase 1: In-Place Migration (Metadata Only)

1. Register existing Hive-managed Parquet files with the lakehouse table format.
2. Generate manifest files from Hive metastore partition listings.
3. Assign column IDs based on Hive schema positions.
4. Validate: query results match between Hive and lakehouse engines.
5. **Duration**: Hours to days depending on table count. **Risk**: Low (no data movement).

### Phase 2: Dual-Write (Shadow Mode)

1. Write new data to both Hive and lakehouse simultaneously.
2. Compare query results between old and new paths.
3. Build confidence in lakehouse correctness.
4. **Duration**: 1–4 weeks. **Risk**: Increased write cost (temporary).

### Phase 3: Cutover

1. Stop Hive writes; lakehouse becomes the sole write target.
2. Redirect all read queries to lakehouse engines.
3. Keep Hive data as read-only backup for rollback.
4. **Duration**: 1 day (single cutover event). **Risk**: Medium (requires rollback plan).

### Phase 4: Optimization

1. Run compaction to optimize file sizes and clustering.
2. Apply Z-ordering or Liquid Clustering to high-value tables.
3. Set up snapshot retention and vacuum schedules.
4. Decommission Hive metastore and legacy infrastructure.
5. **Duration**: Weeks to months. **Risk**: Low (lakehouse already serving production).

## Load Testing Strategy

| Scenario | Target | Measurement |
|:---|:---|:---|
| Peak concurrent queries | 200 concurrent analytical queries | p99 latency, error rate |
| Sustained ingestion | 10 GB/s for 24 hours | Commit success rate, lag |
| Commit contention storm | 50 concurrent writers to one table | Retry rate, commit latency |
| Compaction under load | Compaction running during peak query hours | Query latency impact |
| Catalog failover | Kill catalog primary during active workload | Recovery time, commit/query continuity |
| Metadata stress | Query a table with 10M files | Planning time, memory usage |
| Object storage throttle | Simulate rate limiting on hot prefix | Degradation behavior |

## Auto-Scaling Triggers

| Metric | Threshold | Action |
|:---|:---|:---|
| Query queue depth | > 20 pending queries | Scale out query workers |
| Query p99 latency | > 15 s | Scale out query workers |
| Compaction backlog (small files) | > 10 000 files under 10 MB in any partition | Spawn additional compaction workers |
| Ingestion lag | > 5 minutes behind source | Scale out ingestion workers |
| Memory pressure | > 85% used on any query worker | Scale up (larger instances) or scale out |
| Manifest cache miss rate | > 40% for 15 min | Increase cache allocation or add memory |
| Catalog request latency | > 500 ms for 5 min | Scale out catalog read replicas |

## Real-World Scaling Patterns

### Pattern 1: Netflix — Exabyte-Scale Metadata Management

Netflix manages one of the world's largest Iceberg deployments:

- **Challenge**: Tables with hundreds of millions of files; manifest loading alone can take minutes.
- **Solution**: Multi-tier manifest caching — L1 (in-memory, per-engine), L2 (distributed cache, shared across engines), L3 (local SSD). Combined hit rate > 98%.
- **Catalog optimization**: Custom catalog built on a proprietary metadata service with sub-100ms resolution. Commit serialization handled via optimistic locking with automatic rebase for non-conflicting changes.
- **Compaction-as-a-service**: Dedicated auto-scaling cluster that monitors all tables' health scores and prioritizes compaction by read frequency × small-file debt.
- **Result**: Maintained < 5 s query planning time for tables with 100M+ files.

### Pattern 2: Uber — Streaming Lakehouse at 150+ PB

Uber operates a massive Hudi-based lakehouse:

- **Challenge**: Thousands of CDC streams producing millions of small files daily across hundreds of thousands of tables.
- **Solution**: Inline compaction within the ingestion job — each writer compacts its own file group during the write cycle, bounding small-file debt at ingestion time.
- **Timeline-based metadata**: Hudi's timeline (commit log on object storage) provides self-describing metadata without external catalog dependency. Each commit is an Avro file containing the operation, files affected, and statistics.
- **Multi-modal access**: Same tables serve real-time dashboards (Presto, < 5 s latency) and batch ETL (Spark, hour-long jobs). Snapshot isolation ensures both workloads see consistent data.
- **Result**: End-to-end CDC latency < 60 s; compaction keeps read amplification below 1.5x.

### Pattern 3: Airbnb — Multi-Format Interoperability

Airbnb's data platform demonstrates format convergence:

- **Challenge**: Historical Delta Lake investment for Spark workloads, but growing demand for Trino/Presto access requiring Iceberg.
- **Solution**: Metadata translation layer generates Iceberg metadata alongside Delta logs — same physical Parquet files, dual metadata paths.
- **Catalog unification**: Single catalog service fronting both Delta and Iceberg metadata, providing unified governance and access control.
- **Result**: Zero data duplication; all engines read the same files; governance enforced centrally.

## Degradation Priority Matrix

| Priority | Component | Degradation Behavior | Recovery Signal |
|:---|:---|:---|:---|
| 1 (Protect) | Data durability (object storage) | Never degraded; cross-AZ replication always active | N/A |
| 2 (Protect) | Catalog availability | Failover within 30 s; reads from cache during failover | Catalog health check passes |
| 3 (Degrade last) | Query execution | Serve queries from cached metadata if catalog slow | Catalog latency < 500 ms |
| 4 (Degrade early) | Streaming ingestion | Increase batch interval from 30 s to 120 s under load | Commit contention rate < 10% |
| 5 (Degrade early) | Compaction | Pause compaction during resource contention | CPU utilization < 80% |
| 6 (Sacrifice) | Snapshot retention | Reduce retention from 7 days to 3 days under storage pressure | Storage utilization < 85% |
| 7 (Sacrifice) | Statistics collection | Skip bloom filter generation under write pressure | Write latency < target |

## Streaming Lakehouse Patterns

### Micro-Batch vs. Continuous Processing

| Dimension | Micro-Batch (Every 10–60 s) | Continuous (Row-by-Row) |
|:---|:---|:---|
| **Commit frequency** | 1–6 commits/min per table | Commit per row or small buffer |
| **File size** | 10–100 MB per commit | < 1 MB per commit |
| **Small-file problem** | Moderate (manageable with compaction) | Severe (requires inline compaction) |
| **Latency** | 10–60 s end-to-end | Sub-second |
| **Catalog contention** | Low (few commits/min) | High (hundreds of commits/min) |
| **Exactly-once semantics** | Via idempotent commit + checkpoint | Via write-ahead log + checkpoint |
| **Best for** | Most analytical workloads | Real-time dashboards, alerting |

### Late Data Handling

```
FUNCTION handle_late_data(event, table):
    event_time = event.timestamp
    current_watermark = table.current_watermark

    IF event_time < current_watermark - max_allowed_lateness:
        // Too late — route to dead-letter queue
        SEND_TO_DLQ(event, reason="exceeded_max_lateness")
        RETURN

    IF event_time < current_watermark:
        // Late but within tolerance — write to the correct historical partition
        target_partition = compute_partition(event_time, table.partition_spec)
        write_to_partition(event, target_partition)
        // Note: this creates a small file in a historical partition
        // Compaction will merge it later
    ELSE:
        // On-time — write to current partition buffer
        write_to_buffer(event)
```

### Exactly-Once Commit Protocol

```
FUNCTION streaming_commit_exactly_once(writer, batch, source_offset):
    idempotency_key = hash(writer.id, source_offset)

    // Check if this batch was already committed (idempotent retry)
    existing = catalog.lookup_idempotency_key(table, idempotency_key)
    IF existing IS NOT null:
        RETURN existing.snapshot  // already committed; return existing result

    // Proceed with normal commit
    files = write_data_files(batch)
    snapshot = commit_with_idempotency(
        table, files,
        idempotency_key=idempotency_key,
        checkpoint=source_offset
    )

    RETURN snapshot
```

## Table Partitioning Strategy Guide

| Data Characteristic | Recommended Partition Strategy | Rationale |
|:---|:---|:---|
| Time-series (events, logs) | `day(event_time)` | Natural time-bounded queries; good file sizes |
| High-cardinality entity (user_id) | `bucket(256, user_id)` | Bounds partition count; preserves locality |
| Geographic (region, country) | `identity(region)` | Low cardinality; clean partition boundaries |
| Time + entity | `day(event_time), bucket(32, user_id)` | Balances scan Cutting off unnecessary steps with file sizes |
| Low-volume table (< 100 GB) | Unpartitioned | Partitioning adds overhead without benefit |
| High-churn CDC table | `day(updated_at)` with MoR | Groups updates temporally for efficient compaction |

### Partition Anti-Patterns

| Anti-Pattern | Problem | Better Approach |
|:---|:---|:---|
| `identity(user_id)` (10M users) | 10M partitions, each with tiny files | `bucket(256, user_id)` |
| `hour(event_time)` on low-volume table | 8 760 partitions/year, most nearly empty | `day(event_time)` or `month(event_time)` |
| Compound partition with 3+ columns | Combinatorial explosion of partitions | Partition on 1–2 columns; Z-order the rest |
| Never evolving partitions | Table outgrows initial partitioning | Use hidden partitioning; evolve as needed |

## Concurrent Access Scaling

### Writer Scaling Strategies

| Strategy | Mechanism | Max Writers | Contention Profile |
|:---|:---|:---|:---|
| **Partition-isolated writers** | Each writer owns exclusive partitions | Unlimited | Zero contention (disjoint partitions) |
| **File-group-level concurrency** | Writers assigned to numbered file groups within a partition | 32–128 per partition | Low contention (group-level isolation) |
| **Batched micro-commits** | Writers buffer; coordinator batches into single commit | 1 (coordinator) | Zero contention; higher latency |
| **Optimistic with rebase** | All writers target same table; automatic rebase on conflict | 5–20 per table | Moderate contention; occasional retries |

### Read Scaling Strategies

| Strategy | Mechanism | Benefit |
|:---|:---|:---|
| **Manifest caching** | Cache parsed manifests in engine memory | Eliminates repeated metadata I/O |
| **Data file caching** | Cache hot Parquet files on local SSD | Eliminates repeated object storage fetches |
| **Query result caching** | Cache results at coordinator level | Eliminates repeated computation for dashboard queries |
| **Read replicas** | Catalog read replicas in each AZ | Reduces catalog latency; distributes metadata load |
| **Scan parallelism** | Each worker scans a subset of surviving files | Linear throughput scaling with worker count |

## Operational Maturity Model

| Level | Capability | Description |
|:---|:---|:---|
| **L1: Basic** | Manual compaction, manual vacuum, no monitoring | Tables degrade over time; operators react to complaints |
| **L2: Scheduled** | Cron-based compaction, snapshot expiration schedules | Predictable maintenance; may over/under-compact |
| **L3: Adaptive** | Health-score-driven compaction, automated vacuum, alerting | System self-optimizes based on table health metrics |
| **L4: Intelligent** | ML-based compaction scheduling, predictive alerting, auto-partitioning | System anticipates problems; adapts to workload changes |
| **L5: Autonomous** | Self-tuning tables with zero operator intervention | Tables automatically optimize clustering, compaction, retention, and partitioning |

### Cost Attribution Model

| Cost Category | Attribution Method | Charged To |
|:---|:---|:---|
| **Storage (data files)** | `table_size_GB × cost_per_GB` | Table owner / data product team |
| **Storage (snapshots)** | `retained_snapshot_bytes × cost_per_GB` | Table owner (incentivizes retention optimization) |
| **Compute (queries)** | `bytes_scanned × cost_per_GB_scanned` | Querying team / user |
| **Compute (ingestion)** | `bytes_written × cost_per_GB_written` | Ingestion pipeline owner |
| **Compute (compaction)** | `bytes_rewritten × cost_per_GB_written` | Table owner (maintenance cost) |
| **API requests** | `request_count × cost_per_request` | Engine / client making requests |

**Incentive alignment**: Charging query teams for bytes scanned incentivizes them to write selective queries. Charging table owners for compaction incentivizes them to optimize ingestion patterns. Charging for snapshot retention incentivizes appropriate retention policies.

## Data Quality Integration

### Quality Gates in the Write Path

| Gate | Check | Action on Failure |
|:---|:---|:---|
| **Schema validation** | New data matches table schema (types, nullability) | Reject commit |
| **Row count sanity** | Row count within expected range (± 3σ of historical) | Warn; escalate if > 10σ deviation |
| **Null rate check** | Critical columns' null rate below threshold | Reject or route to quarantine table |
| **Duplicate detection** | Primary key uniqueness within batch | Deduplicate or reject |
| **Freshness validation** | Event timestamps within expected range | Flag anomaly; may indicate clock skew |
| **Value range check** | Numeric columns within expected bounds | Quarantine out-of-range records |

### Write-Audit-Publish Integration

For tables with strict quality requirements, ingestion follows the WAP pattern:

1. **Write** to a staging branch
2. **Audit** via quality gate checks (schema, row count, null rate, freshness)
3. **Publish** to main branch only if all gates pass
4. **Quarantine** rejected batches to a separate table for investigation
