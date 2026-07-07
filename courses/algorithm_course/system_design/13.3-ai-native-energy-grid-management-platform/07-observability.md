# 13.3 AI-Native Energy & Grid Management Platform — Observability

## Observability Philosophy

Grid management platform observability operates under unique constraints compared to typical software systems. The platform manages physical infrastructure where monitoring gaps can lead to equipment damage, blackouts, and regulatory violations. Observability must cover three distinct planes: the **physical grid** (voltage, frequency, equipment health), the **computational pipeline** (state estimation, OPF, forecasting), and the **DER fleet** (device connectivity, dispatch compliance, communication health). Each plane has different latency requirements—grid metrics need sub-second visibility, pipeline health needs second-level visibility, and DER fleet metrics can tolerate minute-level aggregation.

---

## Grid Operations Metrics

### Frequency and Power Balance

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `grid.frequency_hz` | System frequency (nominal 60 Hz / 50 Hz) | 60.000 ± 0.020 Hz | < 59.95 or > 60.05 Hz |
| `grid.ace_mw` | Area Control Error (actual vs. scheduled interchange) | ± 50 MW | |ACE| > 100 MW for > 5 min |
| `grid.total_load_mw` | Total system load | Per forecast | Deviation > 5% from forecast |
| `grid.total_generation_mw` | Total generation output | Matches load + losses | Imbalance > 2% |
| `grid.renewable_penetration_pct` | Renewable generation as % of total load | Informational | > 80% (situational awareness) |
| `grid.spinning_reserve_mw` | Available spinning reserve capacity | ≥ largest single contingency | < contingency requirement |
| `grid.tie_line_deviation_mw` | Deviation from scheduled tie-line flows | ± 20 MW | |deviation| > 50 MW |

### Equipment Health

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `equipment.transformer.loading_pct` | Transformer loading as % of rating | < 80% normal | > 100% emergency |
| `equipment.transformer.oil_temp_c` | Transformer top-oil temperature | < 85°C | > 95°C |
| `equipment.transformer.dga_h2_ppm` | Dissolved hydrogen gas (indicates arcing) | < 100 ppm | > 300 ppm |
| `equipment.line.loading_pct` | Transmission line thermal loading | < 85% | > 100% (thermal violation) |
| `equipment.line.sag_meters` | Conductor sag (thermal expansion) | < clearance limit | Within 1 meter of ground clearance |
| `equipment.breaker.operation_count` | Cumulative breaker operations | < mechanical life limit | > 80% of rated operations |
| `equipment.capacitor.reactive_output_mvar` | Capacitor bank output | Per dispatch command | Deviation > 10% from command |

### Voltage Quality

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `voltage.bus_pu` | Per-bus voltage magnitude (per-unit) | 0.95 – 1.05 pu | < 0.93 or > 1.07 pu |
| `voltage.violation_count` | Number of buses with voltage outside limits | 0 | > 0 |
| `voltage.customer_service_v` | Customer service voltage (120V/240V nominal) | 114V – 126V | < 108V or > 132V (ANSI C84.1) |
| `voltage.harmonic_thd_pct` | Total harmonic distortion | < 5% | > 8% |

---

## Computational Pipeline Metrics

### State Estimation

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `se.computation_time_ms` | State estimation wall-clock time | < 500 ms | > 800 ms (approaching cycle limit) |
| `se.chi_squared` | Weighted residual norm (goodness of fit) | < 1.2 × expected | > 2.0 (model mismatch) |
| `se.bad_data_count` | Measurements flagged as bad data per cycle | < 10 | > 50 (sensor array failure) |
| `se.observability_pct` | % of network that is observable | 100% | < 98% (unmonitored zones) |
| `se.convergence_iterations` | Number of Newton-Raphson iterations | 3–5 | > 8 (convergence difficulty) |
| `se.topology_changes_per_hour` | Breaker status changes detected | Informational | > 20/hour (unusual switching activity) |

### Optimal Power Flow

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `opf.computation_time_ms` | OPF solve wall-clock time | < 1,500 ms | > 2,500 ms |
| `opf.objective_cost_per_mwh` | Generation cost from OPF solution | Market-competitive | > 2x historical average |
| `opf.constraint_violations` | Number of binding/violated constraints | 0 violations | > 0 violations |
| `opf.relaxation_gap_pct` | Gap between SOCP relaxation and AC feasibility check | < 0.1% | > 1% (relaxation not tight) |
| `opf.dispatch_change_mw` | Total set-point change from previous cycle | Informational | > 500 MW/cycle (unusual ramp) |

### Contingency Screening

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `contingency.screening_time_s` | Full N-1 screening wall-clock time | < 30 s | > 45 s |
| `contingency.violations_count` | Contingencies with post-contingency violations | 0 | > 0 (RAS must be armed) |
| `contingency.most_severe_loading_pct` | Worst post-contingency line loading | < 100% | > 110% |
| `contingency.ras_armed_count` | Number of armed remedial action schemes | Informational | > 10 (system under stress) |

---

## Renewable Forecast Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `forecast.mae_mw` | Mean absolute error (last 24h, per plant) | < 8% of nameplate | > 15% sustained for > 6h |
| `forecast.bias_mw` | Systematic over/under-forecast (7-day rolling) | ± 2% of nameplate | |bias| > 5% (model drift) |
| `forecast.calibration_pit` | PIT histogram uniformity (Kolmogorov-Smirnov) | p-value > 0.05 | p-value < 0.01 (miscalibrated) |
| `forecast.ramp_event_hit_rate` | % of actual ramp events detected in advance | > 80% | < 60% |
| `forecast.ramp_false_alarm_ratio` | % of ramp alerts that were false alarms | < 30% | > 50% |
| `forecast.nwp_staleness_min` | Time since latest NWP model ingested | < 120 min | > 360 min (NWP feed down) |
| `forecast.pipeline_latency_min` | End-to-end forecast pipeline time | < 5 min | > 15 min |

---

## DER Fleet Metrics

### Device Connectivity

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `der.online_count` | DERs currently communicating | > 95% of enrolled | < 90% (communication issue) |
| `der.heartbeat_timeout_count` | DERs missing heartbeat > 5 minutes | < 2% of fleet | > 5% |
| `der.communication_latency_p95_ms` | Round-trip communication time | < 5,000 ms | > 10,000 ms |
| `der.certificate_expiry_30d_count` | DERs with certificates expiring within 30 days | 0 | > 100 (renewal pipeline issue) |
| `der.firmware_outdated_count` | DERs on outdated firmware | < 5% | > 15% |

### VPP Performance

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `vpp.dispatch_compliance_pct` | % of DERs that complied with dispatch signal | > 90% | < 80% |
| `vpp.delivery_vs_commitment_pct` | Actual delivered MW vs. market commitment | > 95% | < 90% (penalty risk) |
| `vpp.response_time_p95_s` | Time from dispatch signal to measured response | < 10 s (freq reg) | > 30 s |
| `vpp.battery_avg_soc_pct` | Average SoC across battery fleet | 40–80% | < 20% or > 95% (fleet exhaustion/saturation) |
| `vpp.ev_plugged_in_pct` | % of enrolled EVs currently plugged in | Informational | < 20% during committed period |
| `vpp.market_revenue_per_mw_day` | Revenue earned per MW of VPP capacity per day | Market-dependent | < 50% of 30-day average |

### Demand Response

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `dr.event_count_mtd` | DR events dispatched month-to-date | Per program rules | > program limit (customer fatigue) |
| `dr.participation_rate_pct` | % of enrolled customers who responded | > 70% | < 50% |
| `dr.load_reduction_mw` | Actual load reduction achieved | > 80% of target | < 60% of target |
| `dr.rebound_peak_pct` | Post-event rebound peak as % of normal load | < 110% | > 125% (stagger failure) |

---

## AMI Pipeline Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `ami.ingestion_rate_readings_per_sec` | Current meter read ingestion rate | Per expected schedule | < 50% of expected during collection window |
| `ami.queue_depth` | Message queue depth for meter reads | < 1M readings | > 5M readings (backlog forming) |
| `ami.vee_pass_rate_pct` | % of readings passing validation | > 99% | < 97% (data quality issue) |
| `ami.estimation_rate_pct` | % of intervals requiring estimation (gap fill) | < 2% | > 5% (communication degradation) |
| `ami.collection_success_rate_pct` | % of meters successfully collected in window | > 98% | < 95% |
| `ami.theft_alerts_daily` | Theft detection alerts generated per day | < 0.1% of meters | > 0.5% (threshold too sensitive or real spike) |

---

## Dashboard Structure

### Control Room Primary Display

```
┌──────────────────────────────────────────────────────────────────┐
│ GRID STATUS: NORMAL          Frequency: 60.003 Hz    Load: 15.2 GW │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ Generation Mix ──────┐  ┌─ Contingency Status ────────────┐ │
│  │ Gas:     8.2 GW (54%) │  │ N-1 Violations:  0              │ │
│  │ Solar:   3.1 GW (20%) │  │ RAS Armed:       2              │ │
│  │ Wind:    1.8 GW (12%) │  │ Most Severe:     Line A-B 87%   │ │
│  │ Nuclear: 1.5 GW (10%) │  │ Last Screening:  12 sec ago     │ │
│  │ Hydro:   0.6 GW  (4%) │  │                                 │ │
│  └───────────────────────┘  └─────────────────────────────────┘ │
│                                                                  │
│  ┌─ Renewable Forecast ──────────────────────────────────────┐  │
│  │ Solar next 4h: ████████████░░░░ 3.1→0.4 GW (ramp ↓ 87%) │  │
│  │ Wind  next 4h: ████████████████ 1.8→2.1 GW (stable)      │  │
│  │ Ramp Alerts: ⚠ Solar ramp-down 5-7 PM (confidence: 92%)  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ VPP Fleet Status ───┐  ┌─ DR Status ─────────────────────┐ │
│  │ Active VPPs:    287   │  │ Program: Summer Peak DR          │ │
│  │ DERs Online: 4.7M/5M │  │ Events Today: 0                  │ │
│  │ Available:   48.2 MW  │  │ Enrolled: 2.1M customers         │ │
│  │ Dispatched:  12.5 MW  │  │ Available Load: 850 MW           │ │
│  │ Compliance:  93.1%    │  │ Last Event: 3 days ago           │ │
│  └───────────────────────┘  └─────────────────────────────────┘ │
│                                                                  │
│  ┌─ Pipeline Health ────────────────────────────────────────┐   │
│  │ State Est: 423 ms ✓  OPF: 1.2s ✓  N-1: 18s ✓           │   │
│  │ AMI Queue: 234K ✓    Forecast: 3.2 min ago ✓             │   │
│  │ DER Heartbeats: 94.2% ✓                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Alerting Strategy

### Alert Severity Classification

| Severity | Response Time | Examples | Notification Channel |
|---|---|---|---|
| **CRITICAL** | Immediate (auto-action) | Frequency deviation > 0.5 Hz, N-1 violation detected, FLISR fault detected | Audible alarm in control room + auto-remedial action |
| **HIGH** | < 5 minutes | Transformer overload > 100%, VPP delivery shortfall > 10%, SCADA communication loss to substation | Control room alarm + on-call engineer page |
| **MEDIUM** | < 30 minutes | Forecast error > 15% sustained, DER fleet online < 90%, AMI queue depth > 5M | Control room notification + email |
| **LOW** | < 4 hours | Theft detection alert, certificate expiry warning, forecast model calibration drift | Dashboard highlight + daily report |
| **INFO** | Daily review | Equipment approaching maintenance threshold, firmware update available, market revenue analysis | Daily summary email |

### Alert Deduplication and Suppression

```
Deduplication rules:
  - Same metric, same resource, same severity: suppress duplicates for 15 minutes
  - Related alerts: group by root cause
    Example: SCADA communication loss to substation X →
    suppress individual measurement timeout alerts for all points at X

Suppression during known events:
  - Planned maintenance window: suppress alerts for affected equipment
  - Active storm: elevate outage prediction alerts, suppress routine equipment alerts
  - Market volatility: suppress market price spike alerts (expected behavior)

Escalation:
  - HIGH alert unacknowledged for 10 minutes → escalate to supervisor
  - CRITICAL auto-action failure → escalate to engineering + management
  - Any NERC-reportable event → automatic compliance team notification
```

---

## Distributed Tracing for Control Actions

Every automated control action generates a trace that spans the full decision chain:

```
Trace: Dispatch Set-Point Change (Generator G5)
  ├─ [0 ms] SCADA measurement received (bus voltage 1.048 pu)
  ├─ [15 ms] State estimator processed measurement
  ├─ [520 ms] State estimation completed (grid state vector #48291)
  ├─ [540 ms] OPF solver started with new state
  ├─ [1,850 ms] OPF solution: G5 set-point 245 MW → 260 MW
  ├─ [1,860 ms] Command validation: ramp rate check PASS (15 MW/min limit, 15 MW change)
  ├─ [1,870 ms] Command authorized: signed by OPF engine service certificate
  ├─ [1,880 ms] Command sent to SCADA server
  ├─ [1,920 ms] DNP3 command sent to G5 RTU
  ├─ [2,150 ms] G5 RTU acknowledgment received
  ├─ [6,200 ms] Next SCADA scan confirms G5 output ramping (248 MW)
  └─ [10,400 ms] G5 output reaches 260 MW (verified)

Trace stored in: tamper-evident audit log
Retention: 7 years (NERC CIP requirement)
```

---

## SLO Dashboards

### Dashboard 1: Grid Control Plane Burn Rate

```
┌─────────────────────────────────────────────────────────────┐
│ GRID CONTROL PLANE SLO BURN RATE                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  State Estimation (p99 ≤ 2 s)                              │
│  Budget: 432 missed cycles/month   Remaining: 428 (99.1%)  │
│  1h burn: ░░░░░░░░░░ 0.2x (OK)   6h burn: ░░░░░░░░ 0.1x  │
│  Current p99: 487 ms              Last miss: 3 days ago    │
│                                                             │
│  OPF Dispatch (p99 ≤ 3 s)                                  │
│  Budget: 432 missed cycles/month   Remaining: 430 (99.5%)  │
│  1h burn: ░░░░░░░░░░ 0.1x (OK)   6h burn: ░░░░░░░░ 0.1x  │
│  Current p99: 1,420 ms            Last miss: 5 days ago    │
│                                                             │
│  N-1 Screening (≤ 30 s full cycle)                         │
│  Budget: 4,320 late cycles/month   Remaining: 4,318 (99.9%)│
│  1h burn: ░░░░░░░░░░ 0.0x (OK)   6h burn: ░░░░░░░░ 0.0x  │
│  Current: 18.2 s                  Cases screened: 5,127    │
│                                                             │
│  Control Plane Uptime (99.999%)                            │
│  Budget: 26.3 sec/month           Used: 0 sec (100%)       │
│  Last failover test: 7 days ago   Failover time: 1.8 sec   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Dashboard 2: VPP Market Delivery Burn Rate

```
┌─────────────────────────────────────────────────────────────┐
│ VPP MARKET DELIVERY SLO                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Frequency Regulation Delivery (≥ 95%)                     │
│  Budget: 5% shortfall allowed     Used: 2.1% (OK)         │
│  1h: ████████░░ 92.3% delivered   7d avg: 96.8%           │
│                                                             │
│  Energy Market Delivery (≥ 98%)                            │
│  Budget: 2% shortfall allowed     Used: 0.4% (OK)         │
│  Today: 99.6% delivered           MTD: 99.2%              │
│                                                             │
│  VPP Fleet Health                                          │
│  Online DERs: 4,712,340 / 5,000,000 (94.2%)               │
│  Available capacity: 48.7 MW / 52.1 MW expected            │
│  Dispatched: 22.3 MW   Reserve: 26.4 MW                   │
│  Non-compliance rate: 7.8% (below 15% threshold)          │
│                                                             │
│  Revenue Impact                                            │
│  Today's revenue: $127,400    Penalties avoided: $12,800   │
│  MTD: $3.2M revenue   $89K penalties (2.8% of revenue)    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Dashboard 3: Renewable Forecast Accuracy

```
┌─────────────────────────────────────────────────────────────┐
│ RENEWABLE FORECAST ACCURACY                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Solar Forecast (200 plants)                               │
│  MAE (24h): 6.2% of nameplate    Bias (7d): +1.1%        │
│  Regime: Clear (HIGH confidence)                           │
│  Ramp alerts (24h): 2 issued, 2 verified (100% hit rate)  │
│                                                             │
│  Wind Forecast (200 plants)                                │
│  MAE (24h): 9.8% of nameplate    Bias (7d): -0.3%        │
│  Regime: Stable (HIGH confidence)                          │
│  Ramp alerts (24h): 0 issued                              │
│                                                             │
│  Calibration (PIT Histogram)                               │
│  Solar KS p-value: 0.23 (GOOD)   Wind KS p-value: 0.08   │
│  ⚠ Wind calibration degrading — retrain recommended       │
│                                                             │
│  NWP Feed Status                                           │
│  GFS: ✓ (42 min ago)    HRRR: ✓ (18 min ago)             │
│  ECMWF: ✓ (3.2 h ago)  NAM: ⚠ (6.1 h ago — stale)       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Incident Playbooks

### Playbook 1: Grid Control Plane Failover (SEV-1)

**Trigger:** Primary state estimator and OPF engine both unavailable (dual failure or primary control center loss)

**Automated response (0–30 seconds):**
1. Backup control center detects primary heartbeat loss (5-second timeout)
2. Backup state estimator resynchronizes from replicated SCADA data (< 10 seconds)
3. Backup OPF engine initializes with last-known dispatch as warm start
4. SCADA gateway re-routes telemetry to backup control center
5. All downstream consumers (contingency screener, VPP controller) re-point to backup

**Manual response (30 seconds – 30 minutes):**
1. On-call grid operator verifies backup operations on control room displays
2. Confirm contingency screening is active and RAS are armed
3. Notify NERC reliability coordinator of control center failover
4. Assess primary failure root cause; determine if safe to fail back

**Recovery:**
1. Restore primary control center (hours to days depending on failure)
2. Resynchronize primary from backup state
3. Failback during low-risk period (overnight, mild weather)
4. Post-incident review within 72 hours

### Playbook 2: Renewable Forecast Degradation (SEV-2)

**Trigger:** Forecast MAE exceeds 15% of nameplate for >6 hours across >20% of plants, OR ramp event hit rate drops below 60%

**Automated response:**
1. Forecast confidence score set to LOW for all affected plants
2. OPF engine increases spinning reserve by 50% automatically
3. Market bidding optimizer widens bid price ranges (bid more conservatively)

**Manual response (< 30 minutes):**
1. Investigate NWP feed status: are all feeds current? Any feeds stale or corrupted?
2. Check for NWP model updates by meteorological agencies (common cause of sudden accuracy drops)
3. Verify weather regime classification: is the system correctly identifying regime transitions?
4. If NWP model change detected: trigger emergency model retraining (2-hour process with 30 days of data)

**Recovery:**
1. Deploy retrained model via canary deployment (10% of plants, then 50%, then 100%)
2. Monitor calibration (PIT histogram) for 48 hours
3. Update forecast confidence scoring if regime thresholds changed

### Playbook 3: AMI Pipeline Backlog (SEV-3)

**Trigger:** AMI queue depth exceeds 10M readings for >30 minutes

**Automated response:**
1. Level 3/4 back-pressure activated (see back-pressure patterns)
2. AMI head-end signaled to delay non-critical collection windows
3. Speed layer continues processing critical meters (revenue, net metering)

**Manual response (< 1 hour):**
1. Identify cause: midnight surge exceeding capacity? Network issue? Consumer failure?
2. If capacity: verify auto-scaled worker count; manually add workers if auto-scale failed
3. If network: check message queue health; verify consumer group assignments
4. Notify billing operations of potential delay in meter read availability

**Recovery:**
1. Drain queue backlog (typically 2-4 hours at 3x consumer capacity)
2. Verify billing reads are complete before daily billing cycle deadline
3. Assess whether theft detection daily batch should run or defer to next day

### Playbook 4: Mass DER Connectivity Loss (SEV-2)

**Trigger:** >10% of DER fleet (>500,000 devices) lose heartbeat simultaneously

**Automated response:**
1. VPP controller recalculates available capacity excluding offline devices
2. Market positions reduced proportionally; emergency buy-back from spot market if needed
3. Frequency regulation commitments for next interval zeroed if insufficient capacity

**Manual response (< 15 minutes):**
1. Determine scope: all DER types or specific manufacturer/protocol?
2. If manufacturer-specific: check manufacturer cloud API status
3. If protocol-specific: check DER communication gateway health per protocol
4. If geographic: check regional network infrastructure

**Recovery:**
1. Devices reconnect automatically when communication path restored
2. VPP controller gradually re-includes reconnected devices (ramp-up over 10 minutes to avoid dispatch oscillation)
3. Post-incident: assess whether manufacturer SLA was met; file claim if applicable

---

## AI/ML Component Observability

### Grid Optimization ML Metrics

| Metric | Description | Target | Alert |
|---|---|---|---|
| `opf.socp_relaxation_gap` | Gap between SOCP relaxation and AC feasibility check | < 0.1% | > 1% (relaxation not tight; solution may be infeasible) |
| `opf.lookahead_prediction_error_mw` | Difference between predicted state (look-ahead) and actual state | < 50 MW RMS | > 100 MW (prediction model degraded) |
| `opf.dispatch_oscillation_count` | Number of generator set-point reversals in 1 hour | < 5 | > 15 (control instability) |
| `se.convergence_failure_rate` | % of SCADA cycles where state estimator does not converge | < 0.01% | > 0.1% |

### Renewable Forecast ML Metrics

| Metric | Description | Target | Alert |
|---|---|---|---|
| `forecast.regime_classification_accuracy` | % of time-steps where weather regime was correctly identified | > 90% | < 80% |
| `forecast.quantile_crossing_rate` | % of forecasts where P10 > P50 or P50 > P90 (impossible) | 0% | > 0% (model malfunction) |
| `forecast.nwp_feature_drift` | Distribution shift of NWP input features vs. training data | KS p > 0.05 | KS p < 0.01 (trigger retraining) |
| `forecast.ensemble_member_weight_entropy` | How evenly the ensemble weights NWP models (high entropy = balanced) | > 0.7 | < 0.3 (over-reliance on single NWP model) |

### Theft Detection ML Metrics

| Metric | Description | Target | Alert |
|---|---|---|---|
| `theft.precision_at_k` | Precision of top-200 alerts (matching field investigation capacity) | > 40% | < 25% (wasted field visits) |
| `theft.alert_volume_daily` | Number of alerts generated per day | 100–500 | > 5,000 (model drift / mass false positive) |
| `theft.label_acquisition_rate` | Confirmed theft labels obtained per week from field investigations | > 30 | < 10 (label pipeline stalled) |
| `theft.exploration_investigation_pct` | % of field visits allocated to exploration (non-flagged meters) | 10–15% | < 5% (under-exploring) |

---

## Correlation Analysis

### Cross-Signal Correlation Table

| Signal A | Signal B | Correlation | Diagnostic Value |
|---|---|---|---|
| `forecast.mae_mw` increase | `opf.dispatch_change_mw` increase | Strong positive | Forecast error causes larger dispatch corrections; root cause is forecast, not OPF |
| `der.heartbeat_timeout_count` spike | `vpp.delivery_vs_commitment_pct` drop | Strong positive | Device connectivity drives delivery shortfall; check gateway health before blaming VPP algorithm |
| `ami.queue_depth` increase | `theft.alert_volume_daily` decrease | Negative lag (24h) | AMI backlog delays theft detection batch; theft alerts will rebound after queue drains |
| `equipment.transformer.oil_temp_c` rise | `opf.constraint_violations` increase | Lagged positive (2-6h) | Transformer heating precedes thermal violations; pre-emptive load reduction when temp trends up |
| `grid.renewable_penetration_pct` increase | `opf.relaxation_gap_pct` increase | Weak positive | High renewable penetration increases voltage variability; SOCP relaxation may not be tight near voltage bounds |
| `se.bad_data_count` increase | `se.chi_squared` increase | Strong positive | Bad data degrades state estimation quality; investigate sensor array when both metrics spike |
| `dr.event_count_mtd` increase | `dr.participation_rate_pct` decrease | Moderate negative | Customer fatigue: more frequent events reduce participation; throttle DR event frequency |

### Diagnostic Query Flow: VPP Delivery Shortfall Investigation

```
START: vpp.delivery_vs_commitment_pct < 90%
  │
  ├─ Check: der.online_count
  │   └─ If < 90% → DIAGNOSIS: Device connectivity issue
  │       → Check gateway health, manufacturer API status
  │
  ├─ Check: vpp.dispatch_compliance_pct
  │   └─ If < 80% → DIAGNOSIS: Device non-compliance
  │       → Check firmware versions, customer override rates
  │
  ├─ Check: forecast accuracy for dispatch interval
  │   └─ If MAE > 15% → DIAGNOSIS: Forecast-driven capacity shortfall
  │       → Review NWP feeds, weather regime, model calibration
  │
  └─ Check: vpp.battery_avg_soc_pct
      └─ If < 20% → DIAGNOSIS: Fleet exhaustion
          → Review dispatch history, reduce future commitments
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
