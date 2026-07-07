# 13.2 AI-Native Logistics & Supply Chain Platform — Observability

> The logistics platform has four distinct observability audiences: engineering, operations, planning, and compliance. Each requires purpose-built dashboards with domain-specific metrics that cannot be derived from infrastructure counters alone.

---

## Observability Philosophy

The logistics platform has four distinct observability audiences with fundamentally different concerns:

1. **Engineering teams**: Ingestion throughput, solver latency, infrastructure health, pipeline lag
2. **Operations teams**: On-time delivery rates, route efficiency, warehouse productivity, fleet utilization
3. **Supply chain planners**: Forecast accuracy, inventory health, demand anomalies, disruption impact
4. **Compliance teams**: Cold chain compliance rates, driver HOS violations, audit trail completeness, regulatory SLA adherence

Each audience needs purpose-built dashboards. Raw infrastructure metrics (CPU utilization, stream lag) are necessary but insufficient—the system must emit business-semantic metrics from within application logic: "delivery SLA breach rate" cannot be computed from infrastructure counters alone.

---

## Key Metrics

### Delivery Performance Metrics (Operations)

| Metric | Description | Alert Threshold |
|---|---|---|
| **On-time delivery rate (OTD)** | % of shipments delivered within the SLA window | < 95% per carrier or per lane (sustained 24h) |
| **ETA accuracy (MAE)** | Mean absolute error between predicted and actual arrival time | > 60 min MAE for road shipments; > 4h for ocean |
| **Route plan adherence** | % of stops visited in the planned sequence (no skips or resequencing) | < 85% (indicates poor route quality or driver non-compliance) |
| **Delivery exception rate** | % of deliveries with exceptions (damaged, refused, address error) | > 5% for a single carrier or depot |
| **Average stops per route** | Route density indicating optimization effectiveness | < 12 stops/route for urban delivery (under-utilization) |
| **Vehicle utilization** | % of vehicle capacity (weight or volume) used per route | < 60% sustained (indicates consolidation opportunity) |
| **Proof-of-delivery capture rate** | % of deliveries with photo/signature POD | < 90% (compliance or app adoption issue) |
| **Last-mile cost per delivery** | Total route cost / deliveries completed | > 20% above lane benchmark |

### Forecast Accuracy Metrics (Planning)

| Metric | Description | Alert Threshold |
|---|---|---|
| **WMAPE (Weighted Mean Absolute Percentage Error)** | Forecast accuracy weighted by demand volume | > 30% at SKU-location level; > 15% at category-region level |
| **Forecast bias** | Systematic over- or under-forecasting (mean signed error) | |bias| > 10% sustained for 2+ weeks → model retraining |
| **P90 coverage rate** | % of actual demand values falling below the P90 quantile forecast | < 85% (model underestimates uncertainty) or > 98% (overestimates → excess inventory) |
| **Pinball loss by quantile** | Quantile-specific forecast quality metric | Degradation > 20% from baseline triggers review |
| **Regime change detection** | CUSUM control chart on forecast error detecting persistent shift | CUSUM crossing threshold → SEV-3 alert + planner notification |
| **New SKU forecast accuracy** | Accuracy for SKUs with < 12 weeks of history | Tracked separately; > 50% WMAPE expected; flag if > 70% |

### Warehouse Productivity Metrics (Operations)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Picks per hour (PPH)** | Total picks completed / labor hours (human + AMR) | < 80% of warehouse benchmark → slotting or path issue |
| **AMR utilization** | % of AMR fleet actively performing tasks (not idle or charging) | < 60% (over-provisioned or task assignment issue) |
| **AMR deadhead distance** | Distance AMRs travel without carrying inventory (empty trips) | > 30% of total distance → path or slotting inefficiency |
| **Wave completion rate** | % of waves completed before cutoff time | < 95% → wave planning or capacity issue |
| **Bin fill rate** | % of warehouse bins occupied | > 95% (space pressure) or < 50% (under-utilized facility) |
| **Dock door turnaround time** | Time from truck arrival to departure at dock | > 120 min average → dock scheduling or staffing issue |
| **Slotting effectiveness** | Reduction in average pick travel distance after slotting optimization | < 5% improvement after re-slot → slotting model quality issue |

### Fleet Health Metrics (Fleet Management)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Predictive maintenance accuracy** | % of predicted failures that occurred within the predicted horizon | < 70% (model under-predicting) or > 95% with many false positives |
| **Unplanned breakdown rate** | Vehicle breakdowns not predicted by maintenance model | > 2% of fleet per month |
| **Driver safety score distribution** | Distribution of driver safety scores (hard braking, speeding, fatigue indicators) | > 10% of drivers below safety threshold → training intervention |
| **Fuel efficiency (km/L or kWh/km)** | Per-vehicle fuel consumption normalized by route characteristics | > 15% above fleet average for same vehicle type → driver behavior or maintenance issue |
| **Telematics connectivity rate** | % of fleet vehicles reporting telematics within expected interval | < 95% → device or connectivity issue |
| **HOS compliance rate** | % of drivers in compliance with hours-of-service regulations | < 100% → immediate alert (regulatory violation) |

### Cold Chain Metrics (Compliance)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Temperature excursion rate** | % of cold chain shipments with ≥ 1 temperature excursion | > 2% → investigation of equipment or process failure |
| **Excursion detection latency** | Time from excursion start to alert generation | > 60 seconds → sensor or pipeline issue |
| **Compliance documentation completeness** | % of cold chain shipments with complete audit trail (no gaps) | < 100% → immediate compliance alert |
| **Sensor connectivity gap rate** | % of cold chain shipments with > 30 min unverified interval | > 5% → sensor placement or connectivity review |

### Infrastructure Metrics (Engineering)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Telemetry ingestion lag** | Stream consumer lag in seconds | > 30 sec → SEV-2 alert |
| **VRP solver p99 latency** | 99th percentile of route optimization computation time | > 5 sec for incremental; > 30 sec for full solve |
| **ETA computation throughput** | ETA predictions per second | < 15,000/sec (below required throughput for 5M shipments × 5-min cycle) |
| **Digital twin state freshness** | Age of oldest AMR position in digital twin | > 5 sec → AMR connectivity or twin update issue |
| **Forecast pipeline duration** | End-to-end time for daily forecast generation | > 4 hours → pipeline scaling needed |
| **Event processing error rate** | % of telemetry events that fail processing | > 0.1% → data quality or schema issue |

---

## Distributed Tracing

Every shipment is assigned a trace_id at creation. This trace_id propagates through all downstream processing:

```
Trace propagation:
  Order received → trace_id generated at API gateway
  ↓
  Route optimization → trace_id in solver request
  Carrier assignment → trace_id in carrier API call
  Telemetry ingestion → trace_id enriched per shipment
  ETA prediction → trace_id in inference request
  Customer notification → trace_id in notification event
  Proof-of-delivery → trace_id in POD record

Use cases:
  - Debug why a specific shipment's ETA was inaccurate (trace: which telemetry events
    were received, what features were extracted, what model produced the ETA)
  - Investigate a delivery SLA breach (trace: order time → route assignment → dispatch →
    each stop arrival vs. plan → where did the delay occur?)
  - Cold chain investigation (trace: all sensor readings, any excursions, who received
    the alert, what disposition was made)
  - Carrier dispute resolution (trace: shipment timeline shows carrier's actual vs.
    committed performance with timestamps from multiple independent sources)
```

---

## Alerting and On-Call Design

### Alert Tiers

| Tier | Condition | Response |
|---|---|---|
| **SEV-1 (Page immediately)** | Route engine unavailable (all new orders unassignable); telemetry ingestion stopped (no visibility); warehouse orchestrator down (AMR fleet halted); cold chain system failure (no excursion detection) | On-call engineer paged immediately; operations backup plan activated |
| **SEV-2 (Page within 15 min)** | Telemetry lag > 60 sec; VRP solver p99 > 10 sec; ETA pipeline throughput < 50% of target; single warehouse orchestrator down | On-call engineer paged |
| **SEV-3 (Business hours)** | Forecast accuracy degradation (WMAPE spike); OTD rate below threshold for a carrier or lane; driver safety score cluster below threshold; model drift detected | Operations analyst or ML engineer notified |
| **SEV-4 (Weekly digest)** | Vehicle utilization below target; warehouse bin fill rate trending high; forecast bias accumulating; carrier scorecard changes | Weekly operations review report |

### Operations-Specific Alerting

Operations alerts are routed to a separate on-call rotation (dispatch supervisor + operations manager) for domain-appropriate response:

- Delivery SLA breach imminent (ETA exceeds SLA window for a priority shipment) → dispatch intervention
- Cold chain excursion on pharmaceutical shipment → compliance officer + logistics coordinator paged
- Multiple vehicles reporting breakdowns in same region → fleet manager paged for capacity reallocation
- Warehouse wave completion at risk before cutoff time → shift supervisor paged

---

## Dashboards

### Delivery Operations Dashboard

```
Panels:
  [1] OTD rate by carrier and by lane (rolling 7 days, daily trend)
  [2] ETA accuracy: predicted vs. actual scatter plot (last 24 hours)
  [3] Active shipments map: real-time positions with status coloring
  [4] Delivery exceptions by type (damaged, refused, not-at-home, address error)
  [5] Route efficiency: average stops/route and vehicle utilization by depot
  [6] Last-mile cost per delivery trend (rolling 30 days)
```

### Forecast & Inventory Dashboard

```
Panels:
  [1] WMAPE by product category and region (heatmap, rolling 4 weeks)
  [2] Forecast bias trend: cumulative bias by category (line chart, 12-week window)
  [3] P90 coverage rate by category (should be ~90%; flag deviations)
  [4] Regime change alerts: SKU-locations with active CUSUM alerts
  [5] Safety stock adequacy: % of SKUs with inventory below safety stock
  [6] Dead stock detection: SKUs with zero demand for 90+ days
```

### Warehouse Operations Dashboard

```
Panels:
  [1] Picks per hour by warehouse (real-time, vs. target)
  [2] AMR fleet status: idle / picking / charging / maintenance (donut chart per warehouse)
  [3] Wave completion timeline: started, in-progress, completed, at-risk
  [4] Dock door utilization and turnaround time (per warehouse)
  [5] Bin utilization heatmap (by zone and aisle)
  [6] Slotting effectiveness: pick travel distance trend (before/after re-slot)
```

### Fleet Health Dashboard

```
Panels:
  [1] Predictive maintenance: vehicles with predicted failures in next 7 days (table)
  [2] Unplanned breakdowns by region (rolling 30 days)
  [3] Driver safety score distribution (histogram, with threshold line)
  [4] Fuel efficiency by vehicle type (box plot, flag outliers)
  [5] Telematics connectivity: % of fleet reporting on time (target: 95%)
  [6] HOS compliance: any violations flagged immediately (100% target)
```

---

## Model Monitoring and Drift Detection

### ETA Model Drift

```
Process:
  Daily: Compute MAE and bias for ETA predictions by transport mode, carrier, and lane
  Compare to baseline MAE established at model deployment
  MAE increase > 20% for a carrier or lane → SEV-3 alert; investigate data quality or
    carrier behavior change
  MAE increase > 40% platform-wide → SEV-2 alert; consider emergency model retraining

Why it matters:
  Carrier behavior changes (new carrier uses slower routes), infrastructure changes
  (highway construction), or seasonal patterns not captured in training data can cause
  ETA model accuracy to degrade silently. Without drift monitoring, customers receive
  increasingly inaccurate ETAs, eroding trust.
```

### Demand Forecast Regime Change Detection

```
Process:
  Per-SKU-location: Maintain CUSUM chart on forecast error (actual - predicted)
  CUSUM threshold: 3 standard deviations of historical error
  When threshold is crossed: flag SKU-location as "regime change detected"
  Planner notified; short-window model retrained for affected SKU-locations

Why it matters:
  A competitor's product launch, a regulatory change, or a supply disruption at a key
  supplier can cause demand to shift permanently. Without detection, the model continues
  forecasting based on the old regime, causing systematic stockouts or overstock.
```

### Predictive Maintenance Model Calibration

```
Process:
  Monthly: Compare predicted failure rates vs. actual failure rates by component type
  If predicted rate < 0.7 × actual rate → model under-predicting; increase maintenance
    frequency while model is retrained
  If predicted rate > 1.5 × actual rate → model over-predicting; excess maintenance costs
    Alert fleet management team

Why it matters:
  Vehicle aging, new vehicle models in the fleet, or operating condition changes (new routes
  with different road quality) affect component failure patterns. A maintenance model trained
  on last year's fleet may not apply to this year's fleet mix.
```

---

## SLO Dashboards

### SLO Burn-Rate Dashboard

```
Panels:
  [1] Error budget remaining (% of monthly budget consumed, per SLO)
      Color: green (< 50%), yellow (50-80%), red (> 80%)
  [2] Burn rate chart: 1-hour, 6-hour, 24-hour burn rates per SLO
      Alert lines at 5x (1-hour), 2x (6-hour), 1.5x (24-hour) thresholds
  [3] SLO violation timeline: when and for how long each SLO was breached
  [4] Deployment correlation: overlay deployment timestamps on SLO breach events
  [5] Monthly SLO attainment trend (rolling 6 months, per SLO)
  [6] Error budget forecast: projected budget exhaustion date based on current burn rate
```

### Route Engine SLO Dashboard

```
Panels:
  [1] Re-optimization latency heatmap: p50, p95, p99 by depot region (map view)
  [2] Solution quality over time: objective value trend per depot (detects optimization degradation)
  [3] Solver availability: per-depot uptime, failover events, checkpoint age
  [4] Unassigned stops count: stops that could not be feasibly assigned per planning cycle
  [5] Driver route change frequency: average route modifications per driver per shift
  [6] Warm-start effectiveness: % of re-optimizations using warm-start vs. cold re-solve
```

### Cold Chain Compliance SLO Dashboard

```
Panels:
  [1] Real-time excursion map: shipments with active excursions plotted on map
  [2] Alert-to-response time: time from excursion alert to first human action (target: < 15 min)
  [3] Compliance rate by cargo type: pharmaceutical, food, chemical (rolling 30 days)
  [4] Sensor connectivity gaps: unverified intervals by shipment, duration histogram
  [5] Disposition decision backlog: excursions awaiting human disposition
  [6] Audit trail integrity: hash chain verification status (last check, any failures)
```

---

## Incident Playbooks

### Playbook 1: Route Engine Unavailable (SEV-1)

**Trigger:** Route optimization engine returns errors for > 50% of requests for > 2 minutes, or all solver instances for a region are unreachable.

**Impact:** New orders cannot be assigned to vehicles; real-time re-optimization stopped; drivers continue last-known routes but cannot adapt to changes.

**Steps:**
1. **Verify** (1 min): Check solver instance health; confirm this is not a monitoring false positive (check from multiple observation points).
2. **Classify** (2 min): Is the failure regional (one region's solvers down) or global? Check infrastructure health of the solver compute pool.
3. **Mitigate** (5 min):
   - If regional: route traffic to a secondary region's solver pool (cross-region solver failover).
   - If global infrastructure: check compute provider status page; if provider outage, engage provider support.
   - If software crash: identify the crash signature; if known, deploy the previous stable version.
4. **Stabilize** (15 min): Verify solvers are processing events again; check that queued events (accumulated during outage) are being drained.
5. **Communicate** (immediate, then ongoing): Notify dispatch supervisors that automated routing was interrupted and is recovering. Provide estimated time to normal operation.
6. **Post-incident** (24h): Root cause analysis; update runbook if new failure mode.

**Fallback:** During total route engine outage, dispatchers use the manual dispatch UI to assign pending orders to vehicles based on geographic proximity. This UI reads directly from the shipment database and vehicle positions, bypassing the solver entirely.

### Playbook 2: Telemetry Ingestion Lag Exceeding 60 Seconds (SEV-2)

**Trigger:** Stream consumer lag > 60 seconds for > 10% of partitions.

**Impact:** Stale shipment positions; ETA predictions based on old data; cold chain alerts delayed.

**Steps:**
1. **Verify** (1 min): Confirm lag metric is accurate (not a monitoring artifact). Check multiple consumer groups.
2. **Identify** (3 min): Is the lag caused by increased event rate (carrier reconnection storm), slow consumers (processing Slowest part of the process), or stream infrastructure issue (broker node failure)?
3. **Mitigate**:
   - If event rate spike: identify the carrier; apply per-carrier rate limiting at the ingestion gateway; tag buffered events as "delayed batch."
   - If slow consumers: check consumer CPU/memory; if resource-bound, scale consumer count (add instances for overloaded partitions).
   - If broker failure: verify broker cluster health; if node lost, wait for partition reassignment (automatic in most distributed stream systems, ~30 seconds).
4. **Stabilize**: Monitor lag returning to < 5 seconds across all partitions.
5. **Post-incident**: If caused by carrier reconnection storm, review per-carrier rate limiting thresholds.

### Playbook 3: Forecast Pipeline Exceeds 4-Hour SLO (SEV-3)

**Trigger:** Daily forecast pipeline still running at the 3-hour mark.

**Impact:** If pipeline doesn't complete before replenishment planning runs (typically 6 AM), planners use previous-day forecasts, potentially missing demand changes.

**Steps:**
1. **Identify** (5 min): Which stage is slow? Model inference (check worker count, per-worker throughput), reconciliation (check per-tree reconciliation time, identify any unusually large hierarchy trees), or data loading (check feature store read latency).
2. **Mitigate**:
   - If model inference: add workers (the pipeline is embarrassingly parallel at the inference stage).
   - If reconciliation: identify the Slowest part of the process hierarchy tree; if one tree is 10x larger than others (product line expansion), consider splitting it.
   - If data loading: check feature store health; if degraded, switch to cached features from previous day.
3. **Fallback**: If pipeline cannot complete in time, publish the previous day's forecasts with a "stale" flag. Notify planners to manually review high-priority SKUs.

### Playbook 4: Cold Chain Excursion Alert System Failure (SEV-1)

**Trigger:** Cold chain monitoring pipeline reports no alerts for > 10 minutes (abnormal quiet) or health check fails.

**Impact:** Temperature excursions on pharmaceutical or food shipments go undetected; regulatory non-compliance; potential patient/consumer safety issue.

**Steps:**
1. **Verify** (immediate): Send a synthetic test excursion event through the pipeline; verify it produces an alert within 60 seconds.
2. **If test fails**: Check the cold chain event processor health; check the alerting gateway (SMS/push notification service).
3. **If test passes but real alerts are missing**: Check IoT sensor connectivity across active cold chain shipments; if widespread sensor disconnection, investigate IoT gateway health.
4. **Mitigate**: If the alert pipeline is down, activate backup alerting: direct sensor-to-SMS path (bypass the platform's processing layer entirely; sensors send emergency SMS via cellular modem when temperature exceeds threshold).
5. **Communicate**: Notify compliance officers that the automated alert system is degraded; request manual temperature checks on high-priority shipments until the pipeline is restored.

---

## Observability for AI/ML Components

### Forecast Model Observability

```
Dimensions:
  Feature drift:    Monitor input feature distributions weekly; detect drift using
                    KL divergence or PSI (Population Stability Index)
                    Alert: PSI > 0.25 for any feature → investigate data pipeline change

  Prediction drift: Monitor forecast distribution shape (mean, variance, skewness)
                    Alert: distribution shift > 2 standard deviations from baseline

  Label delay:      For forecast accuracy computation, actual demand data arrives with a
                    1-day lag (POS data from retailers). Monitor label pipeline freshness;
                    alert if lag exceeds 48 hours

  Training data:    Monitor training data completeness per product category;
                    alert if any category has < 80% of expected records
                    (prevents silent model degradation from missing training data)
```

### ETA Model Observability

```
Dimensions:
  Per-carrier accuracy:  MAE per carrier, updated hourly; detect carrier-specific degradation
  Per-mode accuracy:     Separate dashboards for road, ocean, rail, air (different baselines)
  Confidence calibration: Verify that 90% confidence intervals actually contain 90% of actual
                         arrivals; recalibrate conformal prediction if coverage drifts
  Feature importance:    Monthly SHAP analysis on ETA model; detect if feature importance
                        shifts (indicates model is relying on different signals)
```

### Route Solver Observability

```
Dimensions:
  Solution quality:     Track objective value per depot over time; detect if incremental
                       re-optimizations are accumulating cost drift (solution degrades
                       through many small changes without periodic full re-solve)

  Warm-start hit rate: % of re-optimizations that use warm-start vs. cold re-solve;
                       target > 90%; low hit rate indicates checkpoint corruption or
                       excessive solution state invalidation

  Unassigned stop rate: % of stops that cannot be feasibly assigned after re-optimization;
                       > 1% indicates capacity shortfall or constraint over-specification

  Solver timeout rate:  % of solves that hit the time budget without converging;
                       > 5% indicates problem size exceeding solver capacity

  Driver disruption frequency: Average route changes per driver per shift;
                              > 3 changes/shift indicates over-optimization or poor batching
```

---

## Correlation Analysis for Root Cause Identification

### Multi-Metric Correlation Patterns

| Pattern | Metrics Involved | Likely Root Cause |
|---|---|---|
| Telemetry lag spike + ETA accuracy drop | Ingestion lag > 30s AND ETA MAE increases 2x | ETA model receiving stale positions; root cause is ingestion pipeline, not model quality |
| OTD rate drop for single carrier | Carrier OTD drops 15% AND carrier tender acceptance drops | Carrier capacity issue (not platform issue); carrier scorecard should reflect this |
| Warehouse PPH drop + AMR idle increase | Picks per hour drops 20% AND AMR idle time increases | Likely slotting drift: AMRs are traveling farther per pick, spending more time in transit |
| Forecast bias spike + inventory alerts | Category-level forecast bias > 10% AND safety stock alerts fire | Regime change: actual demand has shifted but model hasn't adapted; trigger short-window retrain |
| Cold chain alert spike + normal sensor readings | Alert count increases 3x AND sensor readings show no excursions | Alerting threshold misconfiguration or alert pipeline false positives; investigate threshold drift |
| ETA model accuracy degrades for one mode | Road ETA MAE stable; ocean ETA MAE increases 50% | Port congestion pattern changed; ocean-specific model features need updating |

### Diagnostic Queries

When a delivery SLA breach is investigated, the observability system supports a structured diagnostic flow:

```
Query sequence for SLA breach on shipment X:
  1. When was the shipment created? When was the SLA promised?
  2. What route was initially assigned? When was it last re-optimized?
  3. What was the ETA at each re-optimization point? When did the ETA exceed the SLA?
  4. What telemetry events arrived during transit? Were there gaps?
  5. Was the shipment affected by any detected disruption events?
  6. If re-routed: what triggered the re-routing? Was the alternative route better or worse?
  7. What was the carrier's historical OTD rate on this lane? Is this an outlier or a pattern?
  8. Were there warehouse delays at origin (late dispatch from dock)?

Each query maps to a specific observability data source:
  [1-2] → Shipment DB + Route solution history
  [3]   → ETA prediction log (every ETA computation stored with features and model version)
  [4]   → Time-series telemetry store
  [5]   → Disruption event store
  [6]   → Route solution lineage (parent_solution_id chain)
  [7]   → Carrier scorecard analytics store
  [8]   → Warehouse event log (dock door activity, wave completion times)
```

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
