# 13.1 AI-Native Manufacturing Platform — Observability

## Observability Philosophy

The manufacturing platform has four distinct observability audiences with fundamentally different concerns:

1. **Production operations**: OEE, throughput, quality rates, schedule adherence—business metrics that drive daily decisions
2. **Maintenance engineering**: Asset health, PdM accuracy, maintenance backlog, spare parts availability
3. **ML/platform engineering**: Model accuracy, inference latency, data pipeline health, edge fleet status
4. **Safety and compliance**: Safety event frequency, SIL compliance, audit log integrity, zone violation response times

Each audience requires purpose-built dashboards. Critically, manufacturing observability must bridge the OT/IT boundary—metrics from edge gateways and PLCs must be aggregated alongside cloud platform metrics without violating network segmentation.

---

## Key Metrics

### Production Metrics (Operations)

| Metric | Description | Alert Threshold |
|---|---|---|
| **OEE (Overall Equipment Effectiveness)** | Availability × Performance × Quality; composite efficiency per machine, cell, and plant | < 65% sustained for any cell (world-class target: 85%) |
| **Availability** | Uptime / (Uptime + Downtime); includes planned and unplanned downtime | < 90% for any critical machine |
| **Performance** | (Ideal Cycle Time × Total Count) / Run Time; measures speed losses | < 80% sustained → investigate slow cycles |
| **Quality (First Pass Yield)** | Good Parts / Total Parts produced | < 95% → trigger root cause investigation |
| **Defect rate by type** | Defects per million (DPM) by defect category and machine | Any defect type exceeding historical baseline by 2 SD |
| **Schedule adherence** | % of jobs completed within planned window | < 85% → scheduling model or capacity issue |
| **Takt time variance** | Actual cycle time vs. planned takt time per station | > 10% variance sustained → Slowest part of the process investigation |
| **Energy consumption per unit** | kWh per part produced, by machine and part type | > 15% above baseline → equipment degradation or inefficient setpoints |

### Predictive Maintenance Metrics (Maintenance Engineering)

| Metric | Description | Alert Threshold |
|---|---|---|
| **PdM prediction accuracy** | % of maintenance tickets confirmed as genuine degradation (vs. false alarm) | < 80% (excessive false positives → alert fatigue) |
| **PdM recall (detection rate)** | % of actual failures that were predicted ≥ 24h in advance | < 70% (failures happening without warning → model ineffective) |
| **Mean RUL prediction error** | Average absolute difference between predicted and actual RUL at ticket creation | > 30% of actual RUL (predictions too inaccurate for planning) |
| **Unplanned downtime rate** | Hours of unplanned downtime per 1,000 operating hours | > 5 hours/1,000h (PdM should reduce this below 2) |
| **Mean time between failures (MTBF)** | Average operating time between failures per asset type | Trending downward → fleet-wide degradation issue |
| **Maintenance backlog** | Count of open maintenance tickets by priority | > 50 planned tickets older than 7 days → capacity issue |
| **Spare parts lead time compliance** | % of maintenance events where required parts were available | < 90% → inventory planning issue |

### ML Model Health Metrics (Engineering)

| Metric | Description | Alert Threshold |
|---|---|---|
| **CV defect detection accuracy (per camera)** | Precision and recall on annotated holdout set | Precision < 95% or recall < 90% → retrain |
| **CV defect escape rate** | Defective parts that passed CV inspection (detected downstream) | > 100 DPM → CV model degradation |
| **CV false rejection rate** | Good parts incorrectly rejected by CV | > 0.5% → yield loss; recalibrate thresholds |
| **PdM model drift (feature distribution)** | KL divergence of input feature distributions vs. training distribution | KL > 0.5 → significant drift; evaluate retraining |
| **Edge inference latency p99** | 99th percentile inference time for safety-critical models | > 8 ms (approaching 10 ms deadline) |
| **Edge inference latency p50** | Median inference time | > 5 ms → model may be too complex for edge hardware |
| **Model deployment success rate** | % of OTA model deployments that pass acceptance tests | < 95% → deployment pipeline issue |
| **Edge gateway fleet health** | % of edge gateways reporting nominal status | < 98% → investigate offline/degraded gateways |

### Safety and Compliance Metrics

| Metric | Description | Alert Threshold |
|---|---|---|
| **Safety zone violation response time** | Time from worker entering exclusion zone to machine stop | > 50 ms → SIL-2 compliance risk (immediate SEV-1) |
| **Safety zone violation frequency** | Count of exclusion zone violations per shift | > 5/shift → process or layout review needed |
| **Emergency stop frequency** | AI-triggered emergency stops per 1,000 operating hours | Sudden increase → model oversensitivity or genuine deterioration |
| **Safety audit log gap** | Any time gap in safety audit log exceeding 1 second | Any gap → immediate investigation (log integrity compromised) |
| **Safety system self-test pass rate** | Daily automated self-test of safety sensors and actuators | < 100% → immediate maintenance |

---

## Distributed Tracing

### Cross-Layer Trace Propagation

Every event in the manufacturing platform carries a trace context that spans the edge-to-cloud boundary:

```
Trace propagation:
  Sensor reading → trace_id generated at edge gateway ingestion
  ↓
  Edge ring buffer write → trace_id in buffer metadata
  Feature extraction (FFT, anomaly detection) → trace_id in feature record
  Edge inference (CV, PdM) → trace_id in inference result
  Actuator command (reject, stop) → trace_id in PLC command
  ↓
  DMZ crossing → trace_id in MQTT message header
  ↓
  Cloud stream processor → trace_id in processing record
  Time-series write → trace_id as indexed tag
  Twin state update → trace_id in twin event log
  PdM prediction → trace_id in maintenance ticket

Use cases:
  - Trace a rejected part from camera image → CV inference → PLC reject → audit log
  - Trace a PdM prediction from vibration sensor → FFT features → anomaly detection → RUL model → ticket
  - Trace a production delay from schedule disruption → re-optimization → job reassignment → completion
  - Forensic investigation: "Why was this part rejected?" → pull full trace across edge and cloud
```

### Edge-Local Tracing (No Cloud Dependency)

During offline operation, tracing continues on the edge with local storage:
- Trace spans logged to edge ring buffer alongside telemetry
- Post-reconnection: trace spans uploaded and stitched with cloud-side spans
- Full end-to-end trace reconstructable after sync completes

---

## Alerting and On-Call Design

### Alert Tiers

| Tier | Condition | Response |
|---|---|---|
| **SEV-1 (Page immediately)** | Safety zone response time > 50 ms; safety audit log gap; edge inference timeout on SIL-2 system; safety self-test failure | On-call engineer + safety officer; production line may need to stop |
| **SEV-2 (Page within 15 min)** | Edge inference p99 > 8 ms (approaching deadline); PdM predicts critical failure < 4h; CV defect escape detected; edge gateway offline | On-call engineer paged; maintenance team notified |
| **SEV-3 (Alert in business hours)** | OEE < 65% sustained 4h; PdM model drift KL > 0.5; CV false rejection rate > 0.5%; maintenance backlog > 50 tickets | ML engineer + production supervisor notified |
| **SEV-4 (Weekly digest)** | Energy consumption trending up; schedule adherence declining; PdM accuracy below target; MTBF trends | Operations management weekly report |

### Escalation for Safety Events

Safety events follow a separate escalation path that bypasses the standard engineering on-call:

```
Safety event escalation:
  1. Safety zone violation → automatic machine stop (no human in loop)
  2. Alert to shift supervisor within 30 seconds
  3. Alert to plant safety officer within 5 minutes
  4. If SIL compliance metric degrades → alert to corporate safety engineering within 1 hour
  5. If safety self-test fails → machine locked out until safety engineer clears

  Root cause investigation required for every SEV-1 safety event
  Post-incident report within 24 hours
  System modification (if needed) within 7 days
```

---

## Dashboards

### Plant Operations Dashboard

```
Panels:
  [1] OEE heatmap: rows = machines, columns = shifts; color: green (>85%), yellow (65-85%), red (<65%)
  [2] Production throughput: parts produced vs. target, per production line (real-time counter)
  [3] Quality first-pass yield: per line, per shift (rolling 24h bar chart)
  [4] Defect Pareto: top 5 defect types by frequency, current shift
  [5] Schedule Gantt: planned vs. actual job completion timeline
  [6] Active alerts: SEV-1/2 alerts by cell (blinking red for SEV-1)
```

### Asset Health Dashboard

```
Panels:
  [1] Asset health index heatmap: plant floor layout with color-coded health per machine
  [2] RUL distribution: histogram of RUL predictions across all critical assets
  [3] Maintenance backlog: open tickets by priority and age (stacked bar)
  [4] PdM prediction accuracy: rolling 30-day precision and recall trends
  [5] Top 10 assets at risk: sorted by lowest RUL; shows predicted failure mode
  [6] Unplanned downtime trend: hours per week, rolling 12-week chart
```

### Edge Fleet Health Dashboard

```
Panels:
  [1] Edge gateway status map: factory floor layout; green (nominal), yellow (degraded), red (offline)
  [2] Inference latency distribution: p50/p95/p99 per model type (histogram, hourly)
  [3] Ring buffer utilization: % capacity used per gateway (alert at 80%)
  [4] Model version matrix: table of gateway × model type × deployed version
  [5] Cloud sync status: last sync time per gateway; highlight overdue (>15 min gap during online)
  [6] Sensor data quality: % of readings with quality_flag != GOOD, per gateway
```

---

## Model Monitoring and Drift Detection

### CV Model Accuracy Monitoring

```
Process:
  Continuous: Compare CV predictions against human annotations on sampled parts
  Sample rate: 1% of passed parts re-inspected manually (stratified by machine and part type)

  Metrics computed hourly:
    - Per-class precision and recall
    - Overall defect escape rate (missed defects found by manual re-inspection)
    - False rejection rate (good parts rejected by CV)

  Drift detection:
    Precision drop > 3% from baseline → SEV-3 alert; investigate cause (lighting change? new material?)
    Recall drop > 5% from baseline → SEV-2 alert; immediate investigation (missed defects escaping)
    Defect escape rate > 100 DPM → SEV-2; consider temporary slowdown for manual inspection coverage

  Retraining trigger:
    If drift persists > 24h after investigation → initiate CV model retraining with latest annotated data
    Retrained model deployed via canary pipeline; shadow mode for 4h before promotion
```

### PdM Model Drift Monitoring

```
Process:
  Weekly: Compare feature distributions (vibration spectra, thermal profiles) of current operating data
          against the training distribution using KL divergence

  KL divergence interpretation:
    KL < 0.1: No drift; model operating within training distribution
    KL 0.1–0.5: Moderate drift; monitor closely; may be seasonal (temperature effects)
    KL > 0.5: Significant drift; model predictions may be unreliable; trigger retraining evaluation

  Additional monitoring:
    - PdM false positive rate trending upward → model may be over-predicting (maintenance fatigue)
    - PdM missed failure → root cause analysis: was the failure mode in the training data?
    - Fleet-wide MTBF change → could indicate systematic process change, not model drift

  Closed-loop validation:
    Every completed maintenance ticket feeds back to PdM pipeline:
    - Confirmed failure → positive label for model training
    - False alarm → negative label; adjust decision threshold
    - Deferred → neither label; used for calibration monitoring
```

---

## Cross-Plant Comparison Dashboard

```
Panels:
  [1] Fleet OEE comparison:
      Grouped bar chart; one group per plant; bars for Availability, Performance, Quality
      Sorted by OEE descending; red line at 65% threshold, green at 85% world-class target
      Drill-down: click plant → plant-level OEE heatmap by machine

  [2] PdM effectiveness comparison:
      Scatter plot: x-axis = PdM recall (detection rate), y-axis = PdM precision (1 - false positive rate)
      One point per plant; ideal is top-right corner (high recall, high precision)
      Plants in bottom-left quadrant need urgent model recalibration
      Tooltip shows: plant name, # monitored assets, # failures in last 90 days, model version

  [3] CV quality comparison:
      Table: rows = plants, columns = [total inspected, DPM defect rate, DPM escape rate,
                                        false rejection %, top defect type, model version]
      Conditional formatting: red cells where escape rate > 100 DPM or false rejection > 0.5%
      Sortable by any column; default sort by escape rate descending (worst first)

  [4] Edge fleet reliability:
      Stacked bar per plant: green = nominal gateways, yellow = degraded, red = offline
      Line overlay: average edge inference p99 latency per plant
      Alert flag on any plant with > 2% gateways offline

  [5] Unplanned downtime league table:
      Ranked list: plants sorted by unplanned downtime hours per 1,000 operating hours
      Trend arrow per plant (improving/stable/worsening vs. prior quarter)
      Target line at 2 hours/1,000h (best-in-class)

  [6] Energy efficiency comparison:
      Bar chart: kWh per unit produced, normalized by part complexity index
      One bar per plant; industry benchmark line overlay
      Seasonal adjustment applied (higher consumption expected in extreme climates)
```

### Safety Compliance Dashboard

```
Panels:
  [1] Safety zone violation timeline:
      Timeline chart per shift; dots at violation timestamps
      Color-coded by response time: green (<30ms), yellow (30-50ms), red (>50ms, SIL breach)
      Click violation → trace view showing detection-to-stop decomposition

  [2] Safety system self-test matrix:
      Table: rows = safety devices (LiDAR units, camera channels, safety relays)
      Columns = last 7 daily self-test results (pass/fail)
      Any fail → red cell with link to maintenance ticket
      Overall pass rate per zone displayed as header metric

  [3] Safety audit log integrity:
      Real-time indicator: hash chain verification status (verified/gap detected)
      Time since last verified entry; expected cadence: < 1 second gap
      Any gap > 1 second → immediate red alert with affected time range

  [4] SIL compliance scorecard:
      Per safety function: [function name, required SIL, current diagnostic coverage %,
                            proof test status, last proof test date, next due]
      Visual indicator: green (compliant), yellow (nearing proof test due), red (overdue or degraded)

  [5] Worker proximity incident review:
      List of recent violations: [timestamp, zone, worker ID (anonymized), machine state,
                                   response time, investigation status]
      Investigation status: [open, root cause identified, corrective action implemented, closed]
      30-day trend line of violation frequency
```

### Model Lifecycle Dashboard

```
Panels:
  [1] Model version inventory:
      Matrix: rows = edge gateways, columns = model types (CV-defect, PdM-bearing, anomaly-general)
      Cell value = deployed version; color = age (green <30 days, yellow 30-90, red >90)
      Quick identification of gateways running outdated models

  [2] Deployment pipeline status:
      Kanban board: [Training → Validation → Canary → Rollout → Stable]
      Cards for each active model deployment showing progress and metrics
      Blocked deployments highlighted in red with blocker reason

  [3] Canary comparison (active deployments):
      Side-by-side metrics: new model vs. current model
      [inference latency, accuracy on reference, anomaly rate, resource utilization]
      Promotion gate status: [latency OK? accuracy OK? anomaly OK?] → all green = auto-promote

  [4] Training data freshness:
      Per model type: when was training data last refreshed?
      CV: last annotated batch date, annotation backlog size
      PdM: last failure event added to training set, fleet failure count by type
      Staleness alert: CV training data > 30 days old, PdM > 90 days since last failure event

  [5] Model accuracy over time:
      Time-series chart per model type: accuracy metric vs. time (weekly resolution)
      Vertical lines marking model version changes and retraining events
      Trend analysis: is accuracy improving, stable, or degrading after each retraining?
```

---

## SLO Burn Rate Monitoring

```
Burn Rate Alerts (multi-window):
  Edge Inference ≤ 10 ms (annual budget: 5 min/year):
    Fast burn: > 14.4× rate for 5 min   → page immediately (exhausts budget in 1 hour)
    Slow burn: > 6× rate for 30 min      → page within 15 min (exhausts budget in 1 day)
    Trend: > 1× rate for 72 hours         → SEV-3 (budget will exhaust before quarter end)

  CV Defect Escape ≤ 100 DPM (per-batch):
    Instant: any batch > 200 DPM          → page immediately (2× threshold)
    Sustained: rolling 4h average > 120 DPM → page within 15 min
    Trend: weekly DPM increasing for 3 weeks → SEV-3 (model degradation)

  PdM False Positive ≤ 5% (30-day rolling):
    Breach: 3-day rolling > 10%            → SEV-2 (maintenance team losing trust)
    Trend: 30-day rolling > 7%             → SEV-3 (model recalibration needed)

  Safety Zone Response ≤ 50 ms (zero-tolerance):
    Any single violation                   → SEV-1 immediate page; production line stop
    No burn rate concept — budget is zero
```

---

## Incident Playbooks

### Playbook 1: CV Defect Escape Detected (Downstream Quality Alert)

**Trigger:** Downstream inspection station or customer reports a defective part that the inline CV system marked as PASS.

**Steps:**
1. **T+0:** Retrieve the original inspection_id for the escaped part using part_id and production timestamp.
2. **T+5 min:** Pull the raw inspection image, model predictions, and confidence scores from the edge buffer or cloud store. Determine: was the defect visible in the image? Was the model's confidence below threshold?
3. **T+15 min:** If defect was visible but model missed it → CV model accuracy regression for this defect type. Check: (a) has the model drifted? (KL divergence on recent input features), (b) has the environment changed? (lighting, camera position, material batch), (c) was this defect type in the training data?
4. **T+30 min:** If defect type is known: lower confidence threshold for this defect type on affected cameras (bias toward recall). If defect type is novel: add to anomaly autoencoder watchlist.
5. **T+4 hours:** If drift confirmed → initiate emergency CV retraining with last 7 days of annotated data from affected cameras plus the escaped defect as a high-weight training example.

### Playbook 2: PdM Missed Failure (Unplanned Equipment Downtime)

**Trigger:** Equipment fails unexpectedly without PdM prediction. Maintenance ticket was not generated or was generated too late (< 2 hours before failure).

**Steps:**
1. **T+0:** Capture full twin state snapshot at failure time; preserve all sensor readings from past 7 days on edge buffer (prevent overwrite).
2. **T+1 hour:** Retrospective analysis: replay PdM feature extraction on the preserved sensor data. Was there a detectable signal the model missed? Compare vibration spectrum evolution against known fault signatures.
3. **T+4 hours:** If signal was present but model missed it → the failure mode may not be in the training data. Check fleet-wide: has this failure mode occurred at other plants? If yes, add to training set.
4. **T+24 hours:** If failure mode is genuinely novel → generate synthetic training data from twin simulation of the new failure mechanism. Add to next weekly PdM model retraining cycle.
5. **Post-incident:** Update PdM recall metric. If recall drops below 70% SLO → escalate to ML engineering for model architecture review.

### Playbook 3: Safety Zone Violation with Response Time Exceedance

**Trigger:** Worker entered exclusion zone and machine stop took > 50 ms (SIL-2 compliance breach).

**Steps:**
1. **T+0 (automatic):** Production line stopped. Safety officer paged. Incident recorded in safety audit log with nanosecond-precision timestamps.
2. **T+5 min:** Retrieve full trace: (a) which sensor detected the worker (LiDAR, camera, or both?), (b) timestamp of detection, (c) timestamp of PLC stop command, (d) timestamp of machine stop confirmed. Identify which segment exceeded its budget.
3. **T+1 hour:** If AI inference exceeded budget → check: model complexity increase from recent deployment? NPU thermal throttling? Interference from other inference tasks on the same NPU?
4. **T+2 hours:** If PLC response exceeded budget → check: PLC scan cycle time; bus congestion; actuator mechanical response time.
5. **T+24 hours:** Root cause report to corporate safety engineering. If root cause is AI layer → freeze AI safety model deployments; revert to last known-good model. If root cause is hardware → replace and retest full safety chain before restart.
6. **No restart** until safety engineer clears the production line and proof test passes.

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
