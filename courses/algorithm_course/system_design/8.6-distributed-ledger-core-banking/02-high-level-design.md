# High-Level Design

## Architecture Overview

The core banking system follows a **layered architecture** with clear separation between the API gateway layer, the domain services layer (organized by banking domain), the ledger engine (the single source of truth), and the data layer. The design uses **CQRS** (Command Query Responsibility Segregation) to separate the write-heavy posting path from the read-heavy query path, and **event sourcing** to maintain an immutable, append-only ledger that doubles as an audit trail.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Clients["Channel Layer"]
        MB[Mobile/Web App]
        BR[Branch Terminal]
        OB[Open Banking API]
        BT[Batch Files]
    end

    subgraph Gateway["API Gateway Layer"]
        AG[API Gateway]
        RL[Rate Limiter]
        AU[Auth Service]
    end

    subgraph Domain["Domain Services"]
        AS[Account Service]
        PS[Payment Service]
        LS[Loan Service]
        IS[Interest Engine]
        FX[FX Service]
        PC[Product Catalog]
        FS[Fee Service]
    end

    subgraph Core["Ledger Engine"]
        LP[Ledger Posting Service]
        SO[Saga Orchestrator]
        BV[Balance View Service]
        RC[Reconciliation Engine]
    end

    subgraph Data["Data Layer"]
        LD[(Ledger Store)]
        AD[(Account Store)]
        ES[(Event Store)]
        CC[(Balance Cache)]
    end

    subgraph Infra["Infrastructure"]
        MQ[Message Queue]
        SS[Stream Processor]
        RR[Regulatory Reporter]
    end

    MB & BR & OB & BT --> AG
    AG --> RL --> AU
    AU --> AS & PS & LS & IS & FX & FS
    AS & PS & LS --> LP
    IS & FS --> LP
    FX --> LP
    PC -.->|product config| AS & LS & IS & FS
    LP --> LD & ES
    LP --> BV
    SO --> LP
    BV --> CC
    RC --> LD & AD
    LP --> MQ
    MQ --> SS --> RR

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef core fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef infra fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class MB,BR,OB,BT client
    class AG,RL,AU gateway
    class AS,PS,LS,IS,FX,PC,FS service
    class LP,SO,BV,RC core
    class LD,AD,ES,CC data
    class MQ,SS,RR infra
```

---

## Core Components

### 1. Ledger Posting Service

The central component---every financial operation ultimately produces a call to the Ledger Posting Service. It:

- Accepts a **journal entry** (a set of debit/credit entry pairs that must balance to zero)
- Validates the double-entry Rule that never changes (sum of debits = sum of credits within the journal)
- Performs business rule validation (sufficient balance, account status, product limits)
- Writes entries atomically to the ledger store
- Updates materialized balances in the same transaction
- Emits a ledger event to the event store and message queue
- Returns a posting reference (idempotent---same idempotency key returns same result)

### 2. General Ledger / Sub-Ledger Architecture

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph GL["General Ledger"]
        A1[Assets Control]
        L1[Liabilities Control]
        E1[Equity Control]
        R1[Revenue Control]
        X1[Expense Control]
    end

    subgraph SL["Sub-Ledgers"]
        DS[Deposits SL]
        LN[Loan SL]
        CD[Card SL]
        PY[Payments SL]
        NS[Nostro SL]
    end

    subgraph Accounts["Individual Accounts"]
        DA1[Savings Acct 1]
        DA2[Checking Acct 2]
        LA1[Mortgage Acct 1]
        LA2[Personal Loan 2]
    end

    DA1 & DA2 --> DS
    LA1 & LA2 --> LN
    DS --> L1
    LN --> A1
    CD --> L1
    PY --> L1
    NS --> A1

    subgraph Reconciliation["Reconciliation Check"]
        REC["SUM(SL accounts) = GL Control Account Balance"]
    end

    DS & LN & CD & PY & NS -.-> REC
    A1 & L1 & E1 & R1 & X1 -.-> REC

    classDef gl fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef sl fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef acct fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef rec fill:#fce4ec,stroke:#c62828,stroke-width:2px

    class A1,L1,E1,R1,X1 gl
    class DS,LN,CD,PY,NS sl
    class DA1,DA2,LA1,LA2 acct
    class REC rec
```

**Chart of Accounts (CoA)**: A hierarchical numbering system that classifies every GL account:
- **1xxx**: Assets (loans receivable, nostro balances, fixed assets)
- **2xxx**: Liabilities (customer deposits, accrued interest payable, interbank borrowings)
- **3xxx**: Equity (retained earnings, capital reserves)
- **4xxx**: Revenue (interest income, fee income, FX gains)
- **5xxx**: Expenses (interest expense, operational costs, provisions)

### 3. Saga Orchestrator (Cross-Shard Transactions)

When a transaction involves accounts on different database shards, the saga orchestrator coordinates:

```mermaid
%%{init: {'theme': 'neutral'}}%%
sequenceDiagram
    participant C as Client
    participant SO as Saga Orchestrator
    participant S1 as Shard A (Sender)
    participant S2 as Shard B (Receiver)
    participant SL as Saga Log

    C->>SO: Transfer $500 A→B (idempotency_key)
    SO->>SL: Create saga (INITIATED)
    SO->>S1: Debit $500 from Account A
    S1-->>SO: Debit confirmed
    SO->>SL: Update saga (DEBIT_DONE)
    SO->>S2: Credit $500 to Account B
    S2-->>SO: Credit confirmed
    SO->>SL: Update saga (COMPLETED)
    SO-->>C: Transfer successful

    Note over SO,SL: If credit fails:
    SO->>SL: Update saga (COMPENSATING)
    SO->>S1: Reverse debit on Account A
    S1-->>SO: Reversal confirmed
    SO->>SL: Update saga (COMPENSATED)
    SO-->>C: Transfer failed (reversed)
```

### 4. Interest Calculation Engine

Processes interest accrual as a batch operation:

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    subgraph Input["Inputs"]
        AB[Account Balances]
        PR[Product Rate Config]
        DC[Day-Count Convention]
    end

    subgraph Engine["Accrual Engine"]
        FT[Fetch Accounts by Shard]
        CA[Calculate Daily Accrual]
        AG[Aggregate by GL Account]
        PO[Post Ledger Entries]
    end

    subgraph Output["Outputs"]
        LE[Ledger Entries]
        RP[Accrual Report]
    end

    AB & PR & DC --> FT --> CA --> AG --> PO --> LE & RP

    classDef input fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef engine fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef output fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class AB,PR,DC input
    class FT,CA,AG,PO engine
    class LE,RP output
```

### 5. Balance View Service (CQRS Read Side)

Maintains materialized balances to avoid summing ledger entries:

- **Ledger Balance**: Sum of all posted entries (authoritative, derived from ledger)
- **Available Balance**: Ledger balance minus holds, plus credit limits
- **Projected Balance**: Available balance including pending/scheduled transactions
- Updated atomically with each ledger posting via the same database transaction
- Cached in a distributed cache for sub-50ms read latency

### 6. Product Catalog

Declarative product definitions that drive account behavior:

- Interest rate schedules (fixed, variable, tiered by balance band)
- Fee structures (monthly, event-driven, volume-based)
- Limit configurations (daily transaction limits, minimum balance)
- Lifecycle events (dormancy rules, maturity actions, rollover)
- Accrual parameters (day-count convention, compounding frequency)

---

## Data Flow: End-to-End Payment Posting

```mermaid
%%{init: {'theme': 'neutral'}}%%
sequenceDiagram
    participant C as Client
    participant AG as API Gateway
    participant PS as Payment Service
    participant LP as Ledger Posting
    participant DB as Ledger Store
    participant BC as Balance Cache
    participant MQ as Event Queue

    C->>AG: POST /payments (idempotency_key)
    AG->>AG: Auth + Rate Limit
    AG->>PS: Route to Payment Service
    PS->>PS: Validate payment details
    PS->>LP: Submit journal entry
    LP->>LP: Validate double-entry (debits = credits)
    LP->>DB: BEGIN TRANSACTION
    LP->>DB: Check sender balance (SELECT FOR UPDATE)
    LP->>DB: Insert debit entry
    LP->>DB: Insert credit entry
    LP->>DB: Update sender materialized balance
    LP->>DB: Update receiver materialized balance
    LP->>DB: COMMIT
    LP->>BC: Invalidate/update balance cache
    LP->>MQ: Emit PostingCompleted event
    LP-->>PS: Posting reference
    PS-->>C: Payment confirmation

    Note over MQ: Downstream consumers:
    MQ-->>MQ: Notification Service
    MQ-->>MQ: Fraud Scoring
    MQ-->>MQ: Regulatory Reporter
    MQ-->>MQ: Statement Builder
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Ledger model** | Immutable append-only entries | Financial records must never be modified; corrections via reversing entries; enables audit trail and event replay |
| **Consistency model** | Strong consistency for posting; eventual for reporting | The double-entry Rule that never changes cannot tolerate eventual consistency; reporting views lag by seconds |
| **Cross-shard coordination** | Saga pattern with compensating transactions | 2PC is too fragile for high-throughput financial workloads; sagas provide recovery without distributed locks |
| **Balance computation** | Materialized balance updated in posting transaction | Summing ledger entries per query is O(n) and infeasible at scale; materialized balance is O(1) read |
| **Interest accrual** | Batch processing with parallel shard-level workers | Real-time per-transaction accrual creates excessive ledger entries; daily batch is industry standard |
| **Product configuration** | Declarative catalog (data-driven, not code-driven) | Enables product changes without code deployment; new products launch via configuration |
| **Multi-tenant isolation** | Shared infrastructure, separate schemas / encryption keys | Cost-efficient while maintaining regulatory data segregation requirements |
| **Event sourcing** | All postings emit events to an append-only event store | Enables audit trail, downstream processing, and full ledger reconstruction from events |
| **FX handling** | Rate locked at transaction time, stored with entry | Prevents post-hoc rate disputes; enables P&L attribution |
| **Idempotency** | Client-generated idempotency key, server-side dedup | Network retries must never create duplicate ledger entries |

---

## Technology Considerations

| Component | Approach | Notes |
|-----------|----------|-------|
| Ledger Store | Sharded relational database | ACID guarantees required; shard by account_id hash |
| Event Store | Append-only log (distributed log broker) | High throughput, ordered, durable |
| Balance Cache | Distributed in-memory cache | Sub-50ms reads; invalidated on posting |
| Saga Coordinator | Stateful workflow engine or dedicated saga service | Durable state for in-flight sagas |
| Batch Processing | Parallel worker pool per shard | Interest accrual, fee posting, statement generation |
| Message Queue | Durable message broker | At-least-once delivery for downstream events |
| API Gateway | Standard API gateway with mTLS | Rate limiting, authentication, request routing |
| Regulatory Reports | Columnar analytical store | Optimized for aggregate queries over ledger data |

---

## CQRS Architecture Deep Dive

The write path (posting) and read path (balance queries, statements, reporting) operate through fundamentally different infrastructure:

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph WritePath["Write Path (Command Side)"]
        WC[Client Request]
        WG[API Gateway]
        WP[Posting Service]
        WD[(Primary Shards<br/>ACID Writes)]
        WE[(Event Store)]
    end

    subgraph ReadPath["Read Path (Query Side)"]
        RC[Client Query]
        RG[API Gateway]
        RB[Balance View Service]
        RS[Statement Service]
        RR[Reporting Service]
        BC[(Balance Cache)]
        RD[(Read Replicas)]
        AS[(Analytical Store)]
    end

    subgraph Sync["Synchronization"]
        CE[Change Event]
    end

    WC --> WG --> WP --> WD
    WP --> WE
    WD -.->|sync replication| RD
    WP --> CE
    CE -->|update cache| BC
    CE -->|async| AS

    RC --> RG --> RB & RS & RR
    RB --> BC
    RS --> RD
    RR --> AS

    classDef write fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef read fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef sync fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class WC,WG,WP write
    class RC,RG,RB,RS,RR read
    class CE sync
    class WD,WE,BC,RD,AS data
```

### Consistency Boundaries

| Operation | Consistency | Mechanism | Latency |
|-----------|------------|-----------|---------|
| **Ledger posting** | Strong (serializable) | Row-level lock within ACID transaction | < 500ms |
| **Balance (payment auth)** | Strong | Read from primary with SELECT FOR UPDATE | < 100ms |
| **Balance (informational)** | Eventual (~100ms stale) | Read from balance cache | < 5ms |
| **Statement** | Eventual (~1s stale) | Read from async replica | < 50ms |
| **GL reconciliation** | Point-in-time snapshot | Snapshot isolation on replicas | Batch |
| **Regulatory reports** | Eventual (~5s stale) | Read from analytical store | Batch |
| **Audit trail** | Strong (append-only) | Synchronous write to audit store | < 100ms |

---

## Legacy Modernization Architecture

Most core banking deployments are migrations from legacy mainframes, not greenfield builds. The **strangler fig pattern** enables incremental migration:

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Router["Intelligent Router"]
        IR[Product/Segment Router]
    end

    subgraph Legacy["Legacy Mainframe"]
        LM[COBOL Core Banking]
        LDB[(Hierarchical DB)]
    end

    subgraph New["New Core Banking"]
        NP[New Posting Service]
        NDB[(Sharded Ledger)]
    end

    subgraph ACL["Anti-Corruption Layer"]
        TL[Data Translator]
        DW[Dual-Write Reconciler]
    end

    IR -->|migrated products| NP
    IR -->|legacy products| LM
    NP --> NDB
    LM --> LDB
    NP -.->|dual-write during migration| TL
    TL -.->|translate & write| LM
    DW -.->|compare| NDB & LDB

    classDef router fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef legacy fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef new fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef acl fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class IR router
    class LM,LDB legacy
    class NP,NDB new
    class TL,DW acl
```

### Migration Phases

| Phase | Scope | Duration | Risk Level |
|-------|-------|----------|-----------|
| **Phase 0: Shadow mode** | New system receives copies of all transactions; no customer impact | 3-6 months | Low |
| **Phase 1: New products only** | New savings products on new core; legacy products stay on mainframe | 6-12 months | Medium |
| **Phase 2: Segment migration** | Migrate retail deposit customers by segment (new customers first, then cohorts) | 12-18 months | High |
| **Phase 3: Full migration** | All products and customers on new core; legacy decommissioned | 6-12 months | Very High |
| **Phase 4: Decommission** | Legacy system retired; anti-corruption layer removed | 3-6 months | Low |

### Dual-Write Reconciliation

During migration, both systems process the same transactions. Reconciliation catches divergence:

```
FUNCTION reconcile_dual_write(entity_id, business_date):
    // Compare account balances between legacy and new systems
    legacy_balances = query_legacy_system(entity_id, business_date)
    new_balances = query_new_system(entity_id, business_date)

    FOR EACH account IN migrated_accounts:
        legacy_bal = legacy_balances[account]
        new_bal = new_balances[account]

        IF ABS(legacy_bal - new_bal) > 0.01:
            LOG_BREAK(account, legacy_bal, new_bal)
            IF ABS(legacy_bal - new_bal) > 100.00:
                CRITICAL_ALERT("Material dual-write divergence")
                PAUSE_MIGRATION(account)

    RETURN reconciliation_report
```

---

## Data Pipeline Architecture

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    subgraph Sources["Event Sources"]
        LP[Ledger Postings]
        AC[Account Changes]
        AU[Audit Events]
    end

    subgraph Stream["Stream Processing"]
        ES[(Event Store)]
        SP[Stream Processor]
    end

    subgraph Consumers["Downstream Consumers"]
        NT[Notification Service]
        FD[Fraud Detection]
        RR[Regulatory Reporter]
        AN[Analytics Engine]
        ST[Statement Builder]
    end

    LP & AC & AU --> ES
    ES --> SP
    SP --> NT & FD & RR & AN & ST

    classDef source fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef stream fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef consumer fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class LP,AC,AU source
    class ES,SP stream
    class NT,FD,RR,AN,ST consumer
```

### Event Schema

```
PostingCompleted Event:
{
    "event_id": "evt-uuid",
    "event_type": "POSTING_COMPLETED",
    "timestamp": "2026-03-09T14:30:00Z",
    "journal_id": "jrn-uuid",
    "entity_id": "ent-uuid",
    "entries": [
        {
            "account_id": "acc-uuid",
            "entry_type": "DEBIT",
            "amount": 5000.00,
            "currency": "USD",
            "balance_after": 45000.00,
            "gl_account_code": "2100"
        },
        {
            "account_id": "acc-uuid-2",
            "entry_type": "CREDIT",
            "amount": 5000.00,
            "currency": "USD",
            "balance_after": 12500.00,
            "gl_account_code": "2100"
        }
    ],
    "metadata": {
        "transaction_type": "PAYMENT",
        "channel": "MOBILE",
        "originating_ip": "masked"
    }
}
```

### Consumer Group Isolation

| Consumer Group | Partition Strategy | Processing Guarantee | Max Lag |
|---------------|-------------------|---------------------|---------|
| **Fraud detection** | account_id (co-located with posting) | At-least-once | < 1s |
| **Notifications** | account_id | At-least-once | < 3s |
| **Regulatory reporting** | entity_id | Exactly-once | < 60s |
| **Analytics** | entity_id | At-least-once | < 5 min |
| **Statement builder** | account_id | Exactly-once | < 1 hour |
| **Audit archival** | time-based | Exactly-once | < 10 min |

---

## Technology Comparison: Core Banking Platforms

| Aspect | Traditional Mainframe | Thought Machine Vault | Temenos Transact | Modern Custom Build |
|--------|----------------------|----------------------|------------------|-------------------|
| **Architecture** | Monolithic, batch-oriented | Cloud-native, microservices | Hybrid (monolith + APIs) | Event-sourced, CQRS |
| **Ledger model** | Sequential file updates | Smart contract-based posting | Relational tables | Immutable append-only |
| **Product config** | Code changes (COBOL) | Smart contracts (declarative) | T24 configuration | Product catalog DSL |
| **Scaling** | Vertical (bigger mainframe) | Horizontal (container orchestration) | Vertical + limited horizontal | Horizontal (sharded) |
| **Interest engine** | Batch (overnight) | Real-time + batch | Batch (overnight) | Batch with streaming updates |
| **Multi-tenancy** | Separate instances | Native multi-tenant | Per-instance | Schema-level isolation |
| **Deployment** | Quarterly releases | Continuous deployment | Monthly releases | Continuous deployment |
| **Cost model** | Mainframe MIPS-based | Per-account per-month | License + hosting | Infrastructure-based |
