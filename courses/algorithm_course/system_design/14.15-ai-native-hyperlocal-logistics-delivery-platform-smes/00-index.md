# 14.15 AI-Native Hyperlocal Logistics & Delivery Platform for SMEs

## System Overview

An AI-native hyperlocal logistics and delivery platform for SMEs is a system that replaces the traditional model of SME logistics—calling local courier contacts, negotiating per-delivery rates, manually tracking packages via WhatsApp messages, and hoping riders show up on time—with an intelligent, real-time marketplace where a small business owner places a pickup request describing package dimensions, weight category, and delivery urgency, and the platform instantly matches the request to the optimal available rider within a 3-km radius using a multi-objective scoring model that simultaneously optimizes for rider proximity (minimizing dead miles), rider capacity (weight and volume compatibility), delivery time window feasibility (route-time estimation against the promised ETA), rider historical performance for this package type, and overall fleet utilization across the zone—producing a confirmed assignment with a binding ETA within 45 seconds of request submission. Unlike traditional courier services (where an SME books a pickup slot hours in advance, a dispatcher manually assigns riders each morning, routes are fixed daily circuits, and tracking means calling the rider's phone) or even first-generation aggregator platforms (which digitized booking but still used rule-based FIFO (First-In-First-Out, like a line at a store) dispatch, static zone pricing, and periodic location polling), the AI-native platform treats every dimension of the delivery lifecycle as an optimization surface: demand prediction models forecast order volumes per micro-zone (500m × 500m grid cells) at 15-minute intervals to pre-position riders before demand materializes; dynamic pricing algorithms adjust delivery fees every 5 minutes per zone based on the real-time supply-demand ratio, weather conditions, and traffic state; route optimization engines solve capacitated vehicle routing problems with time windows (CVRPTW) for multi-stop batched deliveries, re-optimizing on every new order insertion; and ETA prediction models combine road-network graph traversal with learned rider behavior patterns (acceleration profiles, intersection wait distributions, building entry times) to produce ETAs with ±2-minute accuracy at the 90th percentile. The core engineering tension is that the platform must simultaneously handle the real-time nature of hyperlocal delivery (sub-minute matching decisions, 3-second location update frequencies from thousands of concurrent riders, dynamic re-routing as new orders arrive mid-route) while managing the economic constraints specific to SME logistics (average delivery values of $2-5 require ultra-lean operational costs where the platform's per-delivery compute cost must stay below $0.003, rider earnings must exceed $1.50/delivery to maintain supply, and the SME's total delivery cost must undercut their previous informal arrangements by at least 20% to drive adoption), all while solving NP-hard optimization problems (vehicle routing, fleet positioning, batch assignment) fast enough to feel instant to the user—which means deploying approximation algorithms and heuristics that trade optimality for latency, then continuously measuring the optimality gap to know exactly how much money the approximation is leaving on the table.

---

## Autonomy Classification

**Tier: C — AI-Gated Action**

This is an **AI-gated action system** where AI interprets, generates, classifies, and executes within pre-approved policy boundaries. Actions outside those boundaries are escalated to human agents. All AI-initiated actions are logged, auditable, and reversible. AI optimizes delivery routes and dispatches riders within zone and SLA boundaries, with dispatchers overriding critical assignments.

| Boundary | AI Role | Human/System Authority |
|----------|---------|----------------------|
| **System of Record** | Platform state managed by transactional services; AI writes through validated APIs only | Transactional service layer |
| **System of Intelligence** | Interpretation, generation, classification, and decision-making within policy guardrails | AI engine with policy constraints |
| **Action Boundary** | Executes autonomously within pre-approved boundaries; escalates outside them | Policy engine + escalation rules |
| **Human Override** | Dispatchers override AI routing for priority deliveries; riders can flag route issues for re-optimization | Domain expert |
| **Rollback Path** | All AI-initiated actions logged with full context; compensation transactions defined for every write path | Audit trail + compensation flows |

---


## Key Characteristics

| Characteristic | Description |
|---|---|
| **Architecture Style** | Event-driven microservices with geospatially partitioned processing; CQRS for order lifecycle (write-optimized command path for real-time dispatch, read-optimized query path for tracking and analytics); stream processing for location ingestion; solver-as-a-service pattern for routing optimization; edge computing at city level for latency-critical matching |
| **Core Abstraction** | The *delivery graph*: a continuously updating weighted directed graph where nodes are locations (pickup points, drop-off points, rider current positions, pre-positioning waypoints) and edges are road segments with time-varying traversal costs (derived from real-time traffic, historical patterns, and weather adjustments)—every matching, routing, and ETA computation is a query against this graph |
| **Demand Prediction** | Spatio-temporal forecasting using graph neural networks on micro-zone grids: predicts order volume per 500m cell per 15-minute slot using features including historical patterns, day-of-week, weather, local events, merchant promotional calendars, and festival seasonality; output drives pre-positioning and dynamic pricing |
| **Rider Matching Engine** | Multi-objective optimization combining proximity score, capacity compatibility, time-window feasibility, rider fatigue index, earnings fairness score, and predicted acceptance probability into a single ranking; batch matching accumulates orders over 30-second windows and solves bipartite assignment globally rather than greedy sequential dispatch |
| **Route Optimization** | Capacitated Vehicle Routing Problem with Time Windows (CVRPTW) solved via hybrid approach: construction Practical rule of thumb (nearest-neighbor with regret insertion) produces initial solution in <100ms, then local search metaheuristic (adaptive large neighborhood search) improves it for up to 2 seconds; re-optimization triggered on each new order insertion |
| **ETA Prediction** | Ensemble model combining graph-based shortest-path traversal times, learned rider-specific speed profiles, intersection delay distributions, building access time estimates, and real-time traffic adjustment factors; produces probabilistic ETAs (median + 90th percentile) rather than point estimates |
| **Dynamic Pricing** | Zone-level price multipliers updated every 5 minutes based on supply-demand ratio, weather impact factor, time-of-day demand curve, and competitive price signals; constrained by maximum multiplier caps (2.5×) and minimum rider earnings floor; SME-facing prices smoothed with 15-minute moving average to avoid sticker shock |
| **EV Fleet Integration** | Mixed-fleet management supporting electric two-wheelers and three-wheelers alongside ICE vehicles; range-aware routing that factors battery state-of-charge into assignment feasibility; charging station integration for mid-shift top-ups; carbon footprint tracking per delivery |
| **Multi-Modal Delivery** | Hub-and-spoke micro-fulfillment combining trunk routes (larger vehicles between micro-hubs) with last-meter delivery (bikes/walkers for final 1 km); dynamic mode selection based on package characteristics, urgency, and current fleet availability |
| **Proof of Delivery** | Multi-signal verification combining GPS proximity, timestamped photos (AI-validated for package and address consistency), OTP for high-value orders, and digital signature for B2B; immutable evidence chain stored for dispute resolution |
| **Return-Trip Optimization** | After completing a drop-off, the system immediately evaluates nearby pending pickups to chain orders without dead-mile gaps; return-trip matching reduces idle travel by 20-30% and is the most capital-efficient optimization after batching |

---

## Quick Navigation

| Document | Focus |
|---|---|
| [01 — Requirements & Estimations](./01-requirements-and-estimations.md) | Functional requirements, capacity math, SLOs, error budgets, hardware cost |
| [02 — High-Level Design](./02-high-level-design.md) | System architecture, data flows, ADRs, case studies |
| [03 — Low-Level Design](./03-low-level-design.md) | Data models, API contracts, core algorithms, state machines |
| [04 — Deep Dives & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Failure modes, race conditions, bottlenecks, edge cases |
| [05 — Scalability & Reliability](./05-scalability-and-reliability.md) | Multi-region, back-pressure, DR RPO/RTO, chaos experiments |
| [06 — Security & Compliance](./06-security-and-compliance.md) | Threat model, rider safety, gig worker regulations, compliance |
| [07 — Observability](./07-observability.md) | SLO dashboards, incident playbooks, delivery metrics |
| [08 — Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, scoring rubric |
| [09 — Insights](./09-insights.md) | 12 non-obvious architectural insights |

---

## Industry Reference Platforms

| Platform | Region | Key Innovation | Architectural Lesson |
|---|---|---|---|
| **Porter** | India | Intra-city logistics marketplace; truck, bike, and auto-rickshaw fleet; real-time pricing | Mixed-fleet matching must handle vehicles with 100× capacity difference; pricing cannot be one-size-fits-all |
| **Dunzo** | India | General-purpose hyperlocal delivery; multi-category (groceries, packages, food); B2C and B2B | Multi-category matching adds package-vehicle compatibility constraints; a grocery order and a furniture delivery have fundamentally different routing |
| **Lalamove** | Southeast Asia | Same-day delivery across 11 countries; API-first for business integration | Multi-country platform requires per-country pricing, compliance, and road-network models; API integration is the primary SME channel |
| **Borzo** | India/LATAM | Budget courier service; ultra-low-cost deliveries for SMEs | Sub-$2 delivery economics require extreme compute efficiency; batching is not optional, it is existential |
| **Shadowfax** | India | B2B logistics; warehouse-to-store and e-commerce last-mile | Scheduled B2B deliveries allow overnight VRP optimization; hybrid scheduled + on-demand fleet management |
| **GoGoX** | Asia-Pacific | On-demand freight and delivery; van and truck fleet | Large-vehicle routing has different constraints: loading dock access, parking restrictions, time-of-day entry bans |

---

## Architecture Evolution Roadmap

| Phase | Capabilities | Architecture Changes |
|---|---|---|
| **V1 — MVP (0-6 months)** | Single city, greedy dispatch, fixed pricing, basic tracking | Monolithic service with embedded matching; single database; polling-based tracking |
| **V2 — Optimization (6-18 months)** | Batch matching, dynamic pricing, multi-stop routing, WebSocket tracking | Extract matching engine and route optimizer as separate services; add geospatial index; CQRS split |
| **V3 — Multi-City (18-36 months)** | Geo-partitioned processing, demand forecasting, fleet pre-positioning, EV integration | Event-driven architecture; city-as-deployment-unit; ML model serving infrastructure; EV fleet management layer |
| **V4 — Platform (36+ months)** | API marketplace for SME integrations, white-label delivery, cross-city analytics, autonomous delivery readiness | API gateway with tenant isolation; analytics data lake; model registry; extensible vehicle type framework for future autonomous integration |

### Architecture Decision Log Summary

| Decision | What Was Chosen | What Was Rejected | Why |
|---|---|---|---|
| Processing boundary | City-level partitioning | Global cluster | Zero cross-city interaction for real-time operations; blast radius isolation |
| Matching strategy | 30-second batch + bipartite optimization | Greedy nearest-rider dispatch | 15-25% reduction in total fleet dead miles justifies 30s latency |
| Order state management | Event-sourced with materialized views | Traditional CRUD with state column | Complete audit trail; replay for analytics; natural stream integration |
| ETA representation | Probability distribution (p50, p85, p95) | Single point estimate | Enables calibrated promises, rider targets, and SLO monitoring independently |
| Distance computation | Contraction hierarchy + speed overlay | Dijkstra on raw graph | 1000× faster (< 1ms vs. 5-50ms), essential for cost matrix construction in batch window |
| EV integration | Secondary optimizer alongside matching | Unified matching with range constraint | Separating concerns keeps matching engine fast; EV scheduling is a planning problem, not a matching problem |
| Fleet positioning | Demand-forecast-driven + exploration budget | Reactive (only position when supply deficit detected) | Forecast-driven reduces dead miles 20-30%; exploration budget breaks latent demand blind spots |

---

## Related Patterns

| System | Relationship | Link |
|---|---|---|
| **AI-Native Logistics & Supply Chain Platform** | Parent domain — hyperlocal delivery is the last-mile component of broader supply chain; shares demand forecasting patterns and fleet optimization techniques | [View](../13.2-ai-native-logistics-supply-chain-platform/00-index.md) |
| **Distributed Rate Limiter** | Core pattern — order intake rate limiting, tracking poll throttling, and location update throttling all use token-bucket rate limiters at the geo-partition boundary | [View](../1.1-distributed-rate-limiter/00-index.md) |
| **AI-Native Real Estate PropTech Platform** | Shared pattern — geospatial indexing and micro-zone modeling for property valuation mirrors the delivery zone partitioning and spatial query patterns used in rider matching | [View](../13.4-ai-native-real-estate-proptech-platform/00-index.md) |
| **AI-Native Digital Storefront Builder for SMEs** | Integration partner — SME storefronts generate delivery orders via API; order volume patterns, catalog data, and promotional schedules feed demand forecasting models | [View](../14.11-ai-native-digital-storefront-builder-smes/00-index.md) |
| **AI-Native Mobile Money Super App Platform** | Payment integration — rider payouts, merchant billing, and COD settlement flow through mobile money rails; real-time settlement reduces working capital pressure on gig workers | [View](../14.19-ai-native-mobile-money-super-app-platform/00-index.md) |
| **Distributed Tracing System** | Observability backbone — order lifecycle traces spanning 10+ services require distributed tracing with geospatial context propagation for root-cause analysis | [View](../15.2-distributed-tracing-system/00-index.md) |
| **AI-Native Field Service Management for SMEs** | Shared dispatching pattern — field technician scheduling and route optimization share the CVRPTW solver architecture, though with longer service windows and fewer concurrent jobs | [View](../14.12-ai-native-field-service-management-smes/00-index.md) |
| **AI-Native Energy Grid Management Platform** | Analogous real-time optimization — grid load balancing mirrors fleet supply-demand balancing: both solve continuous optimization with physical-world lag between decision and effect | [View](../13.3-ai-native-energy-grid-management-platform/00-index.md) |
| **AI-Native Marketplace Platform** | Shared marketplace economics — two-sided marketplace dynamics (rider supply, merchant demand) parallel buyer-seller matching; rating systems and trust scoring face similar cold-start and gaming challenges | [View](../12.18-marketplace-platform/00-index.md) |

---

## What Differentiates Naive vs. Production

| Dimension | Naive Approach | Production Reality |
|---|---|---|
| **Rider Matching** | Assign nearest available rider using Haversine distance; FIFO (First-In-First-Out, like a line at a store) queue when multiple orders arrive simultaneously | Batch-accumulate orders over 30-second windows; solve bipartite assignment optimizing total system cost (dead miles + delivery time + rider fairness + acceptance probability); re-solve when rejections occur; maintain shadow assignments for instant failover |
| **Route Planning** | Single pickup → single drop-off; rider gets one order at a time; no multi-stop optimization | CVRPTW solver batches 2-4 compatible orders per rider trip; insertion Practical rule of thumb evaluates every feasible insertion point for new orders into active routes; re-optimization balances detour cost against batch economics (30% cost reduction per delivery when batching 3 orders vs. single) |
| **ETA Prediction** | Distance ÷ average speed = ETA; same model for all times of day and all riders | Ensemble of road-network graph traversal (segment-level speed from real-time traffic), rider-specific learned speed profiles (some riders are 15% faster on bikes in congested zones), probabilistic intersection delay model, building access time estimator (apartment complexes add 3-7 minutes); output is a confidence interval, not a point estimate |
| **Demand Forecasting** | Use yesterday's order count as today's forecast; uniform distribution across the city | Spatio-temporal graph neural network on 500m micro-zones at 15-minute granularity; features include historical demand curves, weather API data, event calendars, merchant promotional schedules, and festival multipliers; produces zone-level forecasts with confidence intervals driving pre-positioning decisions |
| **Dynamic Pricing** | Fixed price per km; surge multiplier when "too many orders" (manual threshold) | Continuous optimization: zone-level supply-demand ratio computed every 5 minutes; price elasticity model predicts demand response to price changes; rider earnings model predicts supply response; optimizer finds the price point that maximizes completed deliveries (not revenue) subject to rider earnings floor and SME price ceiling constraints |
| **Location Tracking** | Poll rider location every 30 seconds; store latest position only; show on map with stale data | Rider app pushes location every 3 seconds via persistent connection; stream processor geofences every update against active delivery waypoints; predictive interpolation fills gaps for smooth map rendering; historical trajectory stored for route analytics and ETA model training |
| **Proof of Delivery** | Rider marks "delivered" in app; no verification; disputes resolved by calling rider | Photo capture at delivery (AI validates: is it a package? is the background consistent with the address?); OTP verification for high-value packages; geofence confirmation (rider GPS within 50m of drop-off); digital signature for B2B deliveries; evidence chain stored for 90 days for dispute resolution |
| **Fleet Positioning** | Riders wait at a fixed hub; dispatch sends them across the city as orders come in; 40% of ride time is dead miles | Predictive pre-positioning: demand forecast drives optimal rider distribution across micro-zones; repositioning nudges sent to idle riders with small incentive payments; target dead-mile ratio < 15%; continuous rebalancing as demand patterns shift through the day |
| **Fleet Composition** | Single vehicle type (motorcycles); no consideration of package-vehicle fit or environmental impact | Heterogeneous fleet with bicycles, e-bikes, motorcycles, three-wheelers, and mini-trucks; matching considers vehicle capacity, speed profile, road access, range (for EVs), and carbon cost; EV-first assignment for short-range deliveries to meet sustainability targets |

---

## What Makes This System Unique

### The Delivery Graph Is a Living, Breathing Data Structure That Changes Faster Than You Can Query It

Unlike social graphs (which change on human timescales—friendships form over days, not seconds) or product catalogs (which update on business timescales—prices change daily, not per-second), the delivery graph is in constant flux at machine speed: rider positions update every 3 seconds (1,000 riders = 333 updates/second just for one city), road segment traversal costs change with traffic conditions every few minutes, new orders insert pickup and drop-off nodes continuously, and completed deliveries remove nodes and free rider capacity. Every matching decision, every ETA computation, and every route optimization is a query against a graph that has materially changed since the last query executed. The production system handles this by maintaining the graph in a specialized in-memory geospatial index (not a traditional graph database, which cannot handle this update frequency) with copy-on-write semantics: each solver query gets a consistent snapshot of the graph at query time, while concurrent updates build the next version. The index uses geohash-partitioned segments so that a matching query for a specific zone only needs to lock and snapshot a small portion of the graph. This design means the system is always computing against slightly-stale data (typically 1-3 seconds old), and every algorithm must be robust to this staleness—which is why probabilistic models and confidence intervals are essential throughout the system.

### Batching Economics Create a Three-Way Tension Between Speed, Cost, and Fairness

The single most impactful optimization in hyperlocal delivery is order batching: assigning multiple compatible orders to a single rider trip. A rider delivering 3 batched orders costs roughly the same in rider pay as delivering 1 order (slightly more for additional stops, but fixed costs like dead miles and idle time are amortized), cutting per-delivery cost by ~30-40%. But batching introduces a fundamental three-way tension. **Speed**: every order added to a batch increases the delivery time for earlier orders in the batch (the first order waits while the rider picks up the second and third); SMEs promised 45-minute delivery now get 60 minutes. **Cost**: not batching means 3× the rider cost, making the economics unviable for $3 average delivery values. **Fairness**: if the system always batches, merchants who need urgent delivery subsidize merchants who are flexible, but there is no mechanism for urgency to be expressed in the current pricing model. The production system resolves this by making batching an explicit economic choice: orders have a "batch tolerance" parameter (set by the SME at order creation: "express" = no batching at 1.8× price, "standard" = batch-2 at 1× price, "economy" = batch-3+ at 0.7× price), and the batch assignment solver maximizes total system utility (sum of delivery value minus delay cost minus rider cost) subject to each order's tolerance constraint. This transforms batching from a hidden system optimization into a transparent pricing lever that SMEs understand and can control.

### ETA Is a Promise, Not a Prediction—and Breaking Promises Has Asymmetric Costs

Most system design discussions treat ETA as a prediction accuracy problem: minimize |actual_time - predicted_time|. But in production hyperlocal delivery, ETA is a contractual promise that creates downstream dependencies. The SME tells their customer "your order will arrive by 2:30 PM." The customer schedules their day around that promise. If the delivery arrives at 2:25 PM (5 minutes early), the customer is delighted. If it arrives at 2:35 PM (5 minutes late), the customer calls the SME to complain, the SME calls the platform's support line, the support agent has no good answer, and the SME's trust in the platform erodes. This asymmetry—early is fine, late is catastrophic—means the optimal ETA is not the most accurate prediction but rather a carefully chosen percentile of the prediction distribution. The production system generates a full probability distribution of delivery times (using the ensemble model described above) and selects the customer-facing ETA at the 85th percentile (85% chance of arriving before the stated time), while the rider-facing target is set at the 50th percentile (the actual expected arrival). The 35-percentile gap is the "promise buffer" that absorbs normal variance. The system monitors the actual on-time rate (deliveries arriving before the customer-facing ETA) and dynamically adjusts the percentile selection: if the on-time rate drops below 90%, the percentile is bumped to 90th; if it exceeds 97% (meaning promises are too conservative and the platform appears slow), it's reduced to 80th.

### The Dead-Mile Tax Is the Platform's Hidden P&L Killer

Every meter a rider travels without carrying a package is pure cost—rider pay accrues, vehicle wear accumulates, but no revenue is generated. This "dead-mile tax" is the single largest controllable cost for the platform. In a naive system with greedy dispatch, dead miles consume 35-40% of total rider distance. The production platform attacks dead miles from four directions simultaneously: (1) **pre-positioning** moves idle riders toward predicted demand before orders arrive, reducing pickup distance; (2) **batch matching** with global optimization minimizes total fleet dead miles rather than per-order dead miles; (3) **return-trip matching** assigns new orders to riders completing a delivery near the new pickup, chaining orders without dead-mile gaps; (4) **scheduled order pre-commitment** allocates riders to recurring routes (bakery → café every morning) with zero dead miles after the first trip. The dead-mile ratio is the single metric most predictive of platform unit economics—every percentage point reduction translates directly to margin improvement.

### Physical-World Feedback Loops Are Slower Than Software Feedback Loops

Unlike pure software systems where feedback is near-instant (a cache miss is detected in microseconds, a failed request is retried in milliseconds), hyperlocal delivery operates on physical-world timescales. A pricing decision made at 2:00 PM affects rider supply at 2:15 PM (riders need time to see the surge and physically travel). A pre-positioning nudge at 2:00 PM produces a rider in the target zone at 2:10 PM. A demand forecast error at 2:00 PM is not observable until 2:30 PM when deliveries start arriving late. This temporal lag between action and observable effect means that naive reactive control loops (observe → act → observe effect → adjust) oscillate: the system corrects an imbalance, but the correction's effect is delayed, so the system over-corrects, then observes the over-correction and swings back. The production system uses predictive control: every decision incorporates a forward-looking model of the expected system state at the time the decision's effect will be felt, not the current state. This model-predictive control approach—borrowed from process control engineering—is what prevents the pricing oscillation, fleet repositioning overshoot, and batch window sizing instability that plague reactive designs.

---

## Glossary of Domain-Specific Terms

| Term | Definition |
|---|---|
| **Dead miles** | Distance a rider travels without carrying any package — pure cost with zero revenue |
| **Batch window** | Fixed time interval (30 seconds) during which orders accumulate before the matching engine solves the assignment globally |
| **Shadow assignment** | Pre-computed second-best rider for each order, enabling instant failover when the primary rider rejects |
| **Contraction hierarchy** | A pre-processed road-network data structure that enables sub-millisecond shortest-path queries by hierarchically contracting low-importance nodes |
| **CVRPTW** | Capacitated Vehicle Routing Problem with Time Windows — the NP-hard optimization problem underlying multi-stop route planning with load and deadline constraints |
| **ALNS** | Adaptive Large Neighborhood Search — a metaheuristic that iteratively destroys and repairs portions of a route solution, adapting operator selection based on past success rates |
| **Promise buffer** | The gap between the rider-facing ETA (p50) and the customer-facing ETA (p85) that absorbs delivery time variance without breaking the customer promise |
| **Micro-zone** | A 500m × 500m geographic cell used as the spatial unit for demand forecasting, pricing, and fleet positioning |
| **Geohash** | A hierarchical spatial indexing scheme that encodes geographic coordinates into a short string, enabling fast proximity searches via prefix matching |
| **Dwell time** | Time spent by the rider at a pickup or drop-off location — includes waiting for the merchant, navigating inside buildings, and completing handover |
| **SOC** | State of Charge — the remaining battery capacity of an electric vehicle, expressed as a percentage of full charge |
| **Latent demand** | Orders that would have been placed but were not, because the platform historically lacked rider coverage in a zone — estimated via proxy signals to prevent self-reinforcing under-service |
| **Model-predictive control** | A control strategy that uses a forward-looking model of system state to make decisions, rather than reacting only to current observations — prevents oscillation in systems with delayed feedback |
| **Return-trip matching** | Assigning a new pickup order to a rider who is about to complete a drop-off nearby — eliminates dead miles between consecutive deliveries by treating "about to become idle" riders as candidates |
| **Batch tolerance** | An SME-facing order parameter (express / standard / economy) that controls whether the order may be batched with others — transforms batching from a hidden system optimization into an explicit pricing lever |
| **Surge multiplier** | A zone-level price modifier updated every 5 minutes based on supply-demand ratio, weather, and forward-looking demand — capped at 2.5× to prevent price shock |
| **Copy-on-write snapshot** | A concurrency technique where each solver query receives a frozen copy of the geospatial index, while concurrent updates build the next version — ensures consistent reads without blocking writes |
| **Hungarian algorithm** | An O(n³) algorithm for solving the assignment problem (bipartite matching) optimally — used as a reference baseline, though the production system uses auction-based algorithms for better parallelism on sparse matrices |
