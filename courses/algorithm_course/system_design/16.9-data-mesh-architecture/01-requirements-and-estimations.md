# Requirements & Estimations — Data Mesh Architecture

## Functional Requirements

### Core Features (Must-Have)

| # | Requirement | Description |
|---|------------|-------------|
| F1 | **Data Product Registration** | Domain teams register data products with schema, owner, SLOs, access policies, and lineage metadata in a central catalog |
| F2 | **Data Product Discovery** | Consumers search and browse a catalog of data products by domain, topic, quality score, freshness, and semantic tags |
| F3 | **Data Contract Management** | Producers define and publish machine-readable contracts; consumers subscribe to contracts; breaking changes trigger validation failures |
| F4 | **Federated Governance Policy Engine** | Global policies (naming conventions, PII classification, retention rules, quality thresholds) are encoded as computational rules and automatically enforced at data product publish time |
| F5 | **Cross-Domain Lineage** | Track data product dependencies across domain boundaries — which data products feed into which downstream products, enabling impact analysis and root-cause debugging |
| F6 | **Self-Serve Data Product Publishing** | Platform provides templates, CI/CD pipelines, and infrastructure provisioning so domain teams can publish data products without platform engineering support |
| F7 | **Access Management** | Fine-grained, policy-driven access control where data product owners define access policies and the platform enforces them across all consumption interfaces |
| F8 | **Data Quality & SLO Monitoring** | Continuous monitoring of data product freshness, completeness, schema conformance, and custom quality rules with SLO tracking and alerting |

### Extended Features (Nice-to-Have)

| # | Requirement | Description |
|---|------------|-------------|
| E1 | **Cross-Domain Query Federation** | Execute SQL queries that join data products from multiple domains without data movement via a federated query engine |
| E2 | **Automated Data Product Versioning** | Semantic versioning of data products with backward-compatible schema evolution and deprecation workflows |
| E3 | **Data Product Marketplace** | Internal marketplace where consumers rate, review, and request data products — driving a feedback loop to improve quality |
| E4 | **Cost Attribution** | Track compute and storage costs per data product and charge back to the owning domain, creating economic incentives for efficient data management |
| E5 | **AI-Assisted Metadata Enrichment** | Automatically classify data products, suggest tags, detect PII, and generate documentation from schema and sample data |

### Extended Features (2025-2026 Emerging Requirements)

| # | Requirement | Description |
|---|------------|-------------|
| E6 | **Data Product Observability Score** | Composite health score combining freshness, quality, SLO compliance, consumer satisfaction, and documentation completeness — surfaced in catalog discovery ranking |
| E7 | **AI-Powered Data Product Generation** | LLM-assisted pipeline that reads source system schemas and generates draft data product descriptors with inferred quality rules, PII classifications, and suggested tags |
| E8 | **Semantic Layer Federation** | Standardized business metric definitions (e.g., "revenue," "active user") that span multiple data products, ensuring consistent calculation across domains |
| E9 | **Data Product Dependency Simulation** | "What-if" analysis that simulates the impact of a proposed schema change across the lineage graph before the change is actually published |
| E10 | **Streaming Data Products** | Real-time data products with change-data-capture output ports alongside batch ports, enabling both real-time and batch consumption of the same logical data product |

### Out of Scope

- Real-time stream processing engine (handled by domain-specific streaming infrastructure)
- Data transformation logic within domains (owned by domain teams using their preferred tools)
- BI/analytics dashboarding (consuming applications built on top of data products)
- Operational databases (data mesh governs analytical data products, not transactional systems)
- Data product content creation (domains produce the data; the mesh governs its publication)

---

## Non-Functional Requirements

### Architectural Philosophy

**AP with strong governance guarantees** — Data mesh is not a transactional system with strict consistency requirements. Data products are eventually consistent (published on different cadences by independent domains). However, governance policies must be strongly enforced — a data product that violates access control or quality policies must never become discoverable.

| Property | Choice | Justification |
|----------|--------|---------------|
| Consistency | Eventual (data products), Strong (governance) | Domains publish independently; governance violations must be caught before publication |
| Availability | High for catalog and discovery | Consumers must always be able to discover and access published data products |
| Partition Tolerance | Required | Domains operate independently; platform must function even when individual domains are offline |

### Performance Targets

| Metric | Target | Context |
|--------|--------|---------|
| Catalog search latency | < 200 ms (p50), < 500 ms (p99) | Full-text search across data product metadata |
| Data product registration | < 30 seconds | Including schema validation, policy evaluation, and catalog update |
| Governance policy evaluation | < 5 seconds per product | Evaluate all applicable global and domain-local policies |
| Contract validation | < 10 seconds | Schema compatibility check against all registered consumers |
| Lineage query (1 hop) | < 100 ms | Direct upstream/downstream dependencies |
| Lineage query (full graph) | < 2 seconds | Complete dependency graph for a data product |
| Cross-domain federated query | < 30 seconds (p50) | JOIN across 2-3 data products from different domains |
| Access policy evaluation | < 50 ms | Per-request access control check at query time |

### Durability & Availability

| Metric | Target |
|--------|--------|
| Catalog availability | 99.99% (52.6 min/year downtime) |
| Platform API availability | 99.95% (4.4 hours/year downtime) |
| Data product SLO compliance | > 95% of products meet their declared SLOs |
| Governance policy enforcement | 100% — no data product is discoverable without passing all policies |

---

## Capacity Estimations (Back-of-Envelope)

### Scenario: Large Enterprise Data Mesh

A Fortune 500 company with 40 business domains, 200+ domain teams, and 2,000 data products serving 5,000 data consumers (analysts, data scientists, engineers, applications).

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Business domains | 40 | Marketing, Finance, Supply Chain, HR, etc. |
| Domain teams | 200 | ~5 teams per domain |
| Data products (Year 1) | 500 | ~2.5 products per team initially |
| Data products (Year 3) | 2,000 | 4x growth as adoption matures |
| Data consumers | 5,000 | Analysts, scientists, engineers, automated pipelines |
| Catalog search QPS | 50 | 5,000 users x ~10 searches/day / 86,400 seconds |
| Data product publishes/day | 200 | 2,000 products x 10% publish daily (batch cadence) |
| Governance evaluations/day | 200 | 1:1 with publishes |
| Contract validations/day | 500 | Publishes + schema drift checks + consumer subscriptions |
| Lineage queries/day | 2,000 | Impact analysis, debugging, compliance audits |
| Access policy evaluations/hour | 50,000 | 5,000 consumers x 10 queries/hour average |
| Catalog metadata storage | 50 GB | 2,000 products x ~25 MB metadata each (schema, docs, lineage, quality history) |
| Data product storage (total) | 500 TB | Average 250 GB per product (varies widely: 1 GB to 50 TB) |
| Lineage graph size | 20K nodes, 50K edges | Products, columns, pipelines, consumers as nodes |

### Platform Infrastructure Summary

```
Catalog Service:       3 instances, 16 GB RAM, 4 vCPU each
Governance Engine:     3 instances, 8 GB RAM, 4 vCPU each
Lineage Service:       2 instances, 32 GB RAM, 8 vCPU each (graph processing)
Contract Validator:    2 instances, 8 GB RAM, 4 vCPU each
Access Control:        3 instances, 8 GB RAM, 4 vCPU each
Metadata Store:        Replicated document store, 200 GB with 3x replication
Lineage Graph Store:   Graph database, 50 GB with 3x replication
Search Index:          Full-text search cluster, 100 GB
Object Storage:        500 TB (data products themselves)
```

---

## SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Catalog Availability | 99.99% | Percentage of successful catalog API requests |
| Discovery Latency (p99) | < 500 ms | End-to-end search including ranking and metadata enrichment |
| Governance Enforcement | 100% | No data product discoverable without passing all governance checks |
| Data Product SLO Compliance | > 95% | Percentage of data products meeting their declared freshness/quality SLOs |
| Contract Validation | < 10 seconds (p99) | Schema compatibility check against consumer contracts |
| Cross-Domain Lineage | < 2 seconds (p99) | Full dependency graph traversal |
| Platform Onboarding | < 1 day | Time for a new domain team to publish their first data product |
| Incident Detection | < 15 minutes | Time to detect a data product quality degradation |

---

## Read/Write Ratio Analysis

| Workload Type | Read:Write | Dominant Operation |
|---------------|------------|-------------------|
| Catalog discovery | 100:1 | Search, browse, metadata reads vastly exceed product registration |
| Governance evaluation | 1:1 | Each publish triggers one evaluation (balanced) |
| Lineage queries | 50:1 | Impact analysis and audits far exceed lineage graph mutations |
| Data product consumption | 200:1 | Consumers read data products far more often than producers update them |
| Access control | 500:1 | Policy evaluations per query vs. policy definition changes |
| Contract management | 20:1 | Consumer reads and validations vs. contract updates |

**Overall weighted ratio: ~100:1 (read-heavy)**

---

## Growth Projections and Maturity Model

### Mesh Maturity Stages

| Stage | Timeline | Products | Domains | Consumers | Platform Investment |
|-------|----------|----------|---------|-----------|-------------------|
| **Stage 1: Pilot** | Month 0-6 | 10-50 | 2-3 lighthouse | 50-100 | 1 platform team (5-8 engineers) |
| **Stage 2: Expansion** | Month 6-18 | 50-500 | 5-15 | 500-2,000 | 2 platform squads (12-20 engineers) |
| **Stage 3: Scale** | Month 18-36 | 500-2,000 | 15-40 | 2,000-10,000 | Platform organization (25-40 engineers) |
| **Stage 4: Mature** | Month 36+ | 2,000-10,000 | 40-100+ | 10,000-50,000 | Platform product team with SRE |

### Infrastructure Scaling by Stage

| Component | Pilot | Expansion | Scale | Mature |
|-----------|-------|-----------|-------|--------|
| Catalog Service | 2 instances | 3 instances | 5 instances | 8+ instances |
| Governance Engine | 1 instance | 3 instances | 5 instances | 10+ instances (auto-scaled) |
| Lineage Graph Store | Single node (< 50 MB) | Replicated (< 500 MB) | Clustered (< 5 GB) | Partitioned (< 50 GB) |
| Search Index | Single node | 3-node cluster | 5-node cluster | 10+ node cluster |
| Federated Query | 2 workers | 8 workers | 20 workers | 50+ workers (auto-scaled) |
| Event Bus | Single partition | 10 partitions | 50 partitions | 200+ partitions |
| Object Storage | < 1 TB | < 50 TB | < 500 TB | 1+ PB |

### Cost Estimation by Stage

| Cost Category | Pilot | Expansion | Scale | Mature |
|--------------|-------|-----------|-------|--------|
| Platform compute | $5K/month | $25K/month | $100K/month | $300K/month |
| Storage (platform metadata) | $500/month | $2K/month | $10K/month | $30K/month |
| Storage (data products) | Domain-managed | Domain-managed | Domain-managed | Domain-managed |
| Federated query compute | $2K/month | $15K/month | $60K/month | $200K/month |
| Platform team personnel | $80K/month | $180K/month | $350K/month | $600K/month |
| **Total platform cost** | **~$88K/month** | **~$222K/month** | **~$520K/month** | **~$1.1M/month** |

**Cost per data product (platform cost / active products):**
- Pilot: $1,760/product/month (high due to fixed costs)
- Expansion: $444/product/month
- Scale: $260/product/month
- Mature: $110/product/month (economies of scale)

### Key Capacity Thresholds (When to Scale)

| Threshold | Indicator | Action Required |
|-----------|-----------|----------------|
| > 200 data products | Catalog search noise increases | Implement faceted search, quality-weighted ranking |
| > 500 data products | Governance evaluation time > 10s | Incremental evaluation, policy caching |
| > 1,000 data products | Lineage graph queries slow (> 5s) | Graph partitioning, pre-computed impact summaries |
| > 5,000 consumers | Access control becomes Slowest part of the process | Cache access decisions, add read replicas |
| > 50 concurrent federated queries | Query engine saturation | Auto-scale workers, implement admission control |
| > 100 domains | Governance federation unwieldy | Hierarchical governance with domain clusters |
| > 10,000 lineage edges | Impact analysis intractable interactively | Background impact computation with cached results |

---

## Organizational Requirements

### Team Structure Requirements

| Team | Size (at Scale) | Responsibilities | Key Metric |
|------|----------------|-----------------|------------|
| **Platform Team** | 15-40 engineers | Build and operate the self-serve data platform (catalog, governance, query engine, CLI tools) | Time-to-publish for new domain teams |
| **Governance Council** | 8-12 representatives | Define global policies, mediate cross-domain disputes, review and update standards | Governance coverage % |
| **Domain Data Teams** | 2-5 per domain | Own and maintain data products within their domain; respond to consumer requests | SLO compliance rate for owned products |
| **Platform SRE** | 3-5 engineers | Monitor platform health, incident response, capacity planning | Platform availability SLO |

### Adoption Readiness Checklist

| Prerequisite | Description | Assessment |
|-------------|-------------|------------|
| Domain boundaries defined | Clear organizational domains with identified data owners | Without clear domains, ownership assignment is impossible |
| Data engineering capability distributed | Domain teams have or can hire data engineering talent | Without local capability, self-serve publishing is impractical |
| Executive sponsorship | VP+ level commitment to multi-year organizational change | Without sponsorship, domain teams resist ownership as unfunded mandate |
| Existing data quality issues acknowledged | Organization recognizes current data quality problems | If existing quality is "fine," motivation for contracts and SLOs is low |
| Central data team willing to evolve | Central data team accepts role transition from builder to platform enabler | If central team blocks, mesh adoption stalls at politics |

### Data Product Classification Requirements

| Classification | Publication Requirements | Governance Rigor |
|---------------|------------------------|-----------------|
| **Experimental** | Minimal — draft descriptor, no SLO required | Low — naming convention only |
| **Standard** | Full descriptor, contract, basic SLOs (freshness, completeness) | Medium — global policies enforced |
| **Critical** | Full descriptor, strict SLOs, designated backup owner, runbook | High — all policies + domain-specific policies + quarterly review |
| **Regulated** | All Critical requirements + compliance certification + encryption | Maximum — continuous compliance monitoring + audit trail |

---

## Streaming Data Product Requirements (2025+ Extension)

As data mesh matures, organizations increasingly need real-time data products alongside batch. This extends the requirements:

### Streaming-Specific Requirements

| # | Requirement | Description |
|---|------------|-------------|
| S1 | **Dual Output Ports** | Data products expose both batch (file/SQL) and streaming (event/topic) output ports for the same logical dataset |
| S2 | **Streaming SLOs** | Freshness SLOs measured in seconds/minutes rather than hours/days; end-to-end latency from source event to queryable state |
| S3 | **Streaming Contract Validation** | Schema registry integration validates event schemas at produce time, not just at batch publish time |
| S4 | **Backfill Capability** | Streaming products support historical backfill from the batch port for new consumers who need historical context |
| S5 | **Exactly-Once Semantics** | Streaming products guarantee exactly-once delivery to registered consumers through idempotent event processing |

### Streaming Capacity Estimates

| Metric | Estimation |
|--------|------------|
| Streaming data products | 10-20% of total products (200-400 at scale) |
| Event throughput per product | 100 - 100,000 events/second (varies by domain) |
| End-to-end latency SLO | < 5 seconds for 95% of streaming products |
| Event retention | 7-30 days in streaming layer; unlimited in batch layer |
| Schema evolution frequency | Higher than batch (weekly vs. monthly) due to rapid iteration |

### Streaming Infrastructure Additions

```
Stream Processing Engine:  5-20 instances per domain (auto-scaled)
Schema Registry:           3 instances (replicated), shared across all domains
Event Bus:                 Partitioned by domain; 100-500 partitions total
Stream-to-Batch Bridge:    2 instances per domain (batch materialization from stream)
```
