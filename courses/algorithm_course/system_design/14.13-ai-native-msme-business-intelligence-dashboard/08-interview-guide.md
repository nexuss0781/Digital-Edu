# 14.13 AI-Native MSME Business Intelligence Dashboard — Interview Guide

## Interview Format: 45-Minute System Design

### Pacing Guide

| Phase | Time | Focus | What the Interviewer Evaluates |
|---|---|---|---|
| **Phase 1: Requirements** | 0–8 min | Clarify scope, define functional and non-functional requirements | Ability to ask the right questions; prioritization instinct; understanding that MSME ≠ enterprise BI |
| **Phase 2: High-Level Design** | 8–22 min | Architecture, major components, data flow | Component decomposition; NL-to-SQL pipeline awareness; multi-tenant design instinct |
| **Phase 3: Deep Dive** | 22–38 min | 1-2 deep dives chosen by interviewer or candidate | Depth of knowledge; trade-off reasoning; handling of ambiguity |
| **Phase 4: Wrap-Up** | 38–45 min | Scalability, reliability, operational concerns | Production mindset; awareness of failure modes; cost consciousness |

---

## Phase 1: Requirements Gathering

### Key Questions to Ask (as the candidate)

1. **"Who is the primary user?"** — An MSME owner with no technical background, not a data analyst. This fundamentally changes the interface: NL queries, not SQL; auto-insights, not manual exploration; WhatsApp delivery, not email dashboards.

2. **"What data sources do we need to support?"** — Accounting software (Tally is dominant in India), POS systems, e-commerce platforms, bank statements, spreadsheets. The diversity of sources is a key constraint.

3. **"What is the expected scale?"** — 2M registered MSMEs, 800K monthly active, 200K daily active. This is a multi-tenant analytics platform, not a single-tenant data warehouse.

4. **"What languages do merchants query in?"** — English, Hindi, and regional languages. Mixed-language queries ("last month ka revenue") are common.

5. **"What is the latency budget for a natural language query?"** — ≤ 3 seconds. This constrains the NL-to-SQL pipeline design significantly.

### Red Flags in Requirements Phase

- Treating this as a standard enterprise BI system (Tableau, Looker clone)
- Ignoring the NL-to-SQL challenge and jumping to dashboard design
- Not asking about multi-tenancy and data isolation
- Assuming structured, clean data from MSME sources
- Not considering WhatsApp as a primary delivery channel

---

## Phase 2: High-Level Design

### Expected Components

A strong candidate should identify these components:

1. **Data ingestion layer** with pluggable connectors, schema mapping, and quality scoring
2. **Tenant-scoped semantic graph** mapping raw schemas to business concepts
3. **NL-to-SQL pipeline** with multi-stage processing (intent → entities → schema mapping → SQL generation → validation → execution)
4. **Analytical query engine** with columnar storage and materialized views
5. **Auto-insight engine** with anomaly detection, root cause analysis, and ranking
6. **Notification delivery** with WhatsApp digest, email, and push
7. **Benchmark service** with differential privacy for anonymized peer comparisons

### Key Design Decisions to Probe

**"How do you handle the semantic gap between natural language and SQL?"**

Expected: Multi-stage pipeline with semantic graph. The candidate should NOT suggest passing the raw question to an LLM with the full schema—this fails at scale because (a) schemas are too large for context windows, (b) accuracy is poor without entity extraction and schema mapping, and (c) there's no safety validation.

**"How do you ensure one tenant can never see another tenant's data?"**

Expected: Defense-in-depth (application-level filtering + SQL rewriting + database-level RLS). A candidate who says "just add WHERE tenant_id = X" gets a follow-up: "What if the LLM forgets to add the tenant filter?"

**"How do you build the semantic graph for a new tenant with zero documentation?"**

Expected: AI-assisted column mapping using column names, value distributions, and data types; cross-source entity resolution; merchant confirmation step. The cold-start problem is a defining challenge.

---

## Phase 3: Deep Dive Topics

### Deep Dive A: NL-to-SQL Pipeline

**Starter question:** "Walk me through exactly what happens when a merchant types 'Why did my sales drop last Tuesday?'"

**Expected depth:**
- Intent classification: this is an anomaly-explanation query, not a simple metric lookup
- Entity extraction: "sales" → revenue metric, "last Tuesday" → specific date
- Schema mapping: "sales" maps to `orders.total_amount` via semantic graph
- SQL generation: the LLM generates a comparison query (Tuesday vs. expected Tuesday baseline)
- Validation: verify tenant isolation, cost estimation
- Execution + root cause: run the query, then drill down by dimension to find the root cause
- Narration: generate a human-readable explanation

**Trap question:** "What if the merchant asks 'Show me all the data in the system'?"

**Expected answer:** This should NOT generate `SELECT * FROM all_tables`. The system should classify this as an ambiguous/overly broad query and respond with a clarification: "I can show you revenue trends, customer analysis, product performance, or expense breakdown. Which would you like to explore?" The query validator should also reject any query without specific table references as a safety measure.

**Trap question:** "How do you handle 'Compare my revenue with other businesses nearby'?"

**Expected answer:** This crosses from NL-to-SQL (querying the tenant's own data) into the benchmark system (querying aggregated peer data). The system must route this to the benchmark API, not generate SQL against the shared warehouse. A naive LLM might try to query other tenants' data—this is exactly why the SQL validator and RLS are critical.

### Deep Dive B: Auto-Insight Generation

**Starter question:** "How does the system decide which 3 insights to send in the morning WhatsApp digest?"

**Expected depth:**
- Detection: statistical anomaly detection with seasonality decomposition
- Root cause: dimensional drill-down to attribute the anomaly to specific segments
- Ranking: `impact_estimate × confidence × novelty_score` — not just statistical significance
- Personalization: merchant feedback loop (useful/not useful reactions) adjusts future ranking
- Delivery: respect WhatsApp template constraints (1024 chars); format for mobile readability

**Trap question:** "A merchant gets 'Your Saturday revenue was higher than Friday' every week. How do you prevent this?"

**Expected answer:** Seasonality decomposition. The baseline model accounts for day-of-week patterns. Saturday being higher than Friday is expected and should NOT be flagged. Only deviations from the expected Saturday level should generate insights. Additionally, the novelty filter should suppress any insight pattern that has been delivered >3 times with "not useful" feedback.

**Trap question:** "How do you generate insights for a brand-new tenant with only 2 weeks of data?"

**Expected answer:** Cold-start for insights is even harder than for NL-to-SQL. With 2 weeks of data, there's no reliable seasonality model. The system should: (1) use industry cohort baselines as a proxy until the tenant has 90 days of data, (2) focus on simple comparisons (this week vs. last week) rather than trend analysis, (3) heavily weight benchmark-based insights ("your average order value is 20% below similar businesses") over anomaly-based insights.

### Deep Dive C: Multi-Tenant Data Isolation

**Starter question:** "Explain your data isolation strategy as if I'm a security auditor."

**Expected depth:** Four layers of defense (application, validation, database RLS, audit). The candidate should explain why each layer is necessary (defense-in-depth) and what attack it prevents that the others might miss.

**Trap question:** "What if I compromise the application layer and set the session variable to another tenant's ID?"

**Expected answer:** This is why RLS alone is not sufficient—but combined with audit logging and anomaly detection, the system detects the breach. The key is that the session variable is set by the API gateway from the authenticated JWT, not by the application code. Compromising this requires compromising the authentication system, which is a separate and more heavily defended surface.

---

## Phase 4: Scalability & Operations

### Questions

**"How does the system perform with 2M tenants?"**
- Warehouse partitioning by tenant_id (4096 partitions)
- Materialized views for common queries (80% cache hit)
- LLM inference pool with auto-scaling
- Staggered data ingestion to avoid compute storms

**"What happens when the LLM service goes down?"**
- Circuit breaker pattern
- Template-based queries still work (60% of queries)
- Materialized view queries still work
- WhatsApp digests from pre-computed insights still deliver
- Status message: "Advanced analytics temporarily unavailable"

**"How do you control costs at scale?"**
- Template matching avoids LLM calls for 60% of queries
- Semantic caching avoids re-execution for 25% of queries
- Materialized views reduce compute for common patterns
- Tiered storage (hot/warm/cold) based on data age
- Query cost gating prevents expensive ad-hoc queries from consuming shared resources

---

## Scoring Rubric

### Junior (L3-L4): Meets Expectations

- Identifies the core NL-to-SQL challenge
- Designs a basic multi-tenant architecture with tenant_id filtering
- Recognizes the need for data connectors and ingestion
- Designs a simple dashboard with pre-built charts
- Understands WhatsApp as a delivery channel

### Mid-Level (L5): Exceeds Expectations

- Designs a multi-stage NL-to-SQL pipeline (not just "send to LLM")
- Implements defense-in-depth for tenant isolation (not just WHERE clause)
- Considers semantic graph for schema mapping
- Discusses materialized views for common query patterns
- Addresses insight ranking (impact vs. statistical significance)

### Senior (L6): Strong Hire

- Addresses the semantic graph cold-start problem
- Designs the insight ranking algorithm with novelty and feedback loops
- Discusses differential privacy for benchmarks
- Identifies the NL injection attack surface and mitigations
- Considers graceful degradation when LLM service is unavailable
- Discusses cost optimization (template caching, semantic caching, tiered compute)

### Staff (L7): Exceptional

- Frames the NL-to-SQL safety problem as a unique security challenge (not traditional SQL injection)
- Designs the end-to-end feedback loop: NL query → user correction → semantic graph update → template promotion → improved accuracy
- Discusses the insight cold-start problem (new tenants with insufficient data)
- Addresses the benchmark privacy-utility trade-off with formal differential privacy guarantees
- Considers the operational complexity of managing 2M semantic graphs
- Discusses multi-language NL understanding challenges and mitigation strategies
- Designs the data tiering and tenant lifecycle strategy (hot/warm/cold based on activity)
- Addresses unit economics: how the system can be profitable at ₹500/month per MSME
- Proposes the query cost token economy as a fairness and monetization mechanism

---

## Common Mistakes

| Mistake | Why It's Wrong | Better Approach |
|---|---|---|
| "Just use GPT to convert NL to SQL" | No validation, no safety, poor accuracy on messy schemas, no tenant isolation | Multi-stage pipeline with semantic graph, validation, and fallback |
| "Separate database per tenant" | Operationally impossible at 2M tenants (2M databases to manage) | Shared warehouse with partitioning + RLS + audit |
| "Run anomaly detection on every metric every minute" | Astronomically expensive; most metrics don't change frequently | Pre-screening tier to eliminate 80% of checks; batch processing for the rest |
| "Send all insights in the WhatsApp digest" | Information overload; merchant gets 20 insights and reads none | Rank by impact × confidence × novelty; deliver top 3 only |
| "Use the same LLM for all queries" | Expensive and slow; 60% of queries are simple patterns | Template matching for common patterns; LLM for complex ad-hoc only |
| "Benchmark by simple averaging" | Privacy violation risk in small cohorts | Differential privacy with calibrated noise |

---

## Estimation Questions

### "How many GPU nodes do you need for the LLM inference tier?"

**Expected calculation:**
- 1M NL queries/day, 40% reach LLM (60% handled by templates/cache) = 400K LLM queries/day
- Peak: 400K × 2.5 peak factor / 86,400 seconds = ~12 queries/second at peak
- Each query: ~0.8 seconds of GPU time
- Concurrent queries per GPU (with batching): ~5
- GPUs needed at peak: 12 / 5 × 1.5 safety margin = ~4 GPU nodes
- Plus narrative generation: similar volume, lighter workload (~0.3s per call) = 2 more nodes
- **Answer: 4-8 GPU nodes at target scale, auto-scaling between 2-20 based on load**

### "What's the storage cost per tenant per month?"

**Expected calculation:**
- Raw data: 500 MB × $0.025/GB = $0.0125/month
- Columnar (compressed): 200 MB × $0.10/GB = $0.020/month
- Materialized views: 100 MB × $0.10/GB = $0.010/month
- Semantic graph: 50 KB ≈ negligible
- Query logs (30-day): ~500 queries × 500 bytes = 250 KB ≈ negligible
- **Answer: ~$0.04/month per tenant in storage, or ~$80K/month for 2M tenants**
- **Insight: Storage is cheap; compute (LLM inference) dominates cost**

---

## Advanced Discussion Topics

### Topic 1: The Cold-Start Accuracy Bootstrapping Problem

**Discussion prompt:** "A new tenant connects their Tally accounting data. They have 200K rows of transactions with abbreviated column names (`vch_amt`, `party_nm`, `cr_dr`). How does the system achieve 90% query accuracy from day one?"

**Key points to evaluate:**
- Candidate recognizes that zero query history means no few-shot examples for the LLM
- Solution: industry-specific few-shot libraries (pre-built for accounting, retail, services verticals)
- Column mapping bootstrapping from the shared base ontology (500+ business concepts)
- Progressive accuracy improvement: first queries use high-confidence mappings only (60-70% coverage), with accuracy improving as merchant confirms mappings
- Candidate acknowledges the tension between immediate usability and mapping accuracy

### Topic 2: Real-Time vs Batch Insight Trade-offs

**Discussion prompt:** "A merchant's POS system sends transaction data every 5 minutes. Should the insight engine run in real-time (detect anomalies per transaction) or batch (hourly/daily)?"

**Key points to evaluate:**
- Cost-benefit analysis: real-time detection costs 50× more compute (per-event vs. batch aggregation) but provides only marginal benefit for MSMEs (who typically check analytics once or twice daily)
- Exception: threshold-based alerts (revenue drops to zero for 2 hours, which could indicate POS failure) warrant near-real-time detection
- Hybrid approach: lightweight threshold monitors in real-time + full statistical analysis in batch
- Candidate considers the merchant's consumption pattern: WhatsApp digests are daily, so sub-daily insight frequency is wasted unless routed via push notification

### Topic 3: Handling Data Quality Issues in Multi-Source Joins

**Discussion prompt:** "A merchant has Tally (accounting), a POS system, and bank statements. Revenue in Tally is ₹4.5 lakh, POS shows ₹4.2 lakh, and bank deposits total ₹4.8 lakh. Which number should the system show?"

**Key points to evaluate:**
- Candidate recognizes this as a data reconciliation problem, not just a query problem
- The system should NOT silently pick one source — it should surface the discrepancy
- Approach: designate a "source of truth" per metric (configurable by merchant), but flag significant discrepancies (>5%) as data quality insights
- The NL-to-SQL pipeline must track which source produced which answer
- Advanced: automatic reconciliation rules (bank deposits include GST but Tally revenue may be pre-GST; POS excludes cash transactions under ₹200)

---

## Trap Questions Expanded

### Trap: "How do you handle a merchant who asks questions about their competitors?"

**Why it's a trap:** This seems like a benchmark question, but the real test is whether the candidate recognizes the privacy boundary. "How is my competitor XYZ doing?" should NEVER return individual competitor data — even if the system somehow knows who XYZ is. The only acceptable response is anonymized cohort benchmarks ("businesses similar to yours...").

**Red flags:** Candidate suggests querying across tenants with the competitor's name, or building a competitor-tracking feature.

**Strong answer:** Route to benchmark API for anonymized cohort comparison; explicitly refuse to identify or query specific competitors; consider that even confirming another business is in the system is an information leak.

### Trap: "What if the LLM hallucinates a table that doesn't exist?"

**Why it's a trap:** Tests whether the candidate understands validation depth. A surface-level answer is "the SQL validator checks tables." The deep answer addresses the full chain: the schema mapper already constrains the LLM to known tables via the semantic graph, the SQL validator verifies against the allowed-table list, and the database role permissions prevent access to any table not in the allow-list.

**Strong answer:** Three independent checks prevent hallucinated table access. But the subtler issue is hallucinated _columns_ on real tables — the LLM might reference `orders.profit_margin` when only `orders.total_amount` and `orders.cost` exist. The column-level validation in the AST analyzer catches this.

### Trap: "A merchant uploads a 50GB spreadsheet. What happens?"

**Why it's a trap:** Tests scale reasoning and abuse prevention. 50 GB for an MSME is anomalous — typical MSME data is 100 MB–1 GB. This is either an error, abuse, or an enterprise customer on an MSME plan.

**Strong answer:** Upload size limits per tier (free: 100 MB, starter: 500 MB, growth: 2 GB, pro: 10 GB). Beyond that, the ingestion pipeline rejects with a helpful message. If a legitimate large upload is needed, the streaming ingestion path chunks it (10K rows at a time) with progress reporting, so the merchant doesn't stare at a blank screen for 30 minutes.

---

## Red Flags During Interview

| Red Flag | Why It Matters | What It Reveals |
|---|---|---|
| Treats NL-to-SQL as a solved problem ("just use an LLM") | Ignores the accuracy, safety, latency, and cost challenges that define this system | Candidate lacks depth in NL-to-SQL engineering |
| No mention of tenant isolation until prompted | Data isolation is the #1 security concern in multi-tenant systems; not mentioning it unprompted shows weak security instinct | Candidate treats multi-tenancy as an afterthought |
| Designs for enterprises first, then "simplifies" for MSMEs | MSME users have fundamentally different needs (NL interface, WhatsApp delivery, no technical skills) — this isn't a simplified enterprise BI | Candidate doesn't understand the user segment |
| Proposes per-tenant databases | Operationally impossible at 2M tenants; shows lack of scale reasoning | Candidate hasn't built multi-tenant systems at scale |
| Ignores the cost dimension | LLM inference, storage, and WhatsApp messaging costs dominate the economics; ignoring cost means the system can't be unit-economic at MSME price points ($5-10/month) | Candidate lacks product thinking |
| Designs insight delivery without feedback loops | Without "useful/not useful" feedback, the insight engine has no way to learn what matters to each merchant | Candidate doesn't understand ML product feedback loops |
| No discussion of graceful degradation | Every AI component (LLM, insight engine, connector) can fail; the system needs degradation ladders | Candidate designs for happy paths only |

---

## Scoring Rubric — Detailed Breakdown

### Requirements Phase (0–8 min) — Max 20 Points

| Criterion | 0 pts | 5 pts | 10 pts |
|---|---|---|---|
| **User understanding** | Assumes technical user (data analyst) | Identifies MSME owner but doesn't adjust design | Designs entire UX around non-technical user: NL queries, WhatsApp, auto-insights |
| **Scale awareness** | Single-tenant or small scale | Identifies multi-tenant need | Quantifies scale (2M tenants, 1M queries/day) and derives SLOs from scale |

### High-Level Design Phase (8–22 min) — Max 30 Points

| Criterion | 0 pts | 5 pts | 10 pts |
|---|---|---|---|
| **NL-to-SQL pipeline** | "Send question to LLM" | Multi-stage pipeline (intent → SQL) | Full pipeline with semantic graph, validation, template fallback, clarification dialog |
| **Data isolation** | WHERE tenant_id filter | Mentions RLS | Defense-in-depth: app-level rewriting + SQL validation + database RLS + audit |
| **Data architecture** | Single table with tenant_id | Partitioned warehouse | Hybrid: columnar store + materialized views + semantic cache + tiered storage |

### Deep Dive Phase (22–38 min) — Max 35 Points

| Criterion | 0 pts | 5 pts | 10 pts |
|---|---|---|---|
| **Technical depth** | Surface-level answers | Correct approach but no details | Algorithm-level detail with trade-offs, Step-by-step plan in plain English, and failure mode analysis |
| **Safety awareness** | Ignores NL injection risk | Mentions it as a concern | Describes semantic injection as distinct from SQL injection; proposes defense-in-depth |
| **Insight quality** | "Run anomaly detection" | Discusses statistical methods | Addresses novelty, impact ranking, feedback loops, cold-start, and correlated anomaly grouping |

### Wrap-Up Phase (38–45 min) — Max 15 Points

| Criterion | 0 pts | 5 pts | 10 pts |
|---|---|---|---|
| **Operational maturity** | No mention of failure modes | Identifies main failure modes | Degradation ladder, circuit breakers, chaos experiments, error budgets |

**Total: /100** — Strong hire threshold: 65+. Exceptional: 85+.

---

## Follow-Up Questions for Strong Candidates

These questions push beyond the standard design discussion into areas that reveal staff-level thinking:

1. **"How would you A/B test a new LLM model for the NL-to-SQL pipeline without risking query accuracy for production users?"** — Expected: shadow mode (run new model in parallel, compare results, promote when accuracy matches or exceeds old model on real traffic)

2. **"If a regulatory change requires all MSME financial data to be encrypted with tenant-managed keys (BYOK), how does that affect your architecture?"** — Expected: envelope encryption already supports this; main impact is on performance (decryption overhead per query) and key management (lost key = lost data)

3. **"How would you build a 'data marketplace' where tenants can optionally share anonymized data for better benchmarks?"** — Expected: opt-in consent model, differential privacy at individual level (not just cohort), governance framework, and UI that clearly explains what is shared

4. **"What happens when a competitor releases a similar product that is 10× cheaper? How does your architecture support aggressive cost reduction?"** — Expected: identify the 3 biggest cost drivers (LLM inference, storage, WhatsApp), and for each, describe a 50% cost reduction path (smaller models, tiered storage, digest frequency reduction)
