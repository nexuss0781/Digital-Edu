# 14.15 AI-Native Hyperlocal Logistics & Delivery Platform for SMEs — Requirements & Estimations

## Functional Requirements

### FR-01: Order Creation and Intake

The platform must allow SMEs to create delivery orders via mobile app, web dashboard, API integration, or WhatsApp bot. Each order specifies pickup address (auto-filled from merchant profile or manual entry with geocoding), drop-off address (geocoded with validation against serviceable area polygon), package category (document, small parcel, medium box, large/fragile), approximate weight bracket (0-1 kg, 1-5 kg, 5-15 kg, 15-30 kg), delivery urgency tier (express: 30 min, standard: 60 min, economy: 120 min, scheduled: specific time window), and any special handling instructions. The system must validate serviceability (pickup and drop-off within operational geofence), estimate pricing before confirmation, and return an order ID with preliminary ETA within 3 seconds of submission.

### FR-02: Intelligent Rider Matching

Upon order confirmation, the system must identify and assign the optimal rider within 45 seconds. The matching engine considers rider proximity to pickup (road-network distance, not Haversine), rider vehicle type compatibility (bike for documents and small parcels, three-wheeler for medium, mini-truck for large), current rider load (capacity remaining if mid-route), rider acceptance history for this merchant and package type, rider fatigue score (hours active, deliveries completed today), and time-window feasibility (can the rider reach pickup and complete delivery within the promised window). If the assigned rider rejects, the system must reassign within 15 seconds using pre-computed shadow assignments.

### FR-03: Multi-Stop Route Optimization

When a rider has multiple active orders (batched), the system must compute the optimal visit sequence minimizing total route time while respecting each order's time window constraints. The solver must handle insertion of new orders into active routes, removal of orders (cancellations), and dynamic re-routing when traffic conditions change significantly. The route must be re-optimized within 2 seconds of any triggering event.

### FR-04: Real-Time Tracking

Customers and SMEs must be able to track their delivery in real time on a map with rider position updates every 3-5 seconds. The tracking view shows current rider position, planned route overlay, live ETA countdown (updated every 30 seconds), and delivery status transitions (assigned → en route to pickup → at pickup → in transit → near drop-off → delivered). The system must support 50,000 concurrent tracking sessions per city during peak hours.

### FR-05: ETA Prediction and Management

The system must provide accurate ETAs at multiple lifecycle stages: at order creation (before rider assignment), at rider assignment (with specific rider context), at pickup completion (with actual pickup time and remaining route), and continuously during transit (updating as traffic and route conditions change). Customer-facing ETAs must achieve ≥ 90% on-time rate (delivery before stated ETA). The system must proactively notify customers if the ETA will be breached by more than 5 minutes.

### FR-06: Dynamic Pricing Engine

The platform must compute delivery fees dynamically based on distance, package type, urgency tier, current zone-level supply-demand ratio, weather conditions, and time of day. Prices must update at zone level every 5 minutes. The system must enforce maximum surge caps (2.5× base price), minimum rider earnings per delivery, and provide price estimates to SMEs before order confirmation. Price history and breakdowns must be available for SME transparency.

### FR-07: Proof of Delivery (POD)

Every delivery must generate verifiable proof: GPS coordinates at delivery location (within 50m of drop-off address), timestamp, and at least one of: delivery photo (AI-validated for package presence), recipient OTP verification (for high-value orders > $10), or digital signature. POD records must be immutable, stored for 180 days, and queryable for dispute resolution.

### FR-08: Demand Forecasting and Fleet Pre-Positioning

The system must predict order volumes per micro-zone (500m × 500m) at 15-minute intervals for the next 2 hours. Forecasts drive rider pre-positioning recommendations: the system must compute optimal idle-rider distribution across zones and issue repositioning nudges with incentive amounts. Forecast accuracy target: MAPE < 20% at zone level, < 10% at city level.

### FR-09: Delivery Analytics for SMEs

The platform must provide SMEs with a dashboard showing delivery performance metrics (on-time rate, average delivery time, cost per delivery), delivery heatmaps (where their customers are), cost optimization suggestions (batch-friendly time windows, pre-scheduling discounts), and historical trend analysis. Reports must be exportable and available via API for SMEs with integrated systems.

### FR-10: Returns and Reverse Logistics

The system must support return pickups from the original drop-off address back to the merchant. Return orders inherit the original order's package metadata, receive priority matching to riders already near the return pickup location, and maintain chain-of-custody linkage to the original forward delivery for reconciliation.

### FR-11: Multi-Vehicle Fleet Support

The platform must support heterogeneous vehicle types: bicycles (documents, small parcels, 0-3 km), motorcycles (parcels up to 5 kg, 0-10 km), three-wheelers (medium loads up to 20 kg, 0-15 km), and mini-trucks (bulk shipments up to 500 kg, 0-30 km). Matching and routing algorithms must respect vehicle-specific constraints: speed profiles, road access restrictions, load capacity, and fuel/range limitations.

### FR-12: Merchant Onboarding and Recurring Schedules

SMEs must be able to set up recurring delivery schedules (daily pickups at 10 AM, weekly bulk dispatches) that auto-generate orders. The system must learn from recurring patterns to pre-allocate rider capacity and offer volume discounts for predictable demand.

### FR-13: EV Fleet Management

The platform must support electric vehicles with range-aware routing: battery state-of-charge tracked per EV rider, assignments constrained by remaining range (order round-trip distance must not exceed 80% of remaining range), charging station waypoints insertable into routes, and real-time charging status monitoring. The system should prefer EV assignment for short-range deliveries to meet sustainability targets.

### FR-14: Carbon Footprint Tracking

Every delivery must compute and record its estimated carbon emission based on vehicle type, distance, load, and traffic conditions. SME dashboards display per-delivery and aggregate carbon metrics. Monthly sustainability reports support ESG compliance for enterprise customers.

---

## Out of Scope

- **Warehousing and inventory management**: The platform manages logistics, not inventory; SMEs manage their own stock.
- **Intra-city freight and trucking**: Focus is hyperlocal (< 30 km), not long-haul logistics.
- **Customer-to-customer (C2C) delivery**: Platform serves B2C (SME to their customer) and B2B (SME to SME) only.
- **Payment collection on delivery (COD facilitation)**: Platform delivers packages, does not handle payment collection for the merchant's goods.
- **Cold-chain and temperature-controlled delivery**: Specialized vertical requiring different infrastructure.
- **Autonomous drone delivery**: Regulatory approvals pending; architecture supports future integration but drone fleet management is out of current scope.

---

## Non-Functional Requirements

| NFR | Target | Rationale |
|---|---|---|
| **Order-to-Assignment Latency** | < 45 seconds (p95) | SMEs expect near-instant confirmation; longer waits drive drop-off |
| **ETA Accuracy** | ≥ 90% on-time rate | Platform's value proposition rests on reliable time promises |
| **Tracking Update Freshness** | < 5 seconds | Stale tracking destroys customer confidence and generates support calls |
| **System Availability** | 99.95% (26 min downtime/month) | Delivery is time-critical; outages mean missed deliveries and lost SME revenue |
| **Location Ingestion Throughput** | 500,000 updates/second per city | 10,000 active riders × 1 update/3 seconds × peak concurrency factor |
| **API Response Time** | < 200ms (p95) for all read APIs | Tracking, ETA, and status queries must feel instant on mobile |
| **Solver Latency** | < 2 seconds for route re-optimization | New orders inserted into active routes must not block rider progress |
| **Data Durability** | Zero order loss | Every confirmed order must be persisted before acknowledgment; event-sourced log as source of truth |
| **Horizontal Scalability** | Linear scaling per city addition | Adding a new city should not require re-architecture; geo-partitioned design |
| **Cost Efficiency** | < $0.003 platform compute cost per delivery | At $3 average delivery value, platform margins require extreme compute efficiency |
| **Recovery Time Objective** | < 30 seconds for matching engine | Matching is the critical path; extended outage means orders queue up with no rider assignment |
| **Recovery Point Objective** | Zero data loss for confirmed orders | Event-sourced log with synchronous replication; no committed order may be lost |

---

## Capacity Estimations

### Assumptions (Single Metro City — Tier 1 Indian City)

| Parameter | Value | Basis |
|---|---|---|
| Active SME merchants | 50,000 | Target market: small shops, restaurants, D2C brands, pharmacies |
| Orders per day | 500,000 | ~10 orders/day per active merchant average (high variance) |
| Peak hour concentration | 20% of daily orders in peak hour | 100,000 orders/hour = ~28 orders/second |
| Active riders (peak) | 15,000 | ~33 orders per rider per day (8-hour shift, ~25 min per delivery) |
| Concurrent tracking sessions (peak) | 50,000 | ~50% of in-transit orders have active tracking viewers |
| Average delivery distance | 5 km | Hyperlocal: 80% of orders within 7 km |
| Rider location update frequency | Every 3 seconds | GPS + network-based location |
| EV fleet proportion | 20% of two-wheeler fleet | Growing 5% per quarter toward 60% target |

### Throughput Calculations

| Metric | Calculation | Result |
|---|---|---|
| **Orders per second (peak)** | 100,000 / 3,600 | ~28 orders/sec |
| **Location updates per second** | 15,000 riders × (1/3 sec) | ~5,000 updates/sec |
| **Matching computations per second** | 28 orders × candidate evaluation (50 riders each) | ~1,400 scorer invocations/sec |
| **Route optimizations per minute** | 28 orders/sec × 60 sec × 30% batched requiring re-optimization | ~500 solver runs/min |
| **Tracking queries per second** | 50,000 sessions × 1 poll/5 sec | ~10,000 queries/sec |
| **ETA recomputations per minute** | 50,000 active deliveries × 1 recompute/30 sec | ~1,667 ETA computations/sec |
| **POD validations per second** | ~28 deliveries/sec × 80% photo POD | ~22 image validations/sec |
| **Geofence evaluations per second** | 5,000 updates/sec × ~10 geofences per update | ~50,000 point-in-circle checks/sec |

### Storage Calculations

| Data Type | Calculation | Daily Volume |
|---|---|---|
| **Order records** | 500,000 orders × 2 KB average | ~1 GB/day |
| **Location trail** | 5,000 updates/sec × 86,400 sec × 100 bytes | ~43 GB/day |
| **Route snapshots** | 500,000 orders × 3 snapshots × 500 bytes | ~750 MB/day |
| **POD artifacts** | 500,000 × 80% photo × 200 KB compressed | ~80 GB/day |
| **Event log** | ~2M events/day × 500 bytes | ~1 GB/day |
| **Demand forecast state** | 2,000 zones × 96 intervals × 200 bytes | ~38 MB/day |
| **Matching audit logs** | 500,000 orders × 1 KB decision context | ~500 MB/day |
| **ETA prediction logs** | 1,667/sec × 86,400 × 200 bytes | ~29 GB/day |
| **Total daily (one city)** | Sum | ~155 GB/day |
| **Monthly (one city)** | 155 × 30 | ~4.7 TB/month |
| **10-city deployment** | 4.7 × 10 | ~47 TB/month |

### Bandwidth Calculations

| Flow | Calculation | Bandwidth |
|---|---|---|
| **Location ingestion** | 5,000 updates/sec × 100 bytes | ~500 KB/sec (0.5 MB/s) |
| **Tracking responses** | 10,000 queries/sec × 500 bytes | ~5 MB/sec |
| **POD photo uploads** | ~7 photos/sec × 200 KB | ~1.4 MB/sec |
| **Map tile serving** | 50,000 sessions × 50 KB/10 sec | ~250 MB/sec (CDN-served) |
| **WebSocket tracking push** | 50,000 sessions × 100 bytes/3 sec | ~1.7 MB/sec |
| **Total ingress (per city)** | Location + POD + orders | ~3 MB/sec |
| **Total egress (per city)** | Tracking + maps + notifications | ~260 MB/sec |

---

## SLO Dashboard

| SLO | Target | Measurement | Alert Threshold |
|---|---|---|---|
| **Order Confirmation Latency** | p95 < 3 seconds | Time from order submit to confirmed state | p95 > 4 sec for 5 min |
| **Rider Assignment Latency** | p95 < 45 seconds | Time from confirmed to rider-assigned state | p95 > 60 sec for 5 min |
| **On-Time Delivery Rate** | ≥ 90% | Deliveries completed before customer-facing ETA | < 85% over rolling 1 hour |
| **ETA Accuracy (MAE)** | < 4 minutes | Mean absolute error of final ETA vs. actual delivery time | MAE > 6 min over rolling 1 hour |
| **Tracking Freshness** | p95 < 5 seconds | Age of rider position shown to tracking viewer | p95 > 8 sec for 3 min |
| **Rider Acceptance Rate** | ≥ 80% | First-offer acceptance rate | < 70% over rolling 30 min (pricing/matching issue) |
| **System Availability** | 99.95% | Successful API responses / total requests | Error rate > 0.1% for 5 min |
| **Solver Latency** | p95 < 2 seconds | Route optimization computation time | p95 > 3 sec for 5 min |
| **Dead Mile Ratio** | < 15% | (Rider distance without package) / total rider distance | > 20% over rolling 1 hour |
| **Batch Utilization** | ≥ 40% of eligible orders | Orders delivered as part of multi-stop batch | < 30% over rolling 2 hours |
| **POD Validation Latency** | p95 < 10 seconds | Time from photo upload to validation result | p95 > 15 sec for 5 min |

---

## SLO Error Budgets

| SLO | Monthly Budget | Burn Rate Alert | Calculation |
|---|---|---|---|
| **Availability (99.95%)** | 21.6 minutes downtime | Fast burn: > 5× budget rate for 5 min | 43,200 min × 0.0005 = 21.6 min |
| **On-Time Rate (90%)** | 50,000 late deliveries / 500K daily × 30 days | Fast burn: > 3× budget rate for 1 hour | 15M orders × 10% = 1.5M late budget |
| **Assignment Latency (p95 < 45s)** | 5% of orders may exceed 45s | Fast burn: > 10% exceeding for 15 min | 750K orders/day × 5% = 37.5K slow assignments |
| **ETA Accuracy (MAE < 4min)** | Absorb up to 4-min average error | Slow burn: MAE trending > 5 min over 6 hours | MAE measured as rolling 1-hour aggregate |
| **Tracking Freshness (p95 < 5s)** | 5% of updates may be > 5s stale | Fast burn: > 10% stale for 3 min | Total updates × 5% = stale budget |

**Error Budget Policy**: When a fast-burn alert fires (budget consumed at > 6× normal rate), the on-call freezes all non-critical deployments. When 50% of monthly budget is consumed, the engineering team redirects to reliability work. When 80% is consumed, a formal incident review is triggered regardless of customer impact.

---

## Hardware & Infrastructure Cost Model

### Per-City Compute (Tier 1 Indian Metro)

| Component | Instance Type | Count | Monthly Cost (USD) |
|---|---|---|---|
| **API Gateway + Load Balancer** | 4 vCPU, 8 GB RAM | 3 (active-active) | $180 |
| **Order Service** | 4 vCPU, 16 GB RAM | 4 | $320 |
| **Matching Engine** | 8 vCPU, 32 GB RAM | 2 (active-passive) | $480 |
| **Route Optimizer** | 8 vCPU, 16 GB RAM | 6 (worker pool) | $720 |
| **ETA Engine** | 4 vCPU, 16 GB RAM | 3 | $240 |
| **Location Ingestion** | 4 vCPU, 8 GB RAM | 4 | $240 |
| **Tracking Engine (WebSocket)** | 4 vCPU, 16 GB RAM | 6 | $480 |
| **Demand Forecaster (GPU)** | 4 vCPU, 16 GB RAM, 1 GPU | 1 | $350 |
| **Geospatial Index** | 8 vCPU, 64 GB RAM | 2 (primary + replica) | $640 |
| **Stream Processor** | 4 vCPU, 16 GB RAM | 4 | $320 |
| **POD Validation (ML)** | 4 vCPU, 8 GB RAM, 1 GPU | 1 | $250 |
| **Compute subtotal per city** | | 36 instances | ~$4,220/month |

### Per-City Storage

| Component | Specification | Monthly Cost (USD) |
|---|---|---|
| **Order DB (relational)** | 500 GB SSD, replicated | $200 |
| **Event Stream** | 1 TB, 7-day retention | $150 |
| **Time-Series Store** | 2 TB, 90-day hot | $300 |
| **Geospatial Cache** | 64 GB in-memory | included in compute |
| **Object Storage (POD photos)** | 2.4 TB/month (80 GB/day × 30) | $60 |
| **Cold Archive** | 10 TB tiered storage | $50 |
| **Storage subtotal per city** | | ~$760/month |

### Platform-Wide Shared Services

| Component | Monthly Cost (USD) |
|---|---|
| **CDN (map tiles, static assets)** | $500 |
| **Notification gateway (SMS, push, WhatsApp)** | $3,000 (volume-based) |
| **Monitoring and observability stack** | $800 |
| **CI/CD and model registry** | $300 |
| **DNS, certificates, security** | $200 |
| **Shared services subtotal** | ~$4,800/month |

### Total Cost at Scale

| Scale | Cities | Monthly Compute + Storage | Shared Services | Total | Cost per Delivery |
|---|---|---|---|---|---|
| **Launch** | 1 | $4,980 | $4,800 | $9,780 | $0.0007 |
| **Year 1** | 5 | $24,900 | $6,000 | $30,900 | $0.0021 |
| **Year 2** | 15 | $74,700 | $10,000 | $84,700 | $0.0009 |
| **Year 3** | 30 | $149,400 | $18,000 | $167,400 | $0.0006 |

**Key insight**: Per-delivery compute cost decreases with scale due to shared infrastructure amortization and higher utilization. At 30-city scale, the $0.0006/delivery cost is well under the $0.003 target, leaving margin for model complexity increases and redundancy improvements.

---

## Derived Design Constraints

The capacity estimations above impose hard constraints on architectural decisions:

| Constraint | Derived From | Implication |
|---|---|---|
| **Matching engine must be in-memory** | 28 orders/sec × 50 candidates = 1,400 scorer invocations/sec | Disk-based scoring is too slow; candidate data and scoring models must fit in RAM |
| **Location pipeline must fan-out, not chain** | 5,000 updates/sec serving 4 consumers (index, time-series, geofence, tracking) | Sequential processing would add 4× latency; fan-out must be parallel with independent failure domains |
| **Geospatial index must be city-scoped** | Cross-city queries never occur for real-time operations | Global index wastes memory on irrelevant data and creates unnecessary coordination overhead |
| **POD storage must be tiered** | 80 GB/day of photos; 180-day retention = 14.4 TB per city | Hot storage for first 30 days (dispute resolution window); cold archive after |
| **Event stream must be partitioned by city** | Consumer groups are city-scoped; cross-city replay never needed | City-level partitioning enables independent scaling, compaction, and retention policies |
| **WebSocket connections require sticky sessions** | 50,000 concurrent tracking sessions per city | Connection migration on rebalance would cause tracking interruptions; sticky routing with connection draining on deploys |
| **ML model inference must be async for non-critical paths** | GPU resources shared across demand forecaster, POD validator, anomaly detector | Only ETA prediction is latency-critical (inline); demand forecasting and POD validation tolerate 1-5 second latency |

---

## Operational SLA Contracts

Beyond technical SLOs (measured internally), the platform maintains contractual SLAs with SME customers:

| SLA Tier | SME Plan | Commitment | Breach Penalty |
|---|---|---|---|
| **Enterprise** | Top 100 merchants by volume | 95% on-time rate, < 35s assignment, 24/7 support | Per-delivery credit for late deliveries (capped at 50% of monthly invoice) |
| **Business** | Mid-tier merchants (50-200 orders/day) | 90% on-time rate, < 45s assignment, business-hours support | Monthly credit when aggregate on-time drops below threshold |
| **Starter** | Small merchants (< 50 orders/day) | 85% on-time rate, best-effort assignment, email support | No contractual penalty; SLO monitored for platform health only |

### SLA Measurement Methodology

- On-time rate is measured at the customer-facing ETA set at the moment of rider assignment (not the preliminary ETA at order creation)
- Assignment latency excludes order confirmation time (SME's delay in clicking "Confirm" is not platform latency)
- SLA windows exclude declared force majeure events (extreme weather, city-wide power outage, government-imposed curfew) documented via platform-wide incident notification
- SLA reports are generated monthly and shared with Enterprise and Business tier merchants via their analytics dashboard

### Multi-City Scale Testing Requirements

Before launching a new city, the platform must validate:

| Test | Method | Pass Criteria |
|---|---|---|
| **Matching at target load** | Synthetic order injection at 28 orders/sec for 1 hour | p95 assignment < 45s; zero order loss |
| **Location pipeline at target throughput** | Replay 5,000 GPS streams from existing city | Consumer lag < 5s; geofence triggers within 1s of entry |
| **ETA model cold-start accuracy** | 100 real deliveries with transfer-learned model | MAE < 8 min (relaxed from 4 min for mature cities) |
| **Tracking WebSocket capacity** | 50,000 concurrent connections with position updates | p95 push latency < 3s; zero dropped connections |
| **Failover recovery** | Kill matching engine primary; verify passive promotes | Recovery < 5s; stranded orders recovered < 35s total |
| **Payment flow end-to-end** | Place 100 orders through full lifecycle including payout | Zero financial discrepancies; rider payouts match expected |
