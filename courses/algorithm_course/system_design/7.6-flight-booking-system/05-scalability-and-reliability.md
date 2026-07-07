# Scalability & Reliability

## Scaling Strategy by Service

### Search Aggregation Service

```
Architecture: Stateless, horizontally scalable

Scaling approach:
├── Autoscale based on: requests/sec per instance (target: 200 rps/instance)
├── Peak instances: 11,600 / 200 = 58 instances
├── Average instances: 1,160 / 200 = 6 instances
├── Scale-up trigger: CPU > 60% OR p99 latency > 2.5s
├── Scale-down trigger: CPU < 20% AND p99 latency < 1s for 10 min
└── Warm pool: keep 20% extra instances warm for sudden spikes

Key optimizations:
├── Connection pool: persistent HTTP/2 connections to each GDS (reuse across requests)
├── Thread pool per provider: isolate slow providers from blocking others
├── In-process L1 cache: 500 MB LRU cache, 60s TTL
└── Response streaming: return first results immediately, continue aggregation
```

### Inventory Service

```
Architecture: Sharded by flight_id range

Sharding strategy:
├── Shard key: flight_id (hash-based)
├── Shard count: 16 PostgreSQL shards
├── Each shard: ~163K fare-class inventory records
├── Optimistic locking: version column prevents lost updates
└── Read replicas: 2 per shard for availability checks (search path)

Write path (booking):
├── Primary only, strong consistency
├── SELECT ... FOR UPDATE on fare_inventory row
├── Decrement seats_available atomically
└── If seats_available < requested: return SOLD_OUT

Read path (search):
├── Read replica acceptable (eventual consistency OK for display)
├── Stale by at most 1-2 seconds (replication lag)
└── Authoritative check happens at GDS during hold
```

### Booking Orchestrator

```
Architecture: Saga coordinator, stateful per booking

Scaling approach:
├── Instance count: 20 instances (handles 116 bookings/sec peak)
├── Each instance: 6 bookings/sec capacity
├── State persistence: saga state stored in PostgreSQL (not in-memory)
├── Idempotent operations: all GDS calls carry idempotency key
└── At-least-once delivery: Kafka for saga step events

Saga step table:
┌──────────────────┬────────────────────┬──────────────────────┐
│ Step             │ Service            │ Compensation         │
├──────────────────┼────────────────────┼──────────────────────┤
│ 1. Hold seat     │ GDS API            │ Cancel PNR           │
│ 2. Decrement inv │ Inventory Service  │ Restore inventory    │
│ 3. Create booking│ PNR Service        │ Mark as FAILED       │
│ 4. Charge payment│ Payment Service    │ Refund payment       │
│ 5. Issue ticket  │ GDS API            │ Void ticket + refund │
│ 6. Send confirm  │ Notification Svc   │ (no compensation)    │
└──────────────────┴────────────────────┴──────────────────────┘
```

### Payment Service

```
Architecture: Stateless, idempotent

Scaling approach:
├── Instance count: 10 instances
├── Idempotency: booking_id as idempotency key to payment gateway
├── Retry with exponential backoff: 1s, 2s, 4s (max 3 retries)
└── Dead letter queue: failed payments after retries → manual review

Payment gateway integration:
├── Primary: gateway A
├── Failover: gateway B (automatic switch on 3 consecutive failures)
├── Tokenization: card data never enters booking system
└── 3DS2: Strong Customer Authentication for high-risk transactions
```

---

## Redis Cluster Scaling

```
Cluster topology:
├── 6 masters + 6 replicas (12 nodes total)
├── Total memory: 25 GB for search cache + 2 GB for seat holds
├── Sharding: CRC16 hash slots across masters
├── Replication: 1 replica per master (automatic failover)
└── Persistence: RDB snapshots every 5 min (acceptable data loss for cache)

Key distribution:
├── Search cache keys: ~500K active keys, 50 KB avg → ~25 GB
├── Hold keys: ~35K active at any time (holds in progress), 1 KB avg → ~35 MB
├── Lock keys: ~10K at peak (cache stampede prevention), 100 B avg → ~1 MB
└── Rate limit keys: ~100K (per-user/IP counters), 100 B avg → ~10 MB

Eviction policy: volatile-lfu (evict least-frequently-used keys with TTL set)
```

---

## Database Scaling

```
PostgreSQL architecture:
├── Primary database: bookings, payments, passengers, ancillaries
│   ├── Primary: 1 master (write)
│   ├── Read replicas: 3 (PNR lookups, booking history, analytics)
│   └── Estimated size: ~2 TB after 3 years
│
├── Inventory shards: 16 shards (fare inventory by flight_id)
│   ├── Each shard: ~100 GB
│   └── Total: ~1.6 TB
│
└── Archive database: completed/cancelled bookings > 1 year old
    ├── Partitioned by month
    ├── Compressed storage
    └── Estimated: ~5 TB after 5 years

Connection pooling:
├── Per-instance pool: 20 connections
├── 58 search instances × 20 = 1,160 connections (read replicas)
├── 20 booking instances × 20 = 400 connections (primary)
└── Connection pooler (PgBouncer): transaction-mode pooling
```

---

## Circuit Breaker & Failover

### GDS Circuit Breaker

```
Per-Provider State Machine:

CLOSED (healthy):
  └── Track: failure count in sliding 60s window
  └── Threshold: 5 failures → transition to OPEN

OPEN (unhealthy):
  └── Duration: 30 seconds
  └── All requests to this provider: immediately fail (no GDS call)
  └── Search results: serve from other providers + cache
  └── Bookings: attempt alternate GDS if flight available there

HALF-OPEN (probing):
  └── Allow 1 request every 10 seconds
  └── If success: transition to CLOSED
  └── If failure: transition back to OPEN

Dashboard metrics per provider:
├── Current state: CLOSED / OPEN / HALF-OPEN
├── Failure rate: % of calls failing in last 5 minutes
├── Average latency: p50 / p95 / p99
├── Open circuit count: how many times circuit opened today
└── Requests rejected: count of requests fast-failed while OPEN
```

### Multi-Provider Degradation

```
Level 0: All 5 providers healthy
  └── Full search results, full booking capability

Level 1: 1 provider down
  └── Results from 4 providers + cache fill from remaining
  └── Booking: route to alternate GDS if available
  └── User impact: slightly fewer results, no visible degradation

Level 2: 2 providers down
  └── Results from 3 providers + stale cache
  └── Booking: limited to healthy providers
  └── User impact: possible "fewer results than usual" notice

Level 3: All GDS providers down, NDC still available
  └── Results from NDC + stale GDS cache (clearly marked)
  └── Booking: NDC airlines only
  └── User impact: "limited availability" banner

Level 4: All providers down (catastrophic)
  └── Stale cache only (1-hour extended TTL for emergencies)
  └── Booking: DISABLED (hold page with "check back soon" message)
  └── Alert: critical page to on-call engineering
```

---

## Saga Pattern for Booking

### Saga Orchestrator Design

```
Booking saga sequence:
1. HOLD_SEAT (GDS call)
   ├── Success → proceed to step 2
   └── Failure → return SOLD_OUT to user (no compensation needed)

2. DECREMENT_INVENTORY (local DB)
   ├── Success → proceed to step 3
   └── Failure → compensate step 1 (cancel GDS PNR)

3. CREATE_BOOKING (local DB)
   ├── Success → proceed to step 4 (when user submits payment)
   └── Failure → compensate steps 1-2

4. CHARGE_PAYMENT (payment gateway)
   ├── Success → proceed to step 5
   └── Failure → compensate steps 1-3 (cancel PNR, restore inventory, mark booking failed)

5. ISSUE_TICKET (GDS call)
   ├── Success → proceed to step 6
   └── Failure → retry 3 times; if still failing:
       └── DO NOT refund (payment captured, seat held)
       └── Queue for manual ticketing (operations team)
       └── Notify user: "booking confirmed, ticket being processed"

6. SEND_CONFIRMATION (async)
   ├── Success → saga complete
   └── Failure → retry (non-critical, email/push is best-effort)

Saga state persistence:
├── Stored in: booking_saga_state table
├── Fields: booking_id, current_step, step_results_json, retry_count, status
├── Recovered on crash: query incomplete sagas, resume from last completed step
└── TTL: delete saga state 24 hours after completion
```

### Idempotency Guarantees

Every external call in the saga must be idempotent:

| Operation | Idempotency Key | Behavior on Retry |
|-----------|----------------|-------------------|
| GDS createPNR | booking_id + user_id | GDS returns existing PNR if duplicate |
| GDS cancelPNR | gds_booking_ref | GDS returns success if already cancelled |
| Payment charge | booking_id | Gateway returns existing transaction |
| GDS issueTicket | gds_booking_ref | GDS returns existing ticket numbers |
| Send notification | booking_id + event_type | Dedup in notification service |

---

## Geo-Distributed Search Optimization

```
Search routing by departure region:

Insight: A search for "JFK → LHR" is best served by a search node near the
Amadeus EU endpoint (lower latency to Amadeus, which is headquartered in Madrid).
But a search for "SFO → NRT" is best served near Travelport's APAC endpoint.

Optimization: route GDS fan-out calls from the region closest to the GDS endpoint,
not necessarily closest to the user.

User in NYC → searches JFK → LHR:
├── BFF in US East receives request
├── Amadeus call: route to EU search node (closer to Amadeus API endpoint)
├── Sabre call: route to US search node (Sabre is US-based)
├── Travelport call: route to US search node (Travelport is US-based)
├── BA NDC call: route to EU search node (BA API in London)
└── Results aggregated at US East BFF

Benefit: 100-300ms latency reduction on cross-Atlantic GDS calls
Cost: inter-region network traffic (~$0.02/GB) vs. latency improvement
Decision: only route cross-region for cache-miss GDS calls (20% of searches)
```

---

## Multi-Region Architecture

```
Region A (Primary - US East):
├── All services deployed
├── Primary PostgreSQL for bookings/PNRs
├── Redis cluster for search cache + holds
├── Full GDS connectivity
└── Handles: North America + South America traffic

Region B (Secondary - EU West):
├── All services deployed
├── PostgreSQL read replica (async replication, <1s lag)
├── Independent Redis cluster (local search cache)
├── Full GDS connectivity (EU-based GDS endpoints, lower latency to Amadeus)
└── Handles: Europe + Africa traffic

Region C (Secondary - APAC):
├── All services deployed
├── PostgreSQL read replica
├── Independent Redis cluster
└── Handles: Asia-Pacific traffic

Routing strategy:
├── Search: route to nearest region (latency-based DNS)
├── Booking writes: route to primary region (strong consistency)
│   └── Exception: if primary region fails, promote EU secondary
├── PNR reads: route to nearest region (read replica is fine)
└── Failover: automated DNS failover, 30s detection, 60s switchover

Data sovereignty:
├── EU passengers: PNR data stored in EU region (GDPR)
├── US passengers: PNR data in US region
├── Cross-region: replicate flight schedules and fare data (non-PII)
└── Encryption: PII encrypted at rest with region-specific keys
```

---

## Load Testing Strategy

```
Scenarios:
1. Peak search load: 11,600 rps with 80% cache hit target
   ├── Measure: p50/p95/p99 latency, GDS call count, cache hit rate
   └── Pass criteria: p99 < 3s, cache hit > 75%

2. GDS degradation: simulate 1 provider 100% timeout
   ├── Measure: search latency impact, result quality
   └── Pass criteria: p99 < 5s, > 60% of normal result count

3. Booking surge: 500 bookings/sec (5× peak)
   ├── Measure: booking success rate, payment latency, saga completion
   └── Pass criteria: > 95% success, p99 < 8s

4. Hold expiry storm: 10,000 holds expire in 1 minute
   ├── Measure: cleanup throughput, GDS cancel call rate
   └── Pass criteria: all holds released within 5 minutes

5. Cache stampede: clear cache for top 100 routes simultaneously
   ├── Measure: GDS call spike, lock contention, response time
   └── Pass criteria: GDS calls < 2× normal, no timeouts
```

---

## Edge Caching & CDN Strategy

```
CDN architecture for search responses:

Edge layer (CDN PoPs):
├── Static content: flight images, airline logos, airport info → CDN cached (24h TTL)
├── Search results: NOT cached at CDN (too personalized, too dynamic)
├── Search suggest/autocomplete: CDN cached (1h TTL, 500 popular routes)
├── Fare calendar (cheapest fare per date): CDN cached (15-min TTL)
└── Seat maps (by aircraft type): CDN cached (24h TTL, 200 aircraft types)

Response compression:
├── Search results: Brotli compression (100 KB → ~22 KB, 78% reduction)
├── API responses: gzip for fallback clients
└── Peak bandwidth savings: 1.16 GB/s → ~0.26 GB/s after compression
```

### Search Response Optimization

```
Progressive response strategy:

Phase 1 (immediate, <200ms):
├── Return cached results (if available from L1/L2)
├── Mark response as "partial: true" if some providers still pending
└── Client renders immediately with available results

Phase 2 (streaming, 200ms-3s):
├── As each GDS provider responds, push delta results via SSE/WebSocket
├── Client merges and re-ranks without full page refresh
└── Provider attribution: "Results from 4 of 5 sources"

Phase 3 (complete, at timeout):
├── Final "partial: false" signal
├── Client stops the loading indicator
└── If only 2/5 providers responded: show "limited results" notice

Benefits:
├── Perceived latency: 200ms (first results) vs. 2s+ (wait for all)
├── GDS budget: user often finds a fare in Phase 1, reducing clicks to book
└── Bounce rate: reduced by ~15% vs. traditional "loading spinner for 3s"
```

---

## Capacity Planning: Seasonal Scaling

```
Traffic patterns (flight search industry):

Peak periods (need 3-5× capacity):
├── January: New Year travel planning + holiday deals
├── March-April: Spring break + Easter
├── June-August: Summer travel season
├── November: Thanksgiving (US), Black Friday sales
└── December: Holiday season + last-minute bookings

Traffic shape:
├── Daily: peak at 8-10 PM local time (users search after dinner)
├── Weekly: Sunday evening peak (planning next week's travel)
├── Hourly spikes: airline fare sales, flight cancellation events

Autoscaling thresholds:
├── Scale up: when pending requests/instance > 50 OR CPU > 60%
├── Scale down: when CPU < 20% for 15 min (conservative to avoid thrash)
├── Pre-scale: scheduled scale-up 2 hours before known peaks
├── Emergency: if all instances > 80% CPU, scale to 2× current instantly
└── Minimum: never scale below 20% of peak capacity (warm pool)
```

---

## Graceful Degradation Hierarchy

```
Level 0: Full Capacity
└── All providers healthy, all features available

Level 1: Search Degraded (1 GDS down)
├── Results from 4 providers + cache
├── Hold and booking: fully functional
└── User impact: minimal, slightly fewer results

Level 2: Search Severely Degraded (2+ GDS down)
├── Extended cache TTL (3 min → 10 min)
├── Show "limited results" banner
├── Disable fare prediction (not enough fresh data)
└── Prioritize booking-related GDS calls over search

Level 3: Booking Degraded (payment gateway issues)
├── Search: fully functional
├── Hold: functional (GDS still available)
├── Payment: failover to secondary gateway
├── If both gateways down: hold seats, show "try again shortly"
└── Queued payment: allow user to save booking, pay later within hold TTL

Level 4: Read-Only Mode (database primary down)
├── Search: functional (cache + GDS only)
├── PNR retrieval: from read replicas (may be slightly stale)
├── New bookings: DISABLED
├── Price alerts: paused
└── Target: promote replica to primary within 60 seconds

Level 5: Emergency Mode (catastrophic)
├── Stale cache only (extended 1-hour TTL)
├── All write operations disabled
├── Static "service disrupted" page with airline direct links
└── Incident commander notified automatically
```
