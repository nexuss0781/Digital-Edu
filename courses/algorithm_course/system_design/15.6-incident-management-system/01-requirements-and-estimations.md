# Requirements & Estimations — Incident Management System

## 1. Functional Requirements

### 1.1 Alert Ingestion & Deduplication

- Accept alerts from heterogeneous sources (monitoring systems, APM, custom integrations) via REST API, email, and webhooks
- Deduplicate alerts using configurable deduplication keys (source + alert class + service)
- Group correlated alerts into a single incident (e.g., 500 "database connection timeout" alerts → 1 incident)
- Support suppression rules and maintenance windows to mute expected noise

### 1.2 On-Call Scheduling & Rotation

- Define rotation schedules with configurable rotation periods (daily, weekly, custom)
- Support multiple schedule layers (primary, secondary, manager) that overlay into a final schedule
- Handle overrides (vacation swaps, ad-hoc coverage changes) with time-bounded entries
- Implement follow-the-sun scheduling for globally distributed teams
- Track on-call burden metrics per engineer for fair distribution

### 1.3 Escalation Policies

- Define multi-level escalation chains (L1 on-call → L2 team lead → L3 engineering manager → L4 VP)
- Configurable escalation timeouts per level (e.g., L1 has 5 minutes to acknowledge before L2 is paged)
- Support both linear and round-robin escalation within a level
- Allow re-escalation on severity change
- Repeat policies for unacknowledged incidents

### 1.4 Multi-Channel Notification

- Deliver notifications via phone call (TTS), SMS, push notification, email, Slack, and Microsoft Teams
- Configurable notification rules per user (e.g., "phone call for P1, push for P2, email for P3")
- Retry logic with channel failover (push fails → SMS → phone call)
- Delivery confirmation and read receipts where channel supports it
- Quiet hours with override for critical severity

### 1.5 Incident Lifecycle Management

- State machine: `triggered` → `acknowledged` → `investigating` → `mitigating` → `resolved`
- Support for merging duplicate incidents and splitting compound incidents
- Incident roles (commander, communication lead, subject-matter expert)
- Real-time collaboration (Slack/Teams channel auto-creation, war room)
- Timeline auto-capture (every state change, notification, action logged with timestamp)

### 1.6 Runbook Automation

- Attach runbooks (diagnostic or remediation) to services or alert types
- Support manual trigger, semi-automatic (suggest + confirm), and fully automatic execution modes
- Capture runbook execution output as incident context
- Parameterized runbooks with input from alert payload
- Approval gates for destructive remediation actions

### 1.7 Post-Incident Reviews

- Auto-generate draft postmortem from incident timeline, chat transcripts, and actions taken
- Structured templates (summary, impact, root cause, contributing factors, action items)
- Action item tracking with owners and due dates
- Trend analysis across incidents (recurring root causes, repeat offenders)

### 1.8 Analytics & Reporting

- Track MTTA (Mean Time to Acknowledge), MTTR (Mean Time to Resolve), MTTD (Mean Time to Detect)
- Incident frequency by service, severity, team
- On-call burden analysis (pages per engineer, after-hours pages, sleep interruptions)
- SLA compliance reporting

---

## 2. Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| **Availability** | 99.99% (52 min downtime/year) | This is a critical-path system; downtime means incidents go undetected |
| **Alert-to-notification latency** | p99 < 30 seconds | Human response time starts only after notification; every second of platform latency adds to MTTR |
| **Notification delivery rate** | > 99.9% within 60 seconds | Failed notification = missed incident = potential outage extension |
| **Alert ingestion throughput** | 100K alerts/minute sustained, 1M/minute burst | Alert storms during major incidents can generate 10-100x normal volume |
| **Deduplication accuracy** | False positive < 0.1%, false negative < 1% | False positive (over-grouping) hides separate incidents; false negative (under-grouping) creates noise |
| **Data durability** | Zero alert loss | Every alert must be persisted before acknowledgment; no fire-and-forget |
| **Escalation timer accuracy** | ±5 seconds | Escalation timers must fire reliably even under load; late escalation defeats the purpose |
| **Multi-region** | Active-active across ≥2 regions | Single-region failure must not prevent incident notification |

---

## 3. Capacity Estimations

### 3.1 Alert Volume

| Metric | Value | Calculation |
|--------|-------|-------------|
| Monitored services | 50,000 | Large enterprise with microservice architecture |
| Avg alerts/service/day (normal) | 2 | Most services generate low-noise alerts |
| Daily alert volume (normal) | 100K | 50,000 × 2 |
| Alert storm multiplier | 50x | Major incident affects cascading services |
| Peak alert volume (storm) | 5M/day → ~58K/min | 100K × 50 concentrated in 90-min window |
| Post-dedup incident volume | 500-2,000/day | 100:1 to 50:1 deduplication ratio |

### 3.2 Notification Volume

| Metric | Value | Calculation |
|--------|-------|-------------|
| Incidents requiring notification/day | 1,000 | Post-dedup, after suppression and maintenance windows |
| Avg notifications per incident | 3 | Primary + backup channels + escalation |
| Daily notifications | 3,000 | 1,000 × 3 |
| Peak notifications (storm) | 15,000/hour | 5x normal during major incidents; must sustain telephony burst |
| Registered on-call users | 10,000 | Across all teams in a large org |

### 3.3 Storage

| Data Type | Size/Record | Retention | Daily Volume | Storage/Year |
|-----------|-------------|-----------|--------------|--------------|
| Raw alerts | 2 KB avg | 90 days | 200 MB | 18 GB (rolling) |
| Incidents | 10 KB avg | 3 years | 10 MB | 10.8 GB |
| Notification records | 1 KB avg | 1 year | 3 MB | 1.1 GB |
| On-call schedules | 500 B/entry | Indefinite | Negligible | < 1 GB |
| Runbook executions | 50 KB avg | 1 year | 50 MB | 18 GB |
| Postmortem documents | 100 KB avg | Indefinite | 5 MB | 1.8 GB |
| **Total** | | | | **~50 GB/year** |

### 3.4 Compute

| Component | Baseline | Storm Peak | Notes |
|-----------|----------|------------|-------|
| Alert ingestion | 4 pods | 40 pods | Stateless; auto-scales on queue depth |
| Deduplication engine | 8 pods | 20 pods | Requires hot state (recent alert fingerprints) |
| Escalation engine | 4 pods | 8 pods | Timer-driven; less bursty |
| Notification dispatcher | 6 pods | 30 pods | Bound by external channel rate limits |
| Runbook executor | 4 pods | 12 pods | Compute-heavy; isolated for security |

---

## 4. SLOs and SLAs

### 4.1 Internal SLOs

| SLO | Target | Measurement |
|-----|--------|-------------|
| Alert ingestion success rate | 99.99% | Alerts accepted / alerts received |
| Alert-to-notification p50 latency | < 10 seconds | From API receipt to first notification dispatch |
| Alert-to-notification p99 latency | < 30 seconds | Including dedup, routing, and channel dispatch |
| Escalation timer accuracy | 99.9% fire within ±5s | Timer fires compared to configured timeout |
| Notification delivery success (phone) | > 98% | Call connected / call attempted |
| Notification delivery success (push) | > 99.5% | Push delivered / push sent |
| Deduplication precision | > 99.9% | 1 − (false positives / total dedup decisions) |
| Platform availability | 99.99% | Measured across all regions combined |

### 4.2 External SLAs (to customers)

| SLA | Commitment | Penalty |
|-----|------------|---------|
| Web availability | 99.9% monthly | Service credits |
| API availability | 99.95% monthly | Service credits |
| Notification delivery | 99.9% within 60s | Service credits |
| Scheduled downtime | Zero | All maintenance performed via rolling deploys |

---

## 5. Key Constraints

1. **Telephony provider dependency** — Phone calls and SMS depend on external carriers with their own rate limits and outage profiles
2. **Global compliance** — Notification content may contain PII; must comply with GDPR, CCPA, and regional telecom regulations
3. **Channel heterogeneity** — Each notification channel (phone, SMS, push, Slack, Teams, email) has fundamentally different delivery semantics, latencies, and failure modes
4. **Clock sensitivity** — Escalation timers and on-call schedule evaluation depend on accurate, synchronized clocks across all nodes
5. **Alert format diversity** — Alerts arrive in hundreds of different schemas from different monitoring tools; normalization is essential
6. **Meta-reliability** — The incident platform cannot share infrastructure with the systems it monitors; must survive when everything else fails
7. **Human factors** — On-call engineers are human; alert fatigue, sleep deprivation, and notification psychology directly impact MTTA/MTTR

---

## 6. Growth Projections (2026–2028)

| Metric | 2026 Baseline | 2027 Projected | 2028 Projected | Growth Driver |
|---|---|---|---|---|
| Monitored services | 50,000 | 75,000 | 100,000 | Microservice proliferation, multi-cloud |
| Daily alert volume | 100K | 150K | 200K | More services, more monitoring coverage |
| Post-dedup incidents/day | 1,500 | 2,000 | 2,500 | Alert volume growth partially offset by better dedup |
| Registered on-call users | 10,000 | 15,000 | 20,000 | Engineering team growth |
| Runbook executions/day | 200 | 500 | 1,000 | Automation adoption curve |
| AI-assisted correlations/day | 0 | 500 | 2,000 | ML correlation engine rollout |

---

## 7. Cost Estimation (Annual, Enterprise-Scale Platform)

| Component | Cost Driver | Annual Estimate |
|---|---|---|
| Compute (all services) | ~100 pods baseline, ~300 storm | ~$1.5M |
| Database (multi-region, replicated) | 50 GB/year, high IOPS | ~$500K |
| Message queue (multi-AZ) | 100K msg/min burst capacity | ~$300K |
| Telephony (phone + SMS) | 3,000 notifications/day, ~$0.05-0.50 per call | ~$800K |
| Push notification services | 2,000 notifications/day | ~$50K |
| Meta-monitoring infrastructure | Separate compute, separate providers | ~$200K |
| Chat platform integrations | Slack/Teams API usage | ~$100K |
| **Total** | | **~$3.5M/year** |

*Telephony is the dominant variable cost. Phone calls cost 10-50× more than push notifications, making severity-based channel routing a direct cost optimization.*

---

## 8. SLO Error Budget Allocation

| SLO | Monthly Budget | Allocation |
|---|---|---|
| Platform availability 99.99% | 4.3 min downtime | 2 min planned deploys + 2.3 min unplanned |
| Alert-to-notification p99 < 30s | 0.1% of alerts over budget | 0.05% deploy-related + 0.05% storm-related |
| Notification delivery > 99.9% | 0.1% failures allowed | 0.05% provider failures + 0.05% channel failures |
| Escalation timer accuracy ±5s | 0.1% timers outside budget | 0.05% clock drift + 0.05% load-related delay |

---

## 9. Alert Storm Profile Analysis

| Storm Trigger | Alert Multiplier | Duration | Dedup Ratio | Example |
|---|---|---|---|---|
| **Single service crash** | 10× | 15-30 min | 50:1 | Database becomes unavailable |
| **Cascading failure** | 50× | 60-90 min | 100:1 | DNS failure affecting all downstream services |
| **Infrastructure outage** | 100× | 2-4 hours | 500:1 | Cloud provider region failure |
| **Deployment rollout** | 5× | 10-20 min | 20:1 | Bad deploy across 50 services |
| **Network partition** | 30× | 30-60 min | 200:1 | Network segment becomes unreachable |

*The dedup engine must scale to handle the worst case (100× multiplier, 500:1 dedup ratio) while maintaining the 30-second alert-to-notification SLO.*

---

## 10. Network Topology Requirements

| Path | Protocol | Latency Requirement | Bandwidth | Notes |
|---|---|---|---|---|
| Alert source → API Gateway | HTTPS (TLS 1.3) | < 200ms | 50 Mbps burst | Internet-facing; rate-limited per integration |
| API Gateway → Alert Queue | Internal (mTLS) | < 5ms | 100 Mbps burst | Same-region; must survive cross-AZ latency |
| Queue → Dedup Engine | Internal (mTLS) | < 10ms | 50 Mbps sustained | Consumer pull; batch-optimized |
| Dedup Engine → Fingerprint Store | Internal (Redis protocol) | < 1ms | 20 Mbps sustained | Hot path; cache misses unacceptable |
| Notification Dispatcher → Telephony | HTTPS to external API | < 100ms | 5 Mbps | Provider-dependent; failover path must be tested |
| Cross-region DB replication | Internal (mTLS) | < 50ms | 10 Mbps sustained | Synchronous for incident state; async for audit logs |
| Meta-monitor → Platform API | HTTPS (separate network) | < 200ms | 1 Mbps | Must NOT share network path with monitored infrastructure |

---

## 11. Notification Cost Optimization

| Channel | Cost per Notification | Effective Delivery Rate | Cost per Effective Delivery | When to Use |
|---|---|---|---|---|
| Push notification | ~$0.001 | 79.6% | ~$0.0013 | First-choice for P2-P4 during business hours |
| Slack / Teams message | ~$0.0005 | 75% (within 5 min) | ~$0.0007 | Informational; P3/P4 during business hours |
| SMS | ~$0.02 | 69.3% | ~$0.029 | Fallback for push failure; P2 after-hours |
| Email | ~$0.003 | 40% (within 30 min) | ~$0.0075 | Low-urgency; postmortem notifications |
| Phone call (domestic) | ~$0.10 | 83.3% | ~$0.12 | P1 always; P2 after-hours; escalation backstop |
| Phone call (international) | ~$0.50 | 83.3% | ~$0.60 | Follow-the-sun; international on-call |

*Severity-based channel routing is not just a UX decision — it's a direct cost optimization. Routing all P3 alerts via push instead of phone saves ~$0.12 per notification, or ~$130K/year at enterprise scale.*

---

## 12. Multi-Modal Notification Constraints

| Channel | Max Concurrent | Global Rate Limit | Regulatory Constraint | Failure Signature |
|---|---|---|---|---|
| Phone (domestic) | 50-200 per provider | ~10 calls/sec | Do-not-call registry; TCPA compliance | Carrier congestion; voicemail |
| Phone (international) | 20-50 per provider | ~5 calls/sec | Country-specific telecom regulations | Routing failures; higher latency |
| SMS | 500-1000/sec | Provider-dependent | A2P filtering; DLT registration (India) | Silent drops by carrier spam filters |
| Push (iOS) | Unlimited (async) | 100K/sec typical | None | Token expiry; app uninstall |
| Push (Android) | Unlimited (async) | 100K/sec typical | None | Battery optimization kills delivery |
| Slack | 1 msg/sec per channel | Tier-based (20-120 msg/min) | None | Rate limiting; token revocation |
| Email | 50-100/sec | Provider reputation-based | CAN-SPAM; GDPR opt-out | Spam classification; delayed delivery |
