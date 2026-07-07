# Requirements & Estimations

## Functional Requirements

### Core Features

| # | Feature | Description |
|---|---------|-------------|
| F1 | **Order Placement** | Place market, limit, stop-loss (SL), stop-loss market (SL-M), bracket, and cover orders for equities, F&O, commodities, and currencies |
| F2 | **Order Modification & Cancellation** | Modify pending order price/quantity; cancel open orders; support after-market orders (AMO) queued for next session |
| F3 | **Real-Time Market Data** | Stream live bid/ask prices, last traded price (LTP), order book depth (Level 1: top 5, Level 3: top 20), and volume for subscribed instruments |
| F4 | **Watchlists** | Create and manage custom watchlists of instruments; display real-time LTP, change %, day high/low, volume |
| F5 | **Portfolio & Holdings** | Display current holdings (delivery), intraday positions, realized/unrealized P&L, average buy price, and day's gain/loss |
| F6 | **Charting** | Render interactive candlestick/line/bar charts with OHLCV data at 1m/5m/15m/1h/1D intervals; overlay 50+ technical indicators |
| F7 | **Order Book & Trade Book** | Show all orders placed (open, completed, cancelled, rejected) and executed trades with fill price, quantity, and timestamps |
| F8 | **Margin Calculator** | Compute required margin for F&O trades in real-time based on SPAN + exposure margin; show available margin |
| F9 | **Market Depth** | Display full 20-level order book depth showing bid/ask quantities at each price level for an instrument |
| F10 | **GTT Orders** | Good-Till-Triggered orders that monitor price conditions and auto-place orders when triggered (even across sessions) |
| F11 | **Basket Orders** | Place multiple orders across instruments simultaneously as a single batch |
| F12 | **IPO Application** | Apply for Initial Public Offerings directly through the trading platform via UPI mandate |
| F13 | **Smart Order Routing** | Automatically route orders to the exchange (NSE/BSE) offering best price, liquidity, and latency for the instrument |
| F14 | **Alerts & Notifications** | Price alerts, order execution alerts, margin calls, corporate action notifications via push/SMS/email |
| F15 | **Fund Management** | View ledger balance, add/withdraw funds via payment gateway, track margin utilization and collateral value |

### Out of Scope

| Feature | Reason |
|---------|--------|
| **Exchange matching engine** | Broker routes orders; exchange operates matching—regulatory separation |
| **Algorithmic strategy builder** | Separate product (strategy backtesting, signal generation); API access is in scope |
| **Mutual fund distribution** | Separate regulatory license (AMFI); distinct product with different workflows |
| **Tax filing integration** | P&L reports are in scope; direct tax filing is external integration |
| **Social/copy trading** | Different product category requiring separate regulatory approval |

### User Roles

| Role | Capabilities |
|------|-------------|
| **Retail Trader** | Place/modify/cancel orders, view market data, manage portfolio, set GTT triggers, apply for IPOs |
| **API User** | Programmatic order placement via Kite Connect API, WebSocket market data streaming, algorithmic trading |
| **Risk Manager (Internal)** | Monitor real-time risk exposure, set client-level position limits, trigger square-off for margin breaches |
| **Operations (Internal)** | Settlement reconciliation, trade corrections, client fund management, regulatory report generation |
| **Compliance Officer** | Audit trail review, suspicious trading pattern detection, SEBI report submission |

### User Personas & Access Patterns

| Persona | Session Pattern | Primary Actions | Load Contribution |
|---------|----------------|-----------------|-------------------|
| **Intraday Trader** | 9:10 AM–3:30 PM; 50+ orders/day | Market/limit orders, position monitoring, depth analysis | 40% of order volume |
| **Swing/Delivery Trader** | Sporadic; 2–5 orders/day | Limit orders, portfolio review, chart analysis | 15% of order volume |
| **F&O Trader** | 9:15 AM–3:30 PM; 20+ orders/day | Complex orders (bracket, cover), margin calculator, Greeks | 30% of order volume |
| **Algo/API Trader** | Continuous via API; 100+ orders/day | Programmatic orders, WebSocket streaming, position polling | 15% of order volume, 40% of API calls |
| **Passive Investor** | Weekly; 1–2 orders/month | Holdings review, IPO application, fund management | <1% of order volume, 10% of read traffic |

---

## Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| **Order-to-Exchange Latency** | p50 < 500μs, p99 < 1ms | Co-located gateway; competitive with other brokers |
| **Market Data Latency** | p50 < 2ms, p99 < 5ms | Exchange feed → user's WebSocket connection |
| **Order Placement API Latency** | p50 < 50ms, p99 < 200ms | User-facing API including risk checks |
| **System Availability (Market Hours)** | 99.99% | 6.25 hours/day; downtime = lost trades + regulatory penalty |
| **System Availability (Non-Market)** | 99.9% | Portfolio viewing, historical data, account management |
| **Order Durability** | 99.9999% | Every accepted order must be persisted; no order loss |
| **Market Data Freshness** | < 100ms stale | Stale quotes lead to incorrect trading decisions |
| **Concurrent WebSocket Connections** | 500K+ | Peak market hours; each receiving streaming data |
| **Peak Order Throughput** | 50,000 orders/sec | Market open spike (9:15 AM, first 5 minutes) |
| **Position Consistency** | Strongly consistent | Position and margin must reflect latest fills in real-time |

---

## Capacity Estimations

### Traffic

```
Active trading users:          7,000,000 (7M)
Concurrent users (peak):       500,000 (market hours)
Daily orders:                  10,000,000 (10M)

Market hours:                  6.25 hours = 22,500 seconds
Average orders/sec:            10M / 22,500 ≈ 444 orders/sec
Peak orders/sec (market open): 444 × 15 = ~6,660 orders/sec (sustained)
Burst peak (first 60 sec):    ~50,000 orders/sec

Order modifications/sec:       ~200/sec average, ~3,000/sec peak
Order cancellations/sec:       ~100/sec average, ~1,500/sec peak
```

### Market Data

```
Tradeable instruments:         5,000+ (equities, F&O, commodities, currencies)
Ticks per instrument/sec:      50-300 (varies by liquidity)
Total ticks/sec (exchange):    ~2,000,000 (2M)
Tick size (binary):            ~100 bytes

Inbound data rate (from exchange): 2M × 100B = 200 MB/s
WebSocket subscribers (peak):  500,000
Average instruments/user:      20-50 (watchlist + open positions)
Outbound ticks/sec:            500K × 30 avg instruments × 5 ticks/sec/instrument
                               = ~75,000,000 outbound messages/sec
With batching (100ms window):  ~7,500,000 batched messages/sec
Compressed message size:       ~200 bytes (batched)
Outbound bandwidth:            7.5M × 200B = 1.5 GB/s
```

### Storage

```
--- Order Database ---
Orders per day:               10,000,000
Order record size:            ~500 bytes (all fields, status history)
Daily order growth:           10M × 500B = 5 GB/day
Annual order growth:          5 GB × 250 trading days = 1.25 TB/year
5-year retention:             6.25 TB

--- Trade Database ---
Trades (fills) per day:       8,000,000 (some orders partially fill)
Trade record size:            ~300 bytes
Daily trade growth:           8M × 300B = 2.4 GB/day
Annual trade growth:          600 GB/year

--- Market Data (Historical) ---
OHLCV candles per instrument: ~375/day (1-min candles × 6.25 hours)
Total candles/day:            5,000 × 375 = 1,875,000
Candle record size:           ~80 bytes (OHLCV + volume + OI)
Daily candle growth:          1.875M × 80B = 150 MB/day
Annual candle growth:         37.5 GB/year
10-year historical:           375 GB (fits comfortably)

--- Tick Data Archive ---
Ticks per day:                2M/sec × 22,500 sec = 45 billion ticks
Tick archive size:            45B × 100B = 4.5 TB/day (compressed: ~500 GB/day)
Retention:                    90 days rolling → 45 TB compressed

--- User Data ---
User profiles:                12,000,000
Profile record size:          ~2 KB (KYC, bank details, preferences)
Total user data:              24 GB (trivial)

--- Portfolio/Holdings ---
Holdings records:             12M users × 10 avg holdings = 120M records
Holdings record size:         ~200 bytes
Total holdings data:          24 GB
Position records (intraday):  500K active positions at peak
```

### Bandwidth

```
Market data inbound:          200 MB/s (exchange feed to colo)
Market data outbound:         1.5 GB/s (WebSocket to users, compressed)
Order API traffic:            50K × 500B = 25 MB/s peak inbound
Order response traffic:       50K × 200B = 10 MB/s peak outbound
Chart data requests:          ~100K req/sec × 5 KB avg = 500 MB/s
Total peak bandwidth:         ~2.5 GB/s outbound
```

---

## SLO / SLA Table

| Service | Metric | SLO | SLA | Measurement |
|---------|--------|-----|-----|-------------|
| Order Gateway | Latency p50 | < 500μs | < 1ms | Co-located gateway to exchange |
| Order API | Latency p50 | < 50ms | < 100ms | Client API to order acceptance |
| Order API | Latency p99 | < 200ms | < 500ms | Including risk checks |
| Order API | Availability | 99.99% | 99.95% | During market hours (9:15–3:30) |
| Market Data | Latency p50 | < 2ms | < 5ms | Exchange tick to WebSocket delivery |
| Market Data | Latency p99 | < 5ms | < 10ms | Including compression and fan-out |
| WebSocket | Connection success | > 99.9% | > 99.5% | During market hours |
| WebSocket | Message delivery | > 99.99% | > 99.9% | No dropped ticks for subscribed instruments |
| Portfolio | Position update latency | < 500ms | < 1s | From trade execution to position reflection |
| Portfolio | P&L accuracy | 100% | 100% | Must match exchange trade confirmations |
| Historical Data | API latency p99 | < 200ms | < 500ms | Chart data and OHLCV retrieval |
| Settlement | Reconciliation accuracy | 100% | 100% | All trades must reconcile with exchange |
| Risk Engine | Pre-trade check latency | < 100μs | < 500μs | Margin + position limit validation |
| GTT Service | Trigger accuracy | 100% | 100% | Must trigger when price condition met |
| GTT Service | Trigger latency | < 1s | < 5s | From price condition to order placement |

---

## Key Estimation Insights

1. **Market open is the design-defining moment**: The 10–15× traffic spike at 9:15 AM (50,000 orders/sec burst) is the primary scaling constraint. Systems must be provisioned for this peak, not the 444 orders/sec average—but those resources sit largely idle for 90% of market hours.

2. **Market data fan-out dominates bandwidth**: At 1.5 GB/s outbound for WebSocket streaming, market data distribution consumes 60× more bandwidth than order traffic. The ticker component is the most bandwidth-intensive service in the entire system.

3. **Order storage is modest; tick data is massive**: Order data grows at 1.25 TB/year (manageable), but raw tick archives at 500 GB/day compressed require dedicated time-series storage with aggressive retention policies.

4. **Risk engine latency budget is microseconds, not milliseconds**: Pre-trade risk checks (margin, position limits) must complete in < 100μs to avoid adding perceptible latency to the order path. This rules out network calls—risk state must be in-process memory.

5. **Position consistency is non-negotiable**: Unlike search systems that tolerate eventual consistency, a trader's position and available margin must reflect the latest fill immediately. A stale position view can cause incorrect margin calculations and unauthorized trades.

---

## Rate Limits & Quotas

| Resource | Limit | Scope | Rationale |
|----------|-------|-------|-----------|
| Order placement | 10 orders/sec | Per user | Prevent accidental order floods from manual trading |
| Order modification | 5 modifications/sec | Per user | Limit order book churn |
| API requests | 3 req/sec | Per access token | Fair usage across API users |
| Historical data API | 1 req/sec | Per access token | Heavy queries; rate-limit to protect time-series DB |
| WebSocket subscriptions | 3,000 instruments | Per connection | Memory and bandwidth bound per connection |
| GTT triggers | 100 active triggers | Per user | Background monitoring resource bound |
| Login attempts | 5 failures / 30 min | Per user_id | Brute-force protection |
| Basket orders | 20 orders / basket | Per submission | Exchange rate-limit alignment |

---

## Latency Budget Breakdown

| Segment | Budget | Component |
|---------|--------|-----------|
| API Gateway (auth + route) | 5 ms | TLS termination, JWT validation, rate check |
| OMS processing | 2 ms | Request parsing, order_id generation, WAL write |
| Risk engine (pre-trade) | 0.1 ms | Margin check, position limit, circuit breaker |
| FIX serialization | 0.5 ms | Build FIX NewOrderSingle, checksum |
| Network: DC → colo | 0.5 ms | Leased line, dedicated fiber |
| Exchange FIX gateway | 0.1 ms | Exchange ingress processing |
| **Total (order acceptance to exchange)** | **~8.2 ms** | |
| Exchange matching + response | 3–5 ms | Price-time priority matching, ExecutionReport |
| **Total round-trip** | **~13 ms** | User API call to fill confirmation |

---

## Growth Projections

| Metric | Year 1 | Year 2 | Year 3 | Driver |
|--------|--------|--------|--------|--------|
| Registered users | 12M | 16M | 22M | Market participation growth in India |
| Daily orders | 10M | 15M | 22M | F&O volume growth, retail participation |
| Peak orders/sec | 50K | 75K | 110K | Market open congestion scaling |
| WebSocket connections | 500K | 750K | 1.1M | Mobile-first user growth |
| Market data ticks/sec | 2M | 3M | 4M | New instrument listings, longer hours |
| Historical data (total) | 8 TB | 14 TB | 22 TB | Tick archive + candle growth |

---

## Failure Budget Allocation

| Component | Yearly Budget | Allowed Downtime | Priority |
|-----------|---------------|-----------------|----------|
| Order gateway | 0.01% (market hours) | ~9.4 min/year | P0 — revenue loss |
| Market data feed | 0.01% (market hours) | ~9.4 min/year | P0 — stale data = bad trades |
| Position service | 0.01% (market hours) | ~9.4 min/year | P0 — margin accuracy |
| Portfolio/holdings | 0.05% (24/7) | ~4.4 hrs/year | P1 — read-only, cacheable |
| Chart service | 0.1% (24/7) | ~8.8 hrs/year | P2 — degradable |
| Settlement batch | 0% tolerance | Zero missed settlements | P0 — regulatory penalty |
