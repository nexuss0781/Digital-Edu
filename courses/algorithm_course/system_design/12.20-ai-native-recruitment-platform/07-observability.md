# 12.20 AI-Native Recruitment Platform — Observability

## Observability Philosophy

The recruitment platform has three distinct observability audiences with different concerns:

1. **Engineering teams**: Latency, error rates, infrastructure health, pipeline throughput
2. **Recruiting operations**: Hiring funnel conversion rates, time-to-fill, candidate drop-off, assessment completion rates
3. **Compliance teams**: Adverse impact trends, model version drift, audit log completeness, regulatory SLA adherence

Each audience needs purpose-built dashboards. Raw infrastructure metrics are necessary but not sufficient; the system must emit business-semantic metrics from within application logic, not just proxy them from infrastructure counters.

---

## Key Metrics

### Hiring Funnel Metrics (Business)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Application-to-shortlist rate** | % of applicants advancing to recruiter shortlist per requisition | < 5% or > 70% (both indicate matching miscalibration) |
| **Shortlist-to-interview rate** | % of shortlisted candidates invited to interview by recruiters | < 30% sustained (recruiters rejecting AI shortlist → model quality issue) |
| **Interview-to-offer rate** | % of interviewed candidates receiving offers | Tracked by role type; major deviations indicate assessment score miscalibration |
| **Time-to-fill** | Days from requisition open to offer accepted | Per role type benchmark; alert on > 2 SD above role-type mean |
| **Candidate drop-off rate by stage** | % of candidates who stop engaging at each stage | > 30% drop-off at assessment start → UX or difficulty calibration issue |
| **Conversational AI resolution rate** | % of chatbot sessions that achieved candidate's stated intent without human escalation | < 70% → intent classifier degradation or knowledge gap |
| **Assessment completion rate** | % of candidates who started assessment and completed it | < 60% → assessment too long or too difficult; IRT calibration review |
| **Video interview submission rate** | % of candidates invited who submitted a video | < 50% → candidate friction; platform accessibility review |

### ML Model Health Metrics (Engineering + ML)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Matching embedding drift (PSI)** | Population Stability Index of candidate embedding distributions over time | PSI > 0.2 → significant distribution shift; re-embedding review |
| **Compatibility model ranking stability** | Spearman rank correlation between today's and yesterday's shortlist rankings for the same candidate pool | < 0.85 → unexplained model behavior change |
| **Intent classifier confidence distribution** | P50/P95 of intent confidence scores; track low-confidence rate | > 20% of turns below 0.7 confidence → retraining needed |
| **ASR confidence by candidate language group** | Mean ASR word error rate proxy (confidence score) segmented by self-reported primary language | > 5% gap between language groups → ASR model bias review |
| **IRT theta SE at stopping** | Distribution of standard error at assessment stop; should be narrow and below 0.3 threshold | > 15% of sessions stopping with SE > 0.35 → stopping criterion or item bank issue |
| **Assessment item exposure** | Per-item administration count over 30-day rolling window | > 20% exposure rate → item retirement and replacement |

### Bias and Fairness Metrics (Compliance)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Selection rate by demographic group** | Per-stage, per-requisition selection rates by gender and race/ethnicity | Any group impact ratio < 0.80 with p < 0.05 (4/5ths rule violation) |
| **Adverse impact alert frequency** | Count of bias_monitoring_batches with violation_detected = true per week | > 3 violations per week for a single employer → systematic model issue |
| **Bias batch cycle time** | Time from batch close event to bias analysis complete | > 5 min → bias monitor SLO breach |
| **Compliance hold duration** | Time from FLAGGED status to REVIEWED status for held decision batches | > 4 hours → compliance escalation |
| **Demographic data coverage** | % of candidates who provided demographic data (needed for bias analysis) | < 30% → bias analysis lacks statistical power; candidate notice language review |
| **AEDT notice compliance rate** | % of NYC candidates who received 10-day notice before AEDT application | < 100% → pipeline gate failure; immediate alert |

### Infrastructure Metrics (Engineering)

| Metric | Description | Alert Threshold |
|---|---|---|
| **ANN query p99 latency** | 99th percentile of vector index query latency | > 100 ms (should be 50 ms under normal conditions) |
| **Matching pipeline end-to-end p99** | From application received to shortlist available | > 2 s |
| **Video analysis queue depth** | Number of video submissions awaiting processing | > 5,000 (indicates > 2h lag in 30-min SLO pipeline) |
| **Conversational AI turn latency p95** | End-to-end turn processing time | > 800 ms |
| **Audit log write latency p99** | Time to write one audit entry and confirm durability | > 200 ms |
| **Erasure pipeline completion rate** | % of erasure requests completed within 30-day deadline | < 100% → immediate compliance alert |

---

## Distributed Tracing

Every candidate journey is assigned a trace_id at first contact (application or sourcing crawl). This trace_id propagates through all downstream pipeline stages:

```
Trace propagation:
  Candidate applies → trace_id generated at API gateway
  ↓
  Profile enrichment → trace_id in request header
  Embedding generation → trace_id in gRPC metadata
  ANN search → trace_id in query context
  Compatibility model inference → trace_id in batch item
  Bias monitoring → trace_id in decision event
  Audit log → trace_id as indexed field

Use cases:
  - Debug why a specific candidate was ranked #47 (pull full trace: embedding, ANN distances, feature vector, model output)
  - Investigate a bias alert (trace all decisions in the flagged batch; inspect feature attributions)
  - Diagnose a slow matching operation (trace shows which stage was slow: ANN query vs. model inference)
  - GDPR access request: trace_id enables complete reconstruction of all processing that touched a candidate's data
```

---

## Alerting and On-Call Design

### Alert Tiers

| Tier | Condition | Response |
|---|---|---|
| **SEV-1 (Page immediately)** | Bias monitor gate failure (decisions released without bias check); AEDT notice pipeline failure; audit log write failure; candidate API gateway down | On-call engineer + compliance officer paged immediately |
| **SEV-2 (Page within 15 min)** | Matching pipeline p99 > 5s; video analysis SLO at risk (queue depth > 5,000); conversational AI p95 > 2s; compatibility model unavailable | On-call engineer paged |
| **SEV-3 (Alert in business hours)** | Bias violation detected (batch FLAGGED); ASR confidence gap > 5%; intent classifier confidence degradation; model embedding drift PSI > 0.2 | ML engineer + compliance analyst notified next business day |
| **SEV-4 (Weekly digest)** | Assessment completion rate < 60%; candidate drop-off spikes; time-to-fill trending above benchmark | Recruiting ops team digest report |

### Compliance-Specific Alerting

Compliance alerts are routed to a separate on-call rotation (compliance officer + data privacy officer) to ensure that regulatory SLO breaches are handled by the appropriate function rather than relying on engineering on-call:

- GDPR erasure deadline at risk (< 7 days to 30-day deadline, not yet complete)
- LL144 bias audit publication deadline approaching (< 30 days, audit not yet generated)
- EU AI Act logging availability < 99% (regulatory logging obligation)
- Adverse impact alert in FLAGGED state > 4 hours without human review

---

## Dashboards

### Recruiter Operations Dashboard

```
Panels:
  [1] Hiring funnel funnel chart: Application → Shortlist → Interview → Offer → Hire (per week)
  [2] Time-to-fill by role type and seniority (rolling 30 days)
  [3] Candidate drop-off rate by stage (table with % change vs. prior week)
  [4] Assessment completion rate by assessment type
  [5] Chatbot resolution rate (rolling 7 days)
  [6] Top shortlist rejection reasons by recruiters (feedback loop quality)
```

### Model Health Dashboard

```
Panels:
  [1] Candidate embedding PSI trend (rolling 30-day window, daily computation)
  [2] Compatibility model ranking stability (Spearman correlation daily chart)
  [3] ANN query latency p50/p95/p99 (line chart, 1-hour resolution)
  [4] Intent classifier confidence distribution (histogram, daily snapshot)
  [5] ASR confidence by language group (grouped bar chart, weekly)
  [6] Active model versions per subsystem (table: service, version, deployed_at)
```

### Bias and Compliance Dashboard

```
Panels:
  [1] Adverse impact ratio heatmap: rows = demographic categories, columns = pipeline stages
      Color: green (ratio ≥ 0.9), yellow (0.80–0.89), red (< 0.80)
  [2] Bias alert frequency: flagged batches per week, per employer
  [3] Bias batch cycle time p50/p95 (SLO line at 5 min)
  [4] AEDT notice compliance: % of candidates noticed on time (100% target)
  [5] GDPR erasure pipeline: open requests, % on track, % at risk
  [6] LL144 audit status: generated / published / next due date
```

---

## Model Monitoring and Drift Detection

### Embedding Drift Monitoring

```
Process:
  Weekly job: Sample 10,000 candidate embeddings from the current index
  Compute PSI vs. baseline distribution (established at model deployment)
  PSI > 0.1: "slight shift" → logged, no action
  PSI > 0.2: "significant shift" → SEV-3 alert; ML engineer reviews
  PSI > 0.3: "major shift" → SEV-2 alert; consider re-embedding all profiles

Why it matters:
  If the distribution of candidate profiles shifts significantly (e.g., a new source of candidates
  from a different industry is onboarded), the ANN index may no longer accurately represent
  the candidate pool, degrading matching recall without any visible error.
```

### Assessment Item Drift Detection

```
Process:
  Daily job: For each item, compare observed p-correct rate in last 30 days vs. calibrated p-correct rate
  If |observed - calibrated| > 0.10: item flagged for re-calibration
  Items with significant drift are retired from the adaptive pool until re-calibrated

Why it matters:
  An item that was calibrated as "medium difficulty" when engineers with 3 years of experience
  took it may become "easy" as the candidate pool shifts to include more senior engineers.
  If difficulty estimates are wrong, IRT theta estimates are biased.
```

### Compatibility Model Predictive Validity Tracking

```
Process:
  Monthly job: For candidates who were hired 6+ months ago, correlate:
    - AI match score at time of shortlisting
    - Actual performance rating from hiring manager (if available)
    - Time-to-productivity (days to first independent contribution)
  Compute Pearson correlation between match_score and performance_rating
  Track this correlation over time as the "predictive validity coefficient"

  Validity coefficient < 0.15: model has no predictive power → SEV-2 alert
  Validity coefficient 0.15–0.30: weak predictive power → improvement needed
  Validity coefficient > 0.30: acceptable predictive power (typical for employment testing)

Why it matters:
  A matching model that produces confident-looking scores but has no correlation with
  actual job performance is worse than random — it creates a false sense of precision
  and may systematically discriminate via proxy features. Predictive validity is the
  ultimate metric, but it takes 6+ months to measure.
```

---

## SLO Dashboards

### SLO Dashboard 1: Candidate Experience

```
Panels:
  [1] Application submission success rate (99.9% target, 1-min resolution)
  [2] Conversational AI turn latency p50/p95/p99 (800ms target line at p95)
  [3] Assessment question load time p95 (200ms target)
  [4] Video upload success rate per region (grouped bar chart)
  [5] Chatbot resolution rate trend (7-day rolling; 70% target line)
  [6] Channel-switch continuity success rate (% of channel switches with seamless session recovery)

SLO burn rate alerts:
  - If 1-hour burn rate exceeds 14.4x (would exhaust monthly error budget in 5 days),
    page on-call engineer immediately
  - If 6-hour burn rate exceeds 6x (would exhaust in 12 days), alert in business hours
```

### SLO Dashboard 2: Matching Quality

```
Panels:
  [1] Recruiter shortlist acceptance rate (% of AI-shortlisted candidates advanced by recruiter)
      Rolling 30 days; alert if drops below 40% (recruiter rejecting AI recommendations)
  [2] Ranking stability: Spearman correlation of shortlist order day-over-day
      Alert if < 0.85 (unexplained rank volatility)
  [3] ANN recall@100 estimated from sampled ground-truth queries
      Alert if < 0.90 (index quality degradation)
  [4] Matching latency p99 vs. 2s SLO (line chart, 1-hour resolution)
  [5] Feature attribution coverage: % of shortlist entries with complete SHAP explanations
  [6] Model version distribution: how many active journeys are pinned to each model version
```

### SLO Dashboard 3: Compliance Health

```
Panels:
  [1] Bias batch cycle time p50/p95 vs. 5-min SLO (line chart)
  [2] Compliance hold queue: count of batches in FLAGGED state; duration in hold
  [3] AEDT notice compliance: 100% target; any miss is SEV-1
  [4] GDPR erasure pipeline: open requests, days remaining, % at risk
  [5] Audit log write success rate (99.99% target; any sustained failure is SEV-1)
  [6] Active bias violations by employer (heatmap: employer × pipeline stage)
```

---

## Incident Detection Playbooks

### Playbook 1: Adverse Impact Pattern Across Multiple Requisitions

```
Trigger: 3+ bias violation alerts for the same employer within 7 days

Investigation steps:
  1. Pull all flagged bias_monitoring_batches for the employer
  2. Identify common demographic category across violations (e.g., gender:female)
  3. Check if violations cluster in specific pipeline stages (screening vs. assessment)
  4. Pull compatibility model feature attributions for affected candidates
  5. Check for proxy features correlated with the violated demographic category
  6. Compare model version — did a recent model update coincide with violations?

Resolution paths:
  A. Proxy feature identified → remove from feature set; retrain model
  B. Model update coincidence → rollback to previous model version
  C. Applicant pool composition issue → review sourcing pipeline diversity
  D. Legitimate skills gap → document for EEOC defensibility; no model change
```

### Playbook 2: Conversational AI Generating Non-Compliant Responses

```
Trigger: Compliance team flags chatbot response from weekly audit sample

Investigation steps:
  1. Retrieve full conversation from dialogue session store
  2. Identify the specific LLM prompt that generated the flagged response
  3. Check if the response violated output filter rules (were filters active?)
  4. Reproduce: send same candidate message through test pipeline
  5. Determine if the issue is systemic (prompt vulnerability) or one-off (Edge Case (Unusual or extreme situation))

Resolution paths:
  A. Prompt vulnerability → update system prompt; add test case to regression suite
  B. Output filter gap → add new filter rule; backfill audit for similar responses
  C. Edge Case (Unusual or extreme situation) → document; add to training data for output classifier
  Immediate: if response made commitments (salary, timeline), notify candidate with correction
```

### Playbook 3: Embedding Drift Causing Matching Quality Degradation

```
Trigger: PSI > 0.2 AND recruiter shortlist acceptance rate drops below 35%

Investigation steps:
  1. Sample embeddings from current period vs. baseline period
  2. Visualize embedding distribution shift (t-SNE or UMAP projection)
  3. Identify which candidate segments shifted (new geography, new industry, new source)
  4. Check if skills graph was updated recently (quarterly update could trigger shift)
  5. Measure ANN recall@100 on a held-out query set with known relevant candidates

Resolution paths:
  A. Skills graph update caused shift → re-embed all profiles with new graph; expected transition
  B. New candidate source causing distribution change → update baseline distribution
  C. Genuine model degradation → retrain embedding model on expanded corpus
  D. Index fragmentation → trigger full index rebuild
```

---

## Observability for Regulatory Audits

### Audit-Ready Metrics Export

The observability system must support regulatory audit queries with structured data exports:

```
Audit query types:

  1. LL144 Annual Audit:
     Export: all candidate_stage_events for the audit period, joined with
     demographic_breakdown from bias_monitoring_batches.
     Format: LL144 JSON schema with impact ratios per demographic category per stage.

  2. EEOC Inquiry:
     Export: selection rates by EEO-1 categories for a specific employer and time period.
     Must include sample sizes, statistical significance, and model versions in use.

  3. EU AI Act Market Surveillance:
     Export: system logs showing all AI decisions for a specific candidate,
     including model version, input feature hash, output score, and timestamp.
     Retention: minimum 6 months from decision date.

  4. GDPR Data Subject Access Request:
     Export: complete candidate profile data, all decisions affecting the candidate,
     all conversations, assessment results, interview reports.
     Format: machine-readable (JSON); human-readable (PDF summary).

  5. Internal Model Audit:
     Export: predictive validity metrics, feature attribution distributions,
     bias monitoring trend data, model version history with performance deltas.
```

### Compliance Metric Retention

| Metric Category | Retention Period | Storage Tier | Justification |
|---|---|---|---|
| Bias monitoring batch results | 7 years | Warm (queryable) | LL144 + EEOC litigation defense |
| Individual decision audit entries | 7 years | Cold (retrievable in 24h) | EEOC inquiry response |
| Model performance metrics | 5 years | Warm | EU AI Act post-market monitoring |
| Candidate interaction logs | 3 years or erasure | Warm → Cold | GDPR + candidate experience analysis |
| Infrastructure metrics | 90 days | Hot | Operational debugging |
| SLO burn rate history | 1 year | Warm | Capacity planning |

---

## Candidate Journey Observability

### End-to-End Journey Tracing

Each candidate journey produces a structured trace that enables reconstruction of every AI decision and human interaction:

```
Journey trace structure:

  trace_id: uuid (generated at first contact)
  candidate_id: uuid
  req_id: uuid
  journey_start: timestamp

  spans:
    [1] application_received
        - channel: "web" | "sms" | "ats_import"
        - consent_status: "given" | "pending"
        - aedt_notice_sent_at: timestamp

    [2] profile_enrichment
        - resume_parse_duration_ms: 150
        - skills_extracted: ["python", "kubernetes", "ml_ops"]
        - embedding_model_version: "v2.3"
        - embedding_latency_ms: 45

    [3] matching
        - ann_search_latency_ms: 55
        - ann_candidates_returned: 1000
        - compatibility_model_version: "v4.1"
        - compatibility_inference_ms: 95
        - final_rank: 12
        - match_score: 0.78
        - top_features: {"skill_overlap": 0.35, "seniority_match": 0.25}

    [4] bias_check
        - batch_id: uuid
        - batch_size: 47
        - analysis_duration_ms: 3200
        - result: "CLEAR" | "FLAGGED" | "INSUFFICIENT_SAMPLE"
        - demographic_groups_tested: 8

    [5] recruiter_review
        - reviewer_id: uuid
        - review_duration_min: 4.5
        - decision: "ADVANCE" | "REJECT" | "HOLD"
        - override_ai: false

    [6] assessment (if applicable)
        - assessment_type: "TECHNICAL"
        - items_administered: 22
        - theta_estimate: 1.45
        - scaled_score: 82
        - percentile: 84
        - session_duration_min: 35

    [7] interview_analysis (if applicable)
        - submission_id: uuid
        - analysis_duration_min: 18
        - asr_confidence: 0.92
        - overall_competency: {"problem_solving": 0.72, "communication": 0.81}

Query examples:
  "Show me the full journey for candidate X on req Y"
  "Which candidates were ranked > 50 by AI but advanced by recruiter?" (override analysis)
  "What is the median time from application to shortlist across all requisitions?"
  "Which pipeline stage has the highest drop-off rate this month?"
```

### Recruiter Behavior Analytics

```
Metrics tracked per recruiter:

  - Shortlist review time (median, p95): how long recruiters spend reviewing AI shortlists
  - AI override rate: % of AI-shortlisted candidates rejected by recruiter
  - Bias pattern: do specific recruiters systematically reject candidates from certain demographics?
  - Feedback velocity: how quickly does recruiter feedback (advance/reject) feed back to model?
  - Assessment-to-review correlation: do recruiters' decisions correlate with assessment scores?

These metrics serve two purposes:
  1. Model quality: high override rates indicate model miscalibration
  2. Recruiter accountability: systematic override patterns may indicate recruiter bias
     (this data is available to compliance officers, not to the recruiter's direct manager)
```

---

## AI Observability Standards

This system's AI components inherit observability patterns from:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — distributed tracing, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, quality metrics

### Required AI Metrics for Regulated Domain
- Model prediction confidence distribution
- Human override rate (track, not minimize — high override rate may indicate model drift)
- AI recommendation acceptance rate by decision type
- Drift detection alerts (data drift + concept drift)
- Explainability score per AI recommendation
- Regulatory audit trail completeness
