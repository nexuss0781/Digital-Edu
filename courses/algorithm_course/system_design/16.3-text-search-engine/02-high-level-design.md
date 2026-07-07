# 16.3 High-Level Design

## System Architecture

```mermaid
---
config:
  theme: neutral
  look: neo
---
flowchart TB
    subgraph Clients["Client Layer"]
        C1["Web / Mobile App"]
        C2["Admin / Catalog<br/>Management"]
        C3["Analytics /<br/>Dashboard"]
    end

    subgraph Ingestion["Ingestion Layer"]
        LB["Load Balancer"]
        CW["Coordinator<br/>(Write)"]
        BP["Bulk Processor<br/>(Batch Pipeline)"]
    end

    subgraph Cluster["Search Cluster"]
        direction TB
        subgraph Coord["Coordinator Nodes"]
            CR["Coordinator<br/>(Read)"]
        end
        subgraph Data["Data Nodes"]
            D1["Data Node 1<br/>(Shards P0, R2)"]
            D2["Data Node 2<br/>(Shards P1, R0)"]
            D3["Data Node 3<br/>(Shards P2, R1)"]
        end
        subgraph Master["Master Nodes"]
            M1["Master 1"]
            M2["Master 2"]
            M3["Master 3"]
        end
    end

    subgraph Storage["Storage Layer"]
        LS["Local SSD<br/>(Hot Tier)"]
        WS["Warm Storage<br/>(HDD)"]
        OS["Object Storage<br/>(Cold / Snapshots)"]
    end

    subgraph Support["Supporting Services"]
        QC["Query Cache"]
        ML["ML Ranking<br/>Service"]
        SYN["Synonym /<br/>Dictionary Service"]
        MON["Monitoring &<br/>Alerting"]
    end

    C1 --> LB
    C2 --> LB
    C3 --> LB
    LB --> CW
    LB --> CR
    C2 --> BP
    BP --> CW

    CW --> D1 & D2 & D3
    CR --> D1 & D2 & D3
    M1 -.->|cluster state| D1 & D2 & D3

    D1 & D2 & D3 --> LS
    LS -->|lifecycle| WS -->|lifecycle| OS

    CR --> QC
    CR --> ML
    CR --> SYN
    D1 & D2 & D3 -.-> MON

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef ingest fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef coord fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef master fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef store fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef support fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class C1,C2,C3 client
    class LB,CW,BP ingest
    class CR coord
    class D1,D2,D3 data
    class M1,M2,M3 master
    class LS,WS,OS store
    class QC,ML,SYN,MON support
```

---

## Data Flow: Write Path (Indexing)

```mermaid
---
config:
  theme: neutral
  look: neo
---
sequenceDiagram
    participant Client as Client
    participant Coord as Coordinator Node
    participant Primary as Primary Shard
    participant TLog as Translog
    participant Buffer as In-Memory Buffer
    participant Segment as Segment (Disk)
    participant Replica as Replica Shard

    Client->>Coord: PUT /index/_doc/123 (document)
    Coord->>Coord: Route: hash(doc_id) % num_shards
    Coord->>Primary: Forward to primary shard owner

    Primary->>Primary: Validate & analyze document
    Note over Primary: Run analysis chain:<br/>char filters -> tokenizer -> token filters
    Primary->>TLog: Append to translog (durability)
    TLog-->>Primary: ACK (persisted to disk)
    Primary->>Buffer: Add to in-memory index buffer
    Note over Buffer: Document durable but NOT yet searchable

    Primary->>Replica: Replicate (parallel to all replicas)
    Replica->>Replica: Append to local translog + buffer
    Replica-->>Primary: ACK replication

    Primary-->>Coord: ACK (all replicas confirmed)
    Coord-->>Client: 201 Created (version=1, _seq_no=42)

    Note over Buffer,Segment: Refresh (every 1 second by default)
    Buffer->>Segment: Flush buffer to new immutable segment
    Note over Segment: Document NOW searchable
    Note over Segment: Segment contains: term dict (FST),<br/>posting lists, stored fields, doc values
```

---

## Data Flow: Read Path (Search)

```mermaid
---
config:
  theme: neutral
  look: neo
---
sequenceDiagram
    participant Client as Client
    participant Coord as Coordinator Node
    participant Cache as Query Cache
    participant S0 as Shard 0
    participant S1 as Shard 1
    participant S2 as Shard 2

    Client->>Coord: POST /index/_search (query + size=10)
    Coord->>Cache: Check query result cache
    alt Cache hit
        Cache-->>Coord: Return cached results
        Coord-->>Client: 200 OK (results)
    else Cache miss
        Note over Coord: Phase 1: QUERY (scatter)
        par Query all shards
            Coord->>S0: Execute query (return top 10 doc_ids + scores)
            Coord->>S1: Execute query (return top 10 doc_ids + scores)
            Coord->>S2: Execute query (return top 10 doc_ids + scores)
        end
        S0-->>Coord: [(doc_5, 12.3), (doc_2, 11.8), ...]
        S1-->>Coord: [(doc_99, 14.1), (doc_44, 10.2), ...]
        S2-->>Coord: [(doc_201, 13.5), (doc_180, 9.7), ...]

        Coord->>Coord: Merge + global top-10 by score
        Note over Coord: Global top-10: [doc_99, doc_201, doc_5, ...]

        Note over Coord: Phase 2: FETCH (gather)
        par Fetch documents from owning shards
            Coord->>S1: Fetch doc_99, doc_44
            Coord->>S2: Fetch doc_201
            Coord->>S0: Fetch doc_5, doc_2
        end
        S0-->>Coord: Full documents
        S1-->>Coord: Full documents
        S2-->>Coord: Full documents

        Coord->>Coord: Assemble final response with highlights
        Coord->>Cache: Store in query cache (TTL = index refresh)
        Coord-->>Client: 200 OK (hits, total, aggregations)
    end
```

---

## Key Architectural Decisions

### 1. Coordinator-Based Scatter-Gather vs. Peer-to-Peer Query Routing

| Aspect | Peer-to-Peer | Coordinator Pattern (Chosen) |
|---|---|---|
| Query routing | Each node knows all shards, any node can scatter | Dedicated coordinator nodes handle query planning and merging |
| Resource isolation | Query execution competes with indexing on data nodes | Coordinators handle merge/sort without impacting data node indexing |
| Complexity | Lower (fewer node roles) | Higher (separate coordinator role) |
| Scalability | Limited (every node must handle coordination overhead) | Better (coordinators scale independently of data nodes) |
| **Decision** | | **Coordinator pattern**: separating coordination from data processing allows independent scaling; coordinators handle the CPU-intensive global merge and re-ranking without consuming data node resources; also provides a natural point for query caching and ML re-ranking |

### 2. Two-Phase Query-Then-Fetch vs. Single-Phase Query-and-Fetch

| Aspect | Single-Phase (Query-and-Fetch) | Two-Phase (Chosen) |
|---|---|---|
| Network round trips | 1 (query + full docs in one pass) | 2 (first doc IDs + scores, then fetch top-K docs) |
| Data transferred | Every shard sends full documents for its top-K | Only winning documents are fetched (saves bandwidth) |
| Result quality | Per-shard top-K may miss globally relevant docs | Global top-K from ID-only phase ensures best results |
| Latency | Lower for small result sets | Slightly higher (+1 RTT), but less data overall |
| **Decision** | | **Two-phase**: for a search engine returning 10-20 results from billions of documents across 50+ shards, transferring full documents from every shard would waste 95%+ of bandwidth; the two-phase approach transfers only ~500 bytes per shard in the query phase (doc_id + score) vs. ~50 KB per result in single-phase |

### 3. Inverted Index with Segments vs. B-Tree Index

| Aspect | B-Tree | Inverted Index with Segments (Chosen) |
|---|---|---|
| Update model | In-place updates; mutable | Append-only immutable segments; merging |
| Write throughput | Moderate (random I/O for updates) | Very high (sequential I/O for segment writes) |
| Full-text search | Poor (B-trees don't support term-frequency scoring) | Excellent (posting lists with term stats enable BM25) |
| Concurrency | Lock-based (read-write contention) | Lock-free reads (segments are immutable) |
| Space efficiency | Moderate | High (delta-encoded posting lists, FST term dictionary) |
| **Decision** | | **Inverted index with immutable segments**: the fundamental design choice for text search; immutability enables lock-free concurrent reads, sequential I/O for writes, and compact compression; the merge tax is the accepted trade-off for these benefits |

### 4. Scoring: BM25 vs. TF-IDF vs. Neural

| Aspect | TF-IDF | BM25 (Chosen as Default) | Neural (Dense Vectors) |
|---|---|---|---|
| Term saturation | Linear (no diminishing returns) | Logarithmic (diminishing returns after ~5 occurrences) | N/A (semantic similarity) |
| Document length normalization | Basic | Configurable (k1, b parameters) | N/A |
| Semantic understanding | None (lexical only) | None (lexical only) | High (understands synonyms, context) |
| Latency | Very fast | Very fast | Slower (ANN search + re-ranking) |
| **Decision** | | **BM25 as default with optional hybrid**: BM25's term saturation and length normalization produce significantly better rankings than TF-IDF for general text search; neural search via dense vectors is offered as an opt-in hybrid mode using reciprocal rank fusion (RRF) for use cases requiring semantic understanding |

### 5. Shard Routing Strategy

| Aspect | Random Routing | Hash-Based Routing (Chosen) |
|---|---|---|
| Document distribution | Requires broadcast for get-by-ID | Deterministic: hash(doc_id) % num_shards |
| Get-by-ID efficiency | O(N) shards queried | O(1) single shard |
| Search query | Scatter to all shards (same) | Scatter to all shards (same) |
| Data balance | Statistically even | Statistically even (with consistent hashing) |
| **Decision** | | **Hash-based routing**: deterministic routing enables O(1) get-by-ID lookups (critical for the fetch phase) and ensures even document distribution; search queries still scatter to all shards regardless of routing |

---

## Architecture Pattern Checklist

| Pattern | Decision | Justification |
|---|---|---|
| Sync vs Async communication | **Sync** for search queries, **Async** for bulk indexing | Search requires synchronous response; bulk indexing benefits from async batching and backpressure |
| Event-driven vs Request-response | **Request-response** for search, **event-driven** for index lifecycle | Interactive search is request-response; segment merging, shard rebalancing, and tier migration are event-driven background operations |
| Push vs Pull model | **Push** for indexing (client pushes documents), **Pull** for replication (replicas pull from primary) | Clients know when documents change; replicas pull the operation log from the primary shard for replication |
| Stateless vs Stateful services | **Stateless** coordinators, **stateful** data nodes | Coordinators hold no persistent state (only transient query context); data nodes own shard data and translogs |
| Read-heavy vs Write-heavy | **Read-heavy** (10:1 to 100:1) | User-facing search traffic dominates; optimize query path first, then indexing throughput |
| Real-time vs Batch processing | **Near-real-time** indexing, **batch** for bulk re-index and lifecycle management | 1-second refresh for NRT visibility; bulk API for initial load and re-indexing; lifecycle management as periodic batch |
| Edge vs Origin processing | **Edge** for query caching and autocomplete, **Origin** for full search execution | CDN/edge caches for autocomplete suggestions and popular query results; full search execution at origin cluster |

---

## Component Interaction Summary

### Coordinator Nodes
- **Stateless** query and indexing routers. Receive client requests, determine target shards via routing hash, scatter subqueries to data nodes, gather partial results, perform global merge/sort/re-rank, and return the final response. Maintain a query result cache (keyed by query hash, invalidated on index refresh). For indexing, route documents to the correct primary shard based on `hash(doc_id) % num_primary_shards`.

### Data Nodes
- **Stateful** nodes that host primary and replica shards. Each shard is a self-contained Lucene index. Data nodes handle: document analysis (running the analysis chain), translog writes (durability), in-memory buffer management, segment refresh (making documents searchable), segment merging (compacting small segments), and local query execution against their shards. Data nodes report shard health and resource utilization to the master.

### Master Nodes
- **Cluster state managers** (quorum of 3 for split-brain prevention). Maintain the cluster state: index metadata (mappings, settings), shard allocation table (which shard lives on which node), and node membership. Master nodes do NOT handle data or queries. They make allocation decisions (assigning unassigned shards, rebalancing across nodes) and propagate cluster state updates to all nodes.

### Bulk Processor
- **Batching and pipeline service** for high-volume catalog ingestion. Receives bulk indexing requests from catalog management systems, validates documents, applies ingest pipeline transformations (enrichment, normalization), and routes batches to the appropriate coordinator for primary shard routing. Implements backpressure via queue depth monitoring.

### ML Ranking Service
- **Sidecar or microservice** for learning-to-rank re-scoring. After the coordinator receives BM25-scored results from the query phase, it optionally forwards the top-N candidates (N=100-1000) to the ML ranking service for re-scoring using gradient-boosted trees or neural re-rankers. The ML service returns re-ordered scores, and the coordinator applies the final top-K selection.

### Synonym / Dictionary Service
- **Shared reference data** for query expansion. At query time, the coordinator optionally expands the user's query using synonym mappings (e.g., "laptop" -> "laptop OR notebook OR computer") and spell-correction dictionaries. Managed as a separate service to enable updates without re-indexing.

---

## Multi-Stage Ranking Pipeline

```mermaid
---
config:
  theme: neutral
  look: neo
---
flowchart LR
    subgraph Retrieval["Phase 1: Retrieval (per shard)"]
        BM25["BM25 Retrieval<br/>Top 1000 candidates"]
        VEC["Vector ANN<br/>Top 1000 candidates"]
    end

    subgraph Fusion["Phase 2: Fusion"]
        RRF["Reciprocal Rank<br/>Fusion (RRF)<br/>Top 200"]
    end

    subgraph Rerank["Phase 3: Re-Ranking"]
        FN["Function Scoring<br/>(recency, popularity,<br/>geo-distance)<br/>Top 100"]
        LTR["Learning-to-Rank<br/>(gradient-boosted<br/>trees)<br/>Top 50"]
    end

    subgraph Neural["Phase 4: Neural (optional)"]
        CE["Cross-Encoder<br/>Re-Ranker<br/>Top 10-20"]
    end

    subgraph Final["Phase 5: Business Rules"]
        BR["Business Rules<br/>(pinning, boosting,<br/>filtering)<br/>Final Top 10"]
    end

    BM25 --> RRF
    VEC --> RRF
    RRF --> FN --> LTR --> CE --> BR

    classDef retrieval fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef fusion fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef rerank fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef neural fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef business fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class BM25,VEC retrieval
    class RRF fusion
    class FN,LTR rerank
    class CE neural
    class BR business
```

**Latency budget per phase:**

| Phase | Latency | Candidates In | Candidates Out |
|---|---|---|---|
| BM25 retrieval | 5-15ms | All docs in shard | 1,000 |
| Vector ANN retrieval | 5-20ms | All vectors in shard | 1,000 |
| RRF fusion | <1ms (coordinator) | 2,000 × N shards | 200 |
| Function scoring | 1-3ms | 200 | 100 |
| Learning-to-rank | 5-15ms | 100 | 50 |
| Cross-encoder (optional) | 10-50ms | 50 | 10-20 |
| Business rules | <1ms | 10-20 | 10 |
| **Total** | **27-105ms** | | |

---

## Disaggregated Storage Architecture

Modern search engines are evolving from coupled compute-storage to disaggregated architectures. This section describes the emerging pattern:

```mermaid
---
config:
  theme: neutral
  look: neo
---
flowchart TB
    subgraph Stateless["Stateless Compute Layer"]
        CQ["Query Nodes<br/>(read path)"]
        CI["Indexing Nodes<br/>(write path)"]
    end

    subgraph Cache["Caching Layer"]
        LC["Local SSD Cache<br/>(hot segments)"]
        DC["Distributed Cache<br/>(segment metadata)"]
    end

    subgraph Object["Durable Storage"]
        OS["Object Storage<br/>(all segments)"]
    end

    subgraph Control["Control Plane"]
        CP["Cluster Manager<br/>(shard assignment,<br/>cache placement)"]
    end

    CQ --> LC
    CI --> LC
    LC --> OS
    CQ --> DC
    CP -.->|assignment| CQ & CI
    CP -.->|cache policy| LC

    classDef compute fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef storage fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef control fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class CQ,CI compute
    class LC,DC cache
    class OS storage
    class CP control
```

**Key differences from traditional architecture:**

| Aspect | Traditional (Coupled) | Disaggregated |
|---|---|---|
| Scaling | Add node = add compute + storage | Scale compute and storage independently |
| Cost model | Provision for peak; idle nodes waste both compute and storage | Pay for compute when active; storage is always-on, cheap |
| Recovery | Copy segment files from replica (minutes to hours) | Assign shard to new node; cache warms from object storage (seconds to minutes) |
| Storage cost | NVMe SSD for all tiers ($0.10-0.25/GB/mo) | Object storage for bulk ($0.01-0.02/GB/mo); local SSD only for cache |
| Durability | Replicas on separate nodes | Object storage provides 11-nines durability natively |
| Cold queries | Requires warm/cold nodes with local copies | Fetch from object storage on demand; cache for repeat access |

---

## Case Studies

### Case Study 1: E-Commerce Product Search (Shopify-Scale)

**Problem:** 100M+ products across 2M+ merchants, each with unique schemas, requiring sub-50ms search with per-merchant relevance.

**Architecture decisions:**
- **Index-per-merchant for large merchants** (>100K products): dedicated indexes with custom mappings and analysis chains
- **Shared index with routing for small merchants**: `routing=merchant_id` ensures co-location; document-level security filters per merchant
- **Time-weighted scoring**: `function_score` with exponential decay on `updated_at` to surface fresh inventory
- **Autocomplete via edge n-grams**: separate `title.suggest` field with `edge_ngram(1,20)` tokenizer for type-ahead
- **Flash sale handling**: dedicated indexing pipeline with priority queue; coordinator-level circuit breaker rejects complex aggregations during peak

**Results:** p50 search latency 12ms, p99 45ms across 100M products; 99.995% availability; 3x traffic spikes during sales handled without degradation.

### Case Study 2: Code Search (GitHub-Scale)

**Problem:** Full-text search across 200M+ repositories, supporting regex, exact-match identifiers, and file-path filtering with near-real-time updates on push.

**Architecture decisions:**
- **Custom tokenizer for code**: preserves camelCase splitting, dot-separated identifiers, and special characters (`::`, `->`, `.`) that standard text analyzers would discard
- **Trigram index for regex**: code search requires regex support; trigram index (3-character n-grams) enables pre-filtering to reduce regex execution to matching documents only
- **Repository-level routing**: `routing=repo_id` ensures all files for a repo are co-located on the same shard, enabling efficient "search within repo" queries
- **Separate indexes for code, issues, and PRs**: different analysis chains, update frequencies, and query patterns
- **Incremental indexing on git push**: CDC from repository events triggers indexing of changed files only, not the entire repo

**Results:** Sub-second search across 200M+ repositories; regex queries complete in under 2 seconds for 95% of cases.

### Case Study 3: Log Analytics Search (Observability-Scale)

**Problem:** 50 TB/day of log ingestion, 90-day retention, supporting ad-hoc queries across arbitrary fields with sub-10-second response.

**Architecture decisions:**
- **Time-based index rotation**: daily indexes (`logs-2026.03.20`) with automatic rollover; 7 days hot (SSD), 30 days warm (HDD), 90 days cold (searchable snapshots on object storage)
- **LogsDB index mode**: column-oriented storage with synthetic `_source` reconstruction from doc values, reducing storage by 40-60% compared to traditional stored fields
- **Aggressive refresh interval**: 5-second refresh for logs (freshness less critical than throughput)
- **Minimal replicas for hot tier**: 0 replicas during peak ingestion (translog provides durability); 1 replica added after rollover
- **Frozen tier for long retention**: searchable snapshots serve queries directly from object storage; acceptable latency of 5-30 seconds for historical queries

**Results:** 50 TB/day ingestion sustained; 90-day queryable retention at 60% lower storage cost than fully replicated; p95 query latency 3 seconds for 7-day queries, 15 seconds for 90-day queries.

### Case Study 4: Wikipedia Search

**Problem:** 60M+ articles across 300+ languages, serving 20B+ monthly searches with sub-100ms latency globally.

**Architecture decisions:**
- **Per-language indexes**: each language has its own analyzer (stemmers, stop words, tokenizers differ dramatically between languages)
- **Cross-language search**: query expansion using inter-language links (Wikidata entity mapping) to find relevant articles in the target language
- **Completion suggester**: FST-based prefix completion for article titles, weighted by page view popularity
- **Multi-region deployment**: read replicas in each geographic region; writes flow to a primary region and replicate asynchronously
- **Custom BM25 tuning**: `k1=1.2, b=0.75` with field boosts: title^5, headings^3, body^1, categories^2

**Results:** p50 search latency 30ms; 99.99% availability; supports 300+ languages with language-specific analysis chains.
