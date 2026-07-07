# 07 — Observability: Customer Data Platform

## Observability Philosophy

A CDP's observability stack must answer three distinct questions simultaneously: (1) **Is the pipeline healthy?** — are events flowing, profiles updating, and destinations delivering? (2) **Is the data correct?** — is identity resolution producing accurate merges, and are audiences computing expected memberships? (3) **Are we compliant?** — are consent rules being enforced, and are erasure requests completing on time? Standard infrastructure metrics answer the first question; the second and third require domain-specific data quality and compliance metrics that most platforms lack.

---

## Event Pipeline Metrics

### Ingest Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `ingest.events_received_rate` | Counter | Events received at edge per second | < 10% of expected baseline for > 5min |
| `ingest.events_queued_rate` | Counter | Events successfully enqueued per second | — |
| `ingest.schema_violation_rate` | Gauge | % of events failing schema validation | > 1% for any event type |
| `ingest.auth_failure_rate` | Gauge | % of requests with invalid write keys | > 0.1% (potential key compromise) |
| `ingest.dedup_rejection_rate` | Counter | Duplicate events rejected per second | Spike > 10x baseline (SDK retry storm) |
| `ingest.dead_letter_queue_depth` | Gauge | Current DLQ message count | > 10,000 (sustained > 15min) |
| `ingest.p99_latency_ms` | Histogram | p99 latency from receipt to queue confirmation | > 200ms |
| `ingest.p50_latency_ms` | Histogram | Median ingest latency | > 50ms |

### Processing Pipeline Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `pipeline.processing_lag_seconds` | Gauge | Age of oldest unprocessed event in queue | > 60s |
| `pipeline.identity_resolution_duration_ms` | Histogram | p99 time for identity resolution per event | > 500ms |
| `pipeline.profile_write_duration_ms` | Histogram | p99 time for profile store write | > 200ms |
| `pipeline.merge_rate` | Counter | Profile merges per minute | Spike > 5x baseline (bot traffic?) |
| `pipeline.processing_error_rate` | Gauge | % of events failing downstream processing | > 0.01% |
| `pipeline.retry_rate` | Counter | Events sent to retry queue per minute | Sustained > 1% of throughput |

---

## Identity Resolution Quality Metrics

Identity quality metrics are critical because silent errors (wrong merges, missed stitching) are invisible to infrastructure monitoring but cause incorrect behavior for downstream consumers.

| Metric | Type | Description | Target |
|---|---|---|---|
| `identity.merge_precision` | Gauge | % of merges confirmed correct by ground truth (sampled) | > 99.9% for deterministic |
| `identity.merge_recall` | Gauge | % of same-person records actually merged | > 85% overall |
| `identity.cluster_size_distribution` | Histogram | Distribution of identity cluster sizes | p99 < 20 nodes (p99 > 100 = anomaly) |
| `identity.merge_latency_p99_ms` | Histogram | p99 time to complete merge after trigger event | < 1,000ms |
| `identity.cross_device_stitch_rate` | Gauge | % of anonymous sessions stitched to authenticated profile within 7 days | Tracked as KPI |
| `identity.orphan_anonymous_profiles` | Gauge | Anonymous profiles older than 90 days with no authenticated link | < 20% of anonymous pool |
| `identity.false_merge_reported_count` | Counter | Manually reported false merges (user reports) | < 1 per million profiles per month |
| `identity.lock_contention_rate` | Gauge | % of merge attempts waiting > 100ms for distributed lock | < 0.1% |

### Identity Quality Dashboard

The identity quality dashboard runs a continuous sampling job that:
1. Samples 10,000 merged profile pairs per day
2. Checks each pair for consistency (shared email, shared purchase history, same device)
3. Flags suspected false merges for human review
4. Reports precision/recall metrics based on review outcomes

This provides an ongoing signal for the probabilistic matching threshold — if false merges increase, the confidence threshold is raised automatically.

---

## Audience Engine Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `audience.streaming_eval_latency_p99_ms` | Histogram | p99 time from event to membership delta published | > 1,000ms |
| `audience.streaming_eval_throughput` | Counter | Segment evaluations per second | < 80% of expected (CEP backlog forming) |
| `audience.batch_refresh_duration_minutes` | Gauge | Time to complete last batch segment refresh | > 30min for scheduled 15-min refresh |
| `audience.segment_dirty_ratio` | Gauge | % of profiles in dirty set at refresh time | Tracked as efficiency metric |
| `audience.membership_delta_rate` | Counter | Enter/exit events per minute | Spike > 100x baseline (runaway segment?) |
| `audience.stale_membership_ratio` | Gauge | % of batch-evaluated profiles with last eval > 2× refresh interval | > 5% |
| `audience.cep_rule_compile_failures` | Counter | Segment rule compilation failures per day | > 0 |

---

## Destination Health Monitoring

### Per-Destination Metrics

Each destination has its own metrics namespace: `destination.{destination_id}.*`

| Metric | Description | Alert Threshold |
|---|---|---|
| `destination.delivery_success_rate` | % of deliveries acknowledged successfully | < 95% over 15-min window |
| `destination.delivery_latency_p99_ms` | p99 time from dequeue to delivery acknowledgment | > 30,000ms (30s) |
| `destination.queue_depth` | Current undelivered message count | > 1M messages |
| `destination.queue_age_oldest_seconds` | Age of oldest message in queue | > 3,600s (1 hour) |
| `destination.retry_rate` | Delivery attempts that are retries (not first attempt) | > 10% of total attempts |
| `destination.dead_letter_rate` | Messages moved to DLQ per hour | > 100/hour |
| `destination.circuit_state` | Circuit breaker state (0=closed, 1=half_open, 2=open) | Alert when state = 2 (open) |
| `destination.consecutive_failures` | Consecutive failed deliveries | > 3 (warn), > 5 (critical) |

### Destination Fleet Overview Dashboard

Provides a heatmap of all destinations in a workspace, with rows representing destinations and columns representing 5-minute time buckets. Cell color:

- Green: > 99% success rate
- Yellow: 95–99% success rate
- Orange: 80–95% success rate
- Red: < 80% success rate or circuit open

This allows operators to immediately identify degraded destinations across a large fleet.

---

## SLO Dashboards

### SLO 1: Ingest Availability

```
SLO:    ≥ 99.99% of events accepted within 200ms p99
Window: Rolling 30 days

Indicators:
  Good event:    Received, schema-valid, enqueued within 200ms
  Bad event:     5xx error returned OR enqueue latency > 200ms

Error budget:    30 days × 1 minute/day × 0.01% = ~4.3 minutes/30days
Current burn:    Displayed as % of error budget consumed
Burn rate alert: Alert when 1-hour burn rate × 2 > daily budget
```

### SLO 2: Profile Update Propagation

```
SLO:    p99 event-to-profile-update < 500ms
Window: Rolling 1 hour

Measurement:
  - Each event tagged with received_at timestamp
  - Profile write completion event tagged with profile_updated_at
  - Propagation latency = profile_updated_at - received_at
  - Measured over 1% sampled events

Alert: p99 > 500ms for > 5 minutes
```

### SLO 3: Destination Delivery

```
SLO:    ≥ 99.9% of deliveries succeed within 72-hour retry window
Window: Rolling 24 hours

Indicators:
  Successful delivery:   HTTP 2xx received within retry window
  Failed delivery:       Moved to DLQ after max retries OR TTL expired

Alert: Success rate < 99.9% for > 30 minutes
```

### SLO 4: Erasure Completion

```
SLO:    100% of erasure requests completed within 30 days (GDPR)
Window: Per-request

Monitoring:
  - Each erasure request tracked by request_id
  - Age of oldest incomplete request tracked continuously
  - Alert when any in-progress request age > 25 days (5-day buffer)
  - Weekly compliance report: requests received, completed, pending
```

---

## Alerting Rules

### P0 (Page Immediately)

```
1. Ingest queue partition lag > 60 seconds (events not being processed)
2. Profile store cluster is unreachable (all replicas down for any shard)
3. Identity graph is unreachable
4. Any destination circuit breaker open AND queue age > 1 hour
5. Erasure request approaching deadline (age > 25 days)
6. Consent enforcement cache stale > 5 minutes (potential consent violation window)
```

### P1 (Page Within 15 Minutes)

```
1. Ingest p99 latency > 500ms sustained > 5 minutes
2. Schema violation rate > 5% for any event type (suggests SDK regression)
3. Merge rate spike > 10x baseline (potential bot or data quality issue)
4. Batch segment refresh > 30 minutes overdue
5. Dead letter queue depth > 100,000 messages
6. Any destination queue depth > 10M messages
```

### P2 (Ticket, Respond Within 4 Hours)

```
1. Identity merge precision metric drops below 99%
2. Orphan anonymous profile ratio > 25%
3. Streaming CEP evaluation lag > 5 seconds
4. Computed trait recomputation more than 2 refresh cycles behind
5. Audit log replication lag > 1 minute
```

---

## Distributed Tracing

Every event carries a trace context (trace ID propagated from SDK through the entire pipeline). Distributed traces are sampled at 1% for all events and 100% for events that trigger errors, DLQ routing, or identity merges.

A complete trace for a "Product Viewed" event includes spans for:
- Edge collector receipt
- Schema validation
- Ingest queue publish
- Identity resolution (with sub-spans for graph lookup, merge if applicable)
- Profile write
- Streaming segment evaluation (with sub-spans per evaluated segment)
- Fan-out routing
- Destination queue publish (per destination)

Average trace depth: 8–15 spans. Traces are retained for 7 days for debugging; summary statistics are retained for 90 days.

### Trace Sampling for Consent Debugging

A specialized 100% trace sampler is applied to events that interact with consent checks:
- Events dropped due to consent (to verify the consent check was correct)
- Events forwarded to destinations despite consent uncertainty

These traces are surfaced in a dedicated "consent compliance" dashboard and retained for 2 years for regulatory defense.

---

## Data Quality Monitoring

### Profile Completeness Metrics

| Metric | Description | Target |
|---|---|---|
| `data_quality.profile_completeness_score` | Average % of core traits populated per profile | > 60% for authenticated profiles |
| `data_quality.email_fill_rate` | % of profiles with a valid email identifier | Tracked as KPI (varies by workspace) |
| `data_quality.trait_freshness_p50_hours` | Median age of most-recently-updated trait per profile | < 168 hours (7 days) for active profiles |
| `data_quality.stale_profile_ratio` | % of profiles with no event in > 90 days | < 40% (high ratio suggests cleanup needed) |
| `data_quality.duplicate_identity_rate` | Estimated % of real-world individuals represented by > 1 profile | < 5% (measured by sampling) |

### Event Quality Metrics

| Metric | Description | Alert Threshold |
|---|---|---|
| `data_quality.schema_coverage` | % of event types with registered schemas | 100% (unregistered events = shadow data) |
| `data_quality.property_null_rate` | % of null values for required properties | > 5% for any required property |
| `data_quality.event_volume_anomaly` | Z-score of current event rate vs. 7-day baseline | |z| > 3 (sudden spike or drop) |
| `data_quality.timestamp_skew_rate` | % of events with client timestamp > 5 minutes from server receipt | > 2% (suggests SDK clock issue) |
| `data_quality.property_cardinality` | Number of distinct values for a property per hour | Sudden increase > 10× baseline (potential PII leak) |

### Computed Trait Quality

| Metric | Description | Alert Threshold |
|---|---|---|
| `data_quality.trait_recomputation_lag` | Time since last successful recomputation for scheduled traits | > 2× scheduled interval |
| `data_quality.trait_value_distribution_drift` | KL-divergence of trait value distribution vs. 7-day rolling baseline | > 0.5 (significant drift) |
| `data_quality.trait_dependency_cycle_count` | Number of detected cycles in trait dependency DAG | > 0 (cycles = configuration error) |
| `data_quality.trait_null_injection_rate` | % of trait recomputations that produce NULL from non-NULL input | > 1% for any trait (suggests data loss) |

---

## Error Budget Integration

### SLO Error Budget Dashboard

The error budget dashboard provides a unified view of all SLOs and their remaining budget:

```
┌─────────────────────────────────────────────────────────────────┐
│  SLO Error Budget Status (Rolling 30-Day Window)                │
├─────────────────────┬──────────┬──────────┬─────────────────────┤
│ SLO                 │ Target   │ Consumed │ Status              │
├─────────────────────┼──────────┼──────────┼─────────────────────┤
│ Ingest Availability │ 99.99%   │   12%    │ ███░░░░░░░ GREEN    │
│ Profile Propagation │ < 500ms  │   34%    │ ██████░░░░ GREEN    │
│ Profile Lookup API  │ < 50ms   │    8%    │ █░░░░░░░░░ GREEN    │
│ Segment Evaluation  │ < 1000ms │   55%    │ ████████░░ YELLOW   │
│ Dest. Delivery      │ 99.9%    │   22%    │ ████░░░░░░ GREEN    │
│ Erasure Completion  │ 100%/30d │    0%    │ ░░░░░░░░░░ GREEN    │
└─────────────────────┴──────────┴──────────┴─────────────────────┘
```

### Burn Rate Alerting

Multi-window burn rate alerts detect both fast and slow budget consumption:

```
FUNCTION evaluate_burn_rate(slo, window_1h, window_6h):
  budget_total = slo.error_budget_30d
  burn_1h = (errors_in_window(1h) / budget_total) × (30 × 24)  // Projected to 30 days
  burn_6h = (errors_in_window(6h) / budget_total) × (30 × 24 / 6)

  IF burn_1h > 14.4 AND burn_6h > 6:
    // Fast burn: will exhaust budget in ~2 hours at current rate
    TRIGGER P0 alert

  IF burn_1h > 6 AND burn_6h > 3:
    // Medium burn: will exhaust budget in ~5 hours
    TRIGGER P1 alert

  IF burn_6h > 1:
    // Slow burn: consuming budget faster than sustainable
    TRIGGER P2 alert
```

### Error Budget Policy Enforcement

```
Budget Status Transitions:
  GREEN (>75% remaining):
    - Normal operations
    - Feature deployments proceed
    - Reliability work prioritized alongside features

  YELLOW (50-75% remaining):
    - Review burn rate weekly
    - Schedule reliability improvements for next sprint
    - Require reliability review for new deployments

  ORANGE (25-50% remaining):
    - Freeze non-critical feature deployments
    - All engineering focus shifts to reliability
    - Daily burn rate review with team leads

  RED (<25% remaining):
    - All deployments frozen except reliability fixes
    - Incident-level response for ongoing budget consumption
    - Executive review required to resume feature work

  EXHAUSTED (0% remaining):
    - All changes frozen
    - Formal postmortem required
    - Reliability improvement plan with measurable targets before resuming
```

---

## Operational Runbooks

### Runbook 1: Ingest Pipeline Stall

**Trigger:** `pipeline.processing_lag_seconds > 60s` sustained for 5 minutes

```
Step 1: Diagnose the Slowest part of the process
  - Check ingest queue consumer lag per partition
  - Check pipeline worker CPU/memory utilization
  - Check identity graph latency (if graph is slow, pipeline backs up)
  - Check profile store write latency

Step 2: Identify the cause
  IF queue lag is growing AND workers are healthy:
    → Insufficient worker capacity. Scale out pipeline workers.
  IF queue lag is growing AND workers show high CPU:
    → Workers are saturated. Check for hot partitions or complex identity merges.
  IF identity_resolution_duration_ms spike:
    → Identity graph contention. Check for cluster explosion (unusually large
      identity clusters causing long BFS traversals).
  IF profile_write_duration_ms spike:
    → Profile store overloaded. Check for shard hotspots or storage capacity.

Step 3: Mitigate
  - Scale pipeline worker instances by 2× as immediate relief
  - If identity graph is the Slowest part of the process: enable cluster size circuit breaker
    (skip merges for clusters > 1000 nodes; queue for async resolution)
  - If profile store is the Slowest part of the process: enable write batching mode
    (coalesce profile updates per profile ID over 500ms windows)

Step 4: Verify recovery
  - Confirm processing_lag_seconds returns to < 10s within 15 minutes
  - Confirm no data loss by checking DLQ depth
  - Monitor for 1 hour post-recovery
```

### Runbook 2: Destination Circuit Breaker Open

**Trigger:** `destination.circuit_state = 2` (open) AND `destination.queue_age_oldest_seconds > 3600`

```
Step 1: Assess impact
  - Identify which destination(s) have open circuits
  - Check destination.delivery_success_rate history (when did failures start?)
  - Check destination.consecutive_failures count

Step 2: Diagnose
  IF destination returns 429 (rate limit):
    → Reduce delivery rate; contact destination for rate limit increase
  IF destination returns 5xx:
    → Destination service outage; monitor their status page
  IF destination returns 401/403:
    → Credential expired or revoked; trigger credential refresh
  IF destination is unreachable (connection timeout):
    → Network issue; check DNS resolution and routing to destination

Step 3: Manage the queue
  - If queue depth > 10M: enable spillover to object storage to prevent
    queue memory pressure
  - If queue age > 24h: alert workspace administrator about potential
    data delivery delay
  - If queue age > 48h: begin preparing DLQ routing for oldest messages

Step 4: Recovery
  - Once destination health is restored, circuit breaker transitions to half-open
  - Monitor delivery success rate during half-open phase
  - Confirm full queue drain within expected time window
```

### Runbook 3: Identity Graph Corruption Suspected

**Trigger:** `identity.false_merge_reported_count` spike OR identity quality dashboard shows precision drop below 98%

```
Step 1: Quantify scope
  - Query identity graph for clusters with anomalous size (> 100 nodes)
  - Check recent merge events for patterns (same source IP, same write key, same time window)
  - Sample 100 recently-merged profiles and manually verify merge correctness

Step 2: Contain
  - If poisoning attack suspected: disable probabilistic identity matching
    (keep only deterministic matching on hard identifiers)
  - If merge bug suspected: pause identity resolution; queue events for
    batch processing after fix
  - Tag all merges in the suspect time window as "under review"

Step 3: Remediate
  - For confirmed false merges: execute split operations to reverse the merge
    - Restore original profiles from event replay if necessary
    - Re-evaluate audience memberships for all affected profiles
  - For identity graph poisoning: identify and block the source of malicious events

Step 4: Prevent recurrence
  - Tighten merge confidence thresholds
  - Add the attack pattern to the merge anomaly detector
  - Update monitoring thresholds based on learnings
```

### Runbook 4: Consent Enforcement Failure

**Trigger:** `consent_enforcement_cache_stale > 5 minutes` OR consent compliance dashboard shows non-consented deliveries

```
Step 1: Immediate containment
  - If consent cache is stale: pause ALL destination delivery immediately
    (this is a potential regulatory violation)
  - If non-consented deliveries detected: identify affected profiles and destinations

Step 2: Diagnose
  - Check consent event stream lag
  - Check consent cache service health
  - Verify consent enforcement layer is running and consuming the stream

Step 3: Remediate
  - Restore consent cache from the consent event log (source of truth)
  - Resume delivery only after cache consistency is verified
  - For non-consented deliveries that already occurred:
    - Record in audit log with explanation
    - Notify affected destination to suppress/delete the delivered data
    - Assess whether regulatory notification is required (DPO decision)

Step 4: Post-incident
  - Root cause analysis on why consent cache went stale
  - Consider adding a hard delivery gate: if consent cache age > threshold,
    block all deliveries (fail-safe instead of fail-open)
```

---

## Compliance Monitoring Dashboards

### GDPR Compliance Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  GDPR Compliance Status                                         │
├─────────────────────────────────────────────────────────────────┤
│  Erasure Requests                                               │
│  ├─ Pending:  12  │  Oldest: 8 days  │  Avg completion: 4.2d   │
│  ├─ Overdue:   0  │  SLA: 30 days    │  On-time rate: 100%     │
│  └─ Completed (30d): 347                                        │
│                                                                 │
│  Data Subject Access Requests                                   │
│  ├─ Pending:   3  │  Oldest: 2 days  │  Avg completion: 1.8d   │
│  └─ Completed (30d): 89                                         │
│                                                                 │
│  Consent State                                                  │
│  ├─ Profiles with explicit consent:        72.3%                │
│  ├─ Profiles with legitimate interest:     18.1%                │
│  ├─ Profiles with unknown consent:          9.6%                │
│  └─ Consent cache freshness:               < 30s               │
│                                                                 │
│  Cross-Border Data Transfers                                    │
│  ├─ EU data in EU region:                  100%    ✓            │
│  ├─ Standard contractual clauses active:   100%    ✓            │
│  └─ Transfer impact assessments current:   100%    ✓            │
└─────────────────────────────────────────────────────────────────┘
```

### Audit Trail Health

| Metric | Description | Alert |
|---|---|---|
| `audit.write_success_rate` | % of audit events successfully persisted | < 99.99% → P0 |
| `audit.replication_lag_ms` | Lag between primary and replica audit stores | > 60,000ms → P1 |
| `audit.chain_integrity` | Result of hourly Merkle chain verification | Any failure → P0 |
| `audit.storage_remaining_days` | Days until audit storage capacity is exhausted | < 90 days → P2 |
| `audit.oldest_unarchived_record_days` | Age of oldest audit record not yet archived to cold storage | > 365 days → P2 |
