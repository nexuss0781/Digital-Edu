# Requirements & Estimations — Data Lakehouse Architecture

## Assumptions & Constraints

| Assumption | Constraint |
|:---|:---|
| Object storage provides read-after-write consistency for PUT but eventual consistency for LIST | Table format must never rely on directory listings |
| Multiple query engines access the same tables concurrently | Catalog must be the single source of truth for snapshot pointers |
| Data files are immutable once written | Updates/deletes produce new files or delete markers — never modify in place |
| Network bandwidth between compute and object storage is the primary I/O Slowest part of the process | Design must minimize bytes transferred, not disk seeks |
| Table schemas evolve over time (columns added, renamed, dropped) | Historical files must remain readable under any schema version |
| Compaction runs as a background process | Compaction must not block reads or writes; conflict resolution via OCC |
| Data residency regulations may restrict storage regions | Partition-level region tagging must be supported |

## User Personas

| Persona | Access Pattern | Scale | Latency Expectation |
|:---|:---|:---|:---|
| **BI Analyst** | Interactive SQL queries via dashboards | 10–100 GB scans | < 5 s for cached; < 30 s for full scan |
| **Data Engineer** | Batch ingestion, schema evolution, compaction scheduling | TB-scale writes per day | Minutes per pipeline run |
| **ML Engineer** | Feature extraction, time-travel for reproducibility, large scans | Full-table scans, 100s of GB | Minutes acceptable; reproducibility critical |
| **Streaming Pipeline** | CDC micro-batch ingestion, upserts every 10–60 s | 100 MB–1 GB per batch | Commit latency < 5 s |
| **Platform Admin** | Catalog management, access control, capacity planning | Cluster-wide | Operational SLOs met |
| **Governance Officer** | Audit logs, compliance reports, data lineage | Read-only metadata | On-demand; hours acceptable |

## Functional Requirements

### Core (F1 – F8)

| ID | Requirement | Description |
|:---|:---|:---|
| F1 | **ACID Transactions** | Atomic, isolated commits on object storage; concurrent readers see consistent snapshots |
| F2 | **Schema Management** | Define, enforce, and evolve table schemas (add/drop/rename/reorder columns, type promotions) without rewriting data |
| F3 | **Time Travel** | Query any historical snapshot by version number or timestamp |
| F4 | **Data Ingestion** | Support batch loads, micro-batch streaming, and change-data-capture upserts into the same table |
| F5 | **Partition Management** | Create, evolve, and prune partitions; support hidden partitioning that decouples physical layout from user queries |
| F6 | **Data Skipping** | Maintain per-file column statistics (min, max, null count, distinct count) and skip irrelevant files at query time |
| F7 | **Compaction & Optimization** | Merge small files, apply Z-ordering or sort-based clustering, and vacuum expired snapshots |
| F8 | **Multi-Engine Access** | Expose governed tables to heterogeneous query engines through a catalog protocol |

### Extended (E1 – E8)

| ID | Requirement | Description |
|:---|:---|:---|
| E1 | **Incremental Processing** | Process only changes since a given snapshot (change data feed / incremental queries) |
| E2 | **Branching & Tagging** | Create isolated branches for experimentation; tag snapshots for reproducibility |
| E3 | **Row-Level Lineage** | Track provenance of individual rows across ingestion, transformation, and consumption |
| E4 | **Cross-Table Transactions** | Atomically commit changes spanning multiple tables in one catalog operation |
| E5 | **Materialized Views** | Automatically maintained summary tables that refresh incrementally from base lakehouse tables |
| E6 | **Liquid Clustering** | Adaptive, incremental re-clustering that replaces static Z-ordering and explicit partitioning with a unified mechanism |
| E7 | **Format Interoperability** | Read tables written in one format (Delta/Iceberg/Hudi) from engines expecting another via metadata translation layers |
| E8 | **Advanced Statistics** | NDV sketches, histogram statistics, and bloom filters stored in sidecar files for enhanced data skipping |

### Requirement Priority Matrix

| Requirement | MVP | Growth | Enterprise |
|:---|:---:|:---:|:---:|
| F1: ACID Transactions | **Must** | Must | Must |
| F2: Schema Management | **Must** | Must | Must |
| F3: Time Travel | Should | **Must** | Must |
| F4: Data Ingestion (batch) | **Must** | Must | Must |
| F4: Data Ingestion (streaming) | Could | **Must** | Must |
| F5: Partition Management | Should | **Must** | Must |
| F6: Data Skipping | Should | **Must** | Must |
| F7: Compaction | Should | **Must** | Must |
| F8: Multi-Engine Access | Could | Should | **Must** |
| E1: Incremental Processing | — | Should | **Must** |
| E2: Branching & Tagging | — | Could | Should |
| E4: Cross-Table Transactions | — | — | Should |
| E6: Liquid Clustering | — | Could | Should |
| E7: Format Interoperability | — | Could | Should |

### Out of Scope

- Query engine internals (Spark SQL optimizer, Trino cost model)
- ML model training and serving pipelines
- Real-time sub-second event streaming (handled by a dedicated stream processor)
- Data visualization or BI tool design

## Non-Functional Requirements

| Requirement | Target | Rationale |
|:---|:---|:---|
| **Consistency** | Snapshot isolation for readers; serializable for writers | Readers never see partial writes; writer conflicts detected at commit |
| **Availability** | 99.95 % for reads; 99.9 % for writes | Reads served from replicated object storage; writes depend on catalog availability |
| **Durability** | 11 nines (99.999999999 %) | Inherited from replicated object storage |
| **Latency — Interactive Query** | p50 < 3 s, p99 < 15 s for 1 TB scan | Achieved via data skipping, caching, and columnar formats |
| **Latency — Streaming Ingest** | End-to-end < 60 s from event to queryable row | Micro-batch commit interval drives freshness |
| **Throughput** | > 10 GB/s sustained ingest per table | Parallel writers committing to distinct file groups |
| **Scalability** | Petabyte-scale tables with billions of files | Metadata hierarchy must not degrade with file count |

### Consistency Requirements by Operation

| Operation | Consistency Model | Rationale |
|:---|:---|:---|
| Snapshot commit | **Linearizable** | CAS on catalog pointer must be serializable; two writers must not both believe they committed |
| Snapshot read | **Snapshot isolation** | Reader pins a snapshot; all subsequent file reads are against that consistent view |
| Schema evolution | **Serializable** | Only one schema change can succeed per snapshot; concurrent changes must retry |
| Catalog metadata read | **Stale-read tolerant** | Engines may cache metadata for seconds; stale reads are safe (returns slightly older data) |
| Data file write | **Eventual → bypassed** | Object storage write is eventually consistent for LIST, but lakehouse never lists; manifest-tracked paths use read-after-write consistency |
| Cross-table transaction | **Atomic** | Multi-table commits require a single catalog CAS spanning all affected tables |

### CAP Theorem Position

The lakehouse operates as a **CP system** for its metadata layer. The catalog enforces linearizable commits (compare-and-swap or log-append) so that concurrent writers never produce conflicting snapshots. Reads tolerate brief unavailability of the catalog by using cached metadata, trading freshness for availability. The data layer on object storage is eventually consistent for listings but the table format's explicit file tracking bypasses listing, achieving effective strong consistency.

### Failure Tolerance Requirements

| Component | Failure | Tolerance | Recovery |
|:---|:---|:---|:---|
| Catalog primary | Node crash | < 30 s | Automatic failover to passive replica |
| Catalog network | Partition | Reads continue from cache; writes queue | Reconnect and drain queue |
| Object storage | Single-AZ outage | Zero data loss | Cross-AZ replication handles transparently |
| Object storage | Region outage | RPO < 1 hour | Failover to DR region |
| Query engine worker | Node crash | Zero query loss | Coordinator reassigns scan splits |
| Compaction worker | Mid-job crash | No data loss | Orphan files cleaned by vacuum; job restarts |
| Metadata file | Corruption | Rollback to parent snapshot | Snapshot chain provides immutable history |

## Performance Targets

| Operation | Target | Condition |
|:---|:---|:---|
| Point-in-time snapshot read | < 500 ms metadata resolution | Table with 100 K files |
| Full table scan (1 TB Parquet) | < 30 s | 64-node cluster, columnar pushdown |
| Selective query with data skipping | < 3 s | Predicate matches < 1 % of files |
| Batch commit (10 K new files) | < 5 s | Single atomic commit |
| Streaming micro-batch commit | < 2 s per batch | 100 MB per batch |
| Compaction (1 TB partition) | < 15 min | Background, non-blocking reads |
| Schema evolution (add column) | < 1 s | Metadata-only operation |
| Snapshot expiration (vacuum) | < 30 min | 1 M expired files |

## Scaling Tiers

| Tier | Data Volume | Tables | Concurrent Users | Ingestion Rate | Key Challenge |
|:---|:---|:---|:---|:---|:---|
| **Startup** | 1 – 10 TB | 5 – 20 | 10 – 20 | 100 MB/s | Schema design, initial partitioning |
| **Growth** | 10 – 100 TB | 20 – 100 | 50 – 100 | 1 GB/s | Compaction scheduling, query optimization |
| **Enterprise** | 100 TB – 1 PB | 100 – 500 | 200 – 500 | 5 GB/s | Metadata scalability, multi-engine governance |
| **Hyperscale** | 1 – 100 PB | 500 – 5 000 | 1 000+ | 50 GB/s | Catalog sharding, cross-region replication, cost control |

## Capacity Estimation

**Reference deployment**: enterprise analytics platform, 500 TB raw data, 200 concurrent users, 50 tables, mixed BI + ML workload.

### Storage

| Component | Estimate | Basis |
|:---|:---|:---|
| Raw data (Parquet on object storage) | 500 TB | Columnar compression ~4:1 on 2 PB raw |
| Metadata files (manifests, snapshots) | ~5 TB (1 % of data) | Avro manifest overhead scales with file count |
| Snapshot retention (30 days) | ~150 TB additional | Assumes 1 % daily churn, old files retained |
| Total object storage | ~655 TB | Data + metadata + retained snapshots |
| Catalog database | < 100 GB | Table pointers, access-control entries |

### Compute

| Component | Estimate | Basis |
|:---|:---|:---|
| Interactive query cluster | 64 – 256 vCPUs | Auto-scales based on concurrent query load |
| Batch ingestion cluster | 128 vCPUs sustained | 10 GB/s ingest target |
| Streaming ingestion | 32 vCPUs sustained | Micro-batch every 30 s |
| Compaction workers | 64 vCPUs (periodic) | Scheduled during off-peak hours |

### I/O

| Flow | Estimate |
|:---|:---|
| Read throughput (peak) | 50 GB/s aggregate across queries |
| Write throughput (sustained) | 10 GB/s ingestion |
| Metadata reads / s | ~5 000 (manifest fetches across concurrent queries) |
| Catalog commits / min | ~200 (batch + streaming combined) |

### Metadata Size Estimation

| Table Size | Files (256 MB avg) | Manifest Entries (200 B each) | Total Manifest Size | Planning Memory |
|:---|:---|:---|:---|:---|
| 1 TB | 4 000 | 4 K | 800 KB | < 10 MB |
| 10 TB | 40 000 | 40 K | 8 MB | ~50 MB |
| 100 TB | 400 000 | 400 K | 80 MB | ~500 MB |
| 1 PB | 4 000 000 | 4 M | 800 MB | ~4 GB |
| 10 PB | 40 000 000 | 40 M | 8 GB | ~40 GB (requires lazy loading) |

### Latency Budget Breakdown

| Operation | Phase | Budget | Notes |
|:---|:---|:---|:---|
| **Interactive query (p50 < 3 s)** | Catalog resolution | 50 ms | Cached metadata path |
| | Manifest list load | 100 ms | Single Avro file |
| | Partition Cutting off unnecessary steps | 50 ms | In-memory filter on manifest summaries |
| | Manifest file loads | 200 ms | Parallel fetch of surviving manifests |
| | File-level data skipping | 100 ms | Column stats evaluation |
| | Data file reads | 2 000 ms | Parallel columnar scan of surviving files |
| | Result assembly | 100 ms | Aggregation, projection |
| | **Total** | **2 600 ms** | |
| **Streaming commit (< 5 s)** | Data file write | 2 000 ms | Parquet serialization + object storage PUT |
| | Manifest construction | 200 ms | Build manifest entries with statistics |
| | Metadata file write | 500 ms | Write manifest list + snapshot to object storage |
| | Catalog CAS | 100 ms | Atomic pointer swap |
| | **Total** | **2 800 ms** | Excluding retries |
| **Compaction (1 TB partition)** | Manifest load | 500 ms | Read file list for partition |
| | Data read | 5 min | Read all small files from object storage |
| | Sort + merge | 3 min | CPU-bound sort by clustering key |
| | Data write | 4 min | Write optimally-sized output files |
| | Metadata + CAS | 500 ms | Build replacement manifest + commit |
| | **Total** | **~12 min** | Single partition, dedicated worker |

### Object Storage API Cost Estimation

| Operation | Rate | Monthly Volume | Cost Driver |
|:---|:---|:---|:---|
| PUT (writes) | 200/min × 30 days | 8.6 M requests | Ingestion + compaction |
| GET (reads) | 5 000/s peak × 8 hr/day × 30 days | 4.3 B requests | Query file reads |
| HEAD (metadata checks) | 500/s × 8 hr/day × 30 days | 432 M requests | Manifest validation |
| LIST | ~0 | ~0 | Lakehouse never lists directories |
| DELETE (vacuum) | 1 000/hr × 24 hr × 30 days | 720 K requests | Orphan file cleanup |

**Key insight**: GET requests dominate API costs. Every file skipped by data skipping saves both I/O bandwidth and API cost. A 90% skip rate on a table with 4 B monthly GETs saves 3.6 B requests.

## Access Pattern Distribution

| Pattern | Proportion | Characteristics |
|:---|:---|:---|
| Analytical scans (BI dashboards) | 40% | Time-bounded, aggregation-heavy, < 5% of data read per query |
| Ad-hoc exploration | 20% | Unpredictable predicates, variable selectivity |
| ML feature extraction | 15% | Full-table or partition-level scans, high throughput, latency-tolerant |
| Streaming micro-batch commits | 15% | Small, frequent writes (every 10–60 s), high commit rate |
| Batch ETL ingestion | 5% | Large, infrequent writes (hourly/daily), low commit rate |
| Table maintenance (compaction, vacuum) | 5% | Background; competes with other workloads for I/O |

## SLO Summary

| SLO | Target | Measurement |
|:---|:---|:---|
| Query freshness | Data queryable within 60 s of ingestion | End-to-end latency from event timestamp to query visibility |
| Interactive query p99 | < 15 s | Measured at query-engine coordinator |
| Commit success rate | > 99.9 % | Failed commits due to conflict / timeout |
| Compaction lag | < 4 hours | Time since last compaction on any active partition |
| Snapshot availability | 99.95 % uptime | Ability to resolve current snapshot from catalog |
| Data durability | 99.999999999 % | Inherited from object storage replication |
| Data skipping effectiveness | > 70% files skipped | Averaged across all analytical queries |
| Catalog commit latency | p99 < 1 s | Measured at catalog CAS endpoint |

### SLO Error Budget Policy

| SLO | Monthly Budget | Consequence When Exhausted |
|:---|:---|:---|
| Query freshness (60 s) | 22 min total staleness | Freeze non-critical ingestion changes; investigate pipeline |
| Interactive p99 (< 15 s) | 0.1% of queries can exceed | Trigger compaction on worst-performing tables; scale query compute |
| Commit success rate (99.9%) | 43 failed commits | Reduce commit frequency; investigate catalog contention |
| Compaction lag (< 4 hr) | 6 hr max on any partition | Spawn emergency compaction workers; alert data engineering |

## Workload Characterization

### Query Profile Analysis

| Query Class | Frequency | Selectivity | Scan Pattern | Latency Expectation |
|:---|:---|:---|:---|:---|
| Dashboard refresh | 50–100/min | < 1% of data | Time-bounded + aggregation | < 5 s (cached path) |
| Ad-hoc exploration | 10–50/min | 1–10% of data | Unpredictable predicates | < 30 s |
| ML training data extract | 5–20/day | 50–100% of table | Full partition scan | Minutes acceptable |
| Point lookup (by entity ID) | 100–500/min | Single row | Requires bloom filter or index | < 1 s |
| ETL pipeline validation | 10–50/day | Specific partition | Full partition scan + checks | < 60 s |
| Time-travel / audit | 1–10/day | Variable | Historical snapshot access | < 30 s |

### Ingestion Profile Analysis

| Source Type | Volume | Frequency | Format | Write Strategy |
|:---|:---|:---|:---|:---|
| CDC from OLTP DB | 1–10 GB/day | Continuous (10–60 s batches) | Upserts + deletes | MoR with deletion vectors |
| Event stream (Kafka) | 10–100 GB/day | Continuous (10–30 s batches) | Append-only | Append (CoW-equivalent) |
| Batch ETL | 100 GB – 1 TB/run | Hourly or daily | Full partition overwrite | CoW (overwrite) |
| External data loads | Variable | Ad-hoc | Mixed | Append with schema validation |
| ML feature computation | 10–50 GB/run | Daily | Full table → feature table | CoW (overwrite) |

### Resource Allocation by Workload

| Resource | Dashboard Queries | Ad-Hoc Queries | ML Workloads | Ingestion | Compaction |
|:---|:---:|:---:|:---:|:---:|:---:|
| CPU priority | High | Medium | Low | Medium | Low |
| Memory allocation | 30% | 30% | 20% | 10% | 10% |
| Network bandwidth | 25% | 25% | 30% | 15% | 5% |
| Scheduling priority | P1 (SLO-backed) | P2 | P3 (batch) | P1 (freshness SLO) | P3 (background) |
