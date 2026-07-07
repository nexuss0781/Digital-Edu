# Key Insights: AI-Native Enterprise Knowledge Graph

## Insight 1: Hierarchical Entity Resolution with Three-Tier Speed Paths
**Category:** Scaling
**One-liner:** Route 90% of entity mentions through a sub-5ms exact cache match, 9% through a 50ms ensemble scorer, and only 1% through expensive LLM-based verification.
**Why it matters:** Naive entity resolution against 5 billion existing entities is O(n^2) and infeasible. The hierarchical approach exploits the power-law distribution of entity mentions: most mentions match a canonical name already in cache (fast path), a smaller fraction requires blocking plus ensemble scoring (standard path), and only rare ambiguous cases need LLM verification and potential human review (slow path). This achieves sub-200ms latency for real-time ingestion while maintaining >90% precision. The design principle is that expensive operations should be reserved for the cases where they actually change the outcome.

---

## Insight 2: Precision Over Recall in Entity Merging
**Category:** Consistency
**One-liner:** False merges corrupt the graph permanently and are far harder to undo than duplicate entities, so the system prioritizes precision (>90%) over recall.
**Why it matters:** Merging "John Smith (CEO)" with "John Smith (Intern)" creates a corrupted node that pollutes every downstream query and reasoning chain. In contrast, having "IBM" and "International Business Machines" as separate entities merely fragments knowledge and can be resolved in a batch cleanup job. The 0.85 matching threshold with human review for the 0.80-0.90 uncertainty band reflects this asymmetry. Transitive closure (where A=B and B=C implies A=C) is deliberately deferred to batch processing because it can cause explosive, irreversible merges in real-time.

---

## Insight 3: Leiden Over Louvain for Community Detection
**Category:** Data Structures
**One-liner:** Leiden guarantees internally well-connected communities, which is a prerequisite for coherent GraphRAG summarization.
**Why it matters:** Louvain can produce communities where some nodes are only connected to the community through nodes in other communities. This means community summaries may describe a disconnected grab-bag of entities, making global search answers incoherent. Leiden's refinement phase prevents this by ensuring every community is internally well-connected. While Leiden is slightly slower, the quality improvement in summarization (which is the entire point of global search) makes it the clear choice. Quality metrics like modularity (>0.3), average community size (100-10,000), and singleton rate (<5%) provide ongoing validation.

---

## Insight 4: Local vs. Global vs. DRIFT Search for Query Routing
**Category:** Partitioning
**One-liner:** Specific entity questions use K-hop local search (200-500ms), thematic questions use community-based global search (500ms-2s), and complex multi-faceted questions use DRIFT iterative refinement.
**Why it matters:** Traditional RAG retrieves text chunks by similarity and loses structural relationships. GraphRAG splits retrieval into three modes that each exploit graph structure differently. Local search starts from identified entities and traverses K hops to gather relationship context. Global search searches pre-computed community summaries for thematic coverage. DRIFT dynamically identifies gaps in current context and generates follow-up queries, converging when coverage exceeds 90%. The non-obvious insight is that query classification into these modes is itself a critical design decision, and misclassification (using global search for a specific entity question) degrades both latency and accuracy.

---

## Insight 5: Bi-Temporal Modeling for Knowledge Evolution
**Category:** System Modeling
**One-liner:** Track both when something happened in the real world (event time) and when the system learned about it (ingestion time) to support point-in-time queries and auditing.
**Why it matters:** Enterprise knowledge constantly evolves: people change roles, projects change scope, and facts get corrected. A single-timeline model cannot answer "Who was the CEO in 2020?" or "What did we know last February?" The bi-temporal model stores both event_time and ingestion_time on every relationship, enabling four distinct query patterns: current state, point-in-time by event, point-in-time by knowledge, and full change history. Versioned edges with period tree indexes provide O(log v) per-edge query performance for time-range queries, balancing storage overhead against query flexibility.

---

## Insight 6: Hybrid Blocking Strategies to Reduce O(n^2) Resolution
**Category:** Scaling
**One-liner:** Union of name prefix, phonetic (Metaphone), and embedding LSH blocking strategies achieves 99% recall with 30x candidate reduction, making billion-scale resolution feasible.
**Why it matters:** Comparing 50 million new mentions against 5 billion entities naively requires 250 quadrillion comparisons. Each blocking strategy trades off recall against reduction ratio differently: name prefix (100x reduction, 95% recall) is fast but misses spelling variations; embedding LSH (200x reduction, 92% recall) captures semantic similarity but requires embedding computation; phonetic codes (60x reduction, 97% recall) handle name variations but fail for non-English. By taking the union of candidates from all three strategies, the system achieves near-perfect recall (99%) at a manageable 30x reduction. The ensemble scoring then precisely filters these candidates.

---

## Insight 7: Multi-Hop Error Propagation and Verification
**Category:** Consistency
**One-liner:** Even with 95% per-hop accuracy, a 4-hop reasoning chain yields only 81% final accuracy, making per-step verification essential rather than optional.
**Why it matters:** Error compounds exponentially across reasoning hops: 0.95^4 = 0.815. This mathematical reality means that verification is not a luxury but a core architectural requirement for multi-hop reasoning. The recommended approach combines graph constraint checking (fast, +15% accuracy, +100ms) with LLM self-verification for important queries (+20% accuracy, +500ms). The reasoning trace stores evidence, answer, confidence, and verification status at each step, enabling backtracking when a step fails verification rather than propagating errors to the final answer.

---

## Insight 8: Snapshot Isolation for Concurrent Graph Reads During Updates
**Category:** Contention
**One-liner:** Use MVCC (Multi-Version Concurrency Control) so readers see a consistent graph snapshot even while batch updates are running.
**Why it matters:** A common race condition occurs when users query the graph while batch entity resolution or community updates are in progress, potentially seeing partially updated communities or inconsistent entity states. MVCC ensures readers see a consistent snapshot at their query start time while writers create new versions. For community summaries, an eventual consistency model with a staleness flag allows fresh-critical queries to trigger inline regeneration while normal queries use cached summaries. The locking strategy is carefully tiered: distributed locks for entity creation, optimistic locking for entity updates, no locks (MVCC) for traversal, and advisory locks for community updates.

---

## Insight 9: Contradiction Detection with Relationship Exclusivity Classification
**Category:** Atomicity
**One-liner:** Classify relationships as exclusive (reports_to) or non-exclusive (works_on) to automatically resolve supersession conflicts while flagging factual conflicts for human review.
**Why it matters:** When a new fact contradicts an existing one, the correct resolution depends on the relationship type. "Alice reports_to Bob" superseding "Alice reports_to Carol" is a normal temporal update (close the old edge, open the new one). But "Alice's title is VP" conflicting with "Alice's title is Director" at the same timestamp is a genuine factual conflict requiring human review. The system classifies each conflict type and applies the appropriate resolution: supersession uses event_time comparison to determine which fact is newer, while same-time factual conflicts are flagged for review. This prevents both silent data loss and unnecessary human escalation.

---

## Insight 10: Graph Sharding by Community Minimizes Cross-Partition Traversal

**Category:** Partitioning
**One-liner:** Sharding the graph along community boundaries (detected by Leiden) keeps 90%+ of multi-hop traversals within a single partition, dramatically reducing cross-shard network calls during GraphRAG queries.

**Why it matters:** Naive hash-based sharding distributes entities randomly, meaning a 3-hop traversal has a high probability of crossing shard boundaries at every hop. Each cross-shard hop adds 1-5ms network latency and requires distributed coordination. Community-based sharding co-locates entities that are densely connected (and therefore likely to be co-traversed) onto the same shard. Since Leiden communities represent clusters of related knowledge, GraphRAG local search (which traverses K hops from seed entities) stays within a single partition for most queries. The trade-off is that community-based sharding creates uneven partition sizes (some communities are much larger than others), requiring a secondary balancing strategy that splits oversized communities along sub-community boundaries. Rebalancing is triggered when partition size exceeds 2x the median, and is performed online using the same double-write pattern used for entity migration.

---

## Insight 11: The Personal Knowledge Layer Pattern — User-Specific Graphs Atop Shared Enterprise Graph

**Category:** Architecture
**One-liner:** Layering per-user interaction graphs (searches, bookmarks, annotations, access patterns) on top of the shared enterprise knowledge graph enables personalized retrieval without duplicating the base graph.

**Why it matters:** Two users asking "What are our compliance requirements?" need different answers based on their role, department, and recent work context. The shared enterprise graph contains the same facts for both, but a personal layer tracks user-specific signals: which entities the user interacts with frequently, which documents they've read, which teams they collaborate with, and what implicit expertise they have based on contribution patterns. At query time, the personal layer provides re-ranking signals: entities and communities the user interacts with frequently are boosted in retrieval. This is architecturally similar to how Glean layers personal context on enterprise search. The personal graph is small (thousands of edges per user), stored in a lightweight format (adjacency list in Redis or a user-scoped partition), and updated incrementally from access logs and interaction events. The critical design constraint is that the personal layer must never override access control — it can boost visible results but cannot surface documents the user lacks permission to see.

---

## Insight 12: LLM-Native Construction Reduces Knowledge Graph Build Cost by 80-90% but Shifts Quality Challenges

**Category:** Cost Optimization
**One-liner:** LLM-based entity and relation extraction replaces months of manual curation with hours of automated pipeline processing, but introduces new quality challenges: extraction hallucination, inconsistent relation typing, and confidence calibration.

**Why it matters:** Traditional enterprise knowledge graphs required teams of knowledge engineers manually identifying entities, defining relationships, and curating the ontology — costing $500K-$2M and taking 6-18 months for a medium-scale deployment. LLM-native pipelines (using GLiNER for NER, LLM prompting for relation extraction, and semantic matching for entity resolution) reduce this to days of engineering and hours of processing. But the quality profile shifts: instead of high-quality, low-coverage manual graphs, LLM-native graphs have broad coverage but variable quality. Entity extraction F1 of 85% means 15% of entities are wrong (hallucinated, mis-typed, or mis-bounded). Relation extraction at 75% F1 means 25% of relationships are incorrect. The system must be designed with quality as a first-class concern: confidence scoring on every extraction, multi-model voting for high-value entities, human-in-the-loop review for entities above a utility threshold, and continuous quality monitoring that tracks precision/recall against a gold-standard evaluation set. The insight is that LLM-native construction doesn't eliminate the quality engineering — it transforms it from manual curation into automated quality assurance.
