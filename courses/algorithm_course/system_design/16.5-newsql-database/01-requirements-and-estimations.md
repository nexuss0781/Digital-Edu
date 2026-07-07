# Requirements & Estimations — NewSQL Database

## Functional Requirements

### Core Features (Must-Have)

| # | Requirement | Description |
|---|------------|-------------|
| F1 | **SQL Query Processing** | Parse, optimize, and execute standard SQL queries (SELECT, INSERT, UPDATE, DELETE) with joins, subqueries, aggregations, and CTEs |
| F2 | **Distributed ACID Transactions** | Multi-row, multi-range transactions with serializable isolation; support for BEGIN, COMMIT, ROLLBACK, and SAVEPOINT |
| F3 | **Automatic Sharding** | Transparently partition tables into ranges based on primary key ordering; automatically split and merge ranges based on size/load |
| F4 | **Consensus Replication** | Replicate each range across multiple nodes via Raft consensus; tolerate minority node failures without data loss |
| F5 | **Secondary Indexes** | Create and maintain global and local secondary indexes that are automatically distributed and kept consistent with base data |
| F6 | **Online Schema Changes** | Add/drop columns, create/drop indexes, and alter constraints without blocking reads or writes |
| F7 | **SQL Wire Protocol Compatibility** | Support PostgreSQL or MySQL wire protocol so existing applications and tools connect without modification |
| F8 | **Distributed Query Execution** | Plan and execute queries that span multiple ranges with pushdown optimization, distributed joins, and parallel scan |

### Extended Features (Nice-to-Have)

| # | Requirement | Description |
|---|------------|-------------|
| E1 | **Multi-Region Placement** | Pin ranges to specific regions with zone configurations; support locality-aware reads for low-latency access |
| E2 | **Change Data Capture (CDC)** | Stream row-level changes to external systems for event-driven architectures |
| E3 | **Follower Reads** | Serve slightly stale but consistent reads from follower replicas to reduce leaseholder load |
| E4 | **Columnar Analytics** | Maintain columnar replicas of selected tables for analytical queries (HTAP) |
| E5 | **JSON / Semi-Structured Data** | Support JSON columns with indexing and query operators alongside relational data |
| E6 | **Serverless Compute** | Scale-to-zero SQL compute nodes for development/staging; burst scaling for production spikes |
| E7 | **Vector Column Support** | Native vector data type with ANN index for hybrid transactional-vector workloads |
| E8 | **Distributed Savepoints** | Transaction savepoints that span multiple ranges, enabling partial rollback within distributed transactions |
| E9 | **Query-Level Resource Governors** | Per-query CPU time limits, memory budgets, and I/O quotas to prevent runaway queries |
| E10 | **Multi-Tenancy Isolation** | Resource isolation between tenants: separate admission control queues, storage quotas, and QPS limits per tenant |

### Out of Scope

- Full-text search engine (delegate to dedicated search infrastructure)
- Graph traversal queries (delegate to graph database)
- Blob/object storage (delegate to object storage service)
- Stream processing (delegate to external event pipeline)
- Machine learning model serving (delegate to ML serving infrastructure)
- Time-series ingestion at >1M events/sec (delegate to purpose-built time-series database)

### Migration Requirements (from Traditional RDBMS)

| Requirement | Description |
|------------|-------------|
| Wire protocol compatibility | Connect via existing PostgreSQL/MySQL drivers without code changes |
| SQL dialect coverage | Support 95%+ of source database SQL syntax (functions, CTEs, window functions) |
| Schema migration tooling | Automated schema comparison and migration script generation |
| Data migration | Online data migration with zero-downtime cutover (CDC-based replication from source) |
| Rollback capability | Ability to fall back to source database within 24 hours of cutover |
| Performance parity | Point read latency within 2x of source database (accounting for consensus overhead) |
| Monitoring parity | Equivalent dashboards and alerting for the new database |

---

## Non-Functional Requirements

### Latency Budget Breakdown (Single-Range Write)

```
Operation                      Time      Cumulative
────────────────────────────────────────────────────
SQL parse + optimize           0.3ms     0.3ms
Route to leaseholder           0.1ms     0.4ms
Write to memtable              0.05ms    0.45ms
WAL fsync                      0.1ms     0.55ms
Raft AppendEntries (2 replicas)
  ├─ Network RTT (same AZ)     0.5ms     1.05ms
  └─ Follower WAL fsync        0.1ms     1.15ms
Quorum acknowledgment          —         1.15ms
Apply to state machine         0.05ms    1.2ms
Return to client               0.1ms     1.3ms
────────────────────────────────────────────────────
Total (same-AZ, best case):    ~1.3ms
Total (cross-AZ):              ~3-5ms (AZ RTT adds 1-3ms)
Total (cross-region):          ~40-150ms (region RTT dominates)
```

### CAP Theorem Choice

**CP — Strong Consistency** — A NewSQL database prioritizes consistency and partition tolerance. Distributed ACID transactions require that all committed writes are immediately visible to subsequent reads across all nodes. During a network partition, the minority partition becomes unavailable for writes (Raft requires majority quorum), preserving consistency at the cost of availability for the affected ranges.

| Property | Choice | Justification |
|----------|--------|---------------|
| Consistency | Strong (serializable) | Financial transactions, inventory, and user accounts cannot tolerate stale or inconsistent reads |
| Availability | High but not absolute | Brief unavailability during leader election (5-10s) or minority partition is acceptable |
| Partition Tolerance | Required | Geo-distributed clusters must survive network partitions between regions |

### Performance Targets

| Metric | Target | Context |
|--------|--------|---------|
| Point read latency (single range) | < 2 ms (p50), < 10 ms (p99) | Primary key lookup within one range |
| Point write latency (single range) | < 5 ms (p50), < 20 ms (p99) | Single-row INSERT/UPDATE with Raft consensus |
| Distributed transaction (2 ranges) | < 15 ms (p50), < 50 ms (p99) | Cross-range transaction with parallel commits |
| Distributed transaction (5+ ranges) | < 30 ms (p50), < 100 ms (p99) | Wide-scatter transactions touching many ranges |
| Simple query (indexed scan, 100 rows) | < 10 ms (p50), < 50 ms (p99) | Range scan with predicate pushdown |
| Complex query (join, aggregation) | < 200 ms (p50), < 1s (p99) | Multi-table join with distributed execution |
| Online schema change | Zero-downtime | Add column or create index without blocking DML |

### Durability & Availability

| Metric | Target |
|--------|--------|
| Availability | 99.999% (5.26 min/year downtime) |
| Durability | 99.999999999% (11 nines) |
| RPO (single region) | 0 seconds (synchronous Raft replication) |
| RTO (single region) | < 10 seconds (automatic Raft leader election) |
| RPO (cross-region) | < 1 second (synchronous multi-region quorum) |
| RTO (cross-region) | < 30 seconds (leader election + DNS failover) |

---

## Capacity Estimations (Back-of-Envelope)

### Scenario: Global Financial Services Platform

A financial platform serving 50M active accounts across 3 regions, handling payment transactions, account management, and real-time balance queries.

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Total rows (Year 1) | 10B | 50M accounts x 200 avg rows per account (transactions, balances, metadata) |
| Row size (average) | 256 bytes | Primary key (16B) + MVCC timestamp (12B) + columns (180B) + overhead (48B) |
| Read QPS (average) | 200K | Balance checks, account lookups, reporting queries |
| Read QPS (peak) | 800K | 4x average during peak trading / end-of-month |
| Write QPS (average) | 50K | Payment transactions, account updates, audit records |
| Write QPS (peak) | 200K | 4x average |
| Transaction size (average) | 3 statements | Read balance, write debit, write credit |
| Ranges (average) | 100K | 10B rows x 256B = 2.56 TB / 64 MB default range size |
| Raft groups | 100K | One per range, each with 3-5 replicas |
| Raw data storage (Year 1) | 2.56 TB | 10B rows x 256 bytes |
| MVCC versions | 2x raw | GC window of 24 hours retains ~2x live data |
| Index storage | 1x raw | Secondary indexes roughly equal to base data |
| Total logical storage | ~8 TB | Data + MVCC versions + indexes + WAL |
| Replication factor | 3x | Standard 3-replica Raft groups |
| Total physical storage | ~24 TB | 8 TB x 3 replicas |
| Cluster size | 15-20 nodes | Each node: 2 TB NVMe SSD, 64 GB RAM, 16 vCPUs |
| Memory per node (hot set) | 48 GB | Block cache + MVCC intent cache + connection pools |
| Network bandwidth (inter-node) | 10 Gbps | Raft replication + distributed query traffic |

### Storage Architecture Summary

```
Total Logical Data:     ~8 TB (Year 1)
Replication Factor:     3x
Total Physical Storage: ~24 TB
Cluster Size:           15-20 nodes x 2 TB NVMe + 64 GB RAM
Range Count:            ~100K ranges (64 MB each)
Raft Groups:            ~100K (one per range)
MVCC GC Window:         25 hours (configurable)
```

---

## SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Availability | 99.999% | Percentage of successful queries within latency target |
| Read Latency (p99) | < 10 ms | Point read measured at client, single region |
| Write Latency (p99) | < 20 ms | Single-range write measured at client |
| Transaction Latency (p99) | < 50 ms | Cross-range distributed transaction |
| Error Rate | < 0.001% | Percentage of queries returning server errors |
| Throughput | > 200K read QPS, > 50K write QPS | Sustained cluster-wide throughput |
| Data Freshness | 0 ms (strong reads) | Reads always see latest committed data |
| Recovery Time | < 10 seconds | Time to elect new Raft leader after failure |
| Replication Lag | 0 (synchronous) | Raft guarantees zero lag for committed writes |

---

## Read/Write Ratio Analysis

| Workload Type | Read:Write | Dominant Operation |
|---------------|------------|-------------------|
| Financial transactions | 4:1 | Balance checks, transfers, audit queries |
| E-commerce inventory | 10:1 | Product lookups, stock checks, order writes |
| User account management | 20:1 | Authentication, profile reads, occasional updates |
| SaaS multi-tenant | 8:1 | Tenant data queries, document reads, writes |
| IoT device registry | 5:1 | Device state reads, telemetry writes |
| Analytics + OLTP mixed | 3:1 | Reporting queries + transactional writes |

**Overall weighted ratio: ~8:1 (read-heavy with significant write volume)**

---

## Growth Projections

| Stage | Timeline | Data Size | QPS (Read/Write) | Cluster Size | Ranges |
|-------|----------|-----------|-------------------|-------------|--------|
| **Pilot** | Month 0-6 | 500 GB | 20K / 5K | 3 nodes | 8K |
| **Production** | Month 6-18 | 5 TB | 100K / 25K | 9 nodes | 80K |
| **Scale** | Year 1-3 | 25 TB | 500K / 100K | 30 nodes | 400K |
| **Global** | Year 3+ | 100+ TB | 2M / 400K | 100+ nodes (multi-region) | 1.5M+ |

### Infrastructure Scaling by Stage

| Component | Pilot | Production | Scale | Global |
|-----------|-------|------------|-------|--------|
| Node spec | 8 vCPU, 32 GB, 1 TB NVMe | 16 vCPU, 64 GB, 2 TB NVMe | 32 vCPU, 128 GB, 4 TB NVMe | 32 vCPU, 128 GB, 4 TB NVMe |
| Regions | 1 | 1 (multi-AZ) | 1-2 | 3+ |
| Replication | 3x | 3x | 3-5x | 5x for global tables |
| NTP strategy | Default NTP | Chrony (10-50ms) | PTP where available (<1ms) | PTP + HLC tuning |
| Backup | Daily full | Continuous incremental + daily full | Continuous + cross-region | Continuous + geo-backup |

### Key Capacity Thresholds

| Threshold | Impact | Action Required |
|-----------|--------|----------------|
| > 10K ranges per node | Raft heartbeat overhead degrades latency | Add nodes or increase range size |
| > 70% disk utilization | Risk of write stalls on compaction spike | Expand storage or add nodes |
| > 250ms clock offset | Read restart rate exceeds 2% | Upgrade to chrony/PTP; investigate NTP sources |
| > 30x write amplification | Disk bandwidth saturated by compaction | Switch to tiered compaction; add I/O capacity |
| > 5% transaction abort rate | Contention-driven throughput collapse | Redesign hot key access patterns; split hot ranges |

---

## Cost Estimation by Stage

| Stage | Monthly Compute | Monthly Storage | Monthly Network | Total Monthly |
|-------|----------------|----------------|----------------|---------------|
| **Pilot** (3 nodes) | $1,200 | $400 | $200 | ~$1,800 |
| **Production** (9 nodes) | $7,200 | $2,500 | $1,000 | ~$10,700 |
| **Scale** (30 nodes) | $36,000 | $12,000 | $5,000 | ~$53,000 |
| **Global** (100 nodes, 3 regions) | $150,000 | $50,000 | $30,000 | ~$230,000 |

**Cost drivers by component:**

| Component | % of Total Cost | Scaling Driver |
|-----------|----------------|----------------|
| Compute (CPU/memory) | 55-65% | QPS and concurrent connection count |
| Storage (NVMe SSD) | 20-25% | Data size × replication factor × MVCC version overhead |
| Network (cross-AZ/region) | 10-15% | Raft replication traffic + distributed query fan-out |
| Backup storage | 3-5% | Incremental backups + retention window |

---

## Organizational Requirements at Scale

| Team | Responsibility | Headcount (at Scale stage) |
|------|---------------|---------------------------|
| Database Platform | Core engine development: SQL layer, transaction coordinator, storage engine | 8-15 engineers |
| Distributed Systems | Raft consensus, range management, clock synchronization | 5-8 engineers |
| Query Optimization | Cost-based optimizer, statistics collection, plan caching | 3-5 engineers |
| Reliability / SRE | Cluster operations, capacity planning, incident response, chaos testing | 4-6 engineers |
| Security | Encryption, RBAC, audit logging, compliance | 2-3 engineers |
| Ecosystem / Tooling | CDC, backup/restore, migration tools, monitoring dashboards | 3-5 engineers |

---

## Workload Profiles and Hardware Recommendations

| Workload Profile | Read:Write | Key Characteristic | Recommended Node Spec | Range Size |
|-----------------|------------|-------------------|----------------------|-----------|
| **Financial OLTP** | 4:1 | Low-latency point reads/writes; high consistency requirement | 32 vCPU, 128 GB RAM, 2 TB NVMe | 256 MB |
| **E-Commerce** | 10:1 | Heavy catalog reads; inventory write bursts during sales | 16 vCPU, 64 GB RAM, 2 TB NVMe | 512 MB |
| **Multi-Tenant SaaS** | 8:1 | Tenant isolation; variable workload per tenant | 16 vCPU, 64 GB RAM, 4 TB NVMe | 256 MB |
| **IoT Device Registry** | 5:1 | Sequential timestamp inserts; device state lookups | 16 vCPU, 64 GB RAM, 4 TB NVMe | 128 MB |
| **HTAP (mixed)** | 3:1 | Analytical queries alongside OLTP; needs columnar replicas | 32 vCPU, 256 GB RAM, 4 TB NVMe | 512 MB |

### Per-Transaction Resource Cost

| Resource | Estimation Per Transaction | Calculation |
|----------|--------------------------|-------------|
| CPU | 0.5-2 ms of CPU time | Parse (0.1ms) + Optimize (0.1ms) + Execute (0.3-1.5ms) + Raft (0.1ms) |
| Memory | 50-200 KB | Connection buffer (10KB) + query plan (5KB) + result buffer (35-185KB) |
| Disk I/O (write) | 3-10 KB | WAL entry (1-3KB) × replication factor |
| Network | 2-8 KB per replica | Intent data + Raft AppendEntries overhead |
| Disk I/O (compaction, amortized) | 30-300 KB | Write amplification factor × raw write size |

### Storage Overhead Breakdown

```
Given: 1 TB of logical user data

Component                    Size    % of Total
─────────────────────────────────────────────────
Logical data (rows)          1.0 TB   13%
MVCC versions (25h window)   0.35 TB   5%
Secondary indexes            0.8 TB   11%
LSM space amplification      0.3 TB    4%
WAL (in-flight)              0.05 TB   1%
Per-replica total            2.5 TB   33%
×3 replicas                  7.5 TB  100%
─────────────────────────────────────────────────
Effective overhead:           7.5x raw data size
```
