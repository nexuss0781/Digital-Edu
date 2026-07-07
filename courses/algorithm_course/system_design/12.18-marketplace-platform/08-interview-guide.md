# 12.18 Marketplace Platform — Interview Guide

## Overview

Designing a two-sided marketplace is a senior/staff-level system design question that tests breadth across distributed transactions, search and ranking, trust systems, financial architecture, and network effects thinking. Unlike single-sided platform questions (e.g., "design a social feed"), marketplace questions require candidates to simultaneously consider two user populations with opposing incentives and a platform that mediates between them. The hardest problems are not infrastructural (scaling a database) but architectural (how do you maintain consistency across inventory, payment, escrow, and order state without 2PC across microservices?).

**Typical time allocation:** 45–55 minutes

---

## 45-Minute Interview Pacing

| Phase | Time | Focus |
|---|---|---|
| Requirements clarification | 5–7 min | Two-sided nature, scale, key features (search? payments? reviews?) |
| Back-of-envelope estimation | 5–7 min | Listings count, QPS, storage, transaction volume |
| High-level architecture | 8–10 min | Core services, data flow, key design decisions |
| Deep dive (interviewer-directed) | 12–15 min | Search ranking OR payment escrow OR trust & safety |
| Extensions and trade-offs | 5–7 min | Fraud, consistency, multi-region, seller quality |
| Wrap-up and questions | 2–3 min | |

---

## Opening Phase: Requirements Clarification

### Questions the Candidate Should Ask

**Scope definition:**
- "Is this a physical goods marketplace or does it also include digital goods and services?"
- "Are we building for both buyers and sellers, or focusing on one side first?"
- "What's the primary differentiator we're optimizing for — breadth of selection, price, trust, or speed of delivery?"

**Scale:**
- "What's the approximate number of active listings? Millions or hundreds of millions?"
- "What's the daily transaction volume and average order value?"
- "What's our target search latency — sub-100ms or is 500ms acceptable?"

**Features:**
- "Is an escrow/buyer protection system required, or do we trust sellers to fulfill?"
- "Do we need a review and rating system in scope?"
- "Is dispute resolution in scope, or handled by a human team outside the system?"

**Trust and compliance:**
- "What's the seller mix — mostly businesses, individual casual sellers, or both?"
- "Are we handling payments ourselves, or integrating with an external payment processor?"
- "Are there specific regulatory markets in scope (EU, US) that affect compliance requirements?"

### Strong Candidate Signal

A strong candidate immediately identifies the two-sided nature as the central design challenge—that optimizing for buyer experience (breadth, relevance, low price) can conflict with seller experience (visibility, fast payout, minimal fees)—and asks which side the platform is more willing to trade off. They also quickly identify the atomic transaction challenge: inventory reservation, payment, and escrow creation must succeed together or roll back together.

---

## Deep Dive Phase: Common Interviewer Probes

### Deep Dive 1: Search Ranking Architecture

**Interviewer prompt:** "How would you design the search ranking system for 300 million listings? Walk me through the architecture."

**Strong response covers:**
- Multi-stage pipeline necessity: ANN recall → LTR re-rank → hard filters → personalization (not a single scoring function applied to all 300M)
- Feature groups: relevance (title match), quality (seller score), behavioral (CTR, conversion), freshness (listing age), price signals
- Near-real-time indexing for new listings (not batch rebuild)
- Separation of availability signal from rank signal (availability cache updated on every sale; rank index updated on a slower cycle)
- How seller quality score acts as a multiplicative rank modifier (not a separate filter)
- Offline evaluation via NDCG against human-labeled queries; online evaluation via A/B on conversion

**Trap question:** "Why not just use a keyword search with seller rating as a filter? That seems simpler."

**Expected answer:** Keyword-only search fails for semantic queries ("something to wear to a beach wedding" won't match listings that say "floral sundress"). Rating as a hard filter penalizes new sellers with no reviews, harming supply-side diversity and disadvantaging legitimate new entrants. Learning-to-rank treats seller quality as a soft signal, not a binary gate—a highly relevant listing from a new seller can still rank above an irrelevant listing from a top-rated seller.

---

### Deep Dive 2: Payment Escrow and Consistency

**Interviewer prompt:** "Walk me through what happens between a buyer clicking 'Buy Now' and the seller receiving payment. What are the consistency challenges?"

**Strong response covers:**
- Two-phase inventory reservation (soft reserve at cart → hard commit at payment capture) with TTL to release abandoned carts
- Saga pattern for checkout: reserve → authorize → capture → create escrow → confirm order; each step has a compensating transaction
- Why 2PC (two-phase commit) is not the right answer: it requires all participating services to implement the XA protocol, creates tight coupling, and a coordinator failure leaves the transaction in doubt indefinitely
- Escrow as a separate financial ledger (append-only), not a balance in the operational database
- Multi-party split calculation: order total − platform fee − processing fee − tax remittance = seller net
- Disbursement hold period tied to seller trust tier; dispute as an escrow-freeze trigger

**Trap question:** "Can't you just use a database transaction to handle all of this atomically?"

**Expected answer:** A database transaction works within a single database but fails across service boundaries. The order record, inventory reservation, payment authorization, and escrow creation span at least three different services and likely three different databases. Wrapping them in a distributed transaction (2PC) creates a system that is fragile under network partitions and doesn't degrade gracefully. The saga pattern accepts that individual steps may fail and defines compensating actions (rollbacks) for each, resulting in eventual consistency without cross-service transaction coordination.

---

### Deep Dive 3: Trust & Safety System

**Interviewer prompt:** "How do you detect and prevent fake reviews on your marketplace?"

**Strong response covers:**
- Purchase verification as a hard gate (reviews only allowed after confirmed order delivery)
- Velocity signals (burst of reviews for a new seller within 24 hours)
- Graph analysis: bipartite reviewer-seller graph; coordinated attack creates dense subgraph of reviewers with no other review history
- Linguistic fingerprinting: review farms often produce syntactically similar text despite surface variation
- IP and device clustering: multiple reviewers from the same IP subnet
- Account age and review history: reviewer accounts that only review one seller are suspicious
- ML classifier trained on confirmed fraud patterns; fraud score triggers human review or suppression
- Retrospective suppression: when a coordinated campaign is detected, retroactively suppress all reviews from the campaign (not just the latest batch)

**Trap question:** "Why not just require verified purchases before allowing any review?"

**Expected answer:** Verified purchase requirement is correct and should be a hard gate. But it's not sufficient—fake reviewers can purchase cheap items (or collude with a seller to generate fake purchase records) and then leave fake reviews. The detection must go beyond purchase verification to behavioral and graph-based signals. Additionally, verified purchase requirement only addresses fake positive reviews; it doesn't catch competitor bombing (real buyer accounts leaving malicious negative reviews).

---

## Extension Questions

### Extension 1: New Seller Cold Start

"A brand new seller with no reviews, no order history, and no shipping record joins the platform. How does your ranking system handle them, and what's the risk?"

Good answer covers:
- New sellers default to a "new" trust tier with conservative search boost (below average)
- Risk: perpetual cold start trap — no visibility → no sales → no reviews → no visibility
- Mitigation: category-specific new seller boost for first 30 days OR first N listings; separate "new sellers" search facet
- Platform incentive alignment: platform needs new seller supply, so deliberately surfacing some new seller inventory is in the platform's long-term interest

### Extension 2: Multi-Currency and Cross-Border

"How does your payment and escrow system handle transactions between a US buyer and a Japanese seller?"

Good answer covers:
- FX conversion at order time vs. disbursement time (rate lock exposure to platform)
- Separate payment processor routing for regional payment methods (bank transfers in Japan are common; cards less so)
- International wire fees for disbursement; minimum payout thresholds to make cross-border economically viable
- Local currency escrow vs. converted escrow (accounting complexity)
- Additional KYC/KYB for cross-border sellers (FATF compliance, OFAC sanctions)

### Extension 3: Counterfeit Goods Detection

"A seller lists a product claiming it's a luxury brand. How do you detect and prevent counterfeit listings?"

Good answer covers:
- Brand protection program: authorized brand owners register trademarks; platform uses NLP to identify listings mentioning protected brands
- Price anomaly detection: listing claiming to be a $3,000 item priced at $200 is suspicious
- Image-based detection: seller photos can be compared to official brand product photos (similarity models); unauthorized use of brand imagery
- Proactive vs. reactive: proactive scan at listing creation; reactive from brand owner and buyer reports
- Graduated response: low-confidence → manual review; high-confidence → immediate hold pending seller verification
- Legal safe harbor: marketplace is protected under DMCA safe harbor if it acts promptly on verified brand owner complaints

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---|---|---|
| Single-sided design (optimizing only for buyers) | Ignores that seller retention and growth are equally critical | Explicitly model both buyer and seller experience at each design decision |
| 2PC for checkout consistency | Fragile across service boundaries; coordinator failure leaves transactions in doubt | Saga pattern with compensating transactions |
| Batch search index refresh | New listings invisible for hours after creation | Near-real-time incremental indexing with hot overlay |
| Hard filtering on seller rating | Freezes out new sellers; damages supply diversity | Soft ranking modifier, not a filter threshold |
| Treating reviews as just star ratings | Misses the fraud detection architecture entirely | Graph-based fraud detection, velocity analysis, purchase verification gate |
| Not separating escrow from operational DB | Financial records require different durability, compliance, and audit requirements | Append-only escrow ledger as a separate financial system |
| Ignoring the payout timing problem | Sellers need predictable cash flow; buyers need refund availability | Explicit escrow release conditions + trust-tier-based hold periods |
| No discussion of seller quality score | Quality score is the single most cross-cutting signal in the system | Introduce seller quality score early and trace its effects on ranking, payouts, and trust |

---

## Scoring Rubric

### Basic (passing score)
- Identifies key entities: listings, orders, buyers, sellers
- Designs basic checkout flow with payment
- Proposes search functionality with keyword matching
- Mentions review/rating system

### Intermediate (strong hire)
- Multi-stage search pipeline with LTR ranking
- Escrow-based payment with conditional release
- Inventory reservation to prevent oversell
- Review fraud detection at least one signal (purchase verification)
- Seller quality score as a ranking input

### Advanced (exceptional hire / staff)
- Saga pattern with compensating transactions for checkout
- Four-stage search pipeline with feature group breakdown
- Seller quality score as a multi-dimensional, asynchronously computed signal feeding multiple downstream systems
- Graph-based review fraud detection
- Payment compliance architecture (PCI tokenization, KYC tiers, AML monitoring)
- Trust tier system with payout hold periods
- Graceful degradation modes for search and payment processor failover
- Near-real-time index update with availability cache separation

### Signals of Exceptional Depth
- Unprompted discussion of the cold start problem for new sellers and how to balance it against fraud risk
- Recognizes that take rate is a business metric that the platform system must protect (accurately compute and collect across all order scenarios including disputes and refunds)
- Frames inventory reservation TTL as a competitive tool (too short → buyer frustration; too long → listing appears unavailable → lost GMV)
- Identifies the bidirectional dispute problem: fake positive reviews AND competitor bombing require different detection strategies
- Discusses the seller cash flow dependency on payout timing and how payout hold period is a trust lever, not just a fraud control

---

## Interviewer Testing Signals

Use these prompts to test specific depth:

| Test | Prompt |
|---|---|
| Consistency understanding | "Two buyers simultaneously click 'Buy Now' on the same single-quantity listing. Walk me through what happens." |
| Financial integrity | "A checkout completes but the escrow creation fails. What does your system do?" |
| Review fraud depth | "A sophisticated competitor buys 50 real items from our seller over 6 months, then leaves 50 one-star reviews. How do you detect this?" |
| Search freshness | "A seller lists an item and a buyer searches for it 15 seconds later. Is the listing in the results?" |
| Trust system tension | "A seller has a 4.8 star average but all their reviews are from accounts created in the last month. How does your quality score handle this?" |
| Payout compliance | "A new seller sells $25,000 in their first week. What happens to their payouts?" |
| Graceful degradation | "Your payment processor goes down during Black Friday. What does the buyer experience, and what happens to in-flight orders?" |

---

## Additional Trap Questions

### Trap Question 4: "Why Not Use a Single Database for Everything?"

**Expected answer:** Different components have fundamentally different requirements that a single database cannot satisfy simultaneously:
- **Search** needs inverted indexes and vector similarity — relational databases lack these natively at 300M scale
- **Escrow ledger** needs append-only immutability with financial-grade durability — cannot share transaction boundaries with order CRUD
- **Trust/fraud** needs graph traversal for reviewer-seller relationships — JOIN-based graph analysis becomes prohibitively expensive at scale
- **Availability cache** needs sub-millisecond boolean lookups at 300M keys — a purpose-built structure fits in RAM on a single node

A single database would create a system where every component's performance and failure mode is coupled. A search index rebuild would compete for I/O with payment processing.

### Trap Question 5: "Can't You Just Rebuild the Search Index Nightly?"

**Expected answer:** A nightly rebuild means new listings are invisible for up to 24 hours. For a marketplace where sellers expect near-immediate visibility, this causes seller churn. It also means sold-out listings appear in search results for hours after sale, creating buyer frustration and wasted engagement. The production requirement is near-real-time incremental indexing (< 30 seconds for new listings) plus a separate availability cache (< 100ms for sold-out filtering). A full rebuild may still run periodically (weekly) for compaction and consistency, but it cannot be the primary freshness mechanism.

### Trap Question 6: "Why Not Just Ban New Sellers from High-Value Categories?"

**Expected answer:** This solves fraud at the cost of killing supply growth in the most lucrative categories. High-value categories (electronics, luxury goods) are precisely where the marketplace earns the most revenue. Banning new sellers means the marketplace's supply diversity degrades over time as existing sellers churn. The correct approach is graduated friction: require additional verification (enhanced KYC) for high-value categories, start with lower listing limits and extended payout holds, and use the sandbox period to collect behavioral signals before expanding access.

---

## Discussion Talking Points

### When NOT to Build a Marketplace

A marketplace is the wrong architecture when:
- **Inventory is controlled:** If the platform sources and warehouses all products, it's a retailer, not a marketplace. Use an e-commerce architecture instead.
- **Trust is unnecessary:** If transactions are low-risk (free listings, no payment), the escrow/trust infrastructure is overhead. Use a classifieds architecture.
- **One side is homogeneous:** If all sellers offer identical fungible products (commodity trading), the two-sided dynamics disappear. Use an exchange/auction architecture.
- **Network effects don't apply:** If buyer and seller pools don't grow together (supply is fixed), the marketplace flywheel doesn't engage.

### Key Numbers Every Marketplace Engineer Should Know

| Metric | Typical Value | Why It Matters |
|---|---|---|
| Take rate | 5–20% | Below 5%: unsustainable economics. Above 20%: sellers leave for competitors |
| Checkout conversion rate | 2–8% | Baseline for measuring payment/UX changes |
| Dispute rate | 1–5% of orders | Above 5%: trust crisis. Below 1%: possibly under-reporting |
| Review fraud rate | 5–15% of reviews | Even "clean" marketplaces have significant fake review rates |
| Search zero-result rate | 1–5% | Above 5%: inventory gaps or query understanding failures |
| Payout hold period | 2–14 days | Too short: fraud risk. Too long: seller cash flow pressure |
| Escrow float | 3–5 days of GMV | Determines banking partner requirements |
| New seller 90-day survival | 20–40% | Most new sellers churn within 90 days |
| Top 10% seller GMV share | 60–80% | Power law distribution is normal |

### System Design Sketch Guide

When whiteboarding a marketplace in an interview, prioritize these components in this order:

```
1. Start with two user types (buyer + seller) and the API gateway
   → Shows you immediately recognize the two-sided nature

2. Add the critical-path services: Search, Order, Payment
   → These are the minimum viable marketplace

3. Add the data stores: Primary DB, Search Index, Escrow Ledger
   → Demonstrates you understand data segregation (especially escrow)

4. Add the event bus between services
   → Shows you know cross-service coordination is async

5. Add trust layer: Fraud Detector, Trust Scorer
   → Demonstrates you see trust as a first-class architectural concern

6. Draw the checkout flow as a saga (not a transaction)
   → The single strongest signal of senior-level understanding
```

**Common whiteboard mistakes:**
- Drawing a single "Database" box — escrow, search, and operational data have different requirements
- No event bus — implies synchronous service-to-service calls
- Missing the seller quality score — the most cross-cutting signal in the system
- No mention of availability vs. ranking index separation
- Treating payment as a simple API call rather than an escrow lifecycle

---

## Advanced Discussion Topics

### Topic: Marketplace vs. Retailer Architecture

"What would change in your architecture if the platform owned the inventory instead of sellers?"

**Expected discussion points:**
- Inventory model shifts from seller-managed to centralized warehouse management
- No need for seller quality score, escrow, or trust tiers — platform controls fulfillment
- No need for two-sided search ranking (no seller diversity concern)
- Payment simplifies: direct charge, no escrow, no split disbursement
- Fraud surface shrinks: no fake sellers, no review manipulation by sellers
- But: massive capital requirement (purchasing inventory), warehouse operations, supply chain risk
- Hybrid models exist: platform-owned for high-velocity items, marketplace for long-tail

### Topic: Marketplace Network Effects and Tipping Points

"At what point does a marketplace become defensible?"

**Expected discussion points:**
- Liquidity threshold: the point where a buyer can reliably find what they want (varies by category)
- Supply-side lock-in: sellers invest in listings, reviews, and reputation — switching cost increases with tenure
- Data moats: more transactions → better fraud detection → safer marketplace → more trust → more transactions
- Multi-homing: sellers listing on multiple marketplaces reduces defensibility; buyers comparison-shopping reduces it further
- Category expansion: each new category is a new marketplace that must achieve liquidity independently
- The "1000 listings" rule: for any given category, search quality becomes useful at ~1,000 active listings

### Topic: A/B Testing Challenges Unique to Marketplaces

"How do you A/B test a search ranking change when it affects both buyers and sellers?"

**Expected discussion points:**
- Buyer-side randomization: randomize which buyers see the new ranking
- But: changed buyer behavior affects seller metrics (impressions, sales) even for sellers not in the test
- Seller-side contamination: a seller's listing ranked higher for test buyers gets more sales, improving their quality score, which affects their ranking for control buyers too
- Solutions: cluster-based randomization (geographic regions as clusters), short test windows to limit contamination, holdback analysis comparing test regions to control regions
- Metric complexity: must measure both buyer conversion AND seller satisfaction (impressions, GMV distribution fairness)
- Long-term effects: a ranking change that improves short-term conversion may harm seller diversity, reducing long-term supply health

### Topic: Marketplace Observability vs. Traditional SaaS Observability

"What's different about monitoring a marketplace compared to a typical web application?"

**Key differences:**
- **Two-sided health:** A traditional app has one user population. A marketplace must track buyer-side AND seller-side health independently. Search availability matters to buyers; payout availability matters to sellers. Both affect GMV but through different mechanisms.
- **Financial integrity metrics:** Traditional apps rarely track whether money is correctly flowing. A marketplace must continuously reconcile escrow balances, verify take rate accuracy, and detect disbursement failures. These are SEV-1 alerts, not business dashboards.
- **Trust as a signal:** Traditional monitoring tracks errors and latency. Marketplace monitoring must also track trust signals: dispute rate trends, fraud detection coverage, seller quality score distribution shifts, review fraud suppression rates. A decline in trust metrics leads to GMV decline with a 2–4 week lag.
- **Network effect health:** Traditional apps don't need to monitor supply/demand balance. A marketplace must track whether new listings are keeping pace with buyer demand (supply health) and whether buyer traffic justifies seller investment (demand health).

---

## Quick Reference: What Makes Each Deep Dive Unique

| Deep Dive Topic | What Sets It Apart from Other Systems |
|---|---|
| **Search Ranking** | Multi-stage pipeline with seller quality as a multiplicative modifier — not just relevance |
| **Payment Escrow** | Not a simple charge — it's a regulated financial product with conditional release and multi-party split |
| **Trust & Safety** | Four simultaneous attack vectors, each requiring different detection techniques |
| **Dispute Resolution** | Load-bearing economic mechanism — buyer trust depends on it, not just a support feature |
| **Seller Quality Score** | Most cross-cutting signal: affects ranking, payouts, trust badges, listing permissions simultaneously |
| **Inventory Reservation** | Business trade-off (TTL length) masquerading as a technical constant |
