# Requirements & Estimations — Graph Database

## Functional Requirements

### Core Features (Must-Have)

| # | Requirement | Description |
|---|------------|-------------|
| F1 | **Node & Edge CRUD** | Create, read, update, delete vertices and edges with properties and labels |
| F2 | **Pattern Matching** | Declarative queries that match structural patterns (e.g., "find all triangles", "match path A→B→C") |
| F3 | **Graph Traversal** | BFS, DFS, variable-length path traversal with depth limits and filtering |
| F4 | **Shortest Path** | Weighted and unweighted shortest path between two vertices |
| F5 | **Index Management** | B-tree and full-text indexes on node/edge properties for fast lookup |
| F6 | **ACID Transactions** | Multi-statement transactions with read-committed or serializable isolation |
| F7 | **Schema Management** | Optional schema with label constraints, property type enforcement, and uniqueness constraints |
| F8 | **Aggregation** | Group-by, count, sum, avg over traversal results |

### Extended Features (Nice-to-Have)

| # | Requirement | Description |
|---|------------|-------------|
| E1 | **Graph Analytics** | PageRank, community detection, centrality measures, connected components |
| E2 | **Full-Text Search** | Integrated text search across node/edge properties |
| E3 | **Geospatial Queries** | Spatial indexing for location-based graph queries |
| E4 | **Temporal Graphs** | Time-versioned edges and nodes for historical graph queries |
| E5 | **GraphRAG Integration** | Vector embeddings on nodes for hybrid graph + semantic search |
| E6 | **Graph Projections** | In-memory subgraph projections for analytics without mutating the source graph |
| E7 | **Change Data Capture** | Stream graph mutations to downstream consumers in real time |
| E8 | **Multi-Database** | Multiple isolated graph databases within a single cluster with independent schemas |
| E9 | **Role-Based Access Control** | Fine-grained authorization at label, property, and subgraph levels |

### Out of Scope

- General-purpose relational query processing (SQL JOINs, GROUP BY on non-graph data)
- Document storage without graph relationships
- Full-text search engine (dedicated search engine handles this)
- Stream processing (handled by external event pipeline)

---

## Non-Functional Requirements

### CAP Theorem Choice

**CP with tunable consistency** — For online graph queries (fraud detection, access control), strong consistency prevents stale traversals from returning incorrect paths. For analytics workloads, eventual consistency is acceptable.

| Property | Choice | Justification |
|----------|--------|---------------|
| Consistency | Strong (default), Eventual (analytics) | Traversals must see committed writes to avoid phantom relationships |
| Availability | High but not absolute | Brief unavailability during leader failover is acceptable |
| Partition Tolerance | Required | Distributed graph must survive network partitions |

### Performance Targets

| Metric | Target | Context |
|--------|--------|---------|
| Traversal latency (1-hop) | < 1 ms (p50), < 5 ms (p99) | Single-hop neighbor lookup via index-free adjacency |
| Traversal latency (3-hop) | < 10 ms (p50), < 50 ms (p99) | Social graph "friends of friends of friends" |
| Shortest path (6 hops max) | < 100 ms (p50), < 500 ms (p99) | Shortest path in social/fraud graphs |
| Pattern match (simple) | < 50 ms (p50), < 200 ms (p99) | Triangle detection, motif matching |
| Write latency (single node/edge) | < 5 ms (p50), < 20 ms (p99) | Node/edge creation with property indexing |
| Transaction commit | < 20 ms (p50), < 100 ms (p99) | Multi-statement graph mutations |
| Analytics query (PageRank) | < 60 seconds | Full-graph iterative computation |

### Durability & Availability

| Metric | Target |
|--------|--------|
| Availability | 99.99% (52.6 min/year downtime) |
| Durability | 99.999999999% (11 nines) |
| RPO | < 1 second (synchronous replication) |
| RTO | < 30 seconds (automated failover) |

---

## Capacity Estimations (Back-of-Envelope)

### Scenario: Social Graph Platform

A social network with 500M users, average 200 connections per user, serving real-time friend-of-friend queries and recommendation traversals.

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Total Nodes | 500M | 500M user nodes + metadata nodes |
| Total Edges | 50B | 500M users x 200 avg connections / 2 (bidirectional) = 50B edges |
| Read QPS (average) | 500K | 500M DAU / 1000 = 500K QPS (traversal queries) |
| Read QPS (peak) | 2M | 4x average during peak hours |
| Write QPS (average) | 50K | New connections, profile updates, node creation |
| Write QPS (peak) | 200K | 4x average |
| Node record size | 64 bytes | ID (8B) + label pointer (8B) + first-rel pointer (8B) + first-prop pointer (8B) + flags (8B) + padding (24B) |
| Edge record size | 64 bytes | ID (8B) + start-node (8B) + end-node (8B) + type (8B) + next-rel pointers (16B) + first-prop (8B) + flags (8B) |
| Property record size | 128 bytes average | Key-value pairs, variable length with overflow chains |
| Node storage | 32 GB | 500M nodes x 64B |
| Edge storage | 3.2 TB | 50B edges x 64B |
| Property storage | 12.8 TB | ~100B property records x 128B average |
| Total storage (Year 1) | ~20 TB | Nodes + edges + properties + indexes + WAL |
| Total storage (Year 5) | ~100 TB | 5x growth with new features and edge types |
| Index storage | ~4 TB | B-tree indexes on labels, property keys, and full-text |
| Memory (hot set) | 256 GB per node | Relationship chains for active users + traversal caches |
| Bandwidth (inter-node) | 10 Gbps | Cross-partition traversal traffic during distributed queries |
| Cache hit ratio target | > 90% | Top 10% of nodes (supernodes + active users) cover 90% of traversals |

### Storage Architecture Summary

```
Total Raw Storage:  ~20 TB (Year 1)
Replication Factor: 3x
Total with Replicas: ~60 TB
Cluster Size:       20 machines x 3 TB SSD + 256 GB RAM each
```

---

## SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Availability | 99.99% | Percentage of successful traversal queries within latency target |
| Traversal Latency (p99) | < 50 ms for 3-hop | End-to-end including network, measured at client |
| Write Latency (p99) | < 20 ms | Node/edge creation acknowledgment |
| Error Rate | < 0.01% | Percentage of queries returning errors (excluding client errors) |
| Throughput | > 500K QPS | Sustained traversal query rate across cluster |
| Data Freshness | < 100 ms | Time between write commit and read visibility on replicas |
| Recovery Time | < 30 seconds | Time to failover to standby after primary failure detection |

---

## Read/Write Ratio Analysis

| Workload Type | Read:Write | Dominant Operation |
|---------------|------------|-------------------|
| Social graph queries | 100:1 | Friend lookups, feed generation, suggestions |
| Fraud detection | 50:1 | Real-time traversal for ring detection |
| Knowledge graph | 200:1 | Entity resolution, semantic queries |
| Recommendation engine | 80:1 | Collaborative filtering via graph traversal |
| Identity graph | 20:1 | Higher write ratio from event ingestion |
| Analytics workload | 10:1 | Full-graph scans with periodic bulk loads |

**Overall weighted ratio: ~80:1 (read-heavy)**

---

## Capacity Estimations: Additional Scenarios

### Scenario 2: Fraud Detection Graph

A financial services platform processing 300K transactions/second, with a graph linking accounts, devices, IPs, and merchants for real-time fraud ring detection.

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Account nodes | 200M | All active customer accounts |
| Device nodes | 500M | Phones, laptops, tablets used for payments |
| IP nodes | 100M | Unique IP addresses observed |
| Merchant nodes | 10M | All merchants on the platform |
| Transaction edges | 50B/year | 300K/sec × 86400 sec × 365 ≈ 9.5B (with multi-edge relationships) |
| Read QPS (fraud checks) | 300K | Every transaction triggers a 3-4 hop traversal |
| Write QPS | 300K | Each transaction creates 3-5 edges (account→merchant, account→device, etc.) |
| Hot graph (24h window) | 2 TB | ~25B edges in 24h × 64B per edge + properties |
| Total storage (1 year) | 50 TB | 50B edges × 64B + properties + indexes |

**Key difference from social graph:** Write QPS is much higher (300K vs. 50K) because every transaction creates multiple edges. The graph is also more temporal — edges older than 30 days are rarely traversed, enabling aggressive tiering.

### Scenario 3: Knowledge Graph

An enterprise knowledge graph with entities, relationships, and ontology for semantic search and AI applications.

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Entity nodes | 5B | Products, companies, people, locations, concepts |
| Relationship edges | 50B | ~10 relationships per entity average |
| Triple count | 500B | Including inferred triples from ontology rules |
| Read QPS | 100K | Entity resolution, semantic queries, AI context retrieval |
| Write QPS | 5K | Entity updates, new facts from extraction pipelines |
| Node storage | 320 GB | 5B × 64B |
| Edge storage | 3.2 TB | 50B × 64B |
| Property storage | 25 TB | Rich text properties on entities |
| Vector index | 2 TB | 768-dim embeddings × 5B entities × ~400B per embedding |
| Total storage | ~35 TB | All stores + indexes + WAL |

**Key difference:** Knowledge graphs have much larger property sizes (long text descriptions, structured metadata) and require vector indexes for semantic search. The read pattern is more diverse: entity lookups, path queries, and bulk inference.

---

## Latency Budget Breakdown

### 3-Hop Traversal Query (p50 target: 10ms)

| Phase | Budget | Notes |
|-------|--------|-------|
| Network (client → router) | 1 ms | TCP/TLS handshake amortized over connection pool |
| Query parsing | 0.2 ms | Cached AST for parameterized queries |
| Query planning | 0.3 ms | Plan cache hit; full optimization ~5ms |
| Hop 1: Index seek for start node | 0.5 ms | B+ tree traversal (3-4 levels) |
| Hop 1: Read start node + expand | 1.0 ms | Buffer cache hit; pointer dereference |
| Hop 2: Expand to 2nd degree | 2.0 ms | ~200 neighbors × pointer dereference |
| Hop 3: Expand to 3rd degree | 3.0 ms | Filtered expansion with LIMIT push-down |
| Result assembly | 1.0 ms | Property fetch for result set |
| Network (router → client) | 1.0 ms | Serialization + TCP send |
| **Total** | **10.0 ms** | At p50 with buffer cache hit ratio > 95% |

### Cross-Partition 3-Hop Traversal (p50 target: 25ms)

| Phase | Budget | Notes |
|-------|--------|-------|
| Local phases (same as above) | 6.0 ms | Parsing, planning, first 2 hops local |
| Cross-partition network call | 8.0 ms | Serialize, send, wait, receive between partitions |
| Remote hop execution | 3.0 ms | Traversal on remote partition |
| Result merge | 2.0 ms | Deduplicate and merge remote results |
| Network + assembly | 2.0 ms | Client-facing network + serialization |
| **Total** | **21.0 ms** | Each additional partition crossing adds ~10ms |

---

## Growth Projections and Capacity Triggers

| Metric | Year 1 | Year 2 | Year 3 | Scaling Trigger |
|--------|--------|--------|--------|----------------|
| Total nodes | 500M | 1.2B | 2.5B | > 1B: consider partitioning |
| Total edges | 50B | 130B | 300B | > 100B: mandatory sharding |
| Storage (raw) | 20 TB | 52 TB | 120 TB | > 50 TB per partition: add partitions |
| Peak read QPS | 2M | 5M | 12M | > 1M per node: add read replicas |
| Buffer cache requirement | 256 GB/node | 512 GB/node | 1 TB/node | Hit ratio < 90%: add memory or nodes |
| Index size | 4 TB | 10 TB | 25 TB | > 20% of total storage: index optimization |

---

## Benchmark Baselines

### Expected Performance on Reference Hardware (64-core, 256GB RAM, NVMe SSD)

| Operation | Throughput | Latency (p50) | Latency (p99) | Notes |
|-----------|-----------|--------------|--------------|-------|
| Single-node lookup by ID | 500K QPS | 0.2 ms | 1 ms | Direct positional access |
| 1-hop traversal (avg degree 200) | 200K QPS | 0.5 ms | 3 ms | Cache-warm, single partition |
| 2-hop traversal | 50K QPS | 3 ms | 15 ms | 200 × 200 = 40K nodes explored |
| 3-hop traversal (with LIMIT 100) | 20K QPS | 8 ms | 40 ms | LIMIT pushed down to Cutting off unnecessary steps |
| Shortest path (6 hops max) | 5K QPS | 20 ms | 200 ms | Bidirectional Dijkstra |
| Simple pattern match (3 nodes) | 10K QPS | 10 ms | 50 ms | Index-anchored start |
| Edge creation (single) | 100K QPS | 1 ms | 8 ms | WAL + 6 pointer updates |
| Bulk import | 2M edges/sec | N/A | N/A | WAL-bypass, parallel import |
| PageRank (1B edges, 1 iteration) | N/A | N/A | ~30 sec | Full graph scan |

These benchmarks assume 95%+ buffer cache hit ratio. At lower hit ratios, latency degrades proportionally to the cache miss rate multiplied by SSD read latency (~100μs per miss).

---

## Hardware Requirements per Role

| Role | CPU | Memory | Storage | Network | Count |
|------|-----|--------|---------|---------|-------|
| **Query Router** | 16 cores | 32 GB | 100 GB SSD (logs) | 10 Gbps | 3+ (stateless, behind LB) |
| **Graph Storage Node** | 64 cores | 256 GB - 1 TB | 2-4 TB NVMe SSD | 25 Gbps | 3 per partition (1 leader + 2 followers) |
| **Analytics Node** | 128 cores | 512 GB | 4 TB NVMe | 25 Gbps | 2-4 (dedicated OLAP) |
| **Metadata / Coordination** | 8 cores | 16 GB | 100 GB SSD | 10 Gbps | 3-5 (Raft consensus) |

### Cost Model (Estimated)

| Component | Monthly Cost (per node) | Cluster Monthly Cost |
|-----------|------------------------|---------------------|
| Storage node (64c/256GB/2TB) | ~$3,500 | ~$210K (60 nodes, 3x replication, 20 partitions) |
| Query router (16c/32GB) | ~$500 | ~$1,500 (3 instances) |
| Analytics node (128c/512GB) | ~$6,000 | ~$18,000 (3 instances) |
| Object storage (backups) | ~$0.02/GB | ~$1,200 (60TB backups) |
| Network egress | ~$0.01/GB | ~$5,000 (cross-AZ replication) |
| **Total** | | **~$236K/month** |

**Cost optimization levers:**
- Reserved/committed-use pricing reduces compute costs by 40-60%
- Tiered storage (hot/warm/cold) reduces storage costs by 30-50%
- Read replica auto-scaling adjusts capacity to traffic patterns
- Compression on property store reduces storage by 40-60% (graph topology is not compressible)
