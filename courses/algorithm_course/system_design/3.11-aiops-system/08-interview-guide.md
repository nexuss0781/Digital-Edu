# Interview Guide

This document provides a comprehensive guide for navigating an AIOps system design interview, including pacing strategy, key discussion points, trap questions, and trade-off frameworks.

---

## Interview Pacing (45-minute format)

| Time | Phase | Focus | Key Actions |
|------|-------|-------|-------------|
| 0-5 min | **Clarify** | Understand scope and constraints | Ask clarifying questions, establish scale |
| 5-15 min | **High-Level** | Core architecture | Draw 3-phase architecture, identify components |
| 15-30 min | **Deep Dive** | 1-2 critical components | Anomaly detection OR RCA in depth |
| 30-40 min | **Scale & Trade-offs** | Production concerns | Bottlenecks, failure scenarios, trade-offs |
| 40-45 min | **Wrap Up** | Summary and questions | Recap key decisions, answer follow-ups |

---

## Phase 1: Clarifying Questions (0-5 min)

### Essential Questions to Ask

```
1. SCALE
   "What's the expected metric volume? Are we talking 100K or 10M metrics/second?"
   "How many services/hosts need to be monitored?"

2. REQUIREMENTS
   "What's the detection latency requirement? Real-time (<5s) or near-real-time (<1min)?"
   "Is automated remediation in scope, or just alerting?"

3. EXISTING INFRASTRUCTURE
   "What monitoring tools are already in place that we need to integrate with?"
   "Is there an existing service topology/dependency graph?"

4. PRIORITIES
   "What's more important: minimizing false positives or minimizing false negatives?"
   "What's the current MTTR, and what's the target?"

5. AUTOMATION APPETITE
   "Is there appetite for fully automated remediation, or human-in-the-loop?"
```

### Sample Clarification Dialogue

```
Interviewer: "Design an AIOps system."

You: "Before I start, I'd like to understand the scope better.

First, what's the expected scale? Are we looking at enterprise-scale
with millions of metrics per second, or a smaller deployment?

[Answer: Let's say 1M metrics/second, 50K hosts]

Got it. And what's the primary goal - is it reducing alert fatigue,
improving MTTR, or enabling automated remediation?

[Answer: Primarily reducing MTTR, but also reducing alert noise]

Makes sense. What's the current MTTR, and what's the target?

[Answer: Currently 4 hours, want to get to 30 minutes]

And regarding automation - are operators comfortable with the system
taking automated actions, or should everything be human-approved?

[Answer: Start with human approval, but want to automate eventually]

Perfect. Let me design a system that handles 1M metrics/second,
focuses on fast detection and RCA to reduce MTTR, with a
human-in-the-loop automation model that can evolve to full automation."
```

---

## Phase 2: High-Level Design (5-15 min)

### Architecture Sketch

```
Draw this on the whiteboard:

┌─────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                             │
│    [Metrics]  [Logs]  [Traces]  [Events]  [Existing Alerts]     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OBSERVE (Ingestion)                          │
│  • Telemetry Collector (OTLP, Prometheus, webhooks)             │
│  • Normalizer (common schema)                                    │
│  • Kafka buffer                                                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ANALYZE (Intelligence)                       │
│  • Anomaly Detection (3-tier: Basic → Agile → Robust)           │
│  • Alert Correlation (Dynamic-X-Y: time + topology)             │
│  • Root Cause Analysis (Causal inference, not correlation)      │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ACT (Automation)                          │
│  • Runbook matching & execution                                  │
│  • Approval workflows                                            │
│  • Notification & escalation                                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     KNOWLEDGE (State)                            │
│  • Service topology graph                                        │
│  • ML model registry                                             │
│  • Feedback loop (continuous learning)                           │
└─────────────────────────────────────────────────────────────────┘
```

### Key Points to Emphasize

1. **Three-Phase Model:** Observe → Analyze → Act (closed loop)
2. **Alert Funnel:** 10K alerts → 300 incidents (97% suppression)
3. **Causal, Not Correlation:** RCA uses causal inference to avoid the "correlation ≠ causation" trap
4. **Human-in-the-Loop:** Start with approval, graduate to automation

---

## Phase 3: Deep Dive (15-30 min)

Choose ONE of these deep dives based on interviewer interest:

### Option A: Anomaly Detection Deep Dive

```
"Let me go deep on anomaly detection. The key insight is that
different metrics need different detection strategies."

THREE-TIER APPROACH:

Tier 1: Basic (< 100ms)
├── Moving average with dynamic bounds
├── Static thresholds
├── Good for: CPU, memory, basic infrastructure
└── Accuracy: ~70%, but very fast

Tier 2: Agile (< 1s)
├── Seasonal decomposition (Prophet, ARIMA)
├── Adaptive baselines
├── Good for: Business metrics with daily/weekly patterns
└── Accuracy: ~85%

Tier 3: Robust (< 5s)
├── Isolation Forest (multivariate)
├── LSTM for sequential patterns
├── Ensemble voting
├── Good for: Critical systems, complex patterns
└── Accuracy: ~95%

ROUTING LOGIC:
- High-volume infrastructure → Tier 1
- Business KPIs → Tier 2
- Critical systems → Tier 3
- If Tier 1 flags anomaly → confirm with higher tier

FAILURE HANDLING:
- If ML fails → fall back to statistical
- If no model trained → use Tier 1 only
- Monitor false positive rate → retrain if > 10%
```

### Option B: Root Cause Analysis Deep Dive

```
"Let me explain why RCA is the hardest part of AIOps.

THE FUNDAMENTAL PROBLEM:
When Service A and Service B both have errors:
- Does A cause B?
- Does B cause A?
- Does C cause both?

Correlation-based RCA fails because it can't tell these apart.

CAUSAL INFERENCE APPROACH:

1. Build Causal Graph
   - Start with service topology (known dependencies)
   - Add Granger causality tests (does X's past predict Y?)
   - Result: Directed Acyclic Graph (DAG)

2. Bayesian Ranking
   Prior: P(node = root cause) based on topology position
   - Upstream services more likely to be root cause
   - P(node) ∝ 1 / (downstream_count + 1)

   Likelihood: P(evidence | node = root cause)
   - Timing: How early did this node show anomaly?
   - Magnitude: How severe was the change?

   Posterior: P(root cause | evidence) ∝ Prior × Likelihood

3. Example Walkthrough
   Incident: API 5xx errors

   Timeline analysis:
   T-300s: DB connection pool at 95%
   T-120s: DB latency spikes
   T-60s:  API timeouts
   T-30s:  Gateway 5xx

   Result: DB is root cause (72% probability)
   - Earliest anomaly
   - Upstream of all affected services
   - Clear causal chain: DB → API → Gateway
```

---

## Phase 4: Scale & Trade-offs (30-40 min)

### Scaling Discussion

```
"Let me talk about how this scales to 1M metrics/second."

Slowest part of the process ANALYSIS:

1. Ingestion (solved by partitioning)
   - Partition by tenant_id + metric_hash
   - 10 Kafka partitions = 100K metrics/partition
   - Each partition has dedicated consumer

2. Detection (solved by tiering + batching)
   - 95% go to Tier 1 (statistical, CPU-only)
   - 5% go to Tier 3 (ML, GPU)
   - Batch inference: 512 metrics/batch
   - Result: 10 GPUs handle 1M metrics/sec

3. Storage (solved by sharding + tiering)
   - Shard by tenant + time
   - Hot: 7 days on SSD
   - Warm: 30 days on HDD
   - Cold: 1 year on object storage

4. Knowledge Graph (solved by caching)
   - Materialize "3-hop upstream" for each service
   - Cache TTL: 5 minutes
   - Refresh on topology change
```

### Trade-off Discussions

#### Trade-off 1: Statistical vs ML Detection

| Aspect | Statistical | ML-Based |
|--------|-------------|----------|
| **Latency** | <100ms | 1-5s |
| **Accuracy** | 70-80% | 90-95% |
| **Explainability** | High | Medium |
| **Cold Start** | Immediate | Requires training |
| **Maintenance** | Low | High |

**My Recommendation:** Three-tier hybrid. Use statistical for speed, ML for accuracy on critical metrics.

#### Trade-off 2: Correlation vs Causal RCA

| Aspect | Correlation | Causal |
|--------|-------------|--------|
| **Speed** | Fast | Slower |
| **Known Issues** | Works well | Works well |
| **Novel Issues** | Fails | Works |
| **Explainability** | "A and B correlated" | "A caused B because..." |

**My Recommendation:** Causal inference. The whole point of RCA is to find the *cause*, not just correlated symptoms.

#### Trade-off 3: Full Automation vs Human-in-Loop

| Aspect | Full Auto | Human-in-Loop |
|--------|-----------|---------------|
| **Speed** | Immediate | Minutes delay |
| **Risk** | Higher (wrong action) | Lower |
| **Scalability** | Perfect | Limited by human bandwidth |
| **Trust** | Must be earned | Maintained |

**My Recommendation:** Start with human-in-loop, graduate to automation as trust builds. Auto-approve low-risk actions first.

---

## Trap Questions and How to Handle

### Trap 1: "Why not just use more thresholds?"

```
Bad Answer: "Thresholds are outdated."

Good Answer: "Thresholds work great for well-understood metrics with
stable patterns. However, they have limitations at scale:

1. Manual effort: With 100K+ metrics, setting individual thresholds
   doesn't scale

2. Dynamic behavior: Business metrics change with seasons, campaigns,
   and growth - static thresholds become stale

3. Novel patterns: Thresholds can't detect anomalies they weren't
   designed for

We use thresholds as a safety net (Tier 1), but augment with ML for
adaptive detection. Best of both worlds."
```

### Trap 2: "How do you know your RCA is correct?"

```
Bad Answer: "The algorithm is accurate."

Good Answer: "Great question - RCA correctness is hard to validate.
We use several approaches:

1. Operator feedback: After each incident, we ask 'Was this the right
   root cause?' This creates labeled data.

2. A/B testing: Compare causal RCA against correlation-based to
   measure improvement in MTTR.

3. Historical replay: Run RCA on past incidents where we know the
   real root cause (from post-mortems).

4. Confidence scores: Report probability, not certainty. If confidence
   is low, escalate for human review.

We expect ~90% accuracy, with continuous improvement from feedback."
```

### Trap 3: "What if your ML model makes a mistake?"

```
Bad Answer: "ML is highly accurate."

Good Answer: "Mistakes are inevitable. We handle them with defense
in depth:

1. Fallback: If ML fails or returns low confidence, fall back to
   statistical detection.

2. Confidence thresholds: Don't act on low-confidence predictions.
   Require human review below threshold.

3. Blast radius limiting: Automated actions are scoped - can't affect
   more than N services.

4. Rollback: All automated actions have automatic rollback if the
   situation worsens.

5. Feedback loop: Mistakes become training data to improve the model.

The goal isn't perfect accuracy - it's graceful handling of mistakes."
```

### Trap 4: "This seems over-engineered. Why not just use PagerDuty?"

```
Bad Answer: "PagerDuty can't do ML."

Good Answer: "PagerDuty is great for alert routing and on-call
management. We'd integrate with it as a notification channel.

But PagerDuty doesn't solve the core AIOps problems:

1. Alert fatigue: PagerDuty forwards alerts, doesn't reduce them.
   We need correlation to compress 10K alerts to 300 incidents.

2. Root cause: PagerDuty tells you 'Service X is down'. We need to
   know 'Database connection pool exhaustion caused Service X to fail.'

3. Automation: PagerDuty pages humans. We want to fix issues
   automatically when safe.

Think of AIOps as the intelligent layer between your monitoring tools
and PagerDuty. AIOps decides WHAT to alert on, PagerDuty decides
WHO to alert."
```

### Trap 5: "How do you handle alert storms?"

```
Bad Answer: "We rate-limit alerts."

Good Answer: "Alert storms are a key challenge. We handle them at
multiple levels:

1. Deduplication: Same alert firing repeatedly? Dedupe by fingerprint.
   Reduces 30% immediately.

2. Time-based correlation: Alerts within 5-minute window are likely
   related. Group them.

3. Topology-based correlation: Alerts from dependent services are
   likely from same root cause. Merge into single incident.

4. Dynamic suppression: If a service is in incident, suppress new
   alerts from that service until resolved.

5. Circuit breaker: If alert volume exceeds threshold (10K/min),
   switch to sampling mode and alert on the meta-issue.

The result: 10K raw alerts become 300 actionable incidents.
97% suppression while keeping false negative rate below 3%."
```

---

## Quick Reference Card

### Key Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| Ingestion | Collect telemetry | OTLP, Kafka |
| Detection | Find anomalies | Isolation Forest, LSTM, Prophet |
| Correlation | Group alerts | Dynamic-X-Y algorithm |
| RCA | Find root cause | Causal graphs, Bayesian |
| Automation | Fix issues | Runbook engine |
| Knowledge | Store state | Graph DB, Model registry |

### Key Numbers

| Metric | Value |
|--------|-------|
| Metrics/second | 1M |
| Detection latency | <5s |
| RCA latency | <30s |
| Alert suppression | 97% |
| False positive rate | <5% |
| Availability | 99.99% |

### Key Trade-offs

| Decision | Choice | Why |
|----------|--------|-----|
| Detection | Three-tier hybrid | Speed vs accuracy balance |
| RCA | Causal inference | Correlation ≠ causation |
| Automation | Human-in-loop first | Earn trust before auto |
| Storage | Sharded + tiered | Scale + cost |

---

## Interview Evaluation Criteria

### What Interviewers Look For

| Criteria | Junior | Senior | Staff+ |
|----------|--------|--------|--------|
| **Clarification** | Asks basic questions | Identifies key constraints | Challenges assumptions |
| **Architecture** | Draws boxes and arrows | Justifies component choices | Considers alternatives |
| **Deep Dive** | Explains what | Explains how | Explains trade-offs |
| **Scale** | Mentions "add more servers" | Calculates capacity | Identifies bottlenecks |
| **Reliability** | Mentions replication | Designs for failures | Considers edge cases |
| **Operations** | - | Mentions monitoring | Designs feedback loops |

### Red Flags to Avoid

```
DON'T:
✗ Jump to solution without clarifying
✗ Focus only on happy path
✗ Say "we'll use ML" without explaining how
✗ Ignore failure scenarios
✗ Design for 1000x scale on day 1
✗ Forget about operators and feedback

DO:
✓ Ask questions before designing
✓ Explicitly discuss trade-offs
✓ Explain algorithms at appropriate depth
✓ Address "what if X fails?"
✓ Design for 10x, mention 100x
✓ Consider the human element
```

---

## Sample Interview Flow

### Full 45-Minute Walkthrough

```
[0:00] Interviewer: "Design an AIOps system."

[0:00-5:00] You clarify scale, requirements, constraints.
- "1M metrics/sec, 50K hosts, MTTR target: 30 min"

[5:00-5:30] You state the problem.
"So we need a system that ingests high-volume telemetry,
detects anomalies in real-time, correlates alerts into
actionable incidents, identifies root causes, and can
trigger automated remediation. Let me walk through the
architecture."

[5:30-15:00] You draw and explain high-level architecture.
- Draw the 5-layer architecture
- Explain Observe → Analyze → Act
- Mention the alert funnel (10K → 300)
- Highlight key design choices

[15:00-15:30] You ask which area to deep dive.
"I can go deep on anomaly detection, RCA, or correlation.
Which interests you most?"

[15:30-30:00] You deep dive on chosen topic.
- Explain the algorithm
- Walk through an example
- Discuss failure modes

[30:00-40:00] You discuss scale and trade-offs.
- Explain how it scales to 1M metrics/sec
- Walk through 2-3 key trade-offs
- Address failure scenarios

[40:00-45:00] You summarize and answer questions.
"To summarize: we've designed a system that can handle
1M metrics/sec with <5s detection latency, uses causal
inference for accurate RCA, and supports progressive
automation. Any questions?"
```

---

## What Makes AIOps Unique

### Meta-Commentary for Interviewers

```
1. TRUST IS THE #1 CHALLENGE
   - Operators won't trust a system that cries wolf
   - Every alert must be explainable
   - Start conservative, earn trust over time

2. CORRELATION ≠ CAUSATION
   - This is the fundamental RCA trap
   - Need causal inference, not just correlation
   - Topology awareness is critical

3. SELF-MONITORING PARADOX
   - "Who monitors the monitor?"
   - AIOps must be MORE reliable than monitored systems
   - Graceful degradation is critical

4. HUMAN-IN-THE-LOOP
   - Automation without oversight is dangerous
   - Approval workflows for destructive actions
   - Continuous learning from feedback

5. THE ALERT FUNNEL
   - Raw alerts → Dedupe → Correlate → Incidents
   - 97% compression is the target
   - False negatives are worse than false positives
```

---

## 2025-2026 Trends to Mention

### LLM-Augmented Incident Response

> "The biggest shift in 2025-2026 is integrating LLMs into the incident response loop — not as a replacement for anomaly detection (too slow, too unreliable) but as an augmentation for root cause analysis and remediation suggestion.
>
> **Key pattern:** 'AIOps-then-LLM' — the statistical pipeline (anomaly detection, alert correlation, topology analysis) produces a structured incident context document, then the LLM reasons over this curated context to generate hypotheses and remediation suggestions. This avoids the failure mode of feeding raw logs to an LLM, which produces confident-sounding but unreliable conclusions.
>
> **Critical constraint:** The LLM is never on the alerting critical path. Paging happens through the traditional pipeline in seconds; LLM analysis arrives 5-10 seconds later as supplementary context in the incident channel."

### Agentic SRE

> "The evolution from automated runbook execution to agentic SRE — AI agents that can reason about infrastructure state, plan multi-step remediation sequences, and execute them with human approval. The key design decision is blast radius limiting: every agent-proposed action must pass through a scope/reversibility/precedent check before execution. High-confidence, low-blast-radius actions (pod restart) execute automatically; high-blast-radius actions (database failover) require human approval."

### Change Intelligence

> "70-80% of production incidents are caused by changes. The most effective RCA improvement in recent systems is not better anomaly detection but better change correlation — maintaining a unified timeline of all deployments, config changes, feature flag toggles, and infrastructure modifications, then correlating anomaly onset with recent changes in the same topology neighborhood. This resolves the majority of incidents in under 60 seconds."

---

## Further Reading

- Datadog Watchdog AI - Three-algorithm framework for early anomaly detection
- Dynamic Alert Suppression (ACM ICSE) - Multi-dimensional alert correlation research
- A Survey of AIOps in the Era of LLMs (ACM Computing Surveys) - Comprehensive 2025 survey
- Salesforce PyRCA - Open-source root cause analysis with causal inference
- Applying Causal Inference to RCA in DevOps - Academic approach to production RCA
