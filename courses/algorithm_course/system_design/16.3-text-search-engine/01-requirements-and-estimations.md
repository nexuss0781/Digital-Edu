# 16.3 Requirements & Estimations

## Functional Requirements

### Core Features

1. **Document Ingestion**: Accept, validate, analyze, and index documents via bulk and single-document APIs; support create, update (full and partial), and delete operations
2. **Full-Text Search**: Boolean queries (AND, OR, NOT), phrase matching, fuzzy matching (edit distance), prefix/wildcard matching, and regular expression queries across analyzed text fields
3. **Relevance Ranking**: Score and rank results by contextual relevance using BM25 scoring, field boosting, function scoring (recency, popularity, geo-distance), and optionally learning-to-rank models
4. **Aggregations**: Compute faceted counts (terms aggregation), histograms (date/numeric), statistical summaries (min, max, avg, percentiles), and nested sub-aggregations for analytics
5. **Filtering**: Exact-match keyword filters, numeric range filters, date range filters, geo-spatial filters (bounding box, radius), and nested object filters---applied as non-scoring boolean clauses
6. **Multi-Index Search**: Query across multiple indexes simultaneously with per-index boosting; cross-cluster search for geographically distributed indexes
7. **Autocomplete & Suggestions**: Prefix-based completion suggestions, contextual suggestions filtered by category, and "did you mean" spell correction using edit distance or phonetic matching
8. **Hybrid Search**: Combine lexical BM25 search with dense vector similarity search using reciprocal rank fusion or linear combination scoring

### Out of Scope

- Crawler/spider for web content discovery (separate system)
- Natural language understanding / question-answering (application layer)
- Image, audio, or video content indexing (separate media search system)
- OLAP-style joins across multiple indexes
- Real-time streaming analytics (complementary system)

---

## Non-Functional Requirements

| Requirement | Target | Justification |
|---|---|---|
| **CAP Theorem** | AP (Availability + Partition tolerance) | Search must remain available during network partitions; stale results are acceptable, missing results are not (users retry if results seem wrong, but a down search is immediately noticed) |
| **Consistency Model** | Eventual consistency for search visibility; strong consistency for document CRUD within a primary shard | Documents become searchable within 1 second (refresh interval); read-after-write on the same shard is immediately consistent if reading from the primary |
| **Availability** | 99.99% (52.6 min downtime/year) | Search is often the primary user interaction path; downtime directly impacts revenue (e-commerce), user experience (content platforms), and developer productivity (code search) |
| **Latency (p50)** | < 20ms for simple keyword queries | Simple queries should feel instantaneous; users perceive anything over 100ms as "slow" |
| **Latency (p95)** | < 100ms for complex multi-clause queries | Multi-field boolean queries with aggregations should complete within a blink |
| **Latency (p99)** | < 500ms for aggregation-heavy queries | Large time-range aggregations and cross-index queries may require scatter-gather across many shards |
| **Durability** | Zero data loss for acknowledged writes | Once a document write is acknowledged, it must survive node failure via translog replication |
| **Near-Real-Time** | < 1 second from ingestion to searchability | Default refresh interval of 1 second; configurable per index based on freshness vs. throughput trade-off |

---

## Capacity Estimations (Back-of-Envelope)

**Scenario**: Large-scale e-commerce search platform (comparable to eBay, Amazon product search, or Shopify)

| Metric | Estimation | Calculation |
|---|---|---|
| Total documents | 2 billion | Product catalog: 2B active listings across all merchants |
| Average document size | 5 KB | Title (100B) + description (2KB) + attributes (1KB) + metadata (1KB) + vectors (900B) |
| Total raw data | 10 TB | 2B documents x 5 KB |
| Index overhead | 1.5x raw data | Inverted index (~0.3x), doc values (~0.5x), stored fields (~0.5x), norms + vectors (~0.2x) |
| Total storage (indexed) | 25 TB | 10 TB raw + 15 TB index overhead; with 1 replica = 50 TB total |
| DAU | 50 million | Active shoppers and browsers per day |
| Search QPS (average) | 30,000 | 50M users x 6 searches/day / 86,400 seconds |
| Search QPS (peak) | 90,000 | 3x average during sales events (Black Friday, flash sales) |
| Indexing rate (average) | 10,000 docs/sec | Catalog updates: new listings, price changes, inventory updates |
| Indexing rate (peak) | 50,000 docs/sec | Bulk re-index during schema migration or data pipeline backfill |
| Read:Write ratio | 3:1 to 10:1 | Read-heavy for user-facing search; write-heavier for catalog management |
| Bandwidth (search) | 1.5 GB/s | 30K QPS x 50 KB avg response (10 results x 5 KB per result) |
| Cache size | 500 GB | Frequently searched queries + filter cache + field data cache across cluster |

---

## SLOs / SLAs

| Metric | Target | Measurement |
|---|---|---|
| Availability | 99.99% | Percentage of 1-minute windows where >95% of search requests return 2xx within timeout |
| Search latency (p50) | < 20ms | Coordinator-measured time from query receipt to response send |
| Search latency (p99) | < 500ms | Coordinator-measured, including scatter-gather across all shards |
| Indexing latency (p99) | < 100ms | Time from bulk request receipt to translog acknowledgment |
| Search-after-index (freshness) | < 1 second | Time from index acknowledgment to document appearing in search results |
| Error rate | < 0.1% | Percentage of search requests returning 5xx or timing out |
| Shard recovery time | < 5 minutes | Time to recover an unassigned shard from translog or peer replica |
| Cluster rebalance time | < 30 minutes | Time to rebalance shards after adding or removing a data node |

---

## Traffic Patterns

### Diurnal Pattern
- Search traffic follows user timezone patterns: peak during business hours (10am-8pm), trough at 3am-6am
- Indexing traffic is more uniform (automated catalog feeds) with spikes during bulk re-index windows

### Seasonal Spikes
- E-commerce: 3-5x traffic during Black Friday, holiday sales, flash sales
- Content platforms: viral content creates sudden query spikes for specific terms
- News/media: breaking events create bursty, correlated query patterns

### Query Distribution
- **Head queries** (top 1% of unique queries): 30-40% of total query volume; highly cacheable
- **Torso queries** (next 10%): 30-40% of volume; partially cacheable
- **Tail queries** (remaining 89%): 20-30% of volume; rarely repeated, low cache hit rate
- Power-law distribution means query caching is highly effective for overall latency reduction

---

## SLO Error Budget Calculation

**Monthly error budget at 99.99% availability:**

```
Total minutes per month:     43,200
Allowed downtime:            43,200 × 0.0001 = 4.32 minutes
Per-week budget:             ~1 minute

At 30,000 QPS average:
  Monthly total queries:     30,000 × 86,400 × 30 = 77.76 billion
  Allowed failed queries:    77.76B × 0.001 = 77.76 million (at 0.1% error rate)
  Per-minute error budget:   77.76M / 43,200 = ~1,800 failed queries/minute
```

**Burn-rate alerting thresholds:**

| Burn Rate | Window | Time to Exhaust Budget | Alert Severity |
|---|---|---|---|
| 14.4x | 1 hour | 5 hours | Critical (page) |
| 6x | 6 hours | 12 hours | High (page) |
| 3x | 1 day | 2.3 days | Medium (ticket) |
| 1x | 3 days | 30 days | Low (dashboard) |

---

## Hardware & Cost Estimation

### Cluster Sizing for Reference Scenario (2B documents, 30K QPS)

```
Storage Calculation:
  Raw data:                  2B × 5 KB = 10 TB
  Index overhead (1.5x):     15 TB
  Total indexed:             25 TB
  With 1 replica:            50 TB
  With 20% headroom:         60 TB

Data Nodes (Hot Tier):
  Storage per node:          4 TB NVMe SSD
  Nodes for storage:         60 TB / 4 TB = 15 nodes
  Memory per node:           64 GB (50% for OS page cache, 30 GB heap)
  CPU per node:              32 cores
  Network:                   25 Gbps per node

Data Nodes (Warm Tier):
  Indexes older than 7 days: ~30% of total = 18 TB
  Storage per node:          8 TB HDD
  Nodes for storage:         18 TB / 8 TB = 3 nodes (after force-merge and shrink)
  Memory per node:           32 GB

Coordinator Nodes:
  QPS capacity per node:     ~5,000 QPS (CPU-bound on merge/sort)
  Nodes for 90K peak QPS:    90K / 5K = 18 coordinators
  Memory per node:           32 GB (16 GB heap for query/aggregation processing)
  CPU per node:              16 cores

Master Nodes:
  Fixed quorum:              3 dedicated master nodes
  Memory per node:           16 GB (8 GB heap for cluster state)
  CPU per node:              4 cores
  Storage:                   100 GB SSD (cluster state only)

ML Ranking Service:
  GPU nodes (if neural re-ranking): 2-4 GPU instances
  CPU nodes (if gradient-boosted LTR): 6-8 instances
  Latency budget:            < 20ms for top-100 re-ranking
```

### Cost Estimate (Monthly, Cloud Pricing)

| Component | Instance Type | Count | Monthly Cost |
|---|---|---|---|
| Hot data nodes | 32 vCPU, 64 GB, 4 TB NVMe | 15 | ~$22,500 |
| Warm data nodes | 8 vCPU, 32 GB, 8 TB HDD | 3 | ~$1,200 |
| Coordinator nodes | 16 vCPU, 32 GB | 18 | ~$9,000 |
| Master nodes | 4 vCPU, 16 GB | 3 | ~$450 |
| Object storage (cold/snapshots) | — | 100 TB | ~$2,300 |
| Network egress | Inter-AZ + client | — | ~$3,000 |
| ML ranking (optional) | GPU or CPU instances | 4-8 | ~$4,000 |
| **Total (without ML)** | | | **~$38,450/mo** |
| **Total (with ML re-ranking)** | | | **~$42,450/mo** |

### Cost per Query

```
Monthly queries:             77.76 billion
Monthly cost:                $38,450
Cost per million queries:    $0.49
Cost per query:              $0.00000049

With ML re-ranking (applied to 10% of queries):
Cost per re-ranked query:    ~$0.0000052 (10x more expensive)
```

---

## Capacity Planning Formulas

```
// Shard count estimation
num_primary_shards = ceil(expected_total_data_size / target_shard_size)
// target_shard_size: 10-50 GB (30 GB recommended default)
// Example: 25 TB / 30 GB = 834 primary shards

// Node count estimation (storage-bound)
num_data_nodes = ceil(total_storage_with_replicas / storage_per_node)
// total_storage_with_replicas = total_indexed × (1 + num_replicas)

// Node count estimation (query-bound)
num_coordinator_nodes = ceil(peak_qps / qps_per_coordinator)
// qps_per_coordinator depends on query complexity:
//   Simple keyword: 8,000-10,000 QPS per coordinator
//   Multi-field boolean + aggregations: 3,000-5,000 QPS
//   Hybrid (BM25 + vector): 1,500-2,500 QPS

// Heap sizing per data node
min_heap = num_shards_on_node × 10 MB + query_cache + fielddata_cache
// Rule of thumb: 1 GB heap per 20 shards
// Never exceed 30 GB heap (compressed OOPs threshold)

// Replica count for query throughput
num_replicas = ceil(peak_qps / (qps_per_shard_copy × num_primary_shards)) - 1
// Each shard copy (primary or replica) can serve ~500-2000 QPS depending on complexity

// Indexing throughput per primary shard
max_indexing_rate_per_shard = ~2,000-5,000 docs/sec (with 1s refresh)
total_indexing_capacity = num_primary_shards × max_indexing_rate_per_shard
// To increase indexing throughput: add primary shards (requires reindex)
```

---

## Growth Projections

| Metric | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Documents | 2B | 3.5B | 6B |
| Storage (indexed + replicas) | 50 TB | 87 TB | 150 TB |
| Search QPS (average) | 30K | 50K | 80K |
| Search QPS (peak) | 90K | 150K | 240K |
| Data nodes (hot) | 15 | 25 | 42 |
| Coordinator nodes | 18 | 30 | 48 |
| Monthly cost | $38K | $65K | $110K |

**Key scaling triggers:**
- When average shard size exceeds 40 GB → create new index with more shards
- When coordinator CPU sustained > 70% → add coordinator nodes
- When data node disk > 75% → add data nodes or move old indexes to warm tier
- When p99 search latency exceeds 2x target → investigate shard hot spots, segment count, GC pressure
