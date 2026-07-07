# High-Level Design

## Architecture Overview

The BNPL platform is decomposed into five logical layers: **Consumer & Merchant Interface** (checkout widgets, dashboards, mobile apps), **API Gateway & Orchestration** (authentication, rate limiting, request routing), **Core Domain Services** (credit decisioning, plan management, payment orchestration, merchant settlement, collections), **Data & Intelligence** (ML feature store, risk models, analytics), and **External Integrations** (credit bureaus, payment processors, card networks, banking partners). The architecture is event-driven: every state transition in the plan lifecycle emits an event consumed by downstream services (notifications, analytics, compliance audit).

---

## System Architecture Diagram

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Clients["Consumer & Merchant Layer"]
        CW[Checkout Widget / SDK]
        CA[Consumer App]
        MD[Merchant Dashboard]
        MA[Merchant API]
    end

    subgraph Gateway["API Gateway Layer"]
        AG[API Gateway]
        AUTH[Auth Service]
        RL[Rate Limiter]
    end

    subgraph Core["Core Domain Services"]
        CDS[Credit Decision Service]
        PMS[Plan Management Service]
        POS[Payment Orchestration Service]
        MSS[Merchant Settlement Service]
        COL[Collections Service]
        VCS[Virtual Card Service]
        DRS[Dispute Resolution Service]
    end

    subgraph Intelligence["Data & Intelligence"]
        FS[Feature Store]
        RML[Risk ML Models]
        ADE[Analytics & Data Engine]
    end

    subgraph Data["Data Layer"]
        CDB[(Consumer DB)]
        PDB[(Plan & Payment DB)]
        MDB[(Merchant DB)]
        DDB[(Decision Audit DB)]
        CACHE[(Decision Cache)]
        EVT[[Event Bus]]
    end

    subgraph External["External Partners"]
        CB[Credit Bureaus]
        PP[Payment Processors]
        CN[Card Networks]
        BP[Banking Partners]
        NP[Notification Providers]
    end

    CW & CA --> AG
    MD & MA --> AG
    AG --> AUTH & RL
    AG --> CDS & PMS & POS & MSS & COL & VCS & DRS

    CDS --> FS & RML & CB
    CDS --> DDB & CACHE
    PMS --> PDB
    POS --> PP & BP
    MSS --> MDB & BP
    COL --> POS & NP
    VCS --> CN
    DRS --> PMS & POS

    CDS & PMS & POS & MSS & COL --> EVT
    EVT --> ADE & NP

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef intelligence fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef external fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class CW,CA,MD,MA client
    class AG,AUTH,RL gateway
    class CDS,PMS,POS,MSS,COL,VCS,DRS service
    class FS,RML,ADE intelligence
    class CDB,PDB,MDB,DDB,CACHE,EVT data
    class CB,PP,CN,BP,NP external
```

---

## Checkout Flow (Happy Path)

```mermaid
%%{init: {'theme': 'neutral'}}%%
sequenceDiagram
    participant C as Consumer
    participant W as Checkout Widget
    participant GW as API Gateway
    participant CD as Credit Decision
    participant FS as Feature Store
    participant CB as Credit Bureau
    participant PM as Plan Management
    participant PO as Payment Orchestration
    participant MS as Merchant Settlement
    participant M as Merchant

    C->>W: Select BNPL at checkout
    W->>GW: POST /v1/checkout/initialize
    GW->>CD: Evaluate credit (consumer_id, order)

    par Parallel Data Fetch
        CD->>FS: Get pre-computed features
        CD->>CB: Soft credit pull (async if cached)
    end

    CD->>CD: ML scoring + plan eligibility
    CD-->>GW: Approved: eligible plans with terms
    GW-->>W: Display plan options + APR disclosure

    C->>W: Select Pay-in-4
    W->>GW: POST /v1/checkout/confirm
    GW->>PM: Create installment plan
    PM->>PM: Generate payment schedule
    PM->>PO: Charge first installment
    PO-->>PM: Payment confirmed

    par Post-Confirmation
        PM->>MS: Queue merchant settlement
        PM-->>GW: Plan created + confirmation
        MS->>M: Settlement (T+1 to T+3)
    end

    GW-->>W: Order confirmed + plan details
    W-->>C: Show confirmation + payment schedule
```

---

## Payment Collection Flow

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Scheduler["Collection Scheduler"]
        CS[Cron: Identify Due Payments]
        BG[Batch Generator]
    end

    subgraph Collection["Collection Engine"]
        CE[Collection Executor]
        RL[Retry Logic]
        FH[Failure Handler]
    end

    subgraph PostCollection["Post-Collection"]
        PS[Plan State Updater]
        DN[Dunning Engine]
        LF[Late Fee Calculator]
        HP[Hardship Evaluator]
    end

    subgraph External["External"]
        PP[Payment Processor]
        NP[Notification Provider]
    end

    CS -->|Due payments query| BG
    BG -->|Payment batches| CE
    CE -->|Charge request| PP
    PP -->|Success| PS
    PP -->|Failure| RL
    RL -->|Retry exhausted| FH
    FH --> LF --> DN
    DN -->|Notify consumer| NP
    FH -->|Eligible| HP
    PS -->|All paid| PS
    PS -->|Plan complete| PS

    classDef scheduler fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef collection fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef post fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef ext fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class CS,BG scheduler
    class CE,RL,FH collection
    class PS,DN,LF,HP post
    class PP,NP ext
```

---

## Key Design Decisions

### 1. Synchronous Credit Decision vs. Asynchronous Pre-Approval

| Option | Pros | Cons |
|--------|------|------|
| **Synchronous at checkout** (chosen) | Fresh data, accurate risk assessment, regulatory compliance (point-of-sale disclosure) | Adds latency to checkout; requires low-latency ML pipeline |
| Asynchronous pre-approval | Zero checkout latency; pre-computed limits | Stale risk data; consumer circumstances change; regulatory concerns about pre-approved credit |

**Decision**: Synchronous credit decision at checkout with a pre-computed feature store to minimize latency. Pre-qualification is offered as a separate, non-binding flow.

### 2. Plan Storage: Relational vs. Document Store

| Option | Pros | Cons |
|--------|------|------|
| **Relational DB** (chosen) | ACID transactions for plan state changes; complex queries for collections; referential integrity | Schema rigidity; migration cost for new plan types |
| Document store | Flexible schema for varied plan types | Weaker consistency guarantees; complex aggregation queries |

**Decision**: Relational database for plans and payments. The installment lifecycle requires strong consistency (a payment must be atomically marked as collected and the plan balance updated). Plan type variations are handled via a discriminator column and type-specific JSON metadata.

### 3. Merchant Settlement: Real-Time vs. Batch

| Option | Pros | Cons |
|--------|------|------|
| Real-time settlement | Merchants receive funds immediately | Higher operational risk; harder to reconcile; expensive bank transfer fees |
| **Batch settlement (T+1 to T+3)** (chosen) | Lower transfer costs; reconciliation window; net settlement reduces transfers | Merchants wait 1--3 days for funds |

**Decision**: Batch settlement with configurable cadence (T+1 for premium merchants, T+3 for standard). Net settlement aggregates all transactions and refunds per merchant per settlement window, reducing the number of bank transfers.

### 4. Virtual Card Strategy: Pre-Generated Pool vs. On-Demand

| Option | Pros | Cons |
|--------|------|------|
| Pre-generated pool | Instant issuance; no latency at checkout | Unused cards waste number space; management overhead |
| **On-demand generation** (chosen) | No waste; card created only when needed | Adds ~500ms to checkout for virtual card path |

**Decision**: On-demand virtual card generation with a small warm pool for latency-sensitive flows. Cards are single-use, locked to the merchant and amount, and expire within 24 hours if unused.

### 5. Collections Architecture: Centralized vs. Per-Plan State Machine

| Option | Pros | Cons |
|--------|------|------|
| Centralized collections engine | Single orchestrator; easier to audit | Single point of failure; complex state management at scale |
| **Per-plan state machine** (chosen) | Each plan independently tracks its collection state; resilient to partial failures | State explosion across 50M plans; requires efficient state queries |

**Decision**: Each installment plan has an embedded state machine tracking its lifecycle (active → payment_due → collecting → paid / overdue → delinquent → hardship / charge_off → completed). A batch scheduler identifies plans needing action, but each plan's state transitions are self-contained and idempotent.

---

## Data Flow Summary

| Flow | Source | Destination | Pattern | Volume |
|------|--------|-------------|---------|--------|
| Credit decision | Checkout widget | Credit Decision Service → Feature Store → Credit Bureau | Sync request-response | 525 peak TPS |
| Plan creation | Credit Decision Service | Plan Management Service → Plan DB | Sync (within checkout) | ~23 TPS avg |
| First installment | Plan Management Service | Payment Orchestration → Payment Processor | Sync (blocks checkout) | ~23 TPS avg |
| Scheduled collection | Collection Scheduler | Payment Orchestration → Payment Processor | Batch (3 windows/day) | 2M per window |
| Merchant settlement | Settlement Scheduler | Merchant Settlement Service → Banking Partner | Batch (daily) | 500K merchants/day |
| Dunning notification | Collections Service | Notification Provider | Async event-driven | ~400K/day |
| Virtual card auth | Card Network | Virtual Card Service → Plan Management | Sync callback | ~200K/day |
| Dispute | Consumer / Merchant | Dispute Resolution Service | Async workflow | ~15K/day |
| Feature refresh | Analytics Engine | Feature Store | Batch (hourly/daily) | 50M consumer vectors |

---

## Credit Decision Pipeline Architecture

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    subgraph PreScreen["Stage 1: Pre-Screen\n< 10ms"]
        PS1[Account Status Check]
        PS2[Exposure Limit Check]
        PS3[Velocity Check]
        PS4[Blocklist Check]
    end

    subgraph DataAssembly["Stage 2: Data Assembly\n< 500ms (parallel)"]
        DA1[Soft Credit Pull\n~300-500ms cache miss]
        DA2[Feature Store Lookup\n~5-10ms]
        DA3[Device Scoring\n~10-20ms]
        DA4[Open Banking Data\n~200-400ms optional]
    end

    subgraph MLScoring["Stage 3: ML Inference\n< 100ms"]
        ML1[Risk Model\nP-default]
        ML2[Fraud Model\nP-fraud]
        ML3[Affordability Model\nDTI + disposable income]
    end

    subgraph Decision["Stage 4: Decision\n< 50ms"]
        DL[Decision Logic\n+ Plan Eligibility]
        TD[TILA Disclosure\nGeneration]
        AU[Audit Log\nasync fire-and-forget]
    end

    PS1 & PS2 & PS3 & PS4 --> DA1 & DA2 & DA3 & DA4
    DA1 & DA2 & DA3 & DA4 --> ML1 & ML2 & ML3
    ML1 & ML2 & ML3 --> DL --> TD
    DL --> AU

    classDef prescreen fill:#ffcdd2,stroke:#b71c1c,stroke-width:2px
    classDef data fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef ml fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef decision fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class PS1,PS2,PS3,PS4 prescreen
    class DA1,DA2,DA3,DA4 data
    class ML1,ML2,ML3 ml
    class DL,TD,AU decision
```

---

## Refund and Returns Flow

```mermaid
%%{init: {'theme': 'neutral'}}%%
sequenceDiagram
    participant M as Merchant
    participant GW as API Gateway
    participant PM as Plan Management
    participant PO as Payment Orchestration
    participant MS as Merchant Settlement
    participant C as Consumer
    participant NP as Notification

    M->>GW: POST /v1/plans/{id}/refund
    GW->>PM: Process refund request
    PM->>PM: Validate refund amount vs plan

    alt Full Refund
        PM->>PM: Cancel remaining installments
        PM->>PO: Refund already-paid installments
        PO-->>PM: Refund confirmed
        PM->>PM: Set plan status = refunded
    else Partial Refund
        PM->>PM: Recalculate remaining schedule
        PM->>PM: Distribute reduction proportionally
        PM->>PO: Refund overpayment if applicable
    end

    PM->>MS: Adjust merchant settlement
    MS->>MS: Deduct refund from next settlement
    PM->>NP: Notify consumer of refund
    NP-->>C: Email + push notification
    PM-->>GW: Refund confirmation + adjusted plan
    GW-->>M: Refund response with adjusted schedule
```

---

## Virtual Card Issuance and Authorization Flow

```mermaid
%%{init: {'theme': 'neutral'}}%%
sequenceDiagram
    participant C as Consumer
    participant APP as Consumer App
    participant GW as API Gateway
    participant CD as Credit Decision
    participant VC as Virtual Card Service
    participant CN as Card Network
    participant MRC as Merchant POS
    participant PM as Plan Management

    C->>APP: Request virtual card for $200 at Merchant X
    APP->>GW: POST /v1/virtual-cards/issue
    GW->>CD: Pre-approve credit (consumer, amount, merchant)
    CD-->>GW: Approved (pre-approval token)
    GW->>VC: Issue card (pre-approval, merchant_lock, amount)
    VC->>VC: Generate single-use PAN + CVV
    VC-->>APP: Card details (masked PAN, expiry, CVV)

    C->>MRC: Enter virtual card at merchant checkout
    MRC->>CN: Authorization request
    CN->>VC: Auth request (PAN, amount, merchant)
    VC->>VC: Validate: card active, merchant match, amount within tolerance
    VC->>PM: Create installment plan
    PM-->>VC: Plan created
    VC-->>CN: Authorization approved
    CN-->>MRC: Approved
    MRC-->>C: Order confirmed

    Note over VC: Card marked as "used" atomically
    Note over VC: If unused, expires in 24 hours
```

---

## Open Banking Integration Architecture

Modern BNPL platforms increasingly leverage open banking APIs to enhance credit decisions with real-time financial data, reducing reliance on credit bureau scores alone.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Consumer["Consumer Consent"]
        CC[Consumer Authorizes\nBank Data Access]
    end

    subgraph OB["Open Banking Layer"]
        AG2[Account Aggregation\nService]
        IV[Income Verification\nEngine]
        CA2[Cashflow Analysis\nEngine]
        BA[Bank Account\nVerification]
    end

    subgraph Enrichment["Data Enrichment"]
        TXC[Transaction\nCategorization]
        INC[Regular Income\nDetection]
        EXP[Essential Expense\nIdentification]
        DI[Disposable Income\nCalculation]
    end

    subgraph CreditDecision["Credit Decision Enhancement"]
        AFD[Affordability\nAssessment]
        FS2[Feature Store\nUpdate]
    end

    CC --> AG2
    AG2 --> IV & CA2 & BA
    IV --> INC
    CA2 --> TXC & EXP
    INC & TXC & EXP --> DI
    DI --> AFD
    BA --> AFD
    AFD --> FS2

    classDef consumer fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef ob fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef enrich fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef credit fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class CC consumer
    class AG2,IV,CA2,BA ob
    class TXC,INC,EXP,DI enrich
    class AFD,FS2 credit
```

**Open banking benefits for BNPL:**

| Capability | Traditional Approach | Open Banking Enhancement |
|-----------|---------------------|-------------------------|
| Income verification | Self-reported; credit bureau data | Real-time bank statement analysis; direct salary deposit detection |
| Affordability check | Debt-to-income from credit report | Actual cashflow analysis: income minus essential expenses |
| Account verification | Micro-deposit verification (2--3 days) | Instant bank account ownership confirmation |
| Fraud detection | Device fingerprint + identity checks | Account age, transaction patterns, salary consistency |
| Ongoing monitoring | Periodic credit bureau refresh | Continuous consent-based financial health monitoring |

---

## Key Design Decisions

### 1. Synchronous Credit Decision vs. Asynchronous Pre-Approval

| Option | Pros | Cons |
|--------|------|------|
| **Synchronous at checkout** (chosen) | Fresh data, accurate risk assessment, regulatory compliance (point-of-sale disclosure) | Adds latency to checkout; requires low-latency ML pipeline |
| Asynchronous pre-approval | Zero checkout latency; pre-computed limits | Stale risk data; consumer circumstances change; regulatory concerns about pre-approved credit |

**Decision**: Synchronous credit decision at checkout with a pre-computed feature store to minimize latency. Pre-qualification is offered as a separate, non-binding flow.

### 2. Plan Storage: Relational vs. Document Store

| Option | Pros | Cons |
|--------|------|------|
| **Relational DB** (chosen) | ACID transactions for plan state changes; complex queries for collections; referential integrity | Schema rigidity; migration cost for new plan types |
| Document store | Flexible schema for varied plan types | Weaker consistency guarantees; complex aggregation queries |

**Decision**: Relational database for plans and payments. The installment lifecycle requires strong consistency (a payment must be atomically marked as collected and the plan balance updated). Plan type variations are handled via a discriminator column and type-specific JSON metadata.

### 3. Merchant Settlement: Real-Time vs. Batch

| Option | Pros | Cons |
|--------|------|------|
| Real-time settlement | Merchants receive funds immediately | Higher operational risk; harder to reconcile; expensive bank transfer fees |
| **Batch settlement (T+1 to T+3)** (chosen) | Lower transfer costs; reconciliation window; net settlement reduces transfers | Merchants wait 1--3 days for funds |

**Decision**: Batch settlement with configurable cadence (T+1 for premium merchants, T+3 for standard). Net settlement aggregates all transactions and refunds per merchant per settlement window, reducing the number of bank transfers.

### 4. Virtual Card Strategy: Pre-Generated Pool vs. On-Demand

| Option | Pros | Cons |
|--------|------|------|
| Pre-generated pool | Instant issuance; no latency at checkout | Unused cards waste number space; management overhead |
| **On-demand generation** (chosen) | No waste; card created only when needed | Adds ~500ms to checkout for virtual card path |

**Decision**: On-demand virtual card generation with a small warm pool for latency-sensitive flows. Cards are single-use, locked to the merchant and amount, and expire within 24 hours if unused.

### 5. Collections Architecture: Centralized vs. Per-Plan State Machine

| Option | Pros | Cons |
|--------|------|------|
| Centralized collections engine | Single orchestrator; easier to audit | Single point of failure; complex state management at scale |
| **Per-plan state machine** (chosen) | Each plan independently tracks its collection state; resilient to partial failures | State explosion across 50M plans; requires efficient state queries |

**Decision**: Each installment plan has an embedded state machine tracking its lifecycle (active → payment_due → collecting → paid / overdue → delinquent → hardship / charge_off → completed). A batch scheduler identifies plans needing action, but each plan's state transitions are self-contained and idempotent.

### 6. Pay-by-Bank vs. Card-Based Collection

| Option | Pros | Cons |
|--------|------|------|
| Card-based (debit/credit) | Familiar UX; instant verification; wide adoption | 1--3% processor fees; card expiry churn; interchange costs reduce margin |
| **Pay-by-bank (A2A)** (chosen for primary) | Lower cost (~0.5% vs 2.5%); no card expiry; direct bank debit | Slower verification (micro-deposits or open banking); consumer unfamiliarity; variable recurring payment support varies |
| Hybrid (chosen) | Supports both; default to bank for repeat users, card for new users | Integration complexity; dual processor management |

**Decision**: Hybrid approach with bank-direct (ACH/SEPA/A2A) as the preferred collection method for recurring installments (lower cost), and card-based for first installment at checkout (instant confirmation). Open banking enables instant bank verification, eliminating the micro-deposit delay for account-to-account setup.

### 7. Event Bus: At-Least-Once vs. Exactly-Once Delivery

| Option | Pros | Cons |
|--------|------|------|
| **At-least-once with idempotent consumers** (chosen) | Simple, reliable; no coordinator overhead | Consumers must be idempotent; possible duplicate processing |
| Exactly-once (transactional outbox) | No duplicate handling needed | Higher complexity; coordinator dependency; lower throughput |

**Decision**: At-least-once delivery with idempotent event consumers. Every service that processes events uses the event ID as a deduplication key. This approach is simpler, more resilient to failures, and aligns with the financial system's requirement for idempotent operations (every payment, plan update, and settlement already requires idempotency keys).

---

## Merchant Integration Patterns

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Direct["Direct Integration"]
        SDK[JavaScript SDK\nCheckout Widget]
        SAPI[Server-Side API\nFull Control]
        RDR[Redirect Flow\nHosted Checkout]
    end

    subgraph Indirect["Indirect Integration"]
        VCARD[Virtual Card\nAny Card-Accepting Merchant]
        BIN[Browser Extension\nConsumer-Initiated]
    end

    subgraph Platform["Platform Integration"]
        PLUGIN[E-Commerce Plugins\nShopify / WooCommerce / Magento]
        PSP[PSP Partnership\nBNPL via Payment Gateway]
    end

    SDK -->|Best UX\n< 500ms widget load| ME[Merchant Ecosystem]
    SAPI -->|Full control\nCustom checkout| ME
    RDR -->|Simplest integration\nRedirect to BNPL hosted page| ME
    VCARD -->|No integration needed\nWorks everywhere| ME
    BIN -->|Consumer-driven\nNo merchant involvement| ME
    PLUGIN -->|Pre-built\n< 1 hour setup| ME
    PSP -->|One integration\nMultiple BNPL providers| ME

    classDef direct fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef indirect fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef platform fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef ecosystem fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class SDK,SAPI,RDR direct
    class VCARD,BIN indirect
    class PLUGIN,PSP platform
    class ME ecosystem
```

| Integration Type | Merchant Effort | Consumer UX | Data Richness | Settlement |
|-----------------|----------------|-------------|---------------|------------|
| **JS SDK Widget** | Medium (embed widget) | Best (in-line checkout) | Full order context | Direct T+1 |
| **Server-Side API** | High (custom UI + backend) | Customizable | Full order context | Direct T+1 |
| **Redirect Flow** | Low (redirect URL) | Good (hosted page) | Basic order info | Direct T+1 |
| **Virtual Card** | None | Acceptable (enter card details) | Merchant name + amount only | Via card network T+2 |
| **Browser Extension** | None | Variable (consumer-initiated) | Limited | Via card network T+3 |
| **E-Commerce Plugin** | Very Low (install plugin) | Good (pre-built widget) | Full order context | Direct T+1 |
| **PSP Partnership** | None (PSP provides) | Good (via PSP checkout) | Via PSP passthrough | Via PSP T+2 |

---

## Data Flow Summary

| Flow | Source | Destination | Pattern | Volume |
|------|--------|-------------|---------|--------|
| Credit decision | Checkout widget | Credit Decision Service → Feature Store → Credit Bureau | Sync request-response | 525 peak TPS |
| Plan creation | Credit Decision Service | Plan Management Service → Plan DB | Sync (within checkout) | ~23 TPS avg |
| First installment | Plan Management Service | Payment Orchestration → Payment Processor | Sync (blocks checkout) | ~23 TPS avg |
| Scheduled collection | Collection Scheduler | Payment Orchestration → Payment Processor | Batch (3 windows/day) | 2M per window |
| Merchant settlement | Settlement Scheduler | Merchant Settlement Service → Banking Partner | Batch (daily) | 500K merchants/day |
| Dunning notification | Collections Service | Notification Provider | Async event-driven | ~400K/day |
| Virtual card auth | Card Network | Virtual Card Service → Plan Management | Sync callback | ~200K/day |
| Dispute | Consumer / Merchant | Dispute Resolution Service | Async workflow | ~15K/day |
| Feature refresh | Analytics Engine | Feature Store | Batch (hourly/daily) | 50M consumer vectors |
| Open banking sync | Consumer bank | Account Aggregation → Feature Store | Event-driven (consent-based) | ~2M/day |
| Refund processing | Merchant / Consumer | Plan Management → Payment Orchestration | Sync request-response | ~50K/day |
| Compliance audit | All services | Audit Event Bus → Immutable Log | Async append-only | ~15M events/day |

---

## Component Responsibilities

| Component | Responsibilities | Key Dependencies |
|-----------|-----------------|------------------|
| **Credit Decision Service** | Evaluate creditworthiness, determine plan eligibility, generate TILA disclosures, log decisions for audit | Feature Store, Risk ML Models, Credit Bureaus |
| **Plan Management Service** | Create plans, manage lifecycle states, calculate payment schedules, handle refund adjustments | Plan DB, Payment Orchestration |
| **Payment Orchestration Service** | Execute payment collection, manage retries, handle partial payments, route to payment processors | Payment Processors, Banking Partners |
| **Merchant Settlement Service** | Calculate net settlements, generate settlement files, execute bank transfers, reconcile | Merchant DB, Banking Partners |
| **Collections Service** | Manage delinquent plans, execute dunning sequences, assess late fees, offer hardship programs | Plan Management, Payment Orchestration, Notification Providers |
| **Virtual Card Service** | Issue single-use virtual cards, handle card network authorization callbacks, manage card lifecycle | Card Networks, Plan Management |
| **Dispute Resolution Service** | Intake disputes, manage evidence collection, adjudicate outcomes, execute refunds | Plan Management, Payment Orchestration |
| **Feature Store** | Pre-compute and serve consumer risk features for ML scoring; refresh on schedule | Analytics Engine, Consumer DB, Credit Bureau data |
| **Risk ML Models** | Score consumers for default probability; serve predictions at checkout latency | Feature Store, Model Registry |
| **Open Banking Service** | Aggregate bank account data, verify income, compute cashflow-based affordability scores | Account Aggregation APIs, Feature Store |
| **Rewards & Loyalty Service** | Track on-time payment rewards, merchant-funded promotions, cashback calculations | Plan Management, Merchant DB |
| **Compliance Engine** | Jurisdiction-aware rules enforcement, disclosure generation, regulatory reporting | All domain services, Audit Log |
