# Observability

## 1. Key Metrics

### 1.1 Business-Critical Metrics (Tier 0)

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|----------------|
| **Order Success Rate** | `delivered_orders / placed_orders` (excluding customer cancellations) | > 97% | < 95% → page |
| **Driver Assignment Time** | Time from order confirmation to driver accepting | p90 < 30s | p90 > 45s → page |
| **ETA Accuracy** | % of orders delivered within ±5 min of initial ETA | > 80% | < 70% → warn; < 60% → page |
| **Order-to-Delivery Time** | End-to-end time from placement to delivery | p50 < 35 min | p50 > 45 min per city → warn |
| **Payment Capture Rate** | % of authorized payments successfully captured | > 99.9% | < 99.5% → page |

### 1.2 Operational Metrics (Tier 1)

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|----------------|
| **Driver Utilization** | `time_on_active_delivery / total_online_time` per driver | 60-75% | < 40% city-wide → supply surplus; > 85% → supply shortage |
| **Restaurant Acceptance Rate** | % of orders accepted by restaurants | > 95% | < 90% per restaurant → flag; < 85% city-wide → page |
| **Restaurant Prep Time Variance** | Actual prep time vs. estimated | std dev < 5 min | std dev > 10 min per restaurant → retrain |
| **Driver Acceptance Rate** | % of delivery offers accepted by drivers | > 80% | < 65% city-wide → page (likely pricing/incentive issue) |
| **Cancellation Rate** | % of placed orders cancelled (by any party) | < 5% | > 8% → warn; > 12% → page |
| **Location Update Freshness** | Age of latest location update per active driver | p99 < 10s | p99 > 30s → warn (driver offline or GPS issue) |
| **Surge Coverage** | % of zones with active surge pricing | Informational | > 50% of zones in surge → investigate supply crisis |

### 1.3 Infrastructure Metrics (Tier 2)

| Metric | Description | Alert Threshold |
|--------|-------------|----------------|
| **Order Service latency** | p99 of order CRUD operations | > 500ms → warn; > 1s → page |
| **Redis Geo write throughput** | GEOADD operations/sec across all shards | > 90% of capacity → scale |
| **Kafka consumer lag** | Messages pending for location and order consumers | > 10K messages → warn; > 50K → page |
| **WebSocket connection count** | Total concurrent WebSocket connections | > 80% of gateway capacity → scale |
| **PostgreSQL replication lag** | Bytes behind primary | > 1MB → warn; > 10MB → page |
| **Elasticsearch query latency** | Restaurant search p95 | > 200ms → warn |
| **ETA model inference latency** | ML model prediction time | p99 > 100ms → warn |

---

## 2. Distributed Tracing

### 2.1 Trace Propagation

Every order generates a trace that spans all services involved in its lifecycle. The `order_id` serves as the primary correlation key.

**Trace context propagation:** All inter-service calls (HTTP, gRPC, Kafka) carry a trace context header (`X-Trace-ID`, `X-Span-ID`, `X-Parent-Span-ID`). Kafka messages include trace context in message headers.

### 2.2 Critical Trace Points

| Span | Service | Key Attributes |
|------|---------|---------------|
| `order.create` | Order Service | customer_id, restaurant_id, item_count, total_cents |
| `payment.authorize` | Payment Service | amount, payment_method, processor_response_ms |
| `dispatch.find_candidates` | Dispatch Service | city_id, radius_km, candidates_found, search_time_ms |
| `dispatch.score_candidates` | Dispatch Service | candidate_count, top_score, scoring_time_ms |
| `dispatch.assign` | Dispatch Service | driver_id, distance_km, acceptance_probability |
| `driver.offer_sent` | Notification Service | driver_id, offer_id, channel (push/ws) |
| `driver.offer_response` | Dispatch Service | offer_id, accepted (bool), response_time_ms |
| `eta.compute` | ETA Service | prep_time, driver_to_restaurant, restaurant_to_customer, total, model_version |
| `location.update` | Location Service | driver_id, lat, lng, freshness_ms |
| `order.deliver` | Order Service | actual_delivery_time, eta_error_minutes |
| `payment.capture` | Payment Service | amount, capture_result, processor_response_ms |

### 2.3 Dispatch Decision Logging

Every dispatch decision is logged with full context for debugging and ML improvement:

```
DispatchDecisionLog:
  order_id: "ord_abc123"
  city_id: "chicago"
  timestamp: "2025-01-15T18:30:00Z"
  restaurant_location: {lat: 41.8781, lng: -87.6298}
  search_radius_km: 5.0
  candidates_found: 12
  candidates_scored: 8  (4 filtered: 2 unavailable, 2 at max orders)
  top_3_candidates:
    - driver_id: "drv_001", distance: 1.2km, score: 0.87, acceptance_prob: 0.92
    - driver_id: "drv_042", distance: 1.8km, score: 0.81, acceptance_prob: 0.88
    - driver_id: "drv_019", distance: 0.9km, score: 0.79, acceptance_prob: 0.71
  assigned_driver: "drv_001"
  assignment_reason: "highest composite score"
  total_decision_time_ms: 45
  outcome: "accepted"  (filled post-delivery)
  actual_pickup_time_mins: 8  (filled post-delivery)
```

---

## 3. Logging Strategy

### 3.1 Log Levels by Service

| Service | INFO logs | WARN logs | ERROR logs |
|---------|-----------|-----------|------------|
| **Order Service** | State transitions, ETA updates | Cancellations, slow DB queries | Payment failures, state machine violations |
| **Dispatch Service** | Assignments, offer outcomes | No candidates found, radius expansion, high assignment latency | Assignment failures, driver lock contention |
| **Location Service** | None (too high volume) | Stale driver locations, GPS anomalies | Trajectory validation failures, Redis write failures |
| **Payment Service** | Authorizations, captures | 3DS challenges, declined transactions | Capture failures, reconciliation mismatches |
| **ETA Service** | None (too high volume) | Large ETA errors (>15 min), model fallback invoked | Model serving failures |

### 3.2 Structured Log Format

All services emit structured JSON logs with consistent fields:

```
{
  "timestamp": "2025-01-15T18:30:00.123Z",
  "service": "dispatch-service",
  "level": "INFO",
  "trace_id": "abc123",
  "order_id": "ord_xyz",
  "city_id": "chicago",
  "event": "driver_assigned",
  "driver_id": "drv_001",
  "distance_km": 1.2,
  "score": 0.87,
  "candidates_considered": 12,
  "decision_time_ms": 45
}
```

---

## 4. Alerting Framework

### 4.1 Alert Severity Levels

| Severity | Response Time | Notification | Examples |
|----------|--------------|-------------|---------|
| **P0 - Critical** | Immediate (page on-call) | PagerDuty + phone call | Order placement failing; payment capture broken; dispatch completely stuck |
| **P1 - High** | 15 minutes | PagerDuty + push | Driver assignment p90 > 60s; ETA accuracy < 60%; location pipeline lag > 1 min |
| **P2 - Medium** | 1 hour | Chat alert | Single city dispatch degraded; menu cache miss rate high; elevated cancellation rate |
| **P3 - Low** | Next business day | Email digest | ETA model drift detected; ratings service slow; analytics pipeline delayed |

### 4.2 Critical Alert Definitions

```
ALERT: DispatchFailureRateHigh
  condition: dispatch_failure_rate > 1% over 5 minutes (per city)
  severity: P0
  action: Page on-call SRE + dispatch team lead
  runbook: Check driver supply in affected city; check Redis geo availability; check Kafka consumer lag

ALERT: OrderStuckInAssigned
  condition: order in DRIVER_ASSIGNED state for > 15 minutes
  severity: P1
  action: Auto-escalate: reassign to new driver; if reassignment fails 3 times, alert support
  runbook: Check if driver went offline; check driver app connectivity

ALERT: LocationServiceLag
  condition: max_location_age for active drivers > 30 seconds (per city)
  severity: P1
  action: Alert SRE
  runbook: Check Redis shard health; check Kafka consumer lag; check WebSocket gateway connectivity

ALERT: PaymentCaptureFailureRate
  condition: payment_capture_failure_rate > 0.5% over 10 minutes
  severity: P0
  action: Page on-call SRE + payments team
  runbook: Check payment processor status; check network connectivity; verify token vault availability

ALERT: ETAAccuracyDrop
  condition: eta_accuracy (within ±5 min) < 65% over 1 hour (per city)
  severity: P2
  action: Alert ETA team
  runbook: Check for major traffic event; check weather API; compare model version; check routing service health

ALERT: DriverSupplyShortage
  condition: available_drivers / pending_orders < 0.5 for > 10 minutes (per city)
  severity: P1
  action: Trigger surge pricing increase; send bonus zone notifications to nearby drivers
  runbook: Verify surge pricing is active; check if new driver onboarding is needed
```

---

## 5. Dashboards

### 5.1 Operations Dashboard (Real-Time)

```
Top Row (city selector):
  [ City: Chicago ▼ ] [ Time range: Last 1 hour ▼ ]

Row 1 - Key Numbers:
  | Active Orders: 12,430 | Active Drivers: 8,210 | Avg ETA: 33 min | Success Rate: 97.2% |

Row 2 - Order Flow (time series):
  - Orders placed/min (line chart)
  - Orders delivered/min (line chart)
  - Cancellations/min (bar overlay)

Row 3 - Dispatch Health:
  - Assignment time p50/p90/p99 (line chart)
  - Driver offer acceptance rate % (line chart)
  - Surge multiplier heatmap (geo map)

Row 4 - Driver Supply/Demand:
  - Available drivers vs. pending orders (dual-axis chart)
  - Driver utilization % (gauge)
  - Dead zones (geo map highlighting areas with 0 available drivers)
```

### 5.2 ETA Accuracy Dashboard

```
Row 1 - Accuracy Over Time:
  - % orders within ±5 min of initial ETA (7-day trend)
  - Mean absolute error in minutes (7-day trend)

Row 2 - Error Breakdown:
  - Prep time error distribution (histogram)
  - Driver-to-restaurant error distribution (histogram)
  - Restaurant-to-customer error distribution (histogram)

Row 3 - By Restaurant:
  - Top 10 restaurants with worst ETA accuracy (table)
  - Bottom quartile restaurants: avg prep time error (scatter plot)

Row 4 - Model Performance:
  - Current model version + deploy date
  - A/B test results if canary active
  - Feature importance ranking
```

### 5.3 Financial Dashboard (Daily)

```
Row 1 - Revenue:
  - Total order value, delivery fees collected, tips collected
  - Comparison vs. same day last week

Row 2 - Payment Health:
  - Authorization success rate
  - Capture success rate
  - Refund rate and total refunded amount
  - Reconciliation status (matched %, unresolved count)

Row 3 - Fraud:
  - Orders blocked by fraud scoring
  - GPS spoofing attempts detected
  - Promo abuse incidents
```

---

## 6. SLO Burn Rate Alerting

Instead of static threshold alerts, the system uses **burn rate** alerting based on error budgets:

### 6.1 Error Budget Model

```
SLO: 99.99% availability for order placement during peak hours
Error budget (30-day window): 0.01% × 30 days × 8 peak hours × 3600 sec = 86.4 seconds of downtime

Burn rate = (error_rate / allowed_error_rate)
  If burn rate > 1.0: consuming error budget faster than allowed
  If burn rate > 14.4: 30-day budget will be exhausted in 2 days → page immediately
  If burn rate > 6.0: budget exhausted in 5 days → alert within 1 hour
  If burn rate > 1.0: on track to exhaust budget → warn in daily digest
```

### 6.2 Multi-Window Burn Rate Alerts

| Alert | Short Window | Long Window | Severity | Budget Consumed |
|-------|-------------|-------------|----------|----------------|
| **Critical** | 14.4× over 5 min | 14.4× over 1 hour | P0 (page) | 2% in 1 hour |
| **High** | 6× over 30 min | 6× over 6 hours | P1 | 5% in 6 hours |
| **Medium** | 3× over 2 hours | 3× over 3 days | P2 | 10% in 3 days |

Multi-window prevents alert flapping: the short window catches sudden spikes, the long window catches sustained degradation. Both must fire for the alert to trigger.

---

## 7. End-to-End Order Trace Example

A complete trace for a single order showing all service hops and timing:

```
Order ord_12345 — Total lifecycle: 38 minutes

[0ms]      → order.validate           (Order Service)          12ms
[12ms]     → payment.authorize        (Payment Service)        85ms
[97ms]     → order.persist            (Order Service → PG)     8ms
[105ms]    → order.publish            (Order Service → Kafka)  3ms
[108ms]    ← Response to customer: "Order Confirmed, ETA 35 min"

[150ms]    → notification.send        (Notification → Restaurant) 45ms
[2.1min]   → restaurant.confirm       (Restaurant Tablet)      --
[2.1min]   → eta.compute_v1           (ETA Service)            23ms
                prep_time: 18min, driver_travel: 7min, delivery: 12min

[8.5min]   → dispatch.find_candidates (Dispatch Service)       15ms
                candidates: 14 drivers within 5km
[8.52min]  → dispatch.score           (Dispatch Service)       42ms
                top_score: 0.87 (driver drv_001)
[8.56min]  → dispatch.assign          (Dispatch → Redis Lua)   2ms
[8.56min]  → notification.driver_offer (Notification → Driver) 38ms

[8.9min]   → driver.accept            (Driver App)             --
[8.9min]   → eta.compute_v2           (ETA Service)            19ms
                updated with actual driver location

[18min]    → driver.arrived_restaurant (Driver App)             --
[20.5min]  → restaurant.ready         (Restaurant Tablet)      --
[20.8min]  → driver.pickup            (Driver App)             --
[20.8min]  → eta.compute_v3           (ETA Service)            15ms
                delivery_only: 11min (routing engine)

[21-37min] → location.update × 192    (Driver → WS → Redis)   ~3ms each
             (every 5s for 16 minutes of driving)
[21-37min] → tracking.push × 192      (Redis Pub/Sub → WS → Customer)

[37.5min]  → driver.deliver           (Driver App)             --
[37.5min]  → payment.capture          (Payment Service)        92ms
[37.6min]  → notification.delivered   (Notification → Customer + Restaurant)

Total spans: 214 | Total services: 7 | ETA error: +2.5 min (actual 38 vs predicted 35)
```

---

## 8. Anomaly Detection for Proactive Incident Response

### 8.1 Automated Anomaly Detectors

| Detector | Signal | Method | Action |
|----------|--------|--------|--------|
| **Order volume anomaly** | Orders/min per city deviates >3σ from predicted | Time-series forecasting + residual analysis | Low volume → check for outage; High volume → pre-scale |
| **ETA drift** | Mean absolute error increases >30% over 1 hour | Rolling window comparison against 7-day baseline | Alert ETA team; check weather API, traffic data |
| **Driver supply cliff** | Available drivers drops >40% in 10 min for a city | Rate-of-change monitoring | Emergency surge activation; notify ops |
| **Payment decline spike** | Decline rate >5% (normal: <2%) | Threshold on 5-min rolling window | Check payment processor health; circuit breaker |
| **Restaurant rejection spike** | City-wide rejection rate >10% (normal: <5%) | Threshold with city-level granularity | Check for menu sync issues; notify restaurant ops |

### 8.2 Correlation Engine

When multiple anomalies fire simultaneously, the correlation engine groups them:

```
Example incident correlation:
  [18:05] ALERT: Location update lag > 30s (Chicago)
  [18:06] ALERT: Driver supply drop > 40% (Chicago)
  [18:06] ALERT: Dispatch failure rate > 1% (Chicago)
  [18:07] ALERT: Order placement latency p99 > 1s (Chicago)

  Correlation: All alerts are Chicago-scoped → likely infrastructure issue
  Root cause hypothesis: Redis shard for Chicago is degraded
  Auto-action: Check Redis shard health metrics for Chicago
  Runbook: escalate to infrastructure team if confirmed
```

---

## 9. Cost Attribution and FinOps Observability

Track infrastructure cost per order for business optimization:

| Metric | Calculation | Target |
|--------|------------|--------|
| **Compute cost per order** | Total compute spend / total orders | < $0.02 |
| **Storage cost per order** | Total storage + CDN / total orders | < $0.005 |
| **ML inference cost per order** | ETA + fraud + search model serving / total orders | < $0.01 |
| **Kafka cost per order** | Kafka cluster cost / total events × events-per-order | < $0.003 |
| **Total infra cost per order** | Sum of above | < $0.04 |

These metrics are tagged per city, allowing identification of cities with unusually high per-order costs (often due to low utilization of pre-provisioned infrastructure).

---

## 10. On-Call Runbook Structure

Each critical alert has an associated runbook with a standardized structure:

```
RUNBOOK: DispatchFailureRateHigh

1. ASSESS (first 2 minutes):
   □ Check which cities are affected (single city vs. global?)
   □ Check dispatch-service error rate dashboard
   □ Check Redis shard health for affected cities
   □ Check Kafka consumer lag for dispatch consumer group

2. TRIAGE (next 3 minutes):
   If single city:
     □ Check Redis shard for that city (primary alive? replica promoted?)
     □ Check recent deploys to dispatch service
     □ Check driver supply in city (driver-count metric)
   If global:
     □ Check Kafka cluster health (broker count, partition leaders)
     □ Check recent global config changes
     □ Check ETA service health (dispatch depends on ETA)

3. MITIGATE (next 5 minutes):
   □ If Redis shard down: trigger manual failover if Sentinel hasn't promoted
   □ If Kafka lag: restart consumer group with latest offset
   □ If ETA service down: enable dispatch without ETA (use distance fallback)
   □ If no root cause found: scale up dispatch instances + expand search radius

4. COMMUNICATE:
   □ Post in #incident channel with impact assessment
   □ If >5 min customer impact: create incident in status page
   □ Notify city ops teams for affected markets

5. RESOLVE & FOLLOW-UP:
   □ Confirm dispatch success rate returns to >99%
   □ Write incident postmortem within 48 hours
   □ File tickets for any manual steps that should be automated
```

---

## 11. Health Check Hierarchy

Services expose health endpoints at multiple levels:

| Level | Endpoint | What It Checks | Used By |
|-------|----------|---------------|---------|
| **Liveness** | `/health/live` | Process is running, not deadlocked | Container orchestrator (restart if fails) |
| **Readiness** | `/health/ready` | Can serve traffic (DB connected, models loaded) | Load balancer (remove from rotation if fails) |
| **Dependency** | `/health/deps` | All downstream dependencies reachable | Monitoring dashboard |
| **Deep** | `/health/deep` | Full functional check (sample query execution) | Periodic synthetic monitoring (every 30s) |

```
Example: ETA Service health endpoints

/health/live    → 200 (process alive)
/health/ready   → 200 (ML model loaded, Redis connected, routing service reachable)
/health/deps    → {
  "redis": "ok",
  "routing_service": "ok",
  "ml_model": "loaded (v2.3.1, deployed 2h ago)",
  "feature_store": "ok"
}
/health/deep    → {
  "sample_prediction": {
    "input": "test_restaurant → test_address",
    "result_mins": 28,
    "latency_ms": 18,
    "status": "ok"
  }
}
```
