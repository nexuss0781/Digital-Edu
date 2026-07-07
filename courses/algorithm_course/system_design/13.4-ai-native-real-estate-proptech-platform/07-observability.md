# 13.4 AI-Native Real Estate & PropTech Platform — Observability

## Observability Philosophy

A real estate AI platform has a unique observability challenge: the ground truth for its primary output (property valuation) is revealed infrequently (only when a property transacts), the physical systems it controls (building HVAC) have multi-hour feedback loops (thermal inertia means a bad setpoint takes 30+ minutes to manifest as discomfort), and the compliance consequences of undetected errors are severe (fair lending violations, building safety failures). The observability architecture must detect model degradation weeks before it manifests in customer complaints, monitor physical building systems in real time while distinguishing genuine anomalies from sensor noise, and maintain audit-quality logs for regulatory examination.

---

## AVM Accuracy Monitoring

### Primary Metrics

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Median Absolute Percentage Error (MdAPE)** | Median of |AVM - sale_price| / sale_price for properties that transact | ≤ 5% (on-market), ≤ 8% (off-market) | > 6% on-market rolling 30-day |
| **Hit rate (±10%)** | Percentage of properties where AVM is within ±10% of sale price | ≥ 85% | < 82% rolling 30-day |
| **Hit rate (±5%)** | Percentage within ±5% | ≥ 60% | < 55% rolling 30-day |
| **Bias (mean signed error)** | Average of (AVM - sale_price) / sale_price; positive = overestimate | 0% ± 1% | |bias| > 1.5% |
| **Geographic bias** | MdAPE variance across metro areas | σ ≤ 2% across metros | Any metro with MdAPE > 12% |
| **Demographic parity** | MdAPE ratio between majority and minority census tracts | ≤ 1.25 | > 1.20 |

### Delayed Ground Truth Handling

AVM accuracy can only be measured when properties transact, creating a 60-90 day feedback loop (from listing to closing to price recording in public records). The observability system handles this by:

1. **Transaction matching pipeline:** Monitors county recorder feeds for new transactions. When a recorded sale matches a property in the valuation universe, the pipeline computes the valuation error (AVM estimate at the time of listing vs. actual sale price) and publishes it to the accuracy tracking system.

2. **Cohort-based monitoring:** Rather than monitoring individual property errors, the system tracks error distributions for transaction cohorts (all properties that sold in a given week). A cohort's MdAPE is meaningful once the cohort has ≥200 transactions (typically 1 week of national data).

3. **Leading indicators (proxy metrics):** Because ground truth is delayed, the platform monitors proxy metrics that correlate with accuracy but are available immediately:
   - **List-to-AVM ratio:** When a new listing price diverges significantly from the AVM estimate (>15%), it may indicate either a mispriced listing or a stale AVM. Tracking the distribution of list-to-AVM ratios over time provides an early signal of market shift that the AVM has not yet captured.
   - **Comparable freshness:** Average age of the nearest comparable sale. If comparable freshness degrades (e.g., median comparable age increases from 4 months to 8 months), valuation accuracy will degrade with a lag.
   - **Feature drift:** Statistical distribution of key features (median home price, price-per-sqft, days on market) compared to the training data distribution. Significant drift triggers proactive model retraining.

---

## Building Intelligence Monitoring

### Sensor Health Metrics

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Sensor liveness** | Percentage of sensors reporting within their expected interval | ≥ 99.5% | < 99% for any building |
| **Sensor data quality** | Percentage of readings passing plausibility checks | ≥ 99.9% | < 99.5% for any building |
| **Edge gateway uptime** | Percentage of time the building edge gateway is responsive | ≥ 99.99% | Any gateway down > 60 seconds |
| **Sensor-to-twin latency (p99)** | Time from sensor reading to digital twin state update | ≤ 5 s | > 10 s |
| **Safety path latency (p99)** | Time from safety sensor trigger to actuator command | ≤ 100 ms | > 80 ms |

### HVAC Optimization Effectiveness

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Energy savings vs. baseline** | Monthly energy consumption compared to rule-based baseline | ≥ 15% savings | < 10% savings for any building |
| **Comfort compliance** | Percentage of occupied hours where zone temperature is within comfort band (68-76°F) | ≥ 95% | < 90% for any zone |
| **Comfort complaints** | Occupant-reported temperature complaints per 1000 occupied hours | ≤ 2 | > 5 for any building |
| **Equipment cycling frequency** | Number of HVAC equipment on/off cycles per hour | ≤ 4 cycles/hour | > 6 cycles/hour (damages equipment) |
| **Demand charge savings** | Reduction in peak 15-minute electrical demand vs. no optimization | ≥ 10% | < 5% |

### Predictive Maintenance Monitoring

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Prediction lead time** | Average days between failure prediction and actual failure | ≥ 14 days | < 7 days (too late for scheduled maintenance) |
| **False positive rate** | Maintenance events triggered by prediction that found no issue | ≤ 10% | > 20% (wastes maintenance resources) |
| **Missed failure rate** | Equipment failures not predicted by the model | ≤ 5% | > 10% |
| **Equipment health score accuracy** | Correlation between predicted health score and actual remaining useful life | r ≥ 0.85 | r < 0.75 |

---

## Property Search Observability

### Search Quality Metrics

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Search latency (p50 / p99)** | End-to-end query execution time | p50 ≤ 50 ms / p99 ≤ 200 ms | p99 > 300 ms |
| **Zero-result rate** | Percentage of searches returning no results | ≤ 2% | > 5% |
| **Click-through rate (CTR)** | Percentage of search results that receive a click | ≥ 15% for position 1-3 | < 10% for position 1 |
| **Long-click rate** | Percentage of clicks where user spends > 30 seconds on listing | ≥ 40% of clicks | < 30% |
| **Listing freshness** | Time from MLS update to searchable in index | ≤ 15 minutes | > 30 minutes |
| **Index coverage** | Percentage of active MLS listings in search index | ≥ 99.5% | < 99% |

### Natural Language Query Understanding

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Query classification accuracy** | Percentage of queries where intent is correctly parsed | ≥ 90% | < 85% |
| **Entity extraction recall** | Percentage of query entities (bedrooms, price, style) correctly extracted | ≥ 95% | < 90% |
| **Query reformulation rate** | Percentage of users who immediately reformulate their query (signal of poor understanding) | ≤ 20% | > 30% |

---

## Lease Intelligence Monitoring

### Extraction Quality Metrics

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Key term extraction F1** | F1 score for top-20 most important clause types (rent, term, parties, escalation) | ≥ 95% | < 93% |
| **Overall extraction F1** | F1 across all 200+ clause types | ≥ 88% | < 85% |
| **Human review rate** | Percentage of lease extractions requiring human review (confidence < 0.9) | ≤ 15% | > 25% |
| **Processing throughput** | Leases processed per hour | ≥ 8 per GPU | < 6 per GPU |
| **Amendment resolution accuracy** | Percentage of amendments correctly composed with base lease | ≥ 90% | < 85% |
| **OCR quality score** | Average character-level confidence from OCR engine | ≥ 0.95 | < 0.90 (indicates poor scan quality batch) |

### Feedback Loop from Human Review

Human reviewers correcting low-confidence extractions provide a continuous ground truth signal:

1. Every correction is logged: original extraction, corrected value, clause type, document characteristics
2. Weekly analysis: if corrections concentrate on specific clause types, the NLP model is fine-tuned on the corrected examples
3. Monthly reporting: extraction accuracy trend by clause type, document format, and OCR quality tier
4. Alert: if human review rate for a specific lease format exceeds 40%, the format may need a dedicated preprocessing rule

---

## Climate Risk Monitoring

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Risk score coverage** | Percentage of parcels with current (< 1 year) risk scores | ≥ 99% | < 98% |
| **Risk score staleness** | Maximum age of any parcel's pre-computed risk score | ≤ 13 months | > 15 months |
| **Hindcast accuracy** | Correlation between predicted flood/fire events and actual FEMA declarations (backtest) | r ≥ 0.70 | r < 0.60 |
| **Climate data freshness** | Lag between latest GCM output release and incorporation into platform | ≤ 90 days | > 180 days |
| **On-demand computation latency** | Custom scenario analysis latency | ≤ 5 s (single property) | > 10 s |

---

## Tenant Screening Monitoring

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Decision latency (p99)** | Time from application submission to screening decision | ≤ 3 s | > 5 s |
| **Approval rate** | Overall application approval rate | Monitored (no target) | Sudden change > 10% in 7 days |
| **Approval rate by demographic group** | Approval rate parity across demographic groups | ≤ 20% disparity | > 15% disparity |
| **Adverse action notice rate** | Percentage of denials with complete adverse action notices | 100% | < 100% |
| **Dispute resolution time** | Time to resolve applicant disputes | ≤ 30 days | > 20 days |

---

## Infrastructure Observability

### System Health Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  Platform Health                                    [HEALTHY]│
├──────────────┬──────────────┬──────────────┬────────────────┤
│  AVM Service │  Bldg IoT    │  Search      │  Lease NLP     │
│  ██████████  │  ██████████  │  ██████████  │  ██████████    │
│  99.95%      │  99.99%      │  99.97%      │  99.9%         │
│  p99: 22s    │  p99: 3s     │  p99: 145ms  │  7.2 min/lease │
├──────────────┴──────────────┴──────────────┴────────────────┤
│  AVM Accuracy (30-day rolling)                              │
│  MdAPE: 4.8%  Hit±10%: 87%  Bias: +0.3%                   │
│  Demographic parity ratio: 1.12  [PASS]                     │
├─────────────────────────────────────────────────────────────┤
│  Building Intelligence (50,000 buildings)                    │
│  Sensors online: 99.7%  Avg savings: 17.2%  Comfort: 96.1% │
│  Safety incidents (30-day): 0  Predictive maint accuracy: 89%│
├─────────────────────────────────────────────────────────────┤
│  Search Quality                                             │
│  QPS: 4,200  CTR-pos1: 18.3%  Zero-result: 1.2%           │
│  Index freshness: 11 min  NLQ accuracy: 92%                │
├─────────────────────────────────────────────────────────────┤
│  Climate Risk                                               │
│  Coverage: 99.4%  Staleness: 8 months  On-demand p99: 3.8s │
└─────────────────────────────────────────────────────────────┘
```

### Key Distributed Traces

| Trace | Spans | Purpose |
|---|---|---|
| On-demand valuation | API gateway → feature fetch → comparable search (ANN) → model ensemble → explainability → compliance check → response | Identify which step contributes most to p99 latency |
| Property search | API gateway → query parse → geo filter → text search → visual search → fusion/rerank → personalization → response | Detect slow retrieval modalities and fusion bottlenecks |
| Lease abstraction | Upload → OCR → layout → clause classification → entity extraction → validation → routing (auto/human) | Monitor GPU utilization and identify processing bottlenecks |
| Building command | Cloud optimizer → API → command signing → edge gateway → protocol translation → actuator → confirmation | End-to-end latency for non-safety building commands |

### Alert Escalation

| Severity | Criteria | Response | Notification |
|---|---|---|---|
| **P0 — Critical** | Building safety system failure; data breach; AVM service down during market hours | Immediate war room; 15-minute response SLA | PagerDuty + phone call to on-call |
| **P1 — High** | AVM accuracy degradation > 2%; search p99 > 500ms; sensor liveness < 98% for any building | 1-hour response; root cause analysis | PagerDuty + messaging channel |
| **P2 — Medium** | Fair lending metric approaching threshold; lease processing backlog > 24h; climate score staleness > 12 months | Same-day investigation | Messaging channel |
| **P3 — Low** | Comparable freshness degradation; minor feature drift; single MLS feed delay | Next business day review | Dashboard highlight |

### Audit Trail Requirements

All of the following are logged to immutable, append-only storage with retention per regulatory requirements:

| Event | Retention | Purpose |
|---|---|---|
| Every AVM computation (input features, model version, output, comparables) | 7 years | ECOA/fair lending examination |
| Every tenant screening decision (input, model version, decision, adverse reasons) | 5 years | FCRA/Fair Housing examination |
| Every building safety event (sensor reading, safety rule evaluation, actuator command) | 10 years | Building code compliance |
| Every command sent to building actuators | 5 years | Building operations audit |
| Every human review correction on lease extraction | 7 years | Model improvement and data quality audit |
| Disparate impact test results | 7 years | Regulatory examination |

---

## Operational Runbooks

### Runbook 1: AVM Accuracy Degradation — Systematic Overvaluation

**Trigger:** Rolling 30-day bias (mean signed error) exceeds +2%, indicating systematic overvaluation.

**Diagnostic steps:**

1. **Geographic decomposition:** Break down bias by metro area. Is the overvaluation concentrated in specific markets, or uniform nationally?
   - If concentrated: likely a local market shift (price correction) that the temporal model has not yet captured. Check: when did the correction start? How many transactions from the correction period are in the training set?
   - If uniform: likely a model-level issue (feature drift, comparable freshness degradation, or spatial model instability)

2. **Comparable freshness check:** What is the median age of comparables used in the overvalued estimates? If comparable freshness has degraded (median age increased from 4 months to 8+ months), the AVM is using stale transaction prices from a higher market.
   - Action: force comparable recency weighting to prioritize transactions from the last 3 months; accept wider confidence intervals from smaller comparable sets

3. **Feature drift analysis:** Compare the distribution of key features (price-per-sqft, days-on-market, inventory levels) between the training data and current observations. If days-on-market has increased significantly (indicating a cooling market), the model may need retraining.
   - Action: trigger emergency model retraining on the most recent 6 months of transactions; deploy as canary

4. **Temporal model lag check:** The temporal market model uses a 30-day rolling window to estimate market momentum. During rapid corrections, the 30-day window smooths out the drop, causing the model to lag reality.
   - Action: reduce temporal model window to 14 days for affected markets; monitor for oscillation

5. **Resolution verification:** After applying fixes, monitor the bias metric for 7 days. If bias returns to ±1%, close the incident. If bias persists, escalate to full model review with retraining.

### Runbook 2: Building IoT Sensor Liveness Drop

**Trigger:** Sensor liveness for a specific building drops below 99% (more than 100 sensors offline in a 10,000-sensor building).

**Diagnostic steps:**

1. **Pattern analysis:** Are offline sensors concentrated on a single floor, a single protocol type (all BACnet, all MQTT), or randomly distributed?
   - Single floor: likely a network switch or gateway port failure on that floor
   - Single protocol: likely a protocol-specific issue (BACnet broadcast storm, MQTT broker overload)
   - Random: likely an edge gateway resource issue (CPU, memory, or disk full)

2. **Edge gateway health check:** Query the gateway's health endpoint. Check CPU utilization, memory usage, disk space, and process uptime. If the gateway process restarted recently, check crash logs.
   - CPU >90%: identify the process consuming resources; likely a stuck safety rule evaluation loop or a sensor flood from a malfunctioning device
   - Memory >95%: likely a memory leak in the protocol translation layer; restart the gateway with monitoring for recurrence
   - Disk full: time-series buffer not flushing to cloud; check cloud connectivity

3. **Sensor-level diagnostics:** For each offline sensor, query the gateway's sensor registry. Check last reading timestamp, last error, and communication status.
   - If sensors report "communication timeout": the physical sensor or its wiring has failed → dispatch maintenance
   - If sensors report "protocol error": firmware mismatch or configuration drift → push updated sensor configuration

4. **Impact assessment:** Determine whether any safety-critical sensors are affected. If smoke detectors, CO sensors, or emergency ventilation sensors are offline, escalate to SEV-1 and activate building safety protocol.

### Runbook 3: Property Search Zero-Result Rate Spike

**Trigger:** Zero-result rate exceeds 5% (rolling 1-hour window), indicating that users are submitting searches that return no results.

**Diagnostic steps:**

1. **Query analysis:** Sample 100 zero-result queries. Categorize by failure reason:
   - Geographic scope too narrow + price too low (no properties exist in that price range in that area)
   - Natural language query misinterpretation (NLQ model extracted wrong intent)
   - Index gap (properties exist but are not indexed — MLS feed issue)
   - Overly restrictive filters (6BR + pool + ocean view + under $300K)

2. **NLQ model check:** If >30% of zero-result queries are caused by misinterpretation, check the NLQ model's query classification accuracy. Compare against the 90% target.
   - Action: review recent model changes; consider rollback if accuracy dropped after a deployment

3. **Index freshness check:** Query each MLS feed's last ingestion timestamp. If any major feed is >30 minutes stale, new listings in that MLS's geography are missing from search results.
   - Action: restart stalled ingestion worker; alert data engineering

4. **Filter relaxation suggestion:** For searches with overly restrictive filters, the search API should suggest relaxed alternatives ("No results for 6BR under $300K in this area. Here are 5BR homes under $350K.")
   - Check if the relaxation suggestion feature is enabled and functioning

---

## SLO Burn Rate Monitoring

### Error Budget Calculation

| SLO | Monthly Target | Monthly Error Budget | Burn Rate Alert (2x) | Burn Rate Alert (10x) |
|---|---|---|---|---|
| AVM on-demand p99 ≤ 30s | 99.9% | 43 minutes (of requests exceeding SLO) | 2x = burning budget in 15 days | 10x = burning budget in 3 days |
| Property search p99 ≤ 200ms | 99.95% | 22 minutes | 2x = 11 days | 10x = 2.2 days |
| Building safety p99 ≤ 100ms | 99.999% | 26 seconds | 2x = 13 seconds | 10x = 2.6 seconds |
| Sensor ingestion p99 ≤ 500ms | 99.9% | 43 minutes | 2x = 15 days | 10x = 3 days |
| Lease extraction ≥ 95% F1 | Per-batch | N/A (quality metric) | F1 < 94% triggers review | F1 < 90% triggers rollback |

### Multi-Window Burn Rate

For each SLO, the monitoring system tracks burn rate over three windows simultaneously:

- **1-hour window:** Detects acute incidents (sudden spikes). Alert threshold: 14.4x burn rate (consuming the entire monthly budget in 5 hours).
- **6-hour window:** Detects sustained degradation. Alert threshold: 6x burn rate (consuming budget in 5 days).
- **3-day window:** Detects slow drift. Alert threshold: 2x burn rate (consuming budget in 15 days).

An alert fires only when BOTH a short-window threshold AND a longer-window threshold are exceeded simultaneously. This prevents alerting on brief spikes that self-resolve while still catching sustained issues early.

---

## Cross-Subsystem Correlation Dashboard

The most valuable observability signal in the PropTech platform is cross-subsystem correlation—detecting when degradation in one subsystem causes downstream effects in another.

| Upstream Signal | Downstream Effect | Correlation | Response |
|---|---|---|---|
| MLS feed staleness ↑ | Search listing freshness ↑ + AVM comparable freshness ↑ | Direct (minutes) | Alert at feed level; do not duplicate alerts for search and AVM |
| Satellite image processing backlog ↑ | Property condition scores become stale → AVM accuracy degrades | Delayed (weeks) | Monitor backlog as leading indicator for AVM accuracy |
| Edge gateway CPU ↑ | Sensor liveness ↓ → Digital twin stale → HVAC optimization degraded | Direct (seconds) | Alert at gateway level; suppress downstream twin and optimizer alerts |
| Entity resolution merge batch | AVM recomputation queue spike → on-demand AVM latency ↑ | Direct (hours) | Schedule merge batches during off-peak AVM hours; monitor queue depth |
| Climate data refresh | Climate risk score changes → Climate-adjusted valuation changes → Lender portfolio LTV alerts | Delayed (days) | Pre-notify lending partners of upcoming climate data refresh schedule |

---

## Entity Resolution Quality Monitoring

Entity resolution errors are the highest-leverage observability target because they cascade into every downstream subsystem. Dedicated monitoring:

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **New canonical creation rate** | Percentage of incoming records creating new canonical properties (vs. merging with existing) | 1-3% | >5% (creating duplicates) or <0.5% sustained (over-merging) |
| **Merge confidence distribution** | Distribution of match scores for accepted merges | p10 ≥ 0.90 | p10 < 0.85 (accepting low-quality matches) |
| **Human review queue depth** | Records pending human review (match score between 0.70-0.95) | ≤ 5,000 | > 10,000 (review capacity insufficient) |
| **Post-merge revert rate** | Percentage of merges that are later manually reversed | ≤ 0.1% | > 0.5% (merge model quality degrading) |
| **Per-feed match quality** | Entity resolution accuracy broken down by source MLS feed | F1 ≥ 0.98 per feed | Any feed with F1 < 0.95 |

### Entity Resolution Audit Trail

Every merge, split, and new-entity-creation decision is logged with full provenance:

```
{
  "action": "MERGE",
  "canonical_id": "uuid-canonical",
  "incoming_record": { "source": "MLS_NWMLS", "id": "2847391" },
  "matched_to": { "source": "TAX_KING_CO", "id": "732104-0290" },
  "match_score": 0.97,
  "match_features": {
    "address_similarity": 0.95,
    "geocode_distance_m": 4.2,
    "sqft_difference_pct": 2.1,
    "year_built_match": true
  },
  "decision_method": "AUTO_MERGE (score >= 0.95)",
  "timestamp": "2026-03-10T04:15:22Z"
}
```

This audit trail enables post-hoc analysis of entity resolution errors and supports regulatory examination of how property records were constructed.

---

## Model Performance Drift Detection

### Feature Importance Stability Monitoring

The AVM ensemble's feature importance rankings should be relatively stable between training cycles. A sudden shift in feature importance (e.g., "year_built" jumping from 5th to 1st) may indicate:

- **Data quality issue:** A batch of records with corrupted year_built values is biasing the model
- **Market regime shift:** The market is now strongly favoring new construction (legitimate signal)
- **Feature engineering bug:** A derived feature is computing differently due to a code change

The monitoring system tracks the top-20 feature importance rankings across model versions and alerts when any feature's rank changes by more than 5 positions, providing the ML team with immediate context for investigation.

### Comparable Selection Quality Dashboard

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Appraiser agreement** | Percentage of AVM comparables that overlap with professional appraiser selections for the same property | ≥ 80% (3 of top-5 match) | < 75% rolling 30-day |
| **Comparable diversity** | Average geographic spread of selected comparables (median pairwise distance) | 0.2 - 2.0 miles | > 5 miles (too spread) or < 0.05 miles (all from same building) |
| **Comparable freshness** | Median age of selected comparables' sale dates | ≤ 6 months | > 9 months |
| **Embedding space coverage** | Percentage of property types represented in the comparable embedding training set | ≥ 95% of property types | Any property type with <100 training examples |

---

## Climate Risk Model Validation Dashboard

The climate risk model's outputs are inherently forward-looking and cannot be validated against current events. Instead, the platform uses hindcast validation and internal consistency checks:

| Metric | Definition | Target | Alert |
|---|---|---|---|
| **Hindcast flood accuracy** | For FEMA-declared flood events in the last 20 years, percentage of properties in the declared disaster area that had above-median flood scores | ≥ 75% | < 65% |
| **Hindcast wildfire accuracy** | For Cal Fire and USFS fire perimeters in the last 20 years, percentage of burned parcels with above-median wildfire scores | ≥ 70% | < 60% |
| **GCM ensemble agreement** | For each parcel, the coefficient of variation across the 6 GCM models' risk scores | CV ≤ 0.40 for ≥ 80% of parcels | CV > 0.50 for >30% of parcels (ensemble is too uncertain) |
| **Score temporal consistency** | Year-over-year change in risk scores (absent new climate data) should be minimal | ≤ 5% of parcels change by >1 point | > 10% of parcels change by >1 point (methodology instability) |
| **Building attribute coverage** | Percentage of parcels with complete building attributes for vulnerability assessment | ≥ 85% | < 80% (vulnerability model relying on defaults too often) |

---

## Lease Processing Pipeline Monitoring

### Per-Stage GPU Utilization

```
┌──────────────────────────────────────────────────────────┐
│  Lease Pipeline GPU Utilization (24-hour view)           │
├──────────────────────────────────────────────────────────┤
│  OCR Engine (2 GPUs):       █████████████░░░░░  72%      │
│  Layout Analysis (1 GPU):   ████████░░░░░░░░░░  45%      │
│  Clause Classifier (2 GPUs):█████████████████░  88%      │
│  Entity Extractor (1 GPU):  ████████████░░░░░░  62%      │
│  Satellite Analysis (2 GPUs):██████░░░░░░░░░░░  35%      │
├──────────────────────────────────────────────────────────┤
│  Queue Depth: 47 leases | Processing Rate: 8.2/GPU/hr   │
│  Backlog ETA: 2.4 hours | Human Review Queue: 12 leases │
└──────────────────────────────────────────────────────────┘
```

### Extraction Accuracy Trend Monitoring

The system tracks per-clause-tier accuracy on a rolling 30-day window, with separate tracking for new-format leases (never-before-seen layouts) vs. familiar formats:

| Clause Tier | Familiar Format F1 | New Format F1 | Delta | Action |
|---|---|---|---|---|
| **Tier 1 (financial)** | 99.2% | 94.1% | -5.1% | New formats routed to dual-model confirmation |
| **Tier 2 (legal)** | 96.8% | 89.3% | -7.5% | Acceptable; new formats need more human review |
| **Tier 3 (administrative)** | 93.1% | 86.7% | -6.4% | Acceptable; auto-approve threshold raised for new formats |

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
