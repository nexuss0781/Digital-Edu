# High-Level Design

## Architecture Overview

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph Clients["Client Layer"]
        MA[Mobile App]
        WP[Web Portal]
        AP[Admin Portal]
    end

    subgraph IoT["IoT / Edge Layer"]
        GC[Gate Controller]
        ANPR[ANPR Camera]
        SS[Spot Sensors]
        DB_SIGN[Display Boards]
        KI[Kiosk / Ticket Machine]
    end

    subgraph Gateway["API Gateway Layer"]
        AG[API Gateway]
        IH[IoT Hub]
    end

    subgraph Core["Core Services"]
        LMS[Lot Management Service]
        SLS[Slot Service]
        BKS[Booking Service]
        VHS[Vehicle Service]
        GTS[Gate Service]
        PMS[Payment Service]
        PRS[Pricing Service]
        PTS[Permit Service]
        NTS[Notification Service]
    end

    subgraph Async["Event / Messaging"]
        MQ[Message Queue]
        EP[Event Processor]
    end

    subgraph Data["Data Layer"]
        PG[(PostgreSQL<br/>Lots, Spots, Bookings,<br/>Permits, Payments)]
        RD[(Redis<br/>Real-time Availability,<br/>Gate State, Session Cache)]
        BS[(Blob Storage<br/>ANPR Images)]
        TS[(Time-Series DB<br/>Sensor Telemetry)]
    end

    MA --> AG
    WP --> AG
    AP --> AG

    GC --> IH
    ANPR --> IH
    SS --> IH
    KI --> GC

    AG --> LMS
    AG --> BKS
    AG --> PMS
    AG --> PRS
    AG --> PTS
    AG --> VHS

    IH --> GTS
    IH --> MQ

    GTS --> SLS
    GTS --> BKS
    GTS --> VHS
    GTS --> PMS

    BKS --> SLS
    BKS --> PRS
    BKS --> NTS
    PMS --> NTS

    MQ --> EP
    EP --> SLS
    EP --> TS

    SLS --> PG
    SLS --> RD
    BKS --> PG
    PMS --> PG
    LMS --> PG
    PTS --> PG
    VHS --> PG
    VHS --> BS
    EP --> TS

    SLS -.-> DB_SIGN

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef iot fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef async fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class MA,WP,AP client
    class GC,ANPR,SS,DB_SIGN,KI iot
    class AG,IH gateway
    class LMS,SLS,BKS,VHS,GTS,PMS,PRS,PTS,NTS service
    class MQ,EP async
    class PG,RD,BS,TS data
```

---

## Service Responsibilities

| Service | Responsibility | Data Owned |
|---------|---------------|------------|
| **Lot Management Service** | CRUD for lots, floors, zones; operating hours; lot configuration | `parking_lots`, `floors`, `zones` |
| **Slot Service** | Spot lifecycle management; real-time availability tracking; sensor event processing | `parking_spots`, Redis availability bitmaps |
| **Booking Service** | Reservation creation, modification, cancellation; time-window validation; QR code generation | `bookings` |
| **Vehicle Service** | Vehicle registration; ANPR image storage and plate lookup; vehicle-user association | `vehicles`, ANPR images in blob storage |
| **Gate Service** | Gate open/close commands; entry/exit event processing; offline mode orchestration | `gate_events`, gate controller state |
| **Payment Service** | Fee calculation; payment processing; refunds; receipt generation | `payments`, `invoices` |
| **Pricing Service** | Rate management; peak/off-peak rules; event-based surge; daily cap calculation | `pricing_rules` |
| **Permit Service** | Monthly/annual permit CRUD; permit validation; auto-renewal | `permits` |
| **Notification Service** | Push notifications; SMS alerts; email confirmations | Notification logs |

---

## Data Flow Narratives

### Flow 1: Pre-Booked Entry (QR Code)

```
1. Driver arrives at entry gate with active reservation
2. Driver scans QR code at gate kiosk
3. Gate Controller sends QR data to Gate Service via IoT Hub
4. Gate Service calls Booking Service to validate:
   - Booking exists and status = CONFIRMED
   - Current time is within entry window (start_time ± grace period)
   - Booking lot matches this gate's lot
5. Booking Service updates booking status: CONFIRMED → ACTIVE
6. Slot Service marks the reserved spot: RESERVED → OCCUPIED
7. Gate Service sends OPEN command to Gate Controller
8. Gate Controller opens barrier, logs entry event
9. Display boards update to show spot location guidance
10. Notification Service sends "You're parked at Spot B2-47" push notification
```

### Flow 2: Walk-In Entry (Ticket)

```
1. Driver arrives at entry gate without reservation
2. Kiosk dispenses a ticket (physical or digital) with:
   - Unique ticket ID, entry timestamp, lot ID, barcode/QR
3. Gate Controller sends entry event to Gate Service
4. Gate Service opens the gate (walk-ins always enter if lot has capacity)
5. Slot Service decrements available count in Redis
6. No specific spot is assigned at entry (driver finds any available spot)
7. Spot sensors detect vehicle presence → Slot Service updates specific spot status
8. Gate event logged with ticket ID and timestamp
```

### Flow 3: Permit Holder Entry (ANPR)

```
1. Driver approaches entry gate
2. ANPR camera captures license plate image
3. Gate Controller sends plate image to Vehicle Service via IoT Hub
4. Vehicle Service runs ANPR recognition → extracts plate number
5. Vehicle Service normalizes plate and queries Permit Service
6. Permit Service validates:
   - Active permit exists for this plate + this lot
   - Permit is within valid date range
   - Vehicle hasn't already entered (not currently parked)
7. Gate Service sends OPEN command
8. Entry logged with permit ID, plate number, timestamp
9. If ANPR fails to read plate: fall back to ticket dispensing
```

### Flow 4: Exit with Payment

```
1. Driver inserts ticket or scans QR at exit kiosk
2. Gate Controller sends ticket/booking ID to Gate Service
3. Gate Service calls Pricing Service to calculate fee:
   - Retrieve entry timestamp from ticket/booking
   - Apply pricing rules (hourly rate × duration, capped at daily max)
   - Apply peak/off-peak adjustments
4. Kiosk displays fee to driver
5. Driver pays via card/mobile wallet at kiosk
6. Payment Service processes payment → returns confirmation
7. Gate Service sends OPEN command to Gate Controller
8. Slot Service marks spot: OCCUPIED → AVAILABLE
9. Redis availability count incremented
10. Receipt sent via email/SMS if registered user
```

### Flow 5: Real-Time Availability Update

```
1. Spot sensor detects vehicle departure (ultrasonic/IR)
2. Sensor sends state change event to IoT Hub
3. IoT Hub publishes event to Message Queue
4. Event Processor consumes event, applies debounce filter:
   - Require 2 consecutive readings 3 seconds apart to confirm state change
   - Filters out false positives (pedestrians, shopping carts)
5. Slot Service updates spot status in PostgreSQL
6. Slot Service updates availability bitmap in Redis
7. Slot Service pushes update via WebSocket to display boards
8. Display boards refresh floor-by-floor availability counts
9. Mobile app availability view updated (if user is actively viewing)
```

---

## Sequence Diagram: Pre-Booked Entry Flow

```mermaid
%%{init: {'theme': 'neutral'}}%%
sequenceDiagram
    participant D as Driver
    participant K as Kiosk
    participant GC as Gate Controller
    participant IH as IoT Hub
    participant GS as Gate Service
    participant BS as Booking Service
    participant SS as Slot Service
    participant NS as Notification Service
    participant DB as Display Board

    D->>K: Scan QR code
    K->>GC: QR payload
    GC->>IH: Entry request (qr_code, gate_id)
    IH->>GS: Validate entry
    GS->>BS: Validate booking (qr_code)

    alt Booking valid & within time window
        BS->>BS: Update status CONFIRMED → ACTIVE
        BS-->>GS: Booking valid (spot_id, floor, zone)
        GS->>SS: Mark spot RESERVED → OCCUPIED
        SS-->>GS: Spot updated
        GS->>IH: OPEN gate command
        IH->>GC: OPEN
        GC->>GC: Open barrier
        GC-->>D: Gate opens
        GS->>NS: Send entry confirmation
        NS-->>D: Push: "Parked at B2-47"
        SS->>DB: Update availability
    else Booking invalid or expired
        BS-->>GS: Booking invalid (reason)
        GS->>IH: DENY entry
        IH->>GC: DENY
        GC-->>D: Display error + dispense walk-in ticket
    end
```

---

## Spot Lifecycle State Diagram

```mermaid
%%{init: {'theme': 'neutral'}}%%
stateDiagram-v2
    [*] --> AVAILABLE: Lot initialized

    AVAILABLE --> RESERVED: Booking confirmed
    AVAILABLE --> OCCUPIED: Walk-in parks (sensor detects)
    AVAILABLE --> OUT_OF_SERVICE: Maintenance needed

    RESERVED --> OCCUPIED: Driver arrives (booking redeemed)
    RESERVED --> AVAILABLE: No-show (grace period expired)
    RESERVED --> AVAILABLE: Booking cancelled

    OCCUPIED --> AVAILABLE: Vehicle exits (sensor + gate event)

    OUT_OF_SERVICE --> AVAILABLE: Maintenance complete

    note right of RESERVED
        Time-limited state.
        Auto-releases after
        grace period (30 min)
        if not redeemed.
    end note

    note right of OCCUPIED
        Confirmed by both
        sensor detection AND
        gate entry event.
    end note

    note left of OUT_OF_SERVICE
        Manual override by
        lot operator. Spot
        excluded from allocation.
    end note
```

---

## Key Architectural Decisions

### Decision 1: Edge Processing at Gate vs Cloud-Only

| Aspect | Edge Processing (Chosen) | Cloud-Only |
|--------|------------------------|------------|
| **Offline resilience** | Gate operates independently during network outage | Gate blocked if cloud unreachable |
| **Latency** | Sub-second response from local controller | 500ms-2s round-trip to cloud |
| **Complexity** | Higher---requires local cache, sync logic, conflict resolution | Lower---single source of truth |
| **Cost** | More capable edge hardware required | Cheaper gate controllers |
| **Data freshness** | Cached data may be stale (permits synced every 30s) | Always current |

**Decision**: Edge processing with cloud sync. Gates are physical barriers---a network outage that prevents entry/exit is unacceptable. The gate controller maintains a local cache of active bookings and permits, synced every 30 seconds. During outages, the gate makes decisions locally and logs events for reconciliation when connectivity resumes.

### Decision 2: Sensor-Based vs Camera-Based Spot Detection

| Aspect | Individual Sensors (Chosen for bays) | Camera-Based (Chosen for ANPR) |
|--------|--------------------------------------|-------------------------------|
| **Accuracy** | 99%+ per bay | 95-98% depending on lighting/angle |
| **Cost** | $30-50 per sensor per bay | $500-1K per camera covering 20-40 bays |
| **Installation** | Wired or wireless per bay | Mounted at strategic viewpoints |
| **Maintenance** | Individual sensor replacement | Camera cleaning, calibration |
| **Best for** | Per-bay occupancy detection | License plate recognition at gates |

**Decision**: Hybrid approach. Individual sensors (ultrasonic/magnetic) for per-bay occupancy detection (accurate, per-spot granularity). Cameras with ANPR at gates for vehicle identification and permit validation. This gives the best of both: precise availability counts from sensors and seamless permit/booking validation from ANPR.

### Decision 3: Spot Assignment Strategy

| Strategy | Pre-Assign at Booking | Assign at Entry | No Assignment (Self-Park) |
|----------|----------------------|-----------------|--------------------------|
| **User experience** | Best---driver knows exact spot before arriving | Good---spot assigned at gate | Varies---driver searches for spot |
| **Utilization** | Lower---reserved spot sits empty until arrival | Better---spot allocated just-in-time | Best---natural distribution |
| **Complexity** | Highest---must handle no-shows, early releases | Medium---real-time allocation needed | Lowest |
| **Enforcement** | Difficult---other driver may park in reserved spot | Moderate---directed at entry | None |

**Decision**: Pre-assign at booking for reservations (driver knows where to go); no assignment for walk-ins (sensors track actual occupancy). Reserved spots can display "RESERVED" on spot-level indicators. If a walk-in parks in a reserved spot, the system detects the conflict via sensor + booking mismatch and alerts the lot attendant.

---

## Gate Entry Decision Tree

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    START([Vehicle arrives at gate]) --> DETECT{Input type?}

    DETECT -->|QR Scan| QR[Read QR Code]
    DETECT -->|License Plate| ANPR[ANPR Recognition]
    DETECT -->|No input| TICKET[Dispense Ticket]

    QR --> QR_VALID{Booking valid?}
    QR_VALID -->|Yes| QR_WINDOW{Within time window?}
    QR_VALID -->|No| FALLBACK[Fall back to ticket]

    QR_WINDOW -->|Yes| OPEN_GATE([Open Gate + Assign Spot])
    QR_WINDOW -->|No| EXPIRED[Booking expired/early]
    EXPIRED --> FALLBACK

    ANPR --> CONF{Confidence > 85%?}
    CONF -->|No| FALLBACK
    CONF -->|Yes| NORMALIZE[Normalize plate]
    NORMALIZE --> PERMIT_CHECK{Active permit?}

    PERMIT_CHECK -->|Yes| ALREADY{Already parked?}
    ALREADY -->|No| OPEN_GATE
    ALREADY -->|Yes| DENY([Deny Entry])

    PERMIT_CHECK -->|No| BOOKING_CHECK{Active booking?}
    BOOKING_CHECK -->|Yes| OPEN_GATE
    BOOKING_CHECK -->|No| FALLBACK

    FALLBACK --> LOT_FULL{Lot at capacity?}
    LOT_FULL -->|No| TICKET_ENTRY([Dispense Ticket + Open Gate])
    LOT_FULL -->|Yes| DENY

    classDef start fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef action fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef deny fill:#ffcdd2,stroke:#b71c1c,stroke-width:2px

    class START,OPEN_GATE,TICKET_ENTRY start
    class DETECT,QR_VALID,QR_WINDOW,CONF,PERMIT_CHECK,ALREADY,BOOKING_CHECK,LOT_FULL decision
    class QR,ANPR,TICKET,NORMALIZE,FALLBACK,EXPIRED action
    class DENY deny
```

---

## IoT Edge Architecture

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph Edge["Gate Controller (Edge Device)"]
        LC[(Local Cache<br/>SQLite)]
        DE[Decision Engine]
        SM[Sync Manager]
        GH[Gate Hardware<br/>Driver]
        TP[Ticket Printer]
        AM[ANPR Module]
    end

    subgraph Cloud["Cloud Backend"]
        IH[IoT Hub]
        GS[Gate Service]
        BS[Booking Service]
    end

    AM -->|"Plate image"| DE
    DE -->|"Open/Close"| GH
    DE -->|"Print ticket"| TP
    DE <-->|"Validate"| LC

    SM <-->|"Sync every 30s"| IH
    IH <--> GS
    GS <--> BS

    LC <-->|"Push/Pull"| SM

    classDef edge fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef cloud fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class LC,DE,SM,GH,TP,AM edge
    class IH,GS,BS cloud
```

---

## Component Interaction Summary

```
                    ┌──────────────────────────────────────────┐
                    │              Client Layer                │
                    │  Mobile App │ Web Portal │ Admin Portal  │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │           API Gateway / IoT Hub          │
                    │  Auth │ Rate Limit │ Route │ IoT Ingest  │
                    └──────────────┬───────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
    ┌─────▼─────┐           ┌─────▼─────┐           ┌─────▼─────┐
    │   Gate     │           │  Booking  │           │    Lot    │
    │  Service   │◄─────────►│  Service  │           │Management │
    └─────┬─────┘           └─────┬─────┘           └───────────┘
          │                       │
    ┌─────▼─────┐           ┌─────▼─────┐
    │   Slot    │           │  Pricing  │
    │  Service  │           │  Service  │
    └─────┬─────┘           └───────────┘
          │
    ┌─────▼─────┐    ┌───────────┐    ┌───────────┐
    │  Redis    │    │ PostgreSQL│    │   Blob    │
    │(Realtime) │    │ (OLTP)    │    │  Storage  │
    └───────────┘    └───────────┘    └───────────┘
```

---

## Booking Lifecycle State Machine

```mermaid
%%{init: {'theme': 'neutral'}}%%
stateDiagram-v2
    [*] --> PENDING: User initiates booking
    PENDING --> CONFIRMED: Payment captured / spot allocated
    PENDING --> FAILED: Payment failed / no availability

    CONFIRMED --> ACTIVE: Driver arrives (QR scan at gate)
    CONFIRMED --> CANCELLED: User cancels before arrival
    CONFIRMED --> NO_SHOW: Grace period expires (30 min)

    ACTIVE --> OVERTIME: End time + grace exceeded, vehicle still present
    ACTIVE --> COMPLETED: Vehicle exits (gate + sensor confirm)

    OVERTIME --> COMPLETED: Vehicle exits (overtime fee applied)

    NO_SHOW --> [*]: Spot released, no-show fee charged
    CANCELLED --> [*]: Spot released, refund processed
    COMPLETED --> [*]: Payment settled, receipt generated
    FAILED --> [*]: No resources consumed

    note right of OVERTIME
        Physical state (car present)
        overrides logical state
        (booking expired).
    end note

    note right of NO_SHOW
        Scheduled job checks
        every 5 minutes.
        Spot version ensures
        no race with late arrival.
    end note
```
