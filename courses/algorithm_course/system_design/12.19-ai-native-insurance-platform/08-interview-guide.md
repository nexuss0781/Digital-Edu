# 12.19 AI-Native Insurance Platform — Interview Guide

## Overview

Designing an AI-native insurance platform is a senior/staff-level question that tests the intersection of ML systems design, financial regulatory compliance, event-driven architecture, graph databases, and behavioral pricing. It is richer than most system design questions because the "business logic" (underwriting, pricing, fraud detection) is itself an engineering problem—not a simple CRUD workflow. Interviewers are looking for candidates who understand that insurance is a regulated ML application, not just a web application that happens to use ML.

**Typical time allocation:** 45–55 minutes

---

## 45-Minute Interview Pacing

| Phase | Time | Focus |
|---|---|---|
| Requirements clarification | 5–7 min | Lines of business, real-time vs. batch, regulatory context, key differentiators (UBI/telematics) |
| Back-of-envelope estimation | 5–7 min | Quote QPS, telematics events/sec, claims volume, fraud graph size |
| High-level architecture | 8–10 min | Quote pipeline → telematics → claims FNOL → fraud scoring → regulatory layer |
| Deep dive (interviewer-directed) | 12–15 min | Underwriting pipeline OR fraud detection OR telematics OR regulatory compliance |
| Extensions and trade-offs | 5–7 min | CAT event scaling, model drift, behavioral pricing fairness |
| Wrap-up | 2–3 min | |

---

## Opening Phase: Requirements Clarification

### Questions the Candidate Should Ask

**Lines of business and scope:**
- "Which lines of insurance are we covering—auto only, or also home, renters, life?"
- "Are we building for a single US state to start, or 50-state coverage from day one?"
- "Is telematics-based behavioral pricing in scope, or is this a standard application-data-only underwriter?"

**Real-time requirements:**
- "What's the target customer experience for quoting—can we call external data bureaus synchronously, or must we return a score before external data arrives?"
- "For claims: are we targeting autonomous claims payment (no adjuster), or is the AI just a first-pass intake and triage system?"

**Scale:**
- "What's the expected policy count and annual quote volume?"
- "What percentage of policyholders are expected to opt into telematics?"

**Regulatory context:**
- "Is FCRA adverse action notice compliance in scope from day one?"
- "Are we expected to handle the 50-state rate filing process technically, or just flag it as an out-of-scope compliance function?"

### Strong Candidate Signal

A strong candidate immediately asks about the regulatory environment and frames it as an architecture constraint, not a post-launch compliance concern. They recognize that "which variables can be used in which state" is not a data problem—it is a configuration problem that shapes the entire feature pipeline and model deployment strategy.

---

## Deep Dive Phase: Common Interviewer Probes

### Deep Dive 1: Underwriting Pipeline Design

**Interviewer prompt:** "Walk me through how you'd design the real-time underwriting engine—from the moment a customer submits a quote request to the moment they see a bindable offer."

**Strong response covers:**
- External bureau calls (MVR, CLUE, credit) are the latency Slowest part of the process; fire in parallel immediately on request receipt
- Preliminary quote pathway (application-data-only scoring) while bureau calls are in flight; reconcile after bureau data arrives
- State-parameterized feature set—the model doesn't run on all features; it runs on the state-approved feature subset
- Immutable risk score record written before policy binding—not after
- SHAP attribution computation async (post-scoring), not on the critical path
- Graceful degradation tiers (GLM → GBM → manual underwriting) when ML infrastructure has issues

**Trap question:** "Why not just train one big national model for all 50 states?"

**Expected answer:** A single national model cannot satisfy state-by-state regulatory requirements. A model trained on California data where credit score is prohibited must never have seen credit score as an input during training—otherwise the model may have implicitly learned credit score through proxy variables, invalidating the California rate filing. The algorithm, feature set, and sometimes the model weights themselves are approved on a per-state basis by the insurance commissioner. The system must be able to demonstrate to a California regulator that credit score was never used.

### Deep Dive 2: Fraud Detection Architecture

**Interviewer prompt:** "A newly submitted auto claim looks straightforward—a rear-end collision with two parties. How would you detect that this claim is part of an organized fraud ring?"

**Strong response covers:**
- Graph model: represent every entity (claimant, vehicle, provider, body shop, location) as a node; claims create edges
- 2-hop subgraph retrieval for every new claim: look at who the claimant has been in accidents with, which providers they've used, whether those providers appear in many other suspect claims
- GNN inference on subgraph: entity embeddings capture network context that is invisible to per-claim rules
- Batch ring detection (Louvain community detection) runs weekly on the full graph to surface structured fraud networks to SIU
- Real-time scoring on FNOL is synchronous (blocks payment decision); ring detection is batch (produces investigative leads)
- Fraud score must be explainable: which graph features (e.g., "this body shop appeared in 12 high-fraud claims in the past 6 months") drove the score

**Trap question:** "Why not just use rule-based fraud detection? Rules are interpretable and auditable."

**Expected answer:** Rule-based systems can catch known fraud patterns but are easily evaded by sophisticated rings that learn the rules. They also produce high false positive rates when tuned broadly. The fundamental limitation is that rules evaluate claims in isolation; organized ring fraud is defined by network structure, not individual claim characteristics. A claim can be completely legitimate in isolation (plausible accident description, reasonable claim amount) but be part of a coordinated network of 40 staged accidents—only the graph reveals this. Rules are still valuable as first-pass filters and for explainability, but they cannot substitute for graph-based detection.

### Deep Dive 3: Telematics Pipeline

**Interviewer prompt:** "A policyholder's smartphone SDK has been collecting driving data for 3 months and they believe their score is incorrect because the device was in the car while a different person was driving. How does your system handle this?"

**Strong response covers:**
- Driver identification is a real problem in telematics: device ≠ driver. High-quality systems use secondary signals (Bluetooth pairing with vehicle, trip start time alignment with known commute patterns, gyrometric fingerprinting) to estimate driver identity
- Trip-level dispute mechanism: customer can flag individual trips within a 30-day window; flagged trips are excluded from behavioral scoring pending investigation
- Explainability: the customer portal should show their rolling score, top contributing/detracting trips, and which behavioral dimensions (braking, speed, phone use) are pulling the score down—enabling meaningful dispute
- Data retention for disputes: aggregated trip features retained for 30 days; raw GPS available for 30 days only for dispute resolution, then purged
- Manual re-rating on dispute resolution: if trips are excluded, the score is recomputed and the premium adjusted retroactively if significant

**Trap question:** "Should the telematics system store raw GPS traces server-side to enable better dispute resolution?"

**Expected answer:** No. Storing raw GPS traces is a major privacy risk—it creates a detailed record of every location the customer has visited, creating liability for the insurer. A subpoena or data breach would expose extraordinarily sensitive personal data. The right design is to compute all features on-device and upload only aggregated trip metrics. For disputes, the customer can optionally upload a limited-window trace from their own device, which the insurer analyzes and discards. The privacy cost of raw GPS storage (in terms of consumer trust, regulatory risk, and breach liability) far exceeds the benefit.

### Deep Dive 4: Regulatory Compliance at Scale

**Interviewer prompt:** "Your data science team has trained a new model that significantly improves loss ratio prediction. How does it get from their laptop to production underwriting decisions?"

**Strong response covers:**
- Model artifact is committed to the model registry; does NOT go to production immediately
- Actuarial analysis: run disparate impact tests on all protected class proxies; document loss separation by model score decile
- Rate filing package: generate SERFF-format filing for each state the model will be used in; includes algorithm description, input variables, output definitions, and statistical exhibits
- State-by-state regulatory review: each state has its own timeline (15-day prior approval, file-and-use, use-and-file, or no-prior-approval, depending on state)
- Algorithm version registry: when State A approves the new model, the `rate_algorithm` config for State A is updated to activate the new model artifact; State B continues using the previous version
- Immutable history: the old rate_algorithm version is never deleted—policies bound under it must be ratable for regulatory audit for 7+ years

**Trap question:** "Can you just shadow-test the new model (run it without using its output for pricing) while waiting for regulatory approval?"

**Expected answer:** Shadow testing is valuable and common, but there is a subtlety: using the new model's output for any pricing-related decision (including pricing experiments or soft offers) before regulatory approval is a regulatory violation in prior-approval states. Shadow testing must be clearly documented as non-binding—the actual pricing decision must use only the approved algorithm. Shadow results can be used as evidence in the rate filing to demonstrate the model's predictive accuracy to the regulator, but cannot influence actual premiums until approved.

---

## Extension Questions

### Extension 1: CAT Event Handling

"A hurricane is making landfall. Within 2 hours, your FNOL volume is 100× normal. Walk me through how your system responds."

Good answer covers:
- Geospatial claims density detection triggers CAT mode automatically
- Conversational AI intake simplified to structured web form (cannot scale AI conversation at 100× volume)
- Fraud scoring shifted from synchronous to async (claim acknowledged immediately; fraud scored within 24 hours)
- Straight-through payment suspended for affected region (fraud scoring delay means payment cannot be auto-approved)
- CAT adjuster pool activation (pre-contracted surge staffing)
- FNOL queue must be durable with at-least-once delivery—no claims lost regardless of processing backlog

### Extension 2: Behavioral Pricing Fairness

"A policyholders' advocacy group claims that your telematics-based pricing discriminates against low-income drivers who live in urban areas (more stop-and-go, more nighttime driving, less highway). How would you respond architecturally?"

Good answer covers:
- Disparate impact analysis must test the behavioral score itself against income/geography proxies, not just individual features
- Actuarial justification: each behavioral variable must have documented correlation with loss probability, not just correlation with income
- Opt-out availability: telematics must be optional; standard pricing must be available at all times
- Some behavioral features may be legitimate risk predictors even if correlated with income (nighttime driving correlates with both lower income AND higher crash risk); others may be correlated with income without loss correlation and should be excluded
- Disclosure: the insurer must disclose which behavioral factors affect pricing; consumers must be able to improve their score

### Extension 3: Model Retraining Governance

"How often should you retrain the underwriting model, and what prevents a poorly trained version from going to production?"

Good answer covers:
- Retraining frequency: annually for filed algorithms (regulatory constraint), more frequently for fraud scoring (no rate filing required)
- Model risk management (MRM) framework: champion-challenger testing (new model on shadow quotes for 90 days); statistical validation against holdout; backtesting on recent loss cohort
- Disparate impact gate: must pass before any deployment consideration
- Rate filing activation: approved algorithm must be filed before use; cannot use a newly trained model without regulatory approval
- Rollback plan: previous model version stays in registry; can reactivate in < 1 hour if new model shows adverse behavior post-deployment

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---|---|---|
| Treating regulatory compliance as a post-launch concern | State insurance regulations shape the data model, feature pipeline, and model deployment from day one | Frame prohibited factors and rate filing as architecture constraints, not external requirements |
| Designing a single national model for all states | Rate algorithms are state-approved; different states may have different approved features and weights | Algorithm version registry with per-state activation |
| Assuming fraud scoring can be asynchronous | Fraud scoring on the FNOL path prevents fraudulent claims from entering the payment queue | Synchronous fraud scoring at FNOL; async only under CAT mode |
| Storing raw GPS server-side | Privacy liability, breach risk, regulatory exposure; consumer trust | Edge aggregation on device; feature vectors only uploaded; opt-in dispute window |
| Not addressing the bureau enrichment latency | External MVR/CLUE/credit calls are slow; synchronous waiting produces terrible UX | Parallel fan-out; preliminary quote with reconciliation |
| Ignoring loss ratio monitoring as an observability concern | Technical system health metrics don't detect model drift; mispriced risk is financially catastrophic | Actuarial monitoring (loss ratio by cohort, PSI) as first-class observability |
| One-size-fits-all fraud scoring | Individual claim scoring misses organized ring fraud | Graph-based detection with GNN for ring patterns; per-claim scoring only for individual signals |
| FCRA adverse action as an afterthought | FCRA requires specific reason codes and delivery timelines; missing deadlines is a regulatory violation | Adverse action notice generation is a synchronous step in the underwriting decision flow |

---

## Estimation Questions

### Estimation 1: Bureau Enrichment Cost at Scale

**Prompt:** "We process 50M quotes per year. Each quote requires MVR ($1), CLUE ($2), and credit soft pull ($0.25). What's our annual bureau cost, and how would you reduce it?"

**Strong answer:**

```
Naive cost (no caching):
  50M quotes × ($1 + $2 + $0.25) = $162.5M/year

With 30-day TTL caching:
  Quote-to-bind ratio: 20% → 10M unique applicants bind
  Returning applicants within 30 days: ~60% of quotes are re-quotes
  Unique bureau calls needed: 50M × 0.4 = 20M (40% are first-time or expired)
  Cached: 30M quotes served from cache (0 bureau cost)
  Bureau cost with caching: 20M × $3.25 = $65M/year
  Savings: $97.5M/year (~60% reduction)

Further optimization:
  - Soft pull only at quote; hard pull only at bind ($0.25 → save $0 at quote)
  - Skip CLUE for renters/pet (low-value LOBs): saves $2 × 5M = $10M
  - Tiered caching: credit scores stable for 90 days; extend TTL: additional 15% savings
  - Net optimized cost: ~$45-50M/year
```

### Estimation 2: Fraud Graph Memory Sizing

**Prompt:** "You have 5M active policies, 6M claims/year, and need to maintain a fraud entity graph with 2-hop subgraph retrieval under 500ms. Size the graph database."

**Strong answer:**

```
Entity counts:
  Claimant entities:     ~5M (unique claimants across all policies)
  Vehicle entities:      ~6M (registered vehicles; some shared across policies)
  Provider entities:     ~500K (repair shops, medical, legal)
  Location clusters:     ~10M (accident locations clustered to 100m grid)
  Total nodes:           ~21.5M

Relationship edges:
  Each claim creates ~5 edges (claimant→vehicle, claimant→location,
    claimant→provider, vehicle→location, co-claimant links)
  6M claims/year × 5 = 30M edges/year
  10-year retention: ~300M edges (some entities shared)
  Plus historical backfill: ~200M
  Total edges: ~500M

Memory sizing:
  Node: 21.5M × ~500 bytes (properties + embedding) = 10.75 GB
  Edge: 500M × ~100 bytes (type + weight + metadata)  = 50 GB
  Adjacency index: ~20 GB (optimized for 2-hop traversal)
  GNN embedding vectors: 21.5M × 128 floats × 4 bytes = 11 GB
  Total: ~92 GB → 128 GB RAM graph DB node

  For HA: 3-node cluster (1 leader + 2 read replicas)
  Total memory: 384 GB across cluster
```

---

## Advanced Discussion Topics

### Topic 1: Continuous Underwriting vs. Point-in-Time Scoring

**Discussion prompt:** "Telematics gives us real-time behavioral data, but the regulatory framework assumes point-in-time underwriting decisions. How do you reconcile continuous signals with discrete rate filings?"

**Key points for discussion:**
- Rating algorithms are filed and approved at a point in time; they define how the behavioral score maps to premium
- The behavioral score itself updates continuously, but the premium is only recalculated at billing cycle boundaries (monthly, semi-annual, annual)
- This creates a lag: a driver's behavior changes immediately, but the premium change is only visible at the next billing cycle
- Some states mandate that mid-term premium increases are prohibited (rates can only change at renewal); continuous telematics benefits are limited to renewal pricing in these states
- The filed algorithm must specify the maximum premium adjustment range per billing period (consumer protection)

### Topic 2: Multi-Model Ensemble Disagreement Handling

**Discussion prompt:** "Your GLM says the applicant is low-risk, the GBM says high-risk, and the telematics score is neutral. The ensemble produces a medium-risk score. How do you handle this disagreement?"

**Key points for discussion:**
- Model disagreement is a signal, not just noise—it indicates the applicant falls in a region where different modeling approaches have different beliefs
- The divergence metric (max_score - min_score across ensemble members) should be logged and monitored
- High disagreement cases may warrant manual underwriting review (human-in-the-loop) rather than automated binding
- For regulatory purposes, the filed algorithm specifies the ensemble weights—the composite score is deterministic given the inputs; disagreement is a monitoring signal, not a decision override

### Topic 3: Fraud Detection Adversarial Arms Race

**Discussion prompt:** "Fraud rings learn from their failures. How do you prevent your fraud detection from becoming a training signal for the adversary?"

**Key points for discussion:**
- Feedback channel: if claims are denied specifically citing graph-based signals, the ring learns which network structures trigger detection
- Mitigation: fraud denial reasons are generic ("investigation required") rather than specific ("your body shop appeared in 12 suspicious claims")
- Model opacity: the GNN model is inherently harder to reverse-engineer than explicit rules, but the entity network structure is partially observable by the ring
- Detection diversity: combine graph signals, behavioral signals, temporal signals, and geographic signals so that no single evasion strategy defeats all detection layers
- Concept drift monitoring: if previously high-precision fraud signals suddenly produce fewer true positives, it may indicate adversarial adaptation

---

## Expanded Trap Questions with Strong Answers

### Trap: "Can you use the telematics score as a proxy for the customer's financial responsibility?"

**Expected answer:** No. Using behavioral driving data as a proxy for financial responsibility conflates two distinct risk dimensions and raises disparate impact concerns. Driving behavior correlates with loss probability (crash risk), not with credit risk. Additionally, using telematics as a credit proxy could violate state prohibitions on credit-related rating factors. Each rating variable must have an independent actuarial justification tied to its specific loss correlation—not used as a proxy for a prohibited variable.

### Trap: "Why not just store the model weights in the risk score record for perfect reproducibility?"

**Expected answer:** Model weights for gradient boosting or neural network models can be tens to hundreds of megabytes. Storing these per decision would consume terabytes per year and is unnecessary. The model artifact is stored once in the model registry, keyed by version hash. The risk score record stores the model version string (a few bytes), which references the immutable artifact in the registry. Reproducibility requires that the artifact is never deleted or modified—not that it is duplicated per decision.

### Trap: "If the FNOL conversation AI is unsure about the loss type, should it ask the customer to clarify?"

**Expected answer:** Yes, but only once per ambiguous field, and with clear options rather than open-ended re-prompting. The trap is that repeated clarification requests frustrate distressed customers. After one clarification attempt, if the field is still ambiguous, the AI should either (a) classify with the best-available interpretation and allow the adjuster to correct, or (b) escalate to a live adjuster. The third option—endlessly re-asking—is the wrong answer because it optimizes for data quality at the expense of customer experience during a stressful moment.

---

## Red Flags Table

| Red Flag | Indicates Misunderstanding Of |
|---|---|
| "Just train one big model on all states" | State-by-state regulatory structure; prohibited factor compliance |
| "Fraud scoring can be async—just score after acknowledgment" | Timing dependency between fraud score and payment routing |
| "Store raw GPS server-side for better modeling" | Privacy architecture; breach liability; regulatory risk |
| "We can deploy the new model as soon as it passes A/B testing" | Rate filing requirement; regulatory approval gating |
| "Use the credit score everywhere—it's the best predictor" | State-specific prohibitions on credit use; disparate impact |
| "SHAP attribution can run synchronously on the quote path" | Latency budget; SHAP computation time (120ms) vs. quote SLO (200ms) |
| "One fraud model handles both individual and ring fraud" | Fundamental difference between per-claim anomaly and network fraud |
| "Telematics data is just another feature—treat it like any other input" | Privacy sensitivity, on-device aggregation, consent management |
| "Loss ratio monitoring is a finance concern, not an engineering concern" | Actuarial observability as a first-class system requirement |

---

## Scoring Rubric (Expanded)

### Phase 1: Requirements (5-7 min) — 10 points

| Points | Criteria |
|---|---|
| 2 | Asks about lines of business and scope |
| 2 | Asks about real-time requirements and latency expectations |
| 3 | Asks about regulatory environment (FCRA, state rate filing, prohibited factors) |
| 3 | Asks about telematics scope and privacy constraints |

### Phase 2: Estimation (5-7 min) — 10 points

| Points | Criteria |
|---|---|
| 3 | Reasonable quote QPS and concurrent quote calculation |
| 3 | Telematics event volume estimation (events/sec from enrolled drivers) |
| 2 | Bureau cost estimation and caching benefit quantification |
| 2 | Fraud graph sizing (nodes, edges, memory) |

### Phase 3: High-Level Architecture (8-10 min) — 25 points

| Points | Criteria |
|---|---|
| 5 | Complete quote-to-bind pipeline with bureau enrichment |
| 5 | Claims intake with fraud scoring on the FNOL path |
| 5 | Telematics pipeline from SDK to behavioral score |
| 5 | State-parameterized scoring with prohibited factor enforcement |
| 5 | Policy lifecycle management (event-sourced or equivalent) |

### Phase 4: Deep Dive (12-15 min) — 35 points

| Points | Criteria |
|---|---|
| 10 | Depth on chosen deep dive topic (underwriting OR fraud OR telematics OR regulatory) |
| 8 | Correct handling of failure modes and degradation |
| 7 | Data model design with audit traceability |
| 5 | Algorithm correctness (ensemble scoring, GNN, or trip scoring) |
| 5 | Trade-off articulation with clear reasoning |

### Phase 5: Extensions (5-7 min) — 20 points

| Points | Criteria |
|---|---|
| 7 | CAT event handling with automatic mode transition |
| 7 | Model governance (retraining, rate filing, disparate impact) |
| 6 | Behavioral pricing fairness and adverse selection |

### Grading Scale

| Score | Level | Hire Signal |
|---|---|---|
| 80-100 | Exceptional | Strong staff+ hire signal |
| 65-79 | Advanced | Strong senior hire signal |
| 50-64 | Intermediate | Hire; demonstrates solid understanding |
| 35-49 | Basic | Borderline; needs mentorship on regulatory dimension |
| < 35 | Below bar | Does not meet bar for insurance platform design |

---

## Follow-Up Questions for Strong Candidates

1. **"The telematics opt-in rate is dropping from 50% to 30%. What are the actuarial implications, and how should the platform respond?"**
   - Tests understanding of adverse selection dynamics: as opt-in drops, the enrolled population may shift (previously marginal drivers opting out), changing the loss ratio curve for the enrolled cohort
   - Platform response: monitor loss ratio by enrollment cohort; adjust non-telematics base rate; investigate whether the opt-in drop correlates with a specific driver demographic

2. **"A state insurance commissioner asks you to prove that your GNN fraud model does not discriminate against claimants from specific ZIP codes. How do you respond technically?"**
   - Tests ability to bridge ML fairness testing with regulatory context
   - Run fraud score distribution analysis segmented by ZIP code and demographic proxy; compute false positive rates per segment; generate statistical exhibits showing the model's graph features are network-structural, not geographic
   - Acknowledge that geographic concentration of fraud rings is a real phenomenon—the model should detect rings regardless of location, not flag locations

3. **"Your actuarial team says the model needs retraining because weather patterns have shifted loss distributions. But retraining requires a new rate filing in 50 states. What do you do in the interim?"**
   - Tests understanding of the lag between model insight and regulatory action
   - Interim response: adjust manual review thresholds for the affected score deciles; conservative renewal pricing for the affected cohort; prioritize rate filings in the most-affected states first
   - Long-term: maintain separate weather-risk adjustment layers that can be filed independently of the base algorithm

---

## Estimation Walk-Through: Bureau Cost Optimization

**Setup:** "Walk me through how you'd estimate the annual savings from bureau response caching."

```
Given:
  - 50M quotes/year
  - 20% bind rate (10M policies)
  - Bureau cost per quote: MVR $1 + CLUE $2 + Credit $0.25 = $3.25
  - Average customer submits 2.5 quotes before binding (comparison shopping)
  - 60% of re-quotes are within 30 days of first quote

Without caching:
  50M × $3.25 = $162.5M/year

With 30-day TTL caching:
  Unique applicants: 50M / 2.5 = 20M unique applicants/year
  First quote (cache miss): 20M × $3.25 = $65M
  Re-quotes within 30 days (cache hit): 30M × $0 = $0
  Re-quotes after 30 days (cache miss): 50M - 20M - 30M = 0 (simplified)
  Total with caching: $65M/year
  Savings: $97.5M/year (60%)

  Reality check:
  - Some applicants return after 30 days: ~5M re-quotes are cache misses
  - Additional cost: 5M × $3.25 = $16.25M
  - Adjusted total: $81.25M/year
  - Adjusted savings: $81.25M/year (50%)
  - Per-policy bureau cost: $81.25M / 10M policies = $8.13/policy
```

## Interviewer Testing Signals

Use these prompts to test specific depth:

| Test | Prompt |
|---|---|
| Regulatory depth | "California prohibits using credit scores for auto insurance rating. How does your system guarantee a California applicant's credit score never influenced their premium?" |
| Fraud detection sophistication | "A claimant has no fraud history and their individual claim looks legitimate. Why might you still flag it for SIU review?" |
| Telematics privacy | "Your telematics system records a customer's 3am drive to a hospital. Should you use this information for any insurance purpose?" |
| Bureau enrichment failure | "Your MVR provider's API is down. What happens to your quote funnel?" |
| Model deployment | "Your new underwriting model is trained and validated. Can you deploy it to production today?" |
| CAT event scaling | "A wildfire is sweeping through a major metro area. Your FNOL rate just spiked 50× in 15 minutes. What does your system do without human intervention?" |
| Adverse action | "A customer was denied a policy. They call asking why. What information is your system required to provide, and within what timeframe?" |
