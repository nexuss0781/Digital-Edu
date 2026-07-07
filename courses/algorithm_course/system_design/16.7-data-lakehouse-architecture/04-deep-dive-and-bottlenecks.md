# Deep Dive & Bottlenecks — Data Lakehouse Architecture

## Critical Component 1: The Small-File Problem

### Why It Is Critical

Streaming ingestion, CDC pipelines, and concurrent writers continuously create small files (often < 1 MB). A table with 1 million 1 MB files instead of 4 000 × 256 MB files incurs:

- **250x more metadata** — 1 M manifest entries instead of 4 K.
- **250x more file-open overhead** — each file requires a separate HTTP GET, Parquet footer parse, and schema validation.
- **Ballooning query planning** — the optimizer must evaluate statistics for 1 M entries before executing a single scan.
- **Object storage rate limiting** — high request counts risk per-prefix throttling (typically 5 500 GET/s per prefix).

### How It Works

Small files accumulate because each micro-batch commit (every 1–60 seconds) writes at least one file per partition per writer. With 10 partitions and 30-second batches, a single writer creates 28 800 files/day; 5 concurrent writers produce 144 000 files/day.

### Failure Modes

| Failure Mode | Trigger | Impact |
|:---|:---|:---|
| Metadata explosion | Manifest file size exceeds memory of query planner | Query planning takes minutes or OOMs |
| Scan amplification | Each file scanned has < 1 MB useful data | Latency dominated by I/O setup, not data transfer |
| Compaction backlog | Compaction throughput < file creation rate | Debt grows unbounded; reads degrade progressively |
| Object store throttling | File listing / GET requests exceed rate limits | Both queries and ingestion throttled |

### Mitigations

1. **Scheduled compaction** — run bin-packing every 1–4 hours targeting 128–256 MB output files. Prioritize partitions with the most small files.
2. **Inline compaction** (Hudi-style) — compact a file group during the ingestion cycle itself, bounding small-file debt at ingestion time.
3. **Write-side buffering** — buffer micro-batches in memory or a local write-ahead log; flush to object storage only when buffer reaches target file size.
4. **Partition bucketing** — pre-assign rows to a fixed number of buckets per partition, concentrating writes into fewer files.
5. **Monitoring** — alert when any partition exceeds a configurable small-file-count threshold (e.g., > 1 000 files under 10 MB).

### Small-File Cost Quantification

| Metric | 4 000 × 256 MB files (optimized) | 1 M × 1 MB files (degraded) | Impact Factor |
|:---|:---|:---|:---|
| Manifest size | 800 KB | 200 MB | 250× metadata |
| Planning time | 0.2 s | 30 s | 150× slower planning |
| File-open overhead | 4 000 × 30 ms = 120 s parallel | 1 M × 30 ms = throttled | I/O-bound on file setup |
| Object storage GET requests per scan | 4 000 | 1 000 000 | 250× API cost |
| Compaction cost to fix | — | Read 1 TB + Write 1 TB | 2 TB I/O to remediate |

### Write-Side Buffering Architecture

```
FUNCTION buffered_write(event_stream, target_file_size=128MB):
    partitioned_buffers = {}  // partition_value → buffer

    FOR EACH event IN event_stream:
        partition = compute_partition(event)
        IF partition NOT IN partitioned_buffers:
            partitioned_buffers[partition] = Buffer(max_size=target_file_size)

        buffer = partitioned_buffers[partition]
        buffer.append(event)

        IF buffer.size >= target_file_size:
            // Flush: write single optimally-sized file
            file = write_parquet(buffer.data)
            pending_files.APPEND(file)
            buffer.clear()

        IF time_since_last_commit >= max_commit_interval:
            // Time-triggered flush: commit whatever is buffered
            FOR EACH (part, buf) IN partitioned_buffers:
                IF buf.size > 0:
                    file = write_parquet(buf.data)
                    pending_files.APPEND(file)
                    buf.clear()
            commit(pending_files)
            pending_files.clear()
```

**Trade-off**: Buffering reduces small files but increases the latency between event arrival and query visibility (bounded by `max_commit_interval`). A buffer crash loses uncommitted events, requiring replay from the source checkpoint.

---

## Critical Component 2: Metadata Scalability

### Why It Is Critical

The metadata hierarchy (snapshots → manifest lists → manifests → file entries) is the single mechanism that makes ACID, time travel, and data skipping work. If metadata access becomes slow, every operation — query planning, commits, compaction — degrades.

### How It Works

A mature table accumulates metadata at every layer:

| Layer | Growth Driver | Typical Scale |
|:---|:---|:---|
| Snapshots | Every commit (append, overwrite, compact) | 10 K – 100 K snapshots over years |
| Manifest lists | One per snapshot | Equal to snapshot count |
| Manifests | One per writer per partition per commit | Millions for high-throughput tables |
| File entries | One per data file + one per delete file | Billions for petabyte-scale tables |

Loading the full manifest set for a table with 1 billion file entries requires reading gigabytes of Avro, which is infeasible on every query.

### Failure Modes

| Failure Mode | Trigger | Impact |
|:---|:---|:---|
| Cold-start latency | First query on a table loads full manifest tree | Minutes-long planning phase |
| Manifest fan-out | Thousands of manifests per snapshot | Parallel manifest reads saturate network |
| Snapshot accumulation | No expiration policy | Metadata storage exceeds data storage for small-file tables |
| Catalog contention | High commit rate on a single table | CAS retries grow; commit latency increases non-linearly |

### Mitigations

1. **Manifest merging** — periodically rewrite many small manifests into fewer large ones (analogous to data compaction but for metadata).
2. **Manifest caching** — query engines cache parsed manifest files in memory; invalidate on new snapshot.
3. **Lazy manifest loading** — load manifest summaries first (partition bounds, file counts); load full file entries only for surviving manifests after Cutting off unnecessary steps.
4. **Snapshot expiration** — expire snapshots beyond retention (e.g., 7 days), then delete orphaned manifests and data files.
5. **Partition-level manifest grouping** — one manifest per partition rather than per-writer, reducing fan-out.
6. **Metadata-tier SSD cache** — store hot manifests on local SSD for sub-millisecond access.

### Metadata Scalability at Extreme Scale

| Table Scale | Files | Manifest Entries | Manifest Files | Planning Strategy |
|:---|:---|:---|:---|:---|
| 1 TB | 4 K | 4 K | 4–10 | Direct load; no optimization needed |
| 100 TB | 400 K | 400 K | 400–1 000 | Partition Cutting off unnecessary steps eliminates 90%+; caching sufficient |
| 1 PB | 4 M | 4 M | 4 000–10 000 | Lazy loading mandatory; manifest merging monthly |
| 10 PB | 40 M | 40 M | 40 000–100 000 | Hierarchical caching; partition-level manifest grouping; statistics tier |
| 100 PB | 400 M | 400 M | 400 000+ | Custom metadata service; sharded manifest storage; dedicated planning cluster |

### Catalog Scalability Patterns

| Pattern | Mechanism | Throughput |
|:---|:---|:---|
| **Single catalog, read replicas** | Primary handles writes; replicas serve metadata reads | 100 commits/min; 10 000 reads/s |
| **Partitioned catalog** | Namespace-level sharding across catalog instances | 1 000 commits/min across shards |
| **Hierarchical catalog** | Global catalog for routing; regional catalogs for tables | Multi-region with < 100 ms resolution |
| **Catalog-as-database (DuckLake)** | SQL database stores all metadata; multi-table atomicity native | Limited by database transaction throughput |

---

## Critical Component 3: Merge-on-Read vs. Copy-on-Write

### Why It Is Critical

The choice between MoR and CoW determines the write amplification / read overhead trade-off that defines a table's performance profile.

### Copy-on-Write (CoW)

- On update or delete, the **entire Parquet file** containing affected rows is rewritten.
- Read path: simple columnar scan — no merge logic.
- Write amplification: if one row in a 256 MB file changes, the entire 256 MB is rewritten.
- Best for: infrequent updates, read-heavy BI workloads.

### Merge-on-Read (MoR)

- On update or delete, a **small delete file** (position deletes or equality deletes) or **log file** is written.
- Read path: the engine reads the base file, reads the delete/log files, and applies them at scan time.
- Write amplification: minimal — only the delta is written.
- Read amplification: grows with accumulating delete files until compaction rewrites the base.

### Performance Comparison

| Metric | CoW | MoR (fresh compaction) | MoR (stale compaction) |
|:---|:---|:---|:---|
| Write latency (single row update) | High (rewrite full file) | Low (append delete entry) | Low |
| Read latency (full scan) | Baseline | ~1.1x baseline | ~2.3x baseline |
| Storage efficiency | Lower (temporary duplication) | Higher | Higher (but delete files accumulate) |
| Compaction frequency needed | None | Moderate (daily) | Urgent |
| Implementation complexity | Low | Medium | Medium |

### Failure Modes

| Failure Mode | Trigger | Impact |
|:---|:---|:---|
| Write amplification storm (CoW) | CDC ingestion updates 10 K rows spread across 5 K files | 5 K files rewritten per commit |
| Delete file accumulation (MoR) | Compaction falls behind ingestion | Read latency degrades proportionally |
| Position-delete fan-out (MoR) | Deletes spanning many base files | Each base file read requires checking multiple delete files |
| Compaction conflict (MoR) | Compaction and ingestion both modify the same file group | One must retry, increasing commit latency |

### Deletion Vectors: The Middle Ground

Deletion vectors offer a hybrid approach between CoW and MoR:

| Aspect | CoW | MoR (Delete Files) | Deletion Vectors |
|:---|:---|:---|:---|
| Delete mechanism | Rewrite entire file | Separate delete file | Inline bitmap in manifest |
| Write amplification | O(file_size) | O(deleted_rows) | O(deleted_rows / 8) |
| Read overhead | None | Load + merge delete files | Check bitmap per row (O(1)) |
| File I/O on delete | 1 full file read + write | 1 small file write | Manifest update only |
| Break-even point | < 0.1% rows deleted per file | > 1% rows deleted per file | 0.1% – 10% deleted per file |
| Compaction urgency | None | High | Low (bitmap is cheap to apply) |

Deletion vectors eliminate the need for separate delete files in most scenarios, reducing both write cost and read-time merge complexity. They are particularly effective for CDC workloads where individual rows are updated frequently.

### Decision Framework

```
IF update_frequency < 0.1% of table per day AND read_latency_critical:
    USE CoW
ELSE IF update_frequency > 5% of table per day OR streaming_CDC:
    USE MoR with deletion vectors + scheduled compaction
ELSE IF updates are single-row (GDPR erasure, corrections):
    USE deletion vectors without compaction
ELSE:
    USE MoR with relaxed compaction schedule
```

---

## Critical Component 5: Statistics and Data Skipping Effectiveness

### Why It Is Critical

Data skipping is the primary mechanism that transforms a "scan everything" system into a high-performance query engine. The quality and completeness of per-file statistics directly determine how many files a query reads — and therefore its latency and cost.

### Statistics Hierarchy

| Level | Statistics Type | Storage Location | Cutting off unnecessary steps Granularity |
|:---|:---|:---|:---|
| **Manifest list** | Partition value bounds per manifest | Manifest list Avro file | Entire manifest (thousands of files) |
| **Manifest entry** | Per-file min/max, null count, value count per column | Manifest Avro file | Individual file (128–256 MB) |
| **Parquet footer** | Per-row-group min/max, null count, distinct count | Parquet file footer | Row group (64–256 MB uncompressed) |
| **Puffin sidecar** | NDV sketches, bloom filters, histograms | Separate Puffin file | Per-file or per-partition |

### Effectiveness by Query Pattern

| Query Pattern | Min/Max Stats | Bloom Filter | NDV Sketch | Example |
|:---|:---|:---|:---|:---|
| Range filter on sort key | **95–99% skip** | N/A | N/A | `WHERE ts > '2025-03-01'` on time-sorted data |
| Point lookup on high-cardinality column | **0–5% skip** | **90–99% skip** | N/A | `WHERE user_id = 'abc123'` |
| Range filter on unsorted column | **30–70% skip** | N/A | N/A | `WHERE amount > 1000` (depends on distribution) |
| Join cardinality estimation | N/A | N/A | **Accurate NDV** | `SELECT ... JOIN orders ON user_id` |
| Multi-column predicate (Z-ordered) | **70–95% skip** | N/A | N/A | `WHERE region = 'US' AND ts > '2025-03-01'` |
| Multi-column predicate (unsorted) | **5–30% skip** | N/A | N/A | `WHERE region = 'US' AND amount > 1000` |

### The Cold-Start Problem

A newly ingested table has no clustering — files contain random distributions of values, and min/max statistics span the full value range. Data skipping is ineffective until either:

1. **Compaction with sorting** rewrites files with tighter value ranges.
2. **Z-ordering or Liquid Clustering** organizes data across multiple dimensions.
3. **Natural time-ordering** provides clustering on time columns (most common).

**Quantified impact**: A 1 TB table with random distribution skips ~10% of files with min/max stats. After Z-ordering on the 2 most-filtered columns, the same table skips ~90% of files — a 9x reduction in I/O.

---

## Critical Component 6: Cross-Engine Consistency

### Why It Is Critical

The lakehouse promise of multi-engine access creates subtle consistency challenges when different engines read from and write to the same tables simultaneously.

### Engine Behavior Divergence

| Behavior | Engine A (e.g., Spark) | Engine B (e.g., Trino) | Impact |
|:---|:---|:---|:---|
| Metadata cache TTL | 30 s | 5 min | Engine B sees stale data for up to 5 min after commit |
| Statistics interpretation | Reads all manifest columns | Reads only projected columns | Different Cutting off unnecessary steps decisions → different performance |
| Parquet writer settings | ZSTD, page size 1 MB | SNAPPY, page size 8 KB | Non-uniform file performance characteristics |
| Delete file handling | Supports position + equality deletes | Supports position deletes only | Engine B cannot read tables with equality deletes |
| Null handling | Three-valued logic | Two-valued (NULL = false) | Predicate pushdown differences → different result sets |

### Mitigation Strategies

1. **Catalog-enforced write format** — the catalog specifies required Parquet writer settings (compression, page size, encoding) and rejects commits from files that don't comply.
2. **Engine compatibility matrix** — maintain a table property recording which engines are authorized writers, preventing incompatible file formats.
3. **Metadata cache invalidation** — commit events pushed to engines via webhook or polling, reducing stale-cache window from minutes to seconds.
4. **Feature gates** — table properties control which features are enabled (e.g., disable equality deletes if any consuming engine cannot handle them).

---

## Critical Component 4: Partition Evolution

### Why It Is Critical

Traditional Hive-style partitioning locks the physical layout at table creation. If the initial partition granularity is wrong — too coarse (slow scans) or too fine (small-file explosion) — the only fix is a full table rewrite. Partition evolution changes layout as metadata-only operations.

### How It Works

Each partition spec is assigned a monotonically increasing `spec_id`. Manifests record the `spec_id` under which their file entries were written. The query engine maintains a mapping from each `spec_id` to its transform function.

**Query planning across mixed specs**:

```
FUNCTION resolve_predicate_across_specs(predicate, manifest_list):
    surviving = []
    FOR EACH manifest_ref IN manifest_list.entries:
        spec = load_spec(manifest_ref.spec_id)
        transformed_predicate = apply_transform(predicate, spec)
        IF partition_range_overlaps(manifest_ref.bounds, transformed_predicate):
            surviving.APPEND(manifest_ref)
    RETURN surviving
```

### Common Evolution Scenarios

| Scenario | Before | After | Motivation |
|:---|:---|:---|:---|
| Granularity refinement | `month(ts)` | `day(ts)` | Table grew; monthly partitions too large |
| Granularity coarsening | `hour(ts)` | `day(ts)` | Over-partitioning caused small-file explosion |
| Adding a dimension | `day(ts)` | `day(ts), bucket(16, user_id)` | Hot partition on popular days |
| Removing a dimension | `day(ts), region` | `day(ts)` | Region was deprecated |

### Failure Modes

| Failure Mode | Trigger | Impact |
|:---|:---|:---|
| Mixed-spec planning overhead | Many spec generations (> 10) | Planner must evaluate each spec's transform per manifest |
| Stale partition stats | Old manifests have coarse-grained bounds | Reduced Cutting off unnecessary steps effectiveness on historical data |
| Rewrite temptation | Operators rewrite old data to new spec unnecessarily | Wastes compute and creates compaction debt |

### Mitigation

- Keep spec evolution to < 5 generations before consolidating old data.
- Use compaction to opportunistically rewrite old partitions to the current spec.
- Monitor data-skipping effectiveness per partition spec to decide when consolidation is worthwhile.

---

## Concurrency & Race Conditions

### Race Condition 1: Concurrent Writers to the Same Table

**Scenario**: Writer A and Writer B both read snapshot S42, prepare changes, and attempt to commit S43.

**Consequence**: One writer's CAS succeeds; the other fails and must retry.

**Resolution**: The losing writer reloads the latest snapshot, checks for conflicts (overlapping file deletes or schema incompatibility), and if no conflict exists, rebases its commit on the new snapshot. Non-overlapping partition appends are always rebaseable.

### Race Condition 2: Compaction vs. Ingestion

**Scenario**: Compaction reads files F1, F2, F3 to produce F4. Simultaneously, ingestion deletes rows from F2 (MoR: adds a delete file D1 referencing F2).

**Consequence**: If compaction commits first, F1–F3 are replaced by F4 (which includes the now-deleted rows). D1 references a file that no longer exists in the new snapshot.

**Resolution**: Compaction's commit fails because F2 was concurrently modified. Compaction retries, now reading the updated file set. Alternatively, compaction uses conflict-resolution rules that allow the delete to be rebased onto the compacted file.

### Race Condition 3: Schema Evolution During Active Writes

**Scenario**: A schema change (add column) is committed between the time a writer reads the schema and commits its files.

**Consequence**: The writer's files lack the new column. The commit may succeed if the table format treats missing columns as null.

**Resolution**: Most formats allow additive schema changes (new nullable columns) to coexist with files written under the old schema. Files written before the column addition simply return null for the new column. Incompatible changes (type narrowing, removing a required column) are rejected.

## Locking & Conflict Strategy

| Operation | Lock Type | Scope | Conflict Window |
|:---|:---|:---|:---|
| Append new files | None (optimistic) | Per-partition | At commit CAS only |
| Delete / update rows (CoW) | None (optimistic) | Per-file (rewrite) | At commit — fails if same file modified |
| Delete / update rows (MoR) | None (optimistic) | Per-file (delete file reference) | At commit — delete file references checked |
| Compaction | Advisory (optional) | Per-partition | At commit — fails if source files modified |
| Schema evolution | Table-level metadata CAS | Whole table | At commit — only one schema change per snapshot |

## Additional Race Conditions

### Race Condition 4: Vacuum vs. Time-Travel Query

**Scenario**: User issues a time-travel query `SELECT * FROM table AT snapshot S30` while vacuum is concurrently expiring snapshots older than S35.

**Consequence**: Vacuum deletes data files referenced only by snapshots S28–S34. The time-travel query to S30 now encounters `FileNotFoundException` for files that have been physically removed.

**Resolution**: Vacuum must respect a safety retention period (default 3–7 days). Additionally, named tags and branches protect specific snapshots from expiration regardless of the retention policy.

### Race Condition 5: Partition Evolution During Active Ingestion

**Scenario**: A DDL command evolves the partition spec from `month(ts)` to `day(ts)` while multiple streaming writers are mid-commit with files partitioned under the old monthly spec.

**Consequence**: Writers that started before the evolution commit files under `spec_id = N`, but the table's default spec is now `spec_id = N+1`. The manifest entries carry the correct `spec_id`, so reads are correct. But if any writer reloads metadata mid-commit, it may write some files under the old spec and some under the new, within the same commit.

**Resolution**: Partition evolution commits as a metadata-only snapshot. Writers that started before the evolution commit their files under the old spec (metadata correctly records `spec_id` per manifest). The query engine handles mixed specs transparently.

## Edge Cases

### Edge Case (Unusual or extreme situation) 1: Single-File Table with Billions of Rows

A table loaded as a single massive Parquet file (e.g., 500 GB) has no partition Cutting off unnecessary steps, no file-level data skipping (only one file), and no parallelism (only one scan split). This "accidental monolith" forces full-table scans for every query.

**Mitigation**: Re-ingest with appropriate partitioning, or run a sort + compaction targeting 256 MB file size (produces ~2 000 files from a 500 GB input).

### Edge Case (Unusual or extreme situation) 2: High-Cardinality Partition Key

Partitioning by `user_id` (10 million distinct users) creates 10 million partitions, each with tiny files. The manifest list balloons to millions of entries; partition Cutting off unnecessary steps must evaluate all of them.

**Mitigation**: Use bucketing (`bucket(256, user_id)`) instead of identity partitioning. This bounds partitions to 256 while preserving data locality for user-level queries.

### Edge Case (Unusual or extreme situation) 3: Schema Divergence After Format Migration

When migrating from Hive-managed Parquet to a lakehouse format, historical files may lack column IDs. The migration process must assign stable IDs to existing columns and record the mapping. Files written pre-migration carry position-based column mapping; post-migration files use ID-based mapping. The query engine must detect the format generation and apply the correct mapping strategy.

## Real-World Case Studies

### Case Study 1: Apple — Iceberg at Multi-Exabyte Scale

Apple runs one of the world's largest Iceberg deployments:

- **Multi-exabyte data** managed across thousands of tables in production.
- **Hundreds of petabytes per day** of data processing throughput.
- Key challenge: **manifest scalability** — tables with billions of files require hierarchical manifest caching with LRU eviction and pre-warming on high-priority query paths.
- Custom metadata compaction service rewrites manifests every 2 hours to bound fan-out below 1 000 manifests per table.
- Partition evolution used extensively: tables start broad (monthly) and progressively narrow (weekly → daily) as query patterns stabilize.

### Case Study 2: LinkedIn — Lakehouse for ML Feature Store

LinkedIn uses a lakehouse architecture to serve ML feature engineering:

- **Hundreds of PB** of feature data stored in open table format.
- **Incremental processing** is critical — feature pipelines process only changed rows since the last snapshot, reducing compute costs by 80% compared to full reprocessing.
- **Time-travel for reproducibility** — ML experiments pin specific snapshot IDs to ensure training data is identical across experiment iterations.
- Custom compaction scheduler prioritizes tables by "read frequency × small-file count" — heavily queried tables with many small files get compacted first.

### Case Study 3: Stripe — CDC-to-Lakehouse Pipeline

Stripe's data platform uses CDC → lakehouse for real-time analytics on payment data:

- **CDC from PostgreSQL** → stream processor → lakehouse tables with MoR strategy.
- **End-to-end latency**: events visible in analytical queries within 60 seconds of database commit.
- **Compaction challenge**: payment tables with frequent updates (status changes) accumulate delete files rapidly. Stripe runs compaction every 30 minutes on hot tables to maintain read performance.
- **Partition strategy**: `day(created_at)` with `bucket(64, merchant_id)` to balance scan performance and file sizes.
- **GDPR compliance**: right-to-erasure requests processed via deletion vectors, with compaction forced within 72 hours to physically remove data.

## Compaction Strategy Deep Dive

### Compaction Approaches Compared

| Approach | Description | Best For | Write Amplification |
|:---|:---|:---|:---|
| **Bin-packing** | Merge small files into target-size files; preserve sort order | Small-file cleanup after streaming ingestion | 1× (read + write once) |
| **Sort-based** | Read all files, sort by specified columns, write new files | Improving data skipping on a single sort column | 1× (but reads entire partition) |
| **Z-ordering** | Read all files, sort by Z-value across multiple columns, write | Multi-column data skipping optimization | 1× (reads entire partition; CPU-intensive) |
| **Liquid Clustering** | Incrementally re-cluster only new/degraded files using Hilbert curve | Ongoing optimization with lower cost than Z-ordering | 0.1–0.3× (only re-clusters changed data) |
| **Inline (Hudi)** | Compact within the ingestion job itself | Preventing small-file accumulation at source | Minimal (compacts alongside writes) |

### Compaction Cost-Benefit Analysis

```
FUNCTION should_compact(partition, query_metrics):
    // Cost: I/O to rewrite files
    rewrite_cost = partition.total_bytes × 2  // read + write

    // Benefit: reduced query cost from better file sizes and clustering
    files_before = partition.file_count
    files_after = partition.total_bytes / TARGET_FILE_SIZE
    reduction_factor = files_before / files_after

    // Estimate query savings
    queries_per_day = query_metrics.queries_touching_partition
    bytes_saved_per_query = partition.total_bytes × (1 - 1/reduction_factor) × avg_selectivity
    daily_savings = queries_per_day × bytes_saved_per_query

    // Break-even: when cumulative savings exceed compaction cost
    break_even_days = rewrite_cost / daily_savings

    RETURN break_even_days < MAX_BREAK_EVEN_DAYS  // e.g., 7 days
```

**Example**: A 100 GB partition with 10 000 small files, queried 100 times/day with 10% selectivity:
- Compaction cost: 200 GB I/O
- Savings per query: ~90 GB I/O (skip 9 000 files instead of scanning all)
- Break-even: 200 GB / (100 × 9 GB) = 0.2 days → **compact immediately**

## Slowest part of the process Analysis

| Slowest part of the process | Root Cause | Impact | Mitigation |
|:---|:---|:---|:---|
| Catalog commit serialization | Single CAS per table per commit | High-throughput streaming tables see retry storms | Batch multiple micro-batches into one commit; use file-group-level concurrency |
| Manifest parsing at query time | Large manifest files (> 100 MB) | Query planning latency exceeds execution time | Manifest caching, lazy loading, manifest merging |
| Object storage GET latency | Each file read requires an HTTP round trip (~20–50 ms) | Becomes dominant cost for wide scans with many files | Coalesce reads, prefetch adjacent files, local SSD cache |
| Compaction I/O | Full file rewrite amplifies write volume | Compaction competes with ingestion for I/O bandwidth | Schedule during off-peak; use dedicated compaction compute |
| Delete file fan-out (MoR) | Delete files applied against many base files | O(D × B) merge cost where D = delete files, B = base files | Compact frequently; limit delete file accumulation per file group |
| Statistics staleness | Column stats not updated after schema evolution | Data skipping ineffective for new columns until compaction | Trigger statistics refresh on schema change |
| Cross-engine write divergence | Different engines produce different Parquet settings | Non-uniform file performance; some engines cannot read others' files | Catalog-enforced write format requirements |

## Quality Score and Table Health

### Composite Health Score

A table's health score (0–100) combines multiple dimensions into a single actionable metric:

```
FUNCTION compute_table_health(table):
    // Dimension 1: File size distribution (0–25)
    small_file_ratio = count(files < 10 MB) / total_files
    file_size_score = 25 × (1 - small_file_ratio)

    // Dimension 2: Clustering quality (0–25)
    // Measures overlap between files' value ranges
    overlap_ratio = compute_file_overlap(table, clustering_columns)
    clustering_score = 25 × (1 - overlap_ratio)

    // Dimension 3: Delete file accumulation (0–25)
    delete_ratio = delete_files / data_files
    delete_score = 25 × max(0, 1 - delete_ratio / 0.5)
    // Score drops to 0 when delete files reach 50% of data files

    // Dimension 4: Metadata overhead (0–25)
    metadata_ratio = manifest_size / data_size
    metadata_score = 25 × max(0, 1 - metadata_ratio / 0.05)
    // Score drops to 0 when metadata exceeds 5% of data

    RETURN file_size_score + clustering_score + delete_score + metadata_score
```

### Automated Optimization Triggers

| Health Score | Classification | Automated Action |
|:---|:---|:---|
| 80–100 | Healthy | No action needed |
| 60–79 | Degraded | Schedule compaction in next maintenance window |
| 40–59 | Poor | Priority compaction; alert data engineering team |
| 20–39 | Critical | Emergency compaction with dedicated resources; pause non-critical ingestion |
| 0–19 | Failing | Immediate intervention required; page on-call; consider snapshot rollback if reads are failing |

### Compaction Scheduling Algorithm

```
FUNCTION schedule_compaction(tables, available_compute_budget):
    // Priority = health_score_deficit × read_frequency × data_size
    priorities = []
    FOR EACH table IN tables:
        deficit = 100 - compute_table_health(table)
        read_freq = table.queries_per_day
        size_factor = log2(table.total_size_GB)
        priority = deficit × read_freq × size_factor
        priorities.APPEND((table, priority))

    priorities.SORT(descending=true)

    // Assign compute budget to highest-priority tables
    remaining_budget = available_compute_budget
    FOR EACH (table, priority) IN priorities:
        estimated_cost = estimate_compaction_cost(table)
        IF estimated_cost <= remaining_budget:
            schedule_compaction_job(table)
            remaining_budget -= estimated_cost
        ELSE:
            BREAK  // budget exhausted
```
