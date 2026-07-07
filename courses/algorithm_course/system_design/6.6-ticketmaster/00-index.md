# Ticketmaster System Design

## Overview

Ticketmaster is the world's largest ticket marketplace, processing ticket sales for concerts, sports, theater, and live events. The system's defining challenge is **extreme write contention** -- millions of users competing simultaneously for a limited inventory of thousands of seats during high-demand on-sales, while guaranteeing no double-selling and maintaining fairness through virtual queuing. Part of Live Nation Entertainment, Ticketmaster handles over 500 million tickets annually across 30+ countries with an Inventory Core written in C++ for microsecond-level seat locking.

## Key Characteristics

| Characteristic | Description |
|----------------|-------------|
| **Traffic Pattern** | Extreme spiky (thundering herd during on-sales, low baseline otherwise) |
| **Read:Write Ratio** | 100:1 during browsing; inverts to ~1:1 during active on-sales |
| **Consistency Model** | Strong consistency for seat inventory (no double-selling) |
| **Latency Sensitivity** | Critical -- sub-second seat holds, real-time queue updates |
| **Contention Level** | Extremely high -- millions competing for thousands of seats |
| **Data Sensitivity** | PCI-DSS for payments, PII for user profiles |
| **Architecture Model** | Microservices with monolithic Inventory Core (C++); event-driven async for non-critical paths |
| **Bot Threat Level** | Critical -- 8.7B attempts/month; defense in depth is a first-class design concern |
| **Regulatory Burden** | BOTS Act (US), GDPR (EU), ADA (accessibility), PCI-DSS (payments), consumer protection |

## Complexity Rating

**Very High** -- Combines real-time inventory management with extreme contention, virtual queuing fairness guarantees, bot detection, dynamic pricing, and payment processing under massive spike loads.

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning |
| [02 - High-Level Design](./02-high-level-design.md) | System architecture, data flow, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, core algorithms |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Seat contention, virtual queue, payment flow |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, fault tolerance, DR |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Bot detection, fraud, PCI-DSS, threat model |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-offs |
| [09 - Insights](./09-insights.md) | Key architectural insights, patterns, lessons |

## What Differentiates This from Related Systems

| Aspect | Ticketmaster (This) | Hotel Booking (7.7) | Flight Booking (7.6) | Airbnb (7.2) | E-Commerce (8.1) |
|--------|---------------------|--------------------|--------------------|-------------|-----------------|
| **Contention** | Extreme (100K+ on single seat) | Low (room types fungible) | Medium (seat classes) | Low (calendar-based) | High (flash sales only) |
| **Inventory** | Non-fungible (each seat unique) | Fungible (room type) | Semi-fungible (class) | Non-fungible (property) | Fungible (SKU count) |
| **Traffic pattern** | 1000x spikes | Seasonal, gradual | Moderate spikes | Steady | Black Friday spikes |
| **Lock mechanism** | Redis SETNX | DB OCC | GDS-managed | Optimistic | Pre-sharded counters |
| **Queue system** | Virtual waiting room | None | None | None | None (or limited) |
| **Bot threat** | Critical (8.7B/month) | Low | Low | Moderate | High (limited drops) |
| **Fairness** | First-class requirement | Not applicable | Not applicable | Not applicable | Not applicable |

## What Makes This System Unique

1. **Thundering Herd Problem**: Traffic can spike 1000x in seconds when a popular event goes on sale (e.g., Taylor Swift Eras Tour: 3.5 billion requests, 14M users for 2.4M tickets)
2. **Inventory is Finite and Non-Fungible**: Each seat is unique -- Section 101, Row A, Seat 5 is different from Seat 6. No "just add more inventory"
3. **Fairness vs. Performance Trade-off**: Virtual waiting rooms must balance queue fairness with system throughput
4. **Two-Phase Commit Problem**: Seat hold + payment must be atomic across distributed services
5. **Bot Arms Race**: 8.7 billion bot attempts blocked monthly; scalpers use residential proxies and antidetect browsers
6. **Adversarial Traffic Profile**: Not just high load but actively malicious -- bots using residential proxies, antidetect browsers, CAPTCHA-solving services, and distributed bot farms
7. **Reconciliation as Architecture**: Redis (ephemeral holds) and PostgreSQL (durable orders) must be kept in sync -- post-on-sale reconciliation detects and resolves any discrepancies between the two sources of truth
8. **Adaptive Systems Under Load**: The leaky bucket drain rate, degradation levels, and circuit breakers all adjust dynamically based on real-time health signals -- static configuration cannot handle the variability of mega on-sales

## Real-World Scale (Ticketmaster/Live Nation)

| Metric | Value |
|--------|-------|
| Annual tickets sold | 500M+ |
| Countries | 30+ |
| Monthly bot attempts blocked | 8.7 billion |
| Peak requests (single on-sale) | 3.5 billion (Eras Tour) |
| Codebase | 4.5M+ lines across 13 platforms |
| CDN provider | Fastly (16 business units) |
| Inventory Core | C++ with assembly for critical sections |
| Protocol Buffers | Google Protobuf for inter-service communication |

## Cross-Cutting Patterns

| Pattern | Application in This System | Also Appears In |
|---------|---------------------------|-----------------|
| **Virtual Waiting Room (Leaky Bucket)** | Absorb thundering herd at CDN edge; meter admission to booking page | 7.7 Hotel Booking (limited), Flash Sale systems |
| **Redis SETNX as Distributed Lock** | Atomic seat holds with TTL auto-release for extreme contention | 7.2 Airbnb (calendar booking), 7.7 Hotel Booking |
| **Bulkhead Isolation** | Separate resource pools for on-sale vs. browsing vs. admin | 7.4 Food Delivery (per-service isolation) |
| **Outbox Pattern** | Bridge payment-to-sold state transition gap | 7.4 Food Delivery, 8.6 Core Banking |
| **Circuit Breaker** | Multi-gateway payment routing with fail-fast | 7.6 Flight Booking (GDS circuit breakers) |
| **Edge-Side Validation** | JWT verification at CDN worker; bots rejected before origin | 5.5 Payment Processing (edge fraud screening) |
| **Bitmap Data Structure** | Seat availability as 1 bit per seat for O(1) checks | 7.3 Parking System (spot availability bitmap) |

## ADR Summary

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| ADR-1 | Seat hold store | Redis SETNX (not DB locks) | Sub-ms atomic holds under 100K+ contention; DB locks cause cascading timeouts |
| ADR-2 | Queue model | CDN-static page + WebSocket push | 14M users polling = catastrophic; push from server controls load |
| ADR-3 | Position assignment | Random within join window, FIFO (First-In-First-Out, like a line at a store) after | Prevents bots winning through speed; fairness guarantee |
| ADR-4 | Hold semantics | All-or-nothing with Lua rollback | Partial holds create orphaned inventory |
| ADR-5 | Checkout atomicity | Idempotent payment + outbox pattern | Bridges gap between payment charge and seat state transition |
| ADR-6 | Regional architecture | Active-passive (not active-active) | Strong consistency for seat inventory; cross-region latency breaks SETNX |
| ADR-7 | Inventory Core | C++ with assembly for critical sections | Microsecond-level seat locking requires native performance |
| ADR-8 | Bot detection | Multi-layer (edge → client → behavior → account) | Single-layer easily bypassed; defense in depth |
| ADR-9 | Resale marketplace | Platform-controlled with price caps | Prevents scalping; maintains fan trust; regulatory compliance |
| ADR-10 | Ticket security | Rotating barcodes (TOTP-based, 15s rotation) | Screenshots useless; prevents counterfeit tickets |
| ADR-11 | Event isolation | Dedicated resource pools for Tier 1 events | Mega on-sale cannot degrade other events (noisy neighbor) |
| ADR-12 | Drain rate control | Adaptive (not static) based on downstream health | Static rate assumes constant capacity; reality is variable |

## Related Designs

| Design | Relevance |
|--------|-----------|
| [7.2 - Airbnb](../7.2-airbnb/) | Calendar double-booking prevention, optimistic locking for low contention |
| [7.3 - Car Parking System](../7.3-car-parking-system/) | Spot availability bitmap, IoT sensor state management |
| [7.6 - Flight Booking System](../7.6-flight-booking-system/) | GDS seat inventory, two-phase hold with TTL, saga for multi-segment booking |
| [7.7 - Hotel Booking System](../7.7-hotel-booking-system/) | Calendar matrix inventory, soft hold with TTL, overbooking strategy |
| [8.6 - Core Banking](../8.6-distributed-ledger-core-banking/) | Saga pattern, idempotency, reconciliation as architecture |
| [5.5 - Payment Processing](../5.5-payment-processing-system/) | Payment gateway abstraction, PCI-DSS, multi-gateway routing |
| [1.1 - Distributed Rate Limiter](../1.1-distributed-rate-limiter/) | Leaky bucket algorithm, Redis Lua scripts for atomic operations |
| [8.1 - Amazon](../8.1-amazon/) | Flash sale inventory management, pre-sharded counters, cell-based architecture |
| [8.5 - Fraud Detection](../8.5-fraud-detection-system/) | Multi-model ensemble for adversarial detection, real-time scoring |

---

## Quick Reference: Scale Numbers

| Metric | Value | Notes |
|--------|-------|-------|
| Annual tickets sold | 500M+ | Across all event types and 30+ countries |
| Monthly active users | 80M | Peak during festival season |
| Peak concurrent (single event) | 14M+ | Taylor Swift Eras Tour, 2022 |
| Peak requests (single on-sale) | 3.5 billion | Eras Tour on-sale day |
| Seat hold latency (p99) | <50ms | Redis SETNX + network round-trip |
| Checkout latency (p99) | <5s | Dominated by payment gateway (3-5s) |
| Queue position update | <500ms | WebSocket push from server |
| Protected zone capacity | ~2,000 concurrent | Calibrated to downstream capacity |
| Monthly bot attempts blocked | 8.7 billion | Multi-layer detection |
| CDN cache hit ratio | 90-95% | Static + waiting room pages |
| Hold TTL | 10 min (600s) | Balances UX vs. inventory lockup |
| Traffic spike factor | 1000x | Baseline browsing to on-sale peak |
| Seat bitmap (80K venue) | ~10 KB | 1 bit per seat, ~160 sections |

---

## Sources

- Ticketmaster Engineering Blog (tech.ticketmaster.com)
- SeatGeek Virtual Waiting Room Architecture (AWS Architecture Blog)
- Taylor Swift/Ticketmaster Meltdown Analysis (CockroachDB, Educative)
- Queue-it Virtual Waiting Room Documentation
- Ticketmaster Developer Portal (developer.ticketmaster.com)
- Fastly Customer Case Study: Ticketmaster
- BOTS Act (Better Online Tickets Sales Act) -- US Federal Law (2016)
- Queue-it --- How Virtual Waiting Rooms Work (Architecture Deep Dive)
- Ably --- Real-Time WebSocket Scaling for Live Events
- US Senate Judiciary Committee --- Ticketmaster/Live Nation Hearing (2023)
- Fastly Edge Compute --- Serverless Functions at CDN Edge
- Redis Labs --- Managing Extreme Contention with SETNX and Lua Scripts
