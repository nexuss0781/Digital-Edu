# 16.10 Design an AI-Native Data Catalog & Governance Platform

## Overview

An AI-native data catalog and governance platform is the metadata intelligence layer that sits above an organization's entire data estate — databases, warehouses, lakehouses, BI tools, ML pipelines, and streaming systems — and provides a unified graph of metadata relationships that enables discovery, classification, lineage tracking, policy enforcement, and natural language querying. Unlike traditional catalogs that serve as passive registries requiring manual curation, an AI-native catalog uses machine learning for automatic PII classification, NLP for natural language data querying, graph traversal for impact analysis, and active metadata pipelines that respond to changes in real time. The platform becomes the "context layer" that allows both humans and AI agents to understand what data exists, where it came from, who owns it, whether it is trustworthy, and what policies govern its use — making it the governance backbone for data mesh architectures, regulatory compliance (GDPR, HIPAA, EU AI Act), and AI-readiness.

## Key Characteristics


## Autonomy Classification

**Tier: A — AI-Assisted**

This is an **observability and analysis system** where AI processes data and surfaces insights but performs no system writes. The platform discovers, classifies, and catalogs data assets, surfacing lineage and quality metrics without modifying the cataloged systems or their data.

| Boundary | AI Role | Human/System Authority |
|----------|---------|----------------------|
| **System of Record** | Owned by upstream source systems; AI reads only | Source system owners |
| **System of Intelligence** | Monitoring, analysis, pattern detection, evaluation, and reporting | AI analytics layer |
| **Action Boundary** | Read-only — generates dashboards, reports, and alerts; never modifies monitored systems | Operators act on insights |
| **Human Override** | Data stewards review AI classifications; all governance policy changes require data owner approval | Domain expert |
| **Rollback Path** | No AI-initiated writes to roll back; historical views available natively | Time-range selectors restore prior state |

---

| Characteristic | Description |
|----------------|-------------|
| **Read-heavy for discovery** | Search, browse, and lineage traversal dominate; metadata queries outnumber writes 100:1 |
| **Write-moderate for ingestion** | Metadata crawlers and push-based connectors continuously ingest schema changes, lineage events, and quality signals |
| **Latency-sensitive for search** | Data engineers expect sub-second search results and instant lineage graph rendering |
| **Graph-centric** | The core data model is a metadata graph — entities (tables, columns, pipelines, dashboards) connected by typed relationships (lineage, ownership, dependency) |
| **ML-augmented** | Auto-classification, anomaly detection, and NL-to-SQL require inference pipelines integrated into the metadata flow |
| **Event-driven** | Active metadata reacts to schema changes, quality violations, and access patterns in real time via event streaming |
| **Multi-tenant** | Enterprise deployments serve hundreds of domains with isolated access controls and shared governance policies |
| **Agent-consumable** | AI agents programmatically discover and validate data via structured APIs (MCP-compatible) |

## Complexity Rating: **High**

The platform must unify metadata from 50-100+ heterogeneous data sources with different schemas, APIs, and change notification mechanisms. The metadata graph must support column-level lineage across SQL transformations (requiring SQL parsing and AST analysis), ML-based PII classification with configurable confidence thresholds, tag-based policy enforcement with inheritance semantics, natural language querying that combines catalog metadata with LLM-powered SQL generation, data contract enforcement, and AI agent access with governance controls. The organizational challenge of driving adoption across domain teams adds complexity beyond the purely technical.

## Quick Links

| # | Section | Description |
|---|---------|-------------|
| 01 | [Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| 02 | [High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| 03 | [Low-Level Design](./03-low-level-design.md) | Data model, API design, core algorithms (Step-by-step plan in plain English) |
| 04 | [Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Column-level lineage, auto-classification, search ranking, active metadata |
| 05 | [Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, replication, fault tolerance, DR |
| 06 | [Security & Compliance](./06-security-and-compliance.md) | Tag-based access control, PII governance, EU AI Act, compliance |
| 07 | [Observability](./07-observability.md) | Catalog-specific metrics, connector health, adoption tracking, SLO dashboards |
| 08 | [Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-off frameworks |
| 09 | [Insights](./09-insights.md) | Key architectural insights and non-obvious lessons |

## Technology Landscape

| Category | Representative Systems | Approach |
|----------|----------------------|----------|
| Commercial AI-Native | Atlan, Alation, Collibra | Active metadata, ML classification, enterprise governance, agentic AI |
| Open-Source Unified | OpenMetadata | Simplified stack (RDBMS + search), 90+ connectors, built-in quality |
| Open-Source Graph-Based | DataHub (LinkedIn) | Event-driven metadata graph, Kafka-based streaming, federated metadata services |
| Open-Source Discovery | Amundsen (Lyft) | Search-focused, Neo4j graph backend, lightweight |
| Cloud-Integrated | Unity Catalog, Dataplex | Tight lakehouse/warehouse integration, ABAC policies |
| Data Quality Overlay | Great Expectations, Soda, Anomalo | Quality scoring, anomaly detection, contract validation |
| Semantic Layer | dbt Semantic Layer, Cube, AtScale | Metric definitions, business semantics, governed metrics |

## Key Concepts

| Concept | Definition |
|---------|-----------|
| **Active Metadata** | Metadata that triggers automated actions (alerts, policy enforcement, lineage updates) rather than sitting passively in a registry |
| **Column-Level Lineage** | Tracking data flow at the individual column level through SQL transformations, ETL jobs, and BI reports |
| **Auto-Classification** | ML-driven detection and tagging of sensitive data (PII, PHI, PCI) using NER, regex patterns, and sampling |
| **Data Quality Score** | Composite metric combining freshness, completeness, uniqueness, validity, and consistency dimensions |
| **Tag-Based Policy** | Governance rules (masking, filtering, access) that attach to metadata tags rather than individual assets |
| **Natural Language Querying** | LLM-powered interface that converts business questions to SQL using catalog metadata as context |
| **Metadata Graph** | A knowledge graph where entities are data assets and edges are relationships (lineage, ownership, dependency) |
| **Data Contract** | A formal producer-consumer agreement specifying schema, quality SLOs, and availability guarantees |
| **MCP (Model Context Protocol)** | A standardized protocol enabling AI agents to connect to and consume catalog metadata programmatically |
| **Metadata Lakehouse** | Architecture pattern storing metadata in open table formats (e.g., Iceberg) for analytical queries at scale |

## Related Patterns

| Related Topic | Connection | Link |
|--------------|------------|------|
| Data Warehouse | Primary metadata source; the catalog crawls warehouse schemas, query logs, and usage patterns | [View](../16.6-data-warehouse/00-index.md) |
| Data Lakehouse Architecture | Catalog provides governance overlay for lakehouse open table formats; lineage across lakehouse transformations | [View](../16.7-data-lakehouse-architecture/00-index.md) |
| Change Data Capture System | CDC events feed the catalog's metadata ingestion pipeline; real-time schema change detection | [View](../16.8-change-data-capture-system/00-index.md) |
| Data Mesh Architecture | Catalog is the "connective tissue" of data mesh — enabling federated governance with centralized discovery | [View](../16.9-data-mesh-architecture/00-index.md) |
| Graph Database | Metadata graph storage; lineage traversal algorithms; impact analysis query patterns | [View](../16.4-graph-database/00-index.md) |
| Text Search Engine | Powers catalog search functionality; BM25 + faceted search + semantic vector search | [View](../16.3-text-search-engine/00-index.md) |
| Distributed Log-Based Broker | Event bus architecture for metadata change events; active metadata processing | [View](../1.5-distributed-log-based-broker/00-index.md) |
| Vector Database | Stores entity description embeddings for semantic search; powers NL-to-SQL context retrieval | [View](../3.14-vector-database/00-index.md) |
