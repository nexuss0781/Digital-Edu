# 12.18 Marketplace Platform — High-Level Design

## System Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        BW[Buyer Web/Mobile]
        SW[Seller Web/Mobile]
    end

    subgraph Gateway["API Gateway Layer"]
        AG[API Gateway\nAuth + Rate Limiting\n+ Request Routing]
    end

    subgraph Core["Core Services"]
        LS[Listing Service\nCRUD + state machine]
        SS[Search Service\nQuery + Ranking]
        OS[Order Service\nCheckout + Reservation]
        PS[Payment Service\nEscrow + Disbursement]
        RS[Review Service\nSubmission + Fraud Gate]
        MS[Messaging Service\nBuyer-Seller Chat]
        DS[Dispute Service\nResolution + Mediation]
        NS[Notification Service\nEmail + Push + In-app]
        US[User/Seller Service\nProfiles + KYC + Quality Score]
    end

    subgraph Trust["Trust & Safety"]
        FD[Fraud Detector\nListing + Payment + Account]
        TS[Trust Scorer\nSeller Quality Engine]
        HR[Human Review Queue\nTrust Analysts]
    end

    subgraph Search["Search & Discovery"]
        IX[Search Indexer\nNear-real-time pipeline]
        RK[Ranking Engine\nLTR model serving]
        RC[Recommendation Engine\nCandidate gen + scoring]
    end

    subgraph Data["Data Layer"]
        PDB[(Primary DB\nListings + Orders\n+ Users)]
        SDB[(Search Index\n300M documents)]
        CDB[(Cache Layer\nListing + Session\n+ Seller Score)]
        EDB[(Escrow Ledger\nAppend-only financial\nrecords)]
        OBJ[(Object Storage\nListing photos)]
    end

    subgraph Events["Event Bus"]
        EV[Event Stream\nOrder events\n+ Listing events\n+ Trust events]
    end

    BW --> AG
    SW --> AG
    AG --> LS & SS & OS & PS & RS & MS & DS & US

    LS --> EV
    OS --> EV
    RS --> EV
    PS --> EV

    EV --> IX
    EV --> FD
    EV --> TS
    EV --> NS

    SS --> RK
    SS --> SDB
    SS --> CDB

    IX --> SDB
    TS --> CDB

    OS --> PS
    OS --> PDB
    PS --> EDB

    LS --> PDB
    LS --> OBJ
    RS --> PDB
    US --> PDB

    FD --> HR
    FD --> TS

    RC --> SS

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef trust fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef search fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef event fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class BW,SW client
    class AG gateway
    class LS,SS,OS,PS,RS,MS,DS,NS,US service
    class FD,TS,HR trust
    class IX,RK,RC search
    class PDB,SDB,CDB,EDB,OBJ data
    class EV event
```

---

## Key Design Decisions

### Decision 1: Escrow-Based Payment with Conditional Release

Charging the buyer at order creation and immediately forwarding proceeds to the seller creates a non-recoverable situation when buyers dispute non-delivery or item misrepresentation. The platform would need to chase sellers for refunds—a losing proposition at scale. Instead, buyer payment is captured at checkout into a platform-held escrow account. Funds are released to the seller only when one of three conditions is met: (1) delivery is confirmed by carrier tracking, (2) the buyer confirms receipt, or (3) the buyer protection window expires without a dispute being filed. This makes the platform the trusted intermediary for both sides: buyers trust that payment won't disappear, sellers trust that payment is secured and will be released.

**Implication:** The platform must hold substantial float (days of GMV in escrow), which creates regulatory obligations as a payment intermediary. The escrow ledger must be a separate, append-only financial record independent of the operational database.

### Decision 2: Seller Quality Score as a First-Class, Asynchronously Updated Signal

Seller quality affects search ranking, payout hold periods, buyer trust badges, and listing visibility—it is the most cross-cutting signal in the system. Computing it synchronously on every affected operation would create tight coupling and latency problems. Instead, the seller quality score is a pre-computed, cached signal updated asynchronously after each qualifying event (order completion, review submitted, dispute resolved, policy action taken). The score is versioned and timestamped; downstream systems consume the current score from cache and receive invalidation events when scores change materially.

**Implication:** There is an inherent staleness window (typically seconds to minutes) between a quality-changing event and the score update propagating to search ranking. This is acceptable—ranking is not expected to update in real time—but requires explicit SLO for propagation latency.

### Decision 3: Multi-Stage Search Pipeline (Recall → Rank → Filter → Personalize)

A naive approach applies a single scoring function to all 300M listings per query. This doesn't scale. The production pipeline uses four stages: (1) lightweight ANN (approximate nearest neighbor) vector recall to retrieve the top ~1,000 candidates from 300M in under 10ms; (2) learning-to-rank re-ranking of the 1,000 candidates using rich features (seller quality, behavioral signals, listing freshness) in under 20ms; (3) hard filtering for sold-out, policy-suspended, and geo-restricted listings; (4) diversity injection and personalization layer to avoid filter bubbles and surface new sellers. Each stage has a different latency budget and a different trade-off between recall and precision.

**Implication:** The system can improve ranking quality by improving any single stage without rebuilding the others. New ranking signals can be added to the re-ranker without touching the recall layer.

### Decision 4: Inventory Reservation with TTL-Based Soft Reserve

A race condition exists when multiple buyers simultaneously view the same single-quantity listing and attempt to purchase. Without reservation, two buyers can complete checkout for the same item. The solution uses a two-phase reservation: when a buyer enters checkout, a soft reserve is written with a TTL (10 minutes). If checkout completes within the TTL, the reserve converts to a hard commit and inventory is decremented. If TTL expires without checkout completion, the reserve is released and the item becomes available again. Only one soft reserve per listing can exist for single-quantity items.

**Implication:** Items can appear "unavailable" during checkout even if no purchase occurs (TTL reserve squatting). This is the correct trade-off: a false "sold out" for 10 minutes is far less harmful than an oversell.

### Decision 5: Trust Signals as Graph-Structured, Not Record-Structured, Data

Review fraud and coordinated seller manipulation are graph problems, not row-based anomaly detection problems. A seller with 5,000 five-star reviews from accounts that all signed up in the same week, have never reviewed other sellers, and share overlapping IP ranges cannot be detected by examining any single review record. It requires modeling the bipartite graph of reviewer-to-seller relationships and computing structural anomaly scores (reviewer clustering coefficients, temporal burst detection, IP diversity of review sources). Storing trust signals in a graph database alongside the transactional relational database allows this structural analysis without degrading OLTP performance.

**Implication:** Trust scoring requires a separate analytical pipeline that processes the review graph nightly (or in near-real-time for burst anomalies) and updates seller quality scores accordingly.

---

## Data Flow: Buyer Checkout

```mermaid
flowchart LR
    A[Buyer Adds to Cart] --> B[Listing Service\nCheck availability]
    B -->|Available| C[Soft Reserve\nTTL: 10 min]
    B -->|Unavailable| D[Show Sold Out]
    C --> E[Buyer Enters\nPayment Details]
    E --> F[Payment Service\nTokenize + Authorize]
    F -->|Auth success| G[Order Service\nCreate order record]
    G --> H[Hard Commit\nInventory decrement]
    H --> I[Payment Capture\nFunds to escrow]
    I --> J[Order Event\nPublished to event bus]
    J --> K[Notify Seller\n+ Buyer]
    J --> L[Listing Service\nMark listing sold]
    F -->|Auth failed| M[Return to Checkout\nShow error]

    classDef buyer fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef payment fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef event fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef terminal fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class A,E buyer
    class B,G,H,L service
    class F,I payment
    class J,K event
    class C,D,M terminal
```

---

## Data Flow: Escrow Release and Payout

```mermaid
flowchart TB
    A[Order Delivered\nor Protection\nWindow Expires] --> B{Dispute\nopen?}
    B -->|Yes| C[Hold Escrow\nUntil Dispute\nResolved]
    B -->|No| D[Escrow Release\nTrigger]
    C --> E[Dispute Service\nMediation]
    E -->|Buyer wins| F[Refund Buyer\nFromEscrow]
    E -->|Seller wins| D
    D --> G[Calculate\nSeller Net\nAmount − Take Rate\n− Processing Fee\n− Tax Remittance]
    G --> H[Seller\nTrust Tier Check]
    H -->|Below hold threshold| I[Extend Hold\nPeriod]
    H -->|Clear| J[Queue Payout\nDisbursement]
    J --> K[Payment Rails\nBank Transfer\nor Digital Wallet]
    K --> L[Escrow Ledger\nAppend-only record\nof disbursement]

    classDef trigger fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef financial fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef ledger fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class A trigger
    class B,H decision
    class C,D,E,G,J service
    class F,K financial
    class L ledger
```

---

## Data Flow: Listing Creation to Search Visibility

```mermaid
flowchart LR
    A[Seller Creates\nListing] --> B[Listing Service\nValidate + Store]
    B --> C[Photo Upload\nto Object Storage]
    B --> D[Fraud Detector\nAsync scan]
    D -->|Flagged| E[Hold for\nHuman Review]
    D -->|Clear| F[Listing Activated\nState: active]
    F --> G[Listing Event\nPublished]
    G --> H[Search Indexer\nNear-real-time\nindex update]
    H --> I[Listing Visible\nin Search Results]
    G --> J[Seller Quality\nContext Updated\nnew listing signal]

    classDef seller fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef trust fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef event fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef search fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class A seller
    class B,C,F service
    class D,E trust
    class G,J event
    class H,I search
```

---

## Component Responsibilities Summary

| Component | Primary Responsibility | Key Interface |
|---|---|---|
| **API Gateway** | Authentication, rate limiting, request routing, SSL termination | REST/GraphQL; JWT token validation |
| **Listing Service** | Listing CRUD, state machine (draft→active→sold), photo orchestration | REST API; publishes listing events to event bus |
| **Search Service** | Query parsing, multi-stage retrieval, ranking assembly | REST search API; reads from search index and cache |
| **Search Indexer** | Near-real-time index updates from listing events; document transformation | Consumes listing events; writes to search index |
| **Ranking Engine** | LTR model serving; combines relevance + seller quality + behavioral signals | gRPC inference API; called by Search Service |
| **Order Service** | Checkout orchestration, inventory reservation, order record management | REST checkout API; coordinates with Payment and Listing services |
| **Payment Service** | Payment authorization, capture, escrow accounting, disbursement scheduling | Internal gRPC; integrates with external payment processor and banking rails |
| **Escrow Ledger** | Append-only financial record of all escrow events (capture, hold, release, refund) | Write-only from Payment Service; read for audits and reconciliation |
| **Fraud Detector** | Multi-layer fraud scoring for listings, transactions, and reviews | Async event consumer; writes scores to Trust DB; escalates to human review |
| **Trust Scorer** | Computes and updates seller quality score from all quality signals | Event-driven; updates score cache; publishes score change events |
| **Dispute Service** | Opens, tracks, and resolves buyer-seller disputes; controls escrow release | REST disputes API; integrates with Payment Service for refund/release |
| **Review Service** | Review submission with fraud gate; score aggregation; public display | REST reviews API; fraud check before write; async quality score update |

---

## Component Dependency Matrix

Understanding which components depend on which — and the failure impact — is critical for operational planning:

| Component | Depends On | Failure Impact |
|---|---|---|
| **Search Service** | Search Index, Ranking Engine, Cache, Availability Cache | Buyers cannot find listings; GMV drops immediately |
| **Order Service** | Listing Service, Payment Service, Cache, Primary DB | No new orders; direct GMV loss |
| **Payment Service** | External Processor, Escrow Ledger, Token Vault | No payment capture or disbursement; financial operations halt |
| **Listing Service** | Primary DB, Object Storage, Event Bus | Sellers cannot create/update listings; supply growth stops |
| **Trust Scorer** | Event Bus, Primary DB, Cache | Seller quality scores stale; ranking quality degrades silently |
| **Fraud Detector** | Event Bus, Trust Graph DB, ML Model Server | Fraudulent listings and reviews go undetected |
| **Search Indexer** | Event Bus, Search Index | New listings invisible; search becomes progressively stale |
| **Dispute Service** | Order Service, Payment Service, Escrow Ledger | Buyer disputes unresolved; escrow funds frozen indefinitely |
| **Notification Service** | Event Bus, Email/Push providers | Users not notified of order updates; support ticket volume spikes |

### Critical Path vs. Non-Critical Path

```
Critical path (synchronous, latency-sensitive):
  Buyer → API Gateway → Search Service → Ranking Engine → Response
  Buyer → API Gateway → Order Service → Payment Service → Escrow Ledger → Response

Non-critical path (asynchronous, eventual):
  Listing Event → Search Indexer → Index Update
  Order Event → Trust Scorer → Score Update → Cache Invalidation
  Review Event → Fraud Detector → Fraud Score → State Update
  Order Event → Notification Service → Email/Push
```

**Design principle:** No non-critical path component should block or slow the critical path. All cross-cutting updates flow through the event bus, ensuring the buyer's checkout latency is independent of trust scoring, search indexing, and notification delivery.

---

## Data Flow: Seller Quality Score Lifecycle

```mermaid
flowchart TB
    subgraph Events["Qualifying Events"]
        OC[Order Completed]
        RV[Review Published]
        DR[Dispute Resolved]
        PV[Policy Violation]
    end

    subgraph Compute["Score Computation"]
        EB[Event Bus\nDebounce per seller\n5-min window]
        TS[Trust Scorer\nFetch all signals\nCompute composite]
        SC[Score Cache\nWrite-through\nVersioned]
    end

    subgraph Downstream["Score Consumers"]
        SI[Search Indexer\nBatch update all\nseller listings]
        PO[Payout Service\nRecalculate hold\nperiod]
        BP[Buyer Profile\nUpdate trust badge]
        LP[Listing Policy\nCheck category\naccess]
    end

    OC & RV & DR & PV --> EB
    EB --> TS
    TS --> SC
    SC --> SI & PO & BP & LP

    classDef event fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef compute fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef consumer fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class OC,RV,DR,PV event
    class EB,TS,SC compute
    class SI,PO,BP,LP consumer
```

---

## Data Flow: Dispute Resolution with Escrow Impact

```mermaid
sequenceDiagram
    participant B as Buyer
    participant DS as Dispute Service
    participant ES as Escrow Service
    participant PS as Payment Service
    participant SS as Seller
    participant TS as Trust Scorer

    B->>DS: Open dispute (reason, evidence)
    DS->>ES: Freeze escrow for order
    ES-->>DS: Escrow frozen
    DS->>SS: Notify seller (48h response window)

    alt Auto-Resolvable
        DS->>DS: Evaluate evidence + carrier data
        alt Buyer wins (no delivery proof)
            DS->>ES: Release to buyer
            ES->>PS: Initiate refund
            PS-->>B: Refund processed
        else Seller wins (delivery confirmed)
            DS->>ES: Release to seller
            ES->>PS: Queue payout
        end
    else Human Review Required
        DS->>DS: Queue for trust analyst
        Note over DS: Analyst reviews evidence<br/>from both parties
        DS->>ES: Execute resolution decision
    end

    DS->>TS: Emit dispute.resolved event
    TS->>TS: Recompute seller quality score
```

---

## Technology Selection Guidelines

| Component | Recommended Approach | Why Not the Alternative |
|---|---|---|
| **Primary DB** | Sharded relational (horizontally partitioned) | NoSQL lacks the transactional guarantees needed for inventory and orders |
| **Search Index** | Dedicated search engine (inverted index + vector) | Relational DB cannot handle 300M full-text + vector queries at 8K QPS |
| **Event Bus** | Distributed log with consumer groups | Point-to-point messaging loses the replay and multi-consumer properties |
| **Escrow Ledger** | Append-only event-sourced store | Mutable balance tables are reconciliation-hostile |
| **Cache** | Distributed in-memory store | Local caches create consistency issues for availability and scores |
| **Fraud Graph** | Graph database | Relational JOINs cannot efficiently compute graph distance and clustering |
| **Object Storage** | Cloud object store + CDN | Block storage uneconomical at PB scale for photos |
| **ML Model Serving** | Low-latency inference service (gRPC) | REST adds unnecessary overhead for inline ranking inference |

---

## Real-World: Marketplace Architecture at Scale

### Case Study: Multi-Category E-Commerce Marketplace

A marketplace serving 50M+ buyers, 2M+ sellers, and 300M+ listings across 30+ categories:

**Architecture decisions that worked:**
- **Search as a first-class service:** Dedicated search team maintains the multi-stage pipeline independently from the listing team. Search index is a derived view, not a primary store — any inconsistency is self-healing on the next index refresh cycle.
- **Escrow as a separate financial system:** The escrow ledger is deployed as an independent service with its own database, replication, and backup strategy. The operations team treats it with the same rigor as a banking system — separate change management, quarterly penetration tests, and financial audits.
- **Event bus as the integration backbone:** All cross-service communication flows through the event bus. No service calls another service synchronously for non-critical operations. This allowed the team to add a new "seller analytics" consumer without modifying any existing service.

**Architecture decisions that caused pain:**
- **Tight coupling of seller quality score to search index:** Initially, the seller quality score was stored as a field in the search document. Updating it required re-indexing the listing. At 300M listings and 5M sellers, a single seller's score change triggered updates to hundreds of listing documents. Decoupling the score into a separate lookup (fetched at query time, not stored in the index) resolved the fanout problem.
- **Monolithic fraud detection:** Initially, listing fraud, review fraud, and payment fraud were all handled by a single "fraud service." As each attack vector evolved, the service became a Slowest part of the process for deployment velocity. Splitting into three specialized services (each with its own model deployment cycle) improved detection accuracy and team velocity.

### Case Study: Cross-Border Marketplace Payment Architecture

A marketplace enabling transactions between buyers and sellers in 15+ countries:

**Challenges solved:**
- **Multi-currency escrow:** Buyer pays in their local currency. Escrow holds in the buyer's currency (not the seller's) to avoid FX exposure during the hold period. FX conversion happens at disbursement time, with the rate locked 24 hours before the payout batch.
- **Regional payment processor routing:** EU buyers routed through an EU-based processor (PSD2/SCA compliance); US buyers through a US processor; APAC buyers through regional processors supporting local payment methods (bank transfers, digital wallets). Gateway-level routing based on buyer's card BIN or payment method type.
- **International payout rails:** Cross-border payouts use SWIFT for high-value, local faster-payment networks (ACH in US, SEPA in EU, FPS in UK) for domestic payouts. Minimum payout thresholds ($25 domestic, $100 international) to ensure transfer fees don't exceed a percentage of the payout.
- **Tax complexity:** Each buyer-seller jurisdiction pair requires different tax treatment. A US buyer purchasing from a UK seller: no US sales tax (international purchase), but UK VAT may apply on the seller side. Tax engine maintains a jurisdiction-pair matrix with 200+ combinations.

**Key lesson:** The payment service interface abstraction (single internal API regardless of payment method or region) was worth the 6-month upfront investment. Every new region or payment method is a configuration change, not a code change.
