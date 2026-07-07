# Interview Guide — Graph Database

## Interview Pacing (45-min Format)

| Time | Phase | Focus | Key Points |
|------|-------|-------|------------|
| 0-5 min | **Clarify** | Scope the problem | What kind of graph? (social, knowledge, fraud) Property graph or RDF? OLTP or analytics? Scale? |
| 5-15 min | **High-Level** | Core architecture | Native storage with index-free adjacency, node/relationship/property stores, buffer cache, WAL |
| 15-30 min | **Deep Dive** | 1-2 critical components | Pick: supernode handling, graph partitioning, or query planner. Go deep on internals. |
| 30-40 min | **Scale & Trade-offs** | Distributed challenges | Graph partitioning NP-hardness, cross-partition traversals, property sharding, replication |
| 40-45 min | **Wrap Up** | Summary + handles follow-ups | Summarize key trade-offs; discuss monitoring and operational concerns |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **The partitioning paradox:** Unlike key-value or document stores where data items are independent, graph data is inherently interconnected. Any partition boundary creates cross-partition edges that degrade the core value proposition (fast traversal). This is the fundamental tension of distributed graph databases.

2. **Power-law distribution:** Real-world graphs are not uniform. A few supernodes have millions of edges while most nodes have hundreds. Any design that assumes uniform degree distribution will fail catastrophically on real data.

3. **Query complexity is unbounded:** A simple-looking query like `MATCH (a)-[*]->(b)` can explore the entire graph. The query planner must protect the system from queries that are syntactically valid but computationally unbounded.

4. **Relationships are first-class storage:** Unlike relational databases where relationships (foreign keys) are metadata, graph databases physically store and index relationships. This is a fundamental storage engine decision, not a query language feature.

### Where to Spend Most Time

- **Storage engine:** Explain index-free adjacency thoroughly — this is the defining architectural property
- **Supernode handling:** This is where most candidates stumble. Show awareness of power-law distributions and vertex-centric indexes
- **Partitioning trade-offs:** Don't just say "shard by node ID" — explain why graph partitioning is fundamentally harder than key-value partitioning

### How to Approach This Problem

1. Start with the data model (property graph vs. RDF) — this determines everything downstream
2. Design the storage engine (index-free adjacency with fixed-size records)
3. Design the query pipeline (parser → planner → executor)
4. Address the supernode problem (relationship groups, vertex-centric indexes)
5. Discuss distribution (partitioning strategies, replication)
6. Mention security (traversal escalation is graph-specific)

---

## Trade-offs Discussion

### Decision 1: Native Graph Storage vs. Graph Layer on Existing DB

| Aspect | Native Graph Storage | Graph Layer on RDBMS/KV |
|--------|--------------------|-----------------------|
| Pros | O(1) traversal per hop; purpose-built for graph workloads; predictable performance regardless of data size | Leverage mature ecosystem; easier operations; battle-tested ACID |
| Cons | Custom storage engine to maintain; smaller ecosystem; cannot easily switch to relational queries | O(log n) per hop via index; JOINs for multi-hop; performance degrades with data size |
| **Recommendation** | **Choose native** for production graph workloads where traversal performance is the primary requirement |

### Decision 2: Eager Property Loading vs. Lazy Property Loading

| Aspect | Eager (load properties with node) | Lazy (load properties on demand) |
|--------|----------------------------------|----------------------------------|
| Pros | Single I/O per node; simpler execution model | Less memory per traversal; faster when properties aren't needed |
| Cons | Wastes memory/bandwidth when properties aren't queried | Additional I/O when properties are needed; more complex execution |
| **Recommendation** | **Choose lazy** — most traversals filter by structure first and only fetch properties for the final result set. The query planner should push down property access to the latest possible stage. |

### Decision 3: Hash Partitioning vs. Community-Based Partitioning

| Aspect | Hash Partitioning | Community-Based Partitioning |
|--------|------------------|---------------------------|
| Pros | Even distribution; simple assignment; no rebalancing | Minimizes cross-partition edges; locality for traversals |
| Cons | Random edge cuts; many cross-partition hops | Expensive to compute; uneven partition sizes; requires periodic rebalancing |
| **Recommendation** | **Community-based** for read-heavy graph workloads. Hash partitioning works only if most queries are single-node lookups (which defeats the purpose of a graph database). |

### Decision 4: MVCC vs. Lock-Based Concurrency

| Aspect | MVCC (Multi-Version) | Lock-Based |
|--------|---------------------|-----------|
| Pros | Readers never block writers; snapshot isolation for traversals | Simpler implementation; lower storage overhead |
| Cons | Storage overhead for version chains; garbage collection of old versions; write-write conflicts still need detection | Read-write contention on hot nodes; potential for deadlocks |
| **Recommendation** | **MVCC for reads, locks for writes.** Long-running traversals should see a consistent snapshot (MVCC), while write transactions use record-level locks to prevent conflicting mutations. |

### Decision 5: Adjacency List vs. Adjacency Matrix (Internal Storage)

| Aspect | Adjacency List (Linked Records) | Adjacency Matrix (Bitmap) |
|--------|-------------------------------|--------------------------|
| Pros | Space-efficient for sparse graphs; natural for variable-degree nodes | O(1) edge existence check; cache-friendly for dense subgraphs |
| Cons | O(degree) to check edge existence; not cache-friendly for random access | O(V^2) space — prohibitive for large sparse graphs |
| **Recommendation** | **Adjacency list.** Real-world graphs are sparse (average degree 200 vs. millions of nodes). Matrix representation would consume petabytes. Vertex-centric indexes provide O(log d) edge existence checks where needed. |

---

## Trap Questions & How to Handle

### Trap 1: "Why not just use a relational database with JOINs?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of why graph databases exist | At small scale (thousands of nodes), JOINs work fine. But JOINs are O(n log n) per hop and require materializing intermediate result sets. A 4-hop query across 100M rows requires 4 JOINs, each scanning and sorting millions of rows. Graph databases with index-free adjacency perform the same traversal in O(d^4) where d is the average degree — completely independent of total data size. The crossover point where graphs win is typically around 3+ hops on datasets > 1M nodes. |

### Trap 2: "How do you shard a graph?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test awareness of graph partitioning difficulty | Acknowledge that optimal graph partitioning is NP-hard (balanced min-cut problem). Discuss community detection heuristics (Louvain, Metis) that find good-enough partitions. Explain the trade-off: better partitioning requires more computation and periodic rebalancing, but reduces cross-partition traversals. Mention property sharding as an alternative: keep graph topology on one machine and distribute property data. Finally, note that many production graph databases (Neo4j until recently) chose to NOT shard, instead scaling vertically, because the traversal degradation from sharding was worse than the cost of a larger machine. |

### Trap 3: "What about supernodes — a node with 10 million edges?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test awareness of power-law distributions | Explain that supernodes are inevitable in real-world graphs (power-law distribution). Without optimization, traversing a supernode scans all 10M relationships linearly. The solution is vertex-centric indexing: organize the supernode's edges into B+ tree groups by relationship type and edge properties. This turns a O(10M) scan into O(log(10M)) = ~23 lookups for filtered queries. Also discuss: application-level strategies like edge bucketing (split a celebrity into regional sub-nodes) and query-level strategies like LIMIT push-down. |

### Trap 4: "What happens if a node is deleted while a traversal is in progress?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test concurrency understanding | This is the "ghost relationship" problem. With MVCC, the traversal sees a consistent snapshot and will still see the deleted node's version. Without MVCC, lock-based protocols prevent the delete from completing until the traversal releases its shared locks. Discuss how the delete must cascade: removing a node requires removing all its incident edges and updating the pointer chains of all neighboring nodes — a potentially expensive operation for supernodes that may need to be batched. |

### Trap 5: "How do you handle schema evolution?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test practical production thinking | Graph databases are typically schema-optional: nodes can have any properties, and new label types can be introduced without migration. This is both a strength (flexibility) and a weakness (no enforcement). For production systems, discuss: optional schema constraints (uniqueness, existence, type enforcement), online index creation (builds index in background without blocking writes), and backward-compatible property evolution (add new properties, deprecate old ones, never remove without migration). |

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|---------------|-----------------|
| Designing a graph layer on top of a relational DB | Misses the fundamental value of index-free adjacency | Start with native graph storage; explain why O(1) traversal matters |
| Ignoring supernodes | Most real-world graphs have them; they dominate performance | Address power-law distribution and vertex-centric indexes early |
| Saying "just shard by node ID" | Hash sharding creates random cross-partition edges | Discuss community-based partitioning and explain why graph sharding is hard |
| No ACID transactions | Graph mutations update multiple records atomically | Explain WAL-based recovery and lock protocols |
| Ignoring the query planner | "Just traverse from the first node in the query" | Explain cost-based optimization and why starting point selection matters |
| Assuming uniform degree distribution | Leads to designs that work on benchmarks but fail on real data | Design for skewed distributions from the start |
| Not discussing memory | Graph traversals can expand exponentially | Memory budgets, streaming execution, LIMIT push-down |

---

## Questions to Ask Interviewer

| Question | Why It Matters |
|----------|---------------|
| What types of graphs? (social, knowledge, fraud) | Determines data model and query patterns |
| What is the typical traversal depth? | 2-3 hops vs. 6+ hops requires fundamentally different optimization |
| Read-heavy or write-heavy? | Determines caching strategy and replication topology |
| Do we need real-time analytics (PageRank) or just OLTP? | Determines whether a separate analytics engine is needed |
| What is the expected graph size? (nodes, edges) | Determines whether vertical scaling suffices or sharding is required |
| Are there known supernodes? | Determines priority of supernode optimization |
| Consistency requirements? | Determines replication strategy (sync vs. async) |
| Multi-tenant or single-tenant? | Determines security model (label-based isolation vs. separate instances) |

---

## Additional Trap Questions

### Trap 6: "How do you handle a node deletion that has millions of edges?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of cascading operations and performance implications | Deleting a supernode requires removing all its incident edges — potentially millions of records. Each edge deletion requires updating 4 pointer chains (the doubly-linked lists of both endpoint nodes). This cannot be done in a single transaction without holding locks for seconds. The production approach is "soft delete with background cleanup": mark the node as deleted (making it invisible to queries), then asynchronously remove edges in batches (e.g., 10K edges per batch transaction). During cleanup, other transactions can still create edges to the "deleted" node — these must be intercepted by a pre-commit hook that checks for deleted target nodes. An alternative is "tombstone with lazy GC": the deleted node becomes a tombstone, and relationship chains that encounter the tombstone treat it as a traversal dead-end. |

### Trap 7: "How would you add vector search to a graph database for GraphRAG?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test awareness of modern hybrid architectures | The key design decision is whether to build the vector index into the graph engine or use an external vector store. Integrated approach: each node can have a vector property (e.g., 768-dim embedding), indexed by an HNSW (Hierarchical Navigable Small World) graph. Queries combine vector similarity with graph traversal: "find the 10 nearest entities by embedding AND traverse their 2-hop neighborhood." The challenge is that vector indexes operate on flat vector spaces while graph traversal follows structural relationships — the two search dimensions may pull results in different directions. The practical architecture uses vector search for initial candidate retrieval and graph traversal for context enrichment — similar to how GraphRAG systems work with LLMs. |

### Trap 8: "What's the difference between a graph database and a graph compute engine?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of OLTP vs. OLAP in graph context | A graph database (Neo4j, Neptune) is an OLTP system optimized for low-latency transactional queries: "find Alice's friends," "shortest path between A and B." It stores the graph durably, supports ACID transactions, and serves concurrent interactive queries. A graph compute engine (Pregel, Apache Giraph, GraphX) is a batch processing system for full-graph analytics: "compute PageRank for all nodes," "detect all communities." It loads the entire graph into memory across a cluster and runs iterative message-passing algorithms. The two serve different workloads: graph databases for point queries (sub-millisecond latency), graph compute engines for global analytics (minutes to hours). Many production systems use both: a graph database for OLTP and a compute engine for periodic offline analytics, with results written back to the database. |

### Trap 9: "Why not store the graph in a key-value store with adjacency lists?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test depth of understanding beyond surface-level architecture | This actually works well for simple 1-2 hop lookups — store each node's adjacency list as a single value, keyed by node ID. The problems emerge with: (1) Multi-hop traversals require multiple round-trips to the KV store, each with serialization/deserialization overhead. (2) Updating a single edge requires read-modify-write of the entire adjacency list (which may be huge for supernodes). (3) Pattern matching requires pulling adjacency lists for many nodes and performing joins in the application layer. (4) Transaction semantics across multiple KV entries are complex. The KV-backed approach trades the graph database's O(1) pointer traversal for O(serialized_list) per hop, which is acceptable at small degree but catastrophic for supernodes and deep traversals. Meta's TAO system uses this approach successfully because they cache aggressively and their workload is dominated by 1-hop lookups. |

---

## Discussion Talking Points

### Talking Point 1: The GQL Standard and Industry Convergence

GQL (Graph Query Language, ISO/IEC 39075) became the first ISO-standard graph query language, unifying concepts from Cypher, PGQL, and G-CORE. Key implications for system design:

- **Pattern matching is standardized:** The `MATCH` clause with path patterns is the universal primitive for graph queries
- **Composability:** GQL supports graph-to-graph queries where the output of one query becomes the input graph for another
- **Separation of concerns:** GQL distinguishes between graph DDL (schema), DML (data manipulation), and DQL (queries)
- **Interview relevance:** Mentioning GQL shows awareness of industry direction without tying the design to a specific vendor

### Talking Point 2: When NOT to Use a Graph Database

Demonstrating when NOT to use graph databases shows mature engineering judgment:

| Scenario | Why Graph DB is Wrong | Better Alternative |
|----------|----------------------|-------------------|
| Flat entity storage with no relationships | No traversals to optimize | Document store or relational DB |
| Simple foreign key relationships (1-2 JOINs) | Relational DB handles this efficiently | PostgreSQL with indexes |
| High-volume append-only data | Graph DB's write amplification is wasteful | Time-series DB or log store |
| Full-text search is the primary access pattern | Graph traversal is secondary | Search engine with graph features |
| Data is naturally tabular (transactions, events) | Forcing graph model adds complexity | Relational or columnar DB |
| Write-dominant workload (>50% writes) | Graph DB write amplification (6x) limits throughput | Key-value store with graph layer |

### Talking Point 3: Property Graph vs. RDF — When Each Wins

| Criterion | Property Graph Wins | RDF Wins |
|-----------|-------------------|----------|
| **Developer familiarity** | Natural object-like model | Requires understanding triples/ontologies |
| **Query performance** | Optimized for local traversals | Optimized for global pattern matching |
| **Schema flexibility** | Properties on nodes/edges directly | Ontology-based reasoning and inference |
| **Use case** | Social, fraud, recommendations | Knowledge management, semantic web, data integration |
| **Standardization** | GQL (new, evolving) | SPARQL (mature, widely adopted) |
| **Inference** | Manual (application logic) | Automatic (OWL/RDFS reasoning) |

---

---

## Scoring Rubric

### What Distinguishes Senior/Staff-Level Answers

| Dimension | Junior Answer | Senior/Staff Answer |
|-----------|--------------|-------------------|
| **Storage engine** | "Use a graph database" | "Native graph storage with index-free adjacency using fixed-size records (64B nodes, 64B rels) enabling O(1) pointer traversal" |
| **Supernodes** | Not mentioned | "Relationship groups organized by type with vertex-centric B+ tree indexes; dense_flag triggers alternative storage path" |
| **Partitioning** | "Shard by node ID" | "Community-based partitioning minimizing edge cuts; property sharding separating topology from attributes; ghost replicas for border nodes" |
| **Query planning** | "Parse the query and execute" | "Cost-based optimizer with cardinality estimation, supernode awareness, and adaptive re-optimization when estimates are 10x+ off" |
| **Concurrency** | "Use transactions" | "MVCC for snapshot-isolated reads, record-level locks for writes, deadlock detection via wait-for graph, CAS for pointer updates" |
| **Security** | "Use RBAC" | "Per-hop traversal authorization, traversal escalation prevention, graph structure inference attacks, timing side-channel mitigation" |

### Red Flags That Weaken a Candidate's Response

| Red Flag | Why It's Concerning |
|----------|-------------------|
| Designing a graph layer on PostgreSQL | Misunderstands the fundamental value of native graph storage |
| No mention of supernodes or power-law | Designed for uniform data that doesn't exist in production |
| "Just use hash sharding" | Doesn't understand why graph partitioning is uniquely hard |
| No concurrency story | Graph mutations update multiple records atomically — this is non-trivial |
| Ignoring the query planner | Starting point selection changes cost by 6 orders of magnitude |
| No memory management | Variable-length path queries can explode memory usage |
| "Graph databases are always better for relationships" | Misses the crossover point (graph wins at 3+ hops, not for simple foreign keys) |

### Signals of Exceptional Depth

| Signal | What It Shows |
|--------|--------------|
| Discusses write amplification (6 record updates per edge) | Deep understanding of pointer chain mechanics |
| Mentions property sharding vs. topology sharding | Knows the cutting-edge scaling strategy |
| Explains when NOT to use a graph database | Mature engineering judgment |
| References the buffer cache hit ratio as the key SLO | Understands the O(1) guarantee's hidden assumption |
| Mentions GQL standard (ISO 39075) | Aware of industry direction |
| Discusses graph structure inference attacks | Unique security domain knowledge |

---

## Quick Reference Card

```
GRAPH DATABASE DESIGN CHEATSHEET
─────────────────────────────────
Storage: Native graph with index-free adjacency
Records: Fixed-size (64B nodes, 64B rels, 128B props)
Traversal: O(1) per hop via physical pointers
Supernodes: Relationship groups + vertex-centric B+ indexes
Query: GQL/Cypher → Cost-based optimizer → Streaming executor
Partitioning: Community-based (Louvain/Metis) + hash fallback
Replication: Raft consensus, 3x per partition
Concurrency: MVCC for reads, record-level locks for writes
WAL: Write-ahead log with synchronous replication
Cache: Buffer cache (80% RAM) + query result cache + neighbor cache
Failover: Automatic leader election < 15 seconds
Key Metric: Buffer cache hit ratio > 90%
Key Trade-off: Partition quality vs. rebalancing cost
GraphRAG: Vector index on nodes + graph traversal for AI context
Write Amplification: 6 record updates per edge creation
Supernode Threshold: >10K edges → switch to B+ tree groups
```

---

## 15-Minute Speed Round (Shortened Format)

For shorter interview formats, hit these points in order:

| Minute | Topic | Key Statement |
|--------|-------|---------------|
| 0-2 | Clarify scope | "I'll design a native property graph database optimized for OLTP traversals" |
| 2-5 | Storage engine | "Fixed-size records with index-free adjacency: nodes 64B, rels 64B, with doubly-linked relationship chains for bidirectional O(1) traversal" |
| 5-8 | Supernodes | "Power-law distributions create supernodes. Relationship groups indexed by type with vertex-centric B+ trees reduce O(degree) to O(log degree)" |
| 8-11 | Query pipeline | "Parser → cost-based optimizer (cardinality estimation, starting node selection) → streaming executor with LIMIT push-down" |
| 11-13 | Distribution | "Community-based partitioning minimizes edge cuts. Property sharding keeps topology local. 3x Raft replication per partition" |
| 13-15 | Trade-offs | "Vertical scaling preferred — 2TB RAM can hold 30B edges. Horizontal scaling only when needed, accepting cross-partition latency penalty" |

---

## Common Follow-Up Questions

### "How would you migrate from a relational database to a graph database?"

**Answer framework:**
1. **Identify the graph model:** Map relational tables to node labels (Users → :Person), foreign keys to edges (user_id → :FOLLOWS), and columns to properties
2. **Dual-write migration:** Write to both the relational DB and the graph DB. Reads still go to the relational DB.
3. **Backfill:** Bulk-import existing relational data using the graph database's import tool (bypassing WAL for speed)
4. **Shadow reads:** Run graph queries in parallel with relational queries; compare results for correctness
5. **Traffic switch:** Gradually shift read traffic to the graph database; monitor latency and correctness
6. **Decommission:** Once all reads are on the graph database, stop writing to the relational DB

**Key risk:** The relational schema may not map cleanly to a property graph. Many-to-many junction tables become edges, but implicit relationships (e.g., two users in the same city) must be modeled explicitly as edges if they need to be traversed.

### "How would you implement a recommendation engine using a graph database?"

**Answer framework:**
1. **Collaborative filtering via traversal:** "Users who bought X also bought Y" = 2-hop traversal: User → PURCHASED → Product ← PURCHASED ← Other Users → PURCHASED → Recommended Products
2. **Scoring:** Weight recommendations by path frequency (products reached via many users score higher), recency (recent purchases weighted more), and diversity (avoid recommending products too similar to what the user already owns)
3. **Pre-computation:** For hot paths (top 10K products), pre-compute recommendations and store as materialized edges (:RECOMMENDED_FOR) with scores
4. **Real-time fallback:** For cold-start or long-tail queries, run live graph traversals with LIMIT push-down
5. **Supernode handling:** Popular products are supernodes (millions of PURCHASED edges). Use vertex-centric indexes filtered by time window to avoid scanning all purchases.

### "How do you handle schema evolution in a graph database?"

**Answer framework:**
- Graph databases are inherently schema-flexible: new properties and labels can be added without migration
- For breaking changes (renaming a property, changing a relationship type), use a dual-property strategy:
  1. Add the new property alongside the old one
  2. Migrate application code to read from new property (with fallback to old)
  3. Backfill: copy old property values to new property for all affected nodes
  4. Remove reads from old property
  5. Drop old property (or mark deprecated)
- For relationship type changes (e.g., FOLLOWS → SUBSCRIBES_TO): create new edges, dual-read, then delete old edges
- Schema constraints (uniqueness, existence) can be added online without blocking writes — the constraint is verified only for new writes and validated against existing data asynchronously
