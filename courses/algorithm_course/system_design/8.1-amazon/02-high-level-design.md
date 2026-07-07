# High-Level Design

## Architecture Overview

The Amazon-scale e-commerce platform follows a **CQRS pattern** for the catalog (write-optimized catalog store + read-optimized search index), an **event-driven pattern** for order lifecycle, and a **cell-based deployment** model for blast-radius isolation. The architecture is shaped by three realities: (1) the catalog is massive (500M+ SKUs) and continuously updated by millions of sellers; (2) inventory is distributed across 200+ fulfillment centers; (3) traffic spikes 10-15× during flash sales.

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        WEB[Web App]
        MOB[Mobile App]
        SELL[Seller Portal]
    end

    subgraph Gateway["API Layer"]
        GW[API Gateway]
        BFF[BFF Service]
    end

    subgraph Discovery["Discovery Services"]
        SRCH[Search Service]
        CAT[Catalog Service]
        REC[Recommendation<br/>Service]
        BROWSE[Browse &<br/>Category Service]
    end

    subgraph Commerce["Commerce Services"]
        CART[Cart Service]
        CHECKOUT[Checkout<br/>Orchestrator]
        PRICE[Pricing &<br/>Promotions Engine]
        INV[Inventory<br/>Service]
        PAY[Payment<br/>Service]
    end

    subgraph Marketplace["Marketplace Services"]
        BUYBOX[Buy Box<br/>Engine]
        SLRMGMT[Seller Management<br/>Service]
        LISTING[Listing<br/>Service]
    end

    subgraph Fulfillment["Fulfillment Services"]
        ORD[Order<br/>Service]
        FULFILL[Fulfillment<br/>Router]
        SHIP[Shipping &<br/>Tracking Service]
        RET[Returns<br/>Service]
    end

    subgraph Data["Data Layer"]
        CATDB[(Catalog DB<br/>Product Master)]
        SEARCHIDX[(Search Index<br/>500M Products)]
        CARTSTORE[(Cart Store<br/>Key-Value)]
        ORDERDB[(Order DB<br/>Orders · Payments)]
        INVDB[(Inventory DB<br/>SKU × Warehouse)]
        KAFKA[Event Bus<br/>Order · Inventory Events]
        CACHE[(Distributed Cache<br/>Product · Price · Session)]
        OBJ[(Object Storage<br/>Images · Invoices)]
        CDN[CDN<br/>Static Assets · Images]
    end

    WEB & MOB --> CDN
    WEB & MOB & SELL --> GW --> BFF

    BFF --> SRCH & CAT & CART & CHECKOUT & ORD & BROWSE
    SRCH --> SEARCHIDX & CACHE
    CAT --> CATDB & CACHE
    REC --> CACHE
    BROWSE --> SEARCHIDX

    CART --> CARTSTORE & PRICE
    CART --> INV

    CHECKOUT --> INV & PAY & ORD & PRICE
    INV --> INVDB & CACHE
    PAY --> ORDERDB

    CAT --> BUYBOX
    BUYBOX --> CACHE
    LISTING --> CATDB
    SLRMGMT --> CATDB

    ORD --> ORDERDB & KAFKA
    KAFKA --> FULFILL & SHIP & RET
    FULFILL --> INVDB
    SHIP --> KAFKA

    CAT --> OBJ
    OBJ --> CDN

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef marketplace fill:#fce4ec,stroke:#b71c1c,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class WEB,MOB,SELL client
    class GW,BFF gateway
    class SRCH,CAT,REC,BROWSE,CART,CHECKOUT,PRICE,INV,PAY,ORD,FULFILL,SHIP,RET service
    class BUYBOX,SLRMGMT,LISTING marketplace
    class CATDB,ORDERDB,INVDB,OBJ data
    class KAFKA queue
    class CACHE,SEARCHIDX,CARTSTORE,CDN cache
```

---

## Service Responsibilities

| Service | Responsibility | Key Characteristics |
|---------|---------------|---------------------|
| **Search Service** | Full-text search, autocomplete, faceted filtering, ML ranking, sponsored results | Stateless; reads from search index; high QPS (58K peak) |
| **Catalog Service** | Product CRUD, variation management, attribute normalization, image pipeline | Write-optimized; publishes change events to index |
| **Recommendation Service** | Collaborative filtering, "frequently bought together," personalized suggestions | ML model serving; precomputed + real-time signals |
| **Browse & Category Service** | Category tree navigation, filtered browse pages, best-seller lists | Cached category hierarchy; pre-aggregated rankings |
| **Cart Service** | Add/remove/update cart items, persist across sessions, guest-to-auth merge | Key-value store; high write rate; session-aware |
| **Checkout Orchestrator** | Coordinate inventory reservation → pricing → payment → order creation | Saga coordinator; idempotent; compensating transactions |
| **Pricing & Promotions Engine** | Calculate final price (base + promotions + coupons + shipping), validate deals | Stateless rule engine; high call rate from cart and search |
| **Inventory Service** | Track stock per SKU per warehouse, soft/hard reservation, restock events | Strongly consistent for reservations; sharded by SKU |
| **Payment Service** | Tokenized card processing, wallet, gift cards, refunds | PCI-DSS scoped; idempotent charge operations |
| **Buy Box Engine** | Determine which seller offer wins the default purchase button | ML model: price, fulfillment speed, seller score, stock reliability |
| **Seller Management** | Seller onboarding, verification, performance tracking, account management | Moderate write rate; compliance workflows |
| **Listing Service** | Seller product listing, bulk upload, catalog matching, variation mapping | High write rate from sellers; feeds into Catalog Service |
| **Order Service** | Order creation, status tracking, modification, cancellation | Event sourced; publishes to fulfillment pipeline |
| **Fulfillment Router** | Select optimal warehouse(s) per order based on proximity, stock, cost | Optimization algorithm; may split orders across warehouses |
| **Shipping & Tracking** | Carrier selection, label generation, real-time tracking updates | Integrates with carrier APIs; event-driven status updates |
| **Returns Service** | Return authorization, refund calculation, restocking workflow | Reverse logistics; feeds back into inventory |

---

## Data Flow 1: Browse-to-Buy Journey

```
Customer searches: "wireless noise cancelling headphones"

1. API Gateway → BFF → Search Service
2. Search Service queries search index:
   - Full-text match: "wireless" AND "noise cancelling" AND "headphones"
   - Faceted filters: category=Electronics>Audio>Headphones
   - ML ranking: relevance × conversion probability × personalization
   - Sponsored results: inject 2-3 sponsored products at positions 1, 4, 8
   - Result: 50 products with buy box winner per product
3. BFF enriches: add pricing (from cache), delivery estimates, Prime badges
4. Return search results page to customer

--- Customer clicks product ---

5. BFF → Catalog Service: getProduct(productId)
6. Catalog Service:
   - Product data from cache (95% hit rate) or Catalog DB
   - Buy Box Engine: determine winning seller offer
   - Pricing Engine: calculate final price with active promotions
   - Inventory Service: check availability + delivery estimate
   - Reviews: aggregate rating + top 5 reviews
7. Return product detail page

--- Customer adds to cart ---

8. BFF → Cart Service: addItem(userId, productId, sellerId, quantity)
9. Cart Service:
   - Inventory Service: verify availability (soft check, not reservation)
   - Pricing Engine: get current price (cart always shows real-time prices)
   - Write to cart store (key-value)
   - Return updated cart with price totals

--- Customer proceeds to checkout ---

10. BFF → Checkout Orchestrator: initiateCheckout(userId, cartId)
11. Checkout Orchestrator (saga):
    Step 1: Validate cart items (re-check prices and availability)
    Step 2: Calculate shipping options per item (Fulfillment Router)
    Step 3: Customer selects shipping + enters payment
    Step 4: Hard inventory reservation (Inventory Service)
    Step 5: Payment authorization (Payment Service)
    Step 6: Create order (Order Service)
    Step 7: Publish OrderPlaced event to Event Bus
12. If Step 4 fails (out of stock): notify customer, suggest alternatives
13. If Step 5 fails (payment declined): release inventory reservation, notify
14. On success: return order confirmation with estimated delivery dates

--- Post-order ---

15. Event Bus → Fulfillment Router: select warehouse(s), create shipment(s)
16. Event Bus → Shipping Service: generate labels, schedule carrier pickup
17. Event Bus → Notification Service: send order confirmation email
18. Warehouse picks, packs, ships → tracking updates flow back through Event Bus
```

---

## Data Flow 2: Checkout Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant BFF as BFF Service
    participant CO as Checkout Orchestrator
    participant Cart as Cart Service
    participant Price as Pricing Engine
    participant Inv as Inventory Service
    participant FR as Fulfillment Router
    participant Pay as Payment Service
    participant Ord as Order Service
    participant Bus as Event Bus

    User->>BFF: Proceed to checkout
    BFF->>CO: initiateCheckout(userId, cartId)
    CO->>Cart: getCartItems(cartId)
    Cart-->>CO: cart items (3 items, 2 sellers)

    CO->>Price: calculatePrices(items)
    Price-->>CO: verified prices + promotions

    CO->>Inv: checkAvailability(items)
    Inv-->>CO: all available

    CO->>FR: getShippingOptions(items, address)
    FR-->>CO: options per item (warehouse assignments)
    CO-->>BFF: shipping options
    BFF-->>User: Select shipping + enter payment

    User->>BFF: Confirm order (payment token)
    BFF->>CO: placeOrder(cartId, shippingChoice, paymentToken)

    CO->>Inv: reserveInventory(items)
    Inv-->>CO: reserved (hold 10 min)

    CO->>Pay: authorizePayment($247.50, token)
    Pay-->>CO: authorized (auth_ref PAY-789)

    CO->>Ord: createOrder(items, payment, shipping)
    Ord-->>CO: order_id ORD-12345

    CO->>Pay: capturePayment(PAY-789)
    Pay-->>CO: captured

    CO->>Inv: confirmReservation(items)
    CO->>Cart: clearCart(cartId)

    Ord->>Bus: OrderPlaced event
    CO-->>BFF: orderConfirmed(ORD-12345)
    BFF-->>User: Order confirmed! Delivery by Dec 18

    Bus-->>FR: Route to warehouse(s)
    Bus-->>User: Order confirmation email
```

---

## Data Flow 3: Catalog Indexing Pipeline (CQRS Write → Read)

```mermaid
flowchart LR
    subgraph Writers["Catalog Writers"]
        S1[Seller Portal<br/>Price Update]
        S2[Bulk Upload<br/>Service]
        S3[Catalog Team<br/>Category Update]
    end

    subgraph Pipeline["Indexing Pipeline"]
        CDB[(Catalog DB<br/>Write Store)]
        CDC[Change Data<br/>Capture]
        ENRICH[Enrichment<br/>Service]
        VALIDATE[Validation &<br/>Normalization]
        INDEXER[Search Index<br/>Writer]
    end

    subgraph ReadPath["Read Path"]
        IDX[(Search Index<br/>500M Docs)]
        CACHE[(Product<br/>Cache)]
        BBCACHE[(Buy Box<br/>Cache)]
    end

    S1 & S2 & S3 --> CDB
    CDB --> CDC
    CDC --> VALIDATE
    VALIDATE --> ENRICH
    ENRICH --> INDEXER
    INDEXER --> IDX
    CDC --> CACHE
    CDC --> BBCACHE

    classDef writer fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef pipeline fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef read fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class S1,S2,S3 writer
    class CDB,CDC,ENRICH,VALIDATE,INDEXER pipeline
    class IDX,CACHE,BBCACHE read
```

**Pipeline stages:**
1. **Change Data Capture (CDC)**: Streams row-level changes from Catalog DB in near-real-time (~100ms latency)
2. **Validation & Normalization**: Standardize attributes (e.g., "Blk" → "Black"), validate required fields, check for policy violations
3. **Enrichment**: Attach computed fields—category predictions, embedding vectors for semantic search, image quality scores
4. **Index Writer**: Atomic document updates to search index; handles partial updates (price-only change updates single field)

**Latency budget**: Seller updates price → visible in search within **< 5 minutes** (SLO). Typical: 30-90 seconds.

---

## Data Flow 4: Flash Sale Architecture

```mermaid
flowchart TB
    subgraph PreEvent["Pre-Event Setup"]
        SETUP[Deal Setup<br/>T-12 hours]
        SHARD[Inventory<br/>Pre-Sharding]
        WARM[Cache<br/>Pre-Warming]
    end

    subgraph LiveEvent["Live Event"]
        USER[Users<br/>5M watching]
        QUEUE[Virtual Queue<br/>Overflow Protection]
        CLAIM[Deal Claim<br/>Service]
        COUNTER[Sharded Counters<br/>64 shards]
    end

    subgraph PostClaim["Post-Claim"]
        CART[Cart with<br/>Deal Price]
        CHECKOUT[Checkout<br/>15-min TTL]
        EXPIRE[Reservation<br/>Expiry Handler]
    end

    SETUP --> SHARD --> COUNTER
    SETUP --> WARM
    USER --> QUEUE --> CLAIM --> COUNTER
    CLAIM --> CART --> CHECKOUT
    CHECKOUT -->|timeout| EXPIRE
    EXPIRE -->|restock| COUNTER

    classDef pre fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef live fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef post fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class SETUP,SHARD,WARM pre
    class USER,QUEUE,CLAIM,COUNTER live
    class CART,CHECKOUT,EXPIRE post
```

---

## Data Flow 5: Seller Listing Integration

```
Seller submits new product listing via Seller Portal:

1. Listing Service receives product data (title, description, images, price, UPC)
2. Catalog Matching Engine:
   a. UPC/EAN lookup → exact product match (99.9% confidence)
   b. Title + brand + attributes fuzzy match (85-95% confidence)
   c. Image perceptual hash comparison (additional signal)
   d. If high-confidence match → link offer to existing product
   e. If low-confidence → create new product (pending review)
3. Image Processing Pipeline:
   a. Upload to object storage
   b. Generate thumbnails (5 sizes for responsive display)
   c. Background removal + quality check
   d. CDN pre-warm for deal products
4. Pricing Validation:
   a. Check price is within reasonable range (not 90% below market)
   b. Validate currency and tax configuration
   c. Compute initial buy box score
5. Listing goes ACTIVE → triggers CDC → updates search index

Daily volume: ~5M new/updated listings from 2M sellers
```

---

## Order Lifecycle State Diagram

```mermaid
stateDiagram-v2
    [*] --> CART: Items in cart
    CART --> CHECKOUT: Proceed to checkout
    CHECKOUT --> PLACED: Payment captured
    CHECKOUT --> ABANDONED: Timeout / user leaves
    ABANDONED --> CART: Cart recovery email
    PLACED --> CONFIRMED: Inventory allocated to warehouse
    CONFIRMED --> PROCESSING: Warehouse begins picking
    PROCESSING --> PACKED: Items picked and packed
    PACKED --> SHIPPED: Handed to carrier
    SHIPPED --> OUT_FOR_DELIVERY: Last-mile delivery
    OUT_FOR_DELIVERY --> DELIVERED: Customer received
    DELIVERED --> RETURN_REQUESTED: Customer initiates return
    RETURN_REQUESTED --> RETURN_APPROVED: Return authorized
    RETURN_APPROVED --> RETURN_SHIPPED: Customer ships back
    RETURN_SHIPPED --> RETURN_RECEIVED: Warehouse receives
    RETURN_RECEIVED --> REFUNDED: Refund processed
    REFUNDED --> [*]: Complete

    PLACED --> CANCELLED: Customer cancels (before picking)
    CANCELLED --> REFUNDED: Payment reversed
    SHIPPED --> DELIVERY_FAILED: Address issue / not home
    DELIVERY_FAILED --> OUT_FOR_DELIVERY: Re-attempt delivery
    DELIVERY_FAILED --> RETURNED_TO_SENDER: Max attempts exceeded
```

---

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Catalog architecture** | CQRS — write to Catalog DB, async index to Search Index | 500M products with continuous seller updates; search index is read-optimized, catalog DB is write-optimized |
| **Cart storage** | Distributed key-value store with replication | High write rate (580/sec), low latency (<50ms), must survive node failures; relational DB is overkill |
| **Checkout pattern** | Saga with compensating transactions | Inventory reservation + payment + order creation spans multiple services; any step can fail |
| **Inventory reservation** | Two-phase: soft check at cart, hard reserve at checkout | Soft check prevents bad UX (adding OOS item); hard reserve prevents overselling |
| **Search ranking** | Inverted index + ML reranking | Inverted index for fast retrieval; ML model for relevance × conversion × personalization |
| **Buy box** | ML model with price, fulfillment, seller score | Single algorithm drives 80% of sales; must be fair, transparent, and resistant to gaming |
| **Event streaming** | Event bus for order lifecycle | Decouples order placement from fulfillment, shipping, notifications; enables async processing |
| **Cell-based deployment** | Independent cells per region/shard | Blast-radius isolation: failure in one cell does not cascade to others; critical for Prime Day |
| **Image delivery** | Object storage + CDN | 2 PB of images; CDN serves 95%+ of image requests; origin bandwidth would be prohibitive |
| **Fulfillment routing** | Optimization algorithm per order | Multi-factor: proximity (speed), stock (availability), cost (shipping), load (warehouse capacity) |

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Catalog DB** | Distributed document store | Flexible schema for 500M products with varying attributes per category |
| **Search Index** | Inverted index cluster | Full-text search + faceted filtering + real-time updates at 58K QPS |
| **Cart Store** | Distributed key-value store | Sub-ms reads/writes, high availability, auto-partitioning |
| **Order DB** | Relational DB (sharded) | ACID for orders and payments; strong consistency required |
| **Inventory DB** | Relational DB (sharded by SKU) | Strong consistency for reservation; optimistic locking for concurrent updates |
| **Event Bus** | Distributed log broker | Durable, ordered event streaming for order lifecycle; replay capability |
| **Cache** | Distributed in-memory cache | Product data, pricing, session data; sub-ms reads, 95%+ hit rate |
| **Object Storage** | Cloud object storage | Product images, invoices; 2 PB+, cost-effective |
| **CDN** | Global CDN | Static assets, product images; reduces origin load by 95% |
| **API Gateway** | Rate limiting, auth, routing | Protect backend from abuse; support 230K+ req/sec peak |

---

## AI/ML Integration Points

| Integration Point | Model Type | Latency Budget | Purpose |
|-------------------|-----------|----------------|---------|
| **Search Ranking** | Two-tower retrieval + cross-encoder reranker | 15ms (rerank top 200) | Maximize relevance × conversion probability |
| **Semantic Search** | Dense vector embeddings (product + query) | 10ms (ANN lookup) | Handle natural language queries ("something for a rainy day hike") |
| **Buy Box Scoring** | Gradient-boosted decision tree | 5ms per product | Select optimal seller offer |
| **Personalized Recommendations** | Collaborative filtering + session-based transformer | 20ms | "Frequently bought together," "inspired by your browsing" |
| **Dynamic Pricing** | Demand-forecasting regression model | Batch (hourly) | Suggest optimal price points to sellers |
| **Fraud Detection** | Ensemble (rules + gradient boosting + neural) | 50ms per transaction | Real-time fraud scoring at checkout |
| **Review Quality** | NLP classifier + generative AI detector | Async (on submission) | Detect fake, incentivized, or AI-generated reviews |
| **Delivery Estimation** | Historical delivery time regression | 10ms | Predict delivery date by zip code × carrier × warehouse |
| **Category Prediction** | Multi-label text classifier | 5ms | Auto-categorize seller listings |
| **Visual Search** | CNN-based image embedding + ANN retrieval | 50ms | "Search by photo" feature |

---

## Cross-Service Communication Patterns

| Pattern | Used Between | Protocol | Rationale |
|---------|-------------|----------|-----------|
| **Synchronous RPC** | BFF → Search, Cart, Checkout | gRPC with timeout + retry | User-facing latency-sensitive paths |
| **Async Events** | Order Service → Fulfillment, Shipping, Notifications | Event bus (pub/sub) | Decouple placement from fulfillment; replay on failure |
| **Request-Reply via Queue** | Checkout → Payment Gateway | Message queue with correlation ID | Payment calls are slow (800ms+); queue isolates latency |
| **Batch Processing** | Catalog → Search Index | CDC + stream processing | High-throughput catalog updates without impacting read path |
| **Cache-Aside** | All services → Distributed Cache | Cache lookup → DB fallback → cache write | 95% cache hit rate reduces DB load by 20× |
| **Outbox Pattern** | Checkout Orchestrator → Event Bus | Write to outbox table → poll and publish | Guarantees event publication even if event bus is temporarily down |

---

## Search Architecture Detail

```mermaid
flowchart LR
    subgraph Query["Query Path"]
        Q[User Query<br/>"wireless headphones"]
        QU[Query Understanding<br/>Spell · Synonyms · Intent]
        RET[Retrieval<br/>BM25 + Vector ANN]
        RANK[ML Reranker<br/>Top 200 → Final 48]
        BIZ[Business Rules<br/>Sponsored · Diversity]
    end

    subgraph Index["Index Infrastructure"]
        INV_IDX[(Inverted Index<br/>500M docs)]
        VEC_IDX[(Vector Index<br/>Dense Embeddings)]
        FACETS[(Facet Store<br/>Pre-Aggregated)]
    end

    Q --> QU --> RET
    RET --> INV_IDX
    RET --> VEC_IDX
    RET --> RANK --> BIZ
    BIZ --> FACETS

    classDef query fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef index fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class Q,QU,RET,RANK,BIZ query
    class INV_IDX,VEC_IDX,FACETS index
```

**Search latency budget allocation:**

| Stage | Latency | Purpose |
|-------|---------|---------|
| Query understanding | 5ms | Spell correction, synonym expansion, intent classification |
| Retrieval (BM25 + ANN) | 20ms | Fetch ~50K candidates from inverted + vector index |
| Filtering | 10ms | Apply category, price, availability filters → ~6K candidates |
| ML scoring | 30ms | Score top 200 candidates with cross-encoder model |
| Business rules | 5ms | Inject sponsored results, apply diversity, boost Prime |
| Response assembly | 10ms | Fetch buy box, pricing, facets from cache |
| **Total p50** | **~80ms** | Well within 300ms SLO |
