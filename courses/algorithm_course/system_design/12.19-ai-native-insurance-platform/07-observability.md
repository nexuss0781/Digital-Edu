# 12.19 AI-Native Insurance Platform — Observability

## Observability Philosophy

An AI-native insurance platform has a dual observability requirement that most systems do not share: **technical SLOs** (quote latency, system uptime) and **actuarial SLOs** (loss ratio by model cohort, behavioral score predictive accuracy). Technical metrics alert on system failure. Actuarial metrics detect model drift—where the system operates perfectly from an engineering standpoint but is silently mispricing risk, which is financially devastating at insurance scale.

---

## Key Metrics by Domain

### Quote & Underwriting Metrics

| Metric | Type | SLO / Alert |
|---|---|---|
| `quote_api_latency_p99` | Histogram | Alert if > 300ms (scoring); page if > 60s (full) |
| `quote_completion_rate` | Counter | Alert if < 85% of initiated quotes reach offer stage |
| `bureau_enrichment_timeout_rate` | Counter | Alert if any bureau > 5% timeout rate |
| `bind_rate_by_channel` | Gauge | Alert on > 20% delta vs. 7-day rolling average |
| `adverse_action_notice_backlog` | Gauge | Alert if > 0 notices past FCRA 3-business-day deadline |
| `risk_score_record_write_latency` | Histogram | Alert if > 100ms (must complete before policy binding) |
| `model_inference_errors` | Counter | Page if > 0 GLM errors (fallback anchor) |

### Claims Metrics

| Metric | Type | SLO / Alert |
|---|---|---|
| `fnol_acknowledgment_latency_p99` | Histogram | Alert if > 5s; page if > 10s |
| `fraud_score_delivery_latency_p99` | Histogram | Alert if > 4s |
| `straight_through_payment_rate` | Gauge | Monitor for significant drops (fraud rule miscalibration signal) |
| `claims_intake_completion_rate` | Counter | Alert if < 70% of started FNOL conversations complete |
| `adjuster_queue_depth` | Gauge | Alert if growing faster than adjuster throughput |
| `claims_in_cat_mode` | Gauge | Dashboard indicator; operations team notified at trigger |
| `damage_assessment_queue_depth` | Gauge | Alert if CV pipeline backlog exceeds 500 items |

### Telematics Pipeline Metrics

| Metric | Type | SLO / Alert |
|---|---|---|
| `telematics_consumer_lag_minutes` | Gauge | Alert if > 10 min; page if > 30 min |
| `trip_reconstruction_timeout_rate` | Counter | Alert if > 5% of trips time out (device upload reliability issue) |
| `behavioral_score_staleness_p95` | Histogram | Alert if > 2 hours since last score update for active drivers |
| `telematics_event_duplicate_rate` | Counter | Alert if > 10% (SDK bug or replay attack indicator) |
| `trips_with_anomaly_flags_rate` | Gauge | Monitor for sudden spikes (possible sensor fraud) |

### Fraud Intelligence Metrics

| Metric | Type | SLO / Alert |
|---|---|---|
| `fraud_score_distribution` | Histogram | Monitor weekly; shift toward high scores = fraud wave |
| `siu_lead_generation_rate` | Counter | Weekly ring detection batch output; monitor for trend |
| `fraud_graph_query_latency_p99` | Histogram | Alert if 2-hop subgraph retrieval > 500ms |
| `fraud_entity_graph_growth_rate` | Gauge | Monitor for unusual spikes (data import error indicator) |
| `gnn_inference_latency_p99` | Histogram | Alert if > 1s (contributes to FNOL SLO breach) |
| `high_fraud_claims_payment_rate` | Counter | Alert if any payment initiated on HIGH or CRITICAL fraud tier claim |

---

## Actuarial / Model Performance Monitoring

These metrics are distinct from technical metrics—they measure whether the ML models remain accurate over time. Model drift in insurance is financially material: a model that underestimates risk by 10% will produce a combined ratio > 100% (unprofitable underwriting).

### Loss Ratio Monitoring by Model Cohort

```
FUNCTION monitor_loss_ratio_by_cohort():
  // Segment policies by risk score decile at binding time
  FOR decile IN 1..10:
    cohort = policies.filter(
      risk_score_decile == decile,
      effective_date BETWEEN (now() - 12 months, now() - 3 months)
      // 3-month lag for loss development
    )
    earned_premium = sum(cohort.pro_rated_premium)
    incurred_losses = sum(claims.filter(policy_id IN cohort.policy_ids).incurred_amount)
    loss_ratio = incurred_losses / earned_premium

    IF loss_ratio > expected_loss_ratio[decile] * 1.15:  // 15% adverse deviation
      ALERT "Loss ratio adverse development: decile {decile}, actual {loss_ratio:.1%},
             expected {expected_loss_ratio[decile]:.1%}"
      TRIGGER model_review_request(model_version=cohort.model_version, decile=decile)
```

This check runs monthly on a rolling 12-month cohort. Adverse loss ratio development in a specific score decile signals the model is underestimating risk for those characteristics—a retraining trigger.

### Behavioral Score Predictive Accuracy

```
FUNCTION validate_telematics_score_lift():
  // Compare loss rates for telematics-enrolled vs. unenrolled, controlling for
  // other underwriting factors

  enrolled_claims_rate   = claims_rate(policies.filter(telematics_enrolled=true))
  unenrolled_claims_rate = claims_rate(policies.filter(telematics_enrolled=false))
  observed_lift = 1.0 - (enrolled_claims_rate / unenrolled_claims_rate)

  // Within enrolled, validate score decile separation
  FOR decile IN 1..10:
    decile_claim_rate = claims_rate(telematics_policies.filter(score_decile=decile))
    expected_gradient = actuarial_model.expected_claim_rate(decile)
    IF abs(decile_claim_rate - expected_gradient) / expected_gradient > 0.20:
      ALERT "Telematics score decile {decile} not separating as expected"
```

### Feature Drift Detection

Population Stability Index (PSI) is computed weekly for each rating variable. PSI > 0.25 indicates significant population shift that may invalidate the model's calibration:

```
FUNCTION compute_psi(feature: string, reference_week: date, current_week: date) -> float:
  ref_dist   = compute_decile_distribution(feature, reference_week)
  curr_dist  = compute_decile_distribution(feature, current_week)
  psi = sum(
    (curr_dist[i] - ref_dist[i]) * ln(curr_dist[i] / ref_dist[i])
    FOR i IN 1..10
  )
  // PSI < 0.1: no change; 0.1–0.25: moderate shift; > 0.25: major shift → investigate
  RETURN psi
```

---

## Dashboards

### Operations Dashboard

Real-time view for on-call engineers and customer operations:

- Quote funnel: initiated → scored → offered → bound (conversion waterfall)
- Active in-flight quotes (count + age distribution)
- Bureau enrichment: response rate and latency per provider
- Claims queue: FNOL rate (1h, 24h), adjuster queue depth, fraud score distribution
- Telematics: events/sec, consumer lag, trip reconstruction success rate
- CAT event indicator: active/inactive, affected region, claims surge multiplier

### Actuarial Model Dashboard

Monthly view for actuarial and data science teams:

- Loss ratio by risk score decile × model version (12-month rolling)
- Model version cohort comparison (champion vs. challenger performance)
- Feature PSI heatmap (all rating variables, weekly)
- Telematics score lift vs. unenrolled baseline
- Fraud model precision-recall over rolling 90-day window
- Adverse action reason code distribution (FCRA compliance check)

### Regulatory Compliance Dashboard

Monthly/quarterly view for compliance officers:

- Adverse action notice queue: pending, delivered, overdue
- Prohibited factor exclusion audit log: counts per state per model run
- Disparate impact monitoring: approval rates by demographic proxy
- Rate filing status: pending, approved, expired per state
- OFAC screening: pending manual reviews, confirmed matches
- Data breach monitoring: anomaly detection alerts, investigation status

---

## Alerting Runbooks

### Runbook: Fraud Score Delivery SLO Breach

**Alert:** `fraud_score_delivery_latency_p99 > 4s`

1. Check GNN inference service: Is GPU utilization > 90%? Scale out inference nodes
2. Check fraud graph: Is 2-hop subgraph retrieval > 1s? Check graph DB query cache warmth
3. Check FNOL rate: Is there a CAT event? If yes, assess CAT mode activation
4. Fallback: If GNN unavailable > 5 min, switch fraud scoring to rule-based fallback (no graph) and alert data science team

### Runbook: Loss Ratio Adverse Development Alert

**Alert:** `loss_ratio_cohort_{decile} > 1.15 * expected`

1. Confirm the decile's model version — which artifact was used for these policies?
2. Check feature PSI for top features in that decile — has population shifted?
3. Pull SHAP attribution for the cohort — which features drove these scores?
4. Data science team: run backtesting on the identified model version with current data
5. Actuarial team: assess whether current premium rates are adequate or require rate revision filing
6. If model confidence compromised: flag cohort for conservative renewal pricing until investigation complete

### Runbook: Bureau Enrichment Degradation

**Alert:** `bureau_enrichment_timeout_rate > 5%` for any provider

1. Check bureau provider status page (external dependency)
2. Check cached response hit rate — is cache serving most requests?
3. If degraded bureau is MVR: activate preliminary quote pathway for all new quotes
4. Escalate to bureau vendor account team with SLA reference
5. If degraded > 30 min: notify operations team; consider widening preliminary quote uncertainty band

### Runbook: CAT Event Surge Detected

**Alert:** `claims_in_cat_mode > 0` (automatic transition triggered)

1. Verify CAT mode trigger was legitimate: check FNOL geographic density against known weather events
2. Confirm claims intake has switched to simplified web form mode
3. Verify fraud scoring transitioned to async queue (claims acknowledged without waiting for score)
4. Monitor FNOL queue depth: ensure durable queue is not approaching capacity; scale consumers if needed
5. Activate CAT adjuster pool notification (pre-contracted surge staffing)
6. Notify executive team and customer operations of affected region and estimated claims volume
7. After surge subsides (FNOL rate < 2× baseline for 30 min): confirm automatic CAT mode deactivation
8. Post-event: review all CAT-mode claims for fraud scoring completion; re-queue any that failed

### Runbook: Telematics Score Staleness

**Alert:** `behavioral_score_staleness_p95 > 2 hours`

1. Check telematics consumer lag: is the trip processor falling behind the event stream?
2. Check if a large batch upload from mobile SDK is creating a temporary spike
3. If consumer lag > 30 min: scale trip processor workers (add 50% capacity)
4. Verify behavioral scorer GPU nodes are healthy; check for inference errors
5. If systemic: check for SDK version rollout that changed upload batch size or frequency
6. Impact assessment: stale scores affect re-rating accuracy but not active policy pricing (scores applied at billing cycle)

### Runbook: Adverse Action Notice SLA Breach Risk

**Alert:** `adverse_action_notice_backlog > 0 with age > 2 business days`

1. **CRITICAL — regulatory deadline:** FCRA requires delivery within 3 business days; this is a compliance violation risk
2. Check notice generation service: is it processing? Check for errors in SHAP attribution retrieval
3. If SHAP attribution unavailable: generate notice with reason codes derived from feature importance (fallback)
4. Manually dispatch any notice within 4 hours of the 3-business-day deadline
5. Notify compliance officer immediately; document any delay and root cause for regulatory record
6. Post-incident: root cause analysis required; this is a regulatory finding risk

---

## SLI/SLO Definitions

| SLI | Measurement Method | SLO Target | Burn Rate Alert (1h window) |
|---|---|---|---|
| Quote scoring latency | p99 of scoring-only requests (excluding bureau wait) measured at API gateway | ≤ 200 ms | > 14.4× monthly budget |
| FNOL acknowledgment latency | p99 from FNOL submission to claim number assignment | ≤ 3 s | > 10× monthly budget |
| Fraud score delivery latency | p99 from FNOL submission to fraud score available in routing | ≤ 3 s | > 10× monthly budget |
| Risk score record write success | % of binding events where record is written atomically before bind confirmation | 100% | Any failure (zero tolerance) |
| Adverse action notice timeliness | % of required notices dispatched within 3 business days of adverse decision | 100% | Any overdue (zero tolerance) |
| Telematics score freshness | p95 time from trip completion to behavioral score update | ≤ 30 min | p95 > 60 min |
| Straight-through payment cycle time | % of qualifying claims paid within 24 hours of FNOL | ≥ 95% | < 90% in rolling 24h |

---

## SLO Dashboard Designs

### Platform Health Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│  INSURANCE PLATFORM — OPERATIONAL HEALTH                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  QUOTE PIPELINE                    CLAIMS PIPELINE                  │
│  ┌──────────────────┐              ┌──────────────────┐            │
│  │ Scoring p99:     │              │ FNOL p99:        │            │
│  │ [===       ] 142ms│             │ [====      ] 2.1s │            │
│  │ Target: ≤200ms   │              │ Target: ≤3s      │            │
│  └──────────────────┘              └──────────────────┘            │
│  Active quotes: 847               Active claims (today): 16,241   │
│  Bureau cache hit: 82%            CAT mode: INACTIVE               │
│  Bind rate (7d avg): 21.3%        STP rate: 34.2%                  │
│                                                                     │
│  FRAUD INTELLIGENCE                TELEMATICS                       │
│  ┌──────────────────┐              ┌──────────────────┐            │
│  │ Score p99:       │              │ Consumer lag:     │            │
│  │ [===       ] 1.4s │             │ [==        ] 4 min│            │
│  │ Target: ≤3s      │              │ Target: ≤10 min  │            │
│  └──────────────────┘              └──────────────────┘            │
│  High-fraud claims (24h): 23      Events/sec: 38,421              │
│  Graph query p99: 340ms           Trips scored (24h): 487K         │
│                                                                     │
│  ERROR BUDGET STATUS (30-day rolling)                               │
│  Quote API:    [████████████████░░░░] 82% remaining                │
│  FNOL API:     [██████████████████░░] 91% remaining                │
│  Fraud Score:  [█████████████████░░░] 87% remaining                │
│  Risk Record:  [████████████████████] 100% (zero tolerance)        │
└─────────────────────────────────────────────────────────────────────┘
```

### Actuarial Model Performance Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│  ACTUARIAL MODEL PERFORMANCE — MONTHLY REVIEW                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LOSS RATIO BY RISK SCORE DECILE (12-month rolling, 3-mo lag)     │
│  Decile  Expected  Actual   Status                                 │
│  D1      45%       43%      ✓ Within 15% threshold                 │
│  D2      52%       54%      ✓                                      │
│  D3      58%       61%      ✓                                      │
│  D4      63%       67%      ⚠ 6.3% adverse — monitor               │
│  D5      68%       71%      ⚠ 4.4% adverse — monitor               │
│  D6      73%       74%      ✓                                      │
│  D7      79%       77%      ✓                                      │
│  D8      85%       88%      ⚠ 3.5% adverse — monitor               │
│  D9      92%       94%      ✓                                      │
│  D10     105%      118%     ✗ 12.4% adverse — INVESTIGATE          │
│                                                                     │
│  FEATURE PSI HEATMAP (top 10 features, weekly)                     │
│  Week:  W-4  W-3  W-2  W-1  Current                               │
│  credit  .02  .03  .02  .04  .03  ──── stable                     │
│  mvr_vi  .01  .02  .01  .01  .02  ──── stable                     │
│  claim_h .03  .05  .08  .12  .18  ──── TRENDING UP ⚠              │
│  telem_s .01  .01  .02  .02  .01  ──── stable                     │
│  age     .02  .02  .03  .02  .02  ──── stable                     │
│                                                                     │
│  TELEMATICS SCORE LIFT                                              │
│  Enrolled claims rate:   3.2%                                      │
│  Unenrolled claims rate: 5.1%                                      │
│  Observed lift: 37.3% (enrolled have 37% fewer claims)             │
│  Target lift: ≥25%  Status: ✓ STRONG                               │
│                                                                     │
│  FRAUD MODEL PRECISION-RECALL (90-day rolling)                     │
│  Precision @ HIGH tier:  78.4%  (target ≥70%)  ✓                   │
│  Recall @ HIGH tier:     61.2%  (target ≥50%)  ✓                   │
│  False positive rate:    4.3%   (target ≤8%)   ✓                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tracing Strategy

### Distributed Trace Boundaries

| Boundary | Trace Context Propagation | Sampling Strategy |
|---|---|---|
| Quote API → Bureau Enrichment | W3C Trace Context header; fan-out creates child spans per bureau | 100% for failed quotes; 10% for successful |
| Quote API → Underwriting Engine | gRPC metadata; model inference as child span | 100% for adverse action; 10% standard |
| FNOL → Fraud Scorer → Graph DB | W3C Trace Context; graph query as child span | 100% for HIGH/CRITICAL fraud tier |
| Telematics upload → Trip Processor → Scorer | Async: trace ID embedded in event payload | 1% of trips (volume too high for full trace) |
| Adverse Action Generator → Delivery Service | Event-driven: trace ID in event header | 100% (regulatory obligation to trace delivery) |

### Custom Span Attributes for Insurance Domain

| Attribute | Type | Purpose |
|---|---|---|
| `insurance.state_code` | string | Enable per-state latency and error analysis |
| `insurance.line_of_business` | string | Segment metrics by LOB |
| `insurance.algo_version` | string | Correlate latency with algorithm version deployments |
| `insurance.bureau.provider` | string | Identify which bureau is contributing to latency |
| `insurance.fraud_tier` | string | Segment claim processing by fraud risk |
| `insurance.cat_mode` | boolean | Distinguish CAT-mode operations from normal |
| `insurance.risk_score_decile` | integer | Correlate quote outcomes with risk segments |

---

## On-Call Runbook Quick Reference

| Scenario | Severity | First Response | Escalation |
|---|---|---|---|
| Quote API p99 > 500ms | P2 | Check ML inference fleet; check bureau latency | Eng manager if > 15 min |
| FNOL p99 > 10s | P1 | Check fraud scorer; check graph DB | Page claims platform + fraud team |
| Risk score record write failure | P0 | Halt binding immediately; check DB replication | Page storage on-call + compliance |
| Adverse action notice overdue | P0 | Manual dispatch within 1 hour; check generation service | Page compliance officer + legal |
| CAT mode triggered | P2 | Verify legitimate; monitor queue depth | Notify executive team |
| Bureau provider outage | P3 | Confirm cache serving; activate preliminary quotes | Contact bureau vendor |
| Fraud graph DB failover | P2 | Verify read replica promotion; check data lag | Page fraud team |
| Telematics consumer lag > 30 min | P3 | Scale trip processors; check for batch upload spike | Alert pipeline on-call |
| Model inference error rate > 1% | P2 | Check GPU health; check model artifact integrity | Page ML platform on-call |
| Loss ratio adverse development | P3 (non-urgent) | Data science investigation; not an immediate ops issue | Notify actuary team weekly |

---

## AI Model Quality Monitoring

### Underwriting Model Health

| Metric | Frequency | Alert Condition |
|---|---|---|
| Loss ratio by score decile | Monthly | Any decile > 15% adverse deviation from expected |
| Population Stability Index (PSI) per feature | Weekly | Any feature PSI > 0.25 |
| Model ensemble disagreement rate | Daily | > 10% of quotes have max-min score gap > 0.3 |
| SHAP feature importance stability | Weekly | Top-5 feature ranking change between consecutive weeks |
| Adverse action rate by state | Weekly | > 20% delta vs. 30-day rolling average (model calibration shift) |
| Score distribution shift | Weekly | KS-test p-value < 0.01 vs. training distribution |

### Fraud Model Health

| Metric | Frequency | Alert Condition |
|---|---|---|
| Precision @ HIGH tier | Monthly (90-day rolling) | < 70% (too many false positives exhausting SIU) |
| Recall @ HIGH tier | Monthly (90-day rolling) | < 50% (missing too many confirmed fraud cases) |
| Ring detection batch yield | Weekly | Zero new rings for 3 consecutive weeks (model stale or fraud adapted) |
| GNN embedding drift | Monthly | Cosine similarity < 0.85 between current and training embeddings |
| False positive rate by claimant demographic | Quarterly | Disparate impact > 1.25× on any protected class proxy |

### Telematics Scoring Health

| Metric | Frequency | Alert Condition |
|---|---|---|
| Score-to-loss correlation | Quarterly | Pearson r < 0.3 (score not predicting losses) |
| Opt-in rate trend | Monthly | Drop > 5% month-over-month (adverse selection accelerating) |
| Trip anomaly flag rate | Weekly | > 5% of trips flagged (sensor quality or spoofing issue) |
| Device attestation failure rate | Daily | > 2% of uploads fail attestation (SDK integrity issue) |

---

## Regulatory Compliance Monitoring

| Metric | Measurement | Alert Condition | Regulatory Risk |
|---|---|---|---|
| Adverse action notices pending | Count of notices not yet dispatched | Any notice > 2 business days old | FCRA violation; consumer complaint; regulator fine |
| Prohibited factor exclusion verification | Automated audit of risk score records | Any record where model_input contains a prohibited feature | State rate filing invalidation; refunds required |
| Rate algorithm version currency | Age of active algorithm per state | Any state running a superseded algorithm > 30 days | Regulatory inquiry; potential rate inadequacy |
| OFAC screening completion | % of new applicants/claimants screened | < 100% screened before binding | Federal sanctions violation |
| Data retention compliance | Records age vs. required retention per tier | Any Tier 1 data deleted before minimum retention | Regulatory audit failure; litigation discovery risk |
| Consumer data access request SLA | Time from request to fulfillment | > 30 days (CCPA) or > 45 days (some states) | State privacy law violation |
| Disparate impact monitoring | Approval rates by demographic proxy | Any ratio < 0.80 (4/5ths rule) | Rate filing challenge; class action risk |
| Breach notification readiness | Time from detection to commissioner notification | Mock drill > 72 hours | NAIC Data Security Model Law violation |

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
