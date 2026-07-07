# Requirements & Estimations — Data Warehouse

## Functional Requirements

### Core Features (Must-Have)

| # | Requirement | Description |
|---|------------|-------------|
| F1 | **Data Ingestion** | Bulk loading (COPY/INSERT), micro-batch streaming, and schema-validated data import from structured sources |
| F2 | **SQL Query Engine** | Full ANSI SQL support including JOINs, subqueries, window functions, CTEs, and set operations |
| F3 | **Columnar Scan & Filter** | Column-level predicate pushdown with partition Cutting off unnecessary steps to minimize data scanned |
| F4 | **Aggregation & Grouping** | Distributed GROUP BY, DISTINCT, HAVING, and rollup/cube operations across petabyte-scale data |
| F5 | **Join Processing** | Hash joins, sort-merge joins, and broadcast joins with automatic strategy selection |
| F6 | **Schema Management** | DDL operations for databases, schemas, tables, views, and constraints with online schema evolution |
| F7 | **Materialized Views** | Pre-computed aggregates with automatic incremental refresh when source tables change |
| F8 | **Transaction Support** | ACID semantics for DML operations with snapshot isolation for concurrent read/write |

### Extended Features (Nice-to-Have)

| # | Requirement | Description |
|---|------------|-------------|
| E1 | **Time Travel** | Query historical snapshots of data at any point within a retention window |
| E2 | **Data Sharing** | Zero-copy sharing of live data between organizational units without data movement |
| E3 | **Semi-Structured Data** | Native support for JSON, Avro, and Parquet with schema-on-read for nested fields |
| E4 | **External Tables** | Query data in external object storage without loading it into the warehouse |
| E5 | **Workload Management** | Automatic classification and prioritization of queries by resource requirements and business priority |
| E6 | **Secure Data Sharing** | Zero-copy sharing of live tables with external organizations via metadata grants, with row/column-level policies |
| E7 | **Data Cloning** | Instant zero-copy clone of databases/schemas for development and testing without storage duplication |
| E8 | **Search Optimization** | Full-text search indexes on string columns for pattern matching alongside analytical queries |
| E9 | **UDF / Stored Procedures** | User-defined functions in SQL and general-purpose languages, executed in sandboxed compute |
| E10 | **Query Acceleration Layer** | In-memory acceleration for BI queries on hot datasets, bypassing object storage entirely |
| E11 | **Vector Column Support** | Native vector data type with ANN index for hybrid analytical-semantic workloads |
| E12 | **Natural Language Query** | AI-powered natural language to SQL translation using catalog metadata for grounding |

### Out of Scope

- Real-time transactional processing (OLTP workloads with single-row latency requirements)
- Unstructured data storage (images, video, raw text — handled by object storage or data lake)
- Stream processing engine (real-time event processing handled by dedicated streaming platform)
- Machine learning model training (compute-intensive training delegated to ML platform)

### Migration Requirements (from On-Premise Data Warehouse)

| Requirement | Description |
|------------|-------------|
| SQL compatibility | Support 95%+ of source warehouse SQL dialect (window functions, CTEs, lateral joins, QUALIFY) |
| Schema migration | Automated schema comparison and DDL generation for target warehouse |
| Data migration | Bulk data transfer with validation checksums; zero-downtime dual-write cutover |
| Performance parity | Equivalent or better query latency for top 100 dashboard queries |
| ETL compatibility | Existing ETL pipelines connect via standard JDBC/ODBC drivers |
| Rollback capability | Ability to fail back to source warehouse within 48 hours of cutover |
| Cost modeling | Pre-migration cost estimation based on historical query patterns |

---

## Non-Functional Requirements

### Latency Budget Breakdown (Analytical Query)

```
Operation                         Time       Cumulative
──────────────────────────────────────────────────────────
SQL parse + semantic analysis     10ms       10ms
Cost-based optimization           60ms       70ms
Plan distribution to nodes        5ms        75ms
Partition Cutting off unnecessary steps (zone maps)     15ms       90ms
Object storage fetch (cold)       50ms       140ms
  or SSD cache hit                0.1ms      90.1ms
Column decompression              40ms       180ms
Vectorized scan + filter          200ms      380ms
Hash join (broadcast)             150ms      530ms
Partial aggregation (per node)    100ms      630ms
Shuffle + merge aggregation       80ms       710ms
Sort + limit                      5ms        715ms
Result serialization + return     10ms       725ms
──────────────────────────────────────────────────────────
Total (SSD cache hit):            ~450ms
Total (object storage fetch):     ~725ms
Total (complex multi-table join): ~2-10s
Total (full table scan, 1 TB):    ~15-30s
```

### CAP Theorem Choice

**CP with tunable staleness** — Analytical queries must see a consistent snapshot of data (no partial loads visible). Availability is important but brief unavailability during compute cluster scaling or failover is acceptable since analytical workloads are latency-tolerant.

| Property | Choice | Justification |
|----------|--------|---------------|
| Consistency | Strong (snapshot isolation) | Queries must see a consistent view; partial loads produce incorrect aggregations |
| Availability | High but not absolute | Seconds of unavailability during cluster resize is acceptable for analytical workloads |
| Partition Tolerance | Required | Distributed compute and storage must survive network partitions |

### Performance Targets

| Metric | Target | Context |
|--------|--------|---------|
| Simple aggregation (single table) | < 2s (p50), < 5s (p99) | COUNT/SUM/AVG over filtered partition of a billion-row table |
| Complex join query (3-5 tables) | < 10s (p50), < 30s (p99) | Star schema join with dimension filtering |
| Full table scan (1 TB) | < 30s (p50), < 60s (p99) | Unfiltered scan of a large fact table |
| Data loading (bulk) | > 1 GB/s per compute node | Compressed Parquet/CSV ingestion throughput |
| Data loading (micro-batch) | < 60s end-to-end latency | From event arrival to query-visible |
| Concurrent queries | 200+ simultaneous | Without significant latency degradation |
| Query compilation | < 500 ms | SQL parsing, optimization, and plan generation |

### Durability & Availability

| Metric | Target |
|--------|--------|
| Availability | 99.95% (4.4 hours/year downtime) |
| Durability | 99.999999999% (11 nines) |
| RPO | 0 (no data loss — committed data persists in durable object storage) |
| RTO | < 60 seconds (stateless compute recovery from object storage) |

---

## Capacity Estimations (Back-of-Envelope)

### Scenario: Enterprise Analytics Platform

A retail enterprise with 50,000 employees, 200M daily transactions, serving BI dashboards, ad-hoc queries, and regulatory reporting across 3 years of historical data.

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Daily raw data ingested | 500 GB | 200M transactions x 2.5 KB avg row size |
| Daily compressed data | 50 GB | 10:1 compression ratio (columnar + encoding) |
| Annual storage growth | 18 TB compressed | 50 GB/day x 365 days |
| Total storage (3 years) | 55 TB compressed | 18 TB x 3 years + metadata + time travel snapshots |
| Total raw equivalent | 550 TB | 55 TB compressed / 10:1 ratio |
| Fact table rows (3 years) | 220B | 200M/day x 365 x 3 years |
| Dimension tables | 500M rows total | Products, customers, stores, employees |
| Concurrent BI users | 500 | Dashboard viewers during business hours |
| Peak query QPS | 50 | 500 users x ~6 queries/min / 60 |
| Ad-hoc analyst queries | 2,000/day | 100 analysts x 20 queries/day |
| ETL batch loads | 24/day | Hourly incremental loads |
| Metadata catalog size | 50 GB | Table schemas, partition statistics, access logs |
| Query result cache | 100 GB | LRU cache for repeated dashboard queries |

### Storage Architecture Summary

```
Total Compressed Storage:  ~55 TB (3 years)
Replication Factor:        3x (object storage durability)
Compute Cluster:           8-16 nodes x 32 vCPU + 256 GB RAM (elastic)
Hot Cache (per node):      2 TB NVMe SSD for frequently accessed partitions
Metadata Service:          3-node replicated cluster, 50 GB
```

---

## SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Availability | 99.95% | Percentage of minutes where query submission succeeds |
| Query Latency (p99, simple) | < 5 seconds | Single-table aggregation with partition Cutting off unnecessary steps |
| Query Latency (p99, complex) | < 30 seconds | Multi-table join with window functions |
| Data Freshness | < 60 seconds | Time between commit in source system and query visibility |
| Error Rate | < 0.1% | Percentage of queries returning system errors |
| Throughput | > 50 QPS sustained | Concurrent query execution rate |
| Compute Scaling | < 60 seconds | Time to provision additional compute capacity |
| Recovery Time | < 60 seconds | Time to resume query processing after compute failure |

### SLO Error Budgets

| SLO | Target | Monthly Error Budget | Budget in Real Terms |
|-----|--------|---------------------|---------------------|
| Availability (99.95%) | 0.05% downtime | 21.9 minutes/month | ~5 minutes/week |
| Query Latency (p99 < 5s, simple) | 1% may exceed | 1% × 50 QPS × 60s = 30 queries/min may be slow | ~1,800 slow queries/hour allowed |
| Data Freshness (< 60s) | 0.1% may exceed | ~43 minutes/month where freshness > 60s | ~10 minutes/week |
| Error Rate (< 0.1%) | 0.1% query failures | At 50 QPS: 3 failed queries/hour | ~72 failed queries/day |

**Error budget policy:**
- **> 75% budget remaining:** Normal operations; deploy freely
- **50-75% remaining:** Increased scrutiny on changes; no large-scale schema migrations
- **25-50% remaining:** Only critical fixes deployed; proactive investigation required
- **< 25% remaining:** Freeze all non-essential changes; dedicate engineering to SLO recovery
- **Budget exhausted:** Post-incident review required; executive escalation

### Hardware Reference Architecture

| Component | Specification | Quantity | Purpose |
|-----------|--------------|----------|---------|
| Compute Node (Medium) | 32 vCPU, 256 GB RAM, 2 TB NVMe SSD, 25 Gbps network | 8-16 per warehouse | Query execution, scan, join, aggregate |
| Compute Node (Large) | 64 vCPU, 512 GB RAM, 4 TB NVMe SSD, 100 Gbps network | 4-8 per warehouse | Memory-intensive joins, large sorts |
| Metadata Server | 16 vCPU, 64 GB RAM, 500 GB NVMe SSD | 3 (Raft cluster) | Schema, zone maps, access control |
| Cloud Services | 8 vCPU, 32 GB RAM | 3+ (stateless, load-balanced) | Query parsing, optimization, routing |
| Result Cache | 16 vCPU, 128 GB RAM | 2 (replicated) | Cross-warehouse query result cache |

**Compute cost model:**
- Per-second billing based on warehouse size and active time
- Cost per query ≈ (bytes_scanned / compression_ratio) × (compute_seconds / parallelism) × rate
- Idle cost = $0 when auto-suspended; SSD cache state preserved across suspend/resume cycles

---

## Read/Write Ratio Analysis

| Workload Type | Read:Write | Dominant Operation |
|---------------|------------|-------------------|
| BI dashboards | 500:1 | Repeated aggregation queries, cached results |
| Ad-hoc analytics | 200:1 | Exploratory queries with varying predicates |
| Regulatory reporting | 100:1 | Scheduled reports with fixed query patterns |
| ETL/ELT processing | 5:1 | Bulk data transformations with heavy writes |
| Data science exploration | 50:1 | Large scans with statistical sampling |
| Data sharing | 1000:1 | Consumer queries against shared datasets |

**Overall weighted ratio: ~100:1 (read-heavy)**

---

## Growth Projections

| Stage | Timeline | Compressed Storage | Query QPS | Compute Cluster | Sources |
|-------|----------|-------------------|-----------|-----------------|---------|
| **Pilot** | Month 0-6 | 2 TB | 5 | 4-node small warehouse | 3-5 source systems |
| **Production** | Month 6-18 | 20 TB | 25 | 8-node medium warehouse + ETL warehouse | 10-20 source systems |
| **Scale** | Year 1-3 | 100 TB | 50 | Multi-cluster warehouses, 3 workload tiers | 50+ source systems |
| **Enterprise** | Year 3+ | 500+ TB | 200+ | Multi-region, dozens of warehouses | 100+ sources, data marketplace |

### Infrastructure Scaling by Stage

| Component | Pilot | Production | Scale | Enterprise |
|-----------|-------|------------|-------|------------|
| Compute nodes (total) | 4 | 16 | 64 | 200+ |
| Node spec | 16 vCPU, 128 GB RAM, 1 TB NVMe | 32 vCPU, 256 GB RAM, 2 TB NVMe | 32 vCPU, 256 GB RAM, 4 TB NVMe | 64 vCPU, 512 GB RAM, 4 TB NVMe |
| Metadata store | 3-node replicated | 3-node replicated | 5-node replicated | 5-node per region |
| Ingestion | Daily batch | Hourly micro-batch | Continuous micro-batch | Streaming CDC |
| Backup | Daily snapshot | Continuous time travel (7 days) | Continuous (30 days) + cross-region | Continuous (90 days) + multi-region |

### Key Capacity Thresholds

| Threshold | Impact | Action Required |
|-----------|--------|----------------|
| > 100K micro-partitions per table | Metadata operations slow down; compilation time increases | Increase partition size; archive old data |
| > 85% SSD cache utilization | Cache thrashing; query latency variance increases | Add nodes or increase cache size per node |
| > 30% spill-to-disk ratio | Queries bottlenecked on local disk I/O | Scale up warehouse size (more memory per node) |
| > 50 clustering depth | Partition Cutting off unnecessary steps ineffective; scans read 50x more data than necessary | Trigger re-clustering on affected tables |
| > 10s query queue time (p95) | Users experience visible wait; dashboard SLOs at risk | Add compute clusters or enable multi-cluster |
| > 200 concurrent queries per cluster | Per-query resource allocation drops below effective minimum | Add clusters or implement query queuing |

---

## Cost Estimation by Stage

| Stage | Monthly Compute | Monthly Storage | Monthly Network | Total Monthly |
|-------|----------------|----------------|----------------|---------------|
| **Pilot** (4 nodes) | $2,000 | $200 | $100 | ~$2,300 |
| **Production** (16 nodes) | $12,000 | $2,000 | $800 | ~$14,800 |
| **Scale** (64 nodes) | $60,000 | $10,000 | $4,000 | ~$74,000 |
| **Enterprise** (200+ nodes) | $250,000 | $50,000 | $20,000 | ~$320,000 |

**Cost drivers by component:**

| Component | % of Total Cost | Scaling Driver |
|-----------|----------------|----------------|
| Compute (CPU/memory) | 60-70% | Query volume × complexity × concurrency |
| Storage (object storage) | 15-20% | Data volume × retention window × compression ratio |
| Network (cross-AZ/region) | 5-10% | Bytes scanned from object storage + cross-cluster shuffle |
| Metadata service | 2-5% | Always-on replicated cluster |
| Data transfer (ingestion) | 3-5% | Ingress volume from source systems |

### Per-Query Resource Cost

| Resource | Estimation Per Query | Calculation |
|----------|---------------------|-------------|
| CPU | 200ms - 30s of CPU time | Parse (10ms) + Optimize (60ms) + Scan/Filter (variable) + Aggregate (variable) |
| Memory | 100 MB - 10 GB | Column buffers + hash tables + sort buffers + result materialization |
| Network | 10 MB - 10 GB | Compressed partition data fetched from object storage |
| Disk I/O (SSD cache) | 0 - 50 GB | Cache misses requiring object storage fetch → SSD write |
| Object storage reads | 1 - 10,000 GET requests | One GET per column chunk per partition scanned |

### Storage Overhead Breakdown

```
Given: 1 TB of raw user data (uncompressed)

Component                       Size       % of Total
───────────────────────────────────────────────────────
Compressed columnar data         100 GB      33%
Time travel snapshots (30 days)  80 GB       27%
Materialized views               40 GB       13%
Staging / transient data         20 GB        7%
Metadata (zone maps, schemas)    5 GB         2%
Clustering overhead (interim)    15 GB        5%
Active data subtotal            260 GB       87%
Cross-region replica            260 GB       87%
───────────────────────────────────────────────────────
Total with DR:                  520 GB
Effective overhead:             5.2x compression, 0.52x raw with DR
```

---

## Organizational Requirements at Scale

| Team | Responsibility | Headcount (at Scale stage) |
|------|---------------|---------------------------|
| Data Platform | Warehouse infrastructure, compute management, cost optimization | 4-6 engineers |
| Data Engineering | ETL/ELT pipelines, ingestion, data quality, transformation | 6-10 engineers |
| Analytics Engineering | Data modeling, dimensional design, materialized views, semantic layer | 4-6 engineers |
| Data Governance | Access control, classification, lineage, compliance | 2-3 engineers |
| BI / Analytics | Dashboard development, report authoring, self-service enablement | 5-10 analysts |
| SRE / Operations | Monitoring, alerting, incident response, capacity planning | 2-4 engineers |

---

## Workload Profiles and Warehouse Recommendations

| Workload Profile | Read:Write | Key Characteristic | Recommended Warehouse | Clustering Strategy |
|-----------------|------------|-------------------|-----------------------|---------------------|
| **Executive BI** | 500:1 | Fixed dashboard queries; sub-3s latency required | Small, always-on, multi-cluster (min 1) | Cluster by dashboard filter columns (date, region) |
| **Analyst Ad-Hoc** | 100:1 | Variable queries; can tolerate 10-30s; exploratory | Medium, elastic, auto-suspend 5 min | Cluster by most-queried dimension (date, category) |
| **ETL / Transformation** | 5:1 | Batch reads + bulk writes; throughput over latency | Large, scheduled, suspend between loads | No clustering needed (full scans) |
| **Regulatory Reporting** | 50:1 | Fixed report templates; quarterly peaks; audit required | Medium, scheduled for report windows | Cluster by regulatory period (quarter, fiscal year) |
| **Data Science** | 20:1 | Large scans with sampling; statistical operations | Medium-Large, auto-suspend, GPU-optional | Minimal clustering; use sampling to reduce scan |
| **Data Sharing** | 1000:1 | Read-only consumers of shared datasets | Small, consumer-managed, read-only | Inherits producer's clustering |
| **Real-Time Dashboard** | 200:1 | Sub-5s freshness; streaming micro-batch | Small, always-on, paired with streaming ingestion | Cluster by event timestamp |

### Query Concurrency Planning

```
Concurrency Model:

  effective_concurrency = warehouse_nodes × threads_per_node × (1 - coordination_overhead)

  Example (Medium warehouse, 8 nodes):
    threads_per_node = 16 (limited by memory, not CPU)
    coordination_overhead = 0.15 (cross-node shuffle, plan distribution)
    effective_concurrency = 8 × 16 × 0.85 = 108 concurrent query fragments

  But: each query uses 1-50 fragments depending on parallelism
    - Simple aggregation: 1-4 fragments (1 per partition group)
    - Multi-table join: 8-32 fragments (1 per node per pipeline stage)
    - Full table scan: 50+ fragments (1 per partition range per node)

  Practical concurrent queries at p99 < 5s:
    - Light queries (BI dashboard): 50-80 concurrent
    - Medium queries (ad-hoc): 20-40 concurrent
    - Heavy queries (full scan): 5-10 concurrent
    - Mixed workload: ~40 concurrent total
```
