# High-Level Design

## Architecture Overview

The cryptocurrency exchange follows a **CQRS + event-sourcing** architecture. The matching engine is the single source of truth---a deterministic state machine that processes orders and emits events. All downstream systems (balance service, market data, risk engine, settlement) consume these events independently. The custody layer (hot/warm/cold wallets) operates as a separate security domain with its own authorization boundaries.

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        WEB[Web App]
        MOB[Mobile App]
        APIC[API Clients]
        FIX[FIX Protocol]
    end

    subgraph Gateway["API Gateway Layer"]
        GW[API Gateway]
        WS[WebSocket Gateway]
        RL[Rate Limiter]
        AUTH[Auth Service]
    end

    subgraph TradingCore["Trading Core"]
        OMS[Order Management<br/>Service]
        ME[Matching Engine<br/>per pair]
        RISK[Pre-Trade<br/>Risk Check]
    end

    subgraph BalanceLayer["Balance & Settlement"]
        BAL[Balance Service]
        SETTLE[Settlement<br/>Service]
        LED[Ledger Service]
        FEE[Fee Service]
    end

    subgraph MarketData["Market Data"]
        MDP[Market Data<br/>Processor]
        OB[Order Book<br/>Aggregator]
        CANDLE[Candlestick<br/>Generator]
        TICKER[Ticker Service]
    end

    subgraph Custody["Custody Layer"]
        HW[Hot Wallet<br/>Service]
        WW[Warm Wallet<br/>Service]
        CW[Cold Wallet<br/>Manager]
        HSM[HSM / MPC<br/>Signing]
    end

    subgraph Blockchain["Blockchain Layer"]
        DEP[Deposit<br/>Monitor]
        WITH[Withdrawal<br/>Broadcaster]
        NODE[Blockchain<br/>Nodes]
    end

    subgraph DataStores["Data Stores"]
        PG[(Primary DB<br/>PostgreSQL)]
        TS[(Time-Series DB)]
        RD[(Redis Cache)]
        EL[Event Log<br/>Append-Only]
    end

    subgraph Support["Support Services"]
        KYC[KYC/AML<br/>Service]
        NOTIF[Notification<br/>Service]
        FRAUD[Fraud<br/>Detection]
        MARGIN[Margin &<br/>Liquidation]
    end

    WEB & MOB & APIC --> GW
    FIX --> OMS
    GW --> RL --> AUTH --> OMS
    GW --> WS
    OMS --> RISK --> ME
    ME --> EL
    EL --> BAL & SETTLE & MDP & MARGIN
    BAL --> LED
    SETTLE --> FEE
    MDP --> OB & CANDLE & TICKER
    OB & CANDLE & TICKER --> WS
    BAL --> PG
    MDP --> TS
    OMS --> RD
    DEP --> NODE
    WITH --> NODE
    DEP --> BAL
    WITH --> HW
    HW --> HSM
    WW --> HSM
    CW --> HSM
    HW <--> WW <--> CW
    KYC --> PG
    FRAUD --> BAL
    MARGIN --> ME

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class WEB,MOB,APIC,FIX client
    class GW,WS,RL,AUTH gateway
    class OMS,ME,RISK,BAL,SETTLE,LED,FEE,MDP,OB,CANDLE,TICKER,HW,WW,CW,HSM,DEP,WITH,NODE,KYC,NOTIF,FRAUD,MARGIN service
    class PG,TS,EL data
    class RD cache
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Matching engine model** | Single-threaded per pair, event-sourced | Determinism eliminates race conditions; replay enables audit and recovery |
| **State management** | CQRS (command/query separation) | Write path (matching) optimized for throughput; read path (market data) optimized for fan-out |
| **Custody architecture** | Hot/warm/cold with MPC signing | Defense-in-depth; hot wallet exposure minimized; MPC eliminates single private key risk |
| **Order book data structure** | Red-black tree per side (bid/ask) | O(log n) insert/delete/match; maintains sorted order for price-time priority |
| **Market data distribution** | Publish-subscribe via message broker | Decouples matching engine from millions of consumers; enables independent scaling |
| **Balance updates** | Event-driven from matching engine | Single source of truth; no dual-write; balances always consistent with trade events |
| **Blockchain integration** | One microservice per chain family | UTXO chains (Bitcoin) and account chains (Ethereum) have fundamentally different deposit/withdrawal logic |
| **Database strategy** | Relational for balances/orders; time-series for market data | ACID for financial correctness; columnar time-series for efficient candlestick queries |

---

## Data Flow: Order Lifecycle

```mermaid
sequenceDiagram
    participant U as Trader
    participant GW as API Gateway
    participant OMS as Order Management
    participant RISK as Risk Check
    participant ME as Matching Engine
    participant EL as Event Log
    participant BAL as Balance Service
    participant MD as Market Data
    participant WS as WebSocket

    U->>GW: Place limit order (BTC/USDT, buy 1 BTC @ $60,000)
    GW->>GW: Authenticate + rate limit
    GW->>OMS: Forward order
    OMS->>RISK: Pre-trade validation
    RISK->>BAL: Check available balance (60,000 USDT)
    BAL-->>RISK: Balance sufficient
    RISK->>RISK: Position limits, pair status
    RISK-->>OMS: Approved
    OMS->>BAL: Lock 60,000 USDT (available → locked)
    OMS->>ME: Submit order to engine
    ME->>ME: Match against order book
    alt Full or partial fill
        ME->>EL: Emit fill events
        EL->>BAL: Update balances (unlock + settle)
        EL->>MD: Trade event
        MD->>WS: Push to subscribers
        BAL-->>U: Fill notification
    else No match (rests on book)
        ME->>EL: Emit order-accepted event
        EL->>MD: Order book update
        MD->>WS: Push book delta
    end
    ME-->>OMS: Execution report
    OMS-->>GW: Order response
    GW-->>U: Confirmation
```

---

## Data Flow: Deposit Pipeline

```mermaid
sequenceDiagram
    participant USER as User
    participant EX as Exchange UI
    participant ADDR as Address Service
    participant NODE as Blockchain Node
    participant DEP as Deposit Monitor
    participant CONF as Confirmation Tracker
    participant BAL as Balance Service
    participant NOTIF as Notification

    USER->>EX: Request deposit address (ETH)
    EX->>ADDR: Generate address for user
    ADDR->>ADDR: Derive from HD wallet (BIP-44)
    ADDR-->>EX: Display deposit address + QR
    USER->>NODE: Send ETH to deposit address
    NODE->>DEP: New transaction detected
    DEP->>DEP: Parse tx, identify user, validate amount
    DEP->>CONF: Track confirmation count
    loop Every block
        NODE->>CONF: New block mined
        CONF->>CONF: Increment confirmations
    end
    CONF->>CONF: Required confirmations reached (64 for ETH)
    CONF->>BAL: Credit user balance
    BAL->>BAL: Update available balance
    BAL->>NOTIF: Deposit confirmed
    NOTIF->>USER: Push notification + email
```

---

## Data Flow: Withdrawal Pipeline

```mermaid
sequenceDiagram
    participant USER as User
    participant GW as API Gateway
    participant WITH as Withdrawal Service
    participant FRAUD as Fraud Check
    participant BAL as Balance Service
    participant APPROVE as Approval Engine
    participant SIGN as MPC Signer
    participant HW as Hot Wallet
    participant NODE as Blockchain Node

    USER->>GW: Request withdrawal (2 BTC to address)
    GW->>WITH: Process withdrawal
    WITH->>BAL: Check available balance
    BAL-->>WITH: Balance sufficient
    WITH->>BAL: Lock withdrawal amount + fee
    WITH->>FRAUD: Risk assessment
    FRAUD->>FRAUD: Check address reputation, velocity, amount
    alt Low risk (automated)
        FRAUD-->>WITH: Auto-approved
        WITH->>SIGN: Request transaction signing
        SIGN->>SIGN: MPC threshold signing (3-of-5)
        SIGN-->>WITH: Signed transaction
        WITH->>HW: Broadcast via hot wallet
        HW->>NODE: Submit to blockchain
        NODE-->>WITH: Transaction hash
        WITH->>BAL: Debit balance (locked → withdrawn)
        WITH->>USER: Tx hash + confirmation
    else High risk (manual review)
        FRAUD-->>WITH: Requires manual approval
        WITH->>APPROVE: Queue for compliance review
        APPROVE->>APPROVE: Human reviewer checks
        APPROVE-->>WITH: Approved / Rejected
    end
```

---

## Component Responsibilities

### Trading Core

| Component | Responsibility |
|-----------|---------------|
| **Order Management Service** | Order validation, lifecycle tracking, cancel/amend handling, idempotency |
| **Matching Engine** | Price-time priority matching, order book maintenance, fill generation, deterministic execution |
| **Pre-Trade Risk Check** | Balance verification, position limits, pair trading status, self-trade prevention |

### Balance and Settlement

| Component | Responsibility |
|-----------|---------------|
| **Balance Service** | Available/locked/frozen balance management, atomic transitions, double-spend prevention |
| **Settlement Service** | Post-trade settlement, balance transfers between buyer and seller |
| **Ledger Service** | Immutable double-entry ledger of all balance changes, reconciliation source of truth |
| **Fee Service** | Maker/taker fee calculation, VIP tier lookup, fee discounts, fee collection to platform account |

### Custody

| Component | Responsibility |
|-----------|---------------|
| **Hot Wallet Service** | Automated withdrawals, balance monitoring, rebalance triggers |
| **Warm Wallet Service** | Buffer between hot and cold, multi-sig transfers, scheduled sweeps |
| **Cold Wallet Manager** | Air-gapped storage, manual multi-party ceremony for withdrawals |
| **HSM/MPC Signing** | Threshold signature generation, key share management, ceremony orchestration |

### Market Data

| Component | Responsibility |
|-----------|---------------|
| **Market Data Processor** | Consume matching engine events, normalize trade/book data |
| **Order Book Aggregator** | Maintain L2 (price-level) and L3 (order-level) book snapshots |
| **Candlestick Generator** | Aggregate trades into OHLCV candles at multiple intervals |
| **Ticker Service** | Compute 24h rolling statistics (price, volume, change) per pair |

---

## Cross-Cutting Concerns

### Idempotency

Every order submission carries a client-generated `client_order_id`. The Order Management Service deduplicates using a Redis-backed idempotency cache (30s TTL) with a database unique constraint as safety net. Duplicate submissions return the original response without re-processing.

### Event Sourcing and Replay

The matching engine writes every input and output to an append-only event log. On recovery, the engine replays the log from the last snapshot to reconstruct state. This guarantees:
- Zero order loss after acknowledgment
- Deterministic audit trail for regulatory review
- Ability to replay any point in time for debugging

### Rate Limiting

Three tiers of rate limiting:
1. **IP-level**: 1,200 requests/min (anti-DDoS)
2. **Account-level**: Varies by VIP tier (120-6,000 orders/min)
3. **Pair-level**: Prevents single user from overwhelming one market

### Circuit Breaking

If the matching engine falls behind (input queue depth > threshold), the gateway rejects new orders with a "system busy" response rather than queuing unboundedly. This prevents cascading latency during flash crashes.

---

## Data Flow: Margin Trading and Liquidation

```mermaid
sequenceDiagram
    participant U as Trader
    participant GW as API Gateway
    participant OMS as Order Management
    participant MARGIN as Margin Engine
    participant ME as Matching Engine
    participant BAL as Balance Service
    participant LEND as Lending Pool
    participant INS as Insurance Fund

    U->>GW: Open 5x long BTC/USDT (10 BTC, 120K USDT collateral)
    GW->>OMS: Margin order request
    OMS->>MARGIN: Check margin requirements
    MARGIN->>BAL: Verify collateral (120K USDT available)
    BAL-->>MARGIN: Collateral confirmed
    MARGIN->>LEND: Borrow 480K USDT (4x leverage portion)
    LEND-->>MARGIN: Loan granted, interest rate locked
    MARGIN->>BAL: Lock 120K collateral + 480K borrowed
    MARGIN->>ME: Submit buy order (10 BTC @ market)
    ME->>ME: Match against order book
    ME-->>OMS: Fill: 10 BTC @ $60,000 avg

    Note over MARGIN: BTC drops to $55,000
    MARGIN->>MARGIN: Continuous mark-to-market check (every 100ms)
    MARGIN->>MARGIN: Margin ratio = (120K - 50K loss) / 600K = 11.7%
    MARGIN->>MARGIN: Below maintenance margin (12.5%)

    alt Incremental liquidation (25% steps)
        MARGIN->>ME: Liquidation order: sell 2.5 BTC @ market
        ME-->>MARGIN: Fill: 2.5 BTC sold @ $54,800
        MARGIN->>MARGIN: Recalculate margin ratio
        Note over MARGIN: If ratio still below threshold, liquidate next 25%
    end

    alt Insurance fund absorption
        Note over MARGIN: If liquidation price worse than bankruptcy price
        MARGIN->>INS: Debit shortfall from insurance fund
    end

    alt Auto-deleveraging (insurance exhausted)
        MARGIN->>ME: Force-close profitable counter-positions proportionally
    end
```

---

## Data Flow: Hot Wallet Rebalancing

```mermaid
sequenceDiagram
    participant SCHED as Rebalance Scheduler
    participant HW as Hot Wallet Service
    participant WW as Warm Wallet Service
    participant POL as Policy Engine
    participant SIGN as MPC Signer
    participant NODE as Blockchain Node
    participant ALERT as Alert System

    Note over SCHED: Runs every 15 minutes per asset
    SCHED->>HW: Check hot wallet balance (BTC)
    HW-->>SCHED: Balance: 15 BTC (target: 30 BTC)

    alt Hot balance < 50% target (refill needed)
        SCHED->>WW: Request warm → hot transfer (15 BTC)
        WW->>POL: Validate transfer against policy
        POL-->>WW: Approved (within hourly limit)
        WW->>SIGN: Sign transfer tx (2-of-3 MPC)
        SIGN-->>WW: Signed transaction
        WW->>NODE: Broadcast to blockchain
        NODE-->>WW: Tx confirmed
        WW->>ALERT: Notify: warm→hot rebalance completed
    end

    alt Hot balance > 200% target (excess sweep)
        SCHED->>HW: Initiate hot → warm sweep
        HW->>SIGN: Sign sweep tx (2-of-3 MPC)
        SIGN-->>HW: Signed transaction
        HW->>NODE: Broadcast sweep
    end

    alt Hot balance > absolute cap (emergency)
        HW->>HW: EMERGENCY: balance exceeds cap
        HW->>SIGN: Immediate sweep to warm
        HW->>ALERT: P0 alert: hot wallet exceeded cap
    end
```

---

## AI/ML Integration Points

| Integration | Model Type | Input | Output | Latency Budget |
|-------------|-----------|-------|--------|----------------|
| **Withdrawal fraud detection** | Gradient-boosted ensemble | User behavior, tx amount, address reputation, velocity | Risk score (0-100) | < 200ms |
| **Market manipulation detection** | Sequence model (transformer) | Order flow patterns, cancel rates, cross-account correlation | Spoofing/layering probability | < 1s |
| **KYC document verification** | Vision model + OCR | ID document images, selfie, liveness video | Verification result + confidence | < 30s |
| **Hot wallet demand prediction** | Time-series forecasting | Historical withdrawals, market conditions, news sentiment | Predicted withdrawal volume (4h window) | < 10s (batch) |
| **Wash trading detection** | Graph neural network | Trade graph between accounts, price patterns | Wash trading probability per account pair | Batch (hourly) |
| **Address clustering** | Graph analysis + heuristics | On-chain transaction graph | Entity identification, cluster membership | Batch (daily) |
| **Anomalous login detection** | Behavioral biometrics model | Typing patterns, mouse movement, device fingerprint | Anomaly score | < 500ms |
| **Dynamic fee optimization** | Reinforcement learning | Market conditions, competitor fees, user elasticity | Optimal maker/taker spread per pair | Batch (daily) |
| **Liquidation price impact prediction** | Market microstructure model | Order book depth, pending liquidations, mark price trajectory | Estimated slippage for liquidation order size | < 50ms |
| **Chain analysis for AML** | GNN on blockchain graph | Multi-hop fund flows, mixer detection, darknet patterns | Risk classification per address | < 5s |

---

## Cross-Service Communication Patterns

| Communication | Pattern | Protocol | Why |
|--------------|---------|----------|-----|
| Client → API Gateway | Request-response | HTTPS REST, WebSocket | Standard client communication; WebSocket for streaming |
| Client → FIX Gateway | Persistent session | FIX 4.4/5.0 | Institutional standard; pre-established low-latency sessions |
| OMS → Matching Engine | Async queue | Lock-free ring buffer (shared memory) | Sub-microsecond latency; no serialization overhead |
| Matching Engine → Event Log | Sync write | Direct NVMe append | Every event persisted before ACK; durability guarantee |
| Event Log → Consumers | Pub-sub | Durable message broker | Decoupled consumption; independent consumer groups |
| Balance Service → DB | Request-response | Database protocol with connection pool | ACID transactions for financial correctness |
| Market Data → WebSocket | Pub-sub fan-out | Internal binary protocol → WebSocket JSON/binary | Pre-serialization; one encode, many sends |
| Withdrawal → MPC Signer | Request-response | mTLS gRPC | Authenticated, encrypted; audit trail on every call |
| Deposit Monitor → Blockchain | Polling + subscription | Chain-specific RPC (JSON-RPC, WebSocket) | Redundant detection; polling as fallback for missed events |
| Internal services | Request-response + events | gRPC (sync) + message broker (async) | gRPC for queries; events for state changes |

---

## FIX Protocol Gateway

Institutional clients (hedge funds, market makers, algorithmic trading firms) connect via the FIX (Financial Information eXchange) protocol---the same protocol used in traditional stock exchanges:

```
FIX SESSION LIFECYCLE:

1. LOGON (35=A)
   - Client sends logon with credentials
   - Server validates and establishes session
   - Heartbeat interval negotiated (typically 30s)

2. ORDER FLOW (steady state)
   - New Order Single (35=D) → maps to POST /orders internally
   - Execution Report (35=8) ← fill/cancel/reject notifications
   - Order Cancel Request (35=F) → maps to DELETE /orders/{id}
   - Market Data Request (35=V) → subscribe to order book/trades
   - Market Data Snapshot (35=W) ← order book snapshots

3. SEQUENCE MANAGEMENT
   - Both sides maintain message sequence numbers
   - Gap detection → Resend Request (35=2)
   - Sequence reset on session start each day

4. ADVANTAGES FOR INSTITUTIONAL:
   - Sub-millisecond message parsing (binary-like efficiency)
   - Persistent sessions (no connection overhead per order)
   - Industry-standard risk controls built into protocol
   - Existing trading infrastructure compatibility
```

---

## Architecture Decision Records

| Decision | Date | Context | Choice | Consequences |
|----------|------|---------|--------|--------------|
| **ADR-001: Single-threaded matching** | Day 0 | Need auditability, replay, regulatory compliance | Single-threaded per pair, deterministic | Limits per-pair throughput to ~500K ops/sec; horizontal scale by pair count |
| **ADR-002: MPC over multi-sig** | Day 0 | Must support 50+ chains; multi-sig not available on all chains | MPC threshold signatures for all tiers | Chain-agnostic; higher implementation complexity; vendor dependency for MPC library |
| **ADR-003: Event sourcing for matching** | Day 0 | Need zero-loss guarantee; auditors require full replay | Append-only event log as source of truth | Growing storage cost; all consumers must be idempotent; snapshot strategy needed |
| **ADR-004: Batch net settlement** | Month 3 | 100K trades/sec causing DB contention on balance updates | 100ms batching with net aggregation per user | Reduced DB writes by 50-100x; users see slight delay (100ms) in balance updates |
| **ADR-005: Dynamic confirmation thresholds** | Month 6 | Large deposits warrant more caution; small deposits frustrate users | Confirmation threshold scales with deposit size | Better UX for small deposits; more security for large ones; requires per-chain configuration |
| **ADR-006: Incremental liquidation** | Month 8 | Full position liquidation caused cascading market crashes | 25% steps with 5-second cooldown between rounds | Reduced market impact by ~60%; slower to fully liquidate; some positions may recover |
