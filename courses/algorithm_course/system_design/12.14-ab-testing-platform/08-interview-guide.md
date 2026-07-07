# 08 — Interview Guide: A/B Testing Platform

## Overview

Designing an A/B testing platform is a favorite senior/staff interview topic because it combines:
- **Systems thinking:** distributed assignment, event pipelines, analytical data stores
- **Statistical literacy:** candidates who understand the difference between t-tests and sequential testing signal deep expertise
- **Product sense:** understanding why experimentation infrastructure matters to a product-led company
- **Trade-off reasoning:** assignment latency vs. freshness, statistical rigor vs. speed, isolation vs. throughput

A well-scoped 45-minute session should reach the statistical engine discussion — that's where the highest signal differentiation happens.

---

## 45-Minute Pacing Guide

### Phase 1: Requirements & Scoping (0–8 minutes)

Open by asking clarifying questions to define the scope. Interviewers expect candidates to surface ambiguities before diving in. Key questions:

- "What types of products will be experimented on? Web, mobile, backend APIs, or all?"
- "What is the expected scale — how many concurrent experiments, what DAU?"
- "Is this a greenfield platform or integrating with existing feature flag infrastructure?"
- "What statistical guarantees does the business need — fixed horizon, sequential, Bayesian?"
- "Do we need real-time dashboard updates or is a 15-minute lag acceptable?"

After clarifying, state your assumptions explicitly: "I'll assume 500M DAU, 10,000 concurrent experiments, real-time assignment on the critical path, and 15-minute metric refresh."

---

### Phase 2: High-Level Architecture (8–20 minutes)

Draw the system with these components:

1. **SDK / Edge Assignment Layer** — local evaluation, no round-trip
2. **Experiment Config Service** — experiment definitions, ruleset compiler
3. **Event Ingest Pipeline** — gateway, queue, processor, dedup
4. **Analytics Layer** — stream aggregator, batch aggregator, statistical engine
5. **Results Store + Dashboard**

Walk through two primary data flows:
- **Assignment flow:** User request → SDK local eval → variant config returned (sub-ms)
- **Event flow:** User action → SDK batch → event gateway → queue → dedup → aggregation → statistical analysis → dashboard

Key design decisions to state proactively:
- "Assignment is stateless and edge-computed to avoid latency on the critical path"
- "The event log is append-only, raw events are the source of truth — we can recompute any metric"
- "We use mutual exclusion layers to isolate concurrent experiments"

---

### Phase 3: Deep Dives (20–38 minutes)

Interviewers will probe 2–3 of these areas. Expect follow-up questions after each:

#### Deep Dive A: Deterministic Assignment

*Interviewer prompt: "How do you ensure the same user always sees the same variant?"*

Lead with: "We use a deterministic hash function. The bucket assignment for a user is `hash(entity_id + experiment_id + salt) mod 10,000`. Same inputs → same output, always. No database lookup, no session state."

Follow-up traps:
- "What if we want to run two experiments simultaneously — won't users in both be correlated?" → Answer: The experiment-specific salt and ID in the hash input ensure independence. Two experiments produce uncorrelated bucket assignments for the same user.
- "What if we increase traffic fraction mid-experiment?" → Answer: Dangerous — newly bucketed users contaminate the treatment cohort with users who've experienced the control. Warn and discourage; offer incremental ramp-up as a safer alternative.

#### Deep Dive B: Statistical Engine

*Interviewer prompt: "How do you handle analysts who want to peek at results before the experiment is done?"*

Lead with: "Classical t-tests are not valid for repeated testing — peeking inflates the false positive rate. We solve this with sequential testing using always-valid confidence sequences (mSPRT). These produce p-values that are mathematically valid at any sample size, removing the incentive to cheat."

Follow-up traps:
- "What about CUPED — what is it and why does it matter?" → Answer: CUPED reduces metric variance by using a pre-experiment covariate (e.g., a user's historical purchase rate) to partial out individual-level variation. Lower variance means smaller confidence intervals, which means faster time to significance (30–50% sample size reduction).
- "What is sample ratio mismatch and why is it catastrophic?" → Answer: SRM means the observed traffic split doesn't match the intended split. This breaks the independence between assignment and outcome — you can't make causal claims from a broken randomization. We detect it with a chi-squared test on actual vs. expected counts, run continuously.

#### Deep Dive C: Experiment Isolation

*Interviewer prompt: "How do you prevent two concurrent experiments from interfering with each other?"*

Lead with: "We use layered namespaces. Within a layer, each user appears in at most one experiment — the namespace hash ensures this. Experiments in different layers can coincide on the same user, which is fine for independent features but dangerous for correlated ones."

Follow-up traps:
- "What if you detect an interaction statistically after the experiments run?" → Answer: Run a 2×2 factorial analysis across the four user groups (A_ctrl ∩ B_ctrl, A_treat ∩ B_ctrl, A_ctrl ∩ B_treat, A_treat ∩ B_treat). The interaction term reveals whether the joint effect is larger or smaller than additive.

#### Deep Dive D: Event Pipeline at Scale

*Interviewer prompt: "How do you handle 500K events per second without losing any?"*

Lead with: "Three key properties: durability at every hop, idempotent deduplication, and backpressure-aware scaling. Events are ACK'd only after durable queue write. SDKs batch events and retry on failure. The dedup window (Bloom filter + exact hash map, 7-day TTL) handles SDK retry duplicates."

---

### Phase 4: Extensions and Trade-offs (38–45 minutes)

Reserve the final 7 minutes for extensions the interviewer raises. Common ones:

**Multi-armed bandits:**
"Instead of fixed allocation, Thompson Sampling adaptively allocates more traffic to the winning variant. We sample from each variant's posterior Beta distribution, compute which arm is best N times, and set traffic weights proportional to win probability. But bandits sacrifice statistical validity — we can't make unbiased causal estimates from adaptive allocation without correcting for the bias."

**Pricing experiment compliance:**
"Pricing experiments require special handling: we check that assignment is not correlated with protected attributes, we register the experiment in a compliance disclosure registry, and we apply 7-year retention to pricing experiment records."

**Warehouse-native architecture:**
"For enterprise customers whose data already lives in an analytical warehouse, we push experiment assignments to the warehouse and generate SQL for metric computation rather than exporting data. This eliminates data movement and uses the customer's existing compute."

---

## Trap Questions

| Trap Question | What the Interviewer Is Testing | Strong Answer |
|---|---|---|
| "Can't you just use random() to assign variants?" | Statistical literacy | No — random() is not deterministic. Same user gets different variants on repeat visits, making causal inference impossible. |
| "Why not store assignments in a database?" | Scalability thinking | At 500K assignments/sec, no relational DB sustains that write load. Hash-based assignment is O(1) and needs no storage. |
| "Why do you need a separate event log? Can't you query the analytics DB?" | Data architecture | The analytics DB stores pre-aggregated metrics. New metrics defined post-experiment start cannot be computed retroactively from aggregates. Raw event log enables any future metric computation. |
| "Is a p-value < 0.05 sufficient to ship?" | Statistical rigor | No — 0.05 is arbitrary. The platform enforces a pre-registered significance threshold and requires the experiment to have run long enough to detect the pre-registered MDE at the desired power. |
| "What's the difference between Bayesian and frequentist results?" | Statistical depth | Frequentist: "if the null were true, this data would occur < 5% of the time." Bayesian: "there is X% probability that treatment is better than control." Different interpretations; both have a place in the platform. |
| "How do you handle network effects?" | Domain expertise | If user A's behavior influences user B (social network, marketplace), standard A/B testing is invalid — treatments contaminate the control group. Solutions: graph cluster randomization (assign whole network clusters), geo-based randomization, or switchback experiments (time-based alternation). |

---

## Common Mistakes

1. **Conflating assignment with analysis:** Candidates describe a system where assignment is coupled to the analytics store (e.g., "look up the user's variant in the database"). This adds latency and a single point of failure.

2. **Forgetting SRM:** A complete system design must include data quality validation. Omitting SRM detection is a notable gap because it's the most common failure mode that invalidates real experiments.

3. **No mention of sequential testing:** Proposing a fixed-horizon design without addressing the peeking problem suggests unfamiliarity with operational realities of experimentation.

4. **Ignoring the pipeline in favor of the stats:** Candidates strong in statistics but weak in systems sometimes spend 30 minutes on CUPED and never design the event pipeline. The pipeline is where the scalability challenge lives.

5. **Proposing a centralized assignment service without the edge model:** Designing a service that all product requests query synchronously fails at the stated latency SLO and creates a hard single point of failure.

6. **Over-specifying database choice:** Naming specific commercial products rather than reasoning about data model requirements (append-only log → immutable object storage, key-value lookup → distributed cache, columnar aggregates → analytical columnar store) suggests memorization over understanding.

---

## Scoring Rubric

| Area | Meets Bar | Exceeds Bar |
|---|---|---|
| **Assignment design** | Proposes hash-based deterministic assignment | Discusses salt per experiment, independence of concurrent experiments, traffic fraction ramp-up risks |
| **Event pipeline** | Designs gateway + queue + processor | Discusses dedup strategy, exactly-once semantics, backpressure, late arrivals |
| **Statistical engine** | Knows t-test and confidence intervals | Discusses sequential testing, CUPED, SRM detection, Bayesian alternatives |
| **Isolation** | Mentions mutual exclusion | Designs layer system, discusses interaction detection, holdback groups |
| **Scalability** | Horizontal scaling of ingest | Edge-computed assignment, delta sync for rulesets, warehouse-native analysis |
| **Reliability** | Discusses fallback to control | Circuit breaker pattern, event durability guarantees, stale cache behavior |
| **Trade-offs** | States trade-offs when asked | Proactively surfaces trade-offs before being asked; quantifies them |

---

## Interviewer Testing Signals

Questions interviewers use to separate senior from staff-level candidates:

- **"Walk me through what happens when an experiment starts and the first 1000 users arrive."** — Tests operational thinking and the interaction between ruleset propagation and assignment logging.
- **"Your experiment has been running for 3 days and SRM is detected. What do you do?"** — Tests incident response thinking and understanding of what SRM means for causal validity.
- **"The analysis shows p=0.04 after 2 days. The pre-registered run time is 14 days. Do you ship?"** — Tests resistance to peeking and understanding of sequential testing.
- **"How would you design this to support geo-based holdouts?"** — Tests extensibility thinking; geo holdouts require a different randomization unit (geography, not user).
- **"What's the difference between a guardrail metric and a primary metric in your design?"** — Tests metric taxonomy understanding; guardrails are automated kill-switches, not decision criteria.

---

## Advanced Discussion Topics

### Topic 1: Network Effects and SUTVA Violations

In social platforms and marketplaces, users interact with each other. When treatment user A's behavior changes and affects control user B's experience, the Stable Unit Treatment Value Assumption (SUTVA) is violated and standard A/B test estimates are biased. Discuss: cluster randomization (randomizing at the community level), switchback experiments (alternating treatment and control in time), and how to quantify spillover effects.

### Topic 2: Long-Term Holdback Design

A 2% global holdback group runs for 12+ months, never receiving any experiment treatments. This measures the cumulative impact of all shipped experiments. Discuss the trade-offs: holdback users may churn if the product improves around them (survivorship bias in the holdback), and the opportunity cost of permanently excluding 2% of users from potentially beneficial changes.

### Topic 3: Experiment Velocity as an Organizational Metric

The number of experiments run per team per quarter is a proxy for organizational agility. Discuss how platform design choices (self-service UI, automated guardrails, fast time-to-significance via CUPED, sequential testing) influence experiment velocity, and how velocity trades off with rigor.

### Topic 4: Feature Interactions Across Layers

Two experiments in different layers both improve checkout conversion rate when tested independently. When both ship together, the combined effect is subadditive (less than the sum). Discuss how to detect, prevent, and reason about feature interactions in a layered experimentation system.

### Topic 5: Experimentation in ML Ranking Systems

Testing a new ranking model in an A/B test creates a feedback loop: the new model shows different items, users click on different items, and these clicks retrain the model. The treatment group's behavior diverges from the control group's for reasons beyond the model change. Discuss interleaving (showing mixed results from both models on the same page) as an alternative to standard A/B testing for ranking systems.

### Topic 6: Experimentation Platform as a Deployment Safety Net

Discuss how a mature experimentation platform transforms deployment practices: every feature ships through a controlled experiment with automated guardrails, making "shipping to production" indistinguishable from "starting an experiment." This means the platform must be as reliable as the deployment pipeline itself — any experimentation platform outage is effectively a deployment freeze.

---

## Comparison with Related Systems

| Dimension | A/B Testing Platform | Feature Flag Service | Analytics Platform | ML Model Serving |
|---|---|---|---|---|
| **Primary function** | Measure causal effects of changes | Control feature availability | Describe user behavior | Serve model predictions |
| **Assignment model** | Deterministic hash → sticky variant | Rule-based targeting → flag state | N/A | Model version routing |
| **Statistical rigor** | Core requirement | Not applicable | Descriptive only | Offline evaluation |
| **Latency constraint** | Sub-ms (assignment on critical path) | Sub-ms (same as assignment) | Minutes to hours | Sub-100ms (inference) |
| **Data model** | Events → metrics → statistical tests | Config → flag values | Events → aggregates → reports | Features → predictions |
| **Failure mode** | Fall back to control | Fall back to default flag value | Show stale data | Serve stale model |
| **Regulatory surface** | Pricing experiments, differential privacy | Minimal | GDPR (user data) | Model fairness |

---

## Key Numbers to Remember

| Metric | Value | Why It Matters |
|---|---|---|
| Assignment latency (SDK local) | < 0.1ms p50 | Must not add to product page render time |
| Assignment latency (server fallback) | < 5ms p99 | Network round-trip budget |
| Event pipeline durability | 99.999% | Lost events = incorrect metric values |
| Streaming metric lag | < 5 minutes | Analysts expect near-real-time dashboards |
| Batch metric lag | < 90 minutes | CUPED-adjusted results for decision-making |
| SRM detection time | < 30 minutes | Broken randomization must be caught fast |
| CUPED variance reduction | 30-50% typical | Cuts time-to-significance by ~40% |
| Sequential vs. fixed-horizon | ~30% fewer false early stops | Always-valid p-values prevent peeking errors |
| Ruleset size (compressed) | ~800 KB | Must fit in SDK memory |
| Ruleset propagation | < 60 seconds | Config changes reach SDKs quickly |
| Concurrent experiments supported | 10,000+ | Defines platform scalability |

---

## Good vs. Great Answer Differentiation

| Dimension | Good Answer | Great Answer |
|---|---|---|
| **Assignment** | "Hash the user ID to a bucket" | "SHA-256 hash of entity_id + experiment_id + salt to independent buckets; salt ensures cross-experiment independence; edge-computed via compiled ruleset cached in SDK" |
| **Statistics** | "Run a t-test on the metrics" | "Sequential testing with mSPRT for always-valid p-values; CUPED for 30-50% variance reduction; FDR correction for secondary metrics; separate streaming (preliminary) and batch (authoritative) paths" |
| **Isolation** | "Don't run experiments that conflict" | "Layered namespace with per-layer hash; users in at most one experiment per layer; interaction detection via 2×2 factorial analysis; global holdback for cumulative effect measurement" |
| **Pipeline** | "Log events and query them" | "Append-only event log as source of truth; dedup via Bloom filter + hash map; entity_id partitioning for local aggregation; watermark-based window completion for late arrivals" |
| **Reliability** | "Handle failures gracefully" | "Control fallback on assignment failure; SDK buffer + retry for event pipeline; stale-but-valid results during analysis outage; staged ruleset rollout with SRM canary check" |
| **Guardrails** | "Monitor for problems" | "Pre-defined guardrail metrics with automated kill-switch; 15-minute detection SLA; experiment auto-stops on revenue degradation > 0.3% at p < 0.01; transforms experimentation from a risk into a safety net" |

---

## Architecture Whiteboard Checkpoints

During a 45-minute interview, the candidate should hit these milestones:

| Checkpoint | By Minute | What Should Be on the Whiteboard |
|---|---|---|
| SDK-local assignment model | 8 | Hash-based deterministic assignment with local ruleset cache |
| Event ingest pipeline | 12 | Gateway → queue → processor → event log flow with dedup |
| Dual-path metrics | 16 | Streaming (fast, approximate) + batch (accurate, CUPED) paths |
| Statistical engine | 20 | Sequential testing, confidence intervals, p-values |
| Experiment isolation | 24 | Layered mutual exclusion with per-layer hash namespaces |
| SRM detection | 28 | Chi-squared test on actual vs. expected traffic splits |
| Guardrail system | 32 | Automated kill-switch on pre-defined degradation thresholds |
| Appeals / investigation | 36 | What happens when SRM is detected or results are disputed |
| Scaling strategy | 40 | Edge assignment, event partitioning, analysis parallelism |
| Failure modes | 43 | Control fallback, stale cache, event buffering, graceful degradation |

---

## Anti-Patterns in Production Experimentation Platforms

These are real failure modes seen in production experimentation systems at scale. Discussing them demonstrates operational maturity:

| Anti-Pattern | What Happens | Root Cause | Resolution |
|---|---|---|---|
| **"Ship and forget" experiments** | Experiments run for months without decision; traffic is permanently split | No expiration policy | Auto-pause at scheduled_stop_at; 60-day maximum duration policy with mandatory extension review |
| **Guardrail-free launches** | Revenue-critical experiment ships with no guardrail metrics; drops revenue 2% before anyone notices | Configuration allows guardrail-free experiments | Platform mandates ≥ 1 guardrail metric for experiments touching revenue or engagement surfaces |
| **Covariate-free CUPED** | CUPED applied with poorly correlated pre-experiment covariate; variance reduction is near zero; experiment runs 2× longer than needed | Teams use default covariate without checking correlation | Platform computes covariate correlation during experiment setup and warns if ρ < 0.3 |
| **Layer sprawl** | 200+ mutual exclusion layers; most contain only 1-2 experiments; bucket allocation fragmented | Teams create layers defensively to avoid interaction risk | Periodic layer consolidation; automated recommendation when layers are < 10% utilized |
| **Peeking despite sequential testing** | Analysts manually compute t-test results from exported data, overriding sequential results | Sequential testing output is less familiar | Dashboard shows ONLY sequential/always-valid results; raw data export is audit-logged |
| **Bot contamination** | Bot traffic inflates event counts; dilutes treatment effect; experiments appear to have no signal | No bot filtering in pipeline | Multi-signal bot detection (session velocity, user-agent, behavioral fingerprint) with configurable exclusion |
| **Assignment-event time skew** | Events arrive before assignment is logged; metric computation attributes events to wrong variant | Clock skew between SDK and event pipeline | Use assignment timestamp embedded in event context, not server-received timestamp |

---

## Seniority Calibration Guide

How deep a candidate goes into each area distinguishes seniority levels:

### Mid-Level (L4/IC3)

Expected to cover:
- Hash-based deterministic assignment (without prompting)
- Event pipeline with queue-based durability
- Basic metric computation (mean comparison)
- At least one mention of statistical testing

Not expected to cover:
- CUPED variance reduction
- Sequential testing details
- Network effects or cluster randomization
- Multi-armed bandits

### Senior (L5/IC4)

Expected to cover everything above, plus:
- Sequential testing and the peeking problem
- CUPED or equivalent variance reduction technique
- SRM detection and its implications
- Layered mutual exclusion
- Guardrail metrics with automated response
- Event deduplication strategy

Should be able to articulate trade-offs:
- "Why not Bayesian?" → Different guarantees, computational cost, harder to explain to stakeholders
- "Why edge assignment vs. centralized?" → Latency, availability, single-point-of-failure analysis

### Staff (L6/IC5)

Expected to cover everything above, plus:
- Network effects and when standard A/B fails
- Multi-armed bandits and regret analysis
- Experiment velocity as a platform metric
- Interaction detection between concurrent experiments
- Compliance considerations for pricing experiments
- Architecture evolution path (how this system grows from startup to scale)

Should be able to reason about organizational dynamics:
- "How do you build trust in the platform so teams actually use it?"
- "How do you prevent p-hacking at an organizational level?"
- "How do you handle the political dynamics when an experiment kills a VP's pet feature?"
