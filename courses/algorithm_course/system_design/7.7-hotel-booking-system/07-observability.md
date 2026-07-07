# Observability

## Key Metrics

### Business Metrics

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|-----------------|
| **Booking conversion rate** | Bookings / unique search sessions | 2-4% | < 1.5% (30-min window) |
| **Search-to-detail rate** | Property detail views / searches | 30-40% | < 20% (30-min window) |
| **Detail-to-book rate** | Bookings / property detail views | 8-12% | < 5% (30-min window) |
| **Hold-to-confirm rate** | Confirmed bookings / holds created | 70-80% | < 50% (30-min window) |
| **Cancellation rate** | Cancellations / bookings (7-day rolling) | < 25% | > 35% |
| **Revenue per search** | Total booking revenue / searches | Varies by market | < 50% of 7-day average |
| **Average daily rate (ADR)** | Total room revenue / rooms sold | Varies by market | Tracked, not alerted |
| **Occupancy rate** | Rooms sold / rooms available | Varies by property | Tracked, not alerted |
| **RevPAR** | Revenue per available room (ADR × occupancy) | Varies | Tracked, not alerted |

### System Performance Metrics

| Metric | Description | SLO | Alert Threshold |
|--------|-------------|-----|-----------------|
| **Search latency p50** | Median search response time | < 800ms | > 1.2s (5-min window) |
| **Search latency p99** | 99th percentile search response | < 2s | > 3s (5-min window) |
| **Availability check latency p99** | Per-property availability lookup | < 200ms | > 500ms |
| **Booking confirmation latency p99** | End-to-end booking flow | < 3s | > 5s |
| **Payment success rate** | Successful payments / payment attempts | > 99% | < 97% (15-min window) |
| **Channel sync latency p99** | Time from booking to all-channel update | < 5s | > 15s |
| **Channel sync success rate** | Successful syncs / total sync attempts | > 99.9% | < 99% (1-hour window) |
| **Hold expiry rate** | Expired holds / total holds | < 30% | > 50% (1-hour window) |
| **Cache hit rate (search)** | Cache hits / total search queries | > 60% | < 40% (15-min window) |
| **Cache hit rate (availability)** | Cache hits / availability lookups | > 50% | < 30% |

### Infrastructure Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| **DB connection pool utilization** | Active connections / pool size | > 80% |
| **DB replication lag** | Standby lag behind primary | > 1 second |
| **Event bus consumer lag** | Unconsumed messages per partition | > 10,000 messages |
| **Redis memory utilization** | Used memory / max memory | > 75% |
| **Search index refresh latency** | Time from update to searchable | > 5 seconds |
| **Availability shard CPU** | Per-shard CPU utilization | > 70% |
| **Payment gateway latency p99** | Response time from payment provider | > 3 seconds |

---

## Logging Strategy

### Log Levels and Categories

```
Log levels:
  ERROR:  Payment failures, booking failures, data inconsistencies
  WARN:   Circuit breaker state changes, high latency, retry events
  INFO:   Booking confirmed, cancellation processed, channel sync complete
  DEBUG:  Availability check details, rate computation steps, cache hit/miss
```

### Structured Log Format

```
{
  "timestamp": "2025-12-20T14:30:22.456Z",
  "level": "INFO",
  "service": "booking-orchestrator",
  "trace_id": "abc-123-def-456",
  "span_id": "span-789",
  "event": "booking_confirmed",
  "reservation_id": "RES-456",
  "property_id": "P-1234",
  "total_amount": 607.50,
  "currency": "USD",
  "payment_method": "credit_card",
  "booking_source": "direct",
  "duration_ms": 1847,
  "steps": {
    "availability_check_ms": 45,
    "rate_computation_ms": 12,
    "payment_preauth_ms": 890,
    "payment_capture_ms": 780,
    "reservation_create_ms": 120
  }
}
```

### Key Log Events

| Event | Level | Service | Purpose |
|-------|-------|---------|---------|
| `search_executed` | INFO | Search | Track search patterns, latency, result count |
| `availability_check` | DEBUG | Availability | Cache hit/miss, available rooms, query latency |
| `hold_created` | INFO | Booking | Hold ID, property, dates, expiry time |
| `hold_expired` | INFO | Booking | Hold ID, property, dates (indicates abandoned booking) |
| `booking_confirmed` | INFO | Booking | Full booking details, timing breakdown |
| `booking_cancelled` | INFO | Booking | Cancellation reason, refund amount, penalty |
| `payment_failed` | ERROR | Payment | Failure reason, gateway error code, retry count |
| `payment_captured` | INFO | Payment | Amount, gateway reference, timing |
| `channel_sync_sent` | INFO | Channel Mgr | Channel, property, payload summary, latency |
| `channel_sync_failed` | ERROR | Channel Mgr | Channel, error, retry count, will-retry flag |
| `circuit_breaker_open` | WARN | Any | Service, target, failure count, open duration |
| `overbooking_detected` | WARN | Availability | Property, date, overbooked count, walk risk |
| `rate_parity_violation` | WARN | Channel Mgr | Property, channel, rate deviation |
| `review_fraud_flagged` | WARN | Review | Review ID, fraud score, fraud signals |

### Sensitive Data Handling in Logs

```
NEVER log:
  - Full credit card numbers
  - CVV / CVC codes
  - Guest passwords or authentication tokens
  - Full email addresses (log hash or masked version)

Mask in logs:
  - Guest name: "J*** D***"
  - Email: "j***@example.com"
  - Phone: "+33*****678"
  - Card: "****1234"
```

---

## Distributed Tracing

### Trace Propagation

```
Every user request receives a trace_id at the API Gateway.
The trace_id propagates through all service calls:

Search trace example:
  [trace: abc-123]
    → API Gateway (5ms)
      → BFF Service (3ms)
        → Search Service (780ms)
          → Search Index query (120ms)
          → Availability Service - batch check (450ms)
            → Redis cache check (2ms)
            → DB query for cache misses (380ms)
          → Rate Service - compute rates (180ms)
            → Redis rate cache (1ms)
            → Rate computation (150ms)
        → Response serialization (15ms)

Booking trace example:
  [trace: def-456]
    → API Gateway (5ms)
      → BFF Service (3ms)
        → Booking Orchestrator (1847ms)
          → Availability Service - check+hold (45ms)
          → Rate Service - verify price (12ms)
          → Payment Service - pre-auth (890ms)
            → Payment Gateway API call (850ms)
          → Reservation DB write (120ms)
          → Payment Service - capture (780ms)
            → Payment Gateway API call (740ms)
        → Event Bus publish (5ms)
          → Channel Manager (async, not in request path)
          → Notification Service (async, not in request path)
```

### Trace Sampling Strategy

```
Sampling rates:
  - Booking flow: 100% (every booking is traced - revenue critical)
  - Search flow: 10% (high volume, sample sufficiently)
  - Payment flow: 100% (financial compliance)
  - Channel sync: 100% (reliability critical)
  - Review submission: 50%
  - Property extranet: 20%

Error traces: always captured (100%) regardless of sampling rate
Slow traces (> 2× SLO): always captured
```

---

## Alerting Rules

### Critical Alerts (Page On-Call)

| Alert | Condition | Window | Action |
|-------|-----------|--------|--------|
| Booking success rate drop | < 95% | 5 min | Investigate payment or availability service |
| Payment failure spike | > 5% failure rate | 5 min | Check payment gateway status; failover if needed |
| Availability service down | Health check failures on > 50% of shards | 1 min | Trigger failover; scale remaining shards |
| All channel sync failing | 0 successful syncs for any channel | 5 min | Check channel API status; open circuit breaker |
| Database replication lag | > 10 seconds | 1 min | Investigate standby; prepare for failover |
| Zero bookings | No bookings processed | 10 min | Investigate full pipeline (search → book → pay) |

### Warning Alerts (Notification)

| Alert | Condition | Window | Action |
|-------|-----------|--------|--------|
| Search latency degradation | p99 > 3s | 15 min | Check search index health; cache hit rates |
| Conversion rate drop | < 1.5% | 30 min | Check search quality; price competitiveness |
| Hold expiry rate high | > 50% | 1 hour | Check payment flow; UX issues; bot activity |
| Channel sync latency high | p99 > 30s | 15 min | Check channel API latency; scale sync workers |
| Cache hit rate low | < 40% search cache | 15 min | Check cache cluster health; invalidation storm |
| Overbooking risk | Property > 95% of overbooking limit | Continuous | Notify property manager; consider closing sales |
| Event bus consumer lag | > 50,000 messages | 5 min | Scale consumer workers |

---

## Booking Funnel Analytics

### Funnel Stages

```
Stage 1: Search
  - Unique search sessions
  - Search refinements per session
  - Popular destinations and dates
  - Filter usage patterns

Stage 2: Property View
  - Click-through rate from search results
  - Time spent on property page
  - Room type comparison rate
  - Photo gallery engagement

Stage 3: Room Selection
  - Room type selected
  - Rate plan selected (flexible vs. non-refundable)
  - Rate plan comparison time

Stage 4: Hold
  - Hold creation success rate
  - Hold creation latency
  - Hold expiry rate (abandoned at payment)

Stage 5: Payment
  - Payment method distribution
  - Payment success rate
  - Payment failure reasons
  - Time to complete payment form

Stage 6: Confirmation
  - Booking confirmation success rate
  - Time from search start to confirmation
  - Booking source distribution (direct vs. channel)

Stage 7: Post-Booking
  - Modification rate
  - Cancellation rate and timing
  - Review submission rate
  - Repeat booking rate
```

### Funnel Dashboard

```
Real-time funnel metrics (updated every minute):

  Searches         ████████████████████████████████  50,000/hr (100%)
  Property Views   ██████████████                    18,000/hr (36%)
  Room Selections  ████████                           8,000/hr (16%)
  Holds Created    ██████                             5,500/hr (11%)
  Payments Made    ████                               4,200/hr (8.4%)
  Confirmed        ████                               3,800/hr (7.6%)
                                                      ↑ alerts if < 3%

Drop-off analysis:
  Search → View:    64% drop (normal: users browse)
  View → Selection: 56% drop (price sensitivity, comparison shopping)
  Selection → Hold: 31% drop (availability issues, rate changes)
  Hold → Payment:   24% drop (payment friction, price shock at total)
  Payment → Confirm: 10% drop (payment failures, technical errors)
```

### A/B Testing Observability

```
Every search and booking event includes:
  - experiment_id: active A/B test identifier
  - variant: control or treatment
  - user_segment: new, returning, loyalty member

This enables:
  - Conversion rate comparison per variant
  - Revenue impact estimation
  - Statistical significance calculation
  - Automatic rollback if variant degrades key metrics
```

---

## SLO Monitoring & Error Budgets

### Error Budget Dashboard

| SLO | Target | Budget (30-day) | Burn Rate Alert |
|-----|--------|----------------|-----------------|
| **Booking availability** | 99.99% | 4.3 min downtime | Alert if 10% of budget consumed in 1 hour |
| **Search availability** | 99.9% | 43 min downtime | Alert if 20% of budget consumed in 1 hour |
| **Search latency (p99)** | < 2s | 1% of searches may exceed | Alert if 5% exceeding in 15-min window |
| **Booking latency (p99)** | < 3s | 1% of bookings may exceed | Alert if 3% exceeding in 5-min window |
| **Channel sync latency** | < 5s | 1% of syncs may exceed | Alert if 5% exceeding in 10-min window |
| **Payment success rate** | > 99% | 1% may fail | Alert if failure rate > 3% in 5-min window |

### Error Budget Policy

| Budget Remaining | Action |
|-----------------|--------|
| **> 50%** | Normal operations; deploy at will |
| **25-50%** | Reduce deployment frequency; extra review for booking path changes |
| **10-25%** | Freeze non-critical deployments; focus on reliability improvements |
| **< 10%** | Emergency mode; only critical fixes; conduct reliability review |

---

## Anomaly Detection

| Anomaly | Detection Logic | Severity | Automated Response |
|---------|----------------|----------|--------------------|
| **Conversion cliff** | Booking conversion rate drops > 40% vs 7-day average for 15 min | P1 | Alert on-call; likely indicates search, payment, or availability issue |
| **Hold leak** | Hold expiry rate > 60% for 1 hour | P2 | Check payment flow; may indicate UX issue or bot activity |
| **Channel sync drift** | Reconciliation job finds > 5% availability mismatch on any channel | P2 | Trigger immediate full sync for affected properties |
| **Overbooking threshold breach** | Property exceeds overbooking limit for any date | P1 | Auto-close inventory for that date; alert property manager |
| **Rate anomaly** | Property rate changes > 50% in single update | P3 | Flag for manual review; may be error or price manipulation |
| **Review spam** | > 10 reviews from same IP or device fingerprint in 24 hours | P2 | Queue for manual moderation; temporarily hide flagged reviews |

---

## Operational Runbooks

### Runbook: Availability Shard Degradation

```
TRIGGER: Shard CPU > 85% or write latency p99 > 500ms for 5 min

DIAGNOSTIC STEPS:
1. Check if specific property is generating abnormal write volume
   → If yes: rate-limit that property's updates
2. Check if hot date range (e.g., New Year's Eve) is concentrating writes
   → If yes: expected during peak booking; scale shard vertically
3. Check for bulk inventory adjustments from channel manager
   → If yes: throttle inbound channel updates

RESOLUTION:
- Short term: add read replicas to absorb search availability checks
- Medium term: split hot shard (rebalance properties across shards)
- If caused by hot property: isolate to dedicated shard
```

### Runbook: Payment Gateway Failover

```
TRIGGER: Payment success rate < 97% for 5 min OR payment p99 > 5s

DIAGNOSTIC STEPS:
1. Check primary gateway status page / health endpoint
   → If gateway reports degradation: proceed to failover
2. Check if failure is card-type specific (e.g., only Amex failing)
   → If yes: route affected card type to secondary gateway only
3. Check if failure correlates with region (e.g., only EU payments)
   → If yes: route EU traffic to secondary gateway

FAILOVER STEPS:
1. Open circuit breaker on primary gateway
2. Route all payment traffic to secondary gateway
3. Alert operations team
4. Monitor secondary gateway success rate (must be > 99%)
5. When primary recovers: gradual traffic shift (10% → 50% → 100%)

POST-INCIDENT:
- Verify all pre-authorized payments during degradation
- Check for orphaned pre-auths (authorized but not captured)
- Reconcile payment records with gateway records
```

### Runbook: Channel Sync Drift Detected

```
TRIGGER: Reconciliation job finds > 5% availability mismatch on any channel

DIAGNOSTIC STEPS:
1. Identify which channels have drift
   → Check per-channel sync success rate and latency
2. Check if drift is systematic or property-specific
   → If specific properties: check channel mapping configuration
3. Check event bus consumer lag
   → If lag > 10,000: scale channel sync workers

RESOLUTION:
1. Trigger full sync for affected properties on affected channels
2. If channel API is slow/failing: queue updates, don't block other channels
3. For persistent drift: enable detailed logging for affected channel
4. If drift exceeds 10%: temporarily close affected properties on that channel
   (prevent overbooking) until sync is restored

PREVENTION:
- Reconciliation job runs every 15 minutes
- Alert escalates if drift persists through 2 consecutive reconciliation runs
```

### Runbook: Conversion Rate Cliff

```
TRIGGER: Booking conversion rate drops > 40% vs 7-day average for 15 min

DIAGNOSTIC STEPS:
1. Check booking funnel stage-by-stage:
   Search → View → Selection → Hold → Payment → Confirm
   Identify which stage has the largest drop
2. If drop is at Search → View:
   → Search results empty or irrelevant? Check search index health
   → Prices much higher than competitors? Check rate management
3. If drop is at Hold stage:
   → High SOLD_OUT rate? Check availability service for shard issues
4. If drop is at Payment stage:
   → Payment gateway failure? Check payment success rate
5. If drop is at Confirm stage:
   → Check for slow response times; guests may abandon

RESOLUTION:
- Match the fix to the failing stage
- If unclear: check recent deployments for regression
- Roll back last deployment if timing correlates
```

---

## Health Checks

```
Service health check endpoints:
  GET /health/live   → 200 if process is running
  GET /health/ready  → 200 if service can handle requests

Readiness check includes:
  - Database connection pool has available connections
  - Redis cluster is reachable
  - Event bus producer can connect
  - Payment gateway is reachable (for Payment Service)
  - Search index is queryable (for Search Service)

Health check interval: 5 seconds
Failure threshold: 3 consecutive failures → mark unhealthy
Recovery threshold: 2 consecutive successes → mark healthy
```
