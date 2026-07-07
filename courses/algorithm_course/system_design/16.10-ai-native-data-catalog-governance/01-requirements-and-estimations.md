# Requirements & Estimations — AI-Native Data Catalog & Governance

## Functional Requirements

### Core Features (Must-Have)

| # | Requirement | Description |
|---|------------|-------------|
| F1 | **Metadata Ingestion** | Pull-based crawlers and push-based connectors for 50+ source types (databases, warehouses, lakehouses, BI tools, pipelines, streaming systems) |
| F2 | **Search & Discovery** | Full-text and faceted search across all metadata (table names, column descriptions, tags, owners) with usage-weighted ranking |
| F3 | **Column-Level Lineage** | Automated lineage tracking from source tables through SQL transformations, ETL jobs, and BI dashboards at the column granularity |
| F4 | **Auto-Classification** | ML-driven detection and tagging of sensitive data (PII, PHI, PCI) using NER models, regex patterns, and data sampling |
| F5 | **Policy Enforcement** | Tag-based governance policies (access control, column masking, row filtering) that inherit through the metadata hierarchy |
| F6 | **Data Quality Scoring** | Automated profiling and quality assessment across freshness, completeness, uniqueness, validity, and consistency dimensions |
| F7 | **Ownership & Collaboration** | Domain-based ownership assignment, data asset certification, glossary management, and annotation workflows |
| F8 | **Natural Language Querying** | LLM-powered interface that converts business questions into SQL queries using catalog metadata as context |

### Extended Features (Nice-to-Have)

| # | Requirement | Description |
|---|------------|-------------|
| E1 | **Impact Analysis** | Given a proposed schema change, identify all downstream assets (reports, pipelines, ML models) that would be affected |
| E2 | **Data Contracts** | Formal producer-consumer agreements with schema, quality, and SLO expectations validated at publish time |
| E3 | **Active Metadata Automation** | Event-driven workflows that trigger actions (notifications, policy enforcement, quality checks) on metadata changes |
| E4 | **Cost Attribution** | Track and attribute compute/storage costs to datasets, owners, and queries |
| E5 | **AI-Readiness Scoring** | Assess datasets for ML suitability based on completeness, bias metrics, fairness, and documentation quality |
| E6 | **Semantic Layer Integration** | Ingest metric definitions from semantic layer tools; enable metric discovery alongside dataset discovery |
| E7 | **AI Agent API (MCP)** | Machine-readable API for AI agents to programmatically discover, validate, and access governed metadata |
| E8 | **Bias & Fairness Metadata** | Track demographic distribution, representation metrics, and bias assessments for AI governance compliance |

### Out of Scope

- Data storage or query execution (the catalog is a metadata layer, not a query engine)
- ETL/ELT pipeline orchestration (handled by external schedulers)
- Data transformation logic (handled by dbt, Spark, or similar tools)
- Full-text content search within data files (handled by search engines)
- Model training or serving (handled by ML platforms; the catalog tracks metadata about models, not the models themselves)

### Requirement Priority Matrix

| Requirement | Business Value | Implementation Complexity | Priority |
|-------------|---------------|--------------------------|----------|
| F1: Metadata Ingestion | Critical — no catalog without data | High (50+ connector types) | P0 — build first |
| F2: Search & Discovery | Critical — primary user-facing feature | Medium | P0 — build first |
| F3: Column-Level Lineage | High — enables impact analysis and compliance | Very High (SQL parsing) | P0 — core differentiator |
| F4: Auto-Classification | High — enables automated governance | High (ML pipeline) | P1 — build after core |
| F5: Policy Enforcement | Critical — governance backbone | Medium | P0 — build first |
| F6: Data Quality Scoring | Medium — enhances trust signals | Medium | P1 — build after core |
| F7: Ownership & Collaboration | Medium — drives adoption | Low | P1 — build after core |
| F8: Natural Language Querying | Medium — accessibility for non-technical users | High (LLM integration) | P2 — build last |
| E2: Data Contracts | High — prevents breaking changes | Medium | P1 — high demand |
| E7: AI Agent API (MCP) | Growing — AI adoption accelerating | Medium | P1 — forward-looking |

---

## Assumptions & Constraints

| Assumption | Implication |
|-----------|-------------|
| Organization has 50+ heterogeneous data sources | Must support diverse connector types; cannot assume uniform APIs |
| Data practitioners number 1,000-5,000 | Search must handle moderate QPS; adoption is measurable |
| Compliance requirements include at least one of GDPR/HIPAA/SOC2 | Audit logging and policy enforcement are non-negotiable |
| Existing data pipelines cannot be modified to push metadata | Pull-based crawling is the baseline; push is an optimization |
| ML teams are increasingly using catalog data for model training | AI-readiness and bias metadata are emerging requirements |
| AI agents will become primary catalog consumers within 2-3 years | API design must support machine consumption from day one |
| Network connectivity between catalog and data sources is reliable but not instantaneous | Connector timeouts and retry logic must be robust |
| Schema changes happen daily across the data estate | Incremental metadata sync is required; full re-crawl is too expensive |

---

## User Personas & Primary Use Cases

| Persona | Role | Primary Use Case | Key Requirements |
|---------|------|-----------------|-----------------|
| **Data Engineer** | Builds and maintains data pipelines | Impact analysis: "If I change this column, what breaks?" | Column-level lineage, lineage confidence, contract validation |
| **Data Analyst** | Creates reports and dashboards | Discovery: "Where is the best table for customer revenue analysis?" | Fast search, quality scores, freshness indicators, NL-to-SQL |
| **Data Steward** | Governs data quality and compliance | Classification review: "Approve or reject auto-classifications" | Classification queue, override workflows, audit trails |
| **Data Scientist** | Trains ML models | AI-readiness: "Is this dataset representative enough for my model?" | Bias metadata, completeness scores, training provenance |
| **Platform Admin** | Manages catalog infrastructure | Connector health: "Are all 200 connectors healthy?" | Observability dashboard, connector status, SLO tracking |
| **Compliance Officer** | Ensures regulatory compliance | Compliance audit: "Show all PII access in Q1 across the commerce domain" | Audit logs, policy coverage reports, GDPR/HIPAA dashboards |
| **Business User** | Consumes data for decisions | Self-service discovery: "What data do we have about customer churn?" | NL-to-SQL, simple search, curated data products |
| **AI Agent** | Automated pipeline/analysis bot | Programmatic discovery: Find and validate tables for automated reporting | Structured APIs, MCP, machine-readable policy responses |

### Access Pattern Distribution

| Access Pattern | % of Total Requests | Latency Sensitivity | Cacheability |
|----------------|-------------------|--------------------|--------------|
| Search queries | 40% | High (< 1s) | Medium (60s TTL) |
| Entity detail views | 25% | Medium (< 500ms) | High (5 min TTL) |
| Lineage traversals | 15% | Medium (< 2s) | High (1 hour TTL) |
| Policy evaluations | 10% | Critical (< 50ms) | High (5 min TTL) |
| Metadata writes (ingestion) | 5% | Low (< 60s) | Not applicable |
| NL-to-SQL queries | 3% | Low (< 5s) | Medium (24h TTL) |
| AI agent API calls | 2% | Medium (< 1s) | Low (varies) |

---

## Non-Functional Requirements

### CAP Theorem Choice

**CP with eventual consistency for search** — Metadata writes (lineage, classification, policy) must be strongly consistent to prevent policy gaps. Search indexes can be eventually consistent with sub-second propagation delay.

| Property | Choice | Justification |
|----------|--------|---------------|
| Consistency | Strong for writes, Eventual for search | Policy enforcement cannot tolerate stale metadata; search tolerates brief delays |
| Availability | High (99.9%) | Catalog downtime blocks discovery but does not block data pipeline execution |
| Partition Tolerance | Required | Distributed metadata ingestion must survive network partitions |

### Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Search latency (p50) | < 200ms | Including ranking and facet computation |
| Search latency (p99) | < 1s | Complex queries with multiple filters |
| Semantic search latency (p50) | < 500ms | Vector similarity + BM25 hybrid scoring |
| Lineage traversal (3 hops) | < 500ms | Column-level, upstream + downstream |
| Lineage traversal (5+ hops) | < 5s | Deep impact analysis with async fallback |
| Metadata ingestion latency | < 60s | From source change to catalog visibility |
| Auto-classification throughput | 1,000 columns/min | Per NER classification worker |
| NL-to-SQL response time | < 5s | Including LLM inference and SQL generation |
| Policy evaluation | < 50ms | Per access request with tag resolution |
| Active metadata event processing | < 10s | From event emission to downstream action |
| API response time (entity CRUD) | < 100ms | Single entity read/write operations |

### Reliability Targets

| Metric | Target | Justification |
|--------|--------|---------------|
| Availability (overall) | 99.9% | Catalog downtime acceptable for hours, not days |
| Availability (policy service) | 99.95% | Policy enforcement is in the critical path of data access |
| Durability (metadata) | 99.999% | Metadata loss is unrecoverable; lineage history is irreplaceable |
| Durability (audit log) | 99.9999% | Compliance requires tamper-proof, durable audit trails |

---

### Consistency Requirements by Operation

| Operation | Consistency Requirement | Justification |
|-----------|----------------------|---------------|
| Policy evaluation | **Strong** (read-after-write) | A policy change must take effect immediately; stale reads could expose PII |
| Tag writes (classification) | **Strong** (serialized) | Two concurrent classifications of the same column must not conflict |
| Search index updates | **Eventual** (< 5s lag) | Brief search staleness is acceptable; user can refresh |
| Lineage edge updates | **Eventual** (< 60s lag) | Lineage is not time-critical for most queries |
| Quality score updates | **Eventual** (< 5 min lag) | Quality scores change slowly; slight staleness is invisible to users |
| Audit log writes | **Durable** (write-ahead) | Every audit event must be persisted before returning success |
| Data contract validation | **Strong** (serialized) | Breaking change detection must see the latest contract version |

### Failure Tolerance Requirements

| Failure Scenario | Acceptable Impact | Recovery Time |
|-----------------|-------------------|---------------|
| Single search node failure | Increased latency (1.5x); no data loss | < 30s (auto-rebalance) |
| Primary RDBMS failure | Read-only mode from replica; writes queued | < 30s (automatic failover) |
| Event bus partition loss | Ingestion for affected sources pauses | < 60s (leader election) |
| LLM provider outage | NL-to-SQL unavailable; other features unaffected | Instant (circuit breaker) |
| Full region outage | DR failover to secondary region | < 1 hour (RTO target) |
| Connector credential expiry | Affected source metadata goes stale | < 15 min (auto-rotation) |

---

## Capacity Estimation

### Reference Scenario: Large Enterprise (500 data sources)

| Metric | Value | Calculation |
|--------|-------|-------------|
| Total data assets (tables/views) | 2M | 500 sources × 4,000 avg tables |
| Total columns | 40M | 2M tables × 20 avg columns |
| Lineage edges (column-level) | 200M | 40M columns × 5 avg transformations |
| Daily metadata change events | 5M | Schema changes + lineage updates + quality signals |
| Search queries/day | 500K | 5,000 data practitioners × 100 searches/day |
| Search QPS (peak) | 50 | Concentrated during business hours |
| Metadata storage (graph + search) | 2 TB | ~1 KB per entity × 2B total entities/relationships |
| Classification scans/day | 100K columns | Incremental: new + changed columns only |
| Concurrent users | 2,000 | Peak during morning data review |
| NL-to-SQL queries/day | 10K | Growing with AI adoption |
| AI agent API calls/day | 50K | Automated pipelines, compliance bots, reporting agents |
| Active metadata events processed/day | 5M | Schema + quality + classification + usage events |
| Data contract validations/day | 20K | On every schema change and pipeline deployment |

### Scaling Tiers

| Tier | Sources | Entities | Columns | Users | Storage |
|------|---------|---------|---------|-------|---------|
| **Startup** | 5-20 | 50K | 1M | 50-200 | 20 GB |
| **Mid-size** | 20-100 | 500K | 10M | 200-1,000 | 200 GB |
| **Enterprise** | 100-500 | 2M | 40M | 1,000-5,000 | 2 TB |
| **Hyperscale** | 500+ | 10M+ | 200M+ | 5,000-50,000 | 10 TB+ |

### Storage Breakdown

| Component | Size | Growth Rate | Notes |
|-----------|------|------------|-------|
| Metadata graph (RDBMS) | 500 GB | ~40% annually | Entities, relationships, properties |
| Search index (text + facets) | 200 GB | ~40% annually | Full-text + facets + keyword index |
| Vector embeddings | 150 GB | ~50% annually | Semantic search embeddings (384-dim per entity) |
| Lineage store | 800 GB | ~30% annually | Column-level lineage with history |
| Quality metrics history | 300 GB | ~50% annually | 90-day rolling window |
| Audit log | 200 GB | ~60% annually | All access and change events |
| Event stream (7-day retention) | 100 GB | Bounded | Metadata change events |
| Classification model artifacts | 50 GB | ~20% annually | Trained models, feature stores |
| **Total** | **2.3 TB** | **~40% annually** | Doubling roughly every 2 years |

### Bandwidth Estimation

| Flow | Bandwidth | Notes |
|------|-----------|-------|
| Connector → Event Bus | 50 MB/s peak | 500 sources, bursty during scheduled crawls |
| Event Bus → Graph Writer | 10 MB/s sustained | Metadata upserts, lineage updates |
| Event Bus → Search Indexer | 5 MB/s sustained | Index update documents |
| Client → API Gateway | 20 MB/s peak | Search requests, entity reads, lineage queries |
| Classification → LLM API | 1 MB/s sustained | Ambiguous column samples for LLM resolution |

---

## SLO Table

| Metric | Target | Measurement | Escalation |
|--------|--------|-------------|------------|
| Availability | 99.9% (8.7h downtime/year) | Health check + synthetic search probes | Page on-call if SLO burned > 30% of error budget in 24h |
| Search latency (p99) | < 1s | End-to-end from query to rendered results | Alert if p99 > 800ms for 5 min |
| Metadata freshness | < 5 min | Time from source change to catalog reflection | Alert if any source exceeds 15 min; page if > 30 min |
| Classification accuracy | > 95% precision, > 90% recall | Validated against human-labeled ground truth quarterly | Review if precision drops below 92% in any domain |
| Lineage completeness | > 90% coverage | Percentage of tables with automated lineage | Alert if new source has < 50% coverage after 7 days |
| Policy enforcement | 100% (zero bypass) | All data access checked against active policies | Page immediately on any bypass detection |
| Error rate | < 0.1% | Failed API requests / total requests | Alert at 0.05%; page at 0.5% |
| Event processing lag | < 30s (p99) | Event bus consumer lag | Alert if lag > 60s; page if > 5 min |
| NL-to-SQL acceptance rate | > 60% | Generated SQL executed by user without modification | Review ranking/prompting if < 50% for 7 days |
| Adoption (WAU) | > 60% of data practitioners | Weekly active users / total data practitioners | Review quarterly; treat decline > 10% as incident |

### Latency Budget Breakdown

| Operation | Budget | Breakdown |
|-----------|--------|-----------|
| **Search query (p99 < 1s)** | 1,000ms | Auth: 10ms → Query parse: 5ms → BM25 search: 200ms → Vector search: 300ms → Merge: 20ms → Ranking: 50ms → Policy filter: 50ms → Enrichment: 100ms → Serialization: 15ms → Network: 50ms |
| **Lineage traversal (3 hops)** | 500ms | Auth: 10ms → Cache check: 5ms → Graph query: 300ms → Result assembly: 100ms → Network: 50ms |
| **Policy evaluation** | 50ms | Cache check: 5ms → Tag resolution: 15ms → Policy matching: 15ms → Decision: 5ms → Audit log: 10ms |
| **NL-to-SQL** | 5,000ms | Intent extraction: 100ms → Catalog RAG: 500ms → LLM inference: 3,000ms → SQL validation: 200ms → Policy check: 50ms → Explanation: 500ms |
| **Metadata ingestion** | 60,000ms | Connector crawl: 30,000ms → SQL parse: 5,000ms → Event emit: 100ms → Graph write: 2,000ms → Index update: 3,000ms → Classification queue: 100ms |

### SLO Error Budget Policy

| SLO | Monthly Budget | Budget Consumed Trigger | Action |
|-----|---------------|------------------------|--------|
| Availability (99.9%) | 43.8 min downtime | > 50% in first week | Freeze non-critical deployments |
| Search latency (p99 < 1s) | 0.1% of queries > 1s | > 50% in first week | Roll back recent search index changes |
| Metadata freshness (< 5 min) | 0.1% of sources > 5 min | Any source > 30 min | Investigate connector; switch to batch sync |
| Classification accuracy (> 95%) | 5% false positive rate | > 8% in any domain | Raise auto-apply threshold; increase human review |

---

## Capacity Planning: Connector Load Model

### Per-Connector Resource Requirements

| Source Type | Crawl Frequency | Metadata Volume per Crawl | Memory | CPU | Network |
|------------|----------------|--------------------------|--------|-----|---------|
| Data warehouse (large) | Every 6 hours | 50K-200K entities | 1 GB | 0.5 vCPU | 10 MB/s burst |
| Data warehouse (small) | Every 12 hours | 5K-20K entities | 256 MB | 0.25 vCPU | 2 MB/s burst |
| dbt project | On git push (event-driven) | 1K-10K models | 512 MB | 0.25 vCPU | 1 MB/s burst |
| BI tool | Every 12 hours | 500-5K dashboards | 512 MB | 0.25 vCPU | 5 MB/s burst |
| ML platform | Every 24 hours | 100-1K models | 256 MB | 0.1 vCPU | 1 MB/s burst |
| Streaming platform | Continuous (push) | 100-500 topics | 256 MB | 0.1 vCPU | Persistent connection |
| Pipeline orchestrator | On DAG change (push) | 500-5K DAGs | 256 MB | 0.1 vCPU | 1 MB/s burst |

### Total Resource Estimation (200-source Enterprise)

```
Connector pods: 50 (many sources share connector instances)
  Total connector memory: 25 GB
  Total connector CPU: 12 vCPU

Core services: 20 pods (search 3 + catalog 3 + lineage 2 + policy 3 + quality 2 + contract 2 + NL-to-SQL 2 + API GW 3)
  Total core memory: 40 GB
  Total core CPU: 20 vCPU

Workers: 15 pods (ingestion 5 + classification 5 + active metadata 3 + ranking 2)
  Total worker memory: 30 GB
  Total worker CPU: 15 vCPU

Storage services: RDBMS (16 vCPU, 64 GB RAM, 2 TB SSD) + Search (3 × 8 vCPU, 32 GB RAM) + Redis (3 × 4 GB RAM) + Event Bus (3 × 4 vCPU, 16 GB RAM)

Grand total:
  Compute: ~80 vCPU, ~200 GB RAM
  Storage: ~3 TB (RDBMS + search + vector + event + audit)
  Estimated monthly cost: varies significantly by provider; plan for substantial infrastructure investment
```
