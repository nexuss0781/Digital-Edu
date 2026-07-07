# 16.6 Design a Data Warehouse

## Overview

A data warehouse is a purpose-built analytical storage and query engine that organizes structured data in columnar format to support high-throughput aggregation queries across petabyte-scale datasets. Unlike transactional databases optimized for single-row lookups and updates, data warehouses store data column-by-column, enabling queries that scan billions of rows but only a few columns to skip 90%+ of irrelevant data. Modern architectures separate compute from storage — stateless compute clusters read from a shared columnar storage layer backed by cloud object storage — allowing organizations to scale query concurrency and data volume independently, pay only for resources consumed, and run isolated workloads (ETL, interactive BI, machine learning) without contention. This architecture powers business intelligence dashboards, ad-hoc analytical queries, regulatory reporting, and data science workflows where the value lies in aggregating, filtering, and joining large historical datasets rather than serving real-time transactional requests.

## Key Characteristics

| Characteristic | Description |
|----------------|-------------|
| **Read-heavy, append-mostly** | Analytical queries dominate; data is loaded in bulk or micro-batches and rarely updated in place |
| **Columnar storage** | Data stored column-by-column with type-specific encoding and compression, enabling 10-100x I/O reduction for typical queries |
| **Massively parallel processing** | Queries are decomposed into fragments executed simultaneously across dozens to hundreds of compute nodes |
| **Separation of compute and storage** | Stateless compute clusters read from durable object storage, enabling independent scaling and workload isolation |
| **Schema-on-write** | Data conforms to a predefined star or snowflake schema at load time, ensuring query-time consistency |
| **Latency-tolerant** | Queries typically complete in seconds to minutes, not milliseconds; optimized for throughput over latency |
| **Cost-proportional** | Charges scale with data scanned and compute time, making query efficiency directly tied to cost |

## Complexity Rating: **Very High**

Designing a data warehouse that maintains sub-second scan rates across petabytes of columnar data while supporting hundreds of concurrent queries introduces the "resource elasticity problem" — dynamically allocating and reclaiming compute capacity without query starvation or cold-start penalties. Combined with cost-based query optimization over star schemas with hundreds of tables, materialized view maintenance that keeps pre-computed aggregates fresh without full recomputation, and multi-tenant workload isolation that prevents a single expensive query from degrading the entire cluster, this is one of the most architecturally complex analytical systems to design at scale.

The three-dimensional coupling between the **storage layer** (encoding, compression, clustering), the **execution layer** (vectorized scan, join strategies, spill management), and the **optimization layer** (cardinality estimation, plan selection, materialized view matching) means that a suboptimal decision in any dimension cascades to the others. Poor clustering creates poor zone maps, which defeats Cutting off unnecessary steps, which increases scan volume, which causes memory pressure, which triggers spill-to-disk, which makes the query 10x slower and 10x more expensive.

---

## What Differentiates Naive vs. Production

| Dimension | Naive Approach | Production Reality |
|---|---|---|
| **Storage format** | Row-oriented storage with B-tree indexes | Columnar micro-partitions with type-specific encoding, zone maps, and Bloom filters; 10-100x I/O reduction |
| **Query execution** | Row-at-a-time Volcano iterator model | Vectorized batch processing (1024-4096 values) with SIMD, achieving 20x scan throughput per core |
| **Scaling** | Fixed cluster size, manual capacity planning | Multi-cluster elastic compute with auto-scale/auto-suspend; scale-to-zero when idle |
| **Concurrency** | Shared resources, noisy neighbor problem | Workload isolation via separate warehouses; per-query resource governors; admission control |
| **Updates** | In-place row mutations with lock contention | Copy-on-write immutable micro-partitions; atomic metadata swap; zero reader-writer contention |
| **Optimization** | Index hints and manual tuning | Cost-based optimizer with cardinality estimation, materialized view matching, partition Cutting off unnecessary steps, and adaptive join strategy selection |
| **Cost** | Always-on cluster regardless of utilization | Pay-per-query: cost proportional to bytes scanned × compute seconds consumed |
| **Freshness** | Batch ETL with hours of latency | Continuous micro-batch ingestion with sub-minute data freshness |

---

## System Overview

A data warehouse solves the fundamental problem that analytical queries and transactional queries have opposite hardware requirements. Transactional queries need fast random access to individual rows — favoring row-oriented storage with B-tree indexes. Analytical queries need fast sequential scans of specific columns across billions of rows — favoring columnar storage with compression and vectorized execution. The engineering challenge is that storing data column-by-column enables 10-100x I/O reduction for analytical queries but makes single-row lookups expensive. The separated compute/storage architecture adds a second dimension: stateless compute nodes must fetch data over the network from object storage, making the caching hierarchy (result cache → SSD cache → object storage) a critical-path component that determines whether query latency is milliseconds or minutes.

## Quick Links

| # | Section | Description |
|---|---------|-------------|
| 01 | [Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| 02 | [High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| 03 | [Low-Level Design](./03-low-level-design.md) | Data model, API design, core algorithms (Step-by-step plan in plain English) |
| 04 | [Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Columnar internals, query execution, partition Cutting off unnecessary steps |
| 05 | [Scalability & Reliability](./05-scalability-and-reliability.md) | Elastic compute, storage scaling, fault tolerance |
| 06 | [Security & Compliance](./06-security-and-compliance.md) | Row/column-level security, encryption, compliance |
| 07 | [Observability](./07-observability.md) | Query profiling, warehouse metrics, alerting |
| 08 | [Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-off frameworks |
| 09 | [Insights](./09-insights.md) | Key architectural insights and non-obvious lessons |

## Technology Landscape

| Category | Representative Systems | Approach |
|----------|----------------------|----------|
| Cloud-Native Warehouse | Snowflake, BigQuery, Redshift | Managed service, separation of compute/storage, elastic scaling |
| On-Premise MPP | Teradata, Greenplum, Vertica | Shared-nothing MPP, coupled compute/storage, dedicated hardware |
| Lakehouse | Databricks (Delta Lake), Apache Iceberg + Trino | Open table formats on object storage, unified batch + ML workloads |
| Embedded Analytics | DuckDB, ClickHouse | In-process or single-node columnar engine, low-latency OLAP |
| Federated Query | Trino, Presto, Dremio | Query engine over heterogeneous data sources without data movement |
| Streaming Warehouse | Apache Druid, Apache Pinot | Real-time ingestion with sub-second analytical queries |

## What Makes This System Unique

### The Three-Layer Independence Property

Unlike a traditional MPP database (two layers: compute + storage) or an OLTP database (single node), a cloud-native data warehouse separates into three independently scalable layers: **cloud services** (always-on, stateless query parsing and metadata management), **elastic compute** (on-demand, stateless query execution clusters), and **durable storage** (immutable micro-partitions in object storage). Each layer scales independently: cloud services scale with concurrent sessions, compute scales with query complexity and concurrency, and storage scales with data volume. This three-layer separation is not merely an operational convenience — it is the enabling architecture for features like zero-copy data sharing, instant warehouse cloning, per-query cost attribution, and workload isolation.

### Cost as a First-Class Architectural Constraint

In OLTP databases, the primary metric is latency. In data warehouses, **cost is co-equal with performance**. Every byte scanned incurs a measurable cost. Every second of compute incurs a measurable cost. This means every architectural decision — columnar storage (fewer bytes per query), partition Cutting off unnecessary steps (fewer partitions scanned), materialized views (pre-computed results), result caching (zero-cost repeated queries) — is simultaneously a performance optimization and a cost optimization. The optimizer that selects a suboptimal join strategy does not just make the query slower; it makes it more expensive. Cost-awareness permeates the entire design.

### Immutability as the Foundational Rule that never changes

The decision to make micro-partitions immutable (append-only, copy-on-write for mutations) cascades through every system property: snapshot isolation requires no locks (readers see a fixed set of partitions), time travel is free (old partitions are simply retained), compression is optimal (encoder analyzes final data without reserving expansion space), replication is trivial (immutable files are idempotent to copy), and cache invalidation is simple (a partition either exists or it does not). The trade-off — expensive single-row updates — is acceptable because the system is designed for append-heavy analytical workloads.

---

## Architecture Evolution (2024–2026)

Key trends shaping data warehouse architecture:

- **AI-Native Query Interfaces:** Natural language to SQL translation integrated directly into the warehouse, using catalog metadata and column statistics for grounding; AI-generated query suggestions and optimization recommendations
- **Lakehouse Convergence:** Warehouses natively read and write open table formats (Iceberg, Delta Lake), blurring the boundary between warehouse and lakehouse; unified governance across both
- **Serverless and Scale-to-Zero:** Compute clusters that scale to zero with sub-second cold start, eliminating idle costs entirely; per-query billing without warehouse provisioning
- **Real-Time Ingestion:** Native streaming ingestion pipelines that achieve single-digit-second freshness, replacing micro-batch with continuous change data capture directly into the warehouse
- **Embedded Vector Search:** Native vector column types with approximate nearest neighbor indexes alongside analytical columns, enabling hybrid analytical-semantic queries without external vector databases
- **Carbon-Aware Scheduling:** Batch and non-urgent analytical jobs automatically scheduled to run during low-carbon-intensity grid periods, with cost incentives for flexible scheduling
- **Data Clean Rooms:** Secure multi-party computation environments where organizations join datasets without exposing raw data to each other, built on secure enclaves and differential privacy
- **Automated Physical Design:** ML-driven automatic clustering key selection, materialized view creation, and partition sizing based on observed query patterns — replacing manual DBA tuning entirely

---

## Related Patterns

| Related Topic | Connection | Link |
|---|---|---|
| Data Lakehouse Architecture | Open table formats bridge warehouse and lakehouse; warehouses natively read Iceberg/Delta tables | [View](../16.7-data-lakehouse-architecture/00-index.md) |
| Change Data Capture System | CDC feeds real-time data into the warehouse; continuous ingestion replaces batch ETL | [View](../16.8-change-data-capture-system/00-index.md) |
| Data Mesh Architecture | Warehouse serves as a domain-owned data product platform within a data mesh topology | [View](../16.9-data-mesh-architecture/00-index.md) |
| AI-Native Data Catalog & Governance | Catalog provides lineage, classification, and governance for warehouse tables | [View](../16.10-ai-native-data-catalog-governance/00-index.md) |
| Time-Series Database | Time-series workloads benefit from warehouse columnar compression and temporal partitioning | [View](../16.2-time-series-database/00-index.md) |
| Text Search Engine | Warehouse search indexes complement full-text search engines for hybrid analytical-text queries | [View](../16.3-text-search-engine/00-index.md) |
| NewSQL Database | HTAP capabilities blur boundaries between OLTP and analytical workloads | [View](../16.5-newsql-database/00-index.md) |
| Distributed Consensus | Metadata store uses Raft consensus for consistency and fault tolerance | [View](../1.5-distributed-consensus/00-index.md) |

---

## Key Concepts Referenced

- **Columnar Storage** — Data organized by column rather than row, enabling compression and scan efficiency for analytical queries
- **Micro-Partition** — A contiguous unit of columnar storage (50-500 MB uncompressed) with embedded statistics for Cutting off unnecessary steps
- **MPP (Massively Parallel Processing)** — Query execution distributed across independent compute nodes that process data partitions in parallel
- **Separation of Compute and Storage** — Architecture where stateless compute clusters access a shared, durable storage layer independently
- **Zone Map** — Per-partition min/max statistics that enable the query engine to skip partitions that cannot contain matching rows
- **Materialized View** — Pre-computed query result stored as a table, refreshed incrementally as source data changes
- **Cost-Based Optimizer (CBO)** — Query planner that evaluates execution plans using statistical metadata to minimize resource consumption
- **Clustering Key** — Column(s) that determine physical sort order within micro-partitions; controls zone map effectiveness and Cutting off unnecessary steps rate
- **Clustering Depth** — Average number of overlapping micro-partitions for a given column value; lower depth means better Cutting off unnecessary steps
- **Vectorized Execution** — Query processing in columnar batches (1K-4K values) enabling SIMD and CPU cache-friendly operation
- **Late Materialization** — Deferring row reconstruction until after filtering; carries column references instead of full tuples
- **Result Cache** — Cross-warehouse cache mapping query signatures to complete results; invalidated on upstream data change
- **Workload Isolation** — Running different query classes (BI, ETL, ad-hoc) on separate compute warehouses to prevent resource contention
- **Copy-on-Write** — Update/delete strategy that creates new micro-partitions rather than modifying existing ones; enables immutability
- **Broadcast Join** — Join strategy that copies the smaller table to all compute nodes; optimal when one side is < 10 MB
- **Data Sharing** — Zero-copy sharing of live data via metadata grants; no data movement or duplication
- **Time Travel** — Querying historical data snapshots by leveraging retained old micro-partitions in object storage
- **Spill-to-Disk** — Writing intermediate query results (hash tables, sort buffers) to local SSD when memory budget is exceeded
- **Query Fragment** — A portion of a distributed query plan assigned to a single compute node for execution
- **Admission Control** — Gate that accepts/rejects/queues queries based on estimated resource requirements and available capacity
