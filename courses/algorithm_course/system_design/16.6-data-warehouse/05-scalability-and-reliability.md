# Scalability & Reliability — Data Warehouse

## Scalability

### Horizontal vs. Vertical Scaling

| Aspect | Vertical Scaling | Horizontal Scaling |
|--------|-----------------|-------------------|
| Approach | Larger compute nodes (more CPU, RAM) | More compute nodes per warehouse |
| Query performance | More memory for joins/sorts; fewer spills | More parallelism for scan-heavy queries |
| Capacity ceiling | Limited by largest available instance | Theoretically unlimited |
| Cost model | Linear (2x resources = 2x cost) | Sub-linear (adding nodes adds parallelism) |
| Warm-up time | Seconds (resize existing cluster) | Seconds (add nodes, populate cache gradually) |
| When to use | Complex queries hitting memory limits | High concurrency or scan-heavy workloads |

**Strategy:** Use vertical scaling (larger warehouse size) when individual queries are memory-bound (large joins, sorts). Use horizontal scaling (more clusters or multi-cluster warehouses) when the Slowest part of the process is concurrent query throughput.

### Elastic Compute Scaling

```
FUNCTION auto_scale_warehouse(warehouse, metrics):
    // Scale UP: add compute clusters when queries are queuing
    IF metrics.query_queue_depth > QUEUE_THRESHOLD
       AND metrics.queue_wait_time_p95 > 5_SECONDS:
        new_cluster_count = MIN(
            warehouse.current_clusters + 1,
            warehouse.max_clusters
        )
        provision_cluster(warehouse, new_cluster_count)
        // New cluster starts accepting queued queries immediately
        // SSD cache warms organically from query traffic

    // Scale DOWN: remove idle clusters to save cost
    IF metrics.cluster_utilization < 0.1
       AND metrics.active_queries == 0
       AND time_since_last_query > IDLE_TIMEOUT:
        IF warehouse.current_clusters > warehouse.min_clusters:
            drain_cluster(warehouse, warehouse.current_clusters - 1)
            // Drain: stop accepting new queries, wait for in-flight to complete

    // Auto-suspend: pause entire warehouse when idle
    IF ALL clusters idle for > warehouse.auto_suspend_timeout:
        suspend_warehouse(warehouse)
        // Compute cost drops to zero; SSD cache retained for resume
```

### Storage Scaling

Storage scales independently of compute through object storage:

| Storage Tier | Use Case | Latency | Cost Model |
|-------------|----------|---------|------------|
| Hot (NVMe SSD cache) | Frequently queried partitions | ~100 μs | Per node, included in compute cost |
| Warm (object storage, standard) | Active tables within retention window | ~50 ms first byte | Per GB/month |
| Cold (object storage, archive) | Historical data, compliance retention | ~hours (retrieval) | Per GB/month (5-10x cheaper) |

**Tiered storage lifecycle:**

```mermaid
---
config:
  theme: base
  look: neo
---
flowchart LR
    Ingest["New Data"] --> Hot["Hot<br/>(SSD Cache)"]
    Hot -->|"Query frequency drops"| Warm["Warm<br/>(Object Storage)"]
    Warm -->|"Age > retention threshold"| Cold["Cold<br/>(Archive Storage)"]
    Cold -->|"Compliance expiry"| Delete["Delete"]

    classDef hot fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef warm fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef cold fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef del fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class Hot hot
    class Warm warm
    class Cold cold
    class Delete del
```

### Multi-Cluster Warehouse Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Workload Manager                                             │
│ - Routes queries to least-loaded cluster                     │
│ - Provisions/deprovisions clusters based on queue depth      │
│ - Scaling policy: Standard (favor performance) or            │
│   Economy (favor cost — wait before scaling)                 │
└───────┬──────────┬──────────┬──────────┬────────────────────┘
        │          │          │          │
   ┌────▼───┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────┐
   │Cluster 1│ │Cluster 2│ │Cluster 3│ │Cluster N│
   │ (base)  │ │ (auto)  │ │ (auto)  │ │ (auto)  │
   │ 4 nodes │ │ 4 nodes │ │ 4 nodes │ │ 4 nodes │
   │ Always  │ │ On-     │ │ On-     │ │ On-     │
   │ running │ │ demand  │ │ demand  │ │ demand  │
   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
        │           │           │           │
        └───────────┴───────────┴───────────┘
                        │
            ┌───────────▼───────────┐
            │  Shared Object Storage │
            │  (Micro-Partitions)    │
            └───────────────────────┘
```

All clusters read the same data in object storage — no data duplication. Each cluster maintains its own SSD cache that warms independently.

### Caching Layers

| Layer | Component | Strategy | Scope | Size |
|-------|-----------|----------|-------|------|
| L1 | Result cache | Exact query match; invalidated on data change | Cross-warehouse | 100 GB shared |
| L2 | Metadata cache | Table schemas, zone maps, statistics | Cloud services layer | 50 GB per node |
| L3 | Local SSD cache | Micro-partition data | Per compute node | 2 TB NVMe per node |
| L4 | Columnar buffer | Decompressed column batches in memory | Per query execution | Up to 80% of node RAM |

### Hot Spot Mitigation

| Hot Spot Type | Cause | Mitigation |
|--------------|-------|------------|
| Single large table scan | One table dominates all queries | Partition across all nodes; materialized views for common aggregations |
| Metadata hot key | Popular table schema accessed by every query | Metadata cache with long TTL; read replicas |
| SSD cache thrashing | Working set exceeds cache capacity | Prioritize cache for high-frequency queries; LRU with frequency weighting |
| Skewed partition sizes | Data distribution creates oversized partitions | Automatic re-partitioning to target 50-500 MB per partition |

### Auto-Scaling Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| Query queue time (p95) | > 5 seconds sustained | Add compute cluster |
| Cluster CPU utilization | > 80% sustained 10 min | Scale up warehouse size |
| SSD cache hit ratio | < 60% | Add nodes (more cache) or scale up (more RAM) |
| Spill-to-disk ratio | > 20% of data processed | Scale up warehouse size (more memory) |
| Query queue depth | 0 for 10+ minutes | Remove surplus compute cluster |
| All clusters idle | > auto-suspend timeout | Suspend warehouse |

### Back-Pressure Mechanisms

When the system is overloaded, back-pressure prevents cascading failure:

```
FUNCTION apply_back_pressure(warehouse, metrics):
    // Level 1: Query queuing (transparent to user)
    IF metrics.active_queries >= warehouse.max_concurrent:
        queue_new_queries(FIFO (First-In-First-Out, like a line at a store))
        // Queries wait up to queue_timeout before returning error

    // Level 2: Adaptive throttling (visible to user)
    IF metrics.query_queue_depth > HIGH_WATERMARK:
        // Reject new queries from low-priority workloads
        FOR EACH incoming_query:
            IF incoming_query.priority < MEDIUM:
                RETURN ERROR "503: Warehouse overloaded. Retry with backoff."
        // Allow high-priority (BI dashboard) queries through

    // Level 3: Resource governance (per-query limits)
    IF metrics.total_memory_usage > 0.9 * total_memory:
        // Reduce per-query memory allocation
        new_memory_limit = per_query_limit * 0.5
        // Queries that exceed reduced limit will spill to disk (slower but safe)

    // Level 4: Circuit breaker (system protection)
    IF metrics.query_error_rate > 0.1:
        // Stop accepting all queries; return cached results only
        enable_read_only_mode()
        alert(CRITICAL, "Warehouse in degraded mode")
```

**Back-pressure signals exposed to clients:**

| Signal | Mechanism | Client Action |
|--------|-----------|---------------|
| Queue wait time in response header | HTTP header `X-Queue-Wait-Ms` | Monitor for increasing wait; reduce query rate |
| 429 Too Many Requests | HTTP status code | Exponential backoff with jitter |
| 503 Service Unavailable | HTTP status code | Switch to backup warehouse or cached data |
| Estimated wait time in error message | Error body | Display to user; suggest off-peak timing |

### Scalability Limits

| Dimension | Practical Limit | Constraint |
|-----------|----------------|------------|
| Single query scan | ~100 TB per query | Network bandwidth × compute time; bounded by timeout |
| Concurrent queries per cluster | 200 | Memory budget per query becomes too small beyond this |
| Partitions per table | 500K | Metadata operations (zone map scan) become Slowest part of the process |
| Columns per table | 2,000 | Schema metadata size; query compilation time |
| Clusters per warehouse | 10 | Object storage GET rate limiting per prefix |
| Total compressed storage | Exabyte-scale | Object storage has no practical limit |
| Warehouse resume time | < 5 seconds cold | Container/VM provisioning + SSD cache warm-up |
| Cross-region query | 100-500ms overhead | Speed of light constraint for data transfer |

### Capacity Planning Formulas

```
Storage Capacity:
  compressed_storage = daily_raw_ingestion × compression_ratio × retention_days
  total_storage = compressed_storage × (1 + time_travel_overhead + mv_overhead)
  Example: 500 GB/day × 0.1 × 365 days × 1.4 = 25.55 TB

Compute Sizing:
  min_nodes = peak_concurrent_queries × avg_memory_per_query / memory_per_node
  Example: 50 queries × 4 GB / 256 GB = 1 node (memory bound)
           50 queries × 2 cores / 32 cores = 3 nodes (CPU bound)
           → choose MAX(memory_bound, cpu_bound) = 3 nodes

Cache Sizing:
  ssd_cache_target = hot_working_set × (1 - target_miss_rate)
  hot_working_set = tables accessed in last 7 days (compressed size)
  Example: 5 TB hot set × 0.8 hit rate = 4 TB SSD cache needed
           → 2 nodes × 2 TB NVMe each

Network Bandwidth:
  peak_bandwidth = peak_qps × avg_bytes_scanned_per_query × (1 - cache_hit_rate)
  Example: 50 QPS × 100 MB × 0.2 cache miss = 1 GB/s sustained
           → 10 Gbps network per node
```

---

## Multi-Region Architecture

```mermaid
---
config:
  theme: base
  look: neo
---
flowchart TB
    subgraph Primary["Primary Region (US-East)"]
        CS1[Cloud Services]
        W1[Compute Cluster]
        S1[(Object Storage)]
        M1[Metadata Store<br/>Leader]
    end

    subgraph DR["DR Region (US-West)"]
        CS2[Cloud Services<br/>Standby]
        W2[Compute Cluster<br/>Warm Standby]
        S2[(Object Storage<br/>Replica)]
        M2[Metadata Store<br/>Follower]
    end

    CS1 --> W1
    W1 --> S1
    CS1 --> M1
    S1 -->|"Async replication"| S2
    M1 -->|"Sync replication"| M2
    CS2 --> W2
    W2 --> S2
    CS2 --> M2

    classDef primary fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef dr fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class CS1,W1,S1,M1 primary
    class CS2,W2,S2,M2 dr
```

### Chaos Engineering Experiments

| Experiment | Target | Expected Outcome | Recovery Metric |
|-----------|--------|-------------------|----------------|
| Kill single compute node | Compute cluster | In-flight fragments redistributed; queries complete with delay | < 30s additional latency |
| Kill entire compute cluster | One workload tier | Queries routed to other clusters or queued | < 60s to route to surviving cluster |
| Partition metadata store leader | Metadata availability | Raft election completes; queries retry | < 10s metadata unavailability |
| Inject object storage latency (500ms) | Storage layer | SSD cache absorbs most reads; cold queries delayed | Cache hit rate metrics spike |
| Corrupt SSD cache on one node | Cache layer | Node detects corruption via checksum; rebuilds from object storage | Cache rebuild time < 5 min |
| Simulate region failover | DR readiness | Standby region accepts queries within RTO | < 15 min total failover time |
| Exhaust memory on compute node | Resource limits | Graceful spill-to-disk; no OOM crash | Spill metrics captured; query completes |
| Inject clock skew on metadata nodes | Raft consensus | Leader lease expires; new election triggers | < 10s to new leader |

### Data Archival Strategy

```
FUNCTION manage_storage_lifecycle(table, policy):
    FOR EACH partition IN table.partitions:
        age = NOW() - partition.created_at
        last_accessed = partition.last_query_access_time

        IF age > policy.archive_after AND last_accessed > policy.cold_threshold:
            // Move to archive storage tier
            archive_partition(partition, ARCHIVE_TIER)
            // Update zone map to indicate archive tier (slower retrieval)
            update_metadata(partition, tier=ARCHIVE)

        ELSE IF age > policy.warm_after AND last_accessed > policy.warm_threshold:
            // Ensure partition is in warm tier (standard object storage)
            IF partition.tier == HOT:
                demote_partition(partition, WARM_TIER)

        IF age > policy.retention_period:
            // Check for legal hold or time travel dependency
            IF NOT has_legal_hold(partition) AND NOT in_time_travel_window(partition):
                delete_partition(partition)
                update_metadata_remove(partition)
```

### DR Runbook

**Phase 1: Detection (0-2 minutes)**
1. Automated health checks detect primary region unresponsive
2. Cross-region heartbeat timeout triggers (30-second intervals)
3. Alerting system pages on-call and initiates automated assessment

**Phase 2: Decision (2-5 minutes)**
1. Verify outage is not a false positive (check cloud provider status)
2. Assess scope: full region outage vs. partial service degradation
3. Decision to failover requires human approval (prevent split-brain)

**Phase 3: Failover (5-15 minutes)**
1. Promote DR metadata store follower to leader
2. Resume standby compute clusters in DR region
3. Update DNS/load balancer to route queries to DR region
4. Verify data consistency: compare metadata version with last replication checkpoint
5. Accept queries — data may be up to RPO (5 minutes) stale

**Phase 4: Validation (15-30 minutes)**
1. Execute validation queries against known-good results
2. Verify ingestion pipeline can reach DR region
3. Notify stakeholders of partial data freshness during failover period

**Phase 5: Failback (when primary recovers)**
1. Re-synchronize object storage from DR → primary (delta sync)
2. Re-synchronize metadata store
3. Validate primary region consistency
4. Gradual traffic shift back to primary (canary → 50% → 100%)

---

## Reliability & Fault Tolerance

### Single Points of Failure

| Component | SPOF Risk | Mitigation |
|-----------|-----------|------------|
| Cloud services layer | Loss stops query parsing and routing | Multiple stateless instances behind load balancer |
| Metadata store | Loss prevents schema resolution | 3-node replicated key-value store with Raft consensus |
| Compute node | Loss interrupts in-flight queries | Stateless; queries retried on remaining nodes |
| Object storage | Loss causes data loss | Cloud-provider managed 11-nines durability across AZs |
| Result cache | Loss causes performance degradation | Distributed cache with replication; cache miss falls through to compute |

### Redundancy Strategy

- **Cloud services:** 3+ stateless instances across availability zones with health-check routing
- **Metadata store:** 3-node Raft cluster with cross-AZ placement; write quorum of 2
- **Compute clusters:** Each warehouse has N nodes; loss of 1 node redistributes work to N-1 with automatic retry
- **Object storage:** Cloud-managed, triple-replicated across availability zones by default
- **Result cache:** Distributed cache ring with 2x replication

### Failover Mechanisms

**Compute Node Failure:**

```
1. Workload manager detects node heartbeat timeout (10 seconds)
2. In-flight query fragments on failed node are identified
3. Fragments reassigned to surviving nodes in the same cluster
4. Surviving nodes fetch required partitions (from SSD cache or object storage)
5. Query resumes from last checkpoint (no full restart needed)
6. Replacement node provisioned in background

Total query impact: 10-30 second delay for affected queries
Zero impact on queries running on other nodes
```

**Metadata Store Failure:**

```
1. Raft follower detects leader heartbeat timeout (5 seconds)
2. Election completes in < 5 seconds
3. New leader serves metadata requests
4. Cloud services layer retries pending metadata lookups

Total impact: < 10 seconds of metadata unavailability
Queries already compiled and executing are unaffected
```

### Circuit Breaker Pattern

| Circuit | Trigger | Open Duration | Fallback |
|---------|---------|---------------|----------|
| Object storage fetch | > 50% timeouts in 60s | 30 seconds | Serve from SSD cache only; reject uncached queries |
| Metadata service | > 3 failures in 30s | 15 seconds | Serve from local metadata cache (may be slightly stale) |
| Cross-cluster shuffle | > 30% failures in 60s | 30 seconds | Execute join locally (slower) or return partial results |
| Result cache | > 5 failures in 30s | 60 seconds | Bypass cache; execute queries directly |

### Retry Strategy

| Operation | Retry Count | Backoff | Notes |
|-----------|-------------|---------|-------|
| Object storage read | 3 | Exponential (200ms, 400ms, 800ms) | Switch to different AZ endpoint on retry |
| Query fragment execution | 2 | Immediate (reassign to different node) | Fragment-level retry, not full query |
| Metadata lookup | 3 | Exponential (100ms, 200ms, 400ms) | Retry against different replica |
| Query compilation | 1 | Immediate | Fall back to simplified plan if optimization times out |

### Graceful Degradation

| Severity | Condition | Degradation |
|----------|-----------|-------------|
| Level 1 | Single compute node down | Query fragments redistributed; slight latency increase |
| Level 2 | Entire compute cluster down | Queries routed to other clusters; auto-provision replacement |
| Level 3 | Metadata store degraded | Serve from cache; new table DDL blocked |
| Level 4 | Object storage latency spike | SSD-cached queries unaffected; cold queries delayed |
| Level 5 | Full region outage | Failover to standby region; stale data until replication catches up |

### Bulkhead Pattern

Separate resource pools for different workload types:

| Bulkhead | Resources | Purpose |
|----------|-----------|---------|
| BI dashboards | Dedicated warehouse, priority routing | Protect dashboard latency from ad-hoc queries |
| ETL / loading | Dedicated warehouse, isolated compute | Prevent bulk loads from starving query workloads |
| Ad-hoc analytics | Separate warehouse, elastic scaling | Allow exploratory queries without impacting production |
| System operations | Reserved metadata capacity | Schema changes, access policy updates |

---

## Disaster Recovery

### Recovery Objectives

| Metric | Target | Strategy |
|--------|--------|----------|
| RPO (same region) | 0 | Data in object storage with immediate consistency |
| RTO (same region) | < 60 seconds | Stateless compute re-provisioned from object storage |
| RPO (cross-region) | < 5 minutes | Asynchronous replication of object storage and metadata |
| RTO (cross-region) | < 15 minutes | Standby metadata store promoted + compute provisioned |

### Backup Strategy

| Backup Type | Frequency | Retention | Method |
|-------------|-----------|-----------|--------|
| Time travel snapshots | Continuous | 1-90 days (configurable) | Retain old micro-partitions in object storage |
| Metadata snapshot | Continuous | 30 days | Replicated metadata store with point-in-time recovery |
| Cross-region replication | Continuous | Same as primary | Async object storage replication + metadata sync |
| Compliance archive | Monthly | 7 years | Cold storage with write-once-read-many (WORM) policy |

### Multi-Region Considerations

| Topology | Write Latency | Read Latency | Consistency | Complexity |
|----------|--------------|-------------|-------------|------------|
| Single-region, multi-AZ | Low | Low | Strong | Low |
| Active-passive cross-region | Low in primary | Low in primary | Strong in primary | Medium |
| Active-active cross-region | Medium | Low (local reads) | Eventual | Very High |

**Recommendation:** Active-passive for most analytical workloads. Data is ingested and managed in the primary region; the standby region maintains a replicated copy for disaster recovery. Active-active is rarely justified for data warehouses because analytical workloads are latency-tolerant and data freshness requirements (< 60s) are easily met with single-region deployment.

---

## Performance Tuning Guide

| Parameter | Default | Tuning Guidance | Impact |
|-----------|---------|----------------|--------|
| Warehouse size | Medium (8 nodes) | Scale up if spill-to-disk > 10%; scale down if CPU < 30% | Directly affects query latency and cost |
| Clustering key | None | Choose the most-filtered column in the most-frequent queries | 10-100x scan reduction for filtered queries |
| Auto-suspend timeout | 10 min | Shorter for dev (1 min); longer for production with steady traffic (15 min) | Cost vs. cold-start latency |
| Multi-cluster mode | Disabled | Enable for > 20 concurrent queries; set min=1, max=3 clusters | Concurrency capacity vs. cost |
| Result cache | Enabled | Disable for workloads with unique queries (data science exploration) | Cache overhead vs. hit rate |
| Time travel retention | 1 day | Extend for compliance tables; keep short for staging tables | Storage cost vs. recovery window |
| Micro-partition target size | 100 MB compressed | Larger (250 MB) for scan-heavy workloads; smaller (50 MB) for point queries | Cutting off unnecessary steps granularity vs. metadata overhead |

### Scaling Case Study: 5 TB → 200 TB Growth

**Phase 1: 5 TB (Month 6)**
- Single 8-node medium warehouse for all workloads
- No clustering keys (data too small to matter)
- Auto-suspend at 10 minutes
- Monthly cost: ~$8K

**Phase 2: 50 TB (Year 1)**
- Split into 3 warehouses: BI (medium), ETL (large), ad-hoc (small, elastic)
- Clustering keys on top 10 fact tables by query volume
- Materialized views for top 20 dashboard queries
- Monthly cost: ~$35K (cluster keys saved $15K vs. unclustered)

**Phase 3: 200 TB (Year 3)**
- 6 warehouses: 2 BI (multi-cluster), ETL (XL), ad-hoc (elastic), data science (GPU-enabled), data sharing (read-only)
- Tiered storage: 50 TB hot, 100 TB warm, 50 TB cold archive
- Automated physical design advisor recommends clustering keys and materialized views
- Per-query cost tracking and chargeback per business unit
- Monthly cost: ~$120K (Cutting off unnecessary steps and caching save $80K vs. naive approach)

### Node Decommissioning Algorithm

```
FUNCTION decommission_compute_node(node, warehouse):
    // Step 1: Stop accepting new query fragments
    node.status = DRAINING
    warehouse.routing.remove(node)

    // Step 2: Wait for in-flight fragments to complete
    WHILE node.active_fragments > 0:
        WAIT(check_interval=1_SECOND)
        IF elapsed > MAX_DRAIN_TIME:
            // Force-cancel remaining fragments; they will be retried on other nodes
            FOR EACH fragment IN node.active_fragments:
                cancel_fragment(fragment)
                reschedule_fragment(fragment, warehouse.healthy_nodes)
            BREAK

    // Step 3: Preserve SSD cache state for potential re-use
    IF warehouse.cache_retention_enabled:
        snapshot_cache_metadata(node.ssd_cache)

    // Step 4: Release compute resources
    release_node(node)
    warehouse.node_count -= 1

    // Step 5: Verify cluster health
    IF warehouse.node_count < warehouse.min_nodes:
        alert(WARNING, "Warehouse below minimum node count")
        provision_replacement_node(warehouse)
```
