# Interview Guide — AI-Native Data Catalog & Governance

## 45-Minute Pacing Guide

| Time | Phase | Focus | What to Cover |
|------|-------|-------|---------------|
| 0-5 min | **Clarify** | Scope the problem | Ask: "Is this a discovery-focused catalog or a governance-enforcing platform?" Clarify scale (number of sources, users, compliance requirements). Establish whether NL-to-SQL is in scope. |
| 5-15 min | **High-Level** | Core architecture | Draw the metadata graph, search index, ingestion pipeline, and policy engine. Explain push vs. pull ingestion. Show the event bus connecting all components. |
| 15-30 min | **Deep Dive** | Pick 1-2 critical areas | **Option A:** Column-level lineage extraction (SQL parsing, AST, schema resolution). **Option B:** Auto-classification pipeline (multi-stage: regex → NER → LLM). **Option C:** Tag-based policy enforcement (ABAC, inheritance, caching). |
| 30-40 min | **Scale & Trade-offs** | Production concerns | Discuss metadata freshness vs. ingestion cost, classification precision vs. recall trade-off, search ranking signals, and graceful degradation when the LLM is unavailable. |
| 40-45 min | **Wrap Up** | Summary and follow-ups | Highlight the key insight: the catalog is a metadata platform, not a data platform — it never stores or queries actual data, only metadata. Touch on adoption as the real success metric. |

---

## Key Insights to Demonstrate

Interviewers are looking for non-obvious thinking. Drop these insights naturally during the conversation:

1. **"Adoption is the primary failure mode"** — Position this early. A catalog that nobody uses is worse than no catalog because it gives false governance confidence.

2. **"Lineage confidence matters"** — Don't present lineage as perfect. Explain that different extraction methods produce different confidence levels, and the UI must communicate this.

3. **"The governance loop is powerful but fragile"** — Classify → Tag → Enforce → Audit works beautifully when classification is accurate. One bad classification breaks trust in the entire loop.

4. **"Connector breadth > feature depth"** — A catalog with 100 shallow connectors beats a catalog with 5 deep connectors. The cross-system graph is the unique value.

5. **"The catalog is infrastructure, not a feature"** — Frame it as the "DNS of the data organization" — everyone depends on it, nobody thinks about it when it works.

---

## Clarification Questions to Ask

Before designing, ask these questions to scope the problem correctly:

| Question | Why It Matters | Impacts |
|----------|---------------|---------|
| "How many data sources need to be connected?" | Determines connector complexity and ingestion architecture | 10 sources = simple; 100+ = need push/pull hybrid, event bus |
| "Is this primarily for discovery or governance?" | Shapes whether search or policy is the core | Discovery-first = invest in ranking; Governance-first = invest in classification + policy |
| "What compliance frameworks apply?" | Determines audit, encryption, and retention requirements | GDPR = lineage + erasure; HIPAA = strict masking; EU AI Act = bias metadata |
| "Do AI agents need programmatic access?" | Determines API design and MCP support | If yes, design structured APIs from day one |
| "How mature is the data organization?" | Determines adoption strategy | Mature = focus on advanced features; Immature = focus on search + basic cataloging |
| "Is cross-system lineage required?" | Determines parser complexity | Warehouse-only = simpler; Warehouse + BI + ML = multi-parser, cross-system stitching |

---

## Where to Spend Most Time

**Column-level lineage** is the most technically interesting deep dive because it involves:
1. SQL parsing across dialects (a hard problem with real edge cases)
2. Schema-aware column resolution (requires catalog integration)
3. Graph construction at scale (200M+ edges)
4. Impact analysis traversal algorithms

If the interviewer is more governance-oriented, pivot to **tag-based policy enforcement** with ABAC — it's a rich design space with inheritance semantics, conflict resolution, and caching challenges.

If the interviewer is more ML/AI-oriented, pivot to **auto-classification pipeline** — cascading ML stages, confidence thresholds, human-in-the-loop feedback, and the governance trust loop.

---

## Trade-off Frameworks

| Decision | Option A | Option B | Recommendation |
|----------|----------|----------|----------------|
| **Metadata storage** | Graph database (native traversal) | RDBMS with adjacency model | **RDBMS** — simpler ops, ACID transactions, good enough for lineage with materialized paths. Graph DB only if traversal is the dominant query pattern with 6+ hops. |
| | Pros: Native path queries, intuitive model | Pros: Operational maturity, schema migrations, strong consistency | |
| | Cons: Weak ACID, harder ops, smaller talent pool | Cons: Recursive CTEs for deep traversal, denormalization needed | |
| **Classification approach** | Regex-only (deterministic) | ML-based (NER + LLM) | **Hybrid** — regex for structured patterns (SSN, email), NER for unstructured text, LLM for ambiguous cases. Determinism where possible, ML where needed. |
| | Pros: Predictable, fast, no false positives from model errors | Pros: Catches PII in free text, handles novel patterns | |
| | Cons: Misses PII in unstructured data, brittle to format changes | Cons: False positives, model drift, higher latency, needs retraining | |
| **Ingestion model** | Pull-only (scheduled crawls) | Push + Pull hybrid | **Hybrid** — pull for batch sources (warehouses, BI tools), push for real-time sources (pipeline DAGs, streaming metadata). Push gives freshness; pull gives coverage. |
| | Pros: Simpler architecture, centralized scheduling | Pros: Real-time freshness for critical sources | |
| | Cons: Metadata is always stale by crawl interval | Cons: More complex; push sources need instrumentation | |
| **Policy enforcement point** | Catalog-side (filter at search time) | Query-engine-side (enforce at data access) | **Both** — catalog filters search results by visibility policy (don't show assets you can't access), but actual data masking/filtering happens at the query engine. The catalog informs, the engine enforces. |
| | Pros: Prevents metadata leakage | Pros: Cannot be bypassed by direct SQL | |
| | Cons: Only controls catalog access, not data access | Cons: Requires integration with every query engine | |
| **Search ranking** | Static scoring (hand-tuned weights) | Learning-to-rank (ML model) | **Start static, graduate to ML** — hand-tuned weights (text 0.35, usage 0.25, quality 0.15, freshness 0.10, affinity 0.15) work well initially. Train L2R model once you have 6+ months of click-through data. |
| | Pros: Transparent, debuggable, no training data needed | Pros: Learns user preferences, adapts to changing patterns | |
| | Cons: Cannot personalize, doesn't learn from behavior | Cons: Needs click data, harder to debug, cold-start problem | |
| **Event architecture** | Polling-based sync | Event-driven with active metadata | **Event-driven** — polling creates inherent staleness and wastes resources. Event-driven enables real-time governance automation (classify → tag → enforce) that polling cannot match. |
| | Pros: Simpler to implement, no event bus dependency | Pros: Real-time, enables active metadata automation | |
| | Cons: Metadata always stale by poll interval, wasted compute | Cons: More complex infrastructure, event ordering challenges | |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Why not just use the data warehouse's built-in catalog?" | Understand the limitations of single-system catalogs | "A warehouse catalog only knows about its own tables. An enterprise data catalog spans 50+ sources — warehouses, lakes, BI tools, ML platforms, streaming systems — and provides cross-system lineage and unified governance. The warehouse catalog is one *source* of metadata for the enterprise catalog, not a replacement." |
| "How do you handle lineage for stored procedures and dynamic SQL?" | Test awareness of lineage extraction limits | "Static SQL parsing cannot handle dynamic SQL (EXECUTE IMMEDIATE, string concatenation). For these cases, fall back to runtime lineage: instrument the query engine to capture actual column-level I/O during execution. This gives accurate lineage at higher cost, used selectively for dynamic SQL paths." |
| "What if teams don't want to use the catalog?" | Test understanding that adoption is the real challenge | "The catalog must be embedded where people already work — IDE plugins, dbt integrations, BI tool extensions, Slack bots — not a separate portal they have to visit. Enforce 'catalog-first' policies: no data access without catalog registration. Measure adoption as the primary success metric, not feature count." |
| "How do you ensure classification accuracy at 95%+ precision?" | Test understanding of the precision-recall trade-off | "95% precision means accepting lower recall — some PII will be missed. The system uses cascading classification (regex → NER → LLM) with increasing cost and accuracy. High-confidence classifications are auto-applied; borderline cases go to human review. The feedback loop from human reviews continuously improves the model. The key insight is that 100% precision is impossible; the goal is to make the residual error rate acceptable for the compliance context." |
| "Why not just tag everything as PII to be safe?" | Test understanding of over-governance costs | "Over-classification is as harmful as under-classification. If every column is tagged PII, masking is applied everywhere, analytics teams can't do their jobs, and they'll find workarounds that bypass governance entirely. The goal is *accurate* classification that applies masking only where needed — preserving data utility while protecting sensitive data." |
| "How do you handle schema changes that break data contracts?" | Test understanding of contract enforcement | "The catalog sits between the producer's CI/CD pipeline and deployment. On schema change, the catalog checks all active contracts. Breaking changes are blocked with a notification to the producer listing affected consumers. Non-breaking changes (additive columns) pass through. The producer can initiate a contract version upgrade with consumer migration support." |
| "What happens if the LLM provider goes down?" | Test graceful degradation thinking | "NL-to-SQL is a convenience layer, not a core function. When the LLM is unavailable: (1) serve cached responses for previously asked questions, (2) degrade to keyword search with suggested queries, (3) show a clear 'NL query temporarily unavailable' message. Classification also falls back to regex + NER only — no LLM disambiguation." |
| "How do you prevent the catalog from becoming a single point of failure?" | Test understanding of operational criticality | "The catalog is a read-heavy reference system — if it goes down, data pipelines continue running because they don't depend on the catalog at runtime. The exception is if active metadata automation is in the critical path (e.g., policy evaluation at query time). For that, use a cached policy decision layer with a 5-minute staleness tolerance." |

---

## Deep Dive Preparation: Questions the Interviewer Might Ask

### On Lineage

| Question | Expected Depth |
|----------|---------------|
| "Walk me through how you extract lineage from a complex CTE chain" | Expect to whiteboard AST parsing, alias resolution, recursive CTE handling |
| "How do you handle lineage across system boundaries?" | Discuss connector-specific extraction + stitching via entity matching |
| "What is the traversal algorithm for impact analysis?" | BFS with depth limit, materialized closure for common hops, bidirectional for root cause |
| "How do you version lineage?" | Event-sourced: every edge change is an event; temporal queries reconstruct lineage at any point in time |

### On Classification

| Question | Expected Depth |
|----------|---------------|
| "How does the model handle a column named 'notes' that sometimes contains SSNs?" | Contextual classification: NER on text content + LLM for ambiguous cases |
| "How do you bootstrap classification for a new data source?" | Full scan with priority queue (name-based hints first), incremental scans after |
| "What if different domains have different definitions of PII?" | Domain-specific classification policies with configurable confidence thresholds |

### On Policy

| Question | Expected Depth |
|----------|---------------|
| "How do you resolve conflicting policies?" | Priority-based: explicit deny wins, then highest priority, then most specific scope |
| "How does tag inheritance work?" | Parent-to-child: database → schema → table → column; inheritable flag per tag |
| "How do you handle policy evaluation at scale?" | Cache with TTL + event-driven invalidation; pre-compute for hot entities |

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | What to Do Instead |
|---------|----------------|-------------------|
| Designing a query engine instead of a catalog | The catalog stores metadata, not data | Clearly separate: "The catalog answers 'what data exists and where' — the query engine answers 'what is in the data'" |
| Ignoring the adoption problem | Technical excellence with zero users is worthless | Design for embedding in existing workflows; measure WAU and search CTR as primary KPIs |
| Treating lineage as a solved problem | SQL parsing across dialects is genuinely hard | Acknowledge limitations: dynamic SQL, UDFs, cross-system gaps. Discuss fallback strategies. |
| Over-indexing on NL-to-SQL | It's flashy but not the core value proposition | Position NL-to-SQL as an accessibility layer on top of the catalog, not the catalog's primary purpose |
| Proposing graph database without justification | Graph DBs have operational costs | Justify with query patterns: if 90% of queries are key lookups and 1-2 hop lineage, RDBMS is sufficient |
| Forgetting policy enforcement at the data layer | Catalog-only enforcement is bypassable | Explain that the catalog *informs* policies, but the query engine/data platform *enforces* them |
| Designing for a single region | Compliance often requires regional data sovereignty | Mention federated catalog architecture for multi-region; data residency metadata |
| Ignoring the connector ecosystem | A catalog without connectors is an empty database | Emphasize that connector breadth (number of sources connected) is the primary adoption driver |
| Treating all lineage edges as equally reliable | Different extraction methods have different confidence | Attach confidence scores to lineage edges; display differently in UI |
| Designing classification as a batch job | New PII can appear between batch runs | Combine batch (full scan) with incremental (event-driven classification of new/changed columns) |

---

## What Distinguishes Senior vs. Staff Answers

| Aspect | Senior Answer | Staff Answer |
|--------|--------------|-------------|
| **Scope** | Focuses on technical components (search, lineage, classification) | Adds organizational dimensions: adoption strategy, change management, domain ownership model |
| **Lineage** | Describes SQL parsing and graph storage | Discusses the fundamental limitation that lineage accuracy depends on parsing quality, and proposes a tiered approach (static parsing + runtime lineage + manual annotation) with coverage metrics and confidence scoring |
| **Classification** | Describes NER + regex pipeline | Discusses the precision-recall trade-off as a governance decision, the feedback loop that improves accuracy over time, domain-specific thresholds, and the organizational process for handling borderline cases |
| **Policy** | Describes ABAC with tags | Explains how tag-based policies compose with auto-classification to create an automated governance loop: classify → tag → enforce → audit → improve classification |
| **Success metric** | Latency, uptime, entity count | Adoption rate, time-to-first-discovery, search click-through rate, classification coverage — metrics that measure whether the catalog is actually useful |
| **AI integration** | Describes NL-to-SQL feature | Discusses catalog as MCP server for AI agents; governance-aware query generation; LLM security (prompt injection, output validation) |
| **Compliance** | Mentions GDPR and SOC 2 | Discusses EU AI Act implications, bias metadata requirements, cross-border data sovereignty, and the catalog as the compliance evidence system |
| **Failure modes** | Discusses component failures | Discusses organizational failure modes: classification trust erosion, policy sprawl, connector rot, metadata staleness spiral |
| **Data contracts** | May not mention | Explains how lineage-derived consumer discovery enables automatic contract enforcement without explicit registration |
| **Cost analysis** | Focuses on infrastructure cost | Discusses total cost of ownership including connector maintenance, steward review time, adoption investment, and the cost of NOT having a catalog (compliance fines, duplicated datasets, broken pipelines) |

---

## Estimation Quick-Reference

If the interviewer asks you to estimate capacity, use these anchors:

| Scale | Sources | Tables | Columns | Lineage Edges | Search QPS | Storage |
|-------|---------|--------|---------|---------------|-----------|---------|
| Startup | 10 | 50K | 1M | 5M | 5 | 20 GB |
| Mid-size | 50 | 500K | 10M | 50M | 20 | 200 GB |
| Enterprise | 200 | 2M | 40M | 200M | 50 | 2 TB |
| Hyperscale | 1000+ | 10M+ | 200M+ | 1B+ | 200+ | 10 TB+ |

**Quick formula:** Storage ≈ (entities × 250 bytes) + (edges × 100 bytes) + (quality_history × 200 bytes × 90 days) + (search_index × 30% of graph size)

---

## Architecture Sketch Guide

When whiteboarding, draw these components in this order:

```
1. Start with the metadata graph (central)
2. Add the search index (reads from graph)
3. Add the ingestion pipeline (writes to graph via event bus)
4. Add the policy engine (reads tags from graph)
5. Add the classification engine (reads columns, writes tags)
6. Add the NL-to-SQL engine (reads schema from catalog)
7. Connect everything via the event bus
```

**Key arrows to draw:**
- Connector → Event Bus → Graph (ingestion flow)
- User → Search → Policy Filter → Results (discovery flow)
- Classification → Tag → Policy → Masking (governance loop)

---

## Discussion Talking Points

### Point 1: "The Catalog Is Infrastructure, Not a Feature"

A data catalog is not a feature of the data platform — it is infrastructure that enables every other data capability. Without a catalog, there is no governed NL-to-SQL, no automated compliance, no impact analysis, no data contracts. Position the catalog as the "DNS of the data organization" — everyone depends on it, nobody thinks about it when it works, and everything breaks when it fails.

### Point 2: "Connectors Are the Product"

The catalog UI, search ranking, and classification pipeline are important but secondary. The primary value driver is the connector ecosystem — how many sources can the catalog connect to, and how deeply can it extract metadata from each. A catalog with 100 connectors and mediocre search is more valuable than a catalog with 5 connectors and perfect search.

### Point 3: "Active Metadata Changes the SLA"

Moving from passive catalog (humans browse metadata) to active metadata (system reacts to metadata changes) fundamentally changes the catalog's operational requirements. A passive catalog can tolerate 5-minute staleness and occasional downtime. An active metadata platform that triggers policy enforcement and quality alerts needs sub-minute freshness and 99.95% availability. Discuss this transition explicitly.

### Point 4: "The Semantic Layer Convergence"

Data catalogs and semantic layers are converging. The catalog knows what data exists and who owns it; the semantic layer knows what metrics mean and how to calculate them. The combined system enables: search by business metric name, govern metric access by domain, trace metric definitions to source columns. Mention this convergence as a forward-looking trend.

---

### Point 5: "Classification Accuracy Is a Governance SLA, Not an ML Metric"

Frame classification accuracy not as a machine learning research problem but as a governance reliability problem. The precision-recall trade-off is a business decision: in healthcare, bias toward recall (catch all PHI) at the cost of false positives; in analytics-heavy organizations, bias toward precision (minimize disruption) at the cost of some undetected PII. Different domains within the same organization may have different thresholds.

### Point 6: "The Hardest Problem Is Not Technical — It Is Organizational"

The hardest challenge in building a data catalog is not SQL parsing, lineage extraction, or search ranking. It is convincing 50+ data domain teams to register their data, write descriptions, review classifications, and use the catalog daily. The catalog must provide immediate, tangible value (faster data discovery, automated compliance evidence, fewer broken pipelines) that exceeds the effort cost of participation. Design for the skeptic, not the enthusiast.

---

## Anti-Patterns to Call Out

| Anti-Pattern | Why It Fails | Better Approach |
|-------------|-------------|-----------------|
| **"Build the perfect catalog before launching"** | Users need a working catalog today, not a perfect one in 6 months | Ship with 10 connectors and basic search; iterate based on usage |
| **"Mandate catalog usage via policy"** | Mandates without value create resentment and workarounds | Make the catalog genuinely useful first, then mandate for compliance |
| **"Centralize all governance in one team"** | Centralized teams become bottlenecks; they can't understand every domain | Federated governance: central team sets rules, domain teams execute |
| **"Classify everything before going live"** | Initial classification of 40M columns takes weeks; delays adoption | Incremental: classify on first access, priority queue by usage, continuous improvement |
| **"Replace the existing catalog with ours"** | Migration risk is enormous; users lose muscle memory | Integrate first (sync metadata from existing catalog), replace gradually |

---

## Follow-Up Questions to Expect

After your main design, interviewers often ask these deeper questions:

| Follow-Up | What They're Testing | How to Answer |
|-----------|---------------------|---------------|
| "How would you implement search autocomplete?" | Real-time UX, trie data structures | "Trie-based autocomplete from search query logs, updated daily. Pre-compute top completions per prefix. Add user-specific suggestions from recent search history." |
| "How do you handle metadata for 20+ languages?" | Internationalization, NER complexity | "Multilingual NER model (XLM-R based) for name detection. Locale-aware regex for national ID formats. Language metadata stored per entity. Search supports multi-language stemming." |
| "How would you add cost attribution?" | Extension to existing design | "Each entity gets a `cost_metadata` tag populated by cloud billing integration. Lineage traces cost from storage to compute to downstream consumers. Cost-weighted search ranking deprioritizes expensive datasets when cheaper alternatives exist." |
| "What if a steward is malicious?" | Insider threat, separation of duties | "All steward actions logged. Classification overrides require justification. PII tag removal requires two approvals. Anomaly detection on steward behavior (bulk overrides, after-hours activity)." |
| "How do you test data contracts?" | Contract validation pipeline | "Contract validation runs in CI/CD before deployment. Schema changes are diffed against active contracts. Integration tests verify contract enforcement end-to-end." |

---

## Quick Reference Card

```
AI-Native Data Catalog & Governance — Cheatsheet

CORE COMPONENTS:
  Metadata Graph (RDBMS)  →  entities + relationships + tags
  Search Index            →  full-text + faceted + semantic (vector)
  Ingestion Pipeline      →  push + pull connectors + SQL parser
  Classification Engine   →  regex → NER → LLM (cascading)
  Policy Engine           →  tag-based ABAC with inheritance
  NL-to-SQL               →  LLM + catalog RAG + policy enforcement
  Active Metadata         →  event-driven automation (classify → tag → enforce)

KEY NUMBERS:
  2M entities, 40M columns, 200M lineage edges (large enterprise)
  Search latency: p50 < 200ms, p99 < 1s
  Metadata freshness: < 5 minutes
  Classification: > 95% precision, > 90% recall
  Policy evaluation: < 50ms
  NL-to-SQL: < 5s response time

KEY TRADE-OFFS:
  RDBMS vs Graph DB → RDBMS (simpler ops, good enough for lineage)
  Pull vs Push ingestion → Hybrid (pull for batch, push for real-time)
  Regex vs ML classification → Cascading (cheap first, expensive on ambiguity)
  Catalog-side vs Engine-side enforcement → Both (visibility + data masking)
  Static vs ML ranking → Start static, graduate to ML with data

REAL-WORLD SCALE (LinkedIn DataHub):
  10M+ assets, ~1B relationships, millions MCEs/day via Kafka
  Federated metadata services, Neo4j + Elasticsearch dual store

REAL-WORLD SCALE (Collibra):
  12B+ data assets across 750+ customers, 120K+ active users
  Business governance layer above technical catalogs

EU AI ACT IMPACT (August 2026):
  High-risk AI: bias metadata, training provenance, conformity assessments
  Fines: up to 7% of global turnover

THE ONE THING:
  The catalog's primary purpose is ADOPTION — making the right data
  findable and trustworthy. Technical excellence with low adoption is failure.
```
