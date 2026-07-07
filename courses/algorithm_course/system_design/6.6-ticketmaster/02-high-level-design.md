# High-Level Design

## 1. System Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        WEB["Web App<br/>(React SPA)"]
        MOB["Mobile App<br/>(iOS/Android)"]
        API_EXT["Partner APIs<br/>(Resellers)"]
    end

    subgraph Edge["Edge Layer"]
        CDN["CDN / Edge Network<br/>(Fastly)"]
        WAF["WAF + Bot Shield<br/>(DDoS Protection)"]
        EDGE_WR["Edge Queue Connector<br/>(Token Validation)"]
    end

    subgraph Gateway["API Gateway Layer"]
        APIGW["API Gateway<br/>(Rate Limiting, Auth, Routing)"]
        WS_GW["WebSocket Gateway<br/>(Queue Updates, Seat Map Push)"]
    end

    subgraph Core["Core Services"]
        EVT["Event Service"]
        SEARCH["Search Service"]
        VENUE["Venue Service"]
        SEAT["Seat Map Service"]
        INV["Inventory Service<br/>(C++ Core)"]
        BOOK["Booking Service"]
        PAY["Payment Service"]
        TICKET["Ticket Service"]
        USER["User Service"]
        QUEUE["Queue Service<br/>(Virtual Waiting Room)"]
        PRICE["Pricing Service"]
        NOTIFY["Notification Service"]
        BOT["Bot Detection Service"]
    end

    subgraph DataStores["Data Layer"]
        PG["Relational DB<br/>(Events, Orders, Users)"]
        REDIS["Redis Cluster<br/>(Seat Holds, Sessions, Counters)"]
        NOSQL["NoSQL Store<br/>(Queue State, Activity Logs)"]
        SEARCH_IDX["Search Index<br/>(Elasticsearch)"]
        BLOB["Object Storage<br/>(Venue Maps, Media)"]
        TS_DB["Time-Series DB<br/>(Metrics, Analytics)"]
    end

    subgraph Async["Async Processing"]
        MQ["Message Queue<br/>(Kafka)"]
        HOLD_EXP["Hold Expiry Worker"]
        TICKET_GEN["Ticket Generation Worker"]
        ANALYTICS["Analytics Pipeline"]
    end

    subgraph External["External Services"]
        PAY_GW["Payment Gateways<br/>(Stripe, PayPal)"]
        EMAIL["Email / SMS Provider"]
        PUSH["Push Notification Service"]
    end

    WEB & MOB & API_EXT --> CDN
    CDN --> WAF --> EDGE_WR
    EDGE_WR --> APIGW
    EDGE_WR --> WS_GW

    APIGW --> EVT & SEARCH & VENUE & SEAT & BOOK & USER & QUEUE & PRICE
    WS_GW --> QUEUE & SEAT

    QUEUE --> BOT
    QUEUE --> NOSQL
    QUEUE --> REDIS

    EVT --> PG
    SEARCH --> SEARCH_IDX
    VENUE --> PG & BLOB
    SEAT --> INV
    INV --> REDIS
    BOOK --> INV & PAY & REDIS
    PAY --> PAY_GW
    TICKET --> PG & BLOB
    USER --> PG
    PRICE --> PG & REDIS
    NOTIFY --> EMAIL & PUSH

    BOOK --> MQ
    MQ --> HOLD_EXP & TICKET_GEN & ANALYTICS & NOTIFY
    ANALYTICS --> TS_DB

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef edge fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef async fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef external fill:#fce4ec,stroke:#c62828,stroke-width:2px

    class WEB,MOB,API_EXT client
    class CDN,WAF,EDGE_WR edge
    class APIGW,WS_GW gateway
    class EVT,SEARCH,VENUE,SEAT,INV,BOOK,PAY,TICKET,USER,QUEUE,PRICE,NOTIFY,BOT service
    class PG,REDIS,NOSQL,SEARCH_IDX,BLOB,TS_DB data
    class MQ,HOLD_EXP,TICKET_GEN,ANALYTICS async
    class PAY_GW,EMAIL,PUSH external
```

---

## 2. Data Flow: High-Demand On-Sale

### Phase 1: Pre-Sale Queue Formation

```mermaid
sequenceDiagram
    participant Fan as Fan (Browser)
    participant CDN as CDN Edge
    participant QC as Queue Connector<br/>(Edge Worker)
    participant QS as Queue Service
    participant BOT as Bot Detection
    participant DB as DynamoDB<br/>(Queue State)
    participant WS as WebSocket Gateway

    Note over Fan,WS: Waiting Room Opens (15-30 min before on-sale)

    Fan->>CDN: GET /event/{id}/queue
    CDN->>QC: Route to queue connector
    QC->>QS: Register user in queue
    QS->>BOT: Risk assessment (device fingerprint, behavior)
    BOT-->>QS: Risk score + verdict
    alt Bot detected
        QS-->>Fan: 403 Blocked
    else Legitimate fan
        QS->>DB: Store {userId, timestamp, position, status: WAITING}
        QS-->>Fan: Queue ticket (JWT) + WebSocket URL
    end

    Fan->>WS: Connect WebSocket (queue ticket)

    Note over Fan,WS: On-Sale Time Arrives

    loop Leaky Bucket Drain
        QS->>DB: Fetch next N users (by position)
        QS->>QS: Check protected zone capacity
        QS-->>WS: Push "YOUR_TURN" to selected users
        WS-->>Fan: Access token + redirect to booking
    end
```

### Phase 2: Seat Selection & Booking

```mermaid
sequenceDiagram
    participant Fan as Fan (Browser)
    participant GW as API Gateway
    participant SM as Seat Map Service
    participant INV as Inventory Service (C++)
    participant REDIS as Redis Cluster
    participant BOOK as Booking Service
    participant PAY as Payment Service
    participant PG as PostgreSQL
    participant MQ as Message Queue
    participant TKT as Ticket Service

    Fan->>GW: GET /events/{id}/seats (access token)
    GW->>SM: Load seat map
    SM->>INV: Get current availability
    INV->>REDIS: Scan seat states (AVAILABLE/HELD/SOLD)
    REDIS-->>INV: Seat availability bitmap
    INV-->>SM: Available seats with pricing
    SM-->>Fan: Interactive seat map (SVG + data)

    Fan->>GW: POST /holds {seatIds, eventId}
    GW->>INV: Attempt seat hold
    INV->>REDIS: SETNX seat:{eventId}:{seatId} = userId (TTL 600s)
    alt Seat available
        REDIS-->>INV: OK (hold acquired)
        INV->>MQ: Emit SEAT_HELD event
        INV-->>Fan: 200 Hold confirmed (10 min timer)
    else Seat already held/sold
        REDIS-->>INV: FAIL
        INV-->>Fan: 409 Conflict (seat unavailable)
    end

    Note over Fan,TKT: User proceeds to checkout within 10 min

    Fan->>GW: POST /orders {holdId, paymentMethod}
    GW->>BOOK: Create order
    BOOK->>INV: Verify holds still valid
    INV->>REDIS: Check holds exist
    REDIS-->>INV: Valid
    BOOK->>PAY: Process payment
    PAY-->>BOOK: Payment confirmed (idempotency key)
    BOOK->>PG: INSERT order (CONFIRMED)
    BOOK->>INV: Convert holds to SOLD
    INV->>REDIS: SET seat:{eventId}:{seatId} = SOLD (no TTL)
    BOOK->>MQ: Emit ORDER_CONFIRMED event
    MQ->>TKT: Generate digital ticket
    TKT-->>Fan: Ticket delivered (rotating barcode)
```

### Phase 3: Hold Expiry (Unhappy Path)

```mermaid
sequenceDiagram
    participant REDIS as Redis Cluster
    participant WORKER as Hold Expiry Worker
    participant INV as Inventory Service
    participant MQ as Message Queue
    participant SM as Seat Map Service
    participant WS as WebSocket Gateway

    Note over REDIS,WS: User's 10-min hold expires

    REDIS->>REDIS: TTL expires, key auto-deleted
    REDIS->>WORKER: Keyspace notification (key expired)
    WORKER->>INV: Release seat hold
    INV->>MQ: Emit SEAT_RELEASED event
    MQ->>SM: Update seat availability
    SM->>WS: Push availability update to active users
    WS-->>WS: Broadcast to users viewing this event
```

---

## 3. Key Architectural Decisions

### Decision 1: Microservices vs. Monolith

| Aspect | Decision | Justification |
|--------|----------|---------------|
| **Architecture** | **Microservices** with a **monolithic Inventory Core** | The Inventory Core (C++ with assembly) is the hot path -- it must be low-latency and co-located with Redis. Other services (Event, Search, User) scale independently. |
| **Why not full microservices?** | Inventory operations require sub-millisecond coordination | Decomposing seat holds across services adds network hops and distributed transaction complexity |
| **Why not monolith?** | Search, events, notifications have different scaling profiles | On-sale traffic hits Inventory 1000x harder than Event Management |

### Decision 2: Synchronous vs. Asynchronous Communication

| Flow | Pattern | Justification |
|------|---------|---------------|
| Seat hold (SETNX) | **Synchronous** | User needs immediate confirmation; <50ms target |
| Payment processing | **Synchronous** (with timeout) | Must confirm payment before converting hold to sold |
| Ticket generation | **Asynchronous** (via queue) | Can tolerate seconds of delay after payment |
| Seat map updates | **Async push** (WebSocket) | Real-time but eventual; brief staleness acceptable |
| Analytics/logging | **Asynchronous** (fire-and-forget) | Not on critical path |
| Queue position updates | **Async push** (WebSocket) | Periodic updates, not per-change |

### Decision 3: Database Choices

| Data | Store | Justification |
|------|-------|---------------|
| Seat holds (ephemeral) | **Redis Cluster** | Sub-ms SETNX, native TTL, 100K+ ops/sec per shard |
| Queue state | **NoSQL (DynamoDB-style)** | High write throughput, auto-scaling, single-table design |
| Events, orders, users | **Relational DB (PostgreSQL)** | ACID transactions, complex queries, referential integrity |
| Event search | **Search Index (Elasticsearch)** | Full-text search, faceting, geo-queries |
| Venue maps, media | **Object Storage** | Large binary assets, CDN-friendly |
| Metrics, analytics | **Time-Series DB** | Efficient time-range queries, downsampling |

### Decision 4: Caching Strategy

| Layer | What | TTL | Invalidation |
|-------|------|-----|-------------|
| **CDN Edge** | Static venue maps, event pages, JS/CSS | 5-60 min | Surrogate keys + instant purge |
| **Edge Worker Cache** | Queue token validation | 30s | Short TTL, rebuild on miss |
| **Redis L1** | Active seat maps (bitmap), hold state | Real-time | Write-through on state change |
| **Application Cache** | Event metadata, pricing tiers | 5 min | TTL + event-driven invalidation |
| **Search Cache** | Popular search results | 1 min | Short TTL for freshness |

### Decision 5: Queue Model -- Push vs. Pull

| Aspect | Decision | Justification |
|--------|----------|---------------|
| Queue position | **Server-push via WebSocket** | Reduces polling load; 14M users polling every second = catastrophic |
| Seat availability | **Server-push via WebSocket** | Real-time updates prevent users from selecting unavailable seats |
| Queue entry | **Client-initiated (pull)** | User must actively join; prevents auto-enrollment attacks |

---

## 4. Architecture Pattern Checklist

| Pattern | Decision | Notes |
|---------|----------|-------|
| Sync vs Async | **Hybrid** | Sync for holds/payments; async for notifications/analytics |
| Event-driven vs Request-response | **Both** | Request-response for booking; event-driven for state propagation |
| Push vs Pull | **Push** (WebSocket) | Queue updates, seat availability pushed to clients |
| Stateless vs Stateful | **Stateless services** + **stateful Redis/DB** | Services scale horizontally; state lives in Redis/DB |
| Read-heavy vs Write-heavy optimization | **Write-heavy** for on-sales | Redis as write buffer; reads served from CDN/cache |
| Real-time vs Batch | **Real-time** for booking | Batch for analytics, reporting, settlement |
| Edge vs Origin | **Edge** for queue validation + static content | Origin for booking/payment (requires strong consistency) |

---

## 5. Component Responsibilities

| Service | Responsibility | Scale Profile |
|---------|---------------|---------------|
| **Queue Service** | Virtual waiting room, position tracking, admission control | Spiky: 0 to millions in seconds |
| **Bot Detection** | Device fingerprinting, behavioral analysis, risk scoring | Inline with queue joins |
| **Inventory Service** | Seat state machine (Available -> Held -> Sold), atomic holds | Extreme contention |
| **Seat Map Service** | Venue layout, pricing overlay, availability visualization | Read-heavy during on-sale |
| **Booking Service** | Order lifecycle, payment orchestration, confirmation | Write-heavy during on-sale |
| **Payment Service** | Payment gateway abstraction, idempotency, retry | External dependency Slowest part of the process |
| **Event Service** | Event CRUD, venue assignment, sale window configuration | Low frequency, admin-facing |
| **Pricing Service** | Dynamic pricing, tier management, platinum seats | Pre-computed, read during checkout |
| **Search Service** | Full-text search, filtering, geo-queries | Steady, cache-friendly |
| **Ticket Service** | Digital ticket generation, rotating barcodes, delivery | Async post-purchase |
| **Notification Service** | Email, SMS, push for confirmations and queue updates | Async, high volume during on-sales |

---

## 6. Event-Level Isolation Architecture

For mega on-sales, the system deploys event-level isolation -- a dedicated resource pool per high-demand event that prevents cross-event interference:

```mermaid
flowchart TB
    subgraph SharedPool["Shared Infrastructure<br/>(All Tier 3-4 Events)"]
        SP_REDIS["Redis Cluster<br/>(6 nodes, shared)"]
        SP_APP["App Pool<br/>(10 instances)"]
        SP_DB["PostgreSQL<br/>(shared read replicas)"]
    end

    subgraph EventA["Mega Event A Isolation<br/>(Taylor Swift - MetLife)"]
        EA_REDIS["Redis Cluster<br/>(20 nodes, dedicated)"]
        EA_APP["App Pool<br/>(200 instances)"]
        EA_WS["WebSocket Pool<br/>(150 servers)"]
        EA_PAY["Payment Router<br/>(Multi-gateway, 500 TPS)"]
    end

    subgraph EventB["High Event B Isolation<br/>(Drake - MSG)"]
        EB_REDIS["Redis Cluster<br/>(10 nodes, dedicated)"]
        EB_APP["App Pool<br/>(50 instances)"]
        EB_WS["WebSocket Pool<br/>(40 servers)"]
        EB_PAY["Payment Router<br/>(200 TPS)"]
    end

    subgraph Shared["Shared Data Layer"]
        PG["PostgreSQL Primary<br/>(Orders, Users)"]
        SEARCH["Search Index"]
        BLOB["Object Storage"]
    end

    EA_APP --> PG
    EB_APP --> PG
    SP_APP --> PG
    EA_APP --> SEARCH
    EB_APP --> SEARCH
    SP_APP --> SEARCH

    classDef shared fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef mega fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef high fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class SP_REDIS,SP_APP,SP_DB shared
    class EA_REDIS,EA_APP,EA_WS,EA_PAY mega
    class EB_REDIS,EB_APP,EB_WS,EB_PAY high
    class PG,SEARCH,BLOB data
```

**Key Isolation Principles:**

| Dimension | Isolated Per Event | Shared Across Events |
|-----------|-------------------|---------------------|
| **Redis (seat holds)** | Mega/High events get dedicated clusters | Tier 3-4 events share a cluster |
| **App servers** | Dedicated pool sized by demand prediction | Shared pool with auto-scaling |
| **WebSocket** | Dedicated WS servers per on-sale | Shared for general notifications |
| **Payment routing** | Per-event gateway allocation with circuit breakers | Shared gateway pool |
| **Database** | Shared primary (orders are durable, low-contention post-Redis) | Shared |
| **CDN / Edge** | Event-specific cache warming + edge functions | Shared CDN infrastructure |

---

## 7. Resale Marketplace Flow

The secondary marketplace creates a second booking flow with different constraints:

```mermaid
sequenceDiagram
    participant Seller as Seller
    participant API as API Gateway
    participant RESALE as Resale Service
    participant INV as Inventory Service
    participant REDIS as Redis
    participant PG as PostgreSQL
    participant Buyer as Buyer
    participant PAY as Payment Service
    participant TKT as Ticket Service

    Note over Seller,TKT: Listing Phase

    Seller->>API: POST /resale/list {ticket_id, price}
    API->>RESALE: Validate listing
    RESALE->>PG: Verify seller owns ticket
    RESALE->>RESALE: Check price cap (≤120% face value)
    RESALE->>PG: Create resale listing
    RESALE->>INV: Update seat status → RESALE_LISTED
    INV->>REDIS: Mark seat in resale bitmap
    RESALE-->>Seller: Listing confirmed

    Note over Seller,TKT: Purchase Phase

    Buyer->>API: POST /resale/buy {listing_id}
    API->>RESALE: Initiate resale purchase
    RESALE->>REDIS: SETNX resale_lock:{listing_id}
    REDIS-->>RESALE: Lock acquired
    RESALE->>PAY: Charge buyer
    PAY-->>RESALE: Payment confirmed
    RESALE->>PG: Transfer ticket ownership (atomic)
    RESALE->>TKT: Invalidate old ticket, issue new ticket
    RESALE->>PAY: Pay seller (minus platform fee)
    TKT-->>Buyer: New ticket with new barcode
    RESALE-->>Seller: Sale confirmed, payment pending
```

**Resale-Specific Constraints:**

| Constraint | Implementation |
|-----------|----------------|
| **Price cap** | Resale ≤ 120% of face value (platform-enforced, configurable per event) |
| **Identity transfer** | Old barcode invalidated; new barcode issued to buyer |
| **Platform fee** | 10-15% of resale price deducted from seller payout |
| **Seller verification** | Must be original purchaser (anti-scalper measure) |
| **Cooling period** | No resale within 48 hours of purchase (prevents automated flipping) |
| **Event-day cutoff** | Resale closes 2 hours before event start |

---

## 8. CDN Edge Computing Deep Dive

The CDN edge handles the vast majority of request volume during on-sales, making it a critical architectural layer:

```mermaid
flowchart LR
    subgraph EdgePoP["CDN Edge PoP (150+ locations)"]
        STATIC["Static Cache<br/>(HTML, CSS, JS, SVGs)"]
        EW["Edge Worker<br/>(Compute at Edge)"]
        BLOOM["Bloom Filter<br/>(Token Revocation)"]
    end

    subgraph EdgeLogic["Edge Worker Functions"]
        V1["1. JWT Signature Verify<br/>(RS256, cached public key)"]
        V2["2. Token Expiry Check"]
        V3["3. Event Scope Match"]
        V4["4. Device FP Match"]
        V5["5. Revocation Check<br/>(Bloom filter)"]
        V6["6. TLS Fingerprint<br/>(JA3/JA4 bot check)"]
    end

    subgraph Outcomes["Edge Decisions"]
        ALLOW["→ Forward to Origin<br/>(~10% of requests)"]
        REJECT["→ 403 Rejected<br/>(~60% of requests)"]
        CACHED["→ Serve from Cache<br/>(~30% of requests)"]
    end

    EW --> V1 --> V2 --> V3 --> V4 --> V5 --> V6
    V6 --> ALLOW
    V6 --> REJECT
    STATIC --> CACHED

    classDef edge fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef logic fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef outcome fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class STATIC,EW,BLOOM edge
    class V1,V2,V3,V4,V5,V6 logic
    class ALLOW,REJECT,CACHED outcome
```

**Edge Traffic Reduction:**

| Traffic Type | % of Total | Handled At | Origin Impact |
|-------------|-----------|-----------|---------------|
| Static assets (JS, CSS, SVG) | ~30% | CDN cache | Zero |
| Waiting room page loads | ~25% | CDN cache | Zero |
| Invalid/expired tokens | ~20% | Edge worker | Zero |
| Bot traffic (TLS fingerprint) | ~15% | Edge worker | Zero |
| Legitimate booking requests | ~10% | Origin | Full processing |

During a mega on-sale with 3.5B requests, only ~350M reach the origin. The CDN absorbs a 10x amplification factor.

---

## 9. Technology Comparison: Ticketing Platforms

| Aspect | Ticketmaster (This Design) | SeatGeek | StubHub | Eventbrite |
|--------|---------------------------|----------|---------|------------|
| **Primary use case** | Primary + resale | Aggregator + resale | Resale marketplace | Self-service events |
| **Contention model** | Redis SETNX (extreme) | DB-level OCC (moderate) | No primary sale contention | Low contention |
| **Queue system** | Virtual waiting room + leaky bucket | Queue-it integration | Not needed (resale) | Not needed |
| **Inventory ownership** | Platform controls primary inventory | Aggregates from partners | Seller-listed only | Organizer-managed |
| **Bot challenge** | 8.7B blocked/month | Moderate | Moderate | Low |
| **Scale trigger** | Single mega event (14M concurrent) | Search aggregation | Listing volume | Event creation volume |
| **Architecture model** | Active-passive (strong consistency for seats) | Active-active (eventual for search) | Active-active (marketplace) | Multi-tenant SaaS |
| **CDN strategy** | Fastly + edge compute | Standard CDN | Standard CDN | Standard CDN |

---

## 10. Event Lifecycle Data Flow

An event's lifecycle spans weeks to months, with different system components dominating at each phase:

```mermaid
flowchart LR
    subgraph Create["Event Creation<br/>(Weeks Before)"]
        EC1["Venue configured"]
        EC2["Pricing set"]
        EC3["Sale window defined"]
    end

    subgraph PreSale["Pre-Sale Phase<br/>(Days Before)"]
        PS1["Verified Fan registration"]
        PS2["Demand prediction"]
        PS3["Resource pre-allocation"]
    end

    subgraph OnSale["On-Sale<br/>(Minutes)"]
        OS1["Queue opens"]
        OS2["Leaky bucket drains"]
        OS3["Seats held + sold"]
    end

    subgraph PostSale["Post-Sale<br/>(Days After)"]
        PO1["Resale marketplace"]
        PO2["Ticket delivery"]
        PO3["Reconciliation"]
    end

    subgraph EventDay["Event Day"]
        ED1["Gate scanning"]
        ED2["Rotating barcodes"]
        ED3["Real-time attendance"]
    end

    Create --> PreSale --> OnSale --> PostSale --> EventDay

    classDef create fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef presale fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef onsale fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef postsale fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef eventday fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class EC1,EC2,EC3 create
    class PS1,PS2,PS3 presale
    class OS1,OS2,OS3 onsale
    class PO1,PO2,PO3 postsale
    class ED1,ED2,ED3 eventday
```

| Phase | Duration | Dominant Services | Traffic Profile |
|-------|----------|-------------------|----------------|
| **Event Creation** | Weeks | Event Service, Venue Service, Pricing Service | Low (admin-only) |
| **Pre-Sale** | Days | User Service (Verified Fan), Demand Prediction, Infrastructure Orchestrator | Low-moderate |
| **On-Sale** | Minutes to hours | Queue, Inventory, Booking, Payment, WebSocket | Extreme spike (1000x) |
| **Post-Sale** | Days to weeks | Resale, Ticket Service, Notification | Moderate, declining |
| **Event Day** | Hours | Ticket Validation (gate scanners), Attendance Tracking | Moderate, predictable |
