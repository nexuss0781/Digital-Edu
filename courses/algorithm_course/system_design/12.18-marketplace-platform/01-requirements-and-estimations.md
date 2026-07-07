# 12.18 Marketplace Platform — Requirements & Estimations

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR-01 | **Listing creation** — Sellers can create listings with title, description, photos, price, quantity, category, and shipping options | Support draft, active, and archived states; photo upload up to 10 images per listing |
| FR-02 | **Search and discovery** — Buyers can search listings by keyword and filter by category, price range, location, and seller quality | Sub-200ms p99 search latency; new listings discoverable within 30 seconds of activation |
| FR-03 | **Listing recommendations** — Surface personalized recommendations on homepage and within search results based on buyer browse and purchase history | Real-time candidate generation; batch model training; near-real-time feature updates |
| FR-04 | **Cart and checkout** — Buyers can add listings to a cart, enter payment details, and complete purchase with inventory reservation | Atomic reservation + payment capture; prevent oversell across concurrent buyers |
| FR-05 | **Payment processing** — Charge buyer, hold funds in escrow, split disbursement to seller minus platform take rate and payment processing fee | PCI-DSS compliant; support credit/debit cards, digital wallets, and buy-now-pay-later |
| FR-06 | **Order management** — Both buyer and seller can view order status, tracking information, and delivery confirmation | Real-time status updates via webhook from shipping carriers |
| FR-07 | **Dispute resolution** — Buyers can open a dispute for non-delivery or item not as described; platform mediates and issues refunds or releases funds | Time-bounded buyer protection window (30 days for most categories); automated resolution for common patterns |
| FR-08 | **Reviews and ratings** — After order completion, both buyers and sellers can leave reviews and ratings for the counterparty | Review window: 60 days from delivery; fraud detection applied to all submitted reviews |
| FR-09 | **Seller payout** — Disburse seller net proceeds after escrow hold period; support bank transfer and digital wallet disbursement | Hold period varies by seller trust tier (2–7 days baseline); dispute-extended holds |
| FR-10 | **Trust and safety** — Detect and act on fraudulent listings, counterfeit goods, fake reviews, payment fraud, and account takeover | Multi-layer detection: automated signals, ML classifiers, human review queue |
| FR-11 | **Seller quality scoring** — Compute and maintain a multi-dimensional quality score per seller that feeds search ranking and payout timing | Updated asynchronously after each order completion, review, and policy action |
| FR-12 | **Messaging** — Buyers and sellers can communicate about listings and orders within a platform-monitored messaging channel | NLP scan for off-platform payment solicitation and prohibited content |
| FR-13 | **Notifications** — Send order, shipping, payment, dispute, and review notifications via email, push, and in-app channels | Templated, personalized, and time-sensitive delivery |
| FR-14 | **Seller onboarding and KYC** — Verify seller identity for large-volume merchants; collect tax information; enforce category-specific selling permissions | Tiered verification: lightweight for casual sellers, full KYB for business sellers above GMV thresholds |
| FR-15 | **Tax collection and remittance** — Collect applicable sales tax from buyers based on buyer and seller jurisdiction; remit to tax authorities | Marketplace facilitator tax obligations in 45+ US states; VAT in EU jurisdictions |

---

## Out of Scope

- **Fulfillment and logistics operations** — Third-party logistics, warehouse management, carrier contracting (assumed as external provider integrations)
- **Advertising platform** — Promoted listings, sponsored search, display advertising (separate ad-tech system)
- **Wholesale and B2B procurement** — Volume pricing, purchase orders, net-terms invoicing
- **Physical point-of-sale** — In-person transactions; this system covers digital marketplace only
- **Cryptocurrency payments** — Fiat currency only; crypto payment rails not in scope

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| Search query latency (p99) | ≤ 200 ms | Buyer experience; above 300ms causes measurable conversion drop |
| Listing indexing latency | ≤ 30 seconds from activation | Sellers expect near-immediate discoverability |
| Checkout transaction latency (p99) | ≤ 3 seconds | Payment processor round-trip + inventory reservation |
| Recommendation serving latency (p99) | ≤ 100 ms | Real-time serving from pre-computed candidates |
| Dispute resolution SLA (automated) | ≤ 24 hours for auto-resolvable cases | Buyer protection expectation; 72 hours for human review |
| Payout disbursement SLA | Within hold period + 1 business day | Seller cash flow dependency |
| Fraud detection latency (listing) | ≤ 5 minutes from listing creation | Block fraudulent listings before buyer exposure |
| Review fraud detection | ≤ 60 minutes from review submission | Batch detection acceptable; real-time for anomaly spikes |

### Reliability & Availability

| Metric | Target |
|---|---|
| Payment service availability | 99.99% (≤ 52 min/year) — financial operations |
| Search service availability | 99.95% (≤ 26 min/month) |
| Order management availability | 99.99% — transactional data |
| Listing service availability | 99.9% — creation can tolerate brief outages |
| Inventory reservation consistency | Exactly-once reservation semantics; no oversell |
| Payment idempotency | All payment operations idempotent; duplicate requests safe |

### Scalability

| Metric | Target |
|---|---|
| Active listings in search index | 300M+ listings; sub-linear query time growth |
| Peak checkout transactions | 50,000 transactions/minute (holiday peak) |
| Listing creation throughput | 10,000 new listings/minute |
| Search queries | 500,000 queries/minute at peak |
| Concurrent buyers in checkout | 200,000 simultaneous sessions |

### Security & Compliance

| Requirement | Specification |
|---|---|
| Payment data | PCI-DSS Level 1 compliance; cardholder data never touches platform servers (tokenization) |
| Seller identity | KYC for merchants above regulatory thresholds; AML transaction monitoring |
| Buyer data | GDPR/CCPA compliant; data minimization for payment data; right-to-deletion workflow |
| Fraud monitoring | Real-time transaction scoring; velocity checks; device fingerprinting |

---

## Capacity Estimations

### Scale Assumptions

**Platform profile:**
- 50M monthly active buyers, 5M active sellers
- 300M active listings at any given time
- 5M orders per day
- Average order value (AOV): $45
- Daily GMV: 5M × $45 = $225M
- Take rate: 8% → daily platform revenue: ~$18M

### Listing Volume

```
Active listings:          300M
New listings/day:         3M  (sellers re-list + new items)
New listings/minute:      3M / 1440 = ~2,100/min (average)
Peak listing creation:    10,000/min (3x average during seller peak hours)

Listing record size:
  Metadata (title, price, category, etc.): ~2 KB
  Photo references (not photos): ~200 bytes × 10 photos = 2 KB
  Seller + shipping data:                  ~500 bytes
  Total per listing:                       ~5 KB

Total listing storage:
  300M × 5 KB = 1.5 TB (metadata only; photos in object storage)
```

### Search Index

```
Search index document (per listing):
  Title tokens + vector embedding: ~4 KB
  Categorical filters (structured): ~500 bytes
  Seller quality signals:           ~200 bytes
  Behavioral signals (CTR, CVR):    ~300 bytes
  Total per document:               ~5 KB

Total index size:
  300M × 5 KB = 1.5 TB raw index data
  With replicas (3×) + inverted index overhead (2×): ~9 TB

Query throughput:
  500,000 queries/min = ~8,300 QPS
  With fan-out to N shards (N=50): 8,300 × 50 = 415,000 shard-level QPS
  Each shard serves ~6M docs; query time ≤ 5ms per shard
  Total response assembled in ≤ 20ms at search layer before re-ranking (200ms budget remaining)
```

### Transaction Volume

```
Orders/day:                 5M
Orders/second (average):    5M / 86,400 = ~58 orders/sec
Peak (holiday, 5× avg):     ~290 orders/sec = ~17,400 orders/min

Per-order operations:
  Inventory reservation:    1 DB write (optimistic lock)
  Payment capture:          1 payment processor API call (~800ms latency)
  Escrow record creation:   1 DB write
  Order record:             1 DB write
  Notification trigger:     1 queue message

Payment processor API calls:
  290 peak orders/sec × 1 call = 290 calls/sec
  (within payment processor rate limits with connection pooling)
```

### Escrow and Payout

```
Active escrow accounts:
  5M orders/day × 5-day avg hold = 25M open escrow records at any time
  Each record: ~500 bytes → 12.5 GB active escrow state

Payout volume:
  5M orders/day × 70% reach payout (30% disputed/cancelled) = 3.5M payouts/day
  3.5M × $41 avg seller net (AOV $45 × 8% take rate × ~2% payment fee) = $140M/day disbursed
  Batch disbursement: 2 runs/day for standard sellers; 1 run/day for new sellers
```

### Photo Storage

```
Average photos per listing:    6
Average photo size (compressed): 800 KB
Total photo storage:
  300M listings × 6 × 800 KB = 1.44 PB

New photo uploads/day:
  3M new listings × 6 photos × 800 KB = 14.4 TB/day ingested
  (Stored in object storage with CDN caching for buyer-facing delivery)
```

### SLO Summary

| SLO | Target | Measurement Window |
|---|---|---|
| Search p99 latency | 200 ms | Rolling 1-hour |
| Checkout transaction p99 | 3 s | Rolling 1-hour |
| Inventory reservation accuracy | 0 oversells (hard constraint) | Per-incident |
| Payment capture success rate | ≥ 99.5% (excluding declined cards) | Daily |
| Listing indexing latency | 95th percentile ≤ 30 s | Rolling 1-hour |
| Dispute auto-resolution SLA | 95% within 24 hours | Weekly |
| Payout on-time rate | 99.9% within hold period + 1 BD | Weekly |
| Fraud listing removal | 95% within 60 minutes of detection | Daily |

---

## Growth Projections and Maturity Model

### Platform Maturity Stages

| Stage | Timeline | Sellers | Listings | Daily Orders | Daily GMV | Platform Take |
|---|---|---|---|---|---|---|
| **Seed** | Month 0–6 | 1K–10K | 50K–500K | 1K–10K | $50K–$500K | 5–10% |
| **Growth** | Month 6–18 | 10K–100K | 500K–10M | 10K–100K | $500K–$5M | 8–12% |
| **Scale** | Month 18–36 | 100K–1M | 10M–100M | 100K–1M | $5M–$50M | 8–15% |
| **Mature** | Month 36+ | 1M–5M+ | 100M–500M+ | 1M–5M+ | $50M–$500M+ | 10–18% |

### Infrastructure Scaling by Stage

| Component | Seed | Growth | Scale | Mature |
|---|---|---|---|---|
| Search Cluster | 3 nodes | 10 nodes | 50 shards × 3 replicas | 100 shards × 3 replicas |
| Primary DB | Single replica set | 4 shards | 16 shards | 64+ shards |
| Event Bus | 3 partitions | 20 partitions | 100 partitions | 500+ partitions |
| Cache Layer | Single node | 3-node cluster | 10-node cluster | 30+ node cluster |
| Payment Processing | Single processor | Primary + backup | Multi-processor with regional routing | Regional processors + instant payout rails |
| Photo Storage | < 1 TB | < 50 TB | < 500 TB | 1+ PB |
| Trust/Fraud | Rule-based | ML classifier | Graph DB + real-time scoring | Real-time graph + streaming fraud detection |

### Key Capacity Thresholds (When to Scale)

| Threshold | Indicator | Action Required |
|---|---|---|
| > 10M listings | Search index no longer fits single node | Shard search index; implement fan-out query |
| > 1,000 orders/minute | Single payment processor rate limit | Add secondary processor; implement queue-based smoothing |
| > 100M listings | Full-index rebuild takes > 24 hours | Incremental indexing only; abandon full rebuilds |
| > 50K sellers | Manual KYC review infeasible | Automated KYC with ML-based document verification |
| > 10,000 disputes/day | Human review queue exceeds SLA | Expand automated resolution patterns; ML-based evidence scoring |
| > $100M daily GMV | Escrow float exceeds banking partner limits | Multi-bank escrow; segregated trust accounts |
| > 500M listings | Search fan-out to all shards exceeds latency budget | Category-aware sharding; query routing optimization |

### Cost Estimation by Stage

| Cost Category | Seed | Growth | Scale | Mature |
|---|---|---|---|---|
| Compute (services) | $3K/month | $25K/month | $150K/month | $800K/month |
| Storage (metadata + index) | $500/month | $5K/month | $40K/month | $200K/month |
| Photo storage + CDN | $1K/month | $15K/month | $100K/month | $500K/month |
| Payment processing fees | Variable (2.9% + $0.30) | Variable | Variable | Negotiated volume rates |
| Trust & Safety team | 1 analyst | 5 analysts | 25 analysts | 100+ analysts |
| **Total platform cost** | **~$10K/month** | **~$80K/month** | **~$500K/month** | **~$2.5M/month** |

**Unit economics check:** At Mature stage, $2.5M/month platform cost on $500M/day × 30 = $15B/month GMV at 12% take rate = $1.8B/month revenue. Platform cost is < 0.15% of revenue — well within healthy marketplace economics.

---

## Organizational Requirements

### Team Structure at Scale

| Team | Size | Responsibilities | Key Metric |
|---|---|---|---|
| **Search & Discovery** | 15–25 engineers | Search indexing, ranking models, recommendation engine, query understanding | Search conversion rate, NDCG |
| **Payments & Financial** | 10–20 engineers | Payment processing, escrow, disbursement, tax, reconciliation | Payout on-time rate, reconciliation accuracy |
| **Trust & Safety** | 10–15 engineers + 25–100 analysts | Fraud detection, review integrity, policy enforcement, ATO prevention | Fraud removal rate, dispute rate |
| **Seller Platform** | 8–12 engineers | Seller onboarding, listing tools, seller analytics, KYC | Seller activation rate, listing quality |
| **Order Management** | 8–12 engineers | Checkout, inventory, order lifecycle, shipping integration | Checkout conversion, oversell rate |
| **Platform Infrastructure** | 10–15 engineers | Database, event bus, caching, observability, CI/CD | Service availability, deploy frequency |
| **Data & ML** | 8–12 engineers | Feature engineering, model training, A/B testing infrastructure | Model accuracy, experiment velocity |

### Read/Write Ratio Analysis

| Workload | Read:Write | Dominant Operation |
|---|---|---|
| Search queries | 500:1 | Search reads vastly exceed listing writes |
| Listing browsing | 100:1 | Page views exceed listing creation |
| Order management | 10:1 | Order status reads vs. state transitions |
| Seller quality scores | 200:1 | Score reads (every search) vs. score recomputation |
| Review reads vs. writes | 50:1 | Review display vs. review submission |
| Escrow ledger | 1:1 | Every write triggers a reconciliation read |

**Overall weighted ratio: ~100:1 (read-heavy with write-critical financial paths)**

---

## Extended Feature Requirements (2025–2026)

| # | Requirement | Description |
|---|---|---|
| E1 | **AI-Powered Listing Optimization** | LLM generates optimized titles, descriptions, and category assignments from seller-uploaded photos; reduces listing quality gap between professional and casual sellers |
| E2 | **Semantic Search** | Buyers search by intent ("something to wear to a beach wedding") using hybrid vector + lexical retrieval rather than exact keyword match |
| E3 | **Seller Financing** | Working capital loans to sellers based on projected future receivables; loan repayment deducted from payouts automatically |
| E4 | **Buyer Installment Plans** | Buy-now-pay-later integration allowing buyers to split payments over 4–6 installments; escrow holds full amount, installment risk carried by financing partner |
| E5 | **Real-Time Fraud Graph** | Streaming graph database for millisecond coordinated fraud detection, replacing nightly batch graph analysis |
| E6 | **Seller Analytics Platform** | Self-serve dashboard showing real-time conversion, pricing intelligence, competitive positioning, and ranking factors |
| E7 | **Cross-Border Shipping Integration** | Automated customs declarations, duty estimation at checkout, and carrier selection for international orders |
| E8 | **Visual Search** | Buyers search by photo upload; image embedding matched against listing photo embeddings for visual similarity retrieval |

---

## Marketplace Economics Model

Understanding the economic constraints that shape architecture:

```
Revenue per transaction:
  Order value (AOV):             $45.00
  Take rate (8%):               -$3.60  → Platform revenue
  Payment processing (2.9% + $0.30): -$1.61  → Payment processor
  Fraud loss rate (0.5% of GMV):     -$0.23  → Platform absorbs
  Tax remittance:                $variable → Pass-through to tax authority
  Seller net:                    $39.56  → Disbursed to seller

Unit economics per order:
  Revenue:                       $3.60
  Payment processing cost:       $1.61
  Fraud loss allocation:         $0.23
  Infrastructure cost per order: ~$0.02 (amortized compute + storage)
  Trust & Safety cost per order: ~$0.05 (human review prorated)
  Net contribution per order:    $1.69

Break-even analysis:
  Fixed costs (platform team + infrastructure): ~$2.5M/month at Scale stage
  Break-even daily orders: $2.5M / (30 × $1.69) = ~49,300 orders/day
  At 5M orders/day: contribution = $8.45M/day → well above break-even
```

**Architectural implication:** The $0.02 infrastructure cost per order means the platform can afford to over-provision for reliability. The $1.61 payment processing cost per order means optimizing payment processor selection (negotiating volume discounts, routing to cheapest eligible processor) has 80× more economic impact than infrastructure optimization.
