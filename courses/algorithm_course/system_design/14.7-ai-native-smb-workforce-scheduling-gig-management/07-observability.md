# 14.7 AI-Native SMB Workforce Scheduling & Gig Management — Observability

## Key Metrics

### Business Health Metrics (Golden Signals)

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| **Schedule generation success rate** | % of optimization requests that produce a feasible schedule | > 99% | < 97% for 5 min |
| **Schedule generation latency (p95)** | Time from "generate" click to schedule ready | < 10s | > 15s for 5 min |
| **Clock-in verification latency (p99)** | Time from clock-in request to pass/fail response | < 2s | > 3s for 1 min |
| **Notification delivery latency (p95)** | Time from event trigger to notification receipt | < 5s | > 15s for 5 min |
| **API error rate** | % of API requests returning 5xx errors | < 0.1% | > 0.5% for 2 min |
| **API latency (p95)** | Response time for read API endpoints | < 200ms | > 500ms for 5 min |
| **Gig shift fill rate** | % of broadcast shifts filled within 60 minutes | > 80% | < 60% for 1 hour |
| **Compliance validation latency (p95)** | Time to validate a schedule against the rule set | < 1s | > 3s for 5 min |

### Solver Metrics

| Metric | Description | Why It Matters |
|---|---|---|
| **Solver queue depth** | Number of optimization requests waiting for a worker | Indicates capacity pressure; triggers auto-scaling |
| **Solver time utilization** | % of time budget used before returning best solution | Low utilization = easy problems (solver found optimal quickly); 100% utilization = hard problems or insufficient capacity |
| **Solution quality score** | Multi-objective score of the returned schedule (0–1) | Tracks whether solver improvements translate to better schedules |
| **Infeasibility rate** | % of requests where no feasible solution exists | High rate indicates data quality issues (conflicting availability, insufficient staff) |
| **Constraint violation count** | Number of soft constraint violations in the best solution | Tracks trade-off quality; should trend down as solver improves |
| **Problem decomposition rate** | % of requests that required problem decomposition (large businesses) | Capacity planning signal for complex tenants |

### Demand Forecasting Metrics

| Metric | Description | Target |
|---|---|---|
| **MAPE (Mean Absolute Percentage Error)** | Forecast accuracy per location per day-of-week | < 15% (established businesses), < 25% (cold start) |
| **Forecast bias** | Systematic over/under-prediction (should be near zero) | ± 5% |
| **Cold start convergence** | Days until a new business reaches < 20% MAPE | < 21 days |
| **Feature staleness** | Age of the most recent POS data point used in forecasting | < 24 hours |
| **Model retraining frequency** | How often the forecasting model is updated per business | Weekly for active businesses |

### Attendance and Compliance Metrics

| Metric | Description | Target |
|---|---|---|
| **GPS spoofing detection rate** | % of clock-in events flagged as potential spoofing | Baseline tracking; < 0.5% expected |
| **False positive rate (spoofing)** | % of flagged events that were legitimate | < 5% |
| **Biometric verification failure rate** | % of biometric checks that fail | < 3% (higher indicates lighting or device issues) |
| **Compliance violation rate** | Violations per 1000 employee-shifts | < 2 |
| **Premium pay triggered** | Total premium pay liability across all tenants (predictive scheduling) | Trend monitoring |
| **Overtime hours ratio** | Overtime hours as % of total scheduled hours | Trend monitoring per tenant |

---

## Logging Strategy

### Log Categories

| Category | Log Level | Content | Retention |
|---|---|---|---|
| **Schedule lifecycle** | INFO | Schedule created, optimized, published, modified events with version, actor, and tenant | 90 days (hot), 7 years (cold archive for compliance) |
| **Compliance events** | INFO/WARN | Validation results, violations detected, overrides applied | 7 years (regulatory requirement) |
| **Clock-in events** | INFO | Clock-in/out with GPS, biometric result, geofence pass/fail | 90 days (hot), 7 years (cold for labor disputes) |
| **Solver execution** | DEBUG | Constraint propagation steps, search iterations, solution quality progression | 7 days (debugging only) |
| **Gig marketplace** | INFO | Broadcast, match, accept, reject, no-show events | 1 year |
| **API access** | INFO | Request/response metadata (no PII in logs), latency, status code | 30 days |
| **Security events** | WARN/ERROR | Failed authentication, authorization denied, spoofing detected, anomalous access patterns | 1 year |
| **Integration events** | INFO/ERROR | POS webhook received, payroll export completed, weather API called | 30 days |

### Structured Log Format

All logs follow a structured JSON format:

```
{
  "timestamp": "ISO-8601",
  "level": "INFO|WARN|ERROR",
  "service": "schedule-service",
  "tenant_id": "uuid",
  "trace_id": "uuid",
  "span_id": "uuid",
  "event_type": "schedule.published",
  "actor_id": "uuid",
  "actor_role": "manager",
  "resource_type": "schedule",
  "resource_id": "uuid",
  "details": { ... },
  "duration_ms": 145
}
```

**PII scrubbing:** Employee names, phone numbers, and addresses are never included in logs. Logs reference employees by UUID only. A separate, access-controlled PII lookup is available for authorized incident responders.

**Tenant isolation in logs:** Log queries are always scoped by tenant_id. The log aggregation system enforces tenant isolation—a support engineer investigating Tenant A's issues cannot accidentally see Tenant B's logs.

---

## Distributed Tracing

### Trace Propagation

Every operation propagates a trace context (W3C Trace Context standard) across all services:

```
Schedule generation trace:
  API Gateway (parse request, authenticate)
    → Schedule Service (orchestrate generation)
      → Demand Forecast Service (fetch 14-day forecast)
      → Availability Service (fetch employee availability)
      → Compliance Engine (fetch applicable rules)
      → Solver Pool (submit optimization)
        → Solver Worker (constraint propagation phase)
        → Solver Worker (local search phase)
      → Compliance Engine (validate solution)
    → Schedule Database (persist draft)
    → API Gateway (serialize response)
```

### Critical Trace Paths

| Trace Path | Expected Duration | Alert If |
|---|---|---|
| Schedule generation (end-to-end) | 5–10s | > 15s |
| Clock-in verification (end-to-end) | 100–500ms | > 2s |
| Shift swap validation | 200–500ms | > 1s |
| Gig broadcast → first worker notified | 1–5s | > 10s |
| Schedule publish → last notification sent | 10–60s (depends on employee count) | > 120s |
| POS webhook → forecast update | 5–30s | > 60s |

### Trace Sampling Strategy

- **100% tracing** for: schedule generation, compliance violations, security events, error responses.
- **10% sampling** for: clock-in events (high volume, most are routine), read API calls.
- **1% sampling** for: POS webhook processing, notification delivery (extremely high volume).
- **Adaptive sampling:** If error rate for a service exceeds 1%, sampling rate increases to 100% for that service until errors resolve.

---

## Alerting Strategy

### Alert Severity Levels

| Severity | Response Time | Notification Channel | Examples |
|---|---|---|---|
| **P0 — Critical** | 5 minutes | PagerDuty + phone call | Clock-in service down; compliance engine unavailable; cross-tenant data leak detected |
| **P1 — High** | 30 minutes | PagerDuty + Slack | Schedule generation error rate > 5%; solver pool capacity < 25%; notification delivery backlog > 10K |
| **P2 — Medium** | 4 hours | Slack | Demand forecast MAPE > 25% for 10+ businesses; biometric failure rate > 10%; integration sync failures |
| **P3 — Low** | Next business day | Email | Compliance rule update pending deployment; model retraining job failed; storage approaching threshold |

### Key Alert Definitions

```
ALERT: clock_in_service_unavailable
  CONDITION: clock_in_success_rate < 95% for 2 minutes
  SEVERITY: P0
  IMPACT: Employees cannot clock in; timesheet gaps
  RUNBOOK: Check clock-in service health; verify database connectivity;
           check GPS verification backend; verify biometric service status
  AUTO-MITIGATION: Activate offline clock-in mode; notify affected managers

ALERT: solver_pool_exhausted
  CONDITION: solver_queue_depth > 100 for 5 minutes
  SEVERITY: P1
  IMPACT: Schedule generation delayed; managers waiting
  RUNBOOK: Check solver worker health; verify auto-scaling is functioning;
           check for pathological optimization requests consuming workers
  AUTO-MITIGATION: Scale solver pool to 2x current capacity;
                   deprioritize non-urgent (non-current-week) requests

ALERT: compliance_rule_version_mismatch
  CONDITION: location bound to rule version that has been superseded for > 7 days
  SEVERITY: P2
  IMPACT: Schedules validated against outdated rules
  RUNBOOK: Review rule changelog; test new rules against affected tenants;
           schedule batch migration of affected locations
  AUTO-MITIGATION: None (requires human review of legal interpretation)

ALERT: demand_forecast_degradation
  CONDITION: MAPE > 30% for a location for 3 consecutive days
  SEVERITY: P2
  IMPACT: Schedules may over/under-staff
  RUNBOOK: Check POS integration health; verify weather data freshness;
           check for business behavior change (new menu, renovation, etc.)
  AUTO-MITIGATION: Fall back to historical-average forecast;
                   notify manager that forecast confidence is reduced

ALERT: gig_fill_rate_drop
  CONDITION: gig_shift_fill_rate < 50% for 24 hours in a metro area
  SEVERITY: P2
  IMPACT: Businesses cannot fill gaps with gig workers
  RUNBOOK: Check gig worker pool size in affected metro;
           review rate competitiveness; check notification delivery
  AUTO-MITIGATION: Suggest rate increase to affected businesses;
                   expand broadcast radius
```

---

## Dashboards

### Operations Dashboard

| Panel | Visualization | Data Source |
|---|---|---|
| Schedule generation volume and latency | Time-series line chart (requests/min, p50/p95/p99 latency) | Metrics store |
| Solver pool utilization | Gauge (% workers busy) + queue depth time-series | Solver metrics |
| Clock-in event rate and verification latency | Time-series with shift-boundary annotations | Metrics store |
| Compliance validation results | Stacked bar (pass/warning/violation per hour) | Compliance engine logs |
| Notification delivery status | Fan chart (sent/delivered/failed per minute) | Notification service metrics |
| Integration health (POS, payroll, weather) | Status grid (green/yellow/red per integration) | Health check metrics |
| Error rate by service | Heatmap (service × time) | API gateway logs |

### Business Intelligence Dashboard (Customer-Facing)

| Panel | Audience | Content |
|---|---|---|
| **Labor cost vs. revenue** | Manager/Owner | Real-time labor cost as % of revenue; trend line; target band |
| **Schedule efficiency** | Manager | Actual staffing vs. predicted demand (over/under-staffing areas highlighted) |
| **Overtime tracker** | Manager | Per-employee hours accumulated this week; overtime risk indicators |
| **Gig usage summary** | Owner | Gig shifts filled, costs, reliability ratings, cost comparison vs. overtime |
| **Compliance scorecard** | Owner | Violations this month, premium pay liability, improvement trends |
| **Employee satisfaction proxies** | Owner | Swap request volume, time-off request patterns, schedule preference satisfaction rate |
| **Forecast accuracy** | Manager | Last week's predicted vs. actual demand; model confidence for next week |

### Debugging Dashboard (Engineering)

| Panel | Purpose |
|---|---|
| Solver execution traces | Detailed view of constraint propagation steps, search iterations, and solution quality progression for a specific optimization request |
| Cross-tenant isolation audit | Daily report of automated cross-tenant access tests with pass/fail results |
| GPS spoofing analysis | Map visualization of flagged clock-in events with sensor data details |
| Compliance rule coverage | Matrix of jurisdictions × rule types showing which rules are encoded and which are pending |
| Data pipeline lag | Per-source latency from event generation to availability in the forecast model |

---

## SLO Monitoring and Error Budget

### SLO Definitions with Error Budgets

| SLO | Target | Measurement Window | Error Budget (30-day) |
|---|---|---|---|
| Schedule generation success rate | 99.5% | Rolling 7 days | 0.5% = ~3,500 failures (at 100K weekly generations) |
| Clock-in verification availability | 99.99% | Rolling 30 days | 0.01% = ~150 missed verifications (at 5M daily events) |
| Compliance validation accuracy | 99.95% | Rolling 30 days | 0.05% = ~75 incorrect validations per month |
| Notification delivery (< 5s) | 99.0% | Rolling 7 days | 1% = ~50K delayed notifications per week |
| API latency (p95 < 200ms) | 99.5% | Rolling 7 days | 0.5% of requests may exceed 200ms |
| Gig shift fill rate (< 60 min) | 80% | Rolling 30 days | 20% of broadcast shifts may go unfilled |

### Error Budget Policies

```
IF error_budget_remaining > 50%:
  Normal operations; feature development proceeds
  Deployment frequency: daily

IF error_budget_remaining 25-50%:
  Caution mode; prioritize reliability work
  Deployment frequency: twice weekly with extra monitoring

IF error_budget_remaining 10-25%:
  Restriction mode; no non-critical deployments
  All engineering focus on reliability improvements
  Post-incident review for each budget-consuming event

IF error_budget_remaining < 10%:
  Freeze mode; emergency only
  Feature freeze until budget recovers
  Automated rollback of most recent deployments if budget trend is negative
```

---

## Compliance-Specific Observability

### Audit Trail Completeness Monitoring

The compliance audit trail is the single most legally critical data store. Monitoring ensures completeness:

| Audit Metric | Description | Alert Threshold |
|---|---|---|
| **Event capture rate** | % of schedule modifications that generate an audit event | < 100% (any gap triggers P0) |
| **Event ordering integrity** | % of events with correct causal ordering (no out-of-order events) | < 99.99% |
| **Actor attribution completeness** | % of events with a non-null, validated actor_id | < 100% |
| **Immutability verification** | Hash-chain integrity check of compliance event log | Any chain break triggers P0 |
| **Retention compliance** | % of records retained beyond the required retention period | < 100% triggers P1 |
| **Cross-reference integrity** | Schedule events match timesheet records for the same period | Divergence > 0.1% triggers P2 |

### Premium Pay Tracking Dashboard

For jurisdictions with predictive scheduling, every schedule change may incur premium pay. A dedicated dashboard tracks:

| Panel | Visualization | Purpose |
|---|---|---|
| **Premium pay liability (real-time)** | Running total per business per pay period | Manager awareness of change costs |
| **Change-to-premium correlation** | Scatter plot: change timing vs. premium amount | Identify patterns (late changes = expensive) |
| **Exemption utilization** | % of changes classified as exempt (employee-initiated, mutual) | Validate that exempt classification is not being over-applied |
| **Jurisdiction comparison** | Premium pay rates by jurisdiction (normalized per employee) | Identify high-compliance-cost locations |
| **Forecast impact** | Premium pay as % of total labor cost per location | Business intelligence for labor cost planning |

---

## Anomaly Detection

### Machine Learning-Based Anomaly Detection

Beyond threshold-based alerting, the platform uses ML-based anomaly detection for patterns that thresholds cannot capture:

| Anomaly Type | Detection Method | Response |
|---|---|---|
| **Gradual demand forecast drift** | Statistical process control on MAPE trend per business; detect when error rate is trending upward even if still within threshold | Trigger model retraining; alert data team if drift correlates with POS integration changes |
| **Clock-in pattern anomaly** | Clustering-based detection: employee's clock-in time distribution shifts (e.g., consistently 5 minutes earlier suggests clock manipulation) | Flag for manager review; track per-employee clock-in time variance |
| **Solver degradation** | Monitor solution quality score distribution; detect if median quality drops even though latency is unchanged (solver finding worse solutions within the same time budget) | Indicates constraint complexity increase; trigger solver tuning review |
| **Gig marketplace imbalance** | Detect geographic or temporal supply-demand mismatch: areas with high broadcast volume but low fill rates | Trigger gig worker recruitment campaigns in underserved areas; adjust matching radius and pricing |
| **Compliance rule interaction effects** | After a rule update, monitor for unexpected increase in violations or infeasibility rate across businesses using the updated rule | Indicates rule encoding error or unintended interaction; halt further rule rollout; review with legal team |

### Proactive Health Signals

Rather than waiting for failures, the platform monitors leading indicators:

| Signal | What It Predicts | Lead Time |
|---|---|---|
| **POS data staleness increasing** | Demand forecast accuracy degradation | 24–48 hours |
| **Solver queue depth trend (weekday)** | Sunday evening surge capacity shortfall | 3–5 days |
| **Gig worker pool contraction (per metro)** | Fill rate decline | 1–2 weeks |
| **Compliance rule version age distribution** | Outdated rule exposure | Immediate (monitored continuously) |
| **Employee app DAU decline per tenant** | Schedule feature abandonment (tenant churn risk) | 2–4 weeks |
| **Manager override rate increasing** | AI-generated schedules not matching manager expectations; model drift | 1–2 weeks |

---

## Runbook Templates

### Runbook: Schedule Generation Latency Spike

```
TRIGGER: schedule_generation_p95 > 15s for 5 minutes

DIAGNOSIS:
  1. Check solver queue depth → if > 100, capacity issue
  2. Check solver worker health → if healthy < 50%, worker crash
  3. Check if single tenant is submitting bulk requests
  4. Check if problem complexity has increased (avg employee count per request)

RESOLUTION:
  Capacity: Scale solver pool to 2x current size
  Worker crash: Check logs for OOM/timeout; restart unhealthy workers
  Bulk tenant: Apply per-tenant rate limit
  Complexity: Check for newly onboarded large businesses; adjust time budgets

ESCALATION: If unresolved after 15 minutes → P1 page on-call engineer
```

### Runbook: Compliance Engine Degradation

```
TRIGGER: compliance_validation_error_rate > 1% for 3 minutes

DIAGNOSIS:
  1. Check compliance engine replica health
  2. Check rule database connectivity
  3. Check for recent rule deployment (bad rule data?)
  4. Check if specific jurisdiction's rules are causing errors

RESOLUTION:
  Replica health: restart unhealthy replicas; traffic shifts to healthy ones
  Rule database: failover to cached rules (stale but functional)
  Bad rule deploy: rollback to previous rule version
  Jurisdiction-specific: disable problematic jurisdiction's rules; fall back to
    federal-only rules; alert legal team

CRITICAL: If compliance engine is fully down, ACTIVATE FAIL-CLOSED:
  Block all schedule publications
  Queue shift swaps pending validation
  Notify all managers with pending operations
```

---

## Synthetic Monitoring

### Continuous Validation via Synthetic Tenants

The platform maintains synthetic test tenants that exercise critical paths every 60 seconds:

| Synthetic Test | What It Validates | Frequency |
|---|---|---|
| **Schedule generation** | Submit a 25-employee optimization; verify result within 10s; check compliance report present | Every 5 minutes |
| **Clock-in flow** | Simulate GPS-verified clock-in; verify acceptance within 2s | Every 2 minutes |
| **Shift swap** | Post swap offer, claim with eligible employee, verify compliance check completes | Every 10 minutes |
| **Gig broadcast** | Broadcast a shift, verify synthetic gig worker receives notification within 5s | Every 10 minutes |
| **Compliance validation** | Submit a schedule with known violations; verify all violations are detected | Every 15 minutes |
| **Cross-tenant isolation** | Attempt cross-tenant data access from synthetic tenant A to synthetic tenant B; verify rejection | Every 30 minutes |
| **Notification delivery** | Trigger schedule publication for synthetic tenant; verify push notification receipt | Every 5 minutes |

### End-to-End Canary Metrics

| Canary | Success Criteria | Failure Action |
|---|---|---|
| **Full scheduling pipeline** | Forecast → Generate → Validate → Publish completes in < 20s | P1 alert if canary fails 2 consecutive runs |
| **Full attendance pipeline** | Clock-in → Timesheet entry → Manager visibility completes in < 5s | P0 alert if canary fails (clock-in path is critical) |
| **Full gig pipeline** | Broadcast → Notify → Accept → Schedule update in < 120s | P2 alert if canary fails |

---

## Cost of Observability

| Component | Monthly Cost (at scale) | % of Infrastructure |
|---|---|---|
| Metrics storage and querying | $2,500 | 2.5% |
| Log ingestion and retention | $4,000 | 4.0% |
| Distributed tracing | $1,500 | 1.5% |
| Synthetic monitoring | $500 | 0.5% |
| Alerting and on-call tooling | $800 | 0.8% |
| **Total observability cost** | **$9,300** | **~9.3%** |

The 9–10% observability overhead is justified by the compliance-critical nature of the platform: a missed clock-in event or an incorrect compliance validation has direct legal and financial consequences that far exceed the cost of monitoring.

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
