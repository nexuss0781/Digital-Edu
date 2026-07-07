# Requirements and Estimations

## Functional Requirements

### Core Trading

| # | Requirement | Description |
|---|------------|-------------|
| F1 | **Order Placement** | Users place limit, market, stop-limit, and OCO (one-cancels-other) orders on any supported trading pair |
| F2 | **Order Matching** | Engine matches buy/sell orders by price-time priority; supports partial fills, self-trade prevention |
| F3 | **Order Management** | Users cancel open orders, amend quantity/price on limit orders; bulk cancel by pair or all |
| F4 | **Order Book** | Real-time order book with aggregated price levels (L2) and individual order view (L3) |
| F5 | **Trade History** | Personal trade history with fills, fees, timestamps; public trade stream per pair |

### Asset Management

| # | Requirement | Description |
|---|------------|-------------|
| F6 | **Deposits** | Users deposit crypto from external wallets; unique deposit addresses per user per chain |
| F7 | **Withdrawals** | Users withdraw crypto to external addresses; configurable withdrawal limits and approval workflows |
| F8 | **Fiat On/Off Ramp** | Bank transfers, card payments for fiat deposits; fiat withdrawals to bank accounts |
| F9 | **Internal Transfers** | Instant transfers between exchange accounts (spot → margin → futures) with no blockchain fees |
| F10 | **Balance Management** | Real-time balance tracking: available, locked (in open orders), frozen (under review) |

### Market Data

| # | Requirement | Description |
|---|------------|-------------|
| F11 | **Real-Time Prices** | Live ticker prices for all trading pairs with 24h change, volume, high/low |
| F12 | **Candlestick Charts** | OHLCV (open/high/low/close/volume) data at 1m, 5m, 15m, 1h, 4h, 1d intervals |
| F13 | **WebSocket Feeds** | Streaming order book updates, trade streams, ticker updates, user order updates |
| F14 | **Historical Data** | Downloadable trade history and candlestick data for analysis |

### Advanced Trading

| # | Requirement | Description |
|---|------------|-------------|
| F15 | **Margin Trading** | Cross-margin and isolated-margin leveraged trading with configurable leverage (up to 10x spot) |
| F16 | **Liquidation Engine** | Automatic position liquidation when margin ratio breaches maintenance threshold |
| F17 | **Lending Pool** | Users lend idle assets to margin traders; automatic interest accrual and distribution |
| F18 | **Fee Schedule** | Maker/taker fee model with volume-based VIP tiers; fee discounts for native token holders |

### Account and Compliance

| # | Requirement | Description |
|---|------------|-------------|
| F19 | **KYC Verification** | Tiered identity verification: basic (email), intermediate (ID), advanced (proof of address + source of funds) |
| F20 | **Sub-Accounts** | Institutional users create multiple sub-accounts with independent balances and API keys |
| F21 | **API Access** | REST API for account management; WebSocket API for real-time data; FIX protocol for institutional connectivity |

---

## Non-Functional Requirements

| Category | Requirement | Target |
|----------|------------|--------|
| **Matching Latency** | Order-to-fill latency (p99) | < 5ms |
| **Market Data Latency** | Trade event to WebSocket delivery | < 10ms |
| **Throughput** | Orders processed per second per pair | 100K+ |
| **Throughput** | Aggregate orders per second (all pairs) | 1M+ |
| **Availability** | Exchange uptime (annualized) | 99.99% (~52 min downtime/year) |
| **Durability** | Zero order loss after acknowledgment | RPO = 0 |
| **Consistency** | Matching engine state | Strongly consistent, deterministic |
| **Consistency** | Market data distribution | Eventual (< 10ms propagation) |
| **Security** | Cold wallet breach probability | Near-zero (HSM + MPC + air-gap) |
| **Security** | Hot wallet exposure | < 5% of total assets |
| **Deposit Latency** | Time from blockchain confirmation to balance credit | < 30s |
| **Withdrawal Latency** | Small automated withdrawal processing | < 5 min |
| **Scalability** | Horizontal scaling for market data | 10M+ concurrent WebSocket connections |
| **Compliance** | KYC verification turnaround | < 5 min automated, < 24h manual |
| **Data Retention** | Trade and order history | Indefinite (regulatory requirement) |

---

## Capacity Estimations

### User and Trading Activity

```
Registered users:              150M
Monthly active traders:         20M (13% MAU)
Daily active traders:            5M (25% of MAU)
Concurrent traders (peak):     500K

Trading pairs:                 500+
Average orders per trader/day:  50
Daily orders:                  250M (5M × 50)
Peak orders/sec:             1.4M (10x average during flash crash)
Average orders/sec:           ~3K per pair (top pairs), ~50 (long-tail pairs)

Fill rate:                     ~40% of orders result in trades
Daily trades:                 100M
Peak trades/sec:             100K
```

### Market Data

```
WebSocket subscribers (peak):      2M concurrent connections
Market data channels per pair:     4 (order book, trades, ticker, candles)
Total active channels:           2,000 (500 pairs × 4)
Updates per second (top pair):    50K (order book changes + trades)
Aggregate updates/sec (all):     500K
Fan-out messages/sec:            50M (500K updates × 100 avg subscribers per channel)
```

### Asset Management

```
Supported blockchains:          50+
Unique deposit addresses:       500M+ (one per user per chain)
Daily deposits:                 2M transactions
Daily withdrawals:              1M transactions
Daily deposit volume:           $2B
Daily withdrawal volume:        $1.5B

Hot wallet rebalance frequency: Every 15 min
Cold → warm → hot sweep:        4x per day
```

### Storage

```
Order events/day:              250M × 200 bytes = 50 GB/day (event log)
Trade records/day:             100M × 300 bytes = 30 GB/day
Order book snapshots:          500 pairs × 1MB × 1440 min = 720 GB/day
Candlestick data:              500 pairs × 6 intervals × 86400 pts = 1 GB/day
Blockchain transaction logs:   3M × 500 bytes = 1.5 GB/day
User account data:             150M × 2 KB = 300 GB (static)

Total daily ingest:            ~80 GB (structured) + 720 GB (snapshots)
Yearly storage (compressed):   ~30 TB (events) + ~50 TB (snapshots)
```

### Network Bandwidth

```
WebSocket outbound (peak):     50M msgs/sec × 200 bytes = 10 GB/s
REST API requests/sec:         200K (account queries, order status)
FIX protocol connections:      5,000 (institutional)
Blockchain node sync:          50 chains × varying bandwidth = ~500 Mbps aggregate
```

---

## SLOs and SLIs

| SLI | SLO | Measurement |
|-----|-----|-------------|
| Order acknowledgment latency (p99) | < 1ms | Time from gateway receipt to engine ACK |
| Order-to-fill latency (p99) | < 5ms | Time from order submission to fill event |
| Market data propagation (p99) | < 10ms | Time from trade to WebSocket delivery |
| API availability | 99.99% | Successful responses / total requests |
| Matching engine availability | 99.999% | Engine uptime excluding planned maintenance |
| Deposit credit latency | < 30s post-confirmation | Blockchain finality to balance update |
| Withdrawal broadcast latency | < 5 min (automated) | Approval to blockchain broadcast |
| Order book accuracy | 100% | Reconstructed book matches engine state |
| Balance accuracy | 100% | User balances match ledger entries |
| Proof of reserves accuracy | 100% | On-chain reserves ≥ sum of user balances |

### Error Budgets

| SLO | Budget (30-day) | Allowed Failures |
|-----|-----------------|------------------|
| 99.99% API availability | 4.3 min downtime | ~26K failed requests at 100K RPS |
| 99.999% matching engine | 26 sec downtime | Zero data loss during failover |
| < 5ms matching latency | 0.01% above 5ms | ~25K slow matches per day |
| 100% balance accuracy | 0 discrepancy | Zero tolerance; any mismatch = P0 |

---

## Edge Cases and Extreme Scenarios

| Scenario | Scale | Design Impact |
|----------|-------|---------------|
| **Flash crash** | BTC drops 30% in 5 minutes; 10× order spike | Matching engine input queue depth protection; circuit-breaker on gateway; liquidation engine rate limiting |
| **Exchange bank run** | 10× normal withdrawal volume sustained for hours | Hot wallet depletion → warm wallet auto-sweep → cold wallet emergency ceremony; transparent queue with ETAs |
| **New token listing** | 50K+ users place orders in first second | Pre-create matching engine; rate limit first 60s; stagger access by tier |
| **Blockchain halt** | Target chain stops producing blocks (Solana precedent) | Pause deposits/withdrawals for that chain; continue trading (exchange balance unaffected); show status page |
| **51% attack on a chain** | Attacker reverses confirmed deposits | Extended confirmation requirements; insurance fund absorption; emergency chain pause |
| **Market manipulation (spoofing)** | Large orders placed and cancelled rapidly to manipulate price | Order-to-cancel ratio monitoring; minimum resting time requirements; ML detection |
| **Dust attack** | Thousands of tiny deposits to exhaust address space | Minimum deposit thresholds per chain; address pooling for small amounts |
| **Stablecoin de-peg** | USDT/USDC trades at $0.95 instead of $1.00; arbitrage flood | Pair-specific circuit awareness; dynamic margin requirements on stablecoin pairs; alert compliance |
| **Exchange-specific token crash** | Platform's own token loses 80% value; fee discount holders panic-sell | Separate risk profile for native token; adjust fee tier recalculation frequency; disable native token margin collateral |
| **API key leak** | Institutional client's API key compromised; attacker drains account via API | IP whitelist enforcement; per-key withdrawal limits; anomaly detection on API usage patterns; kill-switch per key |

---

## Cost Estimation Framework

| Component | Unit Cost Basis | Monthly Estimate | Notes |
|-----------|----------------|------------------|-------|
| **Matching engine servers** | 10-20 bare-metal (dedicated cores) | $50-100K | CPU-optimized; no virtualization overhead |
| **WebSocket edge servers** | 200+ instances for 2M connections | $100-200K | Bandwidth-optimized; high connection count |
| **Balance database** | 8-16 shards with sync replication | $80-150K | High-IOPS NVMe storage |
| **Blockchain nodes** | 150+ nodes (3 per chain × 50 chains) | $100-200K | Full nodes + archive nodes for some chains |
| **HSM/MPC infrastructure** | 15+ HSM devices across 5 facilities | $30-50K | Includes facility costs and physical security |
| **Compliance tools** | KYC/AML SaaS + chain analysis | $200-500K | Per-verification and per-transaction pricing |
| **Bandwidth** | 10 GB/s peak WebSocket + API | $50-100K | Dominated by market data fan-out |
| **Total estimated** | — | **$700K-1.5M/month** | Excludes compliance staff and legal |

---

## Key Estimation Insights

1. **Matching engine is CPU-bound, not I/O-bound**: At < 5ms per order and 100K+ orders/sec, the engine does zero I/O during matching. All data is in-memory. This is why bare-metal with CPU pinning is essential---virtualization overhead and context switching are measurable at microsecond scale.

2. **Market data bandwidth dominates infrastructure cost**: At 10 GB/s peak outbound (50M msgs/sec × 200 bytes), WebSocket fan-out bandwidth is the single largest variable cost. Conflation (batching updates for non-HFT users) reduces this by 10×, making the difference between $100K/month and $1M/month in bandwidth costs.

3. **Balance DB writes are the hidden Slowest part of the process**: 100K trades/sec × 6 balance operations each = 600K writes/sec. Without batch net settlement, no relational database can sustain this. The 100ms batching window is the critical design decision that makes the system viable.

4. **Blockchain nodes are surprisingly expensive**: At 150+ nodes across 50 chains, node infrastructure costs $100-200K/month. Archive nodes (required for some chains) are particularly costly due to multi-terabyte storage requirements.

5. **Storage grows linearly and forever**: At ~80 GB/day of structured data (events + trades + orders), yearly storage approaches 30 TB. Regulatory requirements mandate indefinite retention. Compression (3-5× for event logs) and tiered storage (hot/warm/cold) are essential for cost control.

6. **Deposit addresses are a scaling challenge**: With 150M users × 50 chains = 7.5B potential addresses (if all users deposit on all chains), HD wallet derivation and address generation become a significant operational concern. In practice, most users use 2-3 chains, reducing this to ~500M active addresses.

7. **Peak-to-average ratio is extreme**: 1.4M peak orders/sec vs. ~3K average per pair. Flash crashes drive 10× spikes in minutes. This demands either over-provisioning (expensive) or extremely fast auto-scaling (which matching engines cannot do---they must be pre-provisioned). The answer is to always provision for 3× average per pair, with top pairs provisioned for 5× their peak.

8. **WebSocket connection count determines edge server fleet**: At 10K connections per edge server, 2M concurrent connections requires 200 edge servers. Each WebSocket connection costs ~100KB of kernel memory (TCP buffers), so a 10K-connection server needs ~1GB just for connection state.

---

## Estimation Cheat Sheet

| What | Formula | Result |
|------|---------|--------|
| Orders/sec (avg) | 250M / 86,400 | ~2,900 |
| Orders/sec (peak) | 2,900 × ~480 (flash crash 10×) | ~1.4M |
| Trades/sec (peak) | 1.4M × 40% fill rate × ~1/6 (burst) | ~100K |
| Daily event log | 250M × 200 B | ~50 GB |
| Daily trade records | 100M × 300 B | ~30 GB |
| WebSocket messages/sec | 500K updates × 100 avg subscribers | ~50M |
| Edge servers needed | 2M connections / 10K per server | ~200 |
| Balance DB writes/sec (raw) | 100K trades × 6 ops | ~600K |
| Balance DB writes/sec (batched) | 600K / 100 (100ms batch) | ~6K |
| Hot wallet target | Projected 4h withdrawal demand × 1.5 | Dynamic |
| Blockchain nodes | 50 chains × 3 min per chain | ~150+ |
| Deposit addresses | 150M users × ~3 chains avg | ~500M |

---

## Key Assumptions

1. **Single matching engine per pair**: Each trading pair has a dedicated matching engine instance (single-threaded, deterministic) to avoid distributed state complexity
2. **Event sourcing as truth**: The matching engine event log is the authoritative record; all downstream systems (balances, market data, analytics) derive from it
3. **Blockchain diversity**: Each blockchain has a dedicated deposit/withdrawal microservice due to fundamentally different protocols (UTXO vs account model)
4. **Tiered custody**: 90%+ of assets in cold storage; hot wallet holds only enough for anticipated withdrawal demand (rolling 4-hour window)
5. **Regulatory compliance**: Full KYC required for trading; travel rule compliance for inter-VASP transfers above threshold
6. **24/7 operation**: No maintenance windows for the matching engine; all upgrades via rolling deployment or hot-standby failover
