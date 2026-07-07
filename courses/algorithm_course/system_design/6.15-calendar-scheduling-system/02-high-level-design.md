# High-Level Design

## System Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        WEB[Web App]
        MOB[Mobile App]
        CAL[CalDAV Client]
        EXT[External Booker]
    end

    subgraph Gateway["API Gateway Layer"]
        AG[API Gateway]
        WS[WebSocket Gateway]
    end

    subgraph Services["Service Layer"]
        CS[Calendar Service]
        ES[Event Service]
        RS[Recurrence Service]
        FBS[Free-Busy Service]
        NS[Notification Scheduler]
        BS[Booking Service]
        SS[Sync Service]
        RES[Resource Service]
        IS[Invitation Service]
    end

    subgraph Async["Async Processing"]
        MQ[Message Queue]
        NW[Notification Workers]
        IW[Indexing Workers]
        RW[Reminder Workers]
    end

    subgraph Data["Data Layer"]
        PDB[(Primary DB<br/>Events & Calendars)]
        RDB[(Read Replicas)]
        FBC[(Free-Busy Cache)]
        EC[(Event Cache)]
        TSS[(Timer Store<br/>Reminders)]
        SI[(Search Index)]
    end

    WEB & MOB --> AG
    CAL --> SS
    EXT --> BS

    AG --> CS & ES & FBS & BS & RES & IS
    WS --> NS

    CS --> PDB & EC
    ES --> PDB & EC & RS
    RS --> PDB
    FBS --> FBC & RDB
    BS --> ES & FBS
    SS --> ES & CS
    RES --> PDB
    IS --> MQ

    MQ --> NW & IW & RW
    NW --> WS
    IW --> SI
    RW --> TSS

    PDB --> RDB
    ES --> MQ

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class WEB,MOB,CAL,EXT client
    class AG,WS gateway
    class CS,ES,RS,FBS,NS,BS,SS,RES,IS service
    class MQ,NW,IW,RW queue
    class PDB,RDB,TSS,SI data
    class FBC,EC cache
```

---

## Core Service Responsibilities

| Service | Responsibility | Key Data |
|---------|---------------|----------|
| **Calendar Service** | Calendar CRUD, sharing, permissions | Calendar metadata, ACLs |
| **Event Service** | Event CRUD, attendee management | Events, attendees, recurrence rules |
| **Recurrence Service** | RRULE expansion, instance generation, exception handling | Recurrence rules, EXDATE/RDATE |
| **Free-Busy Service** | Availability aggregation across calendars | Pre-computed free-busy bitmaps |
| **Notification Scheduler** | Reminder scheduling, delivery orchestration | Timer queue entries |
| **Booking Service** | External booking pages, slot computation, reservation | Booking links, availability rules |
| **Sync Service** | CalDAV/iCal/Exchange sync | Sync tokens, change logs |
| **Resource Service** | Room/equipment management, conflict detection | Resource metadata, capacity |
| **Invitation Service** | Invite dispatch, RSVP tracking, email notifications | Invitation state machine |

---

## Data Flow Walkthrough

### Flow 1: Creating a Recurring Event

```mermaid
sequenceDiagram
    participant U as User
    participant AG as API Gateway
    participant ES as Event Service
    participant RS as Recurrence Service
    participant FBS as Free-Busy Service
    participant MQ as Message Queue
    participant NS as Notification Scheduler
    participant IS as Invitation Service

    U->>AG: POST /events {title, rrule, attendees, reminders}
    AG->>ES: Create event
    ES->>ES: Validate RRULE syntax (RFC 5545)
    ES->>RS: Expand instances (next 6 months)
    RS-->>ES: Instance list with UTC times
    ES->>ES: Store master event + materialized instances
    ES->>FBS: Update free-busy bitmap for organizer
    FBS-->>ES: Bitmap updated
    ES->>MQ: Publish EventCreated
    MQ->>IS: Fan out invitations to attendees
    IS->>IS: Send invite emails/push notifications
    MQ->>NS: Schedule reminders for materialized instances
    NS->>NS: Insert timer entries for each instance * each reminder
    ES-->>AG: 201 Created {event_id, instances}
    AG-->>U: Event created successfully
```

### Flow 2: Calendly-Style Booking

```mermaid
sequenceDiagram
    participant G as Guest (Booker)
    participant BS as Booking Service
    participant FBS as Free-Busy Service
    participant ES as Event Service
    participant MQ as Message Queue

    G->>BS: GET /booking/{link_id}/slots?date_range=...
    BS->>BS: Load host's availability rules (working hours, buffer, limits)
    BS->>FBS: Query host's free-busy for date range
    FBS-->>BS: Busy intervals
    BS->>BS: Compute available slots = rules ∩ ¬busy
    BS-->>G: Available slots [{start, end}, ...]

    G->>BS: POST /booking/{link_id}/reserve {slot, guest_info}
    BS->>BS: Acquire distributed lock on slot
    BS->>FBS: Re-verify slot is still free
    alt Slot still available
        FBS-->>BS: Confirmed free
        BS->>ES: Create event (host + guest as attendees)
        ES-->>BS: Event created
        BS->>FBS: Update host's free-busy bitmap
        BS->>MQ: Publish BookingConfirmed
        BS-->>G: 201 Booking confirmed
    else Slot taken (race condition)
        FBS-->>BS: Slot now busy
        BS-->>G: 409 Conflict - slot no longer available
    end
```

### Flow 3: Free-Busy Query (Multi-User)

```mermaid
sequenceDiagram
    participant U as Scheduler
    participant FBS as Free-Busy Service
    participant EC as Event Cache
    participant RDB as Read Replica

    U->>FBS: GET /freebusy?users=alice,bob,carol&range=...

    par Parallel per user
        FBS->>EC: Check free-busy cache for Alice
        EC-->>FBS: Cache HIT (bitmap)
    and
        FBS->>EC: Check free-busy cache for Bob
        EC-->>FBS: Cache MISS
        FBS->>RDB: Query Bob's events in range
        RDB-->>FBS: Event list
        FBS->>FBS: Expand recurring events, build bitmap
        FBS->>EC: Cache Bob's bitmap (TTL: 5min)
    and
        FBS->>EC: Check free-busy cache for Carol
        EC-->>FBS: Cache HIT (bitmap)
    end

    FBS->>FBS: Intersect bitmaps → common free slots
    FBS-->>U: Free slots [{start, end}, ...]
```

---

## Key Architectural Decisions

### 1. Event Storage: Hybrid Rule + Materialized Instances

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Store RRULE only, expand on read** | Minimal storage, instant series updates | Expensive reads, no direct instance querying | Rejected for reads at scale |
| **Materialize all instances** | Fast reads, simple queries | Infinite series require bounds, expensive updates | Rejected for infinite series |
| **Hybrid: RRULE + rolling window** | Fast reads in common window, manageable storage | Window maintenance complexity | **Chosen** |

**Rationale**: Most calendar views show 1 day to 1 month. Materializing instances within a 6-month rolling window serves 99% of reads from pre-computed data. Queries beyond 6 months trigger on-demand expansion. Series modifications update the RRULE and trigger re-expansion of the materialized window.

### 2. Timezone Strategy: UTC + Original Timezone

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Store UTC only** | Simple storage, easy comparison | Loses "9 AM" intent; DST changes break recurring events | Rejected |
| **Store local time only** | Preserves intent | Cannot compare across timezones; ambiguous during DST transitions | Rejected |
| **UTC + original timezone** | Preserves intent AND enables comparison | Requires timezone-aware expansion | **Chosen** |

**Rationale**: An event created as "9 AM America/New_York" must always appear at 9 AM Eastern, whether that is UTC-5 (EST) or UTC-4 (EDT). Storing both the UTC timestamp (for range queries and sorting) and the original timezone (for recurrence expansion) is the only correct approach.

### 3. Free-Busy Architecture: Separate Service with Pre-Computed Bitmaps

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Compute from events on demand** | Always fresh, no sync issues | O(n) per query, slow at scale | Rejected for high QPS |
| **Materialized view in event DB** | Transactionally consistent | Adds write amplification, DB load | Rejected for read-heavy pattern |
| **Separate service with cached bitmaps** | Sub-10ms queries, independent scaling | Cache invalidation complexity | **Chosen** |

**Rationale**: Free-busy queries dominate traffic (2B/day) and must be fast (<100ms). A dedicated service with pre-computed bitmaps in distributed cache handles this load. Event writes publish change events that invalidate the relevant user's bitmap asynchronously (5-10 second lag is acceptable).

### 4. Reminder Delivery: Distributed Timer Queue

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Cron job scanning DB** | Simple implementation | Polling is wasteful; hard to scale; precision limited to poll interval | Rejected |
| **Delay queue (per-message TTL)** | Precise timing, no polling | Max TTL limits (24h in most queues); must re-enqueue for far-future reminders | Partial solution |
| **Distributed timer store (partitioned by fire_time)** | Precise, scalable, supports far-future timers | Operational complexity; must handle clock skew | **Chosen** |

**Rationale**: With 1.5B reminders/day firing at precise wall-clock times, a distributed timer store partitioned by fire_time (minute-level buckets) provides both precision and scalability. Workers claim buckets as their fire time arrives, process all timers in the bucket, and dispatch notifications.

### 5. Sync Protocol: CalDAV + Webhooks

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **CalDAV only (polling)** | Standard protocol, wide client support | Polling is wasteful; sync latency = poll interval | Partial |
| **Webhooks only (push)** | Real-time updates | Not all clients support webhooks; delivery reliability | Partial |
| **CalDAV + Webhooks hybrid** | Standards compliance + real-time for capable clients | Dual implementation cost | **Chosen** |

**Rationale**: CalDAV provides interoperability with Apple Calendar, Thunderbird, and other standards-compliant clients. Webhooks (or WebSocket subscriptions) provide real-time sync for web and mobile clients. The sync service maintains a change log per calendar and issues sync tokens for efficient delta sync.

---

## Data Flow Walkthrough (continued)

### Flow 4: Reminder Firing Pipeline

```mermaid
sequenceDiagram
    participant TW as Timer Worker
    participant TS as Timer Store
    participant ES as Event Service
    participant NW as Notification Worker
    participant PP as Push Provider
    participant EP as Email Provider

    TW->>TS: Claim bucket for current minute
    TS-->>TW: Bucket with 5,000 pending reminders

    loop For each reminder in bucket
        TW->>ES: Verify event still exists and is not cancelled
        ES-->>TW: Event active, attendees confirmed

        alt Standard event (≤1K attendees)
            TW->>NW: Dispatch notification (user_id, event_details, method)
            NW->>PP: Send push notification
            NW->>EP: Send email reminder
        else Large event (>1K attendees) — Fan-out-on-fire
            TW->>ES: Query attendee list (batch of 100)
            ES-->>TW: Attendee batch
            TW->>NW: Batch dispatch notifications
        end
    end

    TW->>TS: Mark bucket as processed
```

### Flow 5: CalDAV Sync (Delta Sync)

```mermaid
sequenceDiagram
    participant CC as CalDAV Client
    participant SS as Sync Service
    participant CL as Change Log
    participant ES as Event Service

    CC->>SS: REPORT /caldav/calendars/{cal_id}/ (sync-token: "seq-4521")
    SS->>CL: Query changes since sequence 4521
    CL-->>SS: 3 changes: [evt-A updated, evt-B created, evt-C deleted]
    SS->>ES: Fetch current state of evt-A, evt-B
    ES-->>SS: Event details

    SS->>SS: Convert events to iCalendar (RFC 5545) format
    SS-->>CC: Multi-status response with 3 changes + new sync-token "seq-4524"

    CC->>CC: Apply changes to local calendar store
```

---

## Availability Computation Architecture

### Free-Busy Bitmap Data Flow

```mermaid
flowchart TB
    subgraph EventPath["Event Write Path"]
        EW[Event Created/Updated/Deleted]
        MQ[Message Queue]
        FBW[Free-Busy Worker]
    end

    subgraph CachePath["Cache Layer"]
        FBC[(Free-Busy Cache<br/>Per-user bitmaps)]
        VBC[(View Cache<br/>Calendar renders)]
    end

    subgraph QueryPath["Query Path"]
        FBQ[Free-Busy Query]
        RDB[(Read Replica)]
        AGG[Bitmap Aggregator]
    end

    EW -->|Publish EventChanged| MQ
    MQ -->|Consume| FBW
    FBW -->|Invalidate user bitmap| FBC
    FBW -->|Invalidate calendar view| VBC

    FBQ -->|Check cache| FBC
    FBC -->|Cache HIT| AGG
    FBC -->|Cache MISS| RDB
    RDB -->|Compute bitmap| FBW
    FBW -->|Cache bitmap| FBC
    AGG -->|Bitwise OR for multi-user| AGG
    AGG -->|Return free slots| FBQ

    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class EW,FBQ,FBW,AGG service
    class MQ queue
    class FBC,VBC cache
    class RDB data
```

### Bitmap Representation

```
User Alice's 2-week free-busy bitmap:
  14 days × 96 slots/day = 1,344 bits = 168 bytes

  Day 1 (Monday):
  00:00 ████████ 02:00 ████████ 04:00 ████████ 06:00 ████████
  08:00 ░░░░░░░░ 10:00 ░░██░░██ 12:00 ████░░░░ 14:00 ░░░░██░░
  16:00 ░░░░░░░░ 18:00 ████████ 20:00 ████████ 22:00 ████████

  █ = free (0), ░ = busy (1)

  Slot resolution: 15 minutes
  Operations: O(1) per slot check, O(n/64) for range scan (SIMD-friendly)
  Multi-user intersection: bitwise OR → O(n/64) for n slots
```

---

## Cross-Region Event Routing

```mermaid
flowchart LR
    subgraph USEast["US-East Region"]
        AG1[API Gateway]
        ES1[Event Service]
        DB1[(Primary DB<br/>US Users)]
    end

    subgraph EUWest["EU-West Region"]
        AG2[API Gateway]
        ES2[Event Service]
        DB2[(Primary DB<br/>EU Users)]
    end

    subgraph APSouth["AP-Southeast Region"]
        AG3[API Gateway]
        ES3[Event Service]
        DB3[(Primary DB<br/>APAC Users)]
    end

    US_USER([US User Alice]) --> AG1
    EU_USER([EU User Bob]) --> AG2

    AG1 --> ES1
    ES1 -->|Write master event| DB1
    ES1 -->|Async: replicate attendee ref| DB2

    AG2 --> ES2
    ES2 -->|Read Bob's events| DB2
    ES2 -->|Read Alice's free-busy| DB1

    DB1 <-->|Async replication<br/>1-3s lag| DB2
    DB2 <-->|Async replication<br/>1-3s lag| DB3
    DB1 <-->|Async replication<br/>1-3s lag| DB3

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class US_USER,EU_USER client
    class AG1,AG2,AG3 gateway
    class ES1,ES2,ES3 service
    class DB1,DB2,DB3 data
```

**Routing rules**: The organizer's home region is the source of truth for the event. Attendees in other regions receive replicated references. Free-busy queries for cross-region users are served from local read replicas with <3s staleness.

---

## Domain Event Model

### Event-Driven Architecture

All calendar mutations publish domain events that drive downstream processing:

```
DOMAIN EVENTS:

EventCreated:
  event_id, calendar_id, organizer_id, start_time, end_time,
  timezone, is_recurring, rrule, attendee_ids[], reminder_config[]

EventUpdated:
  event_id, changed_fields[], scope (all|this|following),
  old_values{}, new_values{}, sequence_number

EventDeleted:
  event_id, scope (all|this|following), deleted_by

RSVPChanged:
  event_id, attendee_id, old_status, new_status, timestamp

CalendarShared:
  calendar_id, grantee_id, grantee_type, role

BookingConfirmed:
  booking_link_id, event_id, host_id, guest_email, slot_start

BookingCancelled:
  booking_id, event_id, cancelled_by (host|guest), reason

ReminderFired:
  reminder_id, event_id, user_id, method, fire_time, actual_time
```

### Event Consumer Matrix

| Domain Event | Free-Busy Service | Notification Service | Search Index | Sync Service | Analytics |
|-------------|-------------------|---------------------|-------------|-------------|-----------|
| EventCreated | Invalidate bitmap | Schedule reminders | Index event | Update sync token | Track creation |
| EventUpdated | Invalidate bitmap | Reschedule reminders | Re-index event | Update sync token | Track modification |
| EventDeleted | Invalidate bitmap | Cancel reminders | Remove from index | Update sync token | Track deletion |
| RSVPChanged | Invalidate bitmap | Notify organizer | Update attendee list | Update sync token | Track engagement |
| BookingConfirmed | Invalidate bitmap | Send confirmations | Index booking | Update sync token | Track conversion |

---

## Architecture Pattern Checklist

- [x] **Sync vs Async**: Event creation is synchronous; notification fan-out, search indexing, and free-busy cache updates are asynchronous
- [x] **Event-driven**: Event mutations publish domain events (EventCreated, EventUpdated, RSVPChanged) to message queue
- [x] **Push vs Pull**: Push for real-time clients (WebSocket); pull for CalDAV clients (sync tokens)
- [x] **Stateless services**: All services are stateless; state lives in databases and caches
- [x] **Read-heavy optimization**: Free-busy bitmaps, event caches, read replicas for calendar views
- [x] **Real-time + Batch**: Real-time for event operations; batch for reminder scheduling beyond the rolling window
- [x] **Edge caching**: Calendar view responses cached at CDN edge for public/shared calendars
- [x] **CQRS**: Write path (primary DB, strong consistency) separated from read path (replicas, caches, eventual consistency)
- [x] **Saga orchestration**: Multi-step booking flow with compensating actions (release lock, cancel partial event)
- [x] **Domain event sourcing**: All state changes captured as immutable events for audit, replay, and downstream processing
