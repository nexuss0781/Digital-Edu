# Hotel Booking System Design

## System Overview

A hotel booking system---exemplified by Booking.com, Expedia Hotels, and Agoda---orchestrates property search, room availability management, rate calculation, reservation processing, and guest lifecycle management across a fragmented ecosystem of properties, channel managers, and Online Travel Agencies (OTAs). Booking.com lists over 28 million accommodation options and processes 1.5 million+ bookings per day. The core engineering challenge is the intersection of **availability management** (maintaining a real-time availability matrix of property × room_type × date → inventory across thousands of properties with concurrent modifications), **rate complexity** (BAR pricing, negotiated rates, length-of-stay pricing, seasonal adjustments, and rate parity enforcement across distribution channels), **overbooking strategy** (statistical models based on historical no-show rates that intentionally sell beyond physical capacity to maximize revenue), **channel synchronization** (real-time two-way sync of availability and rates across 400+ OTAs via channel managers), and **booking contention** (hundreds of users viewing the same "last room available" while only one can book it). Unlike flight booking, which depends on external GDS systems for inventory truth, hotel booking platforms typically own or directly manage the inventory data---making the platform itself the authoritative system for availability, with all the consistency and concurrency challenges that entails.

---

## Key Characteristics

| Characteristic | Description |
|---------------|-------------|
| **Read/Write Pattern** | Extremely read-heavy: 50:1 search-to-book ratio; searches query availability matrix across date ranges and filters |
| **Latency Sensitivity** | High---search p99 < 2s with complex filtering; booking confirmation p99 < 3s |
| **Consistency Model** | Strong consistency for inventory and reservations (platform is authoritative); eventual consistency for search results and reviews |
| **Data Volume** | High---50M+ searches/day, 1.5M+ bookings/day, 28M+ property listings, 365-day availability calendars per property |
| **Architecture Model** | Search-index-first for discovery; event-driven for availability propagation; saga-based for booking with payment |
| **Rate Complexity** | High---BAR rates, negotiated corporate rates, package rates, LOS pricing, seasonal adjustments, promotional rates, rate parity rules |
| **Complexity Rating** | **High** |

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, algorithms (Step-by-step plan in plain English) |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Availability race conditions, overbooking, search ranking, channel sync |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Horizontal scaling, caching, multi-region, circuit breakers |
| [06 - Security & Compliance](./06-security-and-compliance.md) | PCI-DSS, GDPR, threat model, fraud detection |
| [07 - Observability](./07-observability.md) | Metrics, alerting, distributed tracing, booking funnel analytics |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trade-offs, trap questions |
| [09 - Insights](./09-insights.md) | Key architectural insights, patterns, lessons |

---

## What Differentiates This from Related Systems

| Aspect | Hotel Booking (This) | Flight Booking (7.6) | E-Commerce | Ride-Hailing (7.1) |
|--------|---------------------|---------------------|------------|---------------------|
| **Inventory Source** | Internal (platform is authoritative for availability) | External (GDS/CRS is authoritative) | Internal (warehouse/catalog) | Internal (driver availability) |
| **Inventory Model** | Calendar matrix: property × room_type × date → count | Fare-class buckets per flight | SKU quantities | Real-time driver pool |
| **Pricing Model** | Yield management: BAR, LOS pricing, seasonal rates, negotiated rates | Dynamic: 26 fare classes, load factor, time-to-departure | Fixed catalog pricing | Surge pricing (real-time) |
| **Hold Pattern** | Soft hold (10-30 min) managed by platform | Hard hold (15 min) managed by GDS | Cart with timeout | No hold (instant match) |
| **Overbooking** | Intentional---statistical models based on no-show history | Managed by airline, not OTA | None (exact inventory) | N/A |
| **Distribution** | Multi-channel via channel managers (400+ OTAs) | GDS distributes to all OTAs | Direct or marketplace | Direct platform only |
| **Stay Duration** | Multi-night (date range reservation) | Point-to-point (fixed schedule) | One-time purchase | Single trip |
| **Review System** | Critical for trust---verified-stay reviews | Less critical (airline is the brand) | Product reviews | Driver/rider ratings |

---

## What Makes This System Unique

1. **Availability as a Calendar Matrix Problem**: Unlike flight booking (seat counts per fare class on a single flight), hotel availability is a multi-dimensional matrix: property × room_type × date → available_count. A single booking for a 5-night stay must atomically decrement inventory across 5 different date entries, creating complex multi-row transactional requirements.

2. **Platform-Owned Inventory with Authoritative Responsibility**: The booking platform is the source of truth for availability---unlike flight booking where the GDS arbitrates. This means the platform must solve concurrency, consistency, and race conditions directly rather than delegating to an external system.

3. **Intentional Overbooking as a Revenue Strategy**: Hotels deliberately sell beyond physical capacity based on statistical no-show and cancellation predictions. A 200-room hotel might accept 210 reservations, expecting 5-8% no-shows. Managing overbooking requires probabilistic models, walk policies (relocating guests when overbooked), and compensation rules.

4. **Channel Manager Synchronization**: A single property's availability must be synchronized in real-time across Booking.com, Expedia, Agoda, the hotel's direct website, and potentially dozens of other OTAs. A booking on any channel must instantly reduce availability on all others. Stale availability across channels leads to overbooking beyond the hotel's overbooking tolerance.

5. **Rate Parity and Yield Management Complexity**: Hotels manage multiple rate types (BAR, corporate negotiated, package, promotional, length-of-stay), each with different visibility rules, booking conditions, and distribution restrictions. Rate parity clauses may require the same price across all OTA channels, while direct booking incentives push for lower direct prices---creating contractual tension that the system must enforce.

6. **Date-Range Contention and Fragmentation**: A 3-night booking (Dec 20-23) competes not just with other Dec 20-23 bookings but with any overlapping stay (Dec 19-21, Dec 22-25, etc.). This creates fragmentation problems where short gaps between reservations become unbookable, reducing overall occupancy.

---

## Quick Reference: Scale Numbers

| Metric | Value | Notes |
|--------|-------|-------|
| Searches per day | ~50M | ~580/s average, ~5,800/s at peak |
| Bookings per day | ~1.5M | 50:1 search-to-book ratio |
| Active property listings | ~28M | Hotels, apartments, vacation rentals |
| Room types per property | ~5 average | Standard, Deluxe, Suite, etc. |
| Availability calendar depth | 365 days | Rolling window per room type |
| Availability matrix size | ~51B cells | 28M × 5 × 365 (but only active subset queried) |
| Average stay duration | 2.4 nights | Varies by market segment |
| No-show rate | 5-10% | Varies by property and segment |
| Free cancellation rate | 35-40% | Pre-arrival cancellations |
| Channel manager sync latency | < 5 seconds | Availability update propagation |
| Review volume | ~250M total | Verified stay reviews |
| Commission rate | 15-25% | OTA commission on booking value |

---

## Related Designs

| Design | Relevance |
|--------|-----------|
| [7.6 - Flight Booking System](../7.6-flight-booking-system/) | Booking lifecycle, saga patterns, search optimization—contrast: GDS vs platform-owned inventory |
| [7.2 - Airbnb](../7.2-airbnb/) | Property listing, search, review system—contrast: professional vs peer-to-peer hosting |
| [7.1 - Uber/Lyft Ride-Hailing](../7.1-uber-lyft/) | Real-time availability matching, dynamic pricing—contrast: instant matching vs planned booking |
| [7.3 - Car Parking System](../7.3-car-parking-system/) | Calendar-based inventory, multi-channel sync, hold-with-TTL patterns |
| [6.6 - Ticketmaster](../6.6-ticketmaster/) | Scarce inventory contention, hold patterns, surge pricing—contrast: one-time event vs recurring stays |
| [8.2 - Stripe/Razorpay](../8.2-stripe-razorpay/) | PCI-DSS compliance, tokenized payments, pre-auth/capture flow |
| [6.15 - Calendar Scheduling](../6.15-calendar-scheduling-system/) | Date-range availability queries, time-slot contention, scheduling algorithms |
| [1.5 - Distributed Log-Based Broker](../1.5-distributed-log-based-broker/) | Event streaming for availability changes, booking events, channel sync |

---

## Related Patterns

| Pattern | Relevance |
|---------|-----------|
| **Saga / Compensating Transaction** | Booking flow (hold → pre-auth → confirm → capture) is a saga with compensating actions at each step; payment failure triggers hold release |
| **Atomic Conditional Update** | The WHERE guard in availability UPDATE statements provides optimistic concurrency without distributed locks |
| **Event-Driven Fan-Out** | BookingConfirmed events fan out to channel manager, notifications, analytics—decoupling the booking critical path from downstream consumers |
| **Bloom Filter** | Sold-out bloom filter eliminates ~30% of search candidates before the expensive availability check, reducing per-search I/O |
| **Circuit Breaker** | Per-channel circuit breakers isolate OTA API failures; per-gateway circuit breakers enable payment failover |
| **CQRS** | Search index (read-optimized) separated from availability store (write-optimized); different consistency models per path |
| **Cache Stampede Prevention** | Lock-based refresh with stale-while-revalidate for popular destination searches during peak booking season |
| **Sharding by Natural Key** | Property-based sharding aligns with the natural write contention boundary—bookings for different properties never conflict |

---

## Evolution & Industry Trends

| Era | Trend | Impact on Architecture |
|-----|-------|----------------------|
| **2015–2018** | Meta-search dominance (Google Hotel Ads, Trivago) | Rate parity enforcement becomes critical; price comparison APIs need sub-second response |
| **2018–2020** | Direct booking push (loyalty programs, price match guarantees) | Platform must support member-only rates and best-price guarantees; rate management complexity increases |
| **2020–2022** | Flexible cancellation as standard (post-pandemic) | Cancellation rate spikes to 40%+; availability systems must handle high write churn from cancellations/rebookings |
| **2022–2024** | Alternative accommodations growth (apartments, villas) | Property type diversity increases; availability models must support non-traditional check-in/check-out patterns |
| **2024–2025** | AI-powered search (conversational booking, natural language queries) | Search architecture evolves from filters to intent understanding; embedding-based property matching |
| **2025–2026** | Dynamic packaging (hotel + flight + car as single product) | Cross-service inventory coordination; atomic multi-product booking sagas; bundle pricing engines |
| **Future** | Decentralized distribution (blockchain-based channel management), real-time personalized pricing per user | On-chain availability reduces channel sync latency; per-user yield optimization raises privacy and fairness concerns |

---

## What Makes This System Architecturally Interesting

| Dimension | Challenge | Why It's Hard |
|-----------|-----------|---------------|
| **Multi-cell atomicity** | A 5-night booking must atomically decrement 5 separate date rows; failure on any one rolls back all | Unlike single-counter inventory, this is a multi-row transactional problem that requires SERIALIZABLE isolation within a shard |
| **Intentional over-selling** | Hotels deliberately sell more rooms than physically exist based on no-show predictions | The "sold out" threshold is not a hard limit but a probabilistic model output—architecture must support configurable risk parameters per property |
| **Dual-audience real-time** | Guests see search results; property managers see dashboards; both need near-real-time data from the same availability source | CQRS separates read-optimized search indexes from write-optimized availability stores, each with different consistency guarantees |
| **Cross-platform consistency** | A booking on any of 400+ OTA channels must instantly reduce availability on all others | Event-driven fan-out with per-channel circuit breakers and reconciliation jobs—a distributed consistency problem without a shared database |
| **Revenue vs. UX tension** | Hold duration trades guest convenience (longer holds) against inventory utilization (shorter holds) | The TTL is a business-tunable parameter that directly impacts both conversion rate and revenue-per-available-room |
| **Physical-world feedback loop** | Overbooking model predictions are validated (or invalidated) only when guests physically arrive or don't | Walk events feed back into the statistical model, creating a closed-loop system where real-world outcomes calibrate software predictions |

---

## Sources

- Booking.com Engineering Blog --- Scaling Accommodation Search and Availability
- SiteMinder --- Channel Manager Architecture and OTA Integration Patterns
- AltexSoft --- Hotel Revenue Management: Strategies, Tools, and Best Practices
- XOTELS --- Hotel Pricing Matrix and Rate Management Strategies
- Mews --- Types of Hotel Rates and Rate Management
- OTA Insight --- Rate Intelligence and Competitive Pricing
- AHLA --- PCI-DSS Compliance for Hospitality
- Industry Statistics: Booking Holdings 2025, Expedia Group 2025
