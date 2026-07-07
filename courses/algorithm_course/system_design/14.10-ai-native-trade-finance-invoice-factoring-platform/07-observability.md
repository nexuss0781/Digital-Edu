# 14.10 AI-Native Trade Finance & Invoice Factoring Platform — Observability

## Key Metrics

### Business Metrics (Executive Dashboard)

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| Daily Transaction Volume (DTV) | Total value of invoices funded per day | ₹15,000 crore | < ₹8,000 crore (weekday) |
| Deal Conversion Rate | Percentage of uploaded invoices that get funded | 60% | < 45% |
| Average Discount Rate | Platform-wide weighted average annualized discount rate | 10–14% | Deviation > 200 bps from previous week |
| Default Rate (30 DPD) | Percentage of deals overdue by 30+ days | < 1.5% | > 2.0% |
| NPA Rate (90 DPD) | Percentage of deals classified as NPA | < 0.5% | > 0.8% |
| Financier Utilization | Percentage of available financier capital deployed | 60–80% | < 40% (capital idle) or > 90% (capacity crunch) |
| MSME Retention (30-day) | Percentage of MSMEs who upload invoices in consecutive 30-day periods | 75% | < 60% |
| Time to Disbursement (p50) | Median time from invoice upload to fund disbursement | 4 hours | > 8 hours |

### System Performance Metrics

| Metric | Description | SLO | Alert Threshold |
|---|---|---|---|
| Invoice Processing Latency (p95) | Time from upload to fully verified status | 30 seconds | > 60 seconds |
| OCR Extraction Accuracy | Percentage of fields correctly extracted | 96% | < 93% |
| Credit Score Computation (p95) | Latency for single buyer score computation | 200 ms | > 500 ms |
| Pricing Computation (p95) | Latency for single invoice pricing | 500 ms | > 1 second |
| Financier Matching (p95) | Latency from priced invoice to matched financiers | 2 seconds | > 5 seconds |
| Settlement Saga Completion (p95) | Time from deal acceptance to disbursement confirmation | 4 hours | > 8 hours |
| GSTN API Latency (p95) | Response time for GST cross-verification | 5 seconds | > 15 seconds |
| API Gateway Response (p99) | Overall API response time for read operations | 300 ms | > 500 ms |
| API Gateway Error Rate | Percentage of 5xx responses | < 0.1% | > 0.5% |
| Queue Depth (Invoice Pipeline) | Number of unprocessed invoices in queue | < 500 | > 2,000 |

### Risk & Compliance Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| Fraud Detection Rate | Percentage of known fraud caught by automated systems | > 98% | < 95% |
| False Positive Rate (Fraud) | Percentage of legitimate invoices flagged as fraud | < 2% | > 4% |
| CRAR (Capital Adequacy) | Real-time Capital to Risk-weighted Assets Ratio | > 18% | < 16% (regulatory minimum 15%) |
| Concentration Risk | Maximum single-buyer exposure as % of total portfolio | < 10% | > 12% |
| KYC Completion Rate | Percentage of onboarding applications completed successfully | 85% | < 70% |
| STR Filing Timeliness | Percentage of suspicious transactions reported within SLA | 100% | < 100% (regulatory non-compliance) |
| GST Verification Success Rate | Percentage of invoices passing GST cross-verification | 92% | < 85% |

### Infrastructure Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| GPU Utilization (OCR/Credit Models) | GPU compute utilization for ML inference | 60–80% | > 90% (scaling needed) or < 30% (over-provisioned) |
| Database IOPS (Ledger) | Input/output operations per second on ledger DB | < 80% of provisioned | > 85% |
| Object Storage Usage | Total storage consumed by invoice documents | Monitor growth | Growth rate > 3 TB/day (above capacity plan) |
| Settlement Partition Lag | How far behind each settlement partition is from latest event | < 100 events | > 1,000 events |
| Cache Hit Rate (Credit Scores) | Percentage of credit score requests served from cache | > 90% | < 80% |
| Event Store Write Latency (p99) | Latency for persisting audit events | < 10 ms | > 50 ms |

---

## Logging Strategy

### Log Levels and Content

| Level | When | Content | Retention |
|---|---|---|---|
| **ERROR** | Operation failure: bank API timeout, settlement saga step failure, model inference error | Full error context: request ID, affected entities (invoice/deal IDs), error code, stack trace (non-PII), retry count | 1 year |
| **WARN** | Degraded operation: GSTN API slow, cache miss rate high, queue depth approaching threshold | Degradation context: metric values, threshold crossed, affected component | 6 months |
| **INFO** | Business events: invoice uploaded, deal created, settlement completed, credit score updated | Event type, entity IDs, key metadata (amount, rate, status change), actor, timestamp | 90 days (except audit-grade events: 10 years) |
| **DEBUG** | Detailed processing: OCR field-level extraction, pricing factor breakdown, fraud score components | All processing details; model inputs/outputs; intermediate states | 7 days |

### Structured Log Format

```
{
    "timestamp": "2026-03-10T14:23:45.123456Z",
    "level": "INFO",
    "service": "pricing-engine",
    "instance_id": "pricing-engine-7b4f2d",
    "trace_id": "abc123def456",
    "span_id": "span-789",
    "correlation_id": "upload-batch-2024-0310-001",
    "event": "INVOICE_PRICED",
    "entity_type": "INVOICE",
    "entity_id": "inv-uuid-123",
    "data": {
        "buyer_id": "buyer-uuid-456",
        "buyer_rating": "AA",
        "annualized_rate_bps": 1000,
        "discount_amount": 8219.18,
        "pricing_factors": {
            "base_rate": 650,
            "credit_premium": 100,
            "tenor_adj": 0,
            "liquidity_adj": -30,
            "concentration_premium": 0,
            "seasonal_adj": 25
        },
        "model_version": "credit-v3.2.1"
    },
    "duration_ms": 142
}
```

### PII Handling in Logs

| Field | Treatment |
|---|---|
| GSTIN | Last 5 digits visible; prefix masked (e.g., `XXXXXXXXXXV5Z8`) |
| PAN | Fully masked in logs; only entity UUID used for correlation |
| Bank account | Never logged; tokenized reference only |
| Invoice amounts | Logged (not PII, but access-controlled) |
| User names | First name + last initial only in logs |
| IP addresses | Logged for security events; hashed for general events |

---

## Distributed Tracing

### Trace Architecture

Each invoice processing request generates a trace that spans multiple services:

```
Trace: Invoice Upload to Disbursement (end-to-end)
│
├── Span: API Gateway (authentication, rate limiting)
│   └── Duration: 15ms
│
├── Span: OCR Engine (document understanding)
│   ├── Span: Document classification (invoice vs. PO vs. credit note)
│   │   └── Duration: 200ms
│   └── Span: Field extraction (ML inference)
│       └── Duration: 3.5s
│
├── Span: GST Verifier (cross-reference with GSTN)
│   ├── Span: GSTN API call (external)
│   │   └── Duration: 2.8s (includes retry)
│   └── Span: Field comparison and validation
│       └── Duration: 50ms
│
├── Span: Fraud Detector
│   ├── Span: Duplicate check (hash lookup)
│   │   └── Duration: 5ms
│   ├── Span: Behavioral analysis
│   │   └── Duration: 150ms
│   └── Span: Graph analysis (circular trading check)
│       └── Duration: 800ms
│
├── Span: Credit Scorer
│   ├── Span: Feature assembly (cache + database)
│   │   └── Duration: 30ms
│   └── Span: Model inference
│       └── Duration: 120ms
│
├── Span: Pricing Engine
│   └── Duration: 80ms
│
├── Span: Financier Matcher
│   └── Duration: 200ms
│
├── Span: Deal Creation
│   └── Duration: 50ms
│
└── Span: Settlement Saga
    ├── Span: Reserve financier limit
    │   └── Duration: 30ms
    ├── Span: Create escrow allocation
    │   └── Duration: 50ms
    ├── Span: Record lien
    │   └── Duration: 20ms
    ├── Span: Bank transfer initiation
    │   └── Duration: 2.1s (external bank API)
    ├── Span: Transfer confirmation (async wait)
    │   └── Duration: 12 minutes (NEFT settlement cycle)
    └── Span: Ledger recording
        └── Duration: 15ms
```

### Cross-Service Correlation

- **Trace ID**: Propagated via HTTP header `X-Trace-ID` across all service calls
- **Correlation ID**: Business-level identifier (e.g., invoice upload batch ID) that groups related traces
- **Causation chain**: Each event in the audit log references the trace ID that caused it → enables navigating from a business event to its full system trace

---

## Alerting Strategy

### Alert Tiers

| Tier | Severity | Response Time | Notification Channel | Example |
|---|---|---|---|---|
| **P0 — Critical** | Data loss risk, financial loss, regulatory violation | 5 minutes | PagerDuty (on-call engineer) + SMS + phone call | Settlement engine down; ledger inconsistency detected; CRAR below regulatory minimum |
| **P1 — High** | Service degradation, SLO breach, fraud spike | 30 minutes | PagerDuty + Slack #incidents | Invoice pipeline latency > 60s; fraud detection false positive rate > 5%; GSTN API outage |
| **P2 — Medium** | Non-critical degradation, approaching thresholds | 4 hours | Slack #alerts | Cache hit rate dropping; queue depth growing; single financier API failure |
| **P3 — Low** | Informational, optimization opportunity | Next business day | Slack #monitoring | Credit model accuracy drift; storage growth exceeding forecast; unused API endpoints |

### Key Alert Rules

```
ALERT: SettlementSagaFailure
  CONDITION: settlement_saga_status == "COMPENSATION_FAILED"
  SEVERITY: P0
  ACTION: Page on-call; halt new settlements to same buyer; investigate

ALERT: LedgerImbalance
  CONDITION: SUM(debits) != SUM(credits) for any transaction_id
  SEVERITY: P0
  ACTION: Page on-call; halt affected settlement partition; audit

ALERT: CapitalAdequacyBreach
  CONDITION: crar_ratio < 0.16
  SEVERITY: P0
  ACTION: Page on-call + compliance team; halt new deal creation if < 0.155

ALERT: FraudDetectionGap
  CONDITION: fraud_detection_service_availability < 0.999 for 5 minutes
  SEVERITY: P1
  ACTION: Hold all new invoice processing in queue until restored

ALERT: DefaultRateSpike
  CONDITION: rolling_30d_default_rate > 0.02
  SEVERITY: P1
  ACTION: Alert risk team; trigger portfolio-wide credit score refresh

ALERT: InvoicePipelineBacklog
  CONDITION: queue_depth > 5000 AND queue_depth_trend == "increasing" for 10 minutes
  SEVERITY: P2
  ACTION: Trigger auto-scaling; alert platform ops

ALERT: GSTNApiDegradation
  CONDITION: gstn_api_p95_latency > 15s OR gstn_api_error_rate > 10%
  SEVERITY: P2
  ACTION: Switch to degraded mode (process without GST verification); alert ops

ALERT: CreditModelDrift
  CONDITION: credit_model_auc < 0.82 (production monitoring)
  SEVERITY: P3
  ACTION: Alert data science team; schedule model retrain
```

### Alert Fatigue Prevention

- **Deduplication**: Same alert fires at most once per 15-minute window per entity
- **Grouping**: Related alerts (e.g., GSTN slow + GST verification backlog) grouped into a single incident
- **Auto-resolution**: Alerts auto-close when the condition is no longer true for 10 minutes
- **Snooze during maintenance**: Scheduled maintenance windows suppress non-critical alerts
- **Escalation only on persistence**: P2 alerts escalate to P1 only if unresolved for 2 hours

---

## Dashboards

### Dashboard 1: Platform Operations

| Panel | Visualization | Data Source |
|---|---|---|
| Invoice Processing Funnel | Funnel chart: Uploaded → OCR'd → GST Verified → Priced → Matched → Funded | Event log aggregation |
| Real-time Queue Depths | Line chart (per pipeline stage) | Message queue metrics |
| Settlement Status | Pie chart: Completed / In Progress / Failed / Pending | Settlement engine state |
| GSTN API Health | Status indicator + latency sparkline | External API monitoring |
| Banking API Health | Per-bank status indicators | Payment service health checks |

### Dashboard 2: Risk & Portfolio

| Panel | Visualization | Data Source |
|---|---|---|
| Portfolio Exposure Heatmap | Heatmap: buyer × industry exposure | Portfolio analytics |
| DPD Distribution | Histogram: 0, 1-30, 31-60, 61-90, 90+ days past due | Settlement tracking |
| Default Rate Trend | Line chart: 30-day rolling default rate vs. target | Settlement events |
| Fraud Detection | Time series: alerts raised, confirmed fraud, false positives | Fraud engine logs |
| Concentration Risk | Bar chart: top 10 buyer exposures as % of portfolio | Portfolio analytics |
| CRAR Gauge | Gauge showing current CRAR vs. regulatory minimum | Real-time calculation |

### Dashboard 3: MSME & Financier Experience

| Panel | Visualization | Data Source |
|---|---|---|
| Time to Disbursement | Percentile chart (p50, p90, p99) | Deal lifecycle events |
| Pricing Trends | Line chart: average rate by buyer rating tier over time | Pricing engine logs |
| Financier Bid Activity | Bar chart: bids placed, accepted, rejected per financier | Auction engine |
| MSME Onboarding Funnel | Funnel: Registered → KYC Started → KYC Approved → First Invoice | Onboarding events |
| API Latency by Endpoint | Percentile table: p50, p95, p99 per endpoint | API gateway metrics |

---

## Runbooks

### Runbook 1: Settlement Saga Stuck in DISBURSEMENT_UNCERTAIN

**Trigger:** Settlement saga remains in DISBURSEMENT_UNCERTAIN state for > 30 minutes.

**Severity:** P0 — financial transaction may be in ambiguous state.

**Steps:**
1. **Identify the saga**: Query `settlement` table for `status = 'DISBURSEMENT_UNCERTAIN' AND initiated_at < NOW() - 30m`
2. **Check bank API**: Query the bank's transfer status API using the `idempotency_key` stored in saga state
   - If bank confirms **success**: Manually advance saga to DISBURSED state; resume normal processing
   - If bank confirms **failure**: Manually advance saga to COMPENSATING state; verify financier limit was released
   - If bank returns **unknown/timeout**: Escalate to bank relationship team; DO NOT retry the transfer (risk of double disbursement)
3. **Verify escrow balance**: Confirm escrow account balance matches expected state (funds should be reserved but not released)
4. **Notify stakeholders**: Alert MSME that disbursement is delayed; alert financier that deal is in review
5. **Resolution**: Once bank status is confirmed, resume saga from the confirmed state. Record resolution in audit log with manual intervention flag.

### Runbook 2: Ledger Debit-Credit Imbalance Detected

**Trigger:** Daily reconciliation detects `SUM(debits) != SUM(credits)` for any transaction_id.

**Severity:** P0 — fundamental financial integrity violation.

**Steps:**
1. **IMMEDIATELY halt new settlements** for the affected settlement partition
2. **Identify the imbalanced transaction**: Query ledger entries by transaction_id; compare debit and credit totals
3. **Check hash chain integrity**: Run hash chain verification from the last known-good checkpoint; if chain is broken, the imbalance may be due to data corruption
4. **Trace the root cause**: Common causes: (a) saga step recorded partial entries (crash between debit and credit), (b) concurrent saga steps wrote conflicting entries, (c) compensating entries didn't fully reverse the original
5. **Create correcting entries**: Append balancing journal entries (NEVER modify existing entries); tag with `correction_type = "MANUAL_ADJUSTMENT"` and link to this incident
6. **Resume operations**: Only after the imbalance is resolved AND hash chain integrity is verified
7. **Post-incident**: Root cause analysis to prevent recurrence; tighten the saga step atomicity guarantee

### Runbook 3: GSTN API Degradation During Filing Season

**Trigger:** GSTN API p95 latency > 15s OR error rate > 10% sustained for 15 minutes.

**Severity:** P1 — invoice verification pipeline backed up.

**Steps:**
1. **Activate degraded mode**: Switch GST verifier to cached-only for previously verified GSTINs; queue new GSTIN lookups
2. **Apply verification-pending surcharge**: All new invoices processed without fresh GST data receive +25-50 bps surcharge (configurable)
3. **Communicate to MSMEs**: Status page update: "GST verification delayed; invoices being processed with provisional pricing"
4. **Monitor GSTN recovery**: Poll GSTN health endpoint every 5 minutes; auto-resume normal mode when p95 < 5s for 10 consecutive checks
5. **Post-recovery backfill**: Process queued GST verifications in priority order (highest-value invoices first); retroactively adjust pricing for invoices where GST verification changes the risk assessment

---

## Incident Playbooks

### Playbook: Major Buyer Default (P0/Business)

**Trigger:** Buyer with > 500 active deals defaults on 3+ invoices simultaneously.

**Response:**
1. **T+0 min**: Credit propagation engine classifies as CRITICAL; automatic repricing begins
2. **T+2 min**: All financiers with exposure > ₹1 crore receive P0 alert with exposure summary
3. **T+5 min**: Platform halts new deal creation against this buyer (circuit breaker)
4. **T+15 min**: Complete repricing of all active deals; updated portfolio risk for all affected financiers
5. **T+30 min**: Insurance team notified; preliminary claim assessment initiated
6. **T+1 hour**: Management briefing with exposure summary, affected financier count, insurance coverage
7. **Ongoing**: Daily updates to affected financiers; weekly regulatory reporting if portfolio NPA rate affected

### Playbook: Suspected Fraud Ring Detection (P1/Security)

**Trigger:** Graph analysis detects cluster of 10+ entities with circular trading pattern; combined exposure > ₹5 crore.

**Response:**
1. **T+0**: Halt all new invoice processing for identified entities (supplier AND buyer roles)
2. **T+15 min**: Fraud operations team reviews graph evidence, corporate relationship data, and transaction patterns
3. **T+1 hour**: If confirmed: freeze existing deals, notify financiers, initiate legal proceedings
4. **T+1 hour**: If inconclusive: release hold on entities with clean secondary evidence; maintain monitoring
5. **T+24 hours**: File STR with FIU-IND for confirmed cases; update fraud detection model with new pattern

### Playbook: Settlement Engine Partition Failure (P0/Infrastructure)

**Trigger:** Settlement partition leader fails health check for > 30 seconds; standby promotion not automatic.

**Response:**
1. **T+0**: Verify partition failure is genuine (not a network partition causing false-positive)
2. **T+1 min**: Manually promote standby if automatic promotion failed
3. **T+2 min**: Verify in-progress sagas resumed correctly; check for sagas in DISBURSEMENT_UNCERTAIN
4. **T+5 min**: Run settlement integrity check: no duplicate disbursements, no orphaned escrow allocations
5. **T+15 min**: Confirm all queue consumers reconnected; verify no message loss
6. **Post-incident**: Investigate why automatic failover didn't trigger; update monitoring

---

## SLO Dashboard Design

### Executive Dashboard (CFO / CRO)

| Panel | Metric | Visualization | Update Frequency |
|---|---|---|---|
| Portfolio Health | CRAR gauge, NPA rate trend, default rate vs. target | Gauge + trend line | Real-time (CRAR); daily (NPA) |
| Transaction Volume | Daily invoices processed, deals created, settlements completed | Bar chart with 30-day trend | Hourly |
| Revenue | Platform fee income, insurance premium income | Cumulative line chart (MTD) | Daily |
| Risk Exposure | Top 10 buyer exposures, industry concentration heatmap | Bar chart + heatmap | Daily |

### Operational Dashboard (Platform Engineering)

| Panel | Metric | Visualization | Update Frequency |
|---|---|---|---|
| Pipeline Health | Queue depth per stage, processing latency p50/p95/p99 | Multi-line chart per stage | 1-minute intervals |
| Settlement Engine | In-flight sagas, compensation rate, saga step latency | Status indicators + histogram | Real-time |
| External Dependencies | GSTN latency, banking API availability, bureau response time | Per-dependency status + sparkline | 30-second intervals |
| Error Budget | SLO burn rate for each service, remaining monthly budget | Burn-down chart per SLO | 5-minute intervals |

### Credit Model Quality Dashboard (Data Science)

| Panel | Metric | Visualization | Update Frequency |
|---|---|---|---|
| Model Performance | Production AUC, calibration curve, Brier score | Time-series + calibration plot | Daily |
| Feature Drift | Distribution shift for top 20 features vs. training baseline | Drift score heatmap | Daily |
| Prediction Distribution | Score distribution for today vs. 30-day historical | Overlapping histogram | Daily |
| Explainability | Average SHAP contribution per feature category | Horizontal bar chart | Weekly |

---

## Anomaly Detection for Financial Metrics

| Metric | Normal Range | Anomaly Detection Method | Alert Action |
|---|---|---|---|
| Deal conversion rate | 55-65% | EWMA with 3-sigma bands; seasonal adjustment for quarter-end | P2 alert if outside bands for 4+ hours |
| Average discount rate | ±50 bps from 30-day rolling mean | Bollinger bands on daily average rate | P2 if rate moves 100+ bps in a day (may indicate model issue or market event) |
| Fraud detection false positive rate | 1.5-3.0% | Control chart with rolling 7-day window | P3 if above 4% (model degradation); P1 if below 0.5% (model may be missing fraud) |
| Settlement saga failure rate | < 0.1% | Statistical process control (SPC) | P1 if failure rate exceeds 0.5% sustained for 1 hour |
| GSTN cache hit rate | 80-95% | Drop detection | P2 if below 70% (cache eviction issue or new buyer surge) |
| Escrow balance drift | ≤ ₹100 between internal and bank | Exact match reconciliation | P0 if any drift > ₹100 (immediate settlement halt) |

---

## AI Observability Standards

This system's AI components MUST implement the observability patterns defined in:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — trace model, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, human review sampling

### Required AI-Specific Metrics
- Model prediction confidence distribution
- Human override rate (target: track, not minimize)
- AI recommendation acceptance rate by decision type
- Drift detection alerts (data drift + concept drift)
- Cost per AI-assisted decision
