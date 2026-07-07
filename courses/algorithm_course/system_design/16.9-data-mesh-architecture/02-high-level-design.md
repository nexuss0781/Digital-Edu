# High-Level Design — Data Mesh Architecture

## System Architecture

```mermaid
---
config:
  theme: base
  look: neo
  themeVariables:
    primaryColor: "#e8f5e9"
    primaryBorderColor: "#2e7d32"
---
flowchart TB
    subgraph Domains["Domain Teams (Producers)"]
        D1[Domain A: Sales]
        D2[Domain B: Marketing]
        D3[Domain C: Supply Chain]
    end

    subgraph Platform["Self-Serve Data Platform"]
        subgraph Catalog["Data Product Catalog"]
            REG[Registration Service]
            DISC[Discovery & Search]
            META[(Metadata Store)]
        end

        subgraph Governance["Federated Governance Layer"]
            PE[Policy Engine]
            CV[Contract Validator]
            QM[Quality Monitor]
        end

        subgraph Infra["Platform Infrastructure"]
            PUB[Publishing Pipeline]
            ACC[Access Control Service]
            LIN[Lineage Service]
            LG[(Lineage Graph)]
        end
    end

    subgraph Consumers["Data Consumers"]
        AN[Analysts]
        DS[Data Scientists]
        APP[Applications]
        FQ[Federated Query Engine]
    end

    D1 & D2 & D3 -->|publish| PUB
    PUB --> CV
    CV --> PE
    PE --> REG
    REG --> META
    REG --> LIN
    LIN --> LG

    AN & DS & APP --> DISC
    DISC --> META
    AN & DS & APP --> FQ
    FQ --> ACC
    ACC --> D1 & D2 & D3

    QM --> META

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class D1,D2,D3 client
    class REG,DISC gateway
    class PE,CV,QM,PUB,ACC,LIN service
    class META,LG data
    class AN,DS,APP,FQ cache
```

---

## Data Flow

### Data Product Publishing Flow

```mermaid
---
config:
  theme: base
  look: neo
---
sequenceDiagram
    participant Domain as Domain Team
    participant Pipeline as Publishing Pipeline
    participant Contract as Contract Validator
    participant Policy as Policy Engine
    participant Catalog as Data Product Catalog
    participant Lineage as Lineage Service
    participant Quality as Quality Monitor

    Domain->>Pipeline: Submit data product descriptor (YAML)
    Pipeline->>Pipeline: Validate descriptor format
    Pipeline->>Contract: Validate schema against consumer contracts
    Contract->>Contract: Check backward compatibility
    Contract-->>Pipeline: Compatibility result

    alt Contract violation detected
        Pipeline-->>Domain: Reject — breaking change to consumer X
    end

    Pipeline->>Policy: Evaluate governance policies
    Policy->>Policy: Check naming conventions
    Policy->>Policy: Check PII classification
    Policy->>Policy: Check quality thresholds
    Policy->>Policy: Check access policy existence
    Policy-->>Pipeline: Policy evaluation result

    alt Policy violation detected
        Pipeline-->>Domain: Reject — policy violations listed
    end

    Pipeline->>Catalog: Register data product metadata
    Catalog-->>Pipeline: Registration confirmed
    Pipeline->>Lineage: Update lineage graph with dependencies
    Lineage-->>Pipeline: Lineage updated
    Pipeline->>Quality: Initialize SLO monitoring
    Quality-->>Pipeline: Monitoring active
    Pipeline-->>Domain: Data product published successfully
```

**Publishing flow key points:**

1. **Contract-first** — Schema compatibility with existing consumers is validated before governance policies, failing fast on breaking changes
2. **Policy-as-code** — All governance rules are machine-executable; no manual approval gates in the publishing pipeline
3. **Lineage capture** — Declared dependencies are recorded in the lineage graph at publish time, not discovered retroactively
4. **SLO activation** — Quality monitoring begins immediately upon publication with the declared freshness and quality thresholds
5. **Rejection with specifics** — Failed publications return actionable feedback identifying exactly which contracts or policies were violated

### Data Product Consumption Flow

```mermaid
---
config:
  theme: base
  look: neo
---
sequenceDiagram
    participant Consumer as Data Consumer
    participant Catalog as Discovery Service
    participant Access as Access Control
    participant Query as Federated Query Engine
    participant DomainA as Domain A Storage
    participant DomainB as Domain B Storage

    Consumer->>Catalog: Search "customer lifetime value"
    Catalog->>Catalog: Full-text search + relevance ranking
    Catalog-->>Consumer: Ranked results with quality scores, SLOs, owners

    Consumer->>Catalog: Request access to Product X
    Catalog->>Access: Evaluate access policy for consumer's identity
    Access->>Access: Check role, team, purpose-of-use
    Access-->>Consumer: Access granted (or pending owner approval)

    Consumer->>Query: SELECT * FROM domain_a.customers JOIN domain_b.orders
    Query->>Access: Validate query against access policies
    Access-->>Query: Authorized for both products
    Query->>DomainA: Fetch customer data (push down filters)
    Query->>DomainB: Fetch order data (push down filters)
    DomainA-->>Query: Customer records
    DomainB-->>Query: Order records
    Query->>Query: Execute cross-domain JOIN
    Query-->>Consumer: Unified result set
```

---

## Component Responsibility Matrix

| Component | Primary Responsibility | Owns | Depends On | Failure Impact |
|-----------|----------------------|------|-----------|----------------|
| **Publishing Pipeline** | Orchestrates data product registration workflow | Publish state machine | Contract Validator, Policy Engine, Catalog, Lineage | Publishing blocked |
| **Contract Validator** | Validates schema compatibility against consumer contracts | Contract versions | Catalog (consumer list) | Cannot detect breaking changes |
| **Policy Engine** | Evaluates governance policies against product descriptors | Policy definitions, evaluation history | Policy store | Publishing defaults to fail-closed |
| **Registration Service** | Persists product metadata in catalog | Product records | Metadata Store, Search Index | No new products registered |
| **Discovery & Search** | Full-text + faceted search across product catalog | Search index | Metadata Store (source of truth) | Consumers cannot find products |
| **Quality Monitor** | Continuously evaluates data product SLOs | Quality history, SLO status | Metadata Store, domain storage (sampling) | Silent quality degradation |
| **Access Control Service** | Evaluates access policies per request | Access grants, audit log | Identity provider, product access policies | Unauthorized access or blocked access |
| **Lineage Service** | Maintains and queries the dependency graph | Lineage graph | Graph store | No impact analysis capability |
| **Event Bus** | Distributes lifecycle events to subscribers | Event topics | Message broker | Delayed notifications |
| **Federated Query Engine** | Executes SQL across domain storage systems | Query plans, caching | Domain storage endpoints, Access Control | Cross-domain queries unavailable |

## Data Flow: Schema Change Impact Propagation

```mermaid
---
config:
  theme: base
  look: neo
---
flowchart LR
    subgraph Producer["Producer Domain"]
        OW[Product Owner]
        SC[Schema Change]
    end

    subgraph Platform["Platform Pipeline"]
        IA[Impact Analysis]
        CV2[Contract Check]
        PE2[Policy Eval]
        NOT[Notification Service]
    end

    subgraph Affected["Affected Parties"]
        C1[Direct Consumer 1]
        C2[Direct Consumer 2]
        C3[Transitive Consumer]
        MD[Materialized Product Owner]
    end

    OW -->|submits| SC
    SC --> IA
    IA -->|lineage query| CV2
    CV2 -->|compatible| PE2
    CV2 -->|breaking| NOT
    PE2 -->|pass| NOT
    NOT -->|alert| C1
    NOT -->|alert| C2
    NOT -->|cascade alert| C3
    NOT -->|schema drift| MD

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class OW,SC client
    class IA,CV2,PE2,NOT service
    class C1,C2,C3,MD gateway
```

## Data Flow: Right-to-Deletion (GDPR) Cross-Domain Propagation

```mermaid
---
config:
  theme: base
  look: neo
---
sequenceDiagram
    participant User as Data Subject
    participant Legal as Legal Domain
    participant Lineage as Lineage Service
    participant Governance as Governance Engine
    participant DomainA as Domain A
    participant DomainB as Domain B
    participant DomainC as Domain C
    participant Audit as Audit Service

    User->>Legal: Deletion request (customer_id: X)
    Legal->>Lineage: Find all products containing customer_id
    Lineage->>Lineage: Traverse graph for customer_id field
    Lineage-->>Legal: Products: [A.customers, B.orders, C.campaigns]

    Legal->>Governance: Validate deletion authority
    Governance-->>Legal: Authorized (GDPR Article 17)

    par Parallel deletion dispatch
        Legal->>DomainA: Delete customer_id=X from A.customers
        Legal->>DomainB: Delete customer_id=X from B.orders
        Legal->>DomainC: Delete customer_id=X from C.campaigns
    end

    DomainA-->>Legal: Deleted (3 records)
    DomainB-->>Legal: Deleted (47 records)
    DomainC-->>Legal: Deleted (12 records)

    Legal->>Audit: Log deletion: 62 records across 3 domains
    Audit-->>Legal: Audit record created
    Legal-->>User: Deletion confirmed
```

## Self-Serve Platform Architecture Layers

```mermaid
---
config:
  theme: base
  look: neo
---
flowchart TB
    subgraph Experience["Experience Layer"]
        UI[Data Product Catalog UI]
        CLI[CLI Tools]
        API[Platform API]
    end

    subgraph Orchestration["Orchestration Layer"]
        PUB2[Publishing Pipeline]
        DISC2[Discovery Engine]
        QUE[Query Router]
    end

    subgraph Core["Core Services"]
        GOV[Governance Engine]
        CON[Contract Manager]
        LIN2[Lineage Tracker]
        QUA[Quality Monitor]
        ACC2[Access Manager]
    end

    subgraph Infra2["Infrastructure Layer"]
        META2[(Metadata Store)]
        GRAPH[(Graph Database)]
        SEARCH[(Search Index)]
        EVENTS[Event Bus]
        CACHE2[Cache Layer]
    end

    subgraph Domain["Domain Layer (per domain)"]
        STORE[(Domain Storage)]
        PIPE[Domain Pipeline]
        DESC[Product Descriptors]
    end

    UI & CLI --> API
    API --> PUB2 & DISC2 & QUE
    PUB2 --> GOV & CON & LIN2 & QUA & ACC2
    DISC2 --> META2 & SEARCH
    QUE --> ACC2 & STORE

    GOV & CON & LIN2 & QUA & ACC2 --> META2 & GRAPH & EVENTS
    DISC2 --> CACHE2
    QUE --> CACHE2

    PIPE --> DESC
    DESC --> PUB2

    classDef experience fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef orchestration fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef core fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef infra fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef domain fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class UI,CLI,API experience
    class PUB2,DISC2,QUE orchestration
    class GOV,CON,LIN2,QUA,ACC2 core
    class META2,GRAPH,SEARCH,EVENTS,CACHE2 infra
    class STORE,PIPE,DESC domain
```

## Technology Selection Guidelines

| Component | Recommended Approach | Rationale |
|-----------|---------------------|-----------|
| Metadata Store | Replicated document store | Flexible schema for evolving descriptors; strong consistency for registration |
| Lineage Graph | Native graph database | Adjacency traversal is the primary access pattern; BFS/DFS performance critical |
| Search Index | Dedicated full-text search engine | Inverted index, faceted search, and relevance ranking are specialized workloads |
| Event Bus | Distributed log-based message broker | Ordered, durable, replayable events for lifecycle notifications |
| Federated Query | SQL-on-anything engine | Must query heterogeneous sources (columnar, relational, object storage) via standard SQL |
| Contract Validation | Custom service | Domain-specific logic (compatibility rules, type widening) not served by off-the-shelf tools |
| Governance Engine | Custom rule engine with declarative policies | Must support YAML-defined rules evaluated at machine speed |
| Access Control | Policy decision point + policy enforcement point | Decouple policy evaluation from enforcement for flexibility |

---

## Key Architectural Decisions

### 1. Decentralized Data Ownership vs. Central Data Team

| Aspect | Decentralized (Data Mesh) | Centralized (Data Lake/Warehouse) |
|--------|--------------------------|----------------------------------|
| Ownership | Domain teams own their data products | Central data engineering team owns all pipelines |
| Slowest part of the process | No central Slowest part of the process; domains publish independently | Central team becomes Slowest part of the process as domains grow |
| Quality accountability | Producer is accountable; SLOs are contractual | Central team must understand every domain's data |
| Coordination cost | Higher (many teams must follow standards) | Lower (one team, one standard) |
| Scaling | Scales with organizational growth | Breaks at 20-30 domains (central team cannot keep up) |

**Decision:** Decentralized ownership with federated governance. The central data engineering team evolves into a platform team that provides self-serve infrastructure rather than building all pipelines. This is the architectural response to the observation that centralized data teams become organizational bottlenecks that scale linearly with headcount while data complexity grows exponentially.

### 2. Contract-Driven vs. Schema-on-Read

| Aspect | Contract-Driven | Schema-on-Read |
|--------|----------------|----------------|
| Producer burden | Must declare and maintain contracts | Minimal — publish data in any format |
| Consumer reliability | Consumers can depend on guaranteed structure | Consumers must handle any structure |
| Breaking change detection | Automated at publish time | Discovered at query time (production failure) |
| Flexibility | Lower (changes require contract negotiation) | Higher (any format, any time) |
| Trust | High (contractual guarantees) | Low (hope the data looks right) |

**Decision:** Contract-driven with automated validation. The overhead of maintaining contracts is significantly lower than the cost of debugging production failures caused by undocumented schema changes. Contracts are YAML descriptors versioned alongside the data product.

### 3. Embedded Governance vs. External Governance

| Aspect | Embedded (Policy-as-Code) | External (Manual Review) |
|--------|--------------------------|-------------------------|
| Enforcement speed | Milliseconds (automated) | Days/weeks (committee review) |
| Consistency | 100% — policies apply to every product | Variable — depends on reviewer attention |
| Scalability | Scales to thousands of products | Breaks at dozens of products |
| Flexibility | Rigid (rules are binary) | Flexible (human judgment) |
| Auditability | Complete (every evaluation is logged) | Partial (meeting notes, email threads) |

**Decision:** Policy-as-code with automated enforcement. Manual review committees do not scale beyond a handful of data products. Policies are encoded as executable rules (declarative YAML or code), evaluated automatically during the publishing pipeline, and produce deterministic pass/fail results with specific violation messages.

### 4. Federated Query Engine vs. Data Replication

| Aspect | Federated Query | Data Replication |
|--------|----------------|-----------------|
| Data freshness | Always current (queries source) | Stale by replication lag |
| Cross-domain JOINs | Network-bound, latency depends on sources | Local, fast after initial replication |
| Storage cost | No duplication | Copies of all consumed products |
| Governance | Access checked at query time | Access checked at replication time |
| Complexity | Query optimization across heterogeneous sources | Replication pipeline management |

**Decision:** Federated queries as the default with optional materialized views for high-frequency cross-domain joins. This preserves the single-source-of-truth principle while allowing performance optimization where needed.

### 5. Data Product Storage Strategy

**Decision:** Domain teams choose their own storage technology (columnar store, object storage, relational database) as long as the data product exposes a standard interface (SQL-accessible via the federated query engine or API). The platform provides recommended templates but does not mandate a single storage technology — this preserves domain autonomy while ensuring interoperability through interface standardization.

### 6. Event-Driven vs. Polling for Change Notification

**Decision:** Event-driven change notifications via a central event bus. When a data product is published, updated, deprecated, or has a quality SLO violation, an event is emitted. Consumers subscribe to events for products they depend on. This enables reactive lineage updates, automated quality alerting, and consumer-side cache invalidation without polling.

---

## Architecture Pattern Checklist

- [x] **Sync vs Async communication** — Synchronous for catalog queries and access control; async for publishing pipeline and governance evaluation
- [x] **Event-driven vs Request-response** — Event-driven for data product lifecycle notifications; request-response for discovery and federated queries
- [x] **Push vs Pull model** — Push-based notifications for data product changes; pull-based for data consumption and discovery
- [x] **Stateless vs Stateful services** — Catalog and governance services are stateless (state in metadata store); lineage service maintains graph state
- [x] **Read-heavy vs Write-heavy** — Read-heavy (100:1); discovery and consumption dominate; publishing is infrequent per product
- [x] **Real-time vs Batch processing** — Batch for data product publishing (daily/hourly cadence); real-time for governance enforcement and access control
- [x] **Edge vs Origin processing** — Origin processing; governance policies must be evaluated against the full catalog, not cached at the edge

---

## Real-World: Zalando's Data Mesh Journey

Zalando, a European e-commerce platform, was one of the earliest and most cited adopters of data mesh. Their journey illustrates the practical evolution from centralized data lake to domain-oriented data products.

**Before mesh:** A centralized data lake managed by a 30+ person data engineering team. Domain teams submitted tickets for new pipelines. Average time from data request to production pipeline: 4-6 weeks. The central team became a Slowest part of the process as the company grew to 20+ business domains.

**Mesh implementation:**
- Defined ~15 core domains: logistics, customer, catalog, payments, marketing, seller management, etc.
- Built an internal self-serve platform with data product templates, a catalog for discovery, and automated governance
- Migrated domain-owned datasets from the centralized lake to domain-managed storage over 18 months
- Achieved 100+ data products across domains within the first year
- Reduced average time-to-data from 4-6 weeks to days

**Key engineering decision:** Chose to keep a "data lake" domain that continued to serve as a shared exploration environment while governed data products became the source of truth for production analytics.

**Lesson:** The organizational change (convincing logistics teams to own their data) was harder than building the platform. They used "embedded data engineers" — platform team members who worked within domains for 3-6 months to build the first data products and train domain engineers.

---

## Real-World: Financial Services Data Mesh for Regulatory Reporting

A major global bank implemented data mesh to solve a specific problem: regulatory reporting required data from 40+ internal systems, and the centralized ETL pipeline took 72 hours to produce a single report, with frequent quality failures.

**Mesh approach:**
- Each business unit (trading, risk, compliance, operations) became a domain that published its own data products
- The "canonical identity" challenge was severe — "counterparty" had 14 different representations across systems
- Built a dedicated Identity Resolution domain that published a golden entity record consumed by all other domains
- Governance was non-negotiable: every data product required PII classification, encryption certification, and regulatory lineage before publication

**Results:**
- Regulatory report generation reduced from 72 hours to 8 hours
- Data quality issues in reports reduced by 60% due to contract-enforced schemas
- 47 global governance policies and 180+ domain-specific policies, all automated
- Time-to-publish for a standard data product: < 4 hours using the golden path template

**Key learning:** In regulated industries, governance is not a constraint on data mesh — it is the primary value proposition. The automation of compliance checks was what convinced leadership to fund the transformation.
