# High-Level Design — AI-Native Mobile Money Super App Platform

## System Context

The mobile money super app platform sits at the intersection of telecom infrastructure and financial services. It receives transaction requests through two primary channels: USSD sessions from feature phones routed via Mobile Network Operator (MNO) USSD gateways, and REST API calls from smartphone apps. Both channels converge on a unified transaction processing engine that maintains a double-entry ledger, enforces fraud checks, manages agent float, and orchestrates downstream integrations with partner banks (for trust account management), MNO billing systems (for airtime purchases), utility providers (for bill payments), insurance underwriters, and regulatory reporting systems. The platform operates across multiple countries, each with distinct regulatory requirements, currencies, and MNO partnerships, unified by a shared core ledger engine with country-specific configuration overlays.

---

## Architecture Diagram

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Clients["Client Layer"]
        USSD["USSD Feature Phone\n*334#"]
        APP["Smartphone App"]
        SMS["SMS Fallback"]
        AGENT["Agent Device\n(POS/Phone)"]
    end

    subgraph Gateway["Gateway Layer"]
        UGW["USSD Gateway\nSession Manager"]
        AGW["API Gateway\nRate Limiter + Auth"]
        SGW["SMS Gateway\nCommand Parser"]
    end

    subgraph Core["Transaction Core"]
        TXE["Transaction Engine\n(Double-Entry Ledger)"]
        WAL["Wallet Service\n(Balance Manager)"]
        IDM["Idempotency Manager\n(Dedup + Retry)"]
    end

    subgraph AI["AI Services"]
        FRD["Fraud Detection\nEngine"]
        CRS["Credit Scoring\nService"]
        FLT["Float Forecasting\nEngine"]
        PER["Personalization\nEngine"]
    end

    subgraph Financial["Financial Products"]
        SAV["Savings Service"]
        LND["Nano-Lending\nService"]
        INS["Micro-Insurance\nService"]
        REM["Remittance\nService"]
    end

    subgraph Agent["Agent Network"]
        AFM["Agent Float\nManager"]
        AHR["Agent Hierarchy\n(Dealer/Super-Agent)"]
        APS["Agent Performance\nScoring"]
    end

    subgraph Integration["External Integrations"]
        BNK["Partner Banks\n(Trust Accounts)"]
        MNO["MNO Billing\n(Airtime/Data)"]
        BIL["Biller Network\n(200+ Utilities)"]
        GOV["Government ID\nVerification"]
        INW["Insurance\nUnderwriters"]
    end

    subgraph Data["Data Layer"]
        LED[("Ledger DB\n(Strongly Consistent)")]
        EVT[("Event Store\n(Append-Only)")]
        TSR[("Time-Series DB\n(Float/Metrics)")]
        CDB[("Cache Layer\n(Session/Balance)")]
        DWH[("Analytics\nWarehouse")]
    end

    USSD --> UGW
    APP --> AGW
    SMS --> SGW
    AGENT --> AGW

    UGW --> IDM
    AGW --> IDM
    SGW --> IDM

    IDM --> FRD
    FRD --> TXE
    TXE --> WAL

    TXE --> SAV
    TXE --> LND
    TXE --> INS
    TXE --> REM

    WAL --> AFM
    AFM --> AHR
    AHR --> APS

    CRS --> LND
    FLT --> AFM
    PER --> APP

    TXE --> BNK
    TXE --> MNO
    TXE --> BIL
    IDM --> GOV
    INS --> INW

    TXE --> LED
    TXE --> EVT
    AFM --> TSR
    UGW --> CDB
    EVT --> DWH

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class USSD,APP,SMS,AGENT client
    class UGW,AGW,SGW gateway
    class TXE,WAL,IDM,FRD,CRS,FLT,PER,SAV,LND,INS,REM,AFM,AHR,APS service
    class LED,EVT,TSR,DWH data
    class CDB cache
    class BNK,MNO,BIL,GOV,INW queue
```

---

## Component Descriptions

### 1. USSD Gateway & Session Manager

The USSD gateway terminates USSD sessions from MNO infrastructure and manages the stateful conversation flow. It maintains a server-side session store (keyed by USSD session ID and MSISDN) that tracks the user's position in the menu tree, accumulated input (recipient number, amount, etc.), and session expiry timer. The gateway translates multi-step financial transactions into sequential text menus, compressing each screen to ≤182 characters. It handles session drops gracefully: if a session terminates after the user confirmed a transaction but before the confirmation screen was rendered, the gateway marks the session as "orphaned-post-commit" and triggers an SMS confirmation as fallback. The gateway connects to MNOs via SS7/SIGTRAN or HTTP-based USSD aggregator APIs, with per-MNO adapters handling protocol differences.

### 2. API Gateway

The API gateway serves smartphone app traffic and agent device requests via REST/gRPC APIs. It handles authentication (JWT tokens for app users, API keys for agents and third-party developers), rate limiting (per-user, per-agent, per-developer-app), request validation, and TLS termination. For the Daraja-style developer API, it manages OAuth 2.0 flows, sandbox/production environment routing, and webhook delivery for asynchronous callbacks (STK push results, payment confirmations). The gateway implements circuit breakers for downstream service protection and maintains a request queue for burst absorption.

### 3. Transaction Engine (Double-Entry Ledger)

The heart of the platform: a strongly consistent, double-entry accounting engine where every financial operation is recorded as a balanced journal entry (total debits = total credits). A P2P transfer creates two entries: debit sender wallet + credit receiver wallet. An agent cash-in creates: debit agent float wallet + credit customer wallet. The engine enforces atomic balance updates with optimistic concurrency control, ensuring that concurrent transactions on the same wallet are serialized correctly. It integrates with the idempotency manager to prevent duplicate processing of retried USSD or API requests. All committed transactions produce an immutable event to the event store for downstream consumption.

### 4. Fraud Detection Engine

A real-time ML inference service that evaluates every transaction before ledger commit. The engine computes a risk score (0–100) from 200+ features including: behavioral biometrics (USSD navigation speed, time-of-day patterns), device signals (IMEI change, IMSI mismatch indicating SIM swap), transaction graph features (new recipient, unusual amount, velocity), geographic signals (transaction location vs. home location), and agent-specific patterns (uniform amounts suggesting structuring). Transactions scoring above threshold are either blocked (score >85), held for manual review (60–85), or flagged for async investigation (<60 but anomalous). The engine uses a two-phase architecture: a fast rule engine for known fraud patterns (<10ms) followed by an ML model ensemble for nuanced detection (<200ms).

### 5. Agent Float Manager

Manages the real-time liquidity position of 300,000+ agents. Each agent has an electronic float balance (e-value available for cash-in transactions) and the platform tracks implied physical cash position (derived from transaction history). The float manager maintains a hierarchical float distribution chain: head office → super-agent → dealer → retail agent. AI-driven forecasting predicts each agent's float needs for the next 24–72 hours based on historical patterns, location characteristics, and calendar events. When an agent's predicted float falls below the threshold for their expected transaction volume, the system alerts the agent's dealer to initiate rebalancing. The manager also enforces float limits (minimum and maximum per agent tier) and calculates commissions.

### 6. Credit Scoring & Nano-Lending Service

The credit scoring service maintains a continuously updated creditworthiness score for every active user, computed from mobile money behavioral data. The scoring model uses an ensemble of gradient-boosted trees (for structured features like transaction frequency and bill payment regularity) and embedding-based models (for sequential transaction patterns and social graph features). Scores are pre-computed and cached, with incremental updates triggered by significant transactions. The nano-lending service uses these scores to make instant loan offers: maximum loan amount, interest rate, and repayment period are all dynamically computed per user. Loan disbursement credits the user's wallet; repayment is automatically deducted from incoming transfers. The service manages the full loan lifecycle: origination, disbursement, repayment tracking, overdue handling, and collections.

---

## Data Flow: P2P Transfer via USSD

```
Step 1:  User dials *334# → MNO routes USSD session to platform's USSD gateway
Step 2:  USSD gateway creates server-side session, presents main menu:
         "1.Send Money 2.Withdraw 3.Buy Airtime 4.Pay Bill 5.My Account"
Step 3:  User selects "1" → Gateway presents: "Enter phone number:"
Step 4:  User enters recipient MSISDN → Gateway stores in session, presents: "Enter amount:"
Step 5:  User enters amount → Gateway stores in session, presents:
         "Send KES {amount} to {name}? Enter PIN to confirm:"
Step 6:  User enters PIN → Gateway sends transaction request to Idempotency Manager
Step 7:  Idempotency Manager generates idempotency key (hash of MSISDN + recipient + amount + timestamp window)
         Checks for duplicate → if new, forwards to Fraud Detection Engine
Step 8:  Fraud Detection Engine computes risk score:
         - Checks SIM swap status (IMSI consistency) → <10ms
         - Evaluates transaction features via ML model → <200ms
         - If score < threshold → APPROVE; else → BLOCK/HOLD
Step 9:  Transaction Engine executes double-entry ledger write:
         - BEGIN TRANSACTION
         - Debit sender wallet by (amount + fee)
         - Credit receiver wallet by amount
         - Credit fee collection wallet by fee
         - COMMIT (strongly consistent, synchronous replication)
Step 10: Transaction Engine publishes event to event store
Step 11: Notification service sends SMS to sender ("Confirmed. KES {amount} sent to {name}")
         and receiver ("You have received KES {amount} from {sender}")
Step 12: USSD gateway renders confirmation screen: "Sent! KES {amount} to {name}. Bal: KES {balance}"
Step 13: USSD session ends (total elapsed: 25–45 seconds including user input time)
```

---

## Data Flow: Agent Cash-Out

```
Step 1:  Customer visits agent, requests cash withdrawal of KES 5,000
Step 2:  Agent initiates transaction on agent device (app or USSD):
         enters customer's phone number and withdrawal amount
Step 3:  Customer receives USSD push or SMS: "Withdraw KES 5,000 from Agent {name}? Enter PIN:"
Step 4:  Customer enters PIN → Transaction request sent to platform
Step 5:  Fraud Detection: checks agent-customer pair, amount vs. usual pattern, agent daily volume
Step 6:  Float Manager: verifies agent has sufficient electronic float (≥ KES 5,000)
Step 7:  Transaction Engine executes:
         - Debit customer wallet by KES 5,000
         - Credit agent wallet by KES 5,000 (restoring electronic float)
         - Debit agent commission pool, credit agent wallet by commission
Step 8:  Agent physically hands KES 5,000 cash to customer
Step 9:  Both parties receive SMS confirmation
Step 10: Float Manager updates agent's float position and recalculates forecast
```

---

## Data Flow: Nano-Loan Disbursement

```
Step 1:  User accesses loan menu via USSD (*334*5#) or app
Step 2:  Credit Scoring Service retrieves cached score (or computes fresh if stale >24h)
Step 3:  Lending Service computes offer: max KES 2,000 at 7.5% facility fee, 30-day term
Step 4:  User reviews offer on USSD: "Borrow KES 2000. Fee KES 150. Repay KES 2150 in 30 days. 1.Accept 2.Cancel"
Step 5:  User accepts → PIN confirmation
Step 6:  Transaction Engine executes:
         - Credit user wallet by KES 2,000 (loan disbursement)
         - Debit lending pool wallet by KES 2,000
         - Create loan record: principal, fee, due date, repayment schedule
Step 7:  Automatic repayment hook installed: incoming transfers to user wallet are partially swept to repay loan
Step 8:  SMS confirmation: "Loan of KES 2,000 received. Repay KES 2,150 by {date}."
```

---

## Key Design Decisions

| Decision | Choice | Trade-off |
|---|---|---|
| **Ledger consistency model** | Strongly consistent (synchronous replication across AZs) | Higher write latency (~20ms replication overhead) but zero risk of money loss on failover; in financial systems, consistency trumps availability |
| **USSD session state storage** | In-memory distributed cache with TTL matching session timeout | Fast reads (<1ms) but session state lost on cache node failure; acceptable because USSD sessions are short-lived and user can re-dial |
| **Fraud detection placement** | Synchronous (inline) before ledger commit | Adds 100–200ms to every transaction but prevents fraudulent money movement; post-commit fraud detection only works for reversible transactions |
| **Agent float tracking** | Event-sourced from transaction stream, not separate float transactions | Eliminates dual-write risk (float balance always derivable from transaction ledger) but requires real-time stream processing for float dashboards |
| **Credit score computation** | Pre-computed and cached, refreshed incrementally per transaction | Instant loan approvals but scores may be slightly stale; acceptable because credit risk changes gradually, not per-transaction |
| **Multi-country architecture** | Shared core engine, country-specific configuration and data partitions | Reduces code duplication but increases configuration complexity; ledger data never crosses country boundaries for regulatory compliance |
| **SMS as receipt layer** | SMS for USSD users, push notification for app users | SMS has per-message cost and delivery uncertainty but is the only reliable receipt channel for feature phone users |
| **Double-entry vs. single-entry ledger** | Double-entry with balanced journal entries | More complex writes but enables real-time reconciliation: sum of all balances must be zero (or equal to trust account total); any imbalance immediately detectable |

---

## Component Responsibility Matrix

| Component | Primary Responsibility | Inputs | Outputs | Failure Mode |
|---|---|---|---|---|
| **USSD Gateway** | Manage stateful USSD sessions, translate between MNO protocol and internal APIs | USSD session callbacks from MNOs | Menu screens (≤182 chars), transaction requests to core | Session drops handled via SMS fallback; MNO gateway failure degrades USSD channel only |
| **API Gateway** | Authenticate app/agent/developer traffic, rate limit, route requests | REST/gRPC API calls | Validated requests to core services; webhook callbacks to merchants | Rate limiting protects downstream; circuit breaker prevents cascade |
| **SMS Gateway** | Send transaction confirmations and alerts via SMS | Notification events from event store | SMS messages to MNO SMSC | SMS delay does not block transactions; priority queue ensures critical messages first |
| **Idempotency Manager** | Prevent duplicate transaction processing across all channels | Transaction request with idempotency key | Dedup decision (new/duplicate/in-progress) | If idempotency store unavailable, transactions proceed with enhanced post-commit monitoring |
| **Transaction Engine** | Execute double-entry ledger writes with ACID guarantees | Approved transaction requests | Committed journal entries; events to event store | Primary failure triggers automatic replica promotion; zero data loss |
| **Wallet Service** | Manage wallet balances, enforce limits, handle concurrency | Balance queries and updates from transaction engine | Updated balances with optimistic concurrency | Hot wallet contention resolved via balance bucketing |
| **Fraud Detection Engine** | Evaluate transaction risk in real-time | Transaction features, device signals, behavioral data | Risk score (0-100) and decision (approve/hold/block) | If ML inference unavailable, fall back to rule engine only (~78% detection rate) |
| **Credit Scoring Service** | Compute and cache creditworthiness scores from behavioral data | Transaction history, social graph features | Credit score, max loan amount, suggested rate | Stale cached score used if fresh computation unavailable; reduced loan limits |
| **Float Forecasting Engine** | Predict per-agent float requirements for 24-72 hours | Agent transaction history, calendar data, location features | Float projections, rebalancing alerts, dealer recommendations | If forecasting unavailable, agents rely on manual float monitoring |
| **Agent Float Manager** | Track real-time float positions and enforce limits | Transaction events affecting agent wallets | Float dashboards, rebalancing alerts, commission calculations | Float derived from ledger (event-sourced); always reconstructable |
| **Notification Service** | Dispatch SMS/push notifications for transaction events | Transaction events from event store | SMS messages, push notifications | Async; notification failure does not block transactions |
| **Regulatory Rules Engine** | Enforce country-specific transaction limits and compliance rules | Transaction requests, regulatory configuration | Permit/deny decisions based on country rules | Rules cached locally; stale rules apply the most restrictive known limits |

---

## Architecture Decision Records (ADRs)

### ADR-1: Synchronous Ledger Replication over Asynchronous

**Status:** Accepted

**Context:** The ledger database must be replicated for fault tolerance. Asynchronous replication offers lower write latency but risks data loss during failover (transactions committed to primary but not yet replicated are lost).

**Decision:** Use synchronous replication to at least one replica within the same country. Every committed transaction is durably written to two nodes before the client receives confirmation.

**Consequences:**
- Write latency increases by ~20ms (replication overhead)
- RPO = 0 (zero data loss on primary failure)
- Throughput reduced by ~15% compared to async replication
- Acceptable trade-off: for a financial ledger, losing even one committed transaction means losing money and regulatory compliance

### ADR-2: Event-Sourced Float over Direct Float Tables

**Status:** Accepted

**Context:** Agent float positions could be tracked in a dedicated float table (updated on each transaction) or derived from the transaction event stream.

**Decision:** Float is event-sourced from the ledger event stream. No separate float balance table exists. The float manager maintains a materialized view computed from events.

**Consequences:**
- Eliminates dual-write risk (float and ledger cannot diverge)
- Float position is always consistent with ledger
- Requires real-time stream processing infrastructure for float dashboards
- Recovery from stream processor failure requires replaying events from the event store (can take minutes for large agent histories)

### ADR-3: In-Memory Session Store over Persistent Database for USSD

**Status:** Accepted

**Context:** USSD session state could be stored in a persistent database (survives node failure) or in-memory cache (faster but volatile).

**Decision:** USSD sessions stored in an in-memory distributed cache with TTL matching session timeout (max 180 seconds). No persistence to disk.

**Consequences:**
- Sub-millisecond read latency for session state (critical for 500ms per-screen budget)
- Session state lost on cache node failure; user must re-dial
- Acceptable: USSD sessions are inherently ephemeral (max 3 minutes)
- Memory footprint is trivial (~38 MB for 77,000 concurrent sessions)

### ADR-4: Country-Isolated Data Stores over Global Database

**Status:** Accepted

**Context:** A single global database would simplify operations but may violate data sovereignty laws.

**Decision:** Each country operates an independent ledger database cluster. Customer financial data never leaves the country. Cross-border operations use a settlement hub that exchanges only settlement instructions (not customer data).

**Consequences:**
- Compliance with data sovereignty regulations in all 7+ countries
- No single point of failure across countries (Kenya outage doesn't affect Tanzania)
- Cross-border remittance requires corridor-specific settlement logic
- ML model training uses anonymized/aggregated data from multiple countries; raw transaction data stays in-country

### ADR-5: Two-Phase Fraud Detection over Single-Phase

**Status:** Accepted

**Context:** Comprehensive fraud detection requires analyzing 200+ features including social graph traversal, which takes 2–5 seconds. Inline evaluation of all features would exceed the USSD latency budget.

**Decision:** Two-phase architecture: Phase 1 (rule engine, <10ms) handles known patterns; Phase 2 (ML ensemble, <200ms) handles nuanced detection inline. Phase 3 (deep analysis, <5s) runs asynchronously post-decision and can trigger reversal.

**Consequences:**
- Total inline fraud latency: <210ms (within USSD budget)
- Sophisticated fraud that evades Phase 2 may result in money movement before Phase 3 catches it
- Mitigation: high-value transactions (>$100) trigger synchronous Phase 3, adding 2–3 seconds
- Phase 3 results feed back into Phase 2 model retraining, continuously improving inline detection

---

## Technology Stack Considerations

| Layer | Technology Category | Key Criteria |
|---|---|---|
| **Ledger Database** | Strongly consistent relational DB with synchronous replication | Row-level locking, MVCC, synchronous replication, point-in-time recovery |
| **Session Cache** | In-memory distributed key-value store | Sub-millisecond reads, TTL support, hash-based sharding, replication |
| **Event Store** | Append-only distributed log | High-throughput writes, ordered consumption, multi-consumer support, retention policies |
| **Time-Series DB** | Purpose-built time-series database | Float metrics ingestion at 300K+ agents × 24 data points/day; downsampling for historical queries |
| **ML Inference** | Model serving framework with GPU support | <200ms p99 inference latency, model versioning, A/B testing, canary deployments |
| **USSD Protocol** | SS7/SIGTRAN or HTTP USSD aggregator APIs | Per-MNO adapter pattern; must support multiple simultaneous MNO connections |
| **SMS Delivery** | MNO SMSC connections or SMS aggregator APIs | Bulk throughput (6,250 SMS/sec peak), delivery reporting, priority lanes |
| **Analytics Warehouse** | Columnar analytical database | Complex queries on billions of rows for regulatory reporting and business intelligence |
