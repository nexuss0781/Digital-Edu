# Airbnb Marketplace Platform Design

## System Overview

Airbnb is a two-sided marketplace connecting hosts who list properties with guests seeking short-term accommodations, operating across 220+ countries with 7M+ active listings and 150M+ users. The core engineering challenge lies at the intersection of **calendar availability management** (preventing double-bookings across millions of per-date inventory slots using distributed locking), **geo-aware search and ML ranking** (combining geospatial filtering with personalized machine learning models across two distinct interfaces---list results and map pins), **split payment orchestration** (holding guest funds at booking, capturing at check-in, and splitting payouts to hosts with configurable fee structures across 40+ currencies), and **two-sided trust** (verifying identities, detecting fraudulent listings, and mediating disputes in a system where neither party has met before). Unlike traditional hotel booking systems with static room inventory and centralized management, Airbnb's inventory is distributed across millions of independent hosts, each managing their own calendars, pricing, and availability---making consistency, synchronization, and trust the defining architectural challenges.

---

## Key Characteristics

| Characteristic | Description |
|---------------|-------------|
| **Read/Write Pattern** | Read-heavy for search (~50K QPS at peak); write-heavy for calendar updates and bookings (~5K booking writes/s at peak) |
| **Latency Sensitivity** | High---search must return in <800ms; booking confirmation in <500ms; calendar lock acquisition in <100ms |
| **Consistency Model** | Strong consistency for calendar/availability and bookings (CP); eventual consistency for search index, reviews, and pricing suggestions (AP) |
| **Concurrency Level** | Very High---millions of concurrent searches, thousands of simultaneous booking attempts, calendar updates across 7M+ listings |
| **Data Volume** | High---7M+ listings with 365 calendar slots each (~2.5B calendar rows), 2M+ bookings/day at peak, 500M+ reviews, petabytes of listing photos |
| **Architecture Model** | Service-oriented architecture with event-driven async propagation, distributed locking for availability, and ML inference pipelines for search and pricing |
| **Marketplace Dynamics** | Two-sided: host supply management (calendar, pricing) and guest demand matching (search, booking); platform mediates trust, payments, and disputes |
| **Complexity Rating** | **Very High** |

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, algorithms (Step-by-step plan in plain English) |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Availability locking, search ranking, payment orchestration |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Sharding, caching, multi-region, fault tolerance |
| [06 - Security & Compliance](./06-security-and-compliance.md) | PCI compliance, identity verification, fraud detection, GDPR |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-offs |
| [09 - Insights](./09-insights.md) | Key architectural insights, patterns, lessons |

---

## What Differentiates This from Related Systems

| Aspect | Airbnb (This) | Hotel Booking (OTA) | Ride-Hailing (7.1) | Food Delivery (7.4) |
|--------|---------------|--------------------|--------------------|---------------------|
| **Inventory Type** | Per-date calendar slots per listing | Pre-allocated room blocks | Driver availability (real-time) | Restaurant menu items (real-time) |
| **Supply Control** | Distributed (individual hosts) | Centralized (hotel management) | Distributed (drivers go online/offline) | Semi-centralized (restaurant hours) |
| **Booking Horizon** | Days to months in advance | Days to months in advance | Seconds (on-demand) | Minutes (on-demand) |
| **Consistency Need** | Per-date availability (must prevent double-booking) | Room allocation (overbooking is common and managed) | Real-time location matching | Order availability (menu stock) |
| **Payment Model** | Authorize now, capture at check-in, split payout T+24h | Charge at booking or check-in | Charge after trip completion | Charge at order placement |
| **Trust Challenge** | Both sides unknown (host + guest) | One side known (hotel brand) | Driver verification + rider safety | Restaurant quality + delivery reliability |
| **Search Complexity** | Geo + dates + amenities + ML ranking | Geo + dates + star rating | Real-time geo proximity + ETA | Geo proximity + cuisine + rating |
| **Pricing Model** | Host-set base + dynamic pricing suggestions | Revenue management (yield pricing) | Dynamic surge pricing | Menu prices + delivery fee |

---

## Key Architectural Themes

1. **Calendar as the Core Data Structure**: Unlike hotel systems that manage room counts, Airbnb tracks availability per-listing, per-date---creating a massive state space (7M listings × 365 days = 2.5B+ cells) that must remain strongly consistent to prevent double-bookings.

2. **Distributed Lock Contention on Popular Listings**: A popular beachfront property during peak season may receive 100+ simultaneous booking attempts for the same dates, requiring pessimistic locking with careful TTL management and fairness guarantees.

3. **Dual Search Interfaces (List + Map)**: Airbnb's search serves two fundamentally different UIs---a ranked list and a geographic map---requiring different ranking models and attention distribution assumptions (sequential position bias vs. radial geographic attention decay).

4. **Authorize-Then-Capture Payment Model**: Unlike e-commerce (charge immediately), Airbnb authorizes the guest's payment at booking but captures funds only at check-in, with host payout occurring 24 hours after check-in. This creates a multi-day distributed transaction with complex failure modes.

5. **Two-Sided Trust at Scale**: Neither host nor guest has inherent credibility. The platform must verify identities, detect fake listings, prevent payment fraud, mediate damage claims, and enforce review integrity---all while maintaining a low-friction user experience.

6. **Event-Driven Consistency Bridge**: Strong consistency for bookings and calendar (transactional database with distributed locks) coexists with eventual consistency for search (Elasticsearch index updated via event stream), requiring careful handling of the consistency boundary.

---

## Architecture Evolution

| Phase | Era | Architecture | Key Capability |
|-------|-----|-------------|----------------|
| **Monolith** | 2008–2014 | Ruby on Rails monolith with PostgreSQL | Rapid iteration, single deployment unit |
| **SOA Migration** | 2014–2018 | ~400 microservices, Java/Kotlin services | Independent scaling, team autonomy |
| **Service Blocks** | 2018–2022 | Domain-aligned service blocks with facade APIs | Reduced coordination overhead, clear ownership |
| **AI-Native Platform** | 2022–present | ML-first search ranking, LLM-powered support, dynamic pricing intelligence | Personalized experiences, operational automation |

### Key Evolutionary Decisions

- **Service Block Pattern Over Pure Microservices**: After experiencing the coordination overhead of 400+ independent microservices, Airbnb grouped related services into domain-aligned "blocks" (Availability Block, Booking Block, Payment Block) with facade APIs, reducing cross-team dependencies by ~60% while preserving internal deployment independence.
- **Dual Search Architecture**: Separating the list-based search ranking (sequential position bias, ML-heavy) from the map-based search experience (radial attention decay, bookability filtering) enabled independent optimization of each interface—improving map conversion by 1.9% through the "less is more" pin filtering strategy.
- **Authorize-Then-Capture Over Charge-at-Booking**: Choosing deferred capture (authorize at booking, capture at check-in) created a fundamentally different payment architecture with hold management, re-authorization cycles, and multi-day settlement—but enabled flexible cancellation policies that increased host participation.

---

## Related Patterns

| Related Topic | Connection to Airbnb |
|---|---|
| [7.1 Uber/Lyft](../7.1-uber-lyft/00-index.md) | Two-sided marketplace with distributed supply — Uber's driver matching shares Airbnb's challenge of coordinating millions of independent supply providers, but Airbnb operates on days-to-months booking horizons vs. seconds |
| [7.7 Hotel Booking System](../7.7-hotel-booking-system/00-index.md) | Accommodation booking with calendar management — shares date-range availability logic but Hotel Booking uses centralized inventory with intentional overbooking, while Airbnb's distributed host inventory demands strict double-booking prevention |
| [7.4 Food Delivery System](../7.4-food-delivery-system/00-index.md) | Multi-sided marketplace coordination — Food Delivery's three-party saga (customer-restaurant-driver) parallels Airbnb's host-guest-platform trust triangle, both using saga patterns for multi-service transaction coordination |
| [8.2 Stripe/Razorpay](../8.2-stripe-razorpay/00-index.md) | Payment orchestration and split payouts — Airbnb's authorize-then-capture model with delayed host payouts directly leverages payment gateway patterns for hold management, re-authorization, and multi-party settlement |
| [1.5 Distributed Lock Manager](../1.5-distributed-lock-manager/00-index.md) | Pessimistic locking for availability — Airbnb's per-listing distributed lock for preventing concurrent double-bookings is a textbook application of distributed lock patterns with careful TTL management |
| [1.18 Event Sourcing System](../1.18-event-sourcing-system/00-index.md) | Event-driven state propagation — the calendar write → event stream → search index reindex pipeline bridges the CP/AP consistency boundary using event sourcing principles |
| [1.19 CQRS Implementation](../1.19-cqrs-implementation/00-index.md) | Separated read/write models — Airbnb's architecture uses PostgreSQL for transactional calendar writes (command side) and Elasticsearch for optimized search queries (query side), bridged by an event-driven sync pipeline |
| [12.18 Marketplace Platform](../12.18-marketplace-platform/00-index.md) | General marketplace architecture — shares escrow-based payment flows, trust/reputation systems, and the fundamental supply-demand matching challenge, but Airbnb adds calendar-based inventory and geographic search complexity |

---

## Prerequisites and Related Designs

| Design | Relevance |
|--------|-----------|
| [1.5 Distributed Lock Manager](../1.5-distributed-lock-manager/00-index.md) | Calendar availability locking pattern—understand distributed pessimistic locks before studying double-booking prevention |
| [8.2 Stripe/Razorpay](../8.2-stripe-razorpay/00-index.md) | Payment authorization and capture flows—required context for the multi-day settlement pipeline |
| [7.7 Hotel Booking System](../7.7-hotel-booking-system/00-index.md) | Compare centralized hotel inventory vs. distributed host inventory to understand Airbnb's unique consistency challenges |

---

## Key Technology References

| Component | Real-World Approach |
|-----------|-------------------|
| Calendar Store | Sharded PostgreSQL with per-date rows, composite primary key (listing_id, date) |
| Availability Locking | Distributed pessimistic lock with 10s TTL, per-listing granularity |
| Search Engine | Elasticsearch with ML-based learned ranking, geo-spatial indexing |
| Availability Cache | Redis hash maps, synchronously updated on calendar writes |
| Payment Orchestration | Authorize-then-capture with hold management and re-authorization scheduling |
| Event Bus | Event stream for calendar → search index propagation (30-60s lag) |
| Trust & Safety | ML fraud scoring, identity verification, booking-verified reviews |
| iCal Sync | Poll-based external calendar import (5-60 minute intervals) |
| Service Architecture | Domain-aligned service blocks with facade APIs |
| Dynamic Pricing | ML-powered pricing suggestions for hosts (Smart Pricing) |
| Map Rendering | Bookability-filtered pin display with radial attention optimization |

---

## Sources

- Airbnb Engineering Blog — Building the Service Block Architecture, Knowledge Graph, Dynamic Pricing
- Airbnb Engineering — Scaling Search with Learned Ranking Models and Map Optimization
- Airbnb Research — Map-Based Search Optimization and Radial Attention Distribution Models (2024)
- Airbnb Tech Talks — Calendar Availability at Scale, Payment Orchestration Patterns
- Industry references: Airbnb 7M+ active listings (2025), 220+ countries, 150M+ users, $80B+ market cap
- Academic papers on two-sided marketplace economics, distributed locking, and geo-spatial search ranking

---

## Scale Reference Points

| Metric | Value |
|---|---|
| **Active Listings** | 7M+ (2025) |
| **Registered Users** | 150M+ |
| **Countries** | 220+ |
| **Calendar Rows** | ~2.5B (7M listings × 365 days) |
| **Peak Search QPS** | ~50,000 |
| **Peak Booking Writes/s** | ~5,000 |
| **Reviews** | 500M+ |
| **Currencies Supported** | 40+ |
| **Listing Photos (storage)** | Petabytes |
