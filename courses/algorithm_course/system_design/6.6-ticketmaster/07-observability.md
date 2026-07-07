# Observability

## 1. Metrics (USE/RED Method)

### Infrastructure Metrics (USE)

| Component | Utilization | Saturation | Errors |
|-----------|------------|------------|--------|
| **Redis Cluster** | Memory usage %, CPU %, connected clients | Command queue depth, eviction rate | Connection refused, OOM errors |
| **PostgreSQL** | Connection pool usage %, disk I/O %, CPU % | Lock wait time, replication lag | Query errors, deadlocks, constraint violations |
| **App Servers** | CPU %, memory %, thread pool usage | Request queue depth, GC pause time | 5xx errors, OOM kills |
| **WebSocket Gateway** | Open connections, memory per connection | Connection backlog, send buffer size | Connection drops, upgrade failures |
| **CDN Edge** | Cache hit ratio, bandwidth usage | Origin request queue | 5xx from origin, TLS errors |

### Application Metrics (RED)

| Service | Rate | Errors | Duration |
|---------|------|--------|----------|
| **Queue Service** | Queue joins/sec, admissions/sec, queue size | Bot blocks/sec, queue full rejections | Join latency, admission latency |
| **Inventory Service** | Hold attempts/sec, hold successes/sec, releases/sec | SETNX failures (contention), hold expired | Hold acquisition p50/p95/p99 |
| **Booking Service** | Checkouts/sec, completions/sec | Payment failures, hold expired during checkout | Checkout duration p50/p95/p99 |
| **Payment Service** | Charges/sec, by gateway | Declined/sec, timeouts/sec, by gateway | Payment processing p50/p95/p99 |
| **Seat Map Service** | Map loads/sec, by event | Stale map errors (user sees unavailable) | Map render latency p50/p95/p99 |
| **Search Service** | Queries/sec, by type | Zero-result queries, timeouts | Search latency p50/p95/p99 |

### Business Metrics (Custom)

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| **Ticket sales velocity** | Tickets sold per minute during on-sale | Trend: sudden drop = system issue |
| **Checkout conversion rate** | Successful checkouts / hold acquisitions | < 60% during on-sale = user friction |
| **Queue wait time (p95)** | Time from queue join to admission | > 45 min = consider opening more capacity |
| **Double-sell incidents** | Same seat sold to multiple users | > 0 = CRITICAL (must never happen) |
| **Hold utilization** | Holds converted to purchases / total holds | < 30% = hold time too long or UX issue |
| **Bot block rate** | Blocked bots / total queue joins | < 95% = bot detection degraded |
| **Revenue per minute** | Revenue during on-sale window | Trend monitoring for anomalies |
| **Abandoned carts** | Users who held seats but didn't checkout | > 50% = checkout UX or payment issues |

---

## 2. Key Dashboards

### On-Sale Command Center Dashboard

This is the primary dashboard operators watch during a mega on-sale:

```
+------------------------------------------------------------------+
|  ON-SALE: Taylor Swift - MetLife Stadium - LIVE                   |
+------------------------------------------------------------------+
|                                                                    |
|  QUEUE STATUS                    INVENTORY                         |
|  +--------------------------+   +--------------------------+       |
|  | In Queue:     1,234,567  |   | Total Seats:    82,000   |       |
|  | In Protected Zone: 2,000 |   | Available:      45,230   |       |
|  | Admitted/min:       300   |   | Held:            3,450   |       |
|  | Est. Wait (p95):   42min |   | Sold:           33,320   |       |
|  | Bots Blocked:   142,857  |   | Sell Rate:    850/min    |       |
|  +--------------------------+   +--------------------------+       |
|                                                                    |
|  CHECKOUT FUNNEL                 SYSTEM HEALTH                     |
|  +--------------------------+   +--------------------------+       |
|  | Hold Rate:     500/sec   |   | Redis CPU:        45%    |       |
|  | Checkout Rate: 200/sec   |   | Redis Memory:     62%    |       |
|  | Payment OK:    185/sec   |   | DB Connections:   78%    |       |
|  | Payment Fail:   15/sec   |   | App CPU (avg):    55%    |       |
|  | Conversion:      37%     |   | Error Rate:     0.3%     |       |
|  +--------------------------+   +--------------------------+       |
|                                                                    |
|  LATENCY (p99)                   PAYMENT GATEWAYS                  |
|  +--------------------------+   +--------------------------+       |
|  | Seat Hold:         12ms  |   | Gateway A:  OK (185 TPS) |       |
|  | Seat Map Load:    350ms  |   | Gateway B:  OK (120 TPS) |       |
|  | Checkout:        3.2sec  |   | Gateway C: WARN (45 TPS) |       |
|  | Queue Update:    150ms   |   | Total:     350 TPS       |       |
|  +--------------------------+   +--------------------------+       |
|                                                                    |
|  [SELL-THROUGH TIMELINE CHART]  [QUEUE DRAIN RATE CHART]           |
|  [LATENCY HISTOGRAM]           [ERROR RATE OVER TIME]              |
+------------------------------------------------------------------+
```

### System Health Dashboard

```
Panels:
1. Service health matrix (green/yellow/red per service)
2. Redis cluster topology + memory per node
3. Database replication lag (seconds)
4. CDN cache hit ratio (should be >90%)
5. WebSocket connection count vs. capacity
6. Circuit breaker states (all gateways)
7. Auto-scaling events timeline
8. Container restarts and OOM kills
```

---

## 3. Logging Strategy

### What to Log

| Event | Log Level | Fields |
|-------|-----------|--------|
| Queue join | INFO | event_id, user_id (hashed), position, risk_score |
| Queue admission | INFO | event_id, user_id (hashed), wait_time_seconds |
| Bot blocked | WARN | event_id, ip (hashed), reason, risk_score, fingerprint_hash |
| Seat hold acquired | INFO | event_id, hold_id, seat_count, latency_ms |
| Seat hold failed (contention) | DEBUG | event_id, seat_ids, reason |
| Seat hold expired | INFO | event_id, hold_id, duration_held |
| Checkout started | INFO | order_id, hold_id, amount |
| Payment attempted | INFO | order_id, gateway, amount, currency |
| Payment succeeded | INFO | order_id, gateway, payment_id, latency_ms |
| Payment failed | WARN | order_id, gateway, error_code, latency_ms |
| Order confirmed | INFO | order_id, event_id, ticket_count, total_amount |
| Double-sell detected | CRITICAL | event_id, seat_id, order_ids (BOTH), timestamp |
| Circuit breaker state change | WARN | service, old_state, new_state, reason |

### Log Levels Strategy

| Level | Usage | Volume During On-Sale |
|-------|-------|-----------------------|
| **CRITICAL** | Double-sells, data corruption, security breaches | 0 (should never happen) |
| **ERROR** | Unhandled exceptions, data inconsistencies | <100/min |
| **WARN** | Payment failures, bot blocks, circuit breaker trips | ~1000/min |
| **INFO** | Business events (holds, orders, queue events) | ~50,000/min |
| **DEBUG** | Contention details, cache misses, retry attempts | Disabled in production during on-sales |

### Structured Log Format

```
{
  "timestamp": "2026-03-08T10:00:05.123Z",
  "level": "INFO",
  "service": "inventory-service",
  "trace_id": "abc123def456",
  "span_id": "span789",
  "event": "seat_hold_acquired",
  "event_id": "evt-uuid",
  "hold_id": "hold-uuid",
  "user_id_hash": "sha256:a1b2c3",
  "seat_count": 4,
  "latency_ms": 8,
  "redis_node": "redis-3",
  "region": "us-east-1"
}
```

### Log Routing

| Log Type | Destination | Retention |
|----------|-------------|-----------|
| Application logs | Centralized log aggregation (ELK-style) | 30 days hot, 90 days warm |
| Security/audit logs | Immutable audit store | 7 years |
| Payment logs | PCI-compliant isolated log store | 7 years |
| Bot detection logs | Security analytics platform | 90 days |
| Performance logs | Time-series DB for dashboards | 30 days |

---

## 4. Distributed Tracing

### Trace Propagation Strategy

All services propagate trace context via W3C Trace Context headers (`traceparent`, `tracestate`). Traces flow through:

```
Client Request → CDN Edge → Queue Connector → API Gateway →
  Service A → Redis → Service B → Payment Gateway → Database
```

### Key Spans to Instrument

| Span Name | Service | What It Captures |
|-----------|---------|------------------|
| `queue.join` | Queue Service | Queue join including bot detection |
| `queue.admit` | Queue Service | Leaky bucket admission cycle |
| `inventory.hold` | Inventory Service | Full SETNX pipeline (includes rollback if partial) |
| `inventory.check_availability` | Inventory Service | Bitmap scan for available seats |
| `booking.checkout` | Booking Service | End-to-end checkout orchestration |
| `payment.charge` | Payment Service | Payment gateway call (external span) |
| `payment.gateway.{name}` | Payment Service | Per-gateway latency breakdown |
| `ticket.generate` | Ticket Service | Barcode generation + delivery |
| `bot.evaluate` | Bot Detection | Risk scoring pipeline |
| `edge.token_validate` | CDN Edge Worker | JWT validation at edge |

### Sampling Strategy

| Traffic Type | Sample Rate | Justification |
|-------------|-------------|---------------|
| Normal browsing | 1% | High volume, low value per trace |
| On-sale booking flow | 100% | Every booking is high-value; need full visibility |
| Payment failures | 100% | Must diagnose every payment issue |
| Bot-blocked requests | 10% | High volume; sample for patterns |
| Errors (5xx) | 100% | Every error needs investigation |
| Slow requests (p99+) | 100% | Tail latency is the enemy |

---

## 5. Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Action |
|-------|-----------|--------|
| **Double-sell detected** | Any seat sold to 2+ users | Immediate page; auto-pause on-sale; incident team |
| **On-sale checkout error rate > 5%** | Rolling 1-min window | Page on-call; investigate; consider pausing queue drain |
| **Redis cluster quorum lost** | Fewer than 2/3 primaries healthy | Page on-call; initiate failover procedure |
| **PostgreSQL replication lag > 30s** | Sustained for 2 minutes | Page on-call; risk of data loss on failover |
| **Payment gateway all-circuits-open** | All configured gateways in OPEN state | Page on-call + payment team; pause checkouts |
| **Zero tickets sold for 5 min** | During active on-sale | Page on-call; likely system failure |

### Warning Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| **Checkout conversion < 30%** | Rolling 5-min window | Notify on-call; investigate UX or payment issues |
| **Queue drain rate < expected** | Drain < 50% of configured rate for 5 min | Notify; check protected zone capacity |
| **Redis memory > 80%** | Any shard | Notify; prepare to scale or evict |
| **Bot block rate spike** | 10x normal rate | Notify security team; possible coordinated attack |
| **Payment gateway latency p99 > 10s** | Single gateway | Notify; consider routing away from slow gateway |
| **WebSocket disconnection rate > 10%** | Rolling 1-min window | Notify; check WebSocket server health |
| **CDN origin hit rate > 20%** | Cache miss ratio too high | Notify; check cache configuration |

### Runbook References

| Alert | Runbook |
|-------|---------|
| Double-sell | `runbooks/INCIDENT-001-double-sell.md` - Pause sale, identify affected orders, issue refunds |
| Redis failover | `runbooks/REDIS-001-failover.md` - Verify Sentinel, promote replica, validate clients |
| Payment cascade | `runbooks/PAYMENT-001-gateway-failure.md` - Switch gateways, pause queue, communicate to users |
| On-sale overload | `runbooks/ONSALE-001-overload.md` - Activate degradation levels, scale infrastructure |
| Bot attack surge | `runbooks/SECURITY-001-bot-surge.md` - Tighten rate limits, enable aggressive CAPTCHA |

---

## 6. Post-On-Sale Analysis

After every on-sale, generate an automated report:

```
ON-SALE REPORT: [Event Name] - [Date]
================================================
Duration:           45 minutes (sale start to sold out)
Total Tickets Sold: 82,000
Peak Queue Size:    1,234,567
Peak QPS:           850,000
Avg Wait Time:      22 minutes (p95: 42 min)

FUNNEL:
  Queue Joins:       1,500,000
  Bots Blocked:        265,000 (17.7%)
  Legitimate Fans:   1,235,000
  Admitted:            410,000
  Held Seats:          205,000
  Checked Out:          95,000
  Payment Success:      82,000 (86.3% conversion)
  Payment Failed:       13,000

PERFORMANCE:
  Seat Hold (p99):     15ms
  Checkout (p99):      4.2s
  Errors (5xx):        0.4%
  Double-Sells:        0

INFRASTRUCTURE:
  Peak Redis Memory:   72%
  Peak DB Connections:  85%
  Peak App CPU:        68%
  Auto-Scale Events:   3
  CDN Cache Hit:       94%

INCIDENTS:
  None / [List any incidents with links to post-mortems]
```

---

## 7. On-Sale Observability Playbook

### Pre-On-Sale Checklist (T-60 min)

```
AUTOMATED CHECKS:
    [ ] Redis cluster health: all shards healthy, memory < 50%
    [ ] DB replication lag < 1s on all replicas
    [ ] CDN cache warmed: seat map SVGs, event page, JS/CSS
    [ ] Bot detection rules updated and active
    [ ] Payment gateways health check: all circuits CLOSED
    [ ] WebSocket gateway: connection test from each edge PoP
    [ ] Pre-scaling complete: target instance counts reached
    [ ] Monitoring dashboards loaded, alerts routed to war room
    [ ] Synthetic transaction: full booking flow succeeds end-to-end
```

### Real-Time Anomaly Detection

| Signal | Normal Range | Anomaly | Auto-Response |
|--------|-------------|---------|---------------|
| **Checkout conversion** | 30-50% | <15% for 2 min | Alert + increase hold TTL by 2 min |
| **Hold acquisition rate** | >95% of attempts | <70% for 1 min | Alert + check Redis cluster |
| **Payment success rate** | >85% | <60% for 1 min | Circuit breaker eval + gateway switch |
| **Bot:human ratio** | 10:1 to 50:1 | >100:1 | Tighten rate limits; enable aggressive CAPTCHA |
| **Sell rate velocity** | Steady decline | Sudden plateau | Check if queue drain stalled; verify admission flow |
| **WebSocket disconnect rate** | <2% | >10% | Scale WS servers; check network health |

### Distributed Tracing: Critical Path Waterfall

```
TRACE: mega-onsale-booking (full critical path)

[Client] ──2ms──► [CDN Edge]
    [Edge Worker: JWT validate] ──0.5ms──►
    [Edge Worker: TLS fingerprint] ──0.3ms──►
[CDN] ──8ms──► [API Gateway]
    [Auth middleware] ──2ms──►
    [Rate limit check] ──1ms──►
[Gateway] ──1ms──► [Inventory Service]
    [Redis: SETNX seat:1] ──0.3ms──►
    [Redis: SETNX seat:2] ──0.3ms──►
    [Redis: SETNX seat:3] ──0.3ms──►
    [Redis: SETNX seat:4] ──0.3ms──►
    [Verify all-or-nothing] ──0.1ms──►
    [Emit SEATS_HELD event] ──1ms──►
[Inventory] ──1ms──► [Response]

Total span: ~18ms (well within 50ms p99 budget)
```

### Custom Metric Aggregation for Post-Mortem

After every on-sale, automatically aggregate and archive these time-series metrics at 1-second granularity:

| Metric Series | Resolution | Retention | Purpose |
|-------------|-----------|-----------|---------|
| `onsale.queue.size` | 1s | 30 days | Queue growth/drain curves |
| `onsale.holds.acquired_per_sec` | 1s | 30 days | Hold velocity and contention peaks |
| `onsale.holds.failed_per_sec` | 1s | 30 days | Contention hotspot detection |
| `onsale.checkout.success_per_sec` | 1s | 30 days | Conversion funnel analysis |
| `onsale.payment.latency_p99` | 1s | 30 days | Payment gateway performance |
| `onsale.bot.blocked_per_sec` | 1s | 90 days | Bot attack pattern analysis |
| `onsale.redis.ops_per_sec` | 1s | 30 days | Infrastructure capacity planning |
| `onsale.inventory.remaining` | 1s | 30 days | Sell-through curve for demand modeling |

These series are critical for: (1) post-mortem analysis of any issues, (2) demand prediction model training for future events, (3) capacity planning for similar-scale events.

---

## 8. Observability Anti-Patterns for Ticketing Systems

| Anti-Pattern | Why It's Dangerous | Better Approach |
|-------------|-------------------|----------------|
| **Logging every SETNX attempt** | At 1M+ ops/sec, logging floods create more load than the actual traffic | Log only: successes, partial failures, and anomalies; aggregate contention as a metric |
| **Sampling on-sale traces** | Missing a single double-sell trace is unacceptable | 100% sampling for on-sale booking flow; sample only browsing traffic |
| **Alerting on absolute thresholds** | Normal error rate for 12K QPS ≠ normal error rate for 2M QPS | Use error rate (%) not error count; baseline adapts to traffic level |
| **Dashboard with 30s refresh** | On-sale goes from 0 to crisis in 10 seconds | 1-second refresh for on-sale command center; streaming metrics |
| **Single SLO for all events** | Tier 4 local comedy show ≠ Tier 1 mega on-sale | Per-tier SLOs with different alerting thresholds and response playbooks |
| **Monitoring origin only** | 90% of traffic is at CDN edge — origin metrics miss the full picture | CDN edge metrics (cache hit, edge errors, edge latency) as primary indicators |

### Key SLIs for On-Sale Health

| SLI | Good Event | Warning | Critical |
|-----|-----------|---------|----------|
| **Seat hold success rate** | >95% | 80-95% | <80% |
| **Checkout conversion** | >30% | 15-30% | <15% |
| **Payment success rate** | >85% | 70-85% | <70% |
| **Queue drain vs. target** | >80% of configured rate | 50-80% | <50% |
| **Double-sell count** | 0 | N/A | >0 (any = critical) |
| **CDN cache hit ratio** | >90% | 80-90% | <80% |
| **WebSocket connection health** | >98% connected | 90-98% | <90% |
