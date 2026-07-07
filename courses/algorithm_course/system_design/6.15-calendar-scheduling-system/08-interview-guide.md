# Interview Guide

## 45-Minute Pacing Guide

| Time | Phase | Focus | Key Points |
|------|-------|-------|------------|
| 0-5 min | **Clarify** | Scope and constraints | Ask about scale (enterprise vs consumer), recurring events, booking feature, timezone requirements |
| 5-10 min | **Data Model** | Core entities | Event (with RRULE), Calendar, Attendee, Reminder; explain timezone storage choice |
| 10-20 min | **High-Level Design** | Architecture | Draw services: Calendar, Event, Free-Busy, Notification, Booking; explain data flow for event creation |
| 20-30 min | **Deep Dive** | 1-2 critical components | Choose: recurring event storage OR free-busy at scale OR booking double-booking prevention |
| 30-40 min | **Scale & Trade-offs** | Bottlenecks, failure modes | Reminder delivery at scale, timezone DB updates, cache invalidation storms |
| 40-45 min | **Wrap Up** | Summary and extensions | Mention CalDAV sync, resource management, or AI scheduling as extensions |

---

## "Start Here" Talking Points

When the interviewer says "Design a Calendar System like Google Calendar," start with:

1. **Frame the problem**: "This is fundamentally a time-management system with three hard problems: recurring event representation, timezone-correct scheduling, and real-time availability aggregation."

2. **Establish scale**: "Google Calendar has 500M+ users. At that scale, the read traffic is dominated by calendar view rendering and free-busy queries—20:1 read-to-write ratio."

3. **Clarify scope**: "Should I include Calendly-style external booking? How deep should I go on CalDAV/iCal interoperability? Is resource/room management in scope?"

4. **Name the unique challenge**: "The most architecturally interesting aspect is that a single recurring event is not N copies—it's a rule that generates instances on demand, and each instance can be independently modified, creating a complex exception tree."

---

## 10 Likely Interview Questions

### 1. How do you store recurring events?

**Best answer**: Store the RRULE (RFC 5545) as a property of the master event, and materialize instances within a rolling window (6 months forward). This gives you O(1) reads for common queries (this week/month) while keeping storage manageable for infinite series. Modifications to individual instances are stored as overrides linked to the master via `original_start` (the occurrence time the instance would have had per the rule).

**Key detail**: "This and following" changes split the series—add UNTIL to the original master and create a new master for the remainder.

### 2. How do you handle timezones for recurring events?

**Best answer**: Store events as "UTC timestamp + IANA timezone." The UTC is for range queries and sorting. The timezone is for recurrence expansion. When expanding "daily at 9 AM America/New_York," each instance must be generated in local time first, then converted to UTC using that date's timezone rules. This correctly handles DST transitions where the UTC offset changes.

**Key trap to avoid**: Don't say "just store everything in UTC." That breaks recurring events across DST boundaries.

### 3. How do you handle free-busy queries at scale?

**Best answer**: Dedicated Free-Busy Service with pre-computed bitmaps (15-minute granularity, 2-week window) cached in distributed cache. Each user's bitmap is ~168 bytes. On event changes, invalidate the affected user's bitmap asynchronously. For multi-user intersection, fetch bitmaps in parallel and perform bitwise OR.

**Numbers to cite**: 2B free-busy queries/day, 84 GB total bitmap storage for 500M users, sub-10ms query time from cache.

### 4. How do you prevent double-booking in a Calendly-style booking system?

**Best answer**: Distributed lock on the host's time slot (keyed by `host_id:slot_start`). Inside the lock: re-verify the slot is still free via fresh free-busy query, create the event, invalidate the free-busy cache, then release the lock. Use idempotency keys (hash of booking_link + slot + guest_email) to handle retries safely.

**Key insight**: Optimistic locking alone isn't enough because the "check availability" and "create event" steps are not atomic in the same database transaction when free-busy is a separate service.

### 5. How do you deliver 1.5 billion reminders per day on time?

**Best answer**: Distributed timer store partitioned by fire_time (minute-level buckets). Workers claim buckets as their time arrives. For a typical hour, there are 62.5M reminders; at peak (9 AM), 190M. Workers process each reminder by verifying the event still exists, then dispatching to the notification channel.

**Key optimization**: For large meetings (50K attendees), use fan-out-on-fire: store one group reminder entry instead of 50K individual entries, and expand at fire time.

### 6. What happens when a country changes its DST rules?

**Best answer**: The IANA timezone database is updated. The system loads the new rules and triggers re-expansion of all recurring events that use the affected timezones. For each instance whose UTC time changed, the system updates the materialized instance, re-schedules its reminders, and optionally notifies attendees of the time shift.

**Proactive insight**: This is why storing the original timezone is critical—without it, you can't re-expand the series correctly.

### 7. How do you shard calendar data?

**Best answer**: User-based sharding (consistent hashing on user_id). All of a user's calendars, events, and free-busy data live on the same shard. This ensures calendar view queries (the most common operation) hit a single shard.

**Cross-shard challenge**: Event invitations cross shard boundaries. The organizer's shard has the master event; attendees' shards have reference records. Invitation delivery and RSVP updates happen asynchronously across shards.

### 8. How do you handle "this occurrence only" vs "all events" modifications?

**Best answer**: Three modification scopes:
- **This occurrence**: Store an instance override with `is_modified = true` and the changed fields. The original occurrence time (`original_start`) links it to its position in the series.
- **All events**: Update the master event's RRULE and properties, then re-expand the materialization window.
- **This and following**: Split the series. Add `UNTIL` to the original master (truncating it at the current instance), create a new master event with the modified properties starting from the current instance.

### 9. How do you handle offline calendar access?

**Best answer**: Mobile clients cache the materialized event list for the current ± 2 weeks. Offline event creates/updates are queued locally with unique client-generated event IDs. When connectivity returns, the sync engine pushes queued changes and pulls remote changes. Conflicts (same event modified both locally and remotely) are resolved by last-writer-wins for simple fields, or by preserving both changes and asking the user to resolve for complex conflicts.

### 10. How does CalDAV sync work at scale?

**Best answer**: Each calendar maintains a change log with monotonically increasing sequence numbers. CalDAV clients provide a sync token (their last seen sequence number). The sync service returns all changes since that token as a delta. This avoids full calendar downloads on every sync. For real-time capable clients, WebSocket push notifies them of changes immediately, reducing polling frequency.

---

## Proactive Trade-offs to Raise

| Trade-off | Option A | Option B | Recommendation |
|-----------|----------|----------|----------------|
| **Recurring event storage** | Store rule only (expand on read) | Materialize all instances | Hybrid: rule + rolling window |
| **Free-busy freshness vs performance** | Real-time computation (always fresh) | Cached bitmaps (5-10s stale) | Cached bitmaps with event-driven invalidation |
| **Reminder precision vs scale** | Per-second precision | Per-minute bucket precision | Per-minute buckets with ±30s jitter |
| **Booking consistency** | Optimistic (check-then-create with retry) | Pessimistic (distributed lock) | Distributed lock with 10s TTL for correctness |
| **Cross-region sync** | Synchronous replication (strong consistency) | Async replication (eventual, lower latency) | Async with <3s lag; strong for local writes |

---

## Trap Questions to Avoid

| Trap Question | What Interviewer Wants | Best Response |
|---------------|------------------------|---------------|
| "Can't you just store all events in UTC?" | Test timezone understanding | "UTC storage works for one-off events, but breaks recurring events across DST. A daily 9 AM meeting would shift by an hour twice a year. We must store the original timezone and re-expand." |
| "Why not just create a copy of the event for each recurrence?" | Test storage/scalability awareness | "An infinite daily event would create unlimited rows. Even bounded series—a weekly meeting for 5 years—creates 260 instances per attendee. At 500M users, this explodes storage. Store the rule, materialize a window." |
| "Just use a cron job for reminders." | Test distributed systems understanding | "Cron is single-machine. At 1.5B reminders/day, we need a distributed timer store with partitioned buckets. Cron also has polling overhead and can't guarantee sub-minute precision for millions of concurrent timers." |
| "What if two people book the same slot simultaneously?" | Test concurrency control | "This is a classic write contention problem. We use a distributed lock keyed on host+slot. The first to acquire the lock proceeds; the second gets a 409 Conflict. Idempotency keys handle safe retries." |
| "How do you handle a meeting with 50,000 attendees?" | Test fan-out awareness | "The event itself is fine—one record. The challenge is notification fan-out: 50K reminders per occurrence, 50K RSVP tracking records. We use fan-out-on-fire for reminders and batch processing for RSVP aggregation." |

---

## Key Numbers to Memorize

| Metric | Value |
|--------|-------|
| Google Calendar DAU | ~150M |
| Events per user per day | ~5 (enterprise avg) |
| Free-busy queries per day | ~2B |
| Reminders per day | ~1.5B |
| Free-busy bitmap per user (2-week window) | 168 bytes |
| Total free-busy index (500M users) | ~84 GB |
| Event record size | ~1.5 KB |
| Peak reminder QPS | ~175K/s |
| Read:Write ratio | 20:1 to 50:1 |
| Materialization window | 6 months forward |

---

## What Makes This System Unique vs Other Calendar Questions

1. **It's not a booking system** (like hotel/ticket): The primary user is the calendar owner, not the booker. Events have attendees with RSVP, not just a reservation.

2. **It's not a notification system** (like push notifications): Reminders are derived from events and must fire at timezone-aware wall-clock times, not just UTC timestamps.

3. **It's not a scheduling optimizer** (like workforce scheduling): The system manages time commitments, not resource allocation. The optimization problem is "find a free slot," not "minimize cost of coverage."

4. **The core challenge is the intersection of time, timezone, and recurrence**—three dimensions that compound in complexity when combined. Getting any one of them wrong produces subtle bugs that users experience as "my meeting disappeared" or "my reminder came an hour late."

---

## Complexity Scorecard

| Component | Complexity | Why |
|-----------|-----------|-----|
| Data model | Medium | RRULE + exceptions add depth, but the entity model is straightforward |
| Timezone handling | **Very High** | DST transitions, IANA DB updates, cross-timezone attendees |
| Free-busy aggregation | High | Multi-calendar, multi-user intersection with caching |
| Reminder scheduling | High | Distributed timer at scale with precision guarantees |
| Booking (Calendly) | Medium-High | Double-booking prevention under concurrent writes |
| CalDAV sync | Medium | Standard protocol, but edge cases in conflict resolution |
| Sharing/permissions | Medium | ACL model is simpler than hierarchical (compared to KMS) |

---

## Deep Dive Selection Guide

Not all deep dives are equally impressive in an interview. Choose based on the interviewer's signals:

### If the interviewer focuses on **data modeling**:

Deep-dive into **recurring event storage** (the hybrid approach). Walk through:
- Why full materialization fails for infinite series
- The master-instance relationship with `original_start` as the link
- The three modification scopes (this / all / this-and-following)
- How "this and following" splits the series (add UNTIL, create new master)
- The materialization window trade-off (6 months: covers 99% of views)

### If the interviewer focuses on **distributed systems**:

Deep-dive into **free-busy at scale**. Walk through:
- The bitmap representation (1,344 bits per user per 2-week window)
- Cache invalidation strategy (event-driven, 5-10s staleness acceptable)
- Multi-user intersection (parallel bitmap fetch → bitwise OR)
- The pre-computation optimization for "hot" users (executives, booking pages)
- Total index size: 84 GB for 500M users—fits entirely in distributed cache

### If the interviewer focuses on **concurrency**:

Deep-dive into **booking double-booking prevention**. Walk through:
- The TOCTOU race condition (check availability, then create event = not atomic)
- Why DB-level constraints alone fail (free-busy service is separate from event DB)
- Distributed lock approach (host_id + slot_start key, 10s TTL)
- Idempotency via hash(booking_link + slot + email)
- Queue-based alternative for extremely popular booking pages

### If the interviewer focuses on **scale/operations**:

Deep-dive into **reminder delivery at scale**. Walk through:
- 1.5B reminders/day, 175K/s at peak
- Timer store partitioned by fire-time (minute-level buckets)
- Worker claiming with TTL-based failure recovery
- Fan-out-on-fire for meetings with >1K attendees
- The Monday morning hotspot problem

---

## Case Study Walkthrough: Google Calendar DST Incident (2011)

**What happened**: In March 2011, Google Calendar displayed recurring events at the wrong time for users in timezones that had recently changed their DST rules. Some events shifted by an hour, and reminders fired at the wrong time.

**Root cause**: The IANA timezone database had been updated to reflect new DST rules for several countries, but Google's recurrence expansion engine had cached old timezone offsets. The re-expansion pipeline did not trigger promptly after the timezone update was deployed.

**Architectural lesson**: Timezone database updates must trigger immediate re-expansion of all recurring events using the affected timezones. The re-expansion pipeline must:
1. Identify all master events with `start_timezone IN (affected_timezones)`
2. Re-expand the materialized window with the new timezone rules
3. Update reminder fire times for instances whose UTC times changed
4. Invalidate free-busy caches for affected users
5. Complete within hours (not days) of the timezone update

**Interview takeaway**: Always mention that timezone handling is not a one-time design decision—it is an ongoing operational concern requiring an automated pipeline for IANA tzdata updates.

---

## Case Study Walkthrough: Calendly Double-Booking Under Load

**Scenario**: A popular sales team with 50 members uses a round-robin booking page. During a product launch, the page receives 500+ concurrent booking attempts. Several guests receive confirmations for the same team member at overlapping times.

**Root cause analysis**: The system checked availability and assigned team members in two separate steps. Between the availability check and the event creation, another booking for the same team member was confirmed, but the free-busy cache had not yet been invalidated.

**Correct architecture**:
1. **Atomic lock per team member + slot**: Not just per host, but per specific team member in the round-robin pool
2. **Re-verify inside lock**: After acquiring the lock, re-check the team member's availability against the database (not cache)
3. **Fallback to next member**: If the selected member is no longer available, try the next eligible member without returning an error
4. **Queue serialization**: For booking pages with >100 concurrent requests, serialize requests per team rather than per member

---

## Extended Questions for Senior Candidates

### 11. How would you add AI-powered scheduling suggestions?

**Strong answer**: The scheduling assistant is a constraint satisfaction problem. Inputs: participant availability bitmaps, timezone-aware working hours, meeting duration, priority weights, and soft constraints (prefer mornings, avoid Fridays). The solver generates candidate slots, scores them by a multi-factor cost function (inconvenience to each participant, calendar fragmentation impact, proximity to other meetings), and returns the top 3-5 suggestions.

**Key detail**: The AI layer sits above the free-busy service—it consumes the same bitmaps but applies optimization logic. It does not need its own data store; it is stateless and uses the free-busy service as its input.

### 12. How do you handle scheduling across organizations?

**Strong answer**: Cross-organization scheduling relies on two protocols: (1) iCalendar over email (iTIP, RFC 6047) for event invitations—the event is encoded as a VEVENT in an .ics attachment, and the recipient's calendar system processes it. (2) Free-busy federation for availability queries—organizations configure a federation agreement that allows free-busy lookups via a REST endpoint. The federation returns only busy/free status, never event details.

**Key challenge**: Different calendar systems (Google, Microsoft, Apple) implement iCalendar with subtle differences, especially for recurrence exceptions. A modified instance of a recurring event created in Google Calendar may not render correctly in Outlook. The sync service must normalize these differences.

### 13. How would you implement meeting cost analytics?

**Strong answer**: A read-only analytics service subscribes to EventCreated and RSVPChanged domain events. For each confirmed event, it computes: `cost = duration_hours × sum(attendee_hourly_rates)`. Hourly rates come from the HR system (organization setting, not per-user—never expose individual salaries). The analytics dashboard shows: total meeting cost per week, cost by meeting type (recurring vs one-off), cost per attendee, and meetings where >50% of attendees are optional. This data drives policies like "no meetings over $5,000 without VP approval" or "flag recurring meetings costing >$50,000/year with declining attendance."

### 14. How do you test timezone handling?

**Strong answer**: Three-layer testing strategy:
1. **Unit tests**: For every IANA timezone with DST transitions, test that a recurring event generates correct UTC times across the transition boundary. Include edge cases: spring-forward (2:30 AM doesn't exist), fall-back (1:30 AM occurs twice), and non-hour offsets (UTC+5:30, UTC+5:45).
2. **Property-based tests**: Generate random RRULEs and random timezones; assert that expanded instances always maintain the wall-clock time in the original timezone.
3. **Time-travel integration tests**: Set the system clock to a date near a DST transition, create a recurring event, and verify that instances before and after the transition have the correct UTC times. Use a mock timezone database with synthetic DST rules for reproducible edge cases.

---

## Common Mistakes in Calendar System Interviews

| Mistake | Why It's Wrong | Correct Approach |
|---------|---------------|-----------------|
| "Store all events in UTC" | Breaks recurring events across DST boundaries | Store UTC + original IANA timezone |
| "Create a row per recurrence" | Infinite series = infinite rows; 260 updates for one series change | Store RRULE, materialize a rolling window |
| "Use a cron job for reminders" | Single machine, polling overhead, no sub-minute precision at scale | Distributed timer store with partitioned fire-time buckets |
| "Check availability then create event" | TOCTOU race condition across separate services | Distributed lock wrapping verify + create |
| "Cache free-busy with long TTL" | Stale availability causes double-bookings | Event-driven invalidation with 5-10s acceptable staleness |
| "Use transactions for cross-shard invites" | 2PC across shards kills availability and latency | Async saga with message queue and compensating actions |
| "Apply timezone offset at display time" | Ignores that UTC offset changes during DST transitions | Apply timezone rules at expansion time, per-instance |
| "One reminder entry per attendee for all events" | 50K-attendee event = 50K timer entries | Fan-out-on-fire for meetings >1K attendees |

---

## System Architecture Cheat Sheet (for whiteboard)

```
                    ┌──────────────┐
                    │ API Gateway  │
                    └──────┬───────┘
              ┌────────────┼────────────┐
              │            │            │
    ┌─────────▼───┐ ┌──────▼──────┐ ┌──▼──────────┐
    │Calendar Svc │ │ Event Svc   │ │Booking Svc  │
    └─────────────┘ └──────┬──────┘ └──────┬──────┘
                           │               │
              ┌────────────┼────────────┐  │
              │            │            │  │
    ┌─────────▼───┐ ┌──────▼──────┐ ┌──▼──▼────────┐
    │Recurrence   │ │Invitation   │ │Free-Busy Svc │
    │Service      │ │Service      │ │(bitmap cache)│
    └─────────────┘ └──────┬──────┘ └──────────────┘
                           │
                    ┌──────▼───────┐
                    │ Message Queue│
                    └──────┬───────┘
              ┌────────────┼────────────┐
    ┌─────────▼───┐ ┌──────▼──────┐ ┌──▼──────────┐
    │Notification │ │Reminder     │ │Search Index  │
    │Workers      │ │Workers      │ │Workers       │
    └─────────────┘ └─────────────┘ └──────────────┘

Key data stores:
  [Primary DB] ──► [Read Replicas] ──► [Calendar View Cache]
  [Timer Store] (partitioned by fire_time)
  [Free-Busy Cache] (168 bytes per user, 84 GB total)
```

---

## Whiteboard Diagram Priority

If you can only draw one diagram, draw the **booking flow with distributed locking**. It demonstrates:
- Concurrency control (distributed lock)
- Read-write separation (free-busy cache vs. event DB)
- Idempotency (hash-based dedup)
- Error handling (lock TTL, 409 Conflict)
- Event-driven post-processing (publish BookingConfirmed)

This single diagram covers more architectural concepts per square inch of whiteboard than any other flow in this system.
