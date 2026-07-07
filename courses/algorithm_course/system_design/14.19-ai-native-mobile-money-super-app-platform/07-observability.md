# Observability — AI-Native Mobile Money Super App Platform

## Key Metrics

### Transaction Health Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `txn.success_rate` | Percentage of transactions completing successfully (excluding user cancellations) | > 99.5% | < 99.0% over 5-min window |
| `txn.latency.p50` | Median end-to-end transaction latency | < 1.5s | > 2.5s |
| `txn.latency.p99` | 99th percentile transaction latency | < 5s | > 8s |
| `txn.throughput` | Transactions per second | Variable (1,000–8,000 TPS) | > 90% of provisioned capacity |
| `txn.reversal_rate` | Percentage of committed transactions subsequently reversed | < 0.1% | > 0.3% |
| `ledger.balance_sum` | Sum of all wallet balances vs. trust account total | Exact match (zero discrepancy) | Any non-zero discrepancy |
| `ledger.double_entry_violations` | Journal entries where debits ≠ credits | 0 | Any violation |

### USSD Session Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `ussd.session_completion_rate` | Sessions that reach their intended terminal state | > 92% | < 88% |
| `ussd.timeout_rate` | Sessions terminated by MNO timeout | < 5% | > 8% |
| `ussd.orphaned_post_commit_rate` | Sessions that dropped after transaction committed | < 0.5% | > 1% |
| `ussd.response_latency.p95` | 95th percentile platform response time per USSD screen | < 500ms | > 1s |
| `ussd.gateway_connection_pool` | Active connections per MNO gateway vs. limit | < 80% of limit | > 90% of limit |
| `ussd.error_rate_by_mno` | Error rate segmented by mobile network operator | < 1% per MNO | > 3% for any single MNO |

### Agent Network Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `agent.float_utilization` | Agent's current float / maximum float limit | 20%–80% | < 10% or > 95% |
| `agent.float_alerts_open` | Number of agents currently below float minimum | < 2% of agents | > 5% of agents |
| `agent.rebalance_response_time` | Time from float alert to dealer rebalancing action | < 4 hours (urban), < 8 hours (rural) | > 8 hours (urban), > 24 hours (rural) |
| `agent.offline_transaction_queue` | Count of unsynced offline transactions across all agents | < 1,000 | > 5,000 |
| `agent.daily_reconciliation_rate` | Percentage of agents completing daily cash reconciliation | > 90% | < 80% |

### Fraud Detection Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `fraud.detection_latency.p95` | Time from transaction submission to fraud decision | < 200ms | > 500ms |
| `fraud.block_rate` | Percentage of transactions blocked by fraud engine | 0.1%–0.5% | > 1% (may indicate false positives) or < 0.05% (may indicate detection gaps) |
| `fraud.false_positive_rate` | Blocked transactions that were legitimate (measured from appeal resolutions) | < 5% of blocks | > 10% of blocks |
| `fraud.sim_swap_detection_time` | Time between SIM swap event and wallet freeze | < 30s (real-time MNOs), < 4h (polling) | > 60s (real-time), > 8h (polling) |
| `fraud.model_drift_score` | Statistical drift in fraud model feature distributions | < 0.1 PSI | > 0.2 PSI (retrain trigger) |

### Credit Scoring & Lending Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `lending.approval_rate` | Percentage of loan requests approved | 60%–75% | < 50% or > 85% |
| `lending.default_rate_30d` | Loans overdue >30 days as percentage of disbursed | < 4% | > 6% |
| `lending.disbursement_latency` | Time from approval to wallet credit | < 30s | > 60s |
| `credit.score_computation_latency` | Fresh credit score computation time | < 5s | > 10s |
| `credit.model_auc` | Area under ROC curve for credit model | > 0.75 | < 0.70 |

---

## Logging Architecture

### Log Categories

| Category | Content | Retention | Volume |
|---|---|---|---|
| **Transaction audit log** | Immutable record of every ledger write: journal ID, wallet IDs, amounts, before/after balances, timestamp, channel, fraud score | 7 years (regulatory) | ~90M entries/day |
| **USSD session log** | Session ID, MSISDN (masked), menu navigation path, timing per screen, terminal state (complete/timeout/error) | 90 days | ~50M entries/day |
| **Fraud decision log** | Transaction ID, feature values, model scores, decision, contributing signals | 2 years | ~90M entries/day |
| **API access log** | Developer app ID, endpoint, request/response (PII redacted), latency, status code | 1 year | ~40M entries/day |
| **Agent activity log** | Agent ID, transaction type, float balance changes, reconciliation events | 2 years | ~15M entries/day |
| **System operational log** | Application logs, error traces, deployment events, configuration changes | 30 days | Variable |

### PII Protection in Logs

All logging infrastructure enforces PII protection:
- **MSISDN masking:** Phone numbers logged as `+254***5678` (last 4 digits only) in operational logs. Full MSISDN available only in audit logs with access-controlled query interface.
- **PIN exclusion:** PIN fields are never logged, even in encrypted form. USSD session logs record `PIN_ENTERED: true/false`, never the PIN value.
- **Balance redaction:** Wallet balances in operational logs are logged as ranges (`balance_band: "1K-10K"`) rather than exact values.
- **Structured redaction engine:** A centralized redaction engine processes all logs before storage, applying field-specific redaction rules. New log fields default to "redact" until explicitly marked safe.

---

## Distributed Tracing

### Trace Context Propagation

Every transaction generates a trace that spans multiple services. The trace context includes:
- **Trace ID:** Globally unique identifier for the end-to-end transaction flow
- **Span ID:** Per-service segment identifier
- **Channel marker:** USSD/APP/SMS/AGENT to identify the originating channel
- **Country code:** For multi-country log correlation

### Key Trace Spans

A P2P transfer trace includes these spans:

```
[USSD Gateway] session_handler          →  15ms
  └─[Idempotency] dedup_check           →   3ms
  └─[Fraud] rule_engine                 →   8ms
  └─[Fraud] ml_inference                → 120ms
  └─[Ledger] balance_check              →   5ms
  └─[Ledger] journal_write              →  45ms
    └─[Ledger] sync_replication         →  18ms
  └─[Notification] sms_dispatch         →  25ms (async, not on critical path)
  └─[USSD Gateway] render_confirmation  →   2ms
Total critical path:                     → 216ms (within 500ms budget)
```

### Cross-Service Correlation

For transactions that span multiple internal services (e.g., a nano-loan disbursement that involves the credit scoring service, lending service, and transaction engine), traces are correlated via the trace ID. The tracing system provides:
- **Waterfall visualization:** Timeline view showing each service's contribution to total latency
- **Dependency map:** Auto-generated service dependency graph from trace data
- **Latency attribution:** Which service contributed the most latency to the critical path
- **Error propagation:** When a transaction fails, which service in the chain raised the error

---

## Alerting Framework

### Alert Priority Levels

| Priority | Response SLA | Escalation | Examples |
|---|---|---|---|
| **P0 — Critical** | Acknowledge in 5 min, resolve or mitigate in 30 min | Immediate page to on-call SRE + engineering lead + compliance team (if financial) | Ledger balance discrepancy, transaction success rate <95%, platform-wide outage, mass fraud event |
| **P1 — High** | Acknowledge in 15 min, resolve in 2 hours | Page on-call SRE | Single MNO USSD gateway failure, fraud detection latency >500ms, database failover triggered, agent float crisis (>10% of agents below minimum) |
| **P2 — Medium** | Acknowledge in 1 hour, resolve in 8 hours | Notification to team channel | Elevated timeout rates for one MNO, credit model drift approaching retrain threshold, SMS delivery delays |
| **P3 — Low** | Address during business hours | Dashboard notification | Minor API error rate increase, single agent reconciliation discrepancy, non-critical service degradation |

### Alert Suppression and Correlation

- **Alert grouping:** Multiple alerts triggered by the same root cause (e.g., MNO gateway failure causing USSD timeout spike AND transaction success rate drop AND agent offline queue growth) are grouped into a single incident.
- **Maintenance windows:** Scheduled MNO maintenance windows suppress expected alerts. Alerts that persist beyond the maintenance window end time auto-escalate.
- **Flap detection:** Metrics that oscillate around a threshold don't generate repeated alerts. First alert fires; subsequent alerts suppressed for a cooldown period (configurable per metric).

---

## Dashboards

### 1. Executive Dashboard (Business Health)

- Total daily transaction value and volume (with trend over 30 days)
- Active user count (DAU, MAU) by country
- Revenue breakdown (fees, commissions, lending interest, insurance premiums)
- Agent network health summary (% active, % below float minimum)
- Customer satisfaction proxy (transaction completion rate, support ticket volume)

### 2. Transaction Operations Dashboard

- Real-time TPS gauge with capacity headroom indicator
- Transaction success/failure/pending breakdown by channel (USSD, App, SMS, Agent)
- Latency heatmap by hour-of-day (identifying peak periods)
- Failed transaction drilldown: error category distribution (insufficient balance, fraud block, timeout, system error)
- Ledger reconciliation status (real-time balance sum verification)

### 3. USSD Health Dashboard

- Per-MNO session metrics: completion rate, timeout rate, average session duration
- Screen-by-screen latency breakdown for each transaction flow
- Orphaned session tracker (post-commit sessions that needed SMS fallback)
- Gateway connection pool utilization per MNO
- Character count analysis (screens approaching 182-char limit in any language)

### 4. Fraud Operations Dashboard

- Real-time fraud score distribution (histogram of transaction risk scores)
- Blocked/held transaction queue with analyst assignment status
- SIM swap event timeline (detections, freezes, false positives)
- Fraud type trend analysis (SIM swap, social engineering, agent collusion over time)
- Model performance metrics (precision, recall, F1 by fraud category)
- Geographic fraud heatmap

### 5. Agent Network Dashboard

- Geographic map of agent network with float status color coding (green=healthy, yellow=low, red=critical)
- Dealer rebalancing activity (requests generated vs. fulfilled)
- Agent performance leaderboard and watchlist
- Offline transaction backlog by region
- Commission disbursement tracking

### 6. Lending & Credit Dashboard

- Loan portfolio summary (total outstanding, disbursements today, repayments today)
- Default rate trends by credit score band
- Credit model performance (AUC, calibration curve, approval rate by cohort)
- Repayment waterfall (on-time, 1-30 days late, 31-60 days, 60+ days, default)
- Feature drift monitoring for credit scoring inputs

---

## SLI/SLO Framework

### Service Level Indicators (SLIs)

| SLI | Measurement Method | Good Event Definition |
|---|---|---|
| **Transaction availability** | Ratio of successful transaction API responses to total requests | Response returned within timeout AND status is not 5xx |
| **Transaction latency** | End-to-end time from request receipt to ledger commit confirmation | Latency < 3 seconds for USSD, < 2 seconds for App |
| **USSD session quality** | Ratio of sessions reaching intended terminal state to total sessions initiated | Session completes the transaction flow OR user explicitly navigates away (not timeout/error) |
| **Ledger consistency** | Continuous comparison of wallet balance sum vs. trust account total | Discrepancy = 0 |
| **Fraud detection latency** | Time from transaction ingestion to fraud decision returned | Decision returned in < 200ms |
| **SMS delivery success** | Ratio of SMS confirmations confirmed delivered by MNO to total sent | Delivery confirmation received within 30 seconds |

### Service Level Objectives (SLOs)

| SLO | Target | Error Budget (monthly) | Measurement Window |
|---|---|---|---|
| **Transaction availability** | 99.95% | 21.6 minutes of downtime | Rolling 30 days |
| **Transaction latency (USSD)** | 95% of transactions < 3s | 5% of transactions may exceed 3s | Rolling 7 days |
| **Transaction latency (App)** | 99% of transactions < 2s | 1% of transactions may exceed 2s | Rolling 7 days |
| **USSD session quality** | 92% session completion rate | 8% sessions may not complete | Rolling 7 days |
| **Ledger consistency** | 100% (zero tolerance) | Zero error budget—any discrepancy is an incident | Continuous |
| **Fraud detection latency** | 99% < 200ms | 1% may exceed 200ms | Rolling 7 days |
| **SMS delivery** | 95% delivered within 10s | 5% may be delayed or fail | Rolling 7 days |

### Error Budget Policies

- **Transaction availability:** If error budget is <25% remaining, freeze all non-critical deployments. If exhausted, engage incident response for reliability remediation.
- **Ledger consistency:** Zero tolerance. Any discrepancy triggers P0 incident immediately, regardless of error budget.
- **USSD session quality:** If completion rate drops below 88% for any single MNO for >1 hour, engage MNO technical team for joint investigation.

---

## SLO Dashboard Design

```
╔══════════════════════════════════════════════════════════════════╗
║  MOBILE MONEY PLATFORM — SLO STATUS                            ║
║  Period: Rolling 30 days | Last updated: 2025-03-15 14:22 UTC   ║
╠═══════════════════╦═════════╦═══════════╦══════════╦════════════╣
║ SLO               ║ Target  ║ Current   ║ Budget   ║ Status     ║
╠═══════════════════╬═════════╬═══════════╬══════════╬════════════╣
║ Txn Availability  ║ 99.95%  ║ 99.972%   ║ 67% left ║ ✓ Healthy  ║
║ USSD Latency <3s  ║ 95%     ║ 97.1%     ║ 82% left ║ ✓ Healthy  ║
║ App Latency <2s   ║ 99%     ║ 99.4%     ║ 60% left ║ ✓ Healthy  ║
║ USSD Completion   ║ 92%     ║ 93.2%     ║ 85% left ║ ✓ Healthy  ║
║ Ledger Consistency║ 100%    ║ 100%      ║ N/A      ║ ✓ Perfect  ║
║ Fraud Detect <200 ║ 99%     ║ 99.3%     ║ 70% left ║ ✓ Healthy  ║
║ SMS Delivery <10s ║ 95%     ║ 93.8%     ║ -24% !!  ║ ✗ BURNED   ║
╚═══════════════════╩═════════╩═══════════╩══════════╩════════════╝
```

---

## Incident Playbooks

### Playbook 1: Ledger Balance Discrepancy (P0)

**Trigger:** `ledger.balance_sum` ≠ trust account balance

**Immediate actions (first 5 minutes):**
1. Page on-call SRE + engineering lead + compliance officer
2. Capture snapshot: current wallet sum, trust account balance, delta amount
3. Determine direction: is the platform showing more or less than trust account?
   - More than trust account → money was created (bug or fraud)
   - Less than trust account → money was destroyed (bug)

**Investigation (5–30 minutes):**
1. Query last successful reconciliation timestamp
2. Extract all ledger entries between last-good and now
3. Verify each journal entry balances (sum of debits = sum of credits)
4. If a journal entry is unbalanced → identify the transaction engine instance and deployment version
5. If all journal entries balance but total diverges → check for direct database modification (audit trail review)

**Resolution:**
- If bug identified: hotfix + compensating journal entries to correct balances
- If fraud identified: freeze affected accounts, engage law enforcement, file regulatory report
- If data corruption: restore from point-in-time backup to last-known-good state; replay transactions from event store

**Communication:**
- Internal: incident channel updated every 15 minutes
- Regulatory: notification within 4 hours if resolution exceeds 2 hours
- Customer: no customer communication unless transactions are affected

### Playbook 2: MNO USSD Gateway Outage (P1)

**Trigger:** `ussd.gateway_connection_pool` = 0 for any single MNO, sustained >30 seconds

**Immediate actions:**
1. Confirm outage is on MNO side (not platform networking issue): ping MNO secondary gateway
2. Switch to MNO secondary gateway if available
3. Mark affected MNO's USSD channel as degraded in platform status
4. Activate SMS broadcast to top 10,000 active USSD users on that MNO: "USSD temporarily unavailable. Try again in 15 minutes."

**Ongoing monitoring:**
- Check MNO status page and NOC contact for ETA
- Monitor orphaned session count (sessions that were in-flight when gateway went down)
- Process SMS fallback for all orphaned post-commit sessions

**Recovery:**
- When MNO gateway returns: gradual connection ramp-up (10% → 25% → 50% → 100% over 10 minutes)
- Verify session completion rates return to normal within 15 minutes of recovery
- Post-incident: review whether redundant gateway configuration exists for this MNO

### Playbook 3: Fraud Detection Service Degradation (P1)

**Trigger:** `fraud.detection_latency.p95` > 500ms sustained >3 minutes

**Immediate actions:**
1. Check fraud ML inference node health (GPU utilization, memory, queue depth)
2. If inference nodes are overloaded: scale horizontally (add nodes)
3. If inference is failing: fall back to rule-engine-only mode for Phase 2

**Degraded mode operation:**
- Rule engine provides ~78% fraud detection (vs. 96% with ML)
- Automatically lower transaction limits by 40% during degraded mode
- Queue transactions above $50 for async ML evaluation when service recovers

**Recovery:**
- When ML inference recovers: process backlogged async evaluations
- Any transactions that would have been blocked by ML but passed rule engine: trigger post-commit review
- Model performance metrics: compare detection rate during degraded period vs. normal

### Playbook 4: Agent Float Crisis — Mass Shortfall (P1)

**Trigger:** `agent.float_alerts_open` > 10% of total agents (>30,000 agents simultaneously below minimum float)

**Immediate actions:**
1. Identify root cause: regional outage? payday spike? system error in float calculation?
2. If system error: verify float positions by recalculating from ledger events
3. If genuine mass shortfall: activate emergency float distribution

**Emergency response:**
- Alert all dealers in affected regions with consolidated rebalancing demand
- Temporarily raise agent offline transaction limits to allow agents to continue serving customers
- If shortage is cash-directional (all agents running low on e-float simultaneously), check if trust account has capacity for emergency float injection

---

## Financial Reconciliation Monitoring

### Trust Account Reconciliation Pipeline

```
Every hour:
  1. COMPUTE sum(all_wallet_balances) from ledger DB
  2. QUERY trust_account_balance from partner bank API
  3. COMPARE delta = abs(wallet_sum - trust_account_balance)
  4. IF delta > 0:
       severity = classify(delta):
         < 100 cents: WARNING (may be timing difference)
         100-10000 cents: HIGH (investigate immediately)
         > 10000 cents: CRITICAL (potential fraud or system failure)
       CREATE incident with delta, wallet_sum, trust_balance, timestamp
  5. LOG reconciliation_result to time-series for trend analysis

Daily:
  1. RUN full journal verification: for every journal_id,
     verify sum(debits) == sum(credits)
  2. RUN wallet balance reconstruction: for each wallet,
     verify current_balance == initial_balance + sum(credits) - sum(debits)
  3. GENERATE regulatory reconciliation report
  4. ARCHIVE reconciliation evidence for audit trail
```

### Cross-Channel Transaction Monitoring

Monitor for discrepancies in how the same transaction is observed across different system components:

| Component | What It Records | Reconciliation Check |
|---|---|---|
| **USSD Gateway** | Session started, transaction submitted | Every submitted transaction has a matching ledger entry |
| **API Gateway** | API call received, response returned | Every 200 OK response corresponds to a committed transaction |
| **Transaction Engine** | Journal entry committed | Every journal entry has balanced debits/credits |
| **Event Store** | Transaction event published | Every committed transaction has a corresponding event |
| **SMS Gateway** | Confirmation SMS sent | Every committed transaction triggered an SMS (USSD channel) |
| **Trust Account** | Net fund movement | Daily net wallet balance change = daily net trust account change |

Discrepancies between any two components trigger investigation. Example: if the USSD gateway logged 1,000 transaction submissions but the ledger shows only 998 commits, the 2 missing transactions must be accounted for (fraud check block? timeout? system error?).

---

## Incident Detection Playbooks

### Playbook 1: Transaction Success Rate Degradation

```
DETECTION:
  Signal: txn.success_rate < 99.0% for 5 consecutive minutes
  Secondary signals: Check concurrently:
    - txn.latency.p99 (latency-driven failures?)
    - fraud.block_rate (fraud engine over-blocking?)
    - ledger.write_error_rate (database issues?)
    - ussd.timeout_rate (MNO gateway issues?)

DIAGNOSIS TREE:
  IF fraud.block_rate > 2× baseline:
    → Fraud model threshold shift or bad rule deployment
    → CHECK: Recent rule deployments in fraud engine config
    → CHECK: Model drift score (PSI metric)
    → ACTION: If rule change, rollback; if model drift, revert model version

  IF ledger.write_error_rate > 1%:
    → Database contention or capacity issue
    → CHECK: Connection pool utilization, replication lag
    → CHECK: Hot wallet retry rate (per wallet partition)
    → ACTION: Add partitions to contended wallets; scale DB if capacity

  IF ussd.timeout_rate spiked for specific MNO:
    → MNO gateway degradation
    → CHECK: Per-MNO latency and error metrics
    → ACTION: Contact MNO NOC; activate SMS fallback for affected users

  IF txn.latency.p99 > 5s without other signals:
    → General platform slowness
    → CHECK: CPU, memory, GC pauses on transaction engine nodes
    → ACTION: Scale horizontally if CPU-bound; investigate GC if memory

ESCALATION:
  5 min: Page on-call SRE
  15 min: Page engineering lead if not mitigated
  30 min: Page VP Engineering; begin customer communication
```

### Playbook 2: Agent Float Crisis

```
DETECTION:
  Signal: agent.float_alerts_open > 5% of total agents for > 30 minutes
  OR: Regional cluster shows > 20% of agents below float minimum

DIAGNOSIS:
  IF concentrated in one region:
    → Regional cash shortage or connectivity outage
    → CHECK: Regional connectivity metrics, dealer activity
    → ACTION: Escalate to dealer ops; consider emergency electronic float transfers

  IF spread across regions near month-end:
    → Payday-driven cash-out surge exceeding forecast
    → CHECK: Predicted vs. actual cash-out volumes
    → ACTION: Activate emergency float distribution:
      1. Super-agents do electronic float transfers (bypass physical cash)
      2. Priority dealers dispatched to highest-volume agents
      3. Temporary increase of agent offline transaction limits

  IF sudden spike unrelated to payday:
    → Possible fraud event causing mass withdrawals
    → CHECK: Fraud detection alerts, social media for scam campaigns
    → ACTION: If confirmed, activate enhanced cash-out screening
```

### Playbook 3: SIM Swap Surge

```
DETECTION:
  Signal: fraud.sim_swap_events > 3× daily baseline in any 4-hour window

DIAGNOSIS:
  IF concentrated on one MNO:
    → Possible MNO retail insider processing fraudulent swaps
    → ACTION: Freeze wallets with SIM changes on that MNO (last 4 hours)
    → ACTION: Contact MNO security team immediately

  IF spread across MNOs:
    → Coordinated social engineering campaign
    → ACTION: Reduce USSD limits by 50% for recently-swapped SIMs
    → ACTION: Extend post-swap cooling period from 72h to 168h

  IF correlated with geography:
    → Specific outlet or region compromised
    → ACTION: Require agent-assisted re-verification (not self-service)
```

---

## Anomaly Detection System

### Metric Anomaly Types

| Anomaly Type | Detection Method | Examples |
|---|---|---|
| **Sudden spike** | Z-score > 3 on 5-minute window vs. same time of day/week | TPS spike from flash sale; fraud block rate from model update |
| **Gradual drift** | Linear regression slope change over 7-day window | Increasing USSD timeout rate from MNO infrastructure degradation |
| **Distribution shift** | Kolmogorov-Smirnov test on amount distribution | Average transaction amount change suggesting new fraud pattern |
| **Correlation break** | Pearson coefficient change between normally-correlated metrics | USSD sessions increasing but completions flat |
| **Seasonal deviation** | Actual vs. predicted from seasonal decomposition | Volume below predicted for payday weekend |
| **Absence anomaly** | Expected events not occurring | Zero transactions from a country → connectivity loss |

### Agent Network Anomaly Detection

```
FUNCTION detect_agent_anomalies(agent_id, window = 7_days):

  // Anomaly 1: Transaction mix shift
  current_mix = agent.transaction_mix(last_24h)
  baseline_mix = agent.transaction_mix(window)
  IF KL_divergence(current_mix, baseline_mix) > 0.5:
    ALERT: "Agent {id} transaction mix changed significantly"
    // May indicate: commission farming, structuring, or market shift

  // Anomaly 2: Float trajectory deviation
  predicted = float_model.predict(agent_id, next_24h)
  actual = agent.current_float()
  IF abs(actual - predicted) > 3 * prediction_stddev:
    ALERT: "Agent {id} float deviates from prediction"
    // May indicate: unreported offline transactions, theft, system bug

  // Anomaly 3: Customer concentration
  customer_hhi = herfindahl_index(agent.customer_distribution(7_days))
  peer_hhi = AVG(herfindahl for peer agents in region)
  IF customer_hhi > 2 * peer_hhi:
    ALERT: "Agent {id} serves unusually concentrated customer base"
    // May indicate: ghost transactions, captive customer scheme

  // Anomaly 4: Temporal pattern shift
  hourly_dist = agent.hourly_distribution(last_24h)
  baseline_dist = agent.hourly_distribution(window)
  IF cosine_similarity(hourly_dist, baseline_dist) < 0.7:
    ALERT: "Agent {id} operating hours shifted significantly"
    // May indicate: change in operator, fraud during off-hours
```

---

## Observability Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|---|---|---|
| **Alerting on raw TPS** | TPS varies by time of day/week; static thresholds produce false alarms | Alert on TPS as % of capacity, or deviation from time-of-week baseline |
| **Aggregate-only success rate** | 99.5% overall can mask 90% for one MNO | Break down every metric by MNO, country, and channel |
| **Logging full amounts** | Regulatory risk in operational logs | Log amount bands ("1K-10K KES"); full amounts only in access-controlled audit logs |
| **Ignoring SMS delivery** | SMS is the only receipt for 55% of users | Track SMS delivery as Tier 1 metric with per-MNO breakdown |
| **Same thresholds all countries** | Kenya at 10× Tanzania's volume dominates aggregates | Country-specific dashboards and SLOs |
| **Not monitoring the monitor** | Silent reconciliation failure means undetected discrepancies | Dead man's switch: if hourly reconciliation doesn't report, alert on the check itself |

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
