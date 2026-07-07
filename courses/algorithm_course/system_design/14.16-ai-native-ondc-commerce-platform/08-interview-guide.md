# 14.16 AI-Native ONDC Commerce Platform — Interview Guide

## Interview Overview

This guide structures a 45-minute system design interview around the ONDC commerce platform. The topic uniquely tests a candidate's ability to reason about **decentralized architectures, protocol-based interoperability, and trust in a federated system**—skills rarely assessed in standard "design an e-commerce platform" questions. Interviewers should focus on whether the candidate instinctively reaches for centralized solutions (database, cache, queue) and whether they can adapt when told the architecture is fundamentally decentralized.

---

## 45-Minute Interview Pacing

| Time | Phase | Focus | Interviewer Notes |
|---|---|---|---|
| 0-5 min | **Problem Framing** | Present the prompt; let the candidate ask clarifying questions | Note whether they ask about the Beckn protocol or assume a standard e-commerce system |
| 5-12 min | **Requirements** | Functional and non-functional requirements; capacity estimation | Look for ONDC-specific requirements: protocol compliance, multi-NP coordination, settlement |
| 12-25 min | **High-Level Design** | System architecture, component interactions, data flow | The critical 13 minutes — assess whether the candidate designs for decentralization |
| 25-35 min | **Deep Dive** | Pick 1-2 areas for detailed design (search, trust, settlement, or WhatsApp) | Probe for non-obvious insights about decentralized data management |
| 35-42 min | **Scalability & Trade-offs** | Scaling strategy, failure modes, trade-offs | Test understanding of federated failure modes (NP failure, protocol version mismatch) |
| 42-45 min | **Wrap-up** | Summary, reflection on key trade-offs, questions | Assess self-awareness of design gaps |

---

## Opening Prompt

> "Design a commerce platform that operates as a network participant on ONDC (Open Network for Digital Commerce), India's government-backed decentralized e-commerce protocol. The platform should enable sellers to list products and buyers to discover, order, and receive products — but unlike traditional e-commerce, there is no centralized marketplace. Instead, independent buyer apps, seller apps, and logistics providers interoperate through an open protocol (Beckn). Your platform will serve as a seller-side network participant that must handle catalog management, order processing, payment settlement, and logistics coordination — all through protocol-based communication with entities you don't control."

### Clarifying Information to Provide (if asked)

| Question | Answer |
|---|---|
| "What is the Beckn protocol?" | An open protocol defining async request-callback APIs for commerce: search → on_search, select → on_select, init → on_init, confirm → on_confirm, etc. Every message is digitally signed. |
| "How many network participants?" | ~100 seller NPs, ~50 buyer NPs, ~25 logistics NPs. You're designing one seller NP. |
| "What's the scale?" | 50M orders/month, 1M sellers on the network, 150M catalog items, 1,000+ cities in India. |
| "Who handles payments?" | Payment NPs handle the actual money movement. You integrate via protocol. Settlement is multi-party (buyer NP commission, seller NP commission, logistics charges, network fees). |
| "What about trust/fraud?" | No centralized trust authority. You must build trust scoring from protocol-level signals (signed messages, fulfillment rates, complaint data). |
| "Do we need to support WhatsApp?" | Yes. WhatsApp should function as a buyer app interface — conversational commerce flowing through the Beckn protocol behind the scenes. |

---

## What Strong Candidates Demonstrate

### Tier 1: Core Understanding (Expected from all Senior SDEs)

- [ ] Recognizes that decentralized architecture changes fundamental assumptions (no shared database, no centralized user profiles, no platform-controlled quality)
- [ ] Designs the protocol adapter as a key architectural component with signature verification and schema validation
- [ ] Identifies the asynchronous request-callback model and designs for it (timeouts, state management across async gaps)
- [ ] Models the order lifecycle as a state machine driven by signed protocol messages
- [ ] Separates catalog data (per-seller, potentially heterogeneous) from search index (aggregated, normalized)

### Tier 2: Deep Insight (Differentiates Strong from Average)

- [ ] Addresses the federated search problem: fan-out latency, slow NP handling, progressive rendering
- [ ] Designs trust scoring from protocol-level signals rather than centralized data
- [ ] Identifies the multi-party settlement challenge and designs for reconciliation
- [ ] Considers catalog normalization across heterogeneous sellers (different schemas, languages, quality levels)
- [ ] Addresses WhatsApp as a full buyer app (not just a notification channel)

### Tier 3: Exceptional (Staff+ Level)

- [ ] Discusses protocol version management (NPs on different versions, backward compatibility)
- [ ] Identifies anti-gaming measures for trust scores (fake orders, strategic cancellations, rating manipulation)
- [ ] Designs the non-repudiation system from digital signature chains for dispute resolution
- [ ] Discusses the cold-start problem for trust (new NPs with no history)
- [ ] Considers India Stack integration depth (Aadhaar e-KYC, DigiLocker, Account Aggregator)
- [ ] Identifies the tension between decentralized design and the need for centralized quality signals

---

## Trap Questions and Discussion Probes

### Trap 1: "Can we just build a search index over all sellers' catalogs?"

**What it tests:** Understanding of data ownership in a decentralized network.

**Weak answer:** "Yes, we'll crawl all seller catalogs and build a central search index."

**Strong answer:** "We can build a snapshot index for approximate matching, but we don't own or control seller catalogs. The index is supplementary — actual prices and availability must be confirmed via live protocol calls (select/on_select). We need to handle index staleness (sellers change prices without our knowledge), schema heterogeneity (each seller NP formats catalogs differently), and the fact that indexing another NP's catalog may raise data ownership concerns. The index is a performance optimization, not the source of truth."

### Trap 2: "How do you handle a seller that consistently delivers late?"

**What it tests:** Reasoning about trust without centralized control.

**Weak answer:** "We block the seller from the platform."

**Strong answer:** "We can't block a seller from the ONDC network — they're registered with ONDC, not with us. What we can do is: (1) compute a trust score from signed protocol messages (promised delivery time in on_init vs. actual delivery time in on_status — both signed by different NPs, so neither can fake it), (2) use the trust score to rank this seller lower in search results on our buyer app, (3) report persistent SLA violations to ONDC via the Issue & Grievance Management framework, and (4) on the seller NP side, help our own sellers improve delivery times through AI-powered logistics selection and demand forecasting. But the key insight is that in a decentralized network, 'enforcement' is through reputation and protocol-level reporting, not through platform-level banning."

### Trap 3: "Why not use a single relational database for all order data?"

**What it tests:** Understanding of data modeling for protocol-based systems.

**Weak answer:** "Yes, a relational database with an orders table, items table, and payments table."

**Strong answer:** "The order data arrives as a sequence of signed protocol messages from multiple independent NPs — it's not a single entity writing to a database. I'd event-source the order state from the protocol message log. Each signed message (on_confirm, on_status, etc.) is an event from a different NP that transitions the order state. The current state is a projection of these events. This is better than a mutable orders table because: (1) the signed message log is the non-repudiable evidence for disputes, (2) different services need different views of the same order (buyer-facing status vs. seller fulfillment queue vs. settlement ledger), and (3) replay capability from the event log is essential for debugging cross-NP issues."

### Trap 4: "How do you handle payment if the buyer app is separate from your seller app?"

**What it tests:** Understanding of multi-party settlement in a decentralized system.

**Weak answer:** "The buyer pays us, we take our commission, and pay the seller."

**Strong answer:** "Payment in ONDC flows through a payment NP (not through us directly). The buyer's payment goes to a collecting entity, and settlement is distributed to multiple parties: buyer NP commission, seller NP commission, ONDC network fee, logistics charges, and the seller's payout — all after TCS and GST deductions. We need to track our portion of the settlement (seller NP commission + seller payout) and reconcile against the signed protocol messages that form the basis for the settlement amounts. The challenge is that different parties may compute slightly different amounts (rounding, timing, tax interpretation), so we need a reconciliation engine that detects and resolves discrepancies. For COD orders, there's an additional 3-5 day lag while cash is collected and remitted through the logistics NP."

### Trap 5: "Can you just translate WhatsApp messages to API calls?"

**What it tests:** Depth of thinking about conversational commerce.

**Weak answer:** "Yes, parse the message, call the search API, return results."

**Strong answer:** "It's much more complex than translation. WhatsApp conversations are stateful (buyer says 'show me rice', then 'the 5kg one', then 'deliver to my usual address') — we need session state management that maps a conversation thread to a Beckn transaction context. The buyer types in natural language (potentially in Hindi, Tamil, or mixed languages) — we need NLU that maps intent to ONDC search parameters, handles ambiguity ('cheaper one' requires context from previous results), and gracefully handles queries we can't map. Product display is constrained by WhatsApp's format (carousel cards with limited text) — we need to condense rich catalog data into mobile-optimized cards. Payment requires generating UPI deep links or payment request messages within WhatsApp. And the entire flow must be Beckn-compliant — the WhatsApp bot is effectively a buyer NP implementation where the UI is a chat window instead of a web page."

---

## Scoring Rubric

| Dimension | 1 — Below Bar | 2 — Meets Bar | 3 — Exceeds Bar |
|---|---|---|---|
| **Protocol Understanding** | Designs a standard e-commerce system; ignores the decentralized protocol constraint | Incorporates the Beckn request-callback model; designs the protocol adapter; handles message signing | Deep understanding of protocol implications: version management, compliance scoring, behavioral monitoring, non-repudiation chains |
| **Architecture** | Monolithic design or standard microservices without protocol awareness | Clean separation: protocol layer, AI layer, core commerce, data layer; event-driven where appropriate | Federated-aware design: catalog snapshot indexes with live validation, trust scoring from signed messages, multi-party settlement tracking |
| **Scalability** | No consideration for network fan-out or NP variability | Addresses fan-out search latency, NP timeout handling, and peak scaling | Progressive rendering, NP performance-aware routing, tiered storage for protocol message logs, pre-scaling for known events |
| **Trust & Security** | Binary trust model or ignores trust entirely | Trust scoring from multiple signals; digital signatures; fraud detection | Anti-gaming measures, cold-start trust handling, dispute evidence from signature chains, protocol compliance as a trust dimension |
| **AI Integration** | AI as an afterthought (add recommendation system) | AI for catalog enrichment, search ranking, and fraud detection | Cross-lingual search with multilingual embeddings, WhatsApp NLU for conversational commerce, AI-driven logistics selection |
| **Trade-off Awareness** | One-sided arguments; doesn't acknowledge tensions | Identifies key trade-offs (centralized index vs. protocol purity, latency vs. completeness) | Quantifies trade-offs (index staleness rate, trust score confidence decay, settlement reconciliation window); proposes mitigation strategies |

---

## Alternative Interview Angles

If the full 45-minute session is too broad, focus on one of these 20-minute deep dives:

### Option A: "Design the Federated Search System"
Focus: How to search across 100+ seller NPs with heterogeneous catalogs, different response latencies, multiple languages, and varying data quality — within a 2-second budget.

### Option B: "Design the Trust Scoring System"
Focus: How to compute and maintain trust scores for entities you don't control, using only protocol-level signals (signed messages), with anti-gaming measures, cold-start handling, and dispute resolution.

### Option C: "Design the Multi-Party Settlement Engine"
Focus: How to track, compute, and reconcile settlements across buyer NP, seller NP, logistics NP, and ONDC — with COD handling, refund flows, tax deductions, and discrepancy detection.

### Option D: "Design WhatsApp as a Beckn Buyer App"
Focus: How to build a conversational commerce interface on WhatsApp that translates natural language interactions into Beckn protocol flows — with session management, multilingual NLU, and constrained UI formatting.

---

## Common Mistakes to Watch For

1. **Designing a centralized marketplace** — The most common mistake. Candidate designs Amazon-with-ONDC-branding instead of a protocol-first federated system.

2. **Ignoring the asynchronous model** — Designing synchronous request-response APIs when the Beckn protocol is fundamentally async (request → ACK → callback later).

3. **Treating trust as binary** — "Verified" vs. "unverified" instead of continuous, multi-dimensional trust scoring with confidence levels.

4. **Assuming single-database reads for search** — Not recognizing that catalog data is distributed across independent NPs with no shared database.

5. **Skipping settlement complexity** — Treating payment as "buyer pays, seller receives" instead of the multi-party split with commissions, fees, taxes, and reconciliation.

6. **WhatsApp as notification only** — Missing the opportunity to design WhatsApp as a full-featured buyer app interface.

7. **Ignoring the protocol version problem** — Designing for a single protocol version when NPs may be running different versions simultaneously.

---

## Extension Questions

Use these to extend the interview or explore specific depth areas:

### Extension 1: "How would you add voice commerce in Indian languages?"

**What it probes:** Multimodal AI architecture, ASR for Indic languages, and integration with the Beckn protocol flow.

**Strong direction:** ASR engine transcribes voice to text in 22 languages → NLU maps intent to Beckn search parameters → same conversational state machine as WhatsApp but with voice as input and TTS for output. Key challenge: ASR accuracy for Indian English accents and code-mixed speech (Hindi-English, Hinglish). The system should fall back to text confirmation ("Did you mean 5kg Toor Dal?") when ASR confidence is below a threshold.

### Extension 2: "How would you handle a sudden network-wide seller onboarding campaign (100K sellers in one week)?"

**What it probes:** Back-pressure handling, queue-based architecture, India Stack API rate limits.

**Strong direction:** India Stack APIs are the Slowest part of the process (e-KYC: 10 req/sec, DigiLocker: 5 req/sec). At 10 req/sec, 100K verifications take ~2.8 hours of continuous processing. Solution: priority queuing (sellers with complete documents first), batch processing with exponential backoff, provisional onboarding (sellers can start catalog creation while KYC verification is in the queue), and staggered go-live (verified sellers activated in waves to prevent catalog index spike).

### Extension 3: "What changes if ONDC expands to cross-border commerce?"

**What it probes:** Protocol evolution thinking, regulatory awareness, settlement complexity.

**Strong direction:** Cross-border adds: customs declaration in protocol messages, multi-currency settlement (INR ↔ foreign currency with forex spread tracking), international logistics NPs with different tracking standards, import duty computation per HSN code, and compliance with both Indian and destination country consumer protection laws. The protocol adapter needs a country-specific compliance plugin architecture.

### Extension 4: "How would you detect and handle a compromised NP (one whose signing key has been stolen)?"

**What it probes:** Security incident response in a federated system.

**Strong direction:** Symptoms: valid signatures on messages that don't match the NP's known behavior (sudden catalog changes, order patterns that don't match historical profile). Detection: behavioral anomaly detection layered on top of cryptographic verification. Response: alert ONDC to revoke the NP's registry entry → all NPs refresh key cache → reject all messages from the compromised subscriber_id → affected in-flight orders enter a hold state pending investigation.

---

## Case Study Walkthrough: QuickKirana — Grocery Seller NP for Tier 2/3 Cities

### Scenario

QuickKirana is a seller NP that onboards 50,000 kirana stores (neighborhood grocery shops) across 200 Tier 2/3 cities in India. Each store has 100-500 products, minimal digital literacy, and inventory tracked in exercise books. The target is to make their inventory discoverable on ONDC within 48 hours of signup.

### Key Design Challenges

1. **Catalog creation from zero digital presence** — Kirana stores have no product photos, no barcodes, no spreadsheets. Solution: smartphone app where the shopkeeper takes a photo of the shelf → AI identifies products from packaging → generates catalog entries with names, categories, HSN codes, and estimated prices (validated against local market rates). The onboarding AI must handle cluttered shelf photos with partial label visibility.

2. **Inventory accuracy with manual tracking** — The shopkeeper doesn't update inventory in real-time. Solution: probabilistic inventory model that estimates "likely in stock" based on (a) last known restock date, (b) average daily sales for the product category in that pin code, (c) seasonal patterns. When a buyer orders, the seller NP sends a "confirmation pending" status and pings the shopkeeper for manual confirmation (via WhatsApp or SMS). The system learns the shopkeeper's confirmation patterns to improve inventory predictions.

3. **Hyperlocal delivery without logistics NP** — Many Tier 3 cities have no ONDC logistics NP. Solution: "self-fulfillment" mode where the kirana store's own delivery staff fulfills orders. The platform generates tracking events by sending the delivery person a WhatsApp message with a "Mark delivered" button. This generates the signed `on_status(DELIVERED)` message required by the protocol.

4. **Multilingual catalog in low-connectivity environments** — Catalogs must work in Hindi, Telugu, Kannada, etc. on 2G connections. Solution: text-only catalog cards with compressed product images (≤ 50 KB), lazy-loaded when bandwidth allows. Search ranking penalizes image-heavy results when the buyer is on a slow connection (detected via round-trip time).

### Whiteboard Sequence

```
Shopkeeper takes shelf photo
  → AI product recognition (offline-capable on device)
  → Catalog entries generated (name, category, price, HSN)
  → Shopkeeper confirms/corrects via simple UI (thumbs up/down per item)
  → Catalog published to ONDC network
  → Buyer in same pin code searches "atta 5kg"
  → QuickKirana NP responds with matched items
  → Buyer selects → init → confirm
  → Shopkeeper gets WhatsApp notification "New order: Atta 5kg, deliver to 123 MG Road"
  → Shopkeeper's delivery boy delivers → marks "delivered" via WhatsApp
  → Protocol messages signed and settlement initiated
```

---

## Key Numbers to Know

| Metric | Value | Why It Matters |
|---|---|---|
| ONDC monthly orders (2025) | 16M+ | Current scale baseline |
| Target monthly orders (2026) | 50M | 15% MoM growth projection |
| Active sellers | 1M+ | Network participant scale |
| Beckn protocol messages per order | ~20 | Determines message throughput requirements |
| Search fan-out factor | 15-30 NPs per query | After intelligent NP selection (from 100+) |
| Search response budget | 2 seconds (p95) | Includes fan-out, aggregation, and ranking |
| COD order percentage | ~60% | Drives settlement lag (T+3) and cash flow complexity |
| Settlement parties per order | 4-6 | Buyer NP, seller NP, logistics NP, ONDC, payment NP, seller |
| Protocol version migration window | 2-3 months | Multiple versions co-exist during migration |
| Indian languages supported | 22 (constitutional) | Cross-lingual search is a hard requirement |
| Category nodes in ONDC taxonomy | 5,000+ | Catalog mapping complexity |
| Seller onboarding target | ≤ 48 hours | vs. industry 3-4 weeks |

---

## Whiteboard Diagram Checklist

| Component | Must Show | Common Miss |
|---|---|---|
| **ONDC Gateway** | Message router between NPs; NOT a data store | Drawing the gateway as a database or central service |
| **Protocol Adapter** | Single entry/exit point; signature + schema validation | Distributing protocol handling across services |
| **Beckn Transaction Lifecycle** | Async request → ACK → callback pattern | Drawing synchronous request-response arrows |
| **Search Architecture** | Pre-index + live fan-out hybrid | Pure fan-out (too slow) or pure index (stale data) |
| **Order State Machine** | States driven by protocol messages from different NPs | Single-service state machine (ignores multi-NP authorship) |
| **Settlement Flow** | Multi-party split with 4-6 recipients | Simple buyer → seller payment |
| **Trust Scoring** | Protocol-derived signals; no centralized data source | Trust from a platform database |
| **Digital Signature Chain** | Sign outbound, verify inbound; registry for key lookup | Missing signatures or single-party signing |
| **Event Store** | Immutable signed message log as source of truth | Mutable order table as source of truth |
| **WhatsApp Bot** | Full buyer app (not notification channel) | WhatsApp as a simple alert/notification system |
| **Catalog Normalization** | Query-time normalization (not ingestion-time) | Assuming centralized schema enforcement |
| **Logistics Orchestration** | Multi-LSP via ONDC logistics protocol; not single provider | Hardcoded single logistics partner |
| **India Stack** | Aadhaar e-KYC, DigiLocker, UPI, Account Aggregator | Missing government DPI integration |
| **Data Layer** | Polyglot persistence (SQL, document, vector, append-only log) | Single relational database for everything |

---

## Red Flags in Candidate Responses

| Red Flag | What It Reveals |
|---|---|
| "We'll store all product data in our database" | Doesn't understand decentralized data ownership |
| "The platform verifies sellers" | Conflates platform authority with network-level trust |
| "We'll use REST APIs with JSON responses" | Misses the async request-callback protocol model |
| "Add a recommendation engine" | Generic AI bolt-on without understanding federated data constraints |
| "Settlement is just payment processing" | Misses multi-party split, TCS/TDS, COD complexity |
| "WhatsApp for sending order updates" | Notification-level thinking, not conversational commerce |
| "Search from our database" | Doesn't recognize the federated search problem |
| "Block bad sellers" | Doesn't understand that NPs can't unilaterally remove entities from the ONDC network |

---

## Follow-Up Questions for Depth Assessment

These questions probe deeper once the candidate has established their high-level design:

### On Federated Search
- "How would you handle a search where 3 NPs respond in 200ms but 2 NPs are consistently slow (2-3s)? Do you wait for all?"
- "If your pre-indexed catalog shows an item at ₹200 but the live `on_select` says ₹250, what do you show the buyer?"
- "How would you detect and handle a seller NP that returns different prices in `on_search` vs. `on_select`?"

### On Protocol Design
- "What happens if an NP ACKs your `confirm` but never sends `on_confirm`? Walk me through the timeout cascade."
- "How would you handle a protocol message that has a valid signature but references a `transaction_id` you've never seen?"
- "If two NPs send conflicting `on_status` messages for the same order (one says DELIVERED, the other says RETURNED), how do you resolve this?"

### On Settlement
- "Walk me through what happens when a buyer returns 1 of 3 items from a multi-item order. How does the partial refund settlement work?"
- "If the logistics NP reports COD collection of ₹500 but only remits ₹480, how does your system detect and handle the discrepancy?"

### On Trust
- "A new seller NP joins with 10,000 sellers and zero transaction history. How do you determine trust for their sellers?"
- "How would you detect if two NPs are colluding to inflate each other's trust scores?"
