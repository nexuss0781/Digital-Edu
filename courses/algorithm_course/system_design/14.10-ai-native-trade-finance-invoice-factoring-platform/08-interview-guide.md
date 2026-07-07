# 14.10 AI-Native Trade Finance & Invoice Factoring Platform — Interview Guide

## 45-Minute Interview Pacing

| Phase | Time | Focus | What to Cover |
|---|---|---|---|
| **Clarification** | 0–5 min | Scope the problem | Ask about scale (how many invoices/day?), types of financing (just factoring or full supply chain finance?), cross-border or domestic only?, regulatory jurisdiction (India-focused or global?) |
| **High-Level Design** | 5–15 min | Architecture and data flow | Draw the end-to-end flow: ingestion → verification → pricing → matching → settlement; identify the key services and their responsibilities; establish the CQRS/event-sourcing pattern for the ledger |
| **Deep Dive 1** | 15–25 min | Risk and pricing engine | Dynamic pricing algorithm; buyer credit scoring; fraud detection strategies; how the system handles the credit propagation problem (buyer default affects thousands of deals) |
| **Deep Dive 2** | 25–35 min | Settlement and consistency | Saga-based settlement across banking systems; idempotency guarantees; handling partial failures; escrow management; double-entry ledger design |
| **Trade-offs & Extensions** | 35–45 min | Scaling, reliability, edge cases | Quarter-end surge handling; GSTN dependency management; cross-border extension; credit insurance; regulatory compliance approach |

---

## Key Discussion Points

### 1. Why Event Sourcing for the Financial Ledger?

**Expected answer:** The financial ledger is the most critical data structure in the system. Event sourcing provides: (a) complete audit trail—every financial state change is recorded as an immutable event, enabling regulatory audits and dispute resolution; (b) point-in-time reconstruction—can answer "what was the portfolio state on March 15 at 3 PM?"; (c) derived views—different stakeholders (financier, MSME, regulator) see different projections from the same event stream; (d) error correction without data loss—mistakes are corrected by appending compensating events, not modifying history.

**Follow-up:** "How do you handle the eventual consistency between the event store and materialized views? What if a financier sees a stale portfolio balance and makes a decision based on it?"

**Strong answer:** The write path (deal creation, settlement) is strongly consistent—goes through the ledger service which is the single source of truth. Read path (portfolio dashboard, analytics) uses materialized views that are eventually consistent with a bounded lag (< 5 seconds under normal load). For critical decisions (bid placement, limit checking), the financier API reads directly from the ledger service (not the materialized view) with a `read-after-write` guarantee. The materialized view lag is visible on the dashboard ("data as of: 3 seconds ago").

### 2. The Settlement Atomicity Problem

**Expected answer:** Settlement involves moving money across multiple banking systems that don't support distributed transactions. The candidate should propose a saga pattern with compensation actions and explain why two-phase commit doesn't work (banks don't support XA transactions).

**Key insight the candidate should identify:** The disbursement step is the point of no return—once money is sent to the MSME's bank account, it cannot be automatically reversed. Every step before disbursement should be reversible (internal database operations). Every step after disbursement must succeed or be manually resolved.

**Follow-up:** "What happens if the settlement engine crashes between disbursing money to the MSME and recording the lien on the invoice?"

**Strong answer:** The saga state is persisted durably before each step. On recovery, the engine replays from the last completed step. For the specific scenario: (a) the disbursement was made via a bank API with an idempotency key; (b) on restart, the engine queries the bank to confirm disbursement status; (c) if confirmed, proceed to record the lien; (d) the lien recording is idempotent (insert-if-not-exists); (e) the escrow is already allocated (step completed before disbursement). The net effect is correct settlement, just delayed by the restart time.

### 3. Dynamic Pricing vs. Fixed Rate Schedule

**Trap question:** "Why not just publish a fixed rate schedule (AAA = 8%, AA = 10%, etc.) updated monthly? It's much simpler."

**Expected rebuttal:** Fixed rate schedules have fundamental problems in trade finance:
1. **Stale risk**: A buyer rated AA today may deteriorate to BBB by next month; fixed rates don't reflect real-time risk
2. **No liquidity signal**: When there's excess capital chasing invoices, rates should fall; when capital is scarce, rates should rise. Fixed rates cause feast-or-famine cycles
3. **No invoice-level differentiation**: Two invoices against the same buyer may have very different risk profiles (₹1 lakh 30-day vs. ₹5 crore 120-day); fixed rates over-price one and under-price the other
4. **Competitive disadvantage**: Financiers with better risk models will cherry-pick underpriced invoices, leaving the platform with adversely selected risk

**But acknowledge the trade-off:** Dynamic pricing is harder to explain to MSMEs ("why did my rate change from yesterday?"). The solution is to provide transparent factor-level breakdowns and rate bands per buyer rating.

### 4. Handling the Double-Spend Problem

**Expected answer:** The candidate should recognize that duplicate invoice financing is the #1 fraud vector and propose multi-layer defense:
- E-invoice IRN uniqueness (government-issued identifier for each invoice)
- Document hash deduplication within the platform
- Cross-platform registries (TReDS, industry consortium)
- Behavioral signals (financing volume vs. GST-reported revenue)

**Follow-up:** "What if the industry doesn't have a universal registry? How do you handle duplicate invoices across competing platforms?"

**Strong answer:** In the absence of a universal registry, you can't guarantee zero duplicates. But you can make it economically unattractive: (a) require MSMEs to sign exclusivity declarations backed by legal liability; (b) monitor the ratio of invoices financed on the platform vs. the MSME's total revenue (from GST data)—if they're financing 120% of their revenue, they're clearly double-dipping somewhere; (c) participate in or build industry-level hash registries where platforms share invoice fingerprints without sharing commercial details; (d) partner with credit bureaus for near-real-time reporting of funded invoices.

---

## Trap Questions and Model Answers

### Trap 1: "Should we use blockchain for the financial ledger?"

**Why it's a trap:** Blockchain is commonly associated with financial systems and immutability, but it's the wrong tool here.

**Good answer:** No. The platform's ledger needs:
- High throughput (200K+ settlements/day) → blockchain consensus is too slow
- Low latency (sub-second ledger writes) → blockchain finality takes seconds to minutes
- Centralized authority (the platform is the trusted operator) → decentralized consensus adds overhead without benefit
- Complex queries (balance aggregation, portfolio analytics) → blockchains are not query-optimized

The event-sourced append-only ledger with cryptographic hash chaining provides the same immutability and auditability guarantees as a blockchain but with orders-of-magnitude better performance. Blockchain is appropriate for cross-platform scenarios (shared invoice registry between competing platforms), not for a single platform's internal ledger.

### Trap 2: "Can we use a single relational database for everything?"

**Why it's a trap:** Tempting simplicity, but trade finance has conflicting data access patterns.

**Good answer:** Different data types have fundamentally different access patterns:
- **Ledger**: Append-only writes, balance aggregation queries → optimized for write throughput with materialized balance views
- **Invoice documents**: Large blobs (5 MB PDFs) → object storage, not relational
- **Credit scores**: Frequently read, infrequently written, cacheable → in-memory cache backed by feature store
- **Search/matching**: Full-text search across invoice fields → search index
- **Audit events**: Very high write volume, rarely queried → append-only log storage

A single relational database would be bottlenecked by the document storage, overwhelmed by the audit event write volume, and inefficient for the caching and search patterns. But the ledger specifically should be relational (ACID guarantees for financial data).

### Trap 3: "Why not process all invoices synchronously—upload and get an instant price?"

**Why it's a trap:** Seems like a better user experience, but violates system design principles.

**Good answer:** Invoice processing involves multiple stages with different latency profiles:
- OCR: 3–10 seconds (GPU inference)
- GST verification: 2–15 seconds (external API, may need retries)
- Fraud detection: 0.5–5 seconds (graph analysis can be expensive)
- Credit scoring: 0.2 seconds (if cached), 2 seconds (if fresh computation needed)
- Pricing: 0.5 seconds

Total synchronous path: 6–32 seconds. This is too slow for a synchronous API call but too fast for "come back tomorrow." The right approach is asynchronous processing with real-time status updates via WebSocket/SSE. The MSME uploads and immediately sees "Processing..." → "OCR Complete" → "GST Verified" → "Priced: 10.0%" within 30 seconds. The perceived experience is near-instant while the system processes asynchronously.

### Trap 4: "Let's price all invoices against a buyer the same since the buyer risk is the same"

**Why it's a trap:** Ignores invoice-level risk factors that significantly affect pricing.

**Good answer:** Even with the same buyer, invoices differ on:
- **Tenor**: A 30-day invoice has half the risk exposure of a 60-day invoice
- **Amount**: A ₹5 crore invoice concentrates more risk than a ₹5 lakh invoice
- **Supplier relationship**: First invoice from a new supplier vs. 50th invoice from a proven supplier
- **Concentration**: If the financier already has ₹100 crore exposure to this buyer, adding another ₹5 crore should cost more (marginal concentration risk)
- **Verification strength**: An e-invoice with IRN and PO match has lower fraud risk than a scanned PDF without PO matching

Uniform pricing would systematically under-price high-risk invoices and over-price low-risk ones, leading to adverse selection (high-risk invoices get funded, low-risk MSMEs leave for competitors with better rates).

---

## Scoring Rubric

| Area | Junior (1-2) | Mid (3-4) | Senior (5-6) | Staff+ (7-8) |
|---|---|---|---|---|
| **Problem Framing** | Treats as a simple CRUD application for invoices | Identifies the multi-party nature and need for verification | Recognizes the adversarial fraud environment and settlement atomicity challenge | Frames the system as a financial marketplace with network effects, systemic risk, and regulatory complexity |
| **Data Model** | Flat tables for invoices and deals | Separate entities for each party with relationships | Event-sourced ledger with double-entry accounting; understands why immutability matters | Graph-based credit model with supply chain relationships; versioned credit scores with feature stores; discusses partition strategies for financial data |
| **Settlement Design** | Direct bank transfer on deal acceptance | Two-phase commit (acknowledges it doesn't work across banks) | Saga pattern with compensation actions; identifies the point-of-no-return problem | Saga with idempotency keys, settlement window management, reconciliation engine, and graceful handling of banking system maintenance windows |
| **Risk & Pricing** | Fixed rate table per buyer rating | Multi-factor pricing with buyer score and tenor | Dynamic pricing with liquidity adjustment, concentration risk, and seasonal factors; discusses model explainability | Graph-based credit propagation; discusses how buyer default affects the entire supplier ecosystem; addresses adverse selection in pricing |
| **Fraud Detection** | Duplicate invoice number check | GST cross-verification + document hash dedup | Multi-layer defense: document + cross-reference + behavioral + graph analysis | Discusses cross-platform deduplication challenges; adversarial model evasion; the fundamental impossibility of preventing all duplicate financing without a universal registry |
| **Scaling** | "Add more servers" | Horizontal scaling with queue-based decoupling | Differentiated scaling per tier (stateless vs. stateful); discusses GSTN API as Slowest part of the process | Quarter-end surge planning; graceful degradation during dependency failures; settlement partition scaling with consistency guarantees |
| **Compliance** | Mentions "we need to comply with regulations" | Lists specific regulations (RBI, GST, FEMA) | Describes automated compliance enforcement in the transaction flow | Discusses tension between compliance requirements and system performance; real-time CRAR calculation affecting deal acceptance; event-sourced audit trail for regulatory examination |

---

## Common Mistakes

| Mistake | Why It's Wrong | Better Approach |
|---|---|---|
| Treating the financial ledger as a mutable balance table | Financial systems require complete history for audit and regulatory purposes; mutable records can be altered, destroying the audit trail | Event-sourced, append-only, double-entry ledger with cryptographic hash chaining |
| Using distributed transactions across banking systems | Banks don't support XA/2PC; distributed transactions across organizational boundaries don't exist in practice | Saga pattern with compensation actions and idempotency keys |
| Ignoring the GSTN API as a critical dependency | GSTN has rate limits, scheduled maintenance, and is slow during filing season; treating it as a reliable service leads to system-wide failures | Cache GSTN data aggressively; implement graceful degradation (process without GST verification at a higher rate); batch pre-fetch during off-peak |
| Pricing all invoices against a buyer the same | Ignores tenor, amount, concentration, supplier relationship, and verification strength | Per-invoice dynamic pricing with transparent factor-level breakdown |
| Relying solely on document hash for dedup | Same invoice in different formats (PDF vs. image vs. different PDF renderer) will have different hashes | Multi-layer dedup: exact hash + fuzzy matching (same parties + similar amount/date) + IRN uniqueness + behavioral signals |
| Not addressing the buyer default cascading problem | A single buyer default can affect hundreds of financiers with thousands of deals | Real-time credit propagation engine; graph-based risk model; portfolio-level exposure limits; credit insurance |
| Designing the system without escrow | Without escrow, funds flow directly between parties, creating settlement risk | Escrow accounts provide fund isolation; all disbursements and collections flow through escrow |
| Ignoring settlement timing constraints | Indian banking payment rails have specific operating hours and batch processing windows | Settlement scheduler aware of NEFT/RTGS/NACH operating hours; holiday calendar; month-end processing constraints |

---

## Advanced Discussion Topics

### 1. Credit Signal Propagation at Scale

**Discussion prompt:** "If a major buyer like Tata Motors defaults on invoices across 200 suppliers simultaneously, how does the system handle the cascading credit event?"

**What to look for:** The candidate should describe the three-stage propagation pipeline: (1) event detection with severity classification, (2) blast radius computation (all active deals, all exposed financiers, concentration limit breaches), (3) parallel repricing of all affected deals with coordination barrier. Strong candidates will identify the tension between propagation speed (5-minute SLA for CRITICAL events) and propagation accuracy (repricing depends on updated credit score, which itself depends on aggregating default data).

**Staff+ answer markers:** Discusses the systemic risk implications—whether the platform should act as a market-maker during a major buyer default (e.g., temporarily halt trading in invoices against the defaulting buyer, similar to stock exchange circuit breakers). Identifies the insurance portfolio correlation problem—a single buyer default can trigger claims across dozens of insurance policies, potentially exhausting the insurance pool.

### 2. Cross-Border Trade Finance Complexity

**Discussion prompt:** "How would you extend the system to handle a multi-currency letter of credit where an Indian exporter ships goods to a buyer in the UAE, financed by a Singapore-based financier?"

**What to look for:** The candidate should identify the additional complexity layers: (1) multi-currency settlement (INR disbursement to exporter, USD or AED collection from buyer, SGD return to financier), (2) forex risk management (rate locked at deal creation vs. floating), (3) regulatory compliance across three jurisdictions (RBI FEMA, UAE Central Bank, MAS), (4) document verification (bill of lading, certificate of origin, insurance), (5) cross-border settlement via SWIFT with correspondent banking.

### 3. Model Explainability for Regulatory Examination

**Discussion prompt:** "The RBI examiner asks: 'Why did you price this specific invoice at 11.2% when a similar invoice last week was priced at 9.8%?' How does the system answer?"

**What to look for:** The candidate should describe factor-level pricing breakdown (base rate, credit premium, tenor, concentration, liquidity, seasonal—stored as an audit trail per pricing decision). Strong candidates will explain SHAP values for the credit model component and how the complete pricing audit trail enables point-in-time reconstruction of every rate decision, including the market state at the time of pricing.

### 4. Adversarial Model Evasion in Fraud Detection

**Discussion prompt:** "A sophisticated fraud ring has been operating on the platform for 6 months, slowly training its behavior to avoid your detection thresholds. How do you detect and respond?"

**What to look for:** The candidate should recognize that rule-based thresholds are vulnerable to gradual evasion (adversary stays just below each threshold). Strong candidates will propose: unsupervised anomaly detection that doesn't rely on fixed thresholds, periodic red-team exercises where a dedicated team tries to game the system, graph-based analysis that detects structural patterns (communities of entities that normal velocity checks miss), and external data sources (credit bureau sudden inquiries, MCA director overlap searches) that the adversary cannot manipulate.

---

## Red Flags in Candidate Responses

| Red Flag | Why It's Concerning | What They Should Say Instead |
|---|---|---|
| "We'll use blockchain for the ledger" | Shows pattern-matching without understanding trade-offs; blockchain consensus is orders of magnitude too slow for settlement throughput | Event-sourced, hash-chained append-only ledger provides the same immutability and auditability with 1000x better performance |
| "Just check invoice numbers for duplicates" | Misses the fundamental challenge: same invoice in different formats (PDF vs. image vs. e-invoice) will have different content but same economic identity | Multi-layer dedup: exact hash + fuzzy matching (parties + amount + date) + IRN uniqueness + behavioral monitoring (financing-to-revenue ratio) |
| "Apply the same rate for all invoices from one buyer" | Ignores invoice-level risk differentiation that's core to platform economics | Per-invoice pricing considering tenor, amount, supplier relationship history, concentration risk, and verification strength |
| "Use distributed transactions across banks" | Fundamentally misunderstands banking infrastructure—banks don't support XA/2PC across organizational boundaries | Saga-based orchestration with compensation actions and idempotency keys; identify the point-of-no-return (disbursement) |
| "100% fraud prevention is our goal" | Unrealistic in trade finance where perfect prevention requires a universal registry that doesn't exist | Make fraud economically unattractive through detection probability, legal deterrence, and risk pricing; design for tolerable fraud rate priced into the risk premium |
| "We can process invoices synchronously end-to-end" | Doesn't account for external dependency latency (GSTN: 2-15s, bank APIs: 2-30min) or the pipeline nature of verification | Async processing with real-time status updates (WebSocket/SSE); return immediate acknowledgment, notify on completion |
| "Credit scoring using only financial statements" | Misses the platform's unique data advantage—payment behavior data across the supply chain graph is far more predictive than annual financial reports | Graph-based scoring using platform payment history (most predictive), GST filing patterns, bureau data, AND financial statements as complementary signals |

---

## Whiteboard Sketch Guide

### 5-Minute Sketch (High-Level Architecture)

Draw these 5 boxes with directional arrows:
1. **Ingestion** (OCR → GST Verification → Fraud Check) — left side
2. **Risk Engine** (Credit Scoring → Pricing) — center top
3. **Marketplace** (Matching → Bidding → Deal) — center
4. **Settlement** (Saga → Escrow → Ledger) — center bottom
5. **Data Layer** (Document Store, Ledger DB, Event Store, Cache) — right side

Key arrows: Ingestion feeds Risk Engine; Risk Engine feeds Marketplace; Marketplace triggers Settlement; Settlement records to Ledger. Emphasize the one-way flow for the write path.

### 15-Minute Sketch (Settlement Saga Detail)

Extend with the settlement saga state machine:
```
Reserve Limit → Create Escrow → Record Lien → [DISBURSEMENT GATE] → Bank Transfer → Record Ledger → Setup Collection
                                                    ↑
                                          (re-validate all preconditions)
                                          (point of no return)
```

Mark the disbursement gate explicitly—this is the key architectural insight that distinguishes senior from junior responses. Show compensation arrows going backward from each pre-disbursement step.

---

## 30-Second Elevator Pitch

"An AI-native trade finance platform that replaces the traditional 7-14 day invoice discounting process with a real-time marketplace where invoices are verified against GST records, priced dynamically by credit models that leverage the supply chain graph, and settled atomically across banking systems using a saga-based orchestrator with escrow-based fund isolation. The key architectural challenge is the settlement atomicity problem—moving money across 4-6 banking systems that don't support distributed transactions—solved by a saga with an explicit point-of-no-return at the disbursement step."

---

## Follow-Up Questions by Seniority

**Mid-Level (focus on correctness):**
- How does the OCR engine handle invoices in regional Indian languages?
- What happens if the NACH mandate registration fails after disbursement?
- How do you prevent the same person from being both maker and checker?

**Senior (focus on trade-offs):**
- How do you balance fraud detection aggressiveness against false positive impact on MSME experience?
- When should the platform act as a market-maker (set prices) vs. a marketplace (let financiers bid)?
- How do you handle the stale credit score problem during quarter-end when scores may be 24+ hours old?

**Staff+ (focus on systemic implications):**
- How does a major buyer default cascade through the insurance pool, and what circuit breakers exist?
- What's the platform's strategy for the impossible triangle: full fraud prevention, low latency, and low cost?
- How would you design the cross-platform invoice registry to prevent collusion while preserving competitive confidentiality?

---

## Key Metrics Reference

| Metric | Normal | Alert | Crisis |
|---|---|---|---|
| Invoice processing p95 | < 30s | > 60s | > 120s |
| Deal conversion rate | 60% | < 45% | < 30% |
| Default rate (30 DPD) | < 1.5% | > 2.0% | > 3.0% |
| CRAR | > 18% | < 16% | < 15.5% |
| Fraud detection rate | > 98% | < 95% | < 90% |
| Settlement saga success rate | > 99.9% | < 99.5% | < 99% |
| GSTN verification success | > 92% | < 85% | < 70% |
| Financier utilization | 60-80% | < 40% or > 90% | < 25% or > 95% |

---

## Extended Scoring Rubric

| Dimension | Score 0–3 | Score 4–6 | Score 7–8 | Score 9–10 |
|---|---|---|---|---|
| **Financial Domain** | Treats as generic CRUD; no understanding of trade finance concepts | Understands invoicing basics, mentions factoring; basic settlement flow | Discusses credit risk, dynamic pricing, settlement atomicity; understands multi-party fund flow | Articulates buyer credit graph, correlation risk in insurance, cross-platform deduplication as unsolvable without universal registry; discusses regulatory capital implications |
| **System Architecture** | Monolithic design; single database | Microservices with message queue; CQRS mentioned | Event-sourced ledger, saga-based settlement, graph-based fraud detection; discusses GSTN as a fragile dependency | Multi-tier architecture with explicit degradation modes; back-pressure design across pipeline stages; discusses meta-observability for financial systems |
| **Adversarial Thinking** | No fraud consideration or basic duplicate check | Mentions GST verification and duplicate detection | Multi-layer fraud defense including graph analysis; discusses cross-platform dedup challenge | Frames fraud as an ongoing adversarial game; discusses model poisoning, coordinated inflation rings, and economic deterrence as primary defense when technical prevention fails |
| **Operational Maturity** | No discussion of failures or monitoring | Mentions logging and basic alerting | Discusses settlement saga recovery, GSTN degradation mode, reconciliation engine | Covers chaos experiments, reconciliation at three levels, quarter-end capacity planning, financier insolvency handling, regulatory examination readiness |

---

## Storage Backend Comparison

| Requirement | Relational DB | Document Store | Event Stream | Object Storage |
|---|---|---|---|---|
| Financial ledger (ACID) | **Best fit** — double-entry requires transactional guarantees | Poor — no ACID across documents | Read-only source of truth; needs materialized view | Not applicable |
| Invoice documents (5 MB PDFs) | Poor — BLOB storage in RDBMS is inefficient | Acceptable | Not applicable | **Best fit** — designed for large immutable objects |
| Audit events (high write volume) | Acceptable but expensive at 20M events/day | Acceptable | **Best fit** — append-only, partitioned, retained for years | Cold tier after 90 days |
| Credit scores (fast lookup) | Acceptable | Acceptable | Not applicable | Not applicable; use **in-memory cache** backed by feature store |
| Invoice search (full-text) | Limited full-text capability | Acceptable | Not applicable | Not applicable; use **search index** |
| Supply chain graph | Poor for graph traversals | Poor | Not applicable | Not applicable; use **graph store** or adjacency-list in relational with materialized paths |

**Decision framework:** Use relational DB for the ledger and settlements (ACID-critical); object storage for documents (cost-efficient for large immutable files); append-only event stream for audit trail (optimized for high-volume sequential writes); in-memory cache + feature store for credit scores (low-latency reads); search index for invoice discovery; graph representation for fraud detection.

---

## System Complexity Rating

| Dimension | Rating | Rationale |
|---|---|---|
| Domain Complexity | **Very High** | Multi-party financial transactions with regulatory compliance across multiple jurisdictions; adversarial fraud environment |
| Data Model | **High** | Event-sourced double-entry ledger; graph-based credit model; multi-entity relationships with complex state machines |
| Integration Complexity | **Very High** | External dependencies: GSTN API (rate-limited, unreliable), banking APIs (5+ banks, different capabilities), credit bureaus, TReDS platforms, insurance providers |
| Consistency Requirements | **Very High** | Zero tolerance for financial errors; every rupee must balance; settlement atomicity across external banking systems |
| Scaling Challenge | **High** | 3x quarter-end surge; both compute AND capital must scale; GSTN rate limits create a hard external ceiling |
| Security Posture | **Very High** | Adversarial fraud actors; insider threat from financial data; regulatory examination readiness at all times |

---

## Topic-Specific Probing Questions

### For Candidates Who Propose Event Sourcing

- "How do you handle schema evolution when the event format changes? All historical events must remain readable."
- "How do you compute a financier's real-time portfolio balance efficiently when it requires aggregating millions of events?"
- "What happens during a regulatory audit when the examiner asks for the state of all deals at 3 PM on March 15, 2025?"

**What to listen for:** Understanding that event sourcing requires snapshotting for query performance; awareness that schema evolution is the hardest long-term challenge; ability to explain point-in-time reconstruction.

### For Candidates Who Discuss Graph-Based Fraud Detection

- "How do you partition the supply chain graph when it grows to 2M+ entities and 50M+ edges?"
- "What's the latency impact of adding graph analysis to the real-time invoice processing pipeline?"
- "How do you handle temporal edges—a supplier-buyer relationship that existed 6 months ago but is now inactive?"

**What to listen for:** Understanding that graph queries are expensive and must be moved to batch/near-real-time (not synchronous); awareness of graph partitioning challenges; temporal graph modeling awareness.

### For Candidates Who Mention Credit Insurance

- "How do you price correlation risk in a portfolio where 40% of invoices are against buyers in the same industry?"
- "What happens when a single buyer default triggers insurance claims across 30 financiers simultaneously?"
- "How do you prevent adverse selection where only the riskiest invoices get insured?"

**What to listen for:** Understanding of portfolio-level risk vs. individual risk; awareness that insurance pool exhaustion is a systemic risk; ability to discuss copula models or correlation adjustments at a conceptual level.
