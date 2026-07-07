# Observability — AI-Native Agent Banking Platform for Africa

## Observability Philosophy

Agent banking observability must extend beyond traditional server-side metrics to encompass the health of a distributed network of 600,000+ edge devices operating in unreliable connectivity environments. The system is only as healthy as the weakest agent device in the network—if an agent's POS terminal is malfunctioning, printing blank receipts, or failing biometric captures, that agent's customers are effectively unbanked until the issue is resolved.

---

## Key Metrics Framework

### Golden Signals (Platform Level)

| Signal | Metric | Target | Alert Threshold |
|---|---|---|---|
| **Latency** | Transaction processing time (p50, p95, p99) | p50 < 800ms, p99 < 3s | p99 > 5s for 3 min |
| **Traffic** | Transactions per second (by type, by region) | 400-1,200 TPS (normal hours) | < 200 TPS during business hours (demand anomaly) |
| **Errors** | Transaction failure rate (by type, by error code) | < 0.5% failure rate | > 2% for any transaction type over 5 min |
| **Saturation** | Transaction queue depth, DB connection pool utilization | Queue < 100, pool < 70% | Queue > 500 or pool > 90% |

### Agent Network Health Metrics

| Metric | Description | Aggregation | Alert |
|---|---|---|---|
| **Agent online rate** | % of registered agents with active session | Regional, national | < 60% during business hours |
| **Agent utilization** | Transactions per agent per hour vs. capacity | Per-agent, per-region | Agent at 0 txns for 4+ hours during registered operating hours |
| **Float health distribution** | % of agents with healthy / warning / critical float | Regional, national | > 15% of agents in CRITICAL float status |
| **Offline agent count** | Agents operating in offline mode (no sync for 30+ min) | Regional | > 25% offline in a region (connectivity event) |
| **Device health score** | Composite score: battery, storage, sensor quality, app version | Per-device | Score drops below 40/100 |
| **Sync backlog** | Number of agents with pending unsynced transactions | Regional | > 5,000 agents with 2+ hour sync backlog |
| **Biometric capture success rate** | % of biometric captures that pass quality threshold | Per-device model, per-region | < 70% success rate for a device model |

### Financial Integrity Metrics

| Metric | Description | Monitoring Frequency | Alert |
|---|---|---|---|
| **Ledger balance checksum** | Hash of all account balances matches expected total | Every 5 minutes | Mismatch (immediate P1 alert) |
| **Float conservation** | Total e-float issued = Total agent float + Total customer balances + Settlement pending | Every 15 minutes | Variance > ₦1,000,000 |
| **Settlement reconciliation** | Settled amounts match expected amounts from transaction log | Hourly | Variance > 0.01% |
| **Reversal rate** | % of transactions reversed within 24 hours | Hourly | > 0.5% reversal rate |
| **Commission accuracy** | Calculated commissions match expected based on transaction volume and tier | Daily | Variance > ₦100,000 |

### Fraud Detection Metrics

| Metric | Description | Alert |
|---|---|---|
| **Fraud score distribution** | Distribution of transaction fraud scores (should be heavily left-skewed) | Mean fraud score > 0.15 (population-level shift) |
| **Alert volume** | Number of fraud alerts generated per hour | > 3x baseline for same hour/day-type |
| **False positive rate** | % of fraud alerts resolved as "not fraud" after investigation | > 80% (model needs retraining) or < 40% (model too conservative) |
| **Detection-to-action latency** | Time from alert generation to first investigation action | > 4 hours for HIGH severity alerts |
| **Collusion ring detection** | Number of new collusion rings identified per week | Sudden spike suggests coordinated attack |

---

## Distributed Tracing

### Transaction Trace Structure

Every transaction generates a trace that spans the full lifecycle:

```
Trace: txn-2026-0310-a4f2k9
├── Span: agent-device (12ms)
│   ├── Event: fingerprint-capture (quality: 78)
│   └── Event: offline-risk-check (result: PASS)
├── Span: api-gateway (3ms)
│   ├── Event: rate-limit-check (result: PASS)
│   └── Event: auth-validate (method: DEVICE_BIND + PIN)
├── Span: biometric-verify (145ms)
│   ├── Event: template-extract (45ms)
│   ├── Event: 1:1-match (score: 0.94, threshold: 0.65)
│   └── Event: quality-log (probe_quality: 72, stored_quality: 85)
├── Span: fraud-score (28ms)
│   ├── Event: rule-evaluation (7 rules, 2ms each)
│   ├── Event: ml-inference (model: v3.2, score: 0.08)
│   └── Event: decision (action: ALLOW, score: 0.12)
├── Span: compliance-check (15ms)
│   ├── Event: limit-check (daily_total: ₦45,000, limit: ₦100,000)
│   └── Event: geo-fence-check (distance: 45m, limit: 200m)
├── Span: ledger-post (22ms)
│   ├── Event: debit (agent_efloat, ₦5,000)
│   ├── Event: credit (customer_account, ₦5,000)
│   └── Event: fee-entry (agent_commission, ₦25)
├── Span: settlement-queue (5ms)
│   └── Event: queued (settlement_batch: 2026-0310-14)
└── Span: notification (async, 350ms)
    ├── Event: sms-receipt-sent (customer)
    └── Event: receipt-generated (agent)

Total trace duration: 230ms (excluding async notification)
```

### Cross-System Correlation

For transactions involving external systems (core banking, national ID, biller APIs), traces include external call spans with:

- External system identifier
- Request/response latency
- Retry count (for flaky external APIs)
- Timeout indicator
- Response code mapping (external error → internal error)

---

## Dashboards

### Operations Command Center Dashboard

| Panel | Content | Refresh |
|---|---|---|
| **Transaction Heatmap** | Geographic map showing transaction volume by region with color intensity; highlights regions with anomalous activity (unusually high or low) | 1 minute |
| **Real-Time TPS Gauge** | Current TPS vs. expected TPS for this time of day/week; color-coded: green (within 20% of expected), yellow (20-50% deviation), red (>50%) | 5 seconds |
| **Float Health Overview** | Donut chart showing agent distribution across HEALTHY / WARNING / CRITICAL float status; click-through to regional breakdown | 5 minutes |
| **Offline Agent Map** | Geographic map pinpointing agents currently offline; clustered view for identifying connectivity outages | 2 minutes |
| **Sync Backlog Timeline** | Time-series graph of pending sync transactions; spikes indicate connectivity restoration events | 1 minute |
| **Fraud Alert Feed** | Scrolling feed of HIGH and CRITICAL fraud alerts with agent ID, alert type, and confidence score | Real-time |

### Agent Performance Dashboard (Per-Agent)

| Panel | Content |
|---|---|
| **Transaction History** | Time-series of daily transaction count and value; trend line; comparison to peer agents in same region |
| **Float Balance Timeline** | 24-hour rolling view of e-float and estimated cash balance; rebalancing events marked; predicted depletion time |
| **Compliance Score** | Composite compliance score with breakdown: KYC completion rate, geo-fence compliance, operating hours adherence, regulatory reporting timeliness |
| **Device Health** | Battery level trend, storage utilization, biometric sensor quality trend, app version, last sync time |
| **Customer Diversity** | Number of unique customers served per day; flags if diversity drops (potential phantom transaction indicator) |
| **Peer Comparison** | Agent's key metrics compared to percentile bands of peer agents (same tier, same region) |

### Financial Reconciliation Dashboard

| Panel | Content | Refresh |
|---|---|---|
| **Ledger Balance Summary** | Total platform float balance, total customer balance, settlement pending; conservation check result | 5 minutes |
| **Settlement Pipeline** | Transactions in settlement pipeline by stage: queued → submitted → confirmed → reconciled; aging analysis | 15 minutes |
| **Reversal Analysis** | Reversal count and value by reason code; trend analysis; comparison to historical baseline | Hourly |
| **Inter-Bank Settlement** | Settlement file status by partner bank; matched vs. unmatched entries; exception count | 30 minutes |

---

## Alerting Strategy

### Alert Severity and Routing

| Severity | Response Time | Notification Channel | Example |
|---|---|---|---|
| **P1 — Critical** | < 5 min | PagerDuty + SMS + Phone call | Ledger imbalance, mass transaction failures, biometric DB unreachable |
| **P2 — High** | < 30 min | PagerDuty + Messaging | Regional offline spike, settlement mismatch > threshold, fraud campaign detected |
| **P3 — Medium** | < 4 hours | Messaging channel | Individual agent compliance violation, elevated error rates, model performance degradation |
| **P4 — Low** | Next business day | Dashboard + Email | Device health degradation, minor metric deviation, configuration drift |

### Alert Suppression and Correlation

To prevent alert fatigue from 600,000 agents:

1. **Regional aggregation**: If >20 agents in the same region go offline simultaneously, generate ONE "regional connectivity event" alert instead of 20 individual "agent offline" alerts
2. **Cascading suppression**: If a core banking integration is down (P1), suppress all "settlement delay" and "balance sync" alerts (P3) that are symptoms of the same root cause
3. **Time-of-day gating**: Suppress "agent inactive" alerts outside registered operating hours
4. **Progressive escalation**: First occurrence → dashboard indicator; 3rd occurrence in 24h → team notification; 5th → PagerDuty; persistent → escalate to management

---

## Logging Architecture

### Log Categories and Retention

| Category | Content | Retention | Storage Tier |
|---|---|---|---|
| **Transaction logs** | Complete transaction record with all inputs, outputs, decisions | 7 years | Hot (30 days) → Warm (1 year) → Cold (6 years) |
| **Biometric operation logs** | Match/no-match decisions, quality scores, template access | 5 years | Hot (7 days) → Cold (5 years) |
| **Agent session logs** | Login, logout, device attestation, session events | 1 year | Hot (7 days) → Cold (1 year) |
| **Fraud detection logs** | Rule evaluations, ML scores, alert decisions, investigation notes | 5 years | Hot (90 days) → Cold (5 years) |
| **Compliance audit logs** | Regulatory report generation, STR filings, limit checks | 7 years | Hot (1 year) → Cold (6 years) — immutable storage |
| **System operational logs** | Service health, errors, performance metrics | 90 days | Hot (7 days) → Warm (83 days) |

### Tamper-Evident Audit Trail

Financial and compliance logs use a hash-chain structure:

```
Log Entry N:
    content: {transaction details}
    hash: SHA-256(content + Entry[N-1].hash + timestamp)

Log Entry N+1:
    content: {next transaction details}
    hash: SHA-256(content + Entry[N].hash + timestamp)
```

Any modification to a historical entry breaks the hash chain, making tampering detectable. The hash chain root is periodically committed to an immutable external ledger for additional tamper resistance.

---

## Health Checks and Synthetic Monitoring

### Synthetic Transaction Monitoring

The platform runs synthetic transactions every 5 minutes to validate end-to-end health:

| Synthetic Test | Validates | Frequency |
|---|---|---|
| **Cash-in simulation** | Full cash-in flow from API to ledger posting | Every 5 min per region |
| **Cash-out simulation** | Full cash-out flow including balance check | Every 5 min per region |
| **Biometric match test** | Template extraction + 1:1 matching pipeline | Every 10 min |
| **Offline sync simulation** | Batch upload + conflict resolution | Every 15 min |
| **Float query** | Float balance retrieval latency | Every 1 min per region |
| **Core banking connectivity** | Settlement file submission and acknowledgment | Every 5 min |
| **Biller API connectivity** | Test payment to each integrated biller | Every 30 min per biller |

### Device Health Telemetry

Agent devices report health metrics on every sync:

```
DeviceHealthReport {
    battery_level:          Integer     // 0-100%
    storage_available_mb:   Integer
    app_version:            String
    os_version:             String
    fingerprint_sensor:     ENUM [OK, DEGRADED, FAILED]
    camera_functional:      Boolean
    gps_accuracy_meters:    Integer
    cellular_signal_dbm:    Integer
    last_successful_sync:   Timestamp
    pending_sync_count:     Integer
    local_db_size_mb:       Integer
    uptime_hours:           Integer
}
```

Devices with degraded sensors or outdated app versions receive automated push notifications guiding the agent through maintenance steps or triggering a device replacement request.

---

## Float Health Dashboard

```
┌────────────────────────────────────────────────────────────────────┐
│ FLOAT NETWORK STATUS         Region: Lagos Mainland    14:32 WAT  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─ Regional Float Health ──────────┐  ┌─ Rebalancing Activity ──┐│
│  │ Agents in region: 12,480          │  │ Rebalancing trips today: ││
│  │ Healthy (>40% both): 9,100 (73%) │  │   Branch visits: 1,240   ││
│  │ Warning (20-40%): 2,400 (19%)    │  │   Super-agent: 3,100    ││
│  │ Critical (<20%): 980 (8%)     ⚠  │  │   Digital top-up: 8,200 ││
│  └───────────────────────────────────┘  │ Avg trip distance: 4.2km ││
│                                         └─────────────────────────┘│
│  ┌─ Prediction Accuracy ─────────┐  ┌─ Agent Uptime ────────────┐ │
│  │ Next-day forecast MAPE: 18%   │  │ Online: 10,800 (87%)  ✓   │ │
│  │ Same-day adjustment: 12%      │  │ Offline: 1,680 (13%)      │ │
│  │ Rebalance triggers/day: 3,400 │  │ Avg offline duration: 45m │ │
│  │ Prevented stockouts: 820   ✓  │  │ Sync backlog: 340 agents  │ │
│  └────────────────────────────────┘  └────────────────────────────┘│
│                                                                    │
│  ┌─ Float Utilization Heat Map ────────────────────────────────┐  │
│  │ [Map showing agent float status by GPS location]            │  │
│  │ ● Healthy  ◐ Warning  ○ Critical  × Offline                │  │
│  │ Cluster: Idumota Market (high cash-in, e-float depleting)   │  │
│  │ Cluster: Ikeja GRA (high cash-out, cash depleting)          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Fraud Detection Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `fraud.scoring_latency_p99_ms` | Per-transaction fraud score computation | ≤ 50 ms | > 100 ms |
| `fraud.auto_block_rate` | % of transactions auto-blocked | 0.1-0.3% | > 0.5% (false positive spike or fraud spike) |
| `fraud.agent_suspension_rate` | % of active agents suspended per month | < 0.5% | > 1% (model precision issue) |
| `fraud.phantom_txn_detection_rate` | Phantom transactions detected per day | Informational | > 2x 30-day average |
| `fraud.collusion_rings_detected` | Agent collusion rings identified per week | Informational | > 5 per week |
| `fraud.float_diversion_cases` | Float diversion cases detected per month | Informational | > 50 cases (systemic issue) |
| `fraud.false_positive_rate` | % of investigations finding legitimate activity | < 20% | > 40% (model needs recalibration) |
| `fraud.investigation_sla_days` | Average days from alert to resolution | < 3 days | > 7 days (investigation backlog) |

---

## Connectivity and Offline Observability

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `offline.agents_offline_pct` | % of agents in offline mode | < 15% nationally | > 25% (connectivity infrastructure issue) |
| `offline.avg_offline_duration_min` | Average continuous offline period | < 45 min | > 120 min (extended outage) |
| `offline.sync_reconciliation_success_pct` | % of offline transactions auto-reconciled | > 99.5% | < 98% |
| `offline.conflict_rate_pct` | % of synced transactions with conflicts | < 0.5% | > 2% |
| `offline.max_backlog_hours` | Longest offline backlog in the system | < 12 hours | > 24 hours (device not syncing) |
| `offline.morning_sync_wave_tps` | Peak TPS during morning sync burst | Informational | > 2x pre-scaled capacity |
| `offline.sync_latency_p95_s` | Time to sync 50-transaction batch | < 30 s | > 60 s |

---

## On-Call Playbooks

### Playbook: Regional Connectivity Blackout

```
Trigger: offline.agents_offline_pct > 40% in a single region
Severity: HIGH

Step 1: Verify scope
  → Is the outage region-specific or national?
  → Check telecom partner status dashboards
  → Correlate with known infrastructure events (tower maintenance, power grid failure)

Step 2: Assess impact
  → How many agents affected? What transaction volume are they processing?
  → How long have they been offline? (estimate sync backlog)
  → Are super-agents in the region also affected?

Step 3: Prepare for sync wave
  → Pre-scale sync processing pods for the affected region
  → Estimate backlog: agents_affected × avg_txns_per_hour × hours_offline
  → Set priority ordering: longest-offline agents sync first

Step 4: Communicate
  → Send SMS to affected agents: "Network issue detected. Offline
     transactions are safe. Transactions will sync when connectivity returns."
  → Notify operations team and regional field support

Step 5: Post-recovery
  → Monitor sync wave for reconciliation conflicts
  → Check for any agents with corrupted local databases
  → Review float states: agents may have hit float limits during offline period
```

### Playbook: Float Crisis — Regional Cash Shortage

```
Trigger: > 20% of agents in a region have CRITICAL e-float status
Severity: HIGH

Step 1: Diagnose root cause
  → Is this a demand spike (salary day, market day, festival)?
  → Are super-agents in the region also depleted?
  → Is there a bank branch outage preventing rebalancing?

Step 2: Emergency float redistribution
  → Identify agents with excess e-float in adjacent regions
  → Route digital float top-ups to the most critical agents
  → Activate emergency float from platform reserves

Step 3: Physical logistics coordination
  → Dispatch cash-in-transit to the region if super-agents are depleted
  → Extend bank branch hours (coordinate with banking partner)
  → Temporarily increase per-agent float limits for healthy agents in the area

Step 4: Customer communication
  → Push notifications to customers in affected area: alternative cash-out
     points with healthy float (agent discovery API)
  → Reduce transaction limits in affected region to extend available float
```

### Playbook: Biometric System Degradation

```
Trigger: biometric capture success rate < 70% for a device model or region
Severity: MEDIUM

Step 1: Identify scope
  → Is the issue device-model-specific? (sensor degradation on a batch of devices)
  → Is it region-specific? (environmental factor: dust season, extreme heat)
  → Is it demographic-specific? (new customer enrollment vs. returning verification)

Step 2: Check biometric pipeline
  → Is the quality threshold too high? (recently updated?)
  → Are on-device models up to date? (check OTA update success rate)
  → Is the server-side matching service degraded?

Step 3: Adaptive response
  → If sensor issue: lower quality threshold for affected devices,
     add compensating controls (PIN + facial as backup)
  → If environmental: activate dust/moisture guidance prompts on agent devices
  → If model issue: roll back to previous biometric model version

Step 4: Monitor recovery
  → Track capture success rate improvement over 24-48 hours
  → If no improvement: escalate to device replacement program
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
