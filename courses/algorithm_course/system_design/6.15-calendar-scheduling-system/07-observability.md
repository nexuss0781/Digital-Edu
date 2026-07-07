# Observability

## Key Metrics

### Service-Level Metrics (RED)

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| **Request rate** | API requests per second by endpoint | >2x baseline for 5 min (anomaly) |
| **Error rate** | 5xx errors / total requests | >0.1% for 5 min |
| **Duration (p50)** | Median response time by endpoint | >200ms for calendar view |
| **Duration (p99)** | Tail latency by endpoint | >1s for calendar view |

### Calendar-Specific Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| **Event creation latency (p99)** | Time from API request to DB commit | >1s for 5 min |
| **Free-busy query latency (p99)** | End-to-end free-busy computation time | >200ms for 5 min |
| **Free-busy cache hit rate** | Cache hits / (hits + misses) | <70% for 10 min |
| **Recurring expansion latency (p99)** | RRULE expansion time per master event | >500ms |
| **Reminder delivery lag** | fire_time - actual_delivery_time | >60s for any reminder |
| **Reminder delivery success rate** | Successfully delivered / total fired | <99% for 5 min |
| **Booking conversion rate** | Confirmed bookings / slot views | Tracked, not alerted |
| **Booking double-booking incidents** | Events where two bookings overlap | >0 (critical alert) |
| **CalDAV sync success rate** | Successful syncs / total sync attempts | <95% for 10 min |
| **CalDAV sync latency** | Event change to sync delivery time | >30s for 10 min |
| **Recurring expansion backlog** | Queued re-materialization jobs | >10K for 5 min |

### Infrastructure Metrics (USE)

| Resource | Utilization | Saturation | Errors |
|----------|------------|------------|--------|
| **Primary DB CPU** | >70% sustained | Connection pool exhaustion | Replication errors |
| **Read replica lag** | N/A | >5s replication lag | Replica disconnection |
| **Cache memory** | >85% capacity | Eviction rate | Connection failures |
| **Timer store** | >70% capacity | Unclaimed bucket count | Write failures |
| **Notification queue** | >80% capacity | Queue depth growing | Dead letter entries |

---

## Logging

### Structured Log Events

| Event | Log Level | Fields | Purpose |
|-------|-----------|--------|---------|
| `event.created` | INFO | event_id, calendar_id, user_id, is_recurring, attendee_count | Track event creation patterns |
| `event.updated` | INFO | event_id, user_id, changed_fields, scope (all/this/following) | Track modification patterns |
| `event.deleted` | INFO | event_id, user_id, scope, was_recurring | Track deletion patterns |
| `rsvp.changed` | INFO | event_id, attendee_id, old_status, new_status | Track RSVP flows |
| `freebusy.query` | DEBUG | user_ids, time_range, cache_hit, latency_ms | Performance analysis |
| `freebusy.cache_miss` | INFO | user_id, reason (expired/invalidated/cold) | Cache effectiveness |
| `reminder.fired` | INFO | reminder_id, event_id, user_id, method, lag_ms | Reminder accuracy |
| `reminder.failed` | WARN | reminder_id, event_id, user_id, method, error | Delivery failures |
| `booking.slot_viewed` | DEBUG | booking_link_id, date, slot_count | Booking funnel analysis |
| `booking.reserved` | INFO | booking_link_id, event_id, guest_email_hash | Booking success tracking |
| `booking.conflict` | WARN | booking_link_id, slot, reason | Double-booking prevention |
| `sync.completed` | INFO | calendar_id, protocol, changes_count, latency_ms | Sync health |
| `sync.failed` | WARN | calendar_id, protocol, error, retry_count | Sync failures |
| `rrule.expanded` | DEBUG | master_event_id, instance_count, expansion_time_ms | Expansion performance |
| `rrule.error` | ERROR | master_event_id, rrule, error | Invalid recurrence rules |
| `acl.changed` | INFO | calendar_id, grantee_id, old_role, new_role, actor_id | Security audit |
| `timezone.update` | INFO | affected_timezones, affected_events_count | Timezone DB updates |

### Log Format

```
{
  "timestamp": "2026-03-10T08:45:12.345Z",
  "level": "INFO",
  "service": "event-service",
  "instance_id": "evt-svc-us-east-03",
  "trace_id": "abc123def456",
  "span_id": "span-789",
  "event_type": "event.created",
  "user_id": "user-alice",
  "calendar_id": "cal-work-alice",
  "event_id": "evt-daily-standup",
  "is_recurring": true,
  "attendee_count": 8,
  "latency_ms": 142,
  "shard_id": "shard-07"
}
```

### Log Retention

| Log Category | Hot Storage | Warm Storage | Cold Storage |
|-------------|-------------|-------------|-------------|
| API access logs | 7 days | 30 days | 1 year |
| Event mutation logs | 30 days | 90 days | 3 years |
| Security/audit logs | 90 days | 1 year | 7 years |
| Performance/debug logs | 3 days | 14 days | 90 days |
| Notification delivery logs | 7 days | 30 days | 1 year |

---

## Distributed Tracing

### Key Trace Spans

| Operation | Parent Span | Child Spans |
|-----------|-------------|-------------|
| `POST /events` (create event) | `api.create_event` | `db.write_event`, `recurrence.expand`, `freebusy.invalidate`, `mq.publish_event_created` |
| `GET /calendars/{id}/events` (calendar view) | `api.list_events` | `cache.check`, `db.query_events`, `recurrence.expand_on_demand`, `acl.check_permissions` |
| `POST /freebusy` (availability query) | `api.freebusy_query` | `cache.bitmap_lookup` (per user), `db.query_events` (cache miss), `bitmap.compute`, `bitmap.intersect` |
| `POST /booking/{slug}/reserve` | `api.reserve_slot` | `lock.acquire`, `freebusy.verify`, `event.create`, `freebusy.invalidate`, `lock.release`, `mq.publish_booking` |
| `reminder.fire` (timer trigger) | `timer.process_bucket` | `db.verify_event`, `notification.dispatch`, `push.send` / `email.send` |

### Trace Propagation

```
Trace flows across:
  Client → API Gateway → Service → Database
                      → Message Queue → Worker → Notification Provider

Trace context (W3C TraceContext format):
  traceparent: 00-{trace_id}-{span_id}-{flags}

Cross-service propagation:
  HTTP headers: traceparent, tracestate
  Message queue: trace_id in message metadata
  Timer store: trace_id stored with reminder entry (for fire-time tracing)
```

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Impact | Runbook |
|-------|-----------|--------|---------|
| **Double-booking detected** | Any resource or host has overlapping confirmed bookings | Trust violation; immediate manual resolution needed | Identify conflicting events; notify affected parties; investigate lock failure |
| **Reminder delivery halt** | 0 reminders fired in last 5 minutes (expected: >10K/min) | Users miss meetings | Check timer worker health; verify timer store connectivity; restart stuck workers |
| **Primary DB unreachable** | All health checks fail for 30s | Full write path failure | Verify network; initiate failover to replica; page DBA |
| **API error rate >1%** | 5xx rate exceeds 1% for 3 minutes | User-visible service degradation | Check error logs; identify failing dependency; circuit break if downstream |
| **Free-busy query latency >500ms (p99)** | For 5+ minutes | Scheduling experience degraded | Check cache hit rate; verify read replica health; scale cache cluster |

### Warning Alerts (Slack/Email)

| Alert | Condition | Impact | Action |
|-------|-----------|--------|--------|
| **Reminder delivery lag >30s** | Average lag exceeds 30s for 10 min | Reminders arrive after events start | Scale timer workers; check queue depth |
| **Free-busy cache hit rate <70%** | For 15+ minutes | Increased DB load; higher latency | Investigate invalidation storm; increase cache TTL; check for cache eviction |
| **Recurring expansion backlog >5K** | Queued jobs exceed 5K for 10 min | New recurring events not fully materialized | Scale expansion workers; check for pathological RRULE |
| **CalDAV sync failures >5%** | For 10+ minutes | External calendar clients out of sync | Check sync service health; verify external calendar provider availability |
| **Read replica lag >3s** | For 5+ minutes | Free-busy queries may return stale data | Monitor replication; consider promoting lagging replica |
| **Notification queue depth >50K** | For 10+ minutes | Invitation/RSVP emails delayed | Scale notification workers; check email provider rate limits |

### Informational Alerts

| Alert | Condition | Purpose |
|-------|-----------|---------|
| **Timezone database update available** | New IANA tzdata release detected | Schedule maintenance window for timezone update |
| **Booking link traffic spike** | Single booking link receives >100 requests/min | May indicate viral sharing or bot activity |
| **Storage growth anomaly** | Daily growth exceeds 2x average | Investigate potential abuse or data import |

---

## Dashboards

### Dashboard 1: Real-Time Operations

```
Panels:
  - API request rate (by endpoint) — line chart
  - API error rate (by endpoint) — line chart with threshold line at 0.1%
  - API latency p50/p95/p99 — multi-line chart
  - Active WebSocket connections — gauge
  - Events created/minute — counter
  - Free-busy queries/second — counter
```

### Dashboard 2: Reminder & Notification Health

```
Panels:
  - Reminders fired/minute vs expected — dual line chart
  - Reminder delivery lag distribution — histogram
  - Notification delivery success/failure by channel (push/email/SMS) — stacked bar
  - Timer bucket depth (current + next 5 hours) — bar chart
  - Dead letter queue depth — gauge with alert coloring
  - Notification provider response times — line chart per provider
```

### Dashboard 3: Booking Analytics

```
Panels:
  - Booking page views/hour — line chart
  - Booking conversion funnel (view → select slot → confirm) — funnel chart
  - Booking conflicts/hour — counter with alert coloring
  - Top booking links by volume — table
  - Slot availability ratio (available slots / total working slots) — gauge
  - Average booking lead time (how far in advance bookings are made) — histogram
```

### Dashboard 4: Calendar Data Health

```
Panels:
  - Free-busy cache hit rate — gauge (green >85%, yellow >70%, red <70%)
  - Read replica replication lag — per-replica line chart
  - Recurring event materialization backlog — gauge
  - CalDAV sync success rate — gauge
  - Storage utilization by shard — bar chart
  - Cross-region replication lag — per-region line chart
```

---

## Health Check Endpoints

| Endpoint | Checks | Frequency |
|----------|--------|-----------|
| `/health/live` | Process is running | 5s (load balancer) |
| `/health/ready` | DB connection + cache connection | 10s (load balancer) |
| `/health/deep` | DB read/write, cache read/write, queue publish, timer store write | 30s (monitoring system) |
| `/health/dependencies` | All downstream services reachable | 60s (monitoring system) |

---

## SLI/SLO Framework

### Service Level Indicators (SLIs)

| SLI | Definition | Measurement |
|-----|-----------|-------------|
| **Availability** | Successful requests / total requests (excluding 4xx) | Edge proxy logs, aggregated per minute |
| **Calendar view latency** | p99 time from request receipt to response send | Server-side histogram, sampled at API gateway |
| **Free-busy freshness** | Time from event change to free-busy cache reflecting the change | Synthetic test: create event, poll free-busy until updated |
| **Reminder accuracy** | Percentage of reminders delivered within 60s of target fire time | timer_fire_time vs notification_delivered_at |
| **Booking integrity** | Zero tolerance: number of double-booked time slots | Continuous audit: query for overlapping confirmed bookings per host |
| **Sync completeness** | Percentage of CalDAV sync requests returning complete delta | Sync service logs: changes_returned / changes_since_token |

### SLO Definitions

| SLO | Target | Error Budget (30-day) | Burn Rate Alert |
|-----|--------|-----------------------|-----------------|
| Availability | 99.99% | 4.32 minutes | >2x burn → page; >5x burn → incident |
| Calendar view p99 | <500ms | 0.01% of requests >500ms | >14.4x burn (1h window) |
| Free-busy freshness | <10s for 99% | 1% stale >10s | >5x burn (6h window) |
| Reminder accuracy | 99.9% within 60s | 0.1% late >60s | >3x burn (12h window) |
| Booking integrity | 100% (zero double-booking) | 0 incidents | Any incident → P1 |
| Sync completeness | 99.5% | 0.5% incomplete | >3x burn (6h window) |

### Error Budget Policy

```
When error budget is exhausted (0% remaining):
  1. Freeze all non-critical feature deployments
  2. Redirect engineering effort to reliability improvements
  3. Conduct incident review for all SLO violations in the period
  4. Resume normal velocity when budget is >25% remaining

When error budget is healthy (>50% remaining):
  1. Normal feature velocity
  2. Permitted to take calculated risks (e.g., database migration)
  3. Can relax change management process (fewer approvals)
```

---

## Capacity-Aware Monitoring

### Predictive Scaling Signals

| Signal | What It Predicts | Lead Time | Action |
|--------|-----------------|-----------|--------|
| **Monday 6-7 AM UTC** | Weekly traffic spike as users check calendars | 1-2 hours | Pre-scale API servers and cache cluster Sunday night |
| **Timezone DST transition** | Spike in recurring event re-expansion | Days | Schedule expansion workers for DST weekend |
| **Large meeting creation** | Reminder fan-out spike at event time minus reminder offset | Hours to days | Pre-allocate timer buckets for the affected minute |
| **Booking link shared on social media** | 10-100x traffic spike to single booking page | Minutes | Auto-scale booking service; rate-limit per booking link |
| **End-of-quarter** | Spike in scheduling activity (reviews, planning meetings) | Days | Increase free-busy cache TTL and warm caches proactively |

### Calendar System Anti-Patterns to Monitor

| Anti-Pattern | Detection | Impact | Response |
|-------------|-----------|--------|----------|
| **Infinite RRULE without bounds** | RRULE with no COUNT or UNTIL, materialization taking >10s | Unbounded expansion | Auto-add 5-year UNTIL; alert admin |
| **Calendar subscription loop** | Calendar A subscribes to B which subscribes to A | Infinite sync loop | Detect cycles in subscription graph; break loop |
| **Reminder avalanche** | Single event with >10K attendees and multiple reminders | Timer store hotspot | Auto-switch to fan-out-on-fire |
| **Stale CalDAV clients** | Client repeatedly sending full-sync requests (no sync-token) | Excessive DB load | Rate-limit full syncs; log client version |
| **ACL over-sharing** | Single calendar shared with >1000 individual users | Permission check overhead | Suggest group-based sharing; warn admin |

---

## Trace Sampling Strategy

### Adaptive Sampling Rules

| Trace Type | Base Sample Rate | Elevated Rate Trigger | Max Rate |
|-----------|-----------------|----------------------|----------|
| Successful API requests | 0.1% (1 in 1000) | Latency >2x p99 baseline | 10% |
| Failed API requests (5xx) | 100% | Always captured | 100% |
| Booking reservations | 100% | Always captured (business-critical) | 100% |
| Free-busy queries | 0.01% (high volume) | Cache miss rate >20% | 1% |
| Reminder delivery | 1% | Delivery lag >30s | 50% |
| CalDAV sync | 5% | Failure rate >5% | 100% |
| Cross-region queries | 10% | Replication lag >5s | 100% |

### Correlation IDs for Cross-System Tracing

```
Trace correlation across calendar system boundaries:

  Calendar trace_id: abc123
    ├─ Event creation span
    ├─ RSVP notification → Push system trace_id: def456
    │   └─ Linked via: correlation_id = "abc123"
    ├─ Reminder scheduling → Timer system trace_id: ghi789
    │   └─ Linked via: event_id + reminder_id
    └─ CalDAV sync → Sync service trace_id: jkl012
        └─ Linked via: calendar_id + sync_token

  When debugging "user missed reminder":
    1. Find reminder_id from user report
    2. Query timer store: was reminder entry created?
    3. If yes: trace fire event → was notification dispatched?
    4. If dispatched: trace to push provider → delivery receipt?
    5. Each step linked by trace_id propagation
```

---

## Dashboard 5: Timezone & Recurrence Health

```
Panels:
  - Active timezones in use (top 20) — bar chart
  - IANA tzdata version deployed vs latest — status indicator
  - Recurring event expansion queue depth — gauge
  - Expansion errors/minute (invalid RRULE, timezone failure) — counter
  - DST transition countdown (next transition per major timezone) — table
  - Events re-expanded after tzdata update — counter with timeline
```

### Dashboard 6: Cross-Region Operations

```
Panels:
  - Cross-region replication lag per region pair — heatmap
  - Cross-region free-busy query latency — line chart per region pair
  - Cross-region event creation (organizer ≠ attendee region) — counter
  - Region failover status — status indicators (green/yellow/red)
  - Active-active write distribution per region — pie chart
  - DNS routing health per region — status with latency overlay
```
