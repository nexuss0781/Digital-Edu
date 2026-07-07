# Observability

## Observability Strategy

The BNPL platform requires observability across three dimensions: **financial correctness** (every dollar disbursed must have matching receivables; every collection must reconcile), **consumer experience** (credit decisions must be fast; checkout must not fail), and **regulatory compliance** (disclosures must be delivered; disputes must be resolved on time). Traditional infrastructure metrics are necessary but insufficient---the observability system must surface business-level health indicators that map directly to revenue, risk, and compliance.

---

## Key Metrics (SLIs)

### Credit Decision Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `credit.decision.latency_p50` | Histogram | Median decision latency | > 1s |
| `credit.decision.latency_p99` | Histogram | 99th percentile decision latency | > 2s |
| `credit.decision.approval_rate` | Gauge | % of checkout requests approved | < 65% or > 85% (sudden shift indicates model issue) |
| `credit.decision.error_rate` | Counter | % of decisions that fail (timeout, error) | > 1% |
| `credit.decision.bureau_cache_hit` | Gauge | % of decisions using cached bureau data | < 60% (cache efficiency degradation) |
| `credit.decision.model_version` | Label | Active ML model version | Version mismatch across instances |
| `credit.decision.fallback_rate` | Counter | % using rules-based fallback (ML unavailable) | > 5% |
| `credit.decision.feature_staleness` | Gauge | Age of oldest feature used in decision | > 24h |

### Payment Collection Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `collection.first_attempt_success` | Gauge | % of payments collected on first try | < 90% |
| `collection.final_success_rate` | Gauge | % collected after all retries | < 96% |
| `collection.batch_completion_time` | Histogram | Time to process a collection batch | > 60 min |
| `collection.processor_error_rate` | Counter per processor | Error rate by payment processor | > 5% |
| `collection.retry_queue_depth` | Gauge | Payments awaiting retry | > 500K (backlog building) |
| `collection.late_fee_assessment_rate` | Gauge | % of payments incurring late fees | Sudden increase > 20% above baseline |
| `collection.delinquency_rate_30d` | Gauge | % of plans 30+ days overdue | > 5% |
| `collection.charge_off_rate` | Gauge | % of plans charged off (120+ days) | > 4% |

### Merchant Settlement Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `settlement.reconciliation_pass_rate` | Gauge | % of settlements passing reconciliation | < 99.99% |
| `settlement.discrepancy_amount` | Gauge | Total dollar amount of unreconciled settlements | > $100 |
| `settlement.processing_time` | Histogram | Time from cutoff to bank transfer initiation | > 4h |
| `settlement.merchant_complaint_rate` | Counter | Settlement-related merchant support tickets | > 0.1% of settlements |

### Consumer Experience Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `checkout.widget_load_time_p99` | Histogram | Time for checkout widget to render | > 500ms |
| `checkout.conversion_rate` | Gauge | % of initialized checkouts that convert to plans | < baseline - 5% |
| `checkout.abandonment_at_decision` | Counter | Consumers who leave during credit decision wait | > 10% |
| `dashboard.plan_list_latency_p99` | Histogram | Consumer dashboard load time | > 500ms |
| `dispute.resolution_time_p50` | Histogram | Median time to resolve dispute | > 10 days |
| `dispute.resolution_time_max` | Gauge | Longest unresolved dispute age | > 25 days (regulatory deadline approaching) |

---

## Logging Strategy

### Structured Log Schema

```
{
    "timestamp": "2026-03-09T15:30:00.123Z",
    "level": "INFO|WARN|ERROR",
    "service": "credit-decision-service",
    "trace_id": "abc-123-def-456",
    "span_id": "span-789",
    "consumer_id": "c_redacted_hash",      -- PII-safe hash
    "merchant_id": "m_abc123",
    "plan_id": "plan_def456",
    "event": "credit.decision.completed",
    "decision": "approved",
    "risk_score": 0.15,
    "latency_ms": 780,
    "model_version": "v3.2.1",
    "bureau_cache_hit": true,
    "metadata": { ... }
}
```

### Log Levels by Component

| Component | INFO | WARN | ERROR |
|-----------|------|------|-------|
| **Credit Decision** | Decision outcome, latency, model version | Feature staleness > 12h, bureau timeout with cache fallback | Decision failure, model unavailable, feature store unreachable |
| **Plan Management** | Plan created, state transition, refund processed | Plan modification outside normal flow | Plan creation failed, state machine violation |
| **Payment Collection** | Payment collected, retry scheduled | Payment failed (retryable), rate limit hit | Payment failed (permanent), processor unreachable, reconciliation mismatch |
| **Settlement** | Settlement computed, bank transfer initiated | Settlement delayed, minor discrepancy (< $1) | Reconciliation failure, bank transfer rejected |
| **Virtual Card** | Card issued, authorization approved | Authorization amount mismatch (within tolerance) | Authorization failed, card expired prematurely |

### PII Handling in Logs

```
Sensitive data NEVER appears in logs:
  - Consumer names → redacted
  - Email addresses → hashed (SHA-256, salted)
  - Phone numbers → last 4 digits only
  - Payment method details → token reference only
  - Credit bureau data → score range only (e.g., "650-700")
  - Addresses → state/country only

Consumer ID: hashed in logs; mapping table secured separately for support investigations
```

---

## Distributed Tracing

### Trace Structure

```
Checkout Flow Trace (credit_decision_trace):
  ┌─ [gateway] POST /v1/checkout/initialize          total: 1,200ms
  │  ├─ [auth] validate_merchant_api_key                    5ms
  │  ├─ [credit-decision] evaluate_credit                   1,150ms
  │  │  ├─ [pre-screen] rule_evaluation                     8ms
  │  │  ├─ [feature-store] get_features                     12ms
  │  │  ├─ [credit-bureau] soft_pull (cache: HIT)           3ms
  │  │  ├─ [ml-service] risk_score                          45ms
  │  │  ├─ [ml-service] fraud_score                         38ms
  │  │  ├─ [decision-logic] evaluate                        15ms
  │  │  ├─ [disclosure] generate_tila                       8ms
  │  │  └─ [audit] log_decision (async)                     2ms (fire-and-forget)
  │  └─ [gateway] format_response                           12ms

Collection Flow Trace (collection_trace):
  ┌─ [scheduler] identify_due_payments                batch: 20,000
  │  ├─ [batch-gen] create_batches                          200ms
  │  ├─ [executor] submit_batch_1                           45,000ms
  │  │  ├─ [processor-a] charge (×15,000)                   bulk
  │  │  └─ [processor-b] charge (×5,000)                    bulk
  │  ├─ [reconciler] match_results                          500ms
  │  ├─ [state-updater] update_plan_states                  300ms
  │  └─ [notification] send_receipts (async)                fire-and-forget
```

### Trace Sampling Strategy

| Flow | Sampling Rate | Rationale |
|------|--------------|-----------|
| Credit decision (approved) | 10% | High volume, well-understood path |
| Credit decision (declined) | 100% | Lower volume; every decline needs audit trail |
| Credit decision (error) | 100% | Every error must be diagnosable |
| Payment collection (success) | 1% | Very high volume, routine |
| Payment collection (failure) | 100% | Every failure must be investigated |
| Settlement | 100% | Low volume, high financial importance |
| Dispute resolution | 100% | Regulatory requirement |

---

## Alerting Framework

### Critical Alerts (Page Immediately)

| Alert | Condition | Action |
|-------|-----------|--------|
| `CreditDecisionDown` | Error rate > 50% for 2 min | Page on-call; checkout is failing |
| `PaymentCollectionHalted` | No successful collections in 30 min during window | Page on-call; revenue impact |
| `SettlementReconciliationFailure` | Any settlement fails reconciliation | Page finance-on-call; merchant impact |
| `FraudSpikeDetected` | Fraud score > threshold on > 5% of decisions | Page fraud team; potential organized attack |
| `DatabasePrimaryDown` | Primary DB unreachable for 30s | Page infra-on-call; automated failover should trigger |

### Warning Alerts (Investigate Within 1 Hour)

| Alert | Condition | Action |
|-------|-----------|--------|
| `ApprovalRateAnomaly` | Approval rate deviates > 5% from 7-day rolling average | Investigate model drift or data issue |
| `CollectionSuccessRateDrop` | First-attempt success < 88% for 2 consecutive windows | Check processor health; review payment method validity |
| `BureauCacheHitDrop` | Cache hit rate < 50% for 1 hour | Check cache health; possible eviction storm |
| `FeatureStoreStaleness` | Any feature older than 18h served in decision | Check feature pipeline; hourly job may have failed |
| `DelinquencyRateIncrease` | 30-day delinquency rate > 6% | Review underwriting thresholds; economic conditions may have shifted |
| `DisputeResolutionDeadline` | Any dispute > 25 days old (30-day regulatory deadline) | Escalate to compliance team |

### Informational Alerts (Review Daily)

| Alert | Condition | Action |
|-------|-----------|--------|
| `ModelVersionMismatch` | Different instances running different model versions | Check deployment rollout status |
| `MerchantSettlementDelay` | > 1% of settlements exceed T+3 | Review banking partner SLA |
| `ConsumerDashboardLatency` | p99 > 400ms for 1 hour | Review database query performance |

---

## SLI/SLO Dashboard

### Executive Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│ BNPL Platform Health                         2026-03-09 15:30  │
├─────────────────┬───────────────────┬───────────────────────────┤
│ Credit Decision │ Collection Engine │ Financial Health          │
│ ──────────────  │ ────────────────  │ ────────────────          │
│ Approval: 76.2% │ 1st Attempt: 93% │ Outstanding: $4.52B      │
│ p99 Lat: 1.4s  │ Final: 97.8%     │ Delinquent: 3.1%         │
│ Errors: 0.02%  │ Queue: 12K       │ Charge-off: 2.4%         │
│ [SLO: OK ✓]    │ [SLO: OK ✓]      │ [Target: < 4%]           │
├─────────────────┴───────────────────┴───────────────────────────┤
│ Settlement             │ Compliance              │ Consumer UX  │
│ ──────────────         │ ──────────────          │ ────────     │
│ Reconciled: 100%       │ TILA Delivery: 100%     │ Widget: 280ms│
│ Pending: $284M         │ Adverse Notice: 100%    │ Checkout: 76%│
│ Avg Time: T+1.8        │ Dispute < 30d: 100%     │ NPS: 62      │
│ [SLO: OK ✓]           │ [SLO: OK ✓]            │ [Target: >60]│
└─────────────────────────────────────────────────────────────────┘
```

### SLO Burn Rate Monitoring

```
For each SLO, track error budget consumption:

Credit Decision Availability (SLO: 99.99%):
  - Monthly budget: 4.32 minutes of downtime
  - Current burn rate: 0.5x (on track)
  - Remaining budget: 3.8 minutes

Credit Decision Latency (SLO: p99 < 2s):
  - Monthly budget: 0.01% of decisions > 2s → ~900 slow decisions
  - Current burn rate: 0.3x (comfortable)
  - Remaining budget: 720 slow decisions

Collection Success Rate (SLO: > 98% final):
  - Monthly budget: 2% failure → ~3M failed collections
  - Current burn rate: 1.1x (slightly elevated, monitor)
  - Remaining budget: 1.2M failed collections

Alert on burn rate:
  - > 2x: Warning (1h investigation)
  - > 5x: Critical (immediate page)
  - > 10x: Emergency (incident declared)
```

---

## Financial Reconciliation Observability

### Daily Reconciliation Checks

```
Reconciliation Pipeline (runs nightly):

1. Disbursement Reconciliation
   SUM(merchant_disbursements) + SUM(platform_fees) = SUM(plan_creation_amounts)
   Tolerance: $0.00 (zero tolerance)

2. Receivables Reconciliation
   SUM(outstanding_plan_balances) = SUM(total_disbursed) - SUM(total_collected) - SUM(charge_offs)
   Tolerance: $0.00

3. Collection Reconciliation
   SUM(processor_confirmations) = SUM(plan_payment_updates)
   Tolerance: $0.00 (every processor confirmation must have matching plan update)

4. Settlement Reconciliation
   SUM(settlement_amounts) = SUM(merchant_transactions) - SUM(refunds) - SUM(fees)
   Per-merchant tolerance: $0.01 (rounding)

5. Late Fee Reconciliation
   SUM(late_fees_assessed) compliant with state_max_late_fee for each jurisdiction
   Tolerance: 0 violations

Reconciliation failures → immediate alert → settlement paused until resolved
```

### Model Performance Monitoring

```
ML Model Observability:

Prediction quality:
  - Predicted default rate vs. actual default rate (30/60/90 day lookback)
  - Calibration plot: P(default=0.10) should see ~10% actual default
  - AUC-ROC tracked daily; alert if drops > 2% from baseline

Feature drift:
  - Distribution shift detection on top 20 features
  - Alert if KL-divergence > threshold for any feature
  - Common triggers: economic shifts, bureau API changes, demographic shifts

Fairness monitoring:
  - Approval rate by demographic segment (daily)
  - Alert if any segment deviates > 2% from population average
  - Fair lending report auto-generated monthly
```

---

## Consumer Lifecycle Observability

### Cohort-Based Health Tracking

```
Cohort Analysis Dashboard:
  Cohorts defined by: acquisition month × credit tier × plan type

  For each cohort, track over time:
    - Approval rate at origination
    - First-payment success rate (leading indicator of portfolio quality)
    - 30-day delinquency rate
    - 60-day delinquency rate
    - 90-day delinquency rate
    - Charge-off rate (final loss)
    - Recovery rate (post-charge-off collections)
    - Net loss rate = charge-off - recovery

  Vintage Analysis:
    Plot net loss curves for each monthly cohort on the same chart
    If recent cohorts' curves are above prior cohorts → underwriting has loosened
    If recent cohorts' curves are below → underwriting improvement or macro tailwind

  Alert: If any cohort's 30-day delinquency exceeds 2x the cohort average
  Action: Investigate whether risk model thresholds need tightening
```

### End-to-End Checkout Conversion Funnel

```
Funnel Metrics (tracked per merchant, per plan type):

  1. Widget Loaded           → 100%    (baseline)
  2. BNPL Option Selected    → 65%     (conversion_rate_1)
  3. Credit Decision Started → 62%     (drop: form abandonment)
  4. Credit Decision Approved→ 48%     (approval_rate: ~77%)
  5. Plan Selected           → 44%     (drop: plan not suitable)
  6. Checkout Confirmed      → 40%     (drop: changed mind / payment method issue)
  7. First Payment Success   → 39%     (drop: payment failure at checkout)

  Alert conditions:
    - Step 2 → 3 drop > 5%: checkout widget UX issue
    - Step 3 → 4 drop > baseline: model too conservative or bureau timeout
    - Step 5 → 6 drop > 10%: plan terms not competitive
    - Step 6 → 7 drop > 3%: payment method verification issue
```

---

## Open Banking Data Quality Monitoring

```
Open Banking Observability Metrics:

Data Freshness:
  - ob.consent.active_count                 -- consumers with active consent
  - ob.data.last_sync_age_p50              -- median age of last bank data sync
  - ob.data.last_sync_age_p99              -- tail: stale consents not refreshing
  Alert: p99 > 72h → consent refresh pipeline may be failing

Data Completeness:
  - ob.income.detection_rate               -- % of consented consumers where income is detected
  - ob.transaction.categorization_rate     -- % of transactions successfully categorized
  Alert: detection_rate < 80% → categorization model may need retraining

Decision Impact:
  - ob.decision.approval_lift              -- additional approvals enabled by open banking data
  - ob.decision.default_reduction          -- default rate with vs. without open banking
  - ob.decision.thin_file_approval_rate    -- approval rate for consumers with no bureau history
  Dashboard: side-by-side comparison of bureau-only vs. bureau+OB decision quality
```

---

## Runbook Integration

### Critical Incident Playbooks

| Incident | Detection | Immediate Action | Resolution |
|----------|-----------|-----------------|------------|
| **Approval rate drops > 10%** | `credit.decision.approval_rate` gauge | Check ML model version consistency across instances; verify feature store freshness | If model drift: tighten thresholds via config; if feature store: restart pipeline |
| **Collection success < 85%** | `collection.first_attempt_success` gauge | Check processor health dashboards; verify payment method token validity | If processor: activate circuit breaker + alternate route; if tokens: trigger consumer re-verification |
| **Settlement reconciliation fail** | `settlement.reconciliation_pass_rate` < 100% | Halt affected merchant settlements; page finance-on-call | Manual reconciliation; identify mismatched transactions; correct and re-run |
| **Consumer data breach suspected** | Security event correlation | Activate incident response team; isolate affected systems | Forensic investigation; regulatory notification within 72h (GDPR); consumer notification |
| **Late fees assessed in violation** | `compliance.late_fee_violation_count` > 0 | Halt late fee assessment; page compliance team | Reverse non-compliant fees; update jurisdiction config; audit recent assessments |
