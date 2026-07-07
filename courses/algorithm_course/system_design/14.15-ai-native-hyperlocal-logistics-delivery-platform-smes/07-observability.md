# 14.15 AI-Native Hyperlocal Logistics & Delivery Platform for SMEs — Observability

## Observability Philosophy

A hyperlocal delivery platform has a unique observability challenge: the system's "correctness" is defined by physical-world outcomes (packages arriving on time) that are measured minutes after the decisions that caused them (matching, routing, pricing). By the time you observe a late delivery, the matching decision that caused it happened 30 minutes ago. Effective observability must therefore focus on **leading indicators** (predictive metrics that signal future problems) rather than only **lagging indicators** (delivery outcomes).

---

## Core Metrics

### Delivery Funnel Metrics

| Metric | Definition | Target | Alert Threshold |
|---|---|---|---|
| **Order Creation Rate** | Orders submitted per minute per city | Varies by time/city | > 2σ deviation from predicted (demand anomaly) |
| **Price Acceptance Rate** | Orders confirmed / orders priced | > 70% | < 60% for 15 min (pricing too aggressive) |
| **Matching Success Rate** | Orders assigned within 45s / orders confirmed | > 95% | < 90% for 10 min |
| **First-Offer Acceptance** | Rider accepts first dispatch offer | > 80% | < 70% for 30 min |
| **Pickup Time** | Time from rider assignment to package collected | < 15 min (p50) | p95 > 25 min |
| **On-Time Delivery Rate** | Delivered before customer-facing ETA | > 90% | < 85% for 1 hour |
| **Delivery Completion Rate** | Successfully delivered / total dispatched | > 97% | < 95% for 1 hour |
| **Customer Rating** | Post-delivery star rating | > 4.3 / 5.0 | < 4.0 for rolling 24h |

### Matching Engine Metrics

| Metric | Definition | Target | Alert Threshold |
|---|---|---|---|
| **Batch Window Utilization** | Orders per batch window | 5-20 orders | < 2 (underbatching) or > 50 (overload) |
| **Solver Time** | Time to solve bipartite assignment | < 500ms (p95) | > 1s for 5 min |
| **Assignment Quality Score** | Weighted sum of proximity, capacity, fairness scores | > 0.7 normalized | < 0.5 for 10 min |
| **Dead Mile Ratio** | Rider travel without package / total travel | < 15% | > 20% for 1 hour |
| **Shadow Activation Rate** | Shadow assignments used (primary rider rejected) | < 20% | > 30% for 30 min |
| **Rejection Cascade Depth** | Sequential rejections before acceptance | < 2 (p95) | p95 > 3 for 30 min |

### Route Optimizer Metrics

| Metric | Definition | Target | Alert Threshold |
|---|---|---|---|
| **Solver Invocations/min** | Route optimization requests per minute | Monitor, no target | > 2× expected (runaway re-optimization) |
| **Solution Quality (Gap)** | (heuristic_cost - lower_bound) / lower_bound | < 10% | > 20% sustained |
| **Insertion Success Rate** | New orders successfully inserted into active routes | > 70% of batch-eligible | < 50% (routes too tight) |
| **Time Window Slack** | Minimum remaining time window across batched orders | > 10 min (p25) | p25 < 5 min (cascade risk) |
| **Re-optimization Frequency** | Route changes per active delivery | < 3 | > 5 (instability) |

### ETA Engine Metrics

| Metric | Definition | Target | Alert Threshold |
|---|---|---|---|
| **ETA MAE** | Mean absolute error (predicted vs. actual) | < 4 minutes | > 6 min for rolling 1 hour |
| **ETA Bias** | Mean signed error (positive = late, negative = early) | ±1 minute | > +3 min (systematic underestimate) |
| **On-Time Calibration** | % of deliveries within customer-facing ETA | 88-92% | < 85% or > 97% (under/over-promising) |
| **ETA Spread** | p95 - p50 of prediction distribution | < 8 minutes | > 12 min (model uncertain) |
| **Dwell Time Prediction Error** | Predicted vs. actual time at pickup/dropoff | < 3 min MAE | > 5 min for specific merchant cluster |

### Location Pipeline Metrics

| Metric | Definition | Target | Alert Threshold |
|---|---|---|---|
| **Ingestion Throughput** | Location updates processed per second | Tracks active riders | > 10% drop (rider app issue or network) |
| **Ingestion Latency** | Time from GPS reading to geospatial index update | < 500ms (p95) | > 1s for 3 min |
| **GPS Accuracy Distribution** | Reported accuracy of GPS readings | p50 < 15m | p50 > 30m (device quality degradation) |
| **Map Match Confidence** | Confidence score of road-segment matching | > 0.8 (p50) | < 0.6 for specific zone (map data issue) |
| **Geofence Trigger Accuracy** | Geofence events matching actual rider presence | > 95% | < 90% (geofence or GPS issue) |
| **Location Gap Rate** | Riders with > 30s GPS silence / active riders | < 5% | > 10% (network or app issue) |

### Fleet Economics Metrics

| Metric | Definition | Target | Alert Threshold |
|---|---|---|---|
| **Rider Utilization** | Time carrying package / total active time | > 60% | < 50% for 1 hour (oversupply or poor matching) |
| **Rider Earnings/Hour** | Average rider earnings per active hour | > $3.50 equivalent | < $2.50 (supply retention risk) |
| **Cost Per Delivery** | Total platform cost / deliveries completed | < $0.50 | > $0.70 (economics breaking) |
| **Surge Zone Coverage** | % of surge zones with ≥ 1 rider within 5 min | > 80% | < 60% (pre-positioning failure) |
| **Batch Rate** | % of deliveries in multi-stop batches | > 40% | < 25% (batching algorithm or demand issue) |
| **Demand Forecast MAPE** | Mean absolute percentage error of zone forecasts | < 20% | > 30% for 2 hours |
| **EV Utilization** | % of short-range deliveries served by EVs | > 30% | < 15% (EV fleet underutilized) |

---

## SLO-Based Dashboards

### SLO Burn Rate Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ SLO Burn Rate Monitor — March 2026                          │
├─────────────┬──────────┬───────────┬────────────┬──────────┤
│ SLO         │ Budget   │ Consumed  │ Burn Rate  │ Status   │
├─────────────┼──────────┼───────────┼────────────┼──────────┤
│ Avail 99.95%│ 21.6 min │  4.2 min  │  0.8× norm │ ✓ OK     │
│ On-Time 90% │ 1.5M     │  312K     │  0.9× norm │ ✓ OK     │
│ Assign <45s │ 37.5K    │  28.1K    │  3.2× norm │ ⚠ WARN   │
│ ETA <4min   │ Cont.    │ MAE=3.8   │  1.1× norm │ ✓ OK     │
│ Track <5s   │ 5%       │  2.1%     │  0.7× norm │ ✓ OK     │
├─────────────┴──────────┴───────────┴────────────┴──────────┤
│ ⚠ Assignment latency burning at 3.2× — 75% of monthly     │
│   budget consumed by day 15. Action: investigate matching   │
│   engine capacity in Delhi partition.                       │
└─────────────────────────────────────────────────────────────┘
```

### City Operations Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ BANGALORE — Live Operations                      14:32 IST  │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ Active   │ Active   │ Orders   │ On-Time  │ Avg ETA        │
│ Orders   │ Riders   │ /min     │ Rate     │ Error          │
│  2,847   │  4,291   │   47.2   │  91.3%   │  3.2 min       │
│          │ (412 EV) │          │          │                │
├──────────┴──────────┴──────────┴──────────┴────────────────┤
│ Zone Heatmap                                                │
│ ┌─────────────────────────────────────────────────────┐    │
│ │  [Supply-Demand Ratio by Zone]                       │    │
│ │  Red: SD < 0.5   Yellow: 0.5-1.0   Green: > 1.0    │    │
│ └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│ Matching Health          │ Fleet Economics                   │
│ Batch solve: 340ms avg   │ Dead miles: 12.4%                │
│ Acceptance: 83%          │ Batch rate: 44%                  │
│ Shadow activations: 14%  │ Rider earnings: $4.10/hr         │
│ Queue depth: 3           │ Cost/delivery: $0.38             │
│ Back-pressure: Level 0   │ EV delivery %: 28%               │
├──────────────────────────┴──────────────────────────────────┤
│ Alerts: [P2] ETA bias +2.3min in Koramangala zone           │
│         [P3] Forecast MAPE 24% — above target               │
│         [P3] EV utilization 18% — below 30% target          │
└─────────────────────────────────────────────────────────────┘
```

### ML Model Performance Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ Model Performance — Rolling 24h                             │
├──────────────────────┬──────────────────────────────────────┤
│ Demand Forecast      │ ETA Prediction                       │
│ MAPE: 18.2%         │ MAE: 3.4 min                        │
│ Trend: improving    │ Bias: +0.8 min (slight late)        │
│ Worst zone: HSR     │ Calibration: 90.1% on-time          │
│  (MAPE 31%)         │ Worst segment: dwell time            │
├──────────────────────┼──────────────────────────────────────┤
│ Acceptance Model     │ Dynamic Pricing                      │
│ AUC: 0.83           │ Revenue/delivery: $3.82              │
│ Calibration: good   │ Surge activations: 23% of zones      │
│ Feature drift: none │ Avg multiplier: 1.18                │
│                      │ Rider supply response: 12 min       │
├──────────────────────┼──────────────────────────────────────┤
│ Carbon Scoring       │ EV Range Prediction                  │
│ Avg CO2/delivery:    │ Range prediction error:              │
│  62g (↓12% MoM)     │ MAE: 1.2 km                         │
│ EV share: 28%       │ Charge events/day: 340              │
│ Target: 50g by Q4   │ Mid-shift charges: 12%              │
└──────────────────────┴──────────────────────────────────────┘
```

---

## Distributed Tracing

### Order Lifecycle Trace

Every order generates a trace spanning its entire lifecycle:

```
Trace: order_abc123
├── [0ms] order.created (Order Service)
│   └── attributes: merchant_id, pickup_zone, dropoff_zone, package_type
├── [50ms] price.computed (Pricing Service)
│   └── attributes: base_fee, surge_multiplier, zone_sd_ratio
├── [2100ms] order.confirmed (Order Service)
├── [2200ms] matching.batch_entered (Matching Engine)
│   └── attributes: batch_window_id, orders_in_batch
├── [32500ms] matching.scored (Matching Engine)
│   └── attributes: candidates_evaluated, top_score, assignment_method, ev_considered
├── [33000ms] matching.assigned (Matching Engine)
│   └── attributes: rider_id, dead_miles, score_breakdown, vehicle_type
├── [35000ms] dispatch.offered (Rider App)
├── [42000ms] dispatch.accepted (Rider App)
│   └── attributes: response_time_ms
├── [45000ms] route.optimized (Route Optimizer)
│   └── attributes: waypoints, total_distance, solver_time_ms, batch_size
├── [180000ms] geofence.pickup_arrived (Location Pipeline)
├── [420000ms] pickup.completed (Rider App)
│   └── attributes: dwell_time_sec
├── [900000ms] eta.updated (ETA Engine)
│   └── attributes: new_p50, new_p85, trigger_reason
├── [1800000ms] geofence.near_dropoff (Location Pipeline)
├── [1920000ms] pod.submitted (Rider App)
│   └── attributes: photo_validated, gps_match, otp_verified
├── [1925000ms] order.delivered (Order Service)
│   └── attributes: total_time_min, eta_error_min, batch_size, co2_grams
└── [1930000ms] carbon.recorded (Carbon Scorer)
    └── attributes: vehicle_type, distance_km, co2_grams
```

### Matching Decision Audit Trail

Every matching decision is logged with full context for post-hoc analysis:

```
MatchingDecision {
  batch_window_id: "bw_20260310_143000_BLR"
  timestamp: "2026-03-10T14:30:30Z"
  orders_in_batch: 12
  candidates_evaluated: 487
  ev_riders_available: 82
  assignments: [
    {
      order_id: "ord_abc123",
      rider_id: "rdr_xyz789",
      score: 0.82,
      score_breakdown: {
        proximity: 0.91,
        capacity: 1.00,
        acceptance_prob: 0.78,
        fairness: 0.65,
        time_feasibility: 0.88,
        ev_bonus: 0.05
      },
      dead_miles: 1.2,
      vehicle_type: "EV_MOTORCYCLE",
      shadow_rider: "rdr_backup456",
      shadow_score: 0.71
    }
  ]
  solver_time_ms: 340
  unmatched_orders: 0
  solution_quality_gap: 0.04
}
```

---

## Incident Playbooks

### Playbook 1: On-Time Rate Below 85% (P1)

**Detection**: On-time delivery rate < 85% for rolling 1 hour in any city.

**Triage steps**:
1. Check ETA bias (Grafana: ETA Engine dashboard). If bias > +5 min → ETA model issue, not operational.
2. Check dead mile ratio. If > 25% → matching degradation.
3. Check rider acceptance rate. If < 65% → pricing or dispatch quality issue.
4. Check zone-level breakdown. If localized to 1-2 zones → zone-specific supply issue.

**Remediation**:
- ETA model issue: Bump promise buffer from p85 to p90 (buys time). Trigger model retrain.
- Matching degradation: Check solver latency, geospatial index freshness. Restart matching engine if needed.
- Supply issue: Enable aggressive repositioning nudges. Increase surge in affected zones by 0.3×.
- Zone-specific: Send targeted push notifications to offline riders near the zone.

**Escalation**: If not resolved in 30 minutes → P0 escalation to engineering lead.

### Playbook 2: Matching Queue Growing (P1)

**Detection**: Matching queue depth > 100 orders sustained for 5 minutes.

**Triage steps**:
1. Check solver latency. If p95 > 5s → solver overloaded.
2. Check order rate. If > 3× normal → demand spike (expected or anomalous?).
3. Check matching engine health. If instance count < expected → infrastructure issue.

**Remediation**:
- Solver overload: Activate back-pressure Level 1 (reduce ALNS budget to 500ms).
- Demand spike: Activate back-pressure Level 2 if needed (greedy dispatch).
- Instance failure: Check auto-scaling. Manual instance addition if auto-scale delayed.

**Resolution**: Queue depth < 20 for 10 minutes.

### Playbook 3: Location Pipeline Lag > 30s (P1)

**Detection**: Stream processor consumer lag > 30 seconds sustained.

**Triage steps**:
1. Check ingestion throughput. If normal → processing Slowest part of the process. If spiked → rider app burst.
2. Check stream processor CPU/memory. If maxed → scale up.
3. Check geospatial index write latency. If spiked → index issue.

**Remediation**:
- Processing Slowest part of the process: Add stream processor partitions. Enable sampling (process every 2nd update).
- Rider app burst: Increase rider report interval to 5 seconds via API response.
- Index issue: Failover to replica. Rebuild primary index.

**Impact management**: Matching engine uses 30s-stale positions (acceptable). Tracking shows stale indicator.

### Playbook 4: GPS Spoofing Cluster Detected (P2)

**Detection**: Fraud service flags > 5 riders in a zone with GPS-accelerometer mismatch.

**Triage steps**:
1. Verify flag: check cell tower triangulation for flagged riders.
2. Check POD photos: AI validation confidence scores for recent deliveries.
3. Cross-reference: are flagged riders linked (same device IMEI family, same onboarding batch)?

**Remediation**:
- Confirmed spoofing: Move riders to verification-required mode. Suspend delivery assignments.
- False positive: Investigate detection model. May be a GPS-challenged zone (tunnels, dense buildings).
- Systemic: Update spoofing detection model with new confirmed cases.

### Playbook 5: EV Fleet Range Emergency (P2)

**Detection**: > 10% of EV riders have SOC < 15% during peak hours.

**Triage steps**:
1. Check charging station availability. If all slots full → capacity issue.
2. Check route lengths. If average delivery distance increased → demand pattern shift.
3. Check weather. Cold weather reduces battery range.

**Remediation**:
- Station capacity: Disable EV-first preference temporarily. Shift EV riders to shorter routes only.
- Demand shift: Adjust range buffer from 20% to 30% for remainder of peak.
- Cold weather: Apply weather-adjusted range model. Reduce EV assignment radius.

---

## Alerting Strategy

### Severity Levels

| Level | Criteria | Response Time | Examples |
|---|---|---|---|
| **P0 — Critical** | Service down, orders cannot be processed | < 5 min | Matching engine crash, order DB failure, all-city outage |
| **P1 — Major** | Significant degradation, SLO breach imminent | < 15 min | On-time rate < 80%, matching latency > 2 min, location pipeline lag |
| **P2 — Minor** | Degradation visible but not customer-impacting | < 1 hour | ETA accuracy drop, solver quality degradation, single-zone supply shortage |
| **P3 — Informational** | Anomaly detected, trend concerning | Next business day | Forecast accuracy declining, rider churn increasing, cost per delivery rising |

### Alert Routing

```
P0 → On-call engineer (page) + Engineering lead + City operations
P1 → On-call engineer (page) + City operations
P2 → On-call engineer (notification) + Team channel
P3 → Weekly operations review dashboard
```

### Composite Alerts (Leading Indicators)

| Alert | Components | Indicates |
|---|---|---|
| **Delivery Quality Degradation** | On-time rate dropping + ETA bias increasing + rider utilization > 80% | Fleet undersupply; need surge pricing or repositioning |
| **Matching Breakdown** | Rejection rate rising + dead miles increasing + solver time increasing | Model drift in acceptance prediction; retrain needed |
| **Demand Shock** | Order rate > 3σ above forecast + surge multiplier at cap + matching queue growing | Unexpected demand event; manual fleet activation needed |
| **Location Pipeline Stress** | Ingestion latency rising + GPS gap rate increasing + geofence accuracy dropping | Infrastructure issue or rider app version problem |
| **Economic Health Warning** | Cost per delivery rising + rider earnings falling + batch rate declining | Platform economics deteriorating; review pricing model |
| **Sustainability Regression** | EV delivery % dropping + CO2/delivery rising + EV fleet offline rate high | EV fleet operational issue; check charging infrastructure |

---

## Log Strategy

### Structured Log Schema

```
{
  "timestamp": "2026-03-10T14:32:15.123Z",
  "level": "INFO",
  "service": "matching-engine",
  "city": "BLR",
  "trace_id": "tr_abc123",
  "span_id": "sp_def456",
  "event": "batch_assignment_completed",
  "attributes": {
    "batch_window_id": "bw_20260310_143000_BLR",
    "orders_matched": 12,
    "orders_unmatched": 0,
    "solver_time_ms": 340,
    "candidates_evaluated": 487,
    "avg_assignment_score": 0.78,
    "ev_assignments": 3
  }
}
```

### Log Retention

| Log Category | Hot Storage | Warm Storage | Cold Storage |
|---|---|---|---|
| **Order lifecycle events** | 7 days | 30 days | 1 year |
| **Matching decisions** | 7 days | 30 days | 90 days |
| **Location pipeline** | 3 days | 14 days | 30 days |
| **API access logs** | 7 days | 30 days | 90 days |
| **Security events** | 30 days | 90 days | 2 years |
| **ML model predictions** | 7 days | 30 days | 90 days (for retraining) |
| **Fraud detection events** | 30 days | 180 days | 2 years |

---

## Health Checks

### Service Health Matrix

| Service | Health Check Method | Frequency | Timeout | Failure Action |
|---|---|---|---|---|
| **Order Service** | Transaction: create + read dummy order | 10 sec | 3 sec | Alert P0, traffic reroute |
| **Matching Engine** | Score a synthetic order against dummy riders | 15 sec | 5 sec | Alert P0, activate passive |
| **Route Optimizer** | Solve a 3-stop TSP with known answer | 30 sec | 5 sec | Alert P1, fallback to Practical rule of thumb |
| **ETA Engine** | Predict ETA for fixed input, check variance | 30 sec | 2 sec | Alert P2, serve cached ETAs |
| **Location Ingestion** | Inject synthetic location, verify in index | 10 sec | 2 sec | Alert P0, check stream processor |
| **Tracking Engine** | Subscribe to test order, verify push | 15 sec | 3 sec | Alert P1, enable polling fallback |
| **Demand Forecaster** | Generate forecast, check bounds | 5 min | 10 sec | Alert P2, use previous forecast |
| **Geospatial Index** | Radius query on known data | 5 sec | 1 sec | Alert P0, check replicas |
| **Fraud Detection** | Score synthetic GPS trajectory | 60 sec | 5 sec | Alert P2, flag for manual review |
| **Carbon Scorer** | Compute emission for test delivery | 60 sec | 2 sec | Alert P3, use default estimates |

---

## Operational Runbooks

### Runbook 1: Rider Supply Crunch (Available Riders < 50% of Demand)

**Symptoms**: Matching queue growing, assignment latency > 60s, dead-mile ratio rising.

**Diagnostic Steps**:
1. Check rider online count vs. historical same-hour same-day count
2. Compare weather conditions (rain reduces rider supply 20-30%)
3. Check if surge pricing is active (it should be attracting riders)
4. Verify no rider app crash (check app crash rate in monitoring)
5. Check for competing platform promotions (riders may have switched temporarily)

**Actions**:
- If weather-related: confirm rain speed factors are active in ETA engine; widen matching radius to 5 km; increase surge cap temporarily to 3.0×
- If app-related: trigger emergency hotfix pipeline; send SMS blast to riders with app update link
- If competition-related: no system action; escalate to operations for incentive response

### Runbook 2: ETA Systematic Bias (Mean Error > +5 Minutes for 2+ Hours)

**Symptoms**: On-time rate dropping; customer complaints about late delivery increasing.

**Diagnostic Steps**:
1. Break down error by component: travel time vs. dwell time vs. first-mile delay
2. Check if bias is zone-specific or city-wide
3. If city-wide: check for traffic data provider issues or road closures
4. If zone-specific: check for construction, event, or merchant-specific dwell time changes
5. Check ETA model age (when was the last retraining?)

**Actions**:
- Immediate: increase promise buffer percentile from p85 to p90
- Short-term: trigger automated model retraining with last 7 days of data
- If traffic data provider issue: switch to platform's own rider-derived speed data as primary source
- If merchant dwell time changed: flag specific merchants for dwell time model update

### Runbook 3: Geospatial Index Read Latency Spike (p99 > 10ms)

**Symptoms**: Matching engine slowing down; tracking updates becoming stale.

**Diagnostic Steps**:
1. Check memory utilization on index nodes (GC pressure?)
2. Check write throughput (location update rate higher than normal?)
3. Check if a rebuild is in progress (scheduled or forced)
4. Compare against replica latency (is the issue on primary or all nodes?)

**Actions**:
- If memory pressure: trigger emergency GC; if ineffective, restart index node (failover to replica during restart)
- If write overload: activate location update throttling (reduce from 3s to 5s interval)
- If rebuild in progress: wait for completion (typically < 30s); if rebuild stalls, kill and restart
- If replica divergence: force replica rebuild from primary's stream

---

## AI Observability Standards

This system's AI components MUST implement the observability patterns defined in:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — trace model, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, human review sampling

### Required AI-Specific Metrics
- AI resolution rate (queries handled without human escalation)
- Escalation rate and top escalation reasons
- End-to-end action latency (request to AI-completed action)
- Policy violation attempt rate (actions blocked by guardrails)
- User satisfaction score for AI-handled interactions
