# Overview — Data Lakehouse Architecture

## What Is a Data Lakehouse?

A data lakehouse is a unified data management architecture that combines the low-cost, scalable storage of a data lake with the transactional reliability, schema enforcement, and governance of a data warehouse. At its core, the lakehouse places an **open table format layer** (such as Delta Lake, Apache Iceberg, or Apache Hudi) over commodity object storage, enabling ACID transactions, snapshot isolation, schema evolution, and time travel on files that were previously unmanaged. This eliminates the need for a separate extract-transform-load pipeline between a lake and a warehouse, reducing data duplication, lowering latency, and enabling a single copy of data to serve both analytical BI dashboards and machine-learning workloads. The architecture decouples compute from storage, allowing elastic query engines to scale independently, and uses open file formats to prevent vendor lock-in while supporting multi-engine access to the same governed dataset.

## Key Characteristics

| Characteristic | Description |
|:---|:---|
| **ACID on Object Storage** | Optimistic concurrency control and metadata-based commit protocols bring transactional guarantees to immutable file stores |
| **Open Table Formats** | Delta Lake, Iceberg, and Hudi track individual files in metadata rather than directories, enabling atomic commits and schema evolution |
| **Decoupled Compute & Storage** | Query engines scale elastically without resizing storage; storage scales infinitely at object-store cost |
| **Multi-Engine Access** | The same governed table is readable by Spark, Flink, Trino, DuckDB, and other engines simultaneously |
| **Time Travel & Snapshots** | Every write creates an immutable snapshot; readers query any historical version by ID or timestamp |
| **Schema Evolution** | Add, drop, rename, and reorder columns as metadata-only operations without rewriting data files |
| **Data Skipping & Z-Ordering** | Per-file column statistics and space-filling curves dramatically reduce I/O for selective queries |
| **Unified Batch & Streaming** | The same table ingests micro-batch or streaming writes and serves batch analytical queries |

## Complexity Rating

| Dimension | Rating | Justification |
|:---|:---:|:---|
| Storage Engine | Very High | Metadata hierarchy (catalog, snapshots, manifests, data files) with optimistic concurrency on eventually-consistent object stores |
| Query Optimization | High | Data skipping, Z-ordering, partition Cutting off unnecessary steps, and merge-on-read require sophisticated cost-based planning |
| Concurrency Control | High | ACID commits via compare-and-swap or transaction logs on storage that has no native locking |
| Schema & Partition Evolution | High | Column-ID-based evolution and hidden partitioning require careful metadata versioning |
| Compaction & Maintenance | Medium-High | Background compaction, snapshot expiration, and vacuum operations balance write amplification against read performance |
| Multi-Engine Governance | Medium-High | Catalog protocols, credential vending, and consistent statistics across heterogeneous engines |
| **Overall** | **Very High** | Combines distributed systems, storage-engine internals, and data-governance challenges in one architecture |

## Quick Links

| Document | Focus |
|:---|:---|
| [Requirements & Estimations](01-requirements-and-estimations.md) | Functional / non-functional requirements, capacity math |
| [High-Level Design](02-high-level-design.md) | Architecture diagram, write / read paths, key decisions |
| [Low-Level Design](03-low-level-design.md) | Data model, API surface, core algorithms in Step-by-step plan in plain English |
| [Deep Dive & Bottlenecks](04-deep-dive-and-bottlenecks.md) | Small-file problem, metadata scalability, MoR vs CoW, partition evolution |
| [Scalability & Reliability](05-scalability-and-reliability.md) | Storage / compute scaling, fault tolerance, multi-engine access |
| [Security & Compliance](06-security-and-compliance.md) | Threat model, AuthN / AuthZ, encryption, compliance |
| [Observability](07-observability.md) | Metrics, logging, tracing, alerting, dashboards |
| [Interview Guide](08-interview-guide.md) | 45-min pacing, trap questions, trade-offs, senior / staff tips |
| [Insights](09-insights.md) | Architectural insights and non-obvious lessons |

## Technology Landscape

| System | Table Format | Primary Strength | Write Strategy |
|:---|:---|:---|:---|
| Delta Lake | Delta (Parquet + JSON/Parquet log) | Deep Spark integration, simple versioning | CoW + Deletion Vectors |
| Apache Iceberg | Iceberg (Parquet/ORC/Avro + Avro manifests) | Widest multi-engine support, hidden partitioning | CoW + MoR (position / equality deletes) |
| Apache Hudi | Hudi (Parquet base + Avro logs) | Streaming upserts, non-blocking concurrency | MoR (file-group compaction) + CoW |
| Apache Paimon | Paimon (LSM-tree buckets) | Streaming-first with Flink, changelog streams | LSM merge + continuous compaction |
| DuckLake | SQL-database metadata + Parquet files | SQL-queryable metadata, multi-table atomicity | CoW with relational catalog |
| Open Table Format Catalogs | REST / Nessie / Polaris / Gravitino | Engine-neutral governance, credential vending | N/A (metadata layer) |

## Key Concepts

| Concept | Definition |
|:---|:---|
| **Open Table Format** | A metadata specification layered on top of columnar file formats (Parquet, ORC) that adds ACID semantics, schema tracking, and snapshot management |
| **Snapshot** | An immutable record of which data files constitute the table at a given point in time; enables time travel and rollback |
| **Manifest File** | An Avro file listing data file paths along with per-file column statistics (min, max, null count) for data skipping |
| **Manifest List** | A file listing manifest files with partition-level summaries; the first level of Cutting off unnecessary steps in the read path |
| **Compare-and-Swap (CAS)** | The atomic operation used by the catalog to update the current snapshot pointer, ensuring only one concurrent writer succeeds |
| **Optimistic Concurrency Control** | Writers proceed without locks; conflicts are detected only at commit time via CAS failure |
| **Copy-on-Write (CoW)** | Update strategy that rewrites entire data files on modification; optimizes reads at the cost of write amplification |
| **Merge-on-Read (MoR)** | Update strategy that appends small delete/log files; optimizes writes but requires read-time merging |
| **Data Skipping** | Using per-file column statistics to skip files whose value ranges do not overlap with query predicates |
| **Z-Ordering** | A space-filling curve technique that co-locates data across multiple dimensions, tightening per-file statistics for multi-column queries |
| **Hidden Partitioning** | Partition transforms stored in metadata rather than exposed in query syntax; enables evolution without breaking queries |
| **Partition Evolution** | Changing the partition strategy (e.g., monthly → daily) as a metadata-only operation without rewriting existing data |
| **Compaction** | Merging many small files into fewer optimally-sized files to reduce metadata overhead and improve scan performance |
| **Vacuum / Snapshot Expiration** | Removing data files no longer referenced by any live snapshot to reclaim storage |
| **Credential Vending** | The catalog issuing short-lived, scoped storage credentials to query engines, enforcing least-privilege access |
| **Deletion Vector** | A bitmap stored alongside data files indicating which rows are logically deleted, avoiding full file rewrites |
| **Liquid Clustering** | An adaptive, incremental clustering strategy that replaces static Z-ordering by re-clustering only newly written data |
| **Puffin Statistics File** | A sidecar file format for storing advanced statistics (NDV sketches, bloom filters, histograms) alongside manifests |
| **Write-Audit-Publish (WAP)** | A workflow pattern where writes go to a staging branch, are validated, then published to the main table via snapshot cherry-pick |

## Related Patterns

| Pattern | Relationship | Link |
|:---|:---|:---|
| **Data Warehouse** (16.6) | Lakehouse evolved from combining warehouse governance with lake economics; shares columnar formats and SQL access patterns | [View](../16.6-data-warehouse/00-index.md) |
| **Change Data Capture** (16.8) | CDC is the primary mechanism for populating lakehouse tables from operational databases; lakehouse MoR strategy optimizes for CDC workloads | [View](../16.8-change-data-capture-system/00-index.md) |
| **Data Mesh** (16.9) | Lakehouse tables serve as the physical implementation of data products in a Data Mesh; the catalog enforces mesh governance | [View](../16.9-data-mesh-architecture/00-index.md) |
| **AI-Native Data Catalog** (16.10) | The catalog layer in a lakehouse implements the same metadata graph, lineage, and governance concerns as a standalone data catalog | [View](../16.10-ai-native-data-catalog-governance/00-index.md) |
| **Time-Series Database** (16.2) | Time-partitioned lakehouse tables share compaction, retention, and time-based Cutting off unnecessary steps patterns with TSDBs | [View](../16.2-time-series-database/00-index.md) |
| **Text Search Engine** (16.3) | Lakehouse data skipping via manifest statistics parallels search engine segment Cutting off unnecessary steps; both use progressive elimination | [View](../16.3-text-search-engine/00-index.md) |
| **Distributed Log Broker** (1.1) | Streaming ingestion into a lakehouse uses a log broker (e.g., Kafka) as the upstream source for micro-batch commits | [View](../1.1-distributed-log-broker/00-index.md) |
| **NewSQL Database** (16.5) | NewSQL's OCC and range-based partitioning share design principles with lakehouse commit protocols and partition management | [View](../16.5-newsql-database/00-index.md) |
