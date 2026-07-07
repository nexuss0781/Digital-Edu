# Uber/Lyft Ride-Hailing Platform Design

## System Overview

A ride-hailing platform---exemplified by Uber, Lyft, Grab, and Ola---orchestrates real-time matching between riders requesting transportation and drivers offering it, at global scale. Uber processes 28M+ trips per day across 70+ countries with 5.4M+ active drivers, making it one of the highest-throughput real-time geospatial systems ever built. The core engineering challenge is the intersection of **real-time geospatial indexing** (tracking millions of moving drivers), **sub-second matching** (finding the best driver for each request), **dynamic pricing** (balancing supply and demand in near-real-time), and **trip lifecycle management** (orchestrating a multi-state distributed workflow across two mobile clients, multiple backend services, and a payment system---all while drivers move at 60 km/h and network connections drop). Unlike static matching systems (job boards, dating apps), every entity in a ride-hailing system is continuously moving, making every cached result stale within seconds.

---

## Key Characteristics

| Characteristic | Description |
|---------------|-------------|
| **Read/Write Pattern** | Write-heavy for location updates (875K writes/s at peak); read-heavy for rider-facing queries (nearby drivers, ETA) |
| **Latency Sensitivity** | Very High---matching must complete in <1s; location updates must be ingested in <2s; ETA computation <500ms |
| **Consistency Model** | Strong consistency for trip state machine and payment; eventual consistency for driver locations and surge pricing |
| **Concurrency Level** | Very High---millions of concurrent driver location streams, hundreds of thousands of simultaneous trip state machines |
| **Data Volume** | High---~75B location updates/day, ~28M trips/day, trip records growing at ~10TB/year |
| **Architecture Model** | Event-driven, write-heavy geospatial pipeline with stateless matching and persistent trip state machines |
| **Real-time Requirements** | Hard real-time for matching and dispatch; soft real-time for surge pricing and ETA |
| **Complexity Rating** | **Very High** |

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, algorithms (Step-by-step plan in plain English) |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Geospatial index, matching engine, surge pricing, location pipeline, trip state machine |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | City-based sharding, multi-region, failure modes |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Driver verification, location privacy, PCI compliance, anti-fraud |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-offs |
| [09 - Insights](./09-insights.md) | Key architectural insights, patterns, lessons |

---

## What Differentiates This from Related Systems

| Aspect | Ride-Hailing (This) | Food Delivery (7.4) | Hotel Booking (7.7) | Static Matching (e.g., Job Board) |
|--------|---------------------|---------------------|---------------------|----------------------------------|
| **Primary Unit** | Trip (driver + rider + route) | Order (restaurant + driver + customer) | Reservation (room + guest + dates) | Match (provider + consumer) |
| **Entity Movement** | Both sides moving (driver + rider location) | One side moving (delivery driver) | Static (hotel location fixed) | Static (no location tracking) |
| **Matching Window** | Seconds (<15s to find driver) | Minutes (restaurant prep time buffers) | Days-weeks (advance booking) | Hours-days (async matching) |
| **Supply Elasticity** | High (drivers go online/offline freely) | Medium (restaurants have fixed hours) | Low (room inventory is fixed) | Low (supply is listed) |
| **Pricing Model** | Dynamic (surge pricing in real-time) | Semi-dynamic (delivery fees vary) | Revenue management (yield pricing) | Fixed or negotiated |
| **Location Updates** | Continuous (every 4s per driver) | Periodic (during delivery only) | None | None |
| **State Machine** | Complex (6+ states, real-time transitions) | Complex (order lifecycle) | Simple (booked/cancelled/completed) | Simple (open/matched/closed) |
| **Geospatial Index** | In-memory, sub-second updates | In-memory for active deliveries | Static geo index | Not needed |

---

## What Makes This System Unique

1. **Real-Time Geospatial Indexing at Massive Write Throughput**: With 3.5M+ active drivers each sending location updates every 4 seconds, the system must ingest and index ~875K location writes per second into a geospatial structure that supports sub-100ms nearest-neighbor queries. This is not a read-heavy search problem---it is a write-heavy indexing problem where every entry expires in seconds.

2. **Dynamic Pricing as a Market-Clearing Mechanism**: Surge pricing is not a simple multiplier---it is a real-time economic signal computed at sub-neighborhood granularity (using hexagonal grid cells) that must balance rider demand against driver supply. The pricing engine must update multipliers every 1-2 minutes across thousands of zones per city, incorporating demand forecasting, driver supply prediction, and regulatory constraints.

3. **Supply-Demand Balancing Across a Two-Sided Market**: Unlike most systems that optimize for one user type, ride-hailing must simultaneously optimize for rider wait time, driver utilization, and platform revenue. A matching decision that minimizes one metric often worsens another, creating a multi-objective optimization problem solved under hard latency constraints.

4. **Driver State Machine with Distributed Reliability**: Each driver transitions through states (OFFLINE -> AVAILABLE -> DISPATCHED -> ON_TRIP -> back to AVAILABLE) across unreliable mobile networks. The trip state machine must be persistent, idempotent, and recoverable---if a driver's phone loses connectivity mid-trip, the system must detect the gap, maintain the trip state, and recover seamlessly when the connection resumes.

5. **Trip Lifecycle as a Distributed Saga**: A single trip involves coordinated state changes across the dispatch service, trip service, payment service, notification service, and two mobile clients. Any component can fail at any step. The trip lifecycle must be modeled as a distributed saga with compensating transactions (e.g., if payment fails after trip completion, the trip still completes but enters a payment-retry workflow).

---

## Quick Reference: Scale Numbers

| Metric | Value | Notes |
|--------|-------|-------|
| Trips per day | ~28M | ~325 trips/second average, ~1,000/s at peak |
| Active drivers | ~5.4M | Not all online simultaneously |
| Peak concurrent online drivers | ~3.5M | Location update generators |
| Location updates/second | ~875K | 3.5M drivers / 4s interval |
| Matching latency target | <1s | From request to driver notification |
| Location update ingestion | <2s | From driver phone to geospatial index |
| ETA accuracy target | <2 min error | For trips under 15 min |
| Surge price update interval | 1-2 min | Per hexagonal zone |
| Cities served | 10,000+ | Across 70+ countries |

---

## Related Designs

| Design | Relevance |
|--------|-----------|
| [7.4 - Food Delivery System](../7.4-food-delivery-system/) | Similar dispatch and ETA problems, different matching constraints |
| [7.5 - Maps & Navigation Service](../7.5-maps-navigation-service/) | Routing engine, tile system, traffic estimation |
| [1.5 - Distributed Log-Based Broker](../1.5-distributed-log-based-broker/) | Location ingestion pipeline architecture |
| [3.5 - Uber Michelangelo ML Platform](../3.5-uber-michelangelo-ml-platform/) | ML models for ETA, surge, fraud detection |
| [1.9 - Consistent Hashing Ring](../1.9-consistent-hashing-ring/) | Sharding driver location data across workers |
| [8.2 - Stripe/Razorpay](../8.2-stripe-razorpay/) | Payment processing, idempotency keys, fare charges |
| [4.1 - Notification System](../4.1-notification-system/) | Push notifications for trip offers, rider updates, surge alerts |
| [8.5 - Fraud Detection System](../8.5-fraud-detection-system/) | GPS spoofing detection, fake ride detection, account takeover prevention |

---

## Related Architectural Patterns

| Pattern | How It Applies to Ride-Hailing |
|---------|-------------------------------|
| **Tiered Write Pipeline with Filtering** | Location ingestion flows through WebSocket → queue → consumer (filter, validate, dedupe) → in-memory index, reducing 875K raw writes/s to ~525K effective index updates |
| **Two-Phase Search (Coarse Filter + Fine Ranking)** | Matching uses fast H3 geo-filter (<10ms) to narrow thousands of drivers to 5-10 candidates, then expensive routing ETA (<500ms) to rank them |
| **Persistent State Machine with Idempotent Transitions** | Trip lifecycle enforces valid transitions via conditional database updates; idempotent operations enable retry-safe recovery from any failure |
| **Market-Clearing Dynamic Pricing with Dampening** | Surge pricing computes supply/demand equilibrium at neighborhood granularity with smoothing to prevent oscillation |
| **City-Based Data Partitioning** | Geographic isolation provides natural shard key where cross-partition queries are physically impossible |
| **Client-Side State Digest for Disaster Recovery** | Encrypted trip state pushed to driver phones enables 100% in-flight trip recovery during data center failures |
| **Graceful Degradation Hierarchy** | Multi-level fallback from full-featured matching to distance-only to queued matching preserves availability during partial failures |
| **Pre-Provisioned Scaling for Predictable Peaks** | Calendar-driven capacity pre-scaling (NYE, concerts) replaces reactive auto-scaling that is too slow for real-time matching |

---

## Industry Evolution (2024--2026)

| Trend | Impact on Architecture |
|-------|----------------------|
| **Autonomous vehicle integration** | Eliminates driver acceptance step; transforms fleet positioning from incentive-based to direct optimization; adds battery/charging constraints |
| **EV fleet management** | Battery level becomes a matching constraint; charging coordination requires fleet-level scheduling; range prediction integrated into ETA |
| **Multi-modal transport** | Unified trip planner combining ride-hail, public transit, micro-mobility (scooters, bikes); requires transit API integration and intermodal routing |
| **Ride pooling optimization** | ML-driven detour prediction and dynamic pricing for shared rides; real-time waypoint re-optimization as riders join/leave |
| **Gig worker regulation** | Driver classification as employees in some jurisdictions; requires hour tracking, minimum earnings guarantees, benefits eligibility |
| **Supply repositioning AI** | Demand forecasting models proactively reposition idle drivers; guaranteed minimum earnings for repositioning reduce rider wait times 20-30% |
| **Safety technology** | Crash detection via accelerometer, route deviation monitoring, in-app emergency button with automatic emergency services integration |
| **Carbon-aware routing** | Trip routing considers carbon footprint alongside time and cost; EV matching preference for eco-conscious riders |
| **Driver earnings fairness** | ML matching considers equitable trip distribution across drivers; prevents earnings concentration in high-demand zones |
| **Real-time fraud detection** | ML models detect GPS spoofing, fake rides, and collusion in real-time during trip lifecycle |

---

## Sources

- Uber Engineering Blog --- H3 Hexagonal Hierarchical Spatial Index
- Uber Engineering Blog --- Ringpop: Scalable Application-Layer Sharding
- Uber Engineering Blog --- DISCO: Dispatch Optimization
- Uber Engineering Blog --- Driver Surge Pricing (Management Science)
- Uber Engineering Blog --- Michelangelo ML Platform
- Uber Engineering Blog --- Autonomous Vehicle Architecture (2025)
- Uber Engineering Blog --- Safety Detection Systems
- Lyft Engineering Blog --- Envoy Proxy, Geospatial Services
- Lyft Engineering Blog --- Shared Rides Matching Optimization
- Research: H3 Hexagonal Grid System (Uber Open Source)
- Research: Dynamic Pricing in Two-Sided Markets (Management Science, 2021)
- Research: Vehicle Routing Problem with Time Windows (Combinatorial Optimization)
- Industry Statistics: Uber 2025 Annual Report, 28M trips/day, 5.4M drivers
- Conference: QCon --- Building Real-Time Geospatial Systems at Uber Scale
- Waymo / Cruise --- Autonomous Fleet Management Architecture
- Research: Multi-Modal Urban Mobility Platform Design (IEEE, 2025)
- Industry: McKinsey --- Future of Mobility: EV Fleet Transition Economics
- Industry: Deloitte --- Gig Worker Regulation Impact on Platform Architecture
- Industry: BCG --- Ride Pooling Economics and Optimization Algorithms
