# 14.12 AI-Native Field Service Management for SMEs — Observability

## Observability Philosophy

Field service management observability is unique because the system's state is distributed across three fundamentally different environments: (1) the cloud backend where business logic runs, (2) the mobile edge where technicians operate (often offline), and (3) IoT sensors in customer premises. Traditional observability (metrics, logs, traces on servers) misses two-thirds of the system. The observability strategy must bridge all three environments:

- **Cloud tier:** Standard metrics, structured logs, distributed traces — full visibility
- **Mobile tier:** Sparse telemetry (syncs only when online); batch-uploaded crash reports; device health metrics reported during sync; "dark period" between syncs has no observability
- **IoT tier:** Telemetry pipeline health only; individual sensor observability is the equipment monitoring system's job, not the platform's observability concern

**Key insight:** The most dangerous failure mode is silent — a technician's device working offline with accumulated changes that never sync. The observability system must actively detect "devices gone dark" (no sync for >X hours) as a first-class alert category.

---

## Metrics

### Business Metrics (Real-Time Dashboard)

| Metric | Definition | Granularity | Alert Condition |
|---|---|---|---|
| **Jobs completed per hour** | Completed jobs / active hours | Per tenant, per fleet | < 60% of historical average for time slot |
| **First-time fix rate** | Jobs resolved in single visit / total completed | Per tenant, per tech, per job type | < 85% rolling 7-day average |
| **Average response time** | Time from job creation to technician arrival | Per tenant, per priority level | Emergency > 2 hrs; Urgent > 4 hrs; Standard > 24 hrs |
| **Fleet utilization** | (Job time + travel time) / total available hours | Per tenant, per day | < 60% (underutilized) or > 95% (burnout risk) |
| **Customer satisfaction (CSAT)** | Post-service rating average | Per tenant, per tech | < 4.0/5.0 rolling 30-day |
| **Revenue per technician-hour** | Total invoice value / billable hours | Per tenant, per tech | < 70% of tenant average |
| **Invoice accuracy rate** | Invoices without manual correction / total | Per tenant | < 99% over any 24-hour period |
| **ETA accuracy** | Actual arrival within ±15 min of predicted | Per fleet | < 80% over any 24-hour period |

### System Performance Metrics

| Metric | Collection Method | Alert Threshold |
|---|---|---|
| **Scheduling optimization latency** | Timer around ALNS solver | P95 > 5 seconds for 5 consecutive minutes |
| **Sync round-trip time** | Timer from sync request to acknowledgment | P95 > 10 seconds for 10 minutes |
| **API response latency** | Per-endpoint latency histogram | P99 > 1 second for any endpoint |
| **IoT telemetry ingestion lag** | Timestamp difference: sensor time vs. processing time | P95 > 60 seconds |
| **Notification delivery latency** | Time from trigger to provider acknowledgment | P95 > 45 seconds |
| **Database query latency** | Per-query-type histograms | P95 > 100 ms for indexed queries |
| **Cache hit rate** | Hits / (hits + misses) per cache namespace | < 80% for schedule cache; < 70% for distance matrix cache |
| **Error rate** | 5xx responses / total responses per service | > 0.5% over 5-minute window |
| **Mobile app crash rate** | Crash reports / active sessions | > 0.5% over 24 hours |

### AI/ML Model Metrics

| Metric | Definition | Alert Condition |
|---|---|---|
| **Schedule optimization gap** | Estimated gap between ALNS solution and theoretical optimal | > 10% average gap over 24 hours |
| **Job duration prediction accuracy** | MAPE (Mean Absolute Percentage Error) of predicted vs. actual duration | MAPE > 30% rolling 7-day |
| **Predictive maintenance precision** | True positive failures / total predicted failures | Precision < 80% rolling 30-day |
| **Predictive maintenance recall** | Detected failures / total actual failures | Recall < 90% rolling 30-day |
| **ETA prediction MAE** | Mean absolute error of predicted vs. actual arrival time | MAE > 20 minutes rolling 7-day |
| **Model inference latency** | Time for anomaly detection model to process one reading | P95 > 500 ms |
| **Data drift score** | Statistical drift between training and production feature distributions | Drift score > 0.2 (PSI) |

---

## Logging

### Structured Log Schema

All services emit structured JSON logs with a consistent schema:

```
{
  "timestamp": "ISO-8601",
  "level": "INFO | WARN | ERROR | DEBUG",
  "service": "scheduling-engine | job-service | sync-service | ...",
  "tenant_id": "UUID",
  "trace_id": "UUID (distributed trace)",
  "span_id": "UUID",
  "user_id": "UUID (nullable)",
  "device_id": "string (nullable)",
  "event_type": "string (structured event name)",
  "message": "human-readable description",
  "metadata": {
    // Event-specific key-value pairs
  },
  "duration_ms": "number (for timed operations)",
  "error": {
    "code": "string",
    "message": "string",
    "stack_trace": "string (ERROR level only)"
  }
}
```

### Log Categories and Retention

| Category | Event Types | Volume (est.) | Retention |
|---|---|---|---|
| **Scheduling decisions** | Job assignment, re-optimization trigger, constraint violations, dispatcher overrides | ~3M events/day | 30 days hot, 1 year cold |
| **Sync operations** | Push/pull requests, conflict resolutions, binary uploads, sync failures | ~12M events/day | 14 days hot, 90 days cold |
| **Job lifecycle** | State transitions, status updates, photo captures, invoice generation | ~10M events/day | 30 days hot, 1 year cold |
| **IoT pipeline** | Telemetry batches, anomaly detections, alert generations, model predictions | ~50M events/day | 7 days hot, 30 days cold |
| **Customer notifications** | Send attempts, delivery confirmations, failures, template renders | ~10M events/day | 14 days hot, 90 days cold |
| **Security events** | Auth attempts, permission checks, suspicious activity, device management | ~5M events/day | 90 days hot, 3 years cold |
| **API access** | Request/response logs (headers, status, latency; no PII in logs) | ~150M events/day | 7 days hot, 30 days cold |

### Critical Log Events (Always Captured)

| Event | Trigger | Action |
|---|---|---|
| `scheduling.unassignable_job` | No feasible technician for a job | Alert dispatcher; log all constraint violations that prevented assignment |
| `sync.conflict_resolution` | CRDT merge produced a non-trivial resolution | Log both conflicting values, resolution strategy, and result |
| `sync.data_loss_risk` | Device pending changes exceed 1,000 items | Alert; investigate why device hasn't synced |
| `invoice.pricing_mismatch` | Device-computed total differs from server-computed | Log both totals, pricing versions, and line item differences |
| `payment.failure` | Payment processing failed | Log failure reason, gateway response, retry status |
| `iot.false_positive_detected` | Predicted failure did not occur within prediction window | Log model inputs, prediction, actual outcome for model retraining |
| `auth.suspicious_pattern` | Multiple failed logins, unusual access time, new device | Trigger security review; potentially lock account |

---

## Distributed Tracing

### Trace Architecture

Every request receives a unique trace_id at the API gateway, propagated through all downstream service calls via headers. Traces capture the full request lifecycle:

```
Trace: "Create and schedule a new job"
├── API Gateway (2ms) — auth, rate limit, routing
├── Job Service (15ms) — validate, enrich, persist
│   ├── Database Write (5ms) — insert job record
│   └── Event Bus Publish (3ms) — job.created event
├── Scheduling Engine (2,800ms) — optimization
│   ├── Technician Query (8ms) — fetch candidates
│   ├── Distance Matrix (45ms) — travel time computation
│   │   ├── Cache Lookup (2ms) — 78% hit rate
│   │   └── Maps API Call (40ms) — cache miss entries
│   ├── ALNS Solver (2,700ms) — optimization iterations
│   │   ├── Destroy Phase (800ms) — worst removal
│   │   ├── Repair Phase (1,600ms) — regret insertion
│   │   └── Accept Check (300ms) — simulated annealing
│   └── Schedule Update (45ms) — persist new assignments
├── Notification Service (120ms) — customer + technician notifications
│   ├── Template Render (15ms)
│   ├── SMS Send (80ms) — provider API call
│   └── Push Notification (25ms) — to technician device
└── Sync Service (8ms) — queue update for technician device
Total: ~3,000ms
```

### Key Trace Paths

| Path | Services Involved | SLO | Critical for |
|---|---|---|---|
| Job creation → technician assignment | Gateway → Job → Scheduling → Route → Notification | < 5s end-to-end | Core scheduling SLO |
| Technician status update → customer ETA | Mobile App → Sync → Job → ETA Calculator → Notification | < 30s end-to-end | Customer experience |
| IoT alert → work order creation | IoT Pipeline → Anomaly Detection → Job → Scheduling | < 5 min end-to-end | Predictive maintenance value |
| Invoice generation → accounting sync | Mobile App → Sync → Invoice → Accounting Webhook | < 1 hr end-to-end | Financial accuracy |
| Device sync (full cycle) | Mobile App → Sync → Job + Invoice + Photos | < 15s for data; < 60s with photos | Technician productivity |

### Trace Sampling Strategy

| Traffic Type | Sampling Rate | Rationale |
|---|---|---|
| Errors (5xx, failures) | 100% | Every error trace is captured for debugging |
| Slow requests (> 2× P50) | 100% | All slow requests traced for performance analysis |
| Scheduling optimization | 10% | High volume but critical path; sample for cost control |
| Sync operations | 5% | Very high volume; statistical sampling sufficient |
| IoT telemetry | 1% | Extremely high volume; sample only for pipeline health |
| Normal API requests | 2% | Baseline performance monitoring |

---

## Alerting Strategy

### Alert Severity Levels

| Level | Response Time | Notification | Examples |
|---|---|---|---|
| **P1 — Critical** | < 15 min | PagerDuty + phone call to on-call | Scheduling engine down; data loss detected; security breach |
| **P2 — High** | < 1 hour | PagerDuty + Slack alert | Sync service degraded; payment processing failures > 5%; notification delivery < 90% |
| **P3 — Medium** | < 4 hours | Slack alert | ETA accuracy < 80%; first-time-fix rate drop; model drift detected |
| **P4 — Low** | Next business day | Email + dashboard flag | Cache hit rate decline; disk usage trending; certificate expiry < 30 days |

### Alert Deduplication and Grouping

- **Window-based dedup**: Same alert suppressed for 15 minutes after first fire (prevents alert storm during cascading failures)
- **Tenant grouping**: If > 10 tenants trigger the same alert, escalate to platform-level incident (not 10 separate alerts)
- **Dependency-aware suppression**: If database is down, suppress all downstream service alerts (root cause: database, not individual services)
- **Business hours adjustment**: P3/P4 alerts during off-hours are held until next business day unless they trend toward P1/P2

### Key Alert Definitions

```
ALERT: SchedulingEngineLatencyHigh
  CONDITION: scheduling_optimization_latency_p95 > 5s FOR 5 minutes
  SEVERITY: P2
  ACTION: Check ALNS iteration count; verify distance matrix cache; check tenant schedule size
  RUNBOOK: /runbooks/scheduling-latency

ALERT: SyncServiceFailureRate
  CONDITION: sync_failure_rate > 1% FOR 10 minutes
  SEVERITY: P2
  ACTION: Check database connectivity; verify CRDT merge logic; check for schema version mismatch
  RUNBOOK: /runbooks/sync-failures

ALERT: IoTPipelineBacklog
  CONDITION: iot_telemetry_processing_lag > 5 minutes FOR 15 minutes
  SEVERITY: P3
  ACTION: Check stream processing cluster; verify anomaly model inference latency; scale consumers
  RUNBOOK: /runbooks/iot-backlog

ALERT: InvoicePricingMismatch
  CONDITION: invoice_pricing_mismatch_rate > 0.5% FOR 1 hour
  SEVERITY: P3
  ACTION: Check pricing version distribution on devices; verify price book sync; check for race condition
  RUNBOOK: /runbooks/pricing-mismatch

ALERT: PredictiveMaintenanceFalsePositiveSpike
  CONDITION: pm_false_positive_rate > 15% FOR 7 days
  SEVERITY: P3
  ACTION: Check model input data quality; verify sensor calibration; investigate data drift
  RUNBOOK: /runbooks/pm-false-positives
```

---

## Dashboards

### Operational Dashboard (Dispatcher View)

| Panel | Visualization | Data Source |
|---|---|---|
| Fleet map | Real-time map with technician locations and job pins | GPS stream + job records |
| Schedule heatmap | Time-of-day × technician grid showing utilization | Schedule entries |
| Unassigned jobs | List of jobs pending assignment with priority and SLA countdown | Job service |
| Active alerts | IoT alerts requiring attention | Anomaly detection pipeline |
| Today's KPIs | Jobs completed, avg response time, CSAT, fleet utilization | Aggregated metrics |

### Platform Engineering Dashboard

| Panel | Visualization | Data Source |
|---|---|---|
| Service health grid | Green/yellow/red per service | Health checks |
| Request latency heatmap | Time × endpoint latency percentiles | Distributed traces |
| Scheduling engine capacity | CPU, memory, optimization latency per instance | Instance metrics |
| Sync pipeline health | Success rate, latency, conflict rate, queue depth | Sync service metrics |
| IoT pipeline throughput | Messages/sec, processing lag, anomaly rate | IoT pipeline metrics |
| Error rate trends | Per-service error rates over 24 hours | Log aggregation |
| Database performance | Query latency, connection pool utilization, replication lag | Database metrics |

### AI/ML Model Dashboard

| Panel | Visualization | Data Source |
|---|---|---|
| Scheduling quality score | Optimization gap trend over time | Scheduling engine logs |
| Duration prediction accuracy | MAPE trend per job type | Job completion data vs. predictions |
| Predictive maintenance ROC | Precision-recall curve, updated weekly | Prediction vs. outcome data |
| ETA accuracy distribution | Histogram of (actual - predicted) arrival times | ETA predictions vs. GPS arrival |
| Data drift monitor | Feature distribution comparison (training vs. production) | Feature store + production data |
| Model version tracker | Current model versions per equipment family; last retrain date | ML pipeline metadata |

---

## SLO Dashboards

### Dashboard 1: Scheduling Engine SLO Burn Rate

| Panel | Metric | Visualization | Alert Integration |
|---|---|---|---|
| Assignment latency burn rate | (P95 >3s count) / (total assignments) rolling 1h | Burn-rate chart with 1h, 6h, 24h windows; threshold lines at 1×, 3×, 5× burn | 1h burn >3× → P2; 6h burn >1.5× → P3 |
| Schedule optimization success rate | (Successful optimizations) / (total requests) | Stacked bar: success vs. timeout vs. error | Success <99% for 15m → P2 |
| ALNS iteration distribution | Histogram of iteration counts per optimization | Box plot by disruption severity (quick/standard/deep) | >10% of standard requests using 0 iterations → P3 (back-pressure forcing degradation) |
| Unassignable job rate | Jobs returning no feasible assignment / total jobs | Time series with daily moving average | >2% unassignable → P3; >5% → P2 |
| Churn penalty score | Average schedule disruption score per optimization | Time series with per-tenant breakdown | Rising trend over 7 days → investigate constraint tightening |

### Dashboard 2: Offline Sync SLO Burn Rate

| Panel | Metric | Visualization | Alert Integration |
|---|---|---|---|
| Sync success rate burn rate | (Failed syncs) / (total syncs) rolling 1h | Burn-rate chart; threshold at 0.01% failure budget | 1h burn >5× → P2 |
| Sync latency distribution | P50, P90, P95, P99 of full sync round-trip time | Percentile line chart over 24h | P95 >10s for 10m → P2 |
| CRDT conflict rate | Conflicts resolved / total fields merged | Stacked area: by conflict type (dispatcher-wins, technician-wins, merge) | Sudden spike >2× baseline → investigate |
| Photo upload backlog | Pending photo uploads across all devices | Gauge with zones (green <10K, yellow <50K, red >50K) | >100K pending for >1h → P3 |
| Device sync health | Per-device last-sync-age distribution | Histogram bucketed by hours since last sync | >100 devices with >24h since sync → P3 |

### Dashboard 3: Predictive Maintenance SLO

| Panel | Metric | Visualization | Alert Integration |
|---|---|---|---|
| False positive rate (rolling 30d) | Predicted failures that didn't occur / total predictions | Trend line with 95% target threshold | >5% for 7d rolling → P3 |
| Detection recall (rolling 30d) | Actual failures detected / total actual failures | Trend line with 90% target threshold | <90% for 7d → P2 |
| Work order generation rate | Auto-created preventive work orders per day | Time series with 7d moving average | Sudden drop >50% → P3 (pipeline issue) |
| Telemetry pipeline lag | Processing lag (newest processed vs. current time) | Real-time gauge with zones | >5 min → P3; >10 min → P2 |
| Model inference latency | P95 anomaly detection inference time | Percentile chart | P95 >500ms → P3 |

---

## Incident Playbooks

### Playbook 1: Scheduling Engine Unavailable (SEV-1)

**Detection:** Health check failures from scheduling engine instances; assignment latency SLO breach; dispatcher dashboard shows "scheduling unavailable" banner.

**Immediate actions (0-5 min):**
1. Verify scope: single instance or fleet-wide?
2. If single instance: check standby promotion status; if not promoting, manually trigger failover
3. If fleet-wide: check infrastructure (database connectivity, network, dependency health)
4. Enable manual dispatch mode: dispatchers can assign jobs through dashboard override (bypasses optimizer)
5. Page scheduling engine on-call + platform on-call

**Diagnosis (5-15 min):**
1. Check scheduling engine logs for OOM kills, crash loops, or deadlocks
2. Verify WAL integrity: can standby replay from last checkpoint?
3. Check tenant rebalancing status: did a recent scale-out operation leave orphaned tenants?
4. Review recent deployments: was a new ALNS operator version deployed?

**Resolution:**
- Instance crash: verify standby promoted; spin up new standby from WAL
- OOM: increase memory limit; identify tenant with abnormally large schedule (>500 daily jobs)
- Deadlock: restart instance from WAL checkpoint; file bug with reproduction trace
- Bad deployment: rollback to previous version; add to pre-deployment smoke test suite

### Playbook 2: Sync Service Degraded (SEV-2)

**Detection:** Sync success rate below 99.95%; sync latency P95 above 15 seconds; mobile app "sync failed" reports increasing.

**Immediate actions (0-10 min):**
1. Check sync service instance health: CPU, memory, connection count
2. Check database connectivity and query latency (sync depends on DB reads/writes)
3. Activate back-pressure Level 1 if not already triggered (defer photo uploads)
4. Check for sync storm indicators: is a mass reconnection event occurring?

**Diagnosis (10-30 min):**
1. Profile CRDT merge performance: are specific field types causing expensive merges?
2. Check for schema version mismatch: did a mobile app update introduce new field types?
3. Verify connection pool health: are connections being exhausted by long-running merge operations?
4. Check for duplicate device IDs: are two devices syncing with the same device certificate?

**Resolution:**
- High load: auto-scale sync service; activate back-pressure Level 2 if needed
- Schema mismatch: force-update mobile app; add migration handler for new fields
- Connection exhaustion: increase pool size; add timeout for merge operations
- Recovery: monitor sync success rate; deactivate back-pressure levels as metrics improve

### Playbook 3: ETA Accuracy Degraded (SEV-3)

**Detection:** ETA accuracy SLO below 85% for 6 hours; customer complaints about late technicians increasing.

**Immediate actions (0-15 min):**
1. Check if degradation is fleet-wide or specific to a region/metro area
2. Verify maps API health: are distance matrix responses accurate?
3. Check for systematic job duration model drift: are predictions consistently high or low?

**Diagnosis (15-60 min):**
1. Compare predicted vs. actual job durations for the affected period: is the duration model stale?
2. Check for external factors: major road closures, weather events, construction zones
3. Verify Monte Carlo computation: are ETA updates being computed and pushed to customers?
4. Check distance matrix cache freshness: are stale travel times causing bad estimates?

**Resolution:**
- Maps API degraded: switch to cached/fallback distance estimates; widen ETA confidence intervals
- Duration model drift: trigger emergency model retrain on recent 7-day data; deploy within 24 hours
- External factors: temporarily increase duration buffer by 20% for affected metro areas
- Cache stale: force cache refresh for affected region; adjust TTL

### Playbook 4: IoT False Positive Spike (SEV-3)

**Detection:** Predictive maintenance false positive rate exceeds 10% for 7-day rolling window; SME tenants reporting "unnecessary service visits generated by AI."

**Immediate actions (0-30 min):**
1. Review recent model deployments: was a new anomaly detection model version rolled out?
2. Check if spike is equipment-family-specific or across all families
3. Temporarily increase economic gate threshold by 20% (require higher failure probability before generating work orders)

**Diagnosis (30 min - 4 hours):**
1. Analyze false positive cases: which gate(s) in the multi-gate pipeline are failing to filter?
2. Check for sensor calibration drift: are specific device batches producing skewed readings?
3. Compare feature distributions: has training data distribution diverged from production?
4. Check seasonal factors: spring HVAC startup patterns may differ from training data collected in winter

**Resolution:**
- Model version issue: rollback to previous model version
- Sensor calibration: flag affected device batch; recalibrate baselines
- Seasonal drift: retrain model with seasonal-aware features; add season as explicit input feature
- Gate threshold: adjust statistical/cross-metric/economic gates based on analysis; gradual threshold relaxation after fix confirmed

---

## AI/ML Component Observability

### Scheduling Optimization Model

| Metric | Definition | Normal Range | Action on Deviation |
|---|---|---|---|
| Solution quality gap | Cost of ALNS solution vs. theoretical lower bound | <5% for standard mode | >10% sustained → check operator weights; possible convergence failure |
| Operator selection distribution | Frequency of each destroy/repair operator | 60/40 split between exploration/exploitation | One operator >80% → weights stuck; reset adaptive weights |
| Constraint violation rate | Soft constraint violations in accepted solutions | <2% of assignments | >5% → constraint definitions may have changed; check tenant config |
| Warm-start effectiveness | Cost improvement from warm-start vs. cold-start | Warm-start 30-50% faster convergence | <10% → in-memory state may be stale; check WAL replay lag |

### Duration Prediction Model

| Metric | Definition | Normal Range | Action on Deviation |
|---|---|---|---|
| MAPE (mean absolute percentage error) | |predicted - actual| / actual | <25% for established job types | >35% sustained → trigger retrain; check for new job type patterns |
| Bias direction | Average (predicted - actual) | ±5 minutes | Systematic >10 min → model over/under-predicting; investigate covariates |
| Feature importance stability | Top-5 features by importance over time | Stable ranking week-over-week | Major shuffle → data distribution shift; investigate new patterns |
| Cold-start accuracy | MAPE for job types with <100 historical examples | <40% | >50% → fallback to equipment-family average; insufficient data for model |

### Predictive Maintenance Model

| Metric | Definition | Normal Range | Action on Deviation |
|---|---|---|---|
| Precision | True positives / (true positives + false positives) | >95% | <90% → tighten economic gate; retrain if sustained |
| Recall | True positives / (true positives + false negatives) | >90% | <85% → lower detection threshold cautiously; review missed failures |
| RUL estimation MAE | Mean absolute error of RUL prediction in days | <7 days | >14 days → retrain; check if equipment aging patterns have shifted |
| Data drift (PSI) | Population Stability Index between training and production features | <0.1 | >0.2 → significant drift; schedule retrain; investigate root cause |

---

## Correlation Analysis

### Cross-Signal Correlation Table

| Signal A | Signal B | Correlation | Diagnostic Value |
|---|---|---|---|
| Scheduling optimization latency spike | Distance matrix cache miss rate spike | Strong positive | Cache degradation causes optimizer to wait for maps API; root cause is cache |
| Sync failure rate increase | Database connection pool exhaustion | Strong positive | Sync service fails when it can't acquire DB connections; check pool sizing |
| ETA accuracy drop | Job duration prediction bias shift | Strong positive | Duration model drift propagates to ETA; retrain duration model first |
| IoT false positive spike | Seasonal temperature change | Moderate positive | Spring/fall transitions cause baseline shifts; add seasonal normalization |
| Customer CSAT drop | First-time-fix rate drop | Strong positive | Missing parts → return visits → dissatisfaction; check parts prediction model |
| Invoice pricing mismatch rate | Price book update frequency | Moderate positive | Frequent pricing changes while technicians are offline; extend tolerance window |
| Mobile app crash rate | Mobile database size | Moderate positive | Large local DB causes memory pressure; verify selective sync is Cutting off unnecessary steps old data |

### Diagnostic Query Patterns

```
INVESTIGATION: "Why is ETA accuracy degrading this week?"

Step 1: Check ETA accuracy by metro area
  → If localized: likely maps API data quality issue or local road network change
  → If fleet-wide: proceed to step 2

Step 2: Check job duration prediction accuracy (MAPE)
  → If MAPE increasing: duration model drift; trigger retrain
  → If MAPE stable: proceed to step 3

Step 3: Check distance matrix cache freshness and hit rate
  → If hit rate dropped: new locations entering the system; expand hot-zone computation
  → If hit rate stable: proceed to step 4

Step 4: Check for external factors
  → Major road closures, weather events, construction seasons
  → Increase duration/travel buffer for affected areas
```

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
