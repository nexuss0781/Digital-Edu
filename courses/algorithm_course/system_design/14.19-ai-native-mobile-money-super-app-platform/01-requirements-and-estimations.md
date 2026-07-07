# Requirements & Estimations — AI-Native Mobile Money Super App Platform

## Functional Requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-1 | **P2P Money Transfer** | User sends money to another registered user by entering recipient phone number, amount, and PIN; supports both on-network (same provider) and off-network (interoperable) transfers; confirmation via SMS to both sender and receiver; must work over USSD, app, and SMS channels |
| FR-2 | **Cash-In / Cash-Out via Agent Network** | Customer visits a physical agent to deposit cash (cash-in) or withdraw cash (cash-out); agent initiates transaction on their device, customer confirms via USSD PIN or app; agent's electronic float is debited/credited accordingly; transaction receipt sent via SMS |
| FR-3 | **Merchant Payment** | Customer pays a registered merchant via till number (USSD/app), QR code scan (app), or tap-to-pay (NFC-enabled devices); supports both online and offline merchants; merchant receives instant confirmation; daily settlement to merchant's wallet or linked bank account |
| FR-4 | **Bill Payment & Airtime Purchase** | Customer pays utility bills (electricity, water, TV), school fees, government levies, and purchases airtime/data bundles; integrates with 200+ billers via API; USSD menu-driven selection with saved frequent billers; automated recurring payments from app |
| FR-5 | **Savings Products** | Lock-away savings accounts with configurable goals and durations; automated sweep rules (save X% of every incoming transfer); interest accrual on savings balance; integration with partner banks for higher-yield fixed deposits; withdrawal restrictions based on product type |
| FR-6 | **Nano-Lending (Instant Micro-Loans)** | AI-scored instant loans from $1 to $500 disbursed to wallet in <30 seconds; automatic repayment deduction from incoming transfers; dynamic credit limits based on behavioral scoring; graduated lending (small first loan, increasing with repayment history); support for business nano-loans to merchant agents |
| FR-7 | **Micro-Insurance** | Embedded insurance products: hospital cash cover, life cover, crop insurance, device insurance; opt-in via USSD menu or auto-enrollment at transaction time; daily/weekly premium deduction from wallet; claims initiation via USSD or app; automated claims adjudication for simple cases |
| FR-8 | **Agent Float Management** | Real-time float balance tracking for 300,000+ agents; dealer hierarchy for float distribution; AI-predicted float requirements per agent per day; automated rebalancing alerts and dealer dispatch; agent performance dashboards; commission calculation and disbursement |
| FR-9 | **Cross-Border Remittance** | International money transfers between mobile money wallets across countries (Kenya↔Tanzania, Ghana↔Nigeria, etc.); real-time FX rate display; compliance with sender and receiver country regulations; corridor-specific limits and fees; integration with PAPSS for pan-African settlements |
| FR-10 | **Super App Mini-Apps** | Third-party developers build mini-apps (ride-hailing, e-commerce, ticketing) that run within the mobile money app; payments handled natively via wallet; developer API (Daraja-style) with OAuth-based authentication; sandbox environment for testing |
| FR-11 | **KYC Tiered Registration** | Progressive KYC: Tier 1 (phone number + basic info, low limits) → Tier 2 (ID document upload, medium limits) → Tier 3 (biometric verification, full limits); AI-assisted document verification; real-time ID validation against government databases |
| FR-12 | **USSD Fallback & Multi-Channel Access** | Every critical financial operation accessible via USSD (*334# style), smartphone app, and SMS command; channel-specific UX optimization; session continuity across channels where possible; offline transaction support with store-and-forward reconciliation |

---

## Out of Scope

| Item | Rationale |
|---|---|
| **Physical card issuance** | Focus is on phone-based and agent-based transactions; card programs are a separate product line |
| **Full banking license operations** | Platform operates under mobile money/e-money license, not full banking; deposits held in trust accounts at partner banks |
| **Cryptocurrency or digital asset trading** | Regulatory uncertainty in most African jurisdictions; separate compliance framework needed |
| **Stock market or investment products** | Beyond savings and micro-insurance; requires capital markets licensing |
| **Voice-based IVR transactions** | While relevant for accessibility, IVR adds a separate telephony infrastructure layer; USSD covers feature phone users |
| **White-label platform licensing** | Focus is on operating a single platform; licensing the technology stack to other MNOs is a business model decision, not a system design concern |

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| **P2P Transfer Latency (end-to-end)** | < 3 seconds (USSD), < 2 seconds (app) | USSD session timeout budget: 60–180s for entire flow; each step must complete in <3s to allow 6 steps in a 60s session |
| **USSD Menu Response Time** | < 500ms per screen | MNO USSD gateways impose response timeouts of 5–15s; platform must respond well under this to account for network latency |
| **Ledger Write Latency** | < 100ms | Double-entry ledger writes are on the critical path of every transaction; must be fast enough to leave budget for fraud checks and notifications |
| **Fraud Detection Latency** | < 200ms (inline), < 5s (async deep analysis) | Inline fraud check runs synchronously before ledger commit; high-risk transactions trigger async deep analysis that may reverse the transaction |
| **SMS Confirmation Delivery** | < 10 seconds for 95th percentile | SMS is the primary receipt for USSD users; delayed confirmation causes customer anxiety and support calls |
| **Credit Score Computation** | < 500ms for cached score, < 5s for fresh computation | Nano-loan approval must be near-instant; scores are pre-computed and cached, refreshed on each transaction |
| **Agent Float Query** | < 200ms | Agents check float balance frequently; slow queries impact agent productivity and transaction throughput |

### Reliability & Availability

| Metric | Target | Rationale |
|---|---|---|
| **Platform Availability** | 99.995% (26 min downtime/year) | Mobile money is critical financial infrastructure; any downtime affects millions of daily transactions and erodes trust |
| **Transaction Success Rate** | > 99.5% (excluding user-initiated cancellations) | Failed transactions create reconciliation problems and customer complaints; every failure requires manual investigation |
| **Zero Money Loss Guarantee** | Exactly-once ledger semantics; zero unreconciled discrepancies | Financial system: if money is debited from sender, it must be credited to receiver; any discrepancy is a regulatory and trust crisis |
| **Data Durability** | 99.9999999% (9 nines) | Transaction ledger is the system of record; losing ledger data means losing the financial truth |
| **USSD Session Completion Rate** | > 92% (sessions that complete the intended flow without timeout or drop) | Lower bound accounts for genuine user abandonment; drops below 90% indicate platform latency issues |
| **Recovery Time Objective (RTO)** | < 5 minutes for primary region failover | Extended outage means millions of users cannot access their money; RTO must be aggressive |
| **Recovery Point Objective (RPO)** | 0 (zero data loss for committed transactions) | Synchronous replication for ledger data; no committed transaction can be lost in failover |

---

## Capacity Estimations

### Baseline Assumptions

| Parameter | Value | Source |
|---|---|---|
| Registered users | 65 million | M-Pesa-scale platform across 5+ countries |
| Monthly active users | 40 million | ~60% MAU/registration ratio (industry standard) |
| Daily active users | 18 million | ~45% of MAU transact daily |
| Transactions per day | 90 million | ~5 transactions per DAU (P2P, payments, airtime, etc.) |
| Peak-to-average ratio | 3:1 | Payday spikes (25th–30th of month), holiday periods |
| Average transaction value | $8 | Mix of micro-transactions ($0.50 airtime) and larger P2P ($50+) |
| Active agents | 300,000 | Physical cash-in/cash-out points |
| USSD vs. App split | 55% USSD / 45% App | Feature phone majority but growing smartphone adoption |
| Countries of operation | 7 | Multi-jurisdiction deployment |

### Throughput Calculations

| Metric | Calculation | Result |
|---|---|---|
| **Average TPS** | 90M transactions ÷ 86,400 seconds | ~1,042 TPS |
| **Peak TPS** | 1,042 × 3 (peak ratio) | ~3,125 TPS |
| **Burst TPS** | 3,125 × 2.5 (payday + holiday overlap) | ~7,800 TPS |
| **Design capacity** | Burst TPS × 1.5 (headroom) | ~12,000 TPS |
| **USSD sessions/sec (peak)** | 3,125 × 0.55 (USSD share) | ~1,720 concurrent USSD sessions/sec |
| **SMS notifications/sec (peak)** | 3,125 × 2 (sender + receiver confirmation) | ~6,250 SMS/sec |
| **Fraud checks/sec (peak)** | 3,125 (every transaction) | ~3,125 evaluations/sec |

### Storage Estimations

| Data Type | Calculation | Annual Volume |
|---|---|---|
| **Transaction ledger** | 90M txns/day × 1 KB/txn × 365 days | ~33 TB/year |
| **USSD session logs** | 50M sessions/day × 500 bytes/session × 365 | ~9 TB/year |
| **Fraud feature vectors** | 90M txns/day × 2 KB features × 365 | ~66 TB/year |
| **Agent float snapshots** | 300K agents × 24 snapshots/day × 200 bytes × 365 | ~0.5 TB/year |
| **Credit score history** | 40M users × monthly recalc × 500 bytes × 12 | ~0.24 TB/year |
| **SMS delivery logs** | 180M messages/day × 300 bytes × 365 | ~20 TB/year |
| **Audit trail (regulatory)** | 90M events/day × 2 KB × 365 × 7-year retention | ~460 TB total |
| **Total hot storage (1 year)** | Sum of above | ~129 TB/year |

### Bandwidth Estimations

| Flow | Calculation | Bandwidth |
|---|---|---|
| **USSD gateway ↔ Platform** | 1,720 sessions/sec × 500 bytes avg payload | ~7 Mbps |
| **App ↔ API gateway** | 1,400 requests/sec × 5 KB avg | ~56 Mbps |
| **Platform ↔ SMS gateway** | 6,250 messages/sec × 300 bytes | ~15 Mbps |
| **Platform ↔ Partner banks** | 200 settlement batches/day × 10 MB avg | ~2 Mbps |
| **Inter-datacenter replication** | Synchronous ledger replication | ~50 Mbps |
| **Fraud ML inference** | 3,125 requests/sec × 3 KB feature vector | ~75 Mbps |
| **Total peak bandwidth** | Sum of above with 2× headroom | ~410 Mbps |

---

## SLO Error Budgets

| SLO | Monthly Budget | Daily Equivalent | Budget Burn Rate Alert |
|---|---|---|---|
| **Platform availability (99.995%)** | 2.16 minutes downtime | 4.3 seconds/day | Alert at 50% burn in first 25% of window |
| **Transaction success rate (>99.5%)** | 13.5M allowed failures/month (at 90M/day) | 450,000 failures/day | Alert at 1% hourly failure rate |
| **USSD session completion (>92%)** | ~120M incomplete sessions/month | 4M/day | Alert at 10% hourly incomplete rate |
| **Ledger consistency (100%)** | Zero tolerance | Zero tolerance | Any non-zero divergence = P0 |
| **Fraud detection latency (<200ms for 99%)** | 27M transactions may exceed 200ms/month | 900K/day | Alert at 3% hourly exceedance |
| **SMS delivery (<10s for 95%)** | 270M SMS may be delayed/month | 9M/day | Alert at 8% hourly delay rate |
| **P2P transfer latency (USSD <3s for 95%)** | 67.5M transactions may exceed 3s/month | 2.25M/day | Alert at 8% hourly exceedance |

### Error Budget Policies

- **Availability budget <50% remaining:** Freeze all non-critical deployments. Engage SRE team for reliability sprints.
- **Availability budget <25% remaining:** Cancel all deployments. Mandatory incident review for every budget-consuming event.
- **Availability budget exhausted:** Executive escalation. All engineering resources redirected to reliability remediation until budget replenishes.
- **Ledger consistency violation:** Immediate P0 incident regardless of magnitude. All deployments halted. Regulatory notification within 4 hours if unresolved.

---

## Hardware & Cost Estimates

### Per-Country Infrastructure (Kenya-Scale Market)

| Component | Specification | Quantity | Estimated Monthly Cost |
|---|---|---|---|
| **Ledger DB (Primary)** | 32-core, 256 GB RAM, 4 TB NVMe SSD, 15,000+ IOPS | 2 (active + sync replica) | $8,000 |
| **Ledger DB (Read Replicas)** | 16-core, 128 GB RAM, 2 TB SSD | 3 | $6,000 |
| **Transaction Engine** | 8-core, 32 GB RAM compute nodes | 12 (auto-scaling 8–20) | $5,500 |
| **USSD Gateway** | 4-core, 16 GB RAM, low-latency network | 6 (2 per major MNO) | $2,400 |
| **Session Cache Cluster** | 8-core, 64 GB RAM (in-memory) | 4 nodes | $3,200 |
| **Fraud ML Inference** | GPU-enabled (inference-optimized), 16 GB VRAM | 4 nodes | $6,000 |
| **Event Store** | 16-core, 64 GB RAM, 8 TB SSD | 3 (replicated) | $4,500 |
| **Object Storage (warm/cold)** | Managed object storage | ~50 TB/year growing | $1,500 |
| **Network (inter-AZ + MNO links)** | Dedicated links to 4–5 MNO gateways, inter-AZ sync | N/A | $4,000 |
| **SMS Gateway Costs** | Per-message SMS delivery via MNO bulk agreements | 180M SMS/day | $15,000 |
| **Load Balancers + CDN** | Layer 4/7 load balancing, DDoS protection | 2 (HA pair) | $1,200 |
| **Monitoring + Logging** | Time-series DB, log aggregation, alerting | Managed stack | $2,500 |
| **Total per Kenya-scale country** | | | **~$59,800/month** |

### Multi-Country Scaling

| Market Size | Example Countries | Estimated Monthly Infra Cost | Rationale |
|---|---|---|---|
| **Large (>30M users)** | Kenya, Nigeria, Tanzania | $50,000–$65,000 | Full HA setup, dedicated GPU inference, high SMS volume |
| **Medium (10–30M users)** | Ghana, Uganda, DRC | $25,000–$40,000 | Reduced replica count, shared ML inference, lower SMS volume |
| **Small (<10M users)** | Mozambique, Ethiopia, Cameroon | $12,000–$20,000 | Minimal HA, CPU-only fraud inference, reduced MNO gateway count |
| **Shared services** | ML training, analytics, settlement hub | $20,000–$30,000 | Centralized, amortized across all countries |
| **7-country deployment total** | | **~$250,000–$350,000/month** | |

### Cost Per Transaction

```
Monthly cost: ~$300,000 (7-country deployment)
Monthly transactions: 90M/day × 30 = 2.7 billion
Cost per transaction: $300,000 / 2,700,000,000 = $0.00011

Revenue per transaction (avg 0.5% fee on $8 avg): $0.04
Gross margin on infrastructure: ~99.7%

Key insight: Infrastructure cost is <0.3% of transaction fee revenue,
confirming that mobile money's unit economics are dominated by agent
commissions (40-60% of fees) and regulatory costs, not technology.
```

---

## Latency Budget Breakdown

### USSD P2P Transfer — End-to-End Latency Budget

The total USSD session timeout is 60–180 seconds. Each menu screen must return within the MNO-imposed per-screen timeout (5–15 seconds). The platform targets <500ms server-side processing per screen, leaving buffer for network latency.

| Phase | Component | Budget (P50) | Budget (P99) | Notes |
|---|---|---|---|---|
| **Screen 1: Main Menu** | Session creation + menu render | 50ms | 150ms | Cache hit for returning users; cold start for new sessions |
| **Screen 2: Recipient Entry** | Input validation + MSISDN format check | 30ms | 80ms | Local validation only; no network calls |
| **Screen 3: Recipient Lookup** | Name lookup from wallet registry | 120ms | 300ms | Cached for frequent recipients; DB lookup for new |
| **Screen 4: Amount Entry** | Fee computation + balance pre-check | 80ms | 200ms | Balance from cache; fee table in-memory |
| **Screen 5: PIN + Confirm** | PIN verify + fraud + ledger write + SMS dispatch | 290ms | 650ms | Critical path: bcrypt(8ms) + fraud(120ms) + ledger(65ms) + replication(20ms) + SMS(async) |
| **Total server-side** | All screens | **570ms** | **1,380ms** | Well within 20-second system budget |
| **User think time** | 5 screens × 8s average | ~40s | ~60s | Empirical from USSD session telemetry |
| **Network RTT (2G)** | 5 round-trips × 2-8s per RTT | ~15s | ~40s | Highly variable; 2G networks in rural areas |
| **Total session** | Server + user + network | **~56s** | **~101s** | Fits within 60-180s session window |

### Warm Path vs. Cold Path

| Path | Description | P50 Latency | P99 Latency | Trigger |
|---|---|---|---|---|
| **Warm (cached)** | Returning user, frequent recipient, cached balance and credit score | 290ms | 650ms | 75% of transactions |
| **Cold (uncached)** | New recipient lookup, stale credit score refresh, first session of day | 450ms | 1,100ms | 20% of transactions |
| **Extended (high-value)** | Synchronous deep fraud analysis for amounts >$100 | 2,200ms | 4,500ms | 5% of transactions |

---

## Read/Write Ratio Analysis

| Operation | Reads/sec (peak) | Writes/sec (peak) | Ratio | Notes |
|---|---|---|---|---|
| **Wallet balance check** | 8,500 | 0 | Read-only | Balance checks, mini-statements, pre-transaction validation |
| **P2P transfer** | 2 (balance reads) | 3 (debit + credit + fee entries) | 0.7:1 | Write-heavy; each transaction creates 3 ledger entries |
| **Agent float query** | 4,200 | 0 | Read-only | Agents check float frequently; served from cache |
| **Fraud feature retrieval** | 3,125 | 625 | 5:1 | Most features pre-computed; updated on each transaction |
| **Credit score lookup** | 1,800 | 50 | 36:1 | Scores cached; refreshed daily or on significant transaction |
| **USSD session state** | 12,000 | 6,000 | 2:1 | Read on every input; write on state transitions |
| **Transaction history** | 2,500 | 0 | Read-only | Mini-statements, support queries; served from read replicas |
| **Aggregate platform** | **34,125** | **9,800** | **3.5:1** | Overall read-heavy; but financial writes are on the critical path |

### Implications for Storage Architecture

- **Wallet balances:** Read-dominant. Cache aggressively in distributed cache with <1ms access. Write-through to ledger DB on every transaction.
- **Ledger entries:** Write-heavy. Append-only pattern enables WAL optimization. Partition by country + time for efficient archival.
- **USSD sessions:** Balanced. In-memory only; no disk persistence needed (sessions are ephemeral, 35s average lifetime).
- **Fraud features:** Read-dominant with frequent incremental updates. Pre-computed feature store with <5ms access latency.

---

## Growth Projections and Capacity Triggers

### Three-Year Trajectory

| Metric | Year 1 (Current) | Year 2 | Year 3 | Scaling Trigger |
|---|---|---|---|---|
| **Registered users** | 65M | 95M (+46%) | 135M (+42%) | Tier storage scaling at 80M, 110M |
| **DAU** | 18M | 28M | 40M | Ledger shard split at 25M DAU |
| **Daily transactions** | 90M | 155M | 240M | New ledger shards at 130M, 200M |
| **Peak TPS** | 7,800 | 13,500 | 21,000 | Fraud inference auto-scale at 10K, 15K TPS |
| **Countries** | 7 | 10 | 14 | New country deployment: 8-week lead time |
| **Active agents** | 300K | 440K | 600K | Float forecasting cluster scale at 400K, 500K |
| **Annual value** | $260B | $455B | $730B | Trust account scaling with partner banks |
| **Hot storage** | 129 TB | 220 TB | 355 TB | Storage tier expansion at 180 TB, 300 TB |

### Key Sizing Formulas

```
Ledger IOPS = Peak_TPS × entries_per_txn × replication_factor
  = 7,800 × 3 × 1.3 = 30,420 IOPS (current)
  = 21,000 × 3 × 1.3 = 81,900 IOPS (Year 3 → requires sharding)

USSD concurrent sessions = Peak_TPS × USSD_share × avg_session_duration
  = 7,800 × 0.55 × 35s = 150,150 (current)
  = 21,000 × 0.45 × 30s = 283,500 (Year 3 — USSD share declining)

SMS throughput = Peak_TPS × msgs_per_txn × 1.2 (retry overhead)
  = 7,800 × 2 × 1.2 = 18,720 SMS/sec (current peak)
  = 21,000 × 1.8 × 1.2 = 45,360 SMS/sec (Year 3 — fewer SMS as app grows)

Fraud feature store size = MAU × feature_vector_size
  = 40M × 2 KB = 80 GB (current — fits in memory cluster)
  = 88M × 2.5 KB = 220 GB (Year 3 — still fits with larger nodes)

Credit score graph = Active_users × avg_edges × edge_weight_size
  = 40M × 12 edges × 24 bytes = 11.5 GB (current)
  = 88M × 14 edges × 24 bytes = 29.6 GB (Year 3)
```

---

## Operational Constraints

### MNO-Imposed Constraints

| Constraint | Range | Impact on Design |
|---|---|---|
| **USSD session timeout** | 60–180 seconds (varies by MNO) | Entire transaction flow must complete within timeout; design for worst case (60s) |
| **USSD screen length** | 160–182 characters | All messages, error text, and disclosures must fit; forces SMS as overflow channel |
| **USSD gateway connections** | 50–500 per application | Connection pool management; can't burst beyond allocation |
| **SIM toolkit limitations** | STK apps limited to 128 KB on many SIM cards | Constrains rich client features for feature phones |
| **SMS delivery SLA** | 30–120 seconds "best effort" by MNOs | Cannot rely on SMS for time-critical confirmations |
| **USSD shortcode allocation** | Single shortcode per operator per market | Menu structure must accommodate all products under one *334# entry |

### Infrastructure Constraints (African Markets)

| Constraint | Detail | Mitigation |
|---|---|---|
| **Power reliability** | 4–12 hours daily outage in some regions | Cell towers on generator/solar backup; agent POS devices with 8h battery |
| **Internet backbone** | International bandwidth via undersea cables (limited, expensive) | Keep all critical processing in-country; only anonymized data crosses borders |
| **Data center availability** | Tier 3 data centers limited to capital cities | Primary + DR in-country; no multi-region within most African countries |
| **2G network prevalence** | 40–60% of mobile connections still 2G in rural areas | USSD and SMS must work on 2G; app requires 3G minimum |
| **Device constraints** | Feature phones with no app capability, limited memory | USSD as primary channel; agent-assisted for complex operations |
