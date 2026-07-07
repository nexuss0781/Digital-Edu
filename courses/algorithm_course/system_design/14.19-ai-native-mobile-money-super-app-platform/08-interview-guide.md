# Interview Guide — AI-Native Mobile Money Super App Platform

## 45-Minute Interview Pacing

| Phase | Time | Focus | Evaluation Criteria |
|---|---|---|---|
| **Phase 1: Problem Framing** | 0–8 min | Scope definition, unique constraints identification | Does the candidate immediately recognize USSD constraints, agent network complexity, and financial system guarantees? Or do they start with a generic payment system? |
| **Phase 2: High-Level Design** | 8–20 min | Architecture, major components, data flows | Can they design a dual-channel system (USSD + App) with a unified ledger? Do they account for the agent layer? |
| **Phase 3: Deep Dive** | 20–38 min | Choose 1–2 areas for detailed design (USSD session management, fraud detection, float management, credit scoring) | Depth of understanding of chosen area; awareness of edge cases specific to mobile money |
| **Phase 4: Trade-offs & Extensions** | 38–45 min | Scaling, multi-country, super app evolution | Can they reason about regulatory constraints, cross-border settlement, and platform evolution? |

---

## Phase 1: Problem Framing Questions

### Opening Question
*"Design a mobile money platform like M-Pesa that supports P2P transfers, merchant payments, agent cash-in/cash-out, and embedded financial products (nano-loans, micro-insurance) for 60 million users across multiple African countries."*

### Probing Questions

**Understanding constraints:**
- "What makes this different from designing PayPal or Venmo?"
  - **Strong answer:** Identifies USSD as primary interface (feature phone dominance), agent network as physical infrastructure layer, infrastructure constraints (intermittent connectivity, power outages), and unbanked population (no existing financial identity). Recognizes that the hard problem isn't the technology—it's building bank-grade reliability on unreliable infrastructure.
  - **Weak answer:** Treats it as a standard payment API with a "simpler interface for developing markets."

- "Who are your users and how do they access the platform?"
  - **Strong answer:** Distinguishes between feature phone users (USSD), smartphone users (app), agents (POS/app), merchants (till number/QR), and third-party developers (API). Notes that a significant percentage of users may be illiterate or have minimal digital literacy.
  - **Weak answer:** Assumes all users have smartphones and internet.

- "What are the financial system guarantees you need?"
  - **Strong answer:** Exactly-once transaction semantics, double-entry ledger, zero tolerance for money loss, regulatory audit trail, trust account reconciliation.
  - **Weak answer:** "We need ACID transactions"—correct but insufficient.

---

## Phase 2: High-Level Design Questions

### Architecture Questions

- "Walk me through the architecture from a user dialing *334# to completing a P2P transfer."
  - **Strong answer:** Phone → MNO cell tower → MNO USSD gateway → Platform USSD session manager (stateful, server-side) → sequential menu screens (5–6 steps) → PIN verification → fraud check → double-entry ledger write → SMS confirmation to both parties. Mentions the 60–180 second session timeout budget and 182-character screen limit.
  - **Weak answer:** Skips USSD entirely or treats it as a simple API call.

- "How does the agent cash-in/cash-out flow work?"
  - **Strong answer:** Describes the dual-balance problem (electronic float + physical cash), the need for both agent and customer to authenticate, the float management hierarchy (retail agent → dealer → super-agent → head office), and the rebalancing challenge.
  - **Weak answer:** Treats agents as ATMs rather than as human intermediaries with their own liquidity constraints.

- "How do you handle a transaction that commits to the ledger but the USSD session drops before the user sees confirmation?"
  - **Strong answer:** Describes the "orphaned post-commit" scenario, SMS fallback confirmation, and idempotency protection against re-initiation. May discuss transaction receipt lookup via separate USSD shortcode or mini-statement.
  - **Weak answer:** "We can retry the USSD session"—USSD sessions cannot be resumed once terminated.

### Data Model Questions

- "Design the wallet and transaction data models."
  - **Strong answer:** Wallet identified by MSISDN with balance in smallest currency unit (cents), version field for optimistic concurrency. Transaction as a double-entry journal: every transaction produces at least two ledger entries (debit + credit) that must balance. Mentions idempotency key, fraud score at time of transaction, and before/after balance snapshots for audit.
  - **Weak answer:** Single-entry balance update without journal or audit trail.

---

## Phase 3: Deep Dive Questions

### USSD Session Management Deep Dive

- "How do you manage state across a multi-step USSD session?"
  - **Strong answer:** Server-side session store (in-memory cache) keyed by (session_id, MSISDN). Session state includes: current menu position, accumulated user inputs (recipient, amount), PIN verification status, and expiry timer. The session store has a TTL matching the MNO timeout. Mentions that different MNOs have different timeouts and protocol behaviors.
  - **Weak answer:** Relies on client-side state (USSD has no client-side state).

- "What's your latency budget for each USSD screen?"
  - **Strong answer:** Total session timeout: 60–180s. User think time: ~8s per screen × 5 screens = 40s. Remaining for system: 20–140s. But network latency between user's phone and MNO gateway is variable (2–10s on 2G). Target server-side processing: <500ms per screen. This gives comfortable margin for most flows but constrains what can happen per screen—no complex computations, no external API calls that might timeout.
  - **Weak answer:** Doesn't account for the session timeout budget.

### Fraud Detection Deep Dive

- "How do you detect SIM swap fraud?"
  - **Strong answer:** Multi-layer: (1) MNO real-time notification of SIM change → immediate wallet freeze, (2) IMSI comparison on each USSD session → detect at first post-swap session, (3) behavioral biometric change detection → catch even if IMSI check isn't available. Describes the 72-hour cooling period and progressive access restoration.
  - **Weak answer:** Only mentions checking with the MNO, not the compensating controls.

- "What's the trade-off between fraud detection accuracy and transaction latency?"
  - **Strong answer:** Describes two-phase architecture: fast rule engine (<10ms) catches known patterns, ML ensemble (<200ms) catches nuanced fraud. For high-value transactions, synchronous deep analysis adds 2–3 seconds. Explains that post-commit fraud detection is a fallback but money has already moved—reversal requires cooperation.
  - **Weak answer:** Treats it as a simple threshold decision.

### Agent Float Management Deep Dive

- "How do you predict and manage agent float across 300,000 agents?"
  - **Strong answer:** Each agent is a time-series forecasting problem. Features: historical cash-in/cash-out by hour, day-of-week, day-of-month (payday), seasonality, location type (urban/rural/transport hub). Predictions drive proactive alerts to agents and dealers. Discusses the physical logistics constraint: even if you predict perfectly, moving physical cash takes hours.
  - **Weak answer:** Static float allocation or manual monitoring.

### Credit Scoring Deep Dive

- "How do you build a credit score for someone with no banking history?"
  - **Strong answer:** Uses mobile money behavioral data as proxy: transaction regularity (income stability proxy), bill payment timeliness (financial discipline proxy), savings behavior (planning capacity proxy), social graph quality (community stability proxy). Mentions ensemble model (gradient boosted trees + sequence model), graduated lending strategy (small first loan, increase with repayment), and fairness monitoring (score distributions by demographic group).
  - **Weak answer:** Suggests using traditional credit bureau data or simple rule-based scoring.

---

## Trap Questions and Common Mistakes

### Trap 1: "Can we just use REST APIs instead of USSD?"
**The trap:** This ignores the fundamental market reality. Feature phones dominate in Sub-Saharan Africa—in many markets, 60%+ of users have no smartphone. Eliminating USSD eliminates the majority of users. The candidate should explain why USSD is a hard constraint, not a design choice.

### Trap 2: "Let's use blockchain for the ledger"
**The trap:** Blockchain's consensus mechanism adds seconds of latency per transaction—incompatible with the 500ms-per-screen USSD latency budget. Mobile money doesn't need trustless consensus (the platform is the trusted intermediary). The candidate should explain why a centralized double-entry ledger is the right choice: faster, simpler, auditable, and the trust model is appropriate.

### Trap 3: "We can handle offline mode with eventual consistency"
**The trap:** "Eventual consistency" for a financial ledger means money can be double-spent. If a user's wallet shows $100 and they withdraw $100 from two different agents simultaneously (both in offline mode), eventual consistency would allow both transactions—creating $100 from nothing. The candidate should describe how offline mode uses conservative limits, cryptographic tokens, and explicit float over-commitment risk acceptance with manual resolution.

### Trap 4: "Store the PIN encrypted instead of hashed"
**The trap:** Encrypted PINs can be decrypted (by anyone with the key), while hashed PINs cannot be reversed. Even though USSD transmits PINs in cleartext (an inherent protocol limitation), storing them encrypted rather than hashed creates an unnecessary risk surface. The candidate should advocate for bcrypt hashing.

### Trap 5: "Run fraud detection asynchronously to avoid adding latency"
**The trap:** Asynchronous fraud detection means the money moves before the fraud check completes. For mobile money, once money is in the receiver's wallet, they can withdraw it at an agent within seconds—making reversal practically impossible (unlike credit card chargebacks where the merchant relationship provides a reversal path). The candidate should argue for synchronous inline fraud detection with a tight latency budget.

### Trap 6: "Use a single global database for all countries"
**The trap:** Financial regulators in most African countries mandate data residency—customer financial data must stay within the country's borders. A global database violates this. Additionally, a global database creates a single point of failure across all markets. The candidate should design country-isolated data stores with shared (anonymized) ML infrastructure.

---

## Key Trade-off Discussions

### Trade-off 1: USSD Transaction Limits vs. User Experience
- Lower USSD limits (compensating for cleartext PIN transmission) frustrate power users who must use USSD because they lack smartphones
- Higher limits increase fraud risk on the inherently less secure channel
- **Discussion point:** How do you set limits that balance security and usability? Should limits be personalized based on user risk profile?

### Trade-off 2: Fraud Detection Strictness vs. Financial Inclusion
- Strict fraud rules block more fraud but also block more legitimate transactions (false positives)
- In populations with irregular financial patterns (informal economy), "normal" behavior looks like "anomalous" behavior to traditional fraud models
- **Discussion point:** How do you calibrate fraud models for populations whose transaction patterns differ from the training data?

### Trade-off 3: Credit Model Accuracy vs. Financial Inclusion
- Conservative models approve fewer loans and have lower default rates but exclude more deserving borrowers
- Aggressive models include more people but risk portfolio losses and potential over-indebtedness
- **Discussion point:** How do you balance the social mission (financial inclusion) against portfolio risk? Is a 4% default rate acceptable if it means 30% more people get access to credit?

### Trade-off 4: Agent Offline Transaction Limits
- Higher offline limits mean agents can serve more customers during connectivity outages
- Higher limits increase the risk of float over-commitment and fraud during the reconciliation gap
- **Discussion point:** Should offline limits vary by agent trust score? What's the reconciliation process when offline transactions exceed available float?

### Trade-off 5: Multi-Country Code Sharing vs. Country-Specific Implementation
- Shared codebase reduces development effort and ensures consistent behavior
- Country-specific requirements (regulatory, MNO protocol, language) create configuration complexity
- **Discussion point:** Where is the boundary between "configuration" and "custom code"? How do you handle a country that requires a fundamentally different flow (e.g., mandatory biometric for every transaction)?

---

## Scoring Rubric

| Dimension | Junior (1-2) | Mid (3-4) | Senior (5-6) | Staff+ (7-8) |
|---|---|---|---|---|
| **Constraint Awareness** | Designs generic payment system | Mentions USSD but doesn't deeply understand constraints | Designs around USSD timeouts, 182-char limits, and feature phone dominance | Explains how USSD constraints ripple through entire system design (latency budgets, error handling, receipt mechanism) |
| **Financial Rigor** | Single-entry balance tracking | Mentions ACID but doesn't implement double-entry | Designs double-entry ledger with idempotency and audit trail | Explains trust account reconciliation, regulatory reporting, and exactly-once semantics across unreliable networks |
| **Agent Network** | Ignores agents or treats as simple endpoints | Mentions agents but doesn't address float management | Designs float tracking and rebalancing hierarchy | Explains AI-driven float forecasting, physical logistics constraints, and the cash-digital duality |
| **Fraud Detection** | Rule-based checks only | ML-based scoring mentioned | Two-phase architecture with SIM swap detection | Explains behavioral biometrics, graph-based agent collusion detection, and the latency-accuracy trade-off |
| **Multi-Country** | Single-country design | Mentions "configuration per country" | Designs data isolation for regulatory compliance | Explains cross-border settlement, multi-currency ledger, and regulatory rules engine |
| **AI Integration** | No AI consideration | Mentions fraud and credit scoring | Designs credit scoring pipeline for unbanked | Explains alternative data features, model fairness, shared phone challenge, and graph-based social scoring |

---

## Red Flags and Anti-Patterns

### Red Flag 1: Ignoring the Agent Layer
A candidate who designs a mobile money system without mentioning agents has missed the most complex part. Agents are the physical-digital bridge—they handle cash logistics, liquidity management, and last-mile customer interaction. Treating mobile money as purely digital (like PayPal) misses the fundamental engineering challenge.

### Red Flag 2: "We'll Use Eventual Consistency for the Ledger"
Eventual consistency for a financial ledger means accepting temporary states where money exists in two places simultaneously or doesn't exist anywhere. This is unacceptable for a payment system. The candidate should understand that the ledger requires strong consistency even at the cost of higher latency.

### Red Flag 3: Designing Only for Smartphones
If the candidate's architecture requires a persistent TCP connection, background processing, local storage, or any capability beyond sequential text menus—they've designed a system that excludes 55%+ of the user base. The architecture must be USSD-first, not app-first.

### Red Flag 4: Ignoring the Regulatory Dimension
Mobile money operates under financial regulation. A candidate who doesn't mention KYC tiers, transaction limits, data sovereignty, or trust account reconciliation is missing critical system requirements that shape the architecture.

### Red Flag 5: Treating All Countries Identically
Multi-country deployment requires per-country regulatory rules, MNO integrations, currency handling, and data isolation. A candidate who proposes a "deploy the same thing everywhere" approach hasn't understood the regulatory complexity.

---

## Extended Discussion Topics

### Topic 1: Super App Evolution
*"M-Pesa started as P2P transfers. How does the platform evolve into a super app with ride-hailing, e-commerce, and third-party mini-apps?"*

**Discussion points:**
- The USSD menu depth constraint limits product expansion on the primary channel
- The developer API (Daraja-style) creates an ecosystem but requires OAuth, webhooks, sandbox environments
- The wallet becomes a platform—other services pay via wallet rather than building their own payment infrastructure
- Data moat: the transaction graph enables personalized recommendations that standalone apps can't match

### Topic 2: Interoperability Mandates
*"The regulator mandates that users must be able to send money to any mobile money provider, not just within your network. How does this change the architecture?"*

**Discussion points:**
- Bilateral agreements vs. industry-wide switch (like Tanzania's model)
- Real-time interbank settlement requires participation in national payment infrastructure
- Impact on fraud detection: cross-network transfers have less behavioral data for the recipient
- Revenue impact: interoperability reduces lock-in but expands the addressable market

### Topic 3: Financial Inclusion vs. Risk Management
*"Your credit model rejects 40% of applicants. The CEO says this number is too high—we need to approve at least 70% to meet our financial inclusion mission. How do you balance this?"*

**Discussion points:**
- Graduated lending: approve more with smaller initial loans
- Model recalibration: lower the threshold but accept higher default rates
- Risk-adjusted pricing: approve more but charge higher rates for riskier borrowers
- Portfolio-level risk: maintain aggregate default rate within targets even if individual approval rate increases
- Fairness monitoring: ensure that lowering the threshold doesn't disproportionately benefit one demographic over another

### Topic 4: Offline-First Architecture
*"30% of your agent network has less than 4 hours of continuous connectivity per day. How do you serve them?"*

**Discussion points:**
- Store-and-forward with cryptographic transaction tokens
- Conservative offline float limits to manage over-commitment risk
- Sync prioritization when connectivity returns (flood control)
- The fundamental tension: offline access improves coverage but weakens fraud detection and real-time balance accuracy

### Topic 5: Transitioning from USSD to App-First
*"Smartphone penetration in your market has crossed 60%. Should you deprecate USSD?"*

**Discussion points:**
- The remaining 40% are the most financially vulnerable users—deprecating USSD excludes them
- The transition is gradual: incentivize app adoption (lower fees on app) while maintaining USSD
- App-exclusive features (biometric auth, QR payments, mini-apps) create a natural migration path
- Technical debt: maintaining two channels doubles the testing surface for every new product

---

## Scoring Rubric (Extended)

### Detailed Evaluation Criteria

| Dimension | 1-2 (Junior) | 3-4 (Mid) | 5-6 (Senior) | 7-8 (Staff+) | 9-10 (Distinguished) |
|---|---|---|---|---|---|
| **System Design Fundamentals** | Basic client-server; misses key components | Identifies main components; incomplete data flow | Complete architecture with correct data flows | Identifies non-obvious components (orphan detection, float forecasting) | Designs for evolution—anticipates regulatory changes, product expansion, channel migration |
| **Financial Systems Expertise** | No awareness of financial constraints | Mentions ACID; basic balance tracking | Double-entry ledger; idempotency; reconciliation | Trust account Rule that never changes; regulatory reporting; cross-country isolation | Designs continuous reconciliation pipeline; articulates the trust-account-as-observability-signal insight |
| **Distributed Systems** | Assumes reliable single-node processing | Mentions replication and caching | Designs for partition tolerance; explains CAP implications | Explains saga patterns for cross-shard ledger; back-pressure mechanisms | Designs for infrastructure-constrained environments; explains how USSD timeouts create natural circuit breakers |
| **AI/ML Integration** | No ML consideration | Mentions fraud scoring | Designs two-phase fraud architecture; describes feature engineering | Explains graph-based credit scoring; addresses model fairness | Articulates the PageRank-style iterative convergence for social graph scoring; explains federated learning for cross-country models |
| **Domain Expertise** | Generic fintech knowledge | Knows USSD exists; basic agent concept | Designs for USSD constraints; float management; multi-channel | Explains SIM swap attack lifecycle; agent collusion detection; shared phone challenges | Articulates the physical-digital consensus problem; explains why the agent network is a capacitated vehicle routing problem |

---

## Additional Discussion Topics

### Discussion 1: When NOT to Build Mobile Money

- "If you were advising a startup entering a market where 80% of users already have smartphones and bank accounts, would you still build USSD-first?"
- **Strong answer:** No. USSD-first adds massive complexity (session management, 182-char constraints, MNO gateway dependencies) that is only justified when the majority of users cannot use apps. In a smartphone-dominant market, app-only with SMS fallback for notifications is simpler, cheaper, and provides a better UX. The cost of USSD gateway integration, per-session MNO fees, and dual-channel testing doubles the engineering effort for every new product.

### Discussion 2: The Trust Account as Observability Signal

- "What's the single most important metric you would monitor 24/7?"
- **Strong answer:** The trust account reconciliation: `sum(all_wallet_balances) == partner_bank_trust_account_balance`. Any discrepancy—even one cent—means money was created or destroyed in the system, which is impossible in a correct double-entry ledger. This single number catches bugs, fraud, and data corruption more reliably than any other metric.
- **Weak answer:** Focuses on TPS or latency without mentioning financial integrity metrics.

### Discussion 3: Handling a Regulatory Change Mid-Sprint

- "Ghana just announced that the e-levy will change from 1.5% to 1.0% effective in 30 days. How does your system handle this?"
- **Strong answer:** The regulatory rules engine stores rules with `effective_from` and `effective_until` dates. A new rule version is created with the new rate and the effective date. The system evaluates the correct rule based on the transaction timestamp. This enables: testing the new rate in staging before the effective date, instant activation at midnight on the effective date, retroactive auditing (can reconstruct what rate applied to any historical transaction), and rollback if the regulation is reversed.

---

## Red Flags in Candidate Responses

| Red Flag | What It Reveals |
|---|---|
| "We can just use WebSocket for real-time updates" | Doesn't understand that feature phone users have no WebSocket capability; USSD is the only real-time channel |
| "Let's store balances in a NoSQL database for speed" | Doesn't appreciate financial system requirements: ACID guarantees, double-entry invariants, and regulatory audit trails require relational semantics |
| "We'll handle fraud detection asynchronously" | Doesn't understand that once money moves, physical cash withdrawal makes reversal impossible; synchronous inline detection is mandatory |
| "One global database for all countries" | Ignores data residency requirements that are legally mandated in most African jurisdictions |
| "The agent is just an API client" | Fails to recognize that agents are physical human intermediaries with cash logistics constraints, fraud incentives, and connectivity limitations |
| "We can use eventual consistency for the ledger" | Would allow double-spending; a user with $100 could withdraw $100 at two agents simultaneously |
| "Let's skip USSD and just build an app" | Excludes 55%+ of the user base who only have feature phones; misunderstands the market |

---

## Deep Dive Prompts (15-Minute Extension)

### Prompt 1: Payday Surge Architecture

"It's the 25th of the month in Kenya—payday for government workers. Transaction volume spikes to 3× normal. How does the system handle this? Walk me through from capacity planning to real-time response."

**Expected coverage:** Pre-scaling (ML-predicted surge timing), admission control levels, per-MNO gateway capacity negotiation, agent float pre-positioning through dealer network, degradation strategy for non-critical services, post-surge reconciliation.

### Prompt 2: Multi-Country Expansion

"You're launching in a new country (Ethiopia) that has a government-mandated mobile money framework, different KYC requirements, a unique alphabet (Ge'ez script that reduces USSD screen capacity from 182 to 67 characters in UCS-2 mode), and only one MNO. How do you architect the deployment?"

**Expected coverage:** Country-specific configuration layer, UCS-2 vs. GSM 7-bit character encoding trade-off, transliteration strategy for USSD, data residency (in-country database deployment), MNO integration timeline, regulatory rules engine configuration, localized fraud model training with limited initial data.

### Prompt 3: Credit Model Fairness Audit

"Your credit scoring model has been running for 2 years. A regulator asks you to prove it doesn't discriminate against women. How do you respond?"

**Expected coverage:** Demographic parity analysis (score distributions by gender), equalized odds verification (same default rate for same score across genders), proxy variable detection (are any features correlated with gender?), explainability reports (top features per decision), calibration curves by cohort, and the fundamental tension between model accuracy and demographic parity.

---

## Candidate Self-Assessment Checklist

After the interview, candidates should be able to answer:

- [ ] Did I identify USSD as the primary interface and explain its constraints (timeout, 182 chars, stateful sessions)?
- [ ] Did I design a double-entry ledger with idempotency and exactly-once semantics?
- [ ] Did I address the agent float management problem (physical cash + electronic float)?
- [ ] Did I explain how fraud detection works inline (synchronous) with a latency budget?
- [ ] Did I discuss how credit scoring works for users with no banking history?
- [ ] Did I design for multi-country with data isolation for regulatory compliance?
- [ ] Did I handle the "orphaned post-commit" USSD session Edge Case (Unusual or extreme situation)?
- [ ] Did I explain the trust account reconciliation Rule that never changes?
- [ ] Did I address offline/store-and-forward transaction handling?
- [ ] Did I reason about trade-offs rather than just presenting a single solution?
