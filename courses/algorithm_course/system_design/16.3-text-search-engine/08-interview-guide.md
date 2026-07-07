# 16.3 Interview Guide

## Interview Pacing (45-min Format)

| Time | Phase | Focus | Key Actions |
|---|---|---|---|
| 0-5 min | **Clarify** | Scope the search system | Ask: What data type? (products, documents, logs, code). Scale? (millions vs. billions of docs). Latency requirements? Read-heavy or write-heavy? Near-real-time needed? |
| 5-15 min | **High-Level** | Architecture + data flow | Draw coordinator-data node-master architecture; explain write path (document -> translog -> buffer -> segment); explain read path (two-phase query-then-fetch); identify key decisions (shard count, analysis chain) |
| 15-30 min | **Deep Dive** | Inverted index + relevance | Explain inverted index internals (term dictionary, posting lists, FST); walk through BM25 scoring with an example; discuss segment lifecycle and merge strategy; show near-real-time refresh mechanism |
| 30-40 min | **Scale & Trade-offs** | Bottlenecks + failure | Discuss shard sizing and rebalancing; explain segment merge I/O contention; cover replica promotion on node failure; address mapping explosion and circuit breakers; discuss hybrid search (BM25 + vectors) |
| 40-45 min | **Wrap Up** | Summary + extensions | Recap the key trade-offs (refresh interval vs. throughput, shard count vs. overhead, local vs. global IDF); mention index lifecycle management; handle follow-up questions |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **The inverted index is not just a data structure---it is an entire storage engine.** Unlike B-trees (single structure), the inverted index is a family of co-located structures (FST, posting lists, stored fields, doc values, norms, vectors) that must be consistent within a segment. Demonstrating understanding of this is the strongest differentiator.

2. **Relevance scoring is a first-class architectural concern.** BM25 depends on global statistics (IDF) that create distributed coordination challenges. This is unique to search---no other distributed system needs to compute per-query scoring functions that depend on corpus-wide statistics.

3. **Near-real-time is a precise engineering property.** The separation of durability (translog) from searchability (refresh) is a deliberate architectural choice that most candidates don't understand. Explaining the refresh-translog-flush lifecycle shows production-level knowledge.

4. **The segment merge tax is the hidden performance ceiling.** Benchmarks show great ingestion throughput, but production systems spend 30-50% of I/O on merge operations that only appear under sustained load.

### Where to Spend Most Time

- **15-30 min deep dive**: Spend the most time on inverted index internals and BM25 scoring. This is where you demonstrate depth. Walk through a concrete example: "if a user searches for 'wireless headphones', here's exactly how the term dictionary is traversed, how the posting lists are intersected, and how BM25 computes the score."
- **Avoid**: Don't spend more than 2 minutes on generic load balancing or caching unless the interviewer specifically asks. These are table stakes, not differentiators for a search system design.

---

## Trade-offs Discussion

| Decision | Option A | Option B | Recommendation |
|---|---|---|---|
| **Refresh interval** | 1 second (default) | 30 seconds | **1s for user-facing search** (near-real-time visibility); **30s for bulk indexing** (reduces segment creation rate by 30x, dramatically improves merge efficiency) |
| | Pros: Documents searchable in 1s; good user experience | Pros: 5-10x higher indexing throughput; fewer segments; less merge overhead | Configurable per-index; use 30s during bulk re-index, 1s for live traffic |
| | Cons: Creates many small segments; higher merge I/O; lower throughput | Cons: 30s visibility lag; stale search results during that window | |
| **Local IDF vs. DFS** | Local IDF (per-shard) | DFS (global IDF via pre-query) | **Local IDF by default**; switch to DFS only for small or skewed indexes |
| | Pros: No extra network round trip; lower latency | Pros: Accurate global scoring; correct rankings for rare terms | For large, evenly-sharded indexes (>1M docs/shard), local IDF approximation error is negligible |
| | Cons: Inaccurate for small/skewed shards | Cons: +10-15ms latency for extra scatter-gather round | |
| **Shard count** | Few large shards (5) | Many small shards (50) | **Start with fewer shards**; grow via time-based index rollover |
| | Pros: Less coordination overhead; fewer file handles; simpler cluster state | Pros: More query parallelism; easier rebalancing; finer-grained lifecycle | Over-sharding is harder to fix than under-sharding (requires reindex); target 10-50 GB per shard |
| | Cons: Less query parallelism; rebalancing moves large chunks | Cons: Higher coordinator overhead; more merge threads; larger cluster state | |
| **Stored fields vs. source-only** | Store full `_source` | Store only indexed fields, fetch from external store | **Store `_source`** for most use cases; external store only for very large documents |
| | Pros: Self-contained retrieval; simple architecture; supports reindexing from source | Pros: Smaller index size; less I/O for queries that don't need full documents | Losing `_source` means losing the ability to reindex, update, and highlight---too costly for most systems |
| | Cons: 40-60% of index size is stored fields | Cons: Extra hop to external store; cannot reindex without original data pipeline | |
| **Hybrid search (BM25 + vectors)** | BM25 only | BM25 + dense vector with RRF | **BM25 default, hybrid opt-in**; hybrid improves recall by 15-30% for semantic queries |
| | Pros: Simple; fast; well-understood; no ML infrastructure | Pros: Semantic understanding; handles synonyms and paraphrases; better for natural language queries | Vector indexing adds 50-100% to storage; HNSW search adds 5-20ms to query latency; worth it when recall matters more than latency |
| | Cons: No semantic understanding; misses paraphrases and synonyms | Cons: Higher storage and compute; requires embedding model infrastructure | |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---|---|---|
| "Why not just use a relational database with a text index?" | Understand fundamental difference between search and DBMS | "Relational text indexes (GIN, full-text) work for small-to-medium datasets, but they lack BM25 relevance scoring, distributed scatter-gather, analysis chains, near-real-time refresh, and aggregation support. At billions of documents, a dedicated search engine is 10-100x faster for text queries because its entire storage engine is optimized for inverted index operations." |
| "Can you make search results consistent (read-after-write)?" | Test understanding of NRT trade-off | "Yes, using `refresh=wait_for` on the indexing call or `refresh=true` (force immediate refresh). But there's a trade-off: forcing refresh on every write creates many small segments and degrades search performance. The standard approach is to accept 1-second eventual consistency for search, which is imperceptible to users, while providing strong consistency for get-by-ID operations via the translog." |
| "What happens if a shard goes down during a query?" | Test failure handling depth | "The coordinator handles it gracefully: it returns partial results from the healthy shards and includes `_shards.failed > 0` in the response. The client can choose to retry or accept partial results. For the failed shard, its replica (on a different node) can serve future queries. If the primary shard's node is down, a replica is promoted to primary within seconds." |
| "How do you handle a field that has millions of unique values for aggregation?" | Test knowledge of cardinality limits | "High-cardinality aggregations are the most common cause of OOM in search clusters. The key mitigations are: (1) use `shard_size` to limit per-shard bucket count, (2) use `composite` aggregation for paginated traversal instead of loading all buckets into memory, (3) pre-aggregate with transforms for known analytics queries, and (4) set circuit breakers to reject queries that would exceed memory limits." |
| "Why not shard by search query instead of by document?" | Test understanding of inverted index distribution | "Sharding by query is impossible because you don't know at index time what queries will be asked. Sharding by document (hash-based) ensures that each shard is a self-contained mini-index that can answer any query. The scatter-gather pattern handles the distribution: every query goes to every shard, and the coordinator merges the results." |
| "How would you handle 100x scale?" | Forward-thinking architecture | "At 100x scale: (1) increase shard count proportionally to data size (not query volume), (2) add replicas to handle query throughput, (3) separate indexing and search workloads onto different node pools, (4) implement query result caching more aggressively (CDN for popular queries), (5) consider cross-cluster search for geographic distribution, (6) use index lifecycle management to move old data to cheaper storage tiers." |

---

## Common Mistakes to Avoid

1. **Not explaining the inverted index**: The inverted index IS the system. Jumping to "sharding" and "load balancing" without explaining how a single shard processes a query shows shallow understanding.

2. **Confusing refresh with commit/flush**: Refresh makes documents searchable (in-memory segment). Flush/commit fsync's segments to disk and truncates the translog. They serve different purposes (searchability vs. durability).

3. **Ignoring segment merging**: Designing a write path without discussing the merge tax creates an incomplete picture. Merge I/O is 30-50% of total I/O under sustained load.

4. **Treating search as a database query**: Search returns *ranked* results, not matching rows. Ignoring BM25, IDF, and relevance scoring misses the fundamental purpose of the system.

5. **Over-sharding**: Creating 100 shards for an index that fits in 10 GB. Each shard has overhead (file handles, thread pools, segment metadata). Target 10-50 GB per shard.

6. **Forgetting about analysis chains**: How text is tokenized, stemmed, and normalized determines search quality. "Wireless" must match "wireless"; "running" should match "run." This is where search engines differ from grep.

7. **Not discussing failure scenarios**: What happens when a data node dies? When a coordinator is overloaded? When a merge storm saturates I/O? Production systems handle these daily.

---

## Questions to Ask Interviewer

| Question | Why It Matters |
|---|---|
| What type of data are we searching? | Products, documents, logs, and code have fundamentally different analysis chains, query patterns, and freshness requirements |
| What's the expected document count and growth rate? | Determines shard count, index lifecycle strategy, and storage tier design |
| Is near-real-time search required, or is batch indexing acceptable? | NRT requires refresh cycle design; batch allows much higher throughput |
| What matters more: recall or precision? | High recall -> fuzzy matching, synonyms, stemming; high precision -> exact match, strict analysis |
| Do users need faceted navigation (aggregations)? | Aggregations have significant memory implications (doc values, field data cache) |
| Is multi-language support needed? | Each language needs its own analyzer (different stemmers, stop words, tokenizers) |
| What consistency model is acceptable? | Eventual (1s lag) vs. read-after-write changes the refresh strategy |

---

## Scoring Rubric (What Interviewers Look For)

| Level | Signals |
|---|---|
| **Junior** | Knows what an inverted index is; can draw basic client-server architecture; mentions "Elasticsearch" |
| **Mid-Level** | Explains term frequency and IDF; understands shard-based distribution; can discuss refresh interval and near-real-time; mentions BM25 scoring |
| **Senior** | Walks through segment lifecycle (buffer -> segment -> merge); explains FST term dictionary; discusses local vs. global IDF trade-off; handles failure scenarios (node failure, merge storms); understands analysis chain design |
| **Staff+** | Discusses the segment merge tax as an I/O budget problem; explains the architectural separation of durability (translog) from searchability (refresh); designs multi-stage ranking (BM25 -> function scores -> LTR -> neural re-ranking); reasons about shard sizing as a function of both data volume and query latency; considers hybrid lexical-vector search architecture with fusion strategies |

---

## Extended Scoring Rubric

### Dimension: Data Model & Storage (0-10 points)

| Score | Criteria |
|---|---|
| 0-2 | Mentions "inverted index" without explaining it; treats documents like database rows |
| 3-4 | Explains term-to-document mapping; mentions posting lists; understands keyword vs. full-text field distinction |
| 5-6 | Describes the segment lifecycle (buffer → segment → merge); explains FST for term dictionary; understands doc values vs. stored fields distinction |
| 7-8 | Explains the six co-located structures within a segment (FST, posting lists, stored fields, doc values, norms, BKD trees); understands compression codecs (FOR, delta encoding, LZ4); discusses HNSW for vector search |
| 9-10 | Reasons about storage trade-offs at the byte level; designs custom analysis chains for specific use cases; understands how segment immutability enables lock-free reads and its merge cost |

### Dimension: Query Execution & Relevance (0-10 points)

| Score | Criteria |
|---|---|
| 0-2 | "Search returns matching documents"; no discussion of scoring or ranking |
| 3-4 | Mentions TF-IDF or BM25; understands that results are ranked by relevance |
| 5-6 | Walks through BM25 formula with concrete numbers; explains IDF and term frequency saturation; discusses field boosting |
| 7-8 | Explains local vs. global IDF problem in distributed setting; discusses DFS trade-off; designs multi-stage ranking pipeline (BM25 → function scoring → LTR) |
| 9-10 | Reasons about hybrid lexical-vector search with RRF; discusses learning-to-rank training pipeline; explains cross-encoder re-ranking latency budget; addresses relevance measurement (NDCG, MRR) |

### Dimension: Distributed Systems (0-10 points)

| Score | Criteria |
|---|---|
| 0-2 | "Put it behind a load balancer and add more servers" |
| 3-4 | Understands sharding by document hash; mentions coordinator-based scatter-gather |
| 5-6 | Explains two-phase query-then-fetch with bandwidth analysis; discusses shard sizing guidelines; understands primary-replica model |
| 7-8 | Discusses adaptive replica selection; explains primary promotion with sequence numbers and primary terms; designs shard allocation with zone awareness; handles partial failures gracefully |
| 9-10 | Designs multi-region architecture with cross-cluster replication; reasons about replication lag impact on search freshness; discusses split-brain prevention with primary term mechanism; designs back-pressure chain from coordinator to data node to client |

### Dimension: Operational Maturity (0-10 points)

| Score | Criteria |
|---|---|
| 0-2 | No discussion of operations, monitoring, or failure handling |
| 3-4 | Mentions monitoring search latency and cluster health |
| 5-6 | Designs observability with slow query logs, segment metrics, and GC monitoring; discusses ILM for data lifecycle |
| 7-8 | Designs circuit breaker strategy; explains mapping explosion prevention; discusses merge storm diagnosis; knows about disk watermarks |
| 9-10 | Designs chaos experiments for the search cluster; builds SLO-based alerting with error budgets; discusses GDPR erasure with force-merge implications; plans capacity with concrete formulas |

---

## Advanced Discussion Topics

### Topic 1: The Tension Between Freshness and Throughput

"How would you handle a system that needs to index 100,000 documents per second while keeping search results fresh within 1 second?"

**Strong answer includes:**
- Explain the refresh interval trade-off (1s creates 100K segments/day → merge storms)
- Propose separating indexing and query nodes (index with 30s refresh, replicas serve queries with 1s refresh)
- Discuss bulk API with optimal batch sizes (1,000-5,000 docs per bulk request)
- Consider indexing buffer size tuning (increase from default 10% to 25% of heap)
- Mention translog durability trade-off (async at 5s intervals for throughput)

### Topic 2: Designing a Multi-Tenant Search Platform

"You're building a search-as-a-service platform for 10,000 tenants ranging from 100 to 100M documents. How would you architect it?"

**Strong answer includes:**
- Hybrid isolation: index-per-tenant for large tenants, shared index with DLS for small tenants
- Routing strategy: `routing=tenant_id` for shared indexes to co-locate tenant data
- Noisy neighbor prevention: per-tenant rate limiting at coordinator level
- Resource allocation: dedicated coordinator pools for premium tenants
- Mapping management: tenant-specific mappings for enterprise; template-based for standard tier
- Monitoring: per-tenant SLO tracking; alerting on cross-tenant performance impact

### Topic 3: Search Quality Feedback Loop

"How would you measure and improve search relevance over time?"

**Strong answer includes:**
- Offline metrics: NDCG@10, MRR from human-judged relevance sets
- Online metrics: CTR, zero-result rate, reformulation rate, time-to-first-click
- A/B testing framework: traffic splitting at coordinator level; statistical significance testing
- Learning-to-rank pipeline: feature extraction → label collection (click data with position bias correction) → model training → offline evaluation → A/B test → gradual rollout
- Relevance monitoring: automated regression detection when NDCG drops >5% on key query sets

### Topic 4: Handling Schema Evolution at Scale

"Your product catalog adds 50 new attributes per quarter. How do you handle this without disrupting search?"

**Strong answer includes:**
- Use strict dynamic mapping to prevent unplanned field creation
- New fields added via mapping update API (non-breaking for existing documents)
- Runtime fields for experimental queries before committing to index-time mapping
- Reindex strategy for fields requiring different analysis (e.g., adding a new language analyzer)
- Index aliasing for zero-downtime reindexing: `products` alias → `products-v2` → `products-v3`
- Mapping version tracking in index settings for auditability

---

## Red Flags in Candidate Responses

| Red Flag | Why It's a Problem |
|---|---|
| "Just add more replicas to handle more writes" | Replicas handle reads, not writes; only primary shards accept writes |
| "Store the search results in a cache forever" | Search results change with every index refresh; cache TTL must be tied to refresh interval |
| "Use a relational database with LIKE queries" | LIKE '%keyword%' requires full table scan; no scoring, no analysis, no faceted navigation |
| "Shard by query type instead of by document" | You don't know what queries will be asked at index time; all shards must be queryable by any query |
| "Set refresh_interval to 0 for best performance" | 0 means refresh on every document (opposite of what they think); 30s is the high-throughput setting; -1 disables refresh entirely |
| "Use float vectors for all documents" | Vectors are expensive (storage + compute); hybrid should be opt-in for semantic queries, not default for all documents |
| "Just merge all segments into one giant segment" | A single huge segment means no concurrent indexing (merge blocks refresh); target multiple medium segments (1-5 GB) |

---

## Whiteboard Sketch Guide

### What to Draw First (5 Minutes)

```
1. Three-layer architecture:
   [Client] --> [Coordinator Layer] --> [Data Node Layer]

2. Write path (left side):
   Document --> Coordinator --> route by hash(_id) --> Primary Shard
   Primary: analyze -> translog -> buffer -> [refresh] -> segment

3. Read path (right side):
   Query --> Coordinator --> scatter to ALL shards
   Phase 1 (query): each shard returns (doc_id, score) top-K
   Phase 2 (fetch): coordinator fetches full docs from winning shards

4. Master nodes (separate):
   3-node quorum --> manages cluster state, shard allocation

5. Storage tiers:
   SSD (hot) --> HDD (warm) --> Object Storage (cold)
```

### What to Draw During Deep Dive (15 Minutes)

```
Single Shard Internals:
  +--- Segment 0 (5 GB, committed) ---+
  | FST Term Dict | Posting Lists     |
  | Stored Fields | Doc Values         |
  | Norms         | BKD Trees          |
  +------------------------------------+
  +--- Segment 1 (500 MB, refreshed) -+
  | ... same structure ...             |
  +------------------------------------+
  +--- In-Memory Buffer (50 MB) ------+
  | Not yet searchable                 |
  +------------------------------------+
  +--- Translog (100 MB) -------------+
  | Durability guarantee               |
  +------------------------------------+

Merge Process:
  Seg 0 (100 MB) + Seg 1 (80 MB) + Seg 2 (120 MB)
    --> [MERGE] --> Seg 3 (280 MB, minus deleted docs)
```

---

## 30-Second Elevator Pitch

"A text search engine is a distributed system that indexes billions of documents into immutable segments containing inverted indexes, enabling sub-50ms full-text search with relevance ranking. The core tension is between indexing throughput, query latency, and index freshness---mediated by the refresh interval that converts in-memory buffers into searchable segments. The system uses a two-phase query-then-fetch pattern to minimize network bandwidth: first collect scored document IDs from every shard, then fetch full documents only for the global top-K. The segment merge process---where small segments are compacted into larger ones---consumes 30-50% of total I/O and is the system's throughput ceiling."

---

## Follow-Up Questions by Seniority Level

### For Mid-Level Candidates (After Basic Design)

| Question | Expected Answer |
|---|---|
| "What happens to deleted documents?" | They're marked with a deleted bit in the live-docs bitset but remain on disk until the next merge physically removes them |
| "How does the coordinator decide which node to send a shard query to?" | Adaptive replica selection: routes to the shard copy (primary or any replica) with the lowest queue depth and response time |
| "Why is `from + size > 10,000` problematic?" | Each shard must score and return `from + size` results; at depth 10,000 across 50 shards, coordinator must merge 500K results |

### For Senior Candidates (After Deep Dive)

| Question | Expected Answer |
|---|---|
| "How would you add a new language to the search engine?" | Create a new analyzer with language-specific tokenizer, stemmer, and stop words; create a new index with the analyzer mapped to the appropriate fields; reindex existing documents; at query time, detect language and route to the correct index |
| "Your search results are inconsistent between regions. Why?" | Cross-cluster replication lag means the follower region has a slightly older index; additionally, local IDF on different-sized replicas produces different BM25 scores for the same query |
| "How do you handle a tenant that sends 1 million unique field names?" | Dynamic mapping would create mapping explosion; use `flattened` field type for the arbitrary fields; set `total_fields.limit`; use runtime fields for ad-hoc queries; alert on field count growth rate |

### For Staff+ Candidates (Design Extension)

| Question | Expected Answer |
|---|---|
| "Design the A/B testing framework for search relevance" | Traffic splitting at coordinator (consistent hash on user_id); control uses current ranking, experiment uses new model; track per-group CTR/NDCG/MRR with statistical significance; position-bias correction for click data; automated rollback if experiment group degrades >5% |
| "The business wants to add real-time personalization to search. How?" | Per-user feature vector (recent clicks, purchase history) as a re-ranking signal; LTR model with user features + query features + document features; compute personalization at the coordinator during re-ranking phase; store user feature vectors in a low-latency cache (not in the search index); A/B test against unpersonalized baseline |
| "How would you migrate from a single monolithic search cluster to a multi-region architecture?" | Phase 1: Set up CCR to replicate critical indexes to follower region; Phase 2: Route read traffic to nearest region via GeoDNS; Phase 3: Verify replication lag is within acceptable bounds; Phase 4: Add write routing for regional writes with conflict resolution; Phase 5: Test failover with controlled traffic drain |

---

## Key Metrics to Reference During Interview

When discussing specific numbers in the interview, these are the benchmarks that demonstrate production awareness:

| Metric | Typical Value | Source of Truth |
|---|---|---|
| BM25 k1 parameter | 1.2 (default) | Industry standard; tuned per domain |
| BM25 b parameter | 0.75 (default) | Controls field-length normalization |
| RRF rank constant | 60 (typical) | Balances contribution of each ranking system |
| Refresh interval (user-facing) | 1 second | Default; adjustable per index |
| Refresh interval (bulk indexing) | 30 seconds | Reduces segment creation rate 30x |
| Target shard size | 10-50 GB | Smaller = more overhead; larger = slower recovery |
| Max JVM heap | 30-31 GB | Compressed OOPs threshold |
| Segment merge I/O share | 30-50% of total I/O | Under sustained indexing load |
| Two-phase bandwidth savings | 95-97% | Compared to single-phase query-and-fetch |
| DFS latency overhead | 10-15ms | Extra scatter-gather round for global IDF |
| Searchable snapshot cold query | 0.5-5 seconds | Depends on segment cache hit rate |
| HNSW ef_search default | 100 | Higher = better recall, higher latency |
| Vector quantization (int8) recall | 98%+ | With re-scoring from full-precision vectors |
