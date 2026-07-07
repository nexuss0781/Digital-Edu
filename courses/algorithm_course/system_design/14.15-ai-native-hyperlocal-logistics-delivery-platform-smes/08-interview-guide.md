# 14.15 AI-Native Hyperlocal Logistics & Delivery Platform for SMEs — Interview Guide

## Interview Format: 45-Minute System Design

### Pacing Guide

| Phase | Time | Focus | Signals to Watch |
|---|---|---|---|
| **Problem Exploration** | 0-7 min | Clarify scope, identify core challenges, discuss use cases | Does the candidate recognize the real-time nature? Do they ask about SME-specific constraints (low delivery values, cost sensitivity)? |
| **High-Level Design** | 7-20 min | Architecture, major components, data flow | Do they separate real-time path from analytical path? Do they think about geo-partitioning early? |
| **Deep Dive** | 20-37 min | Matching algorithm, route optimization, ETA prediction (pick 1-2) | Can they articulate why greedy matching fails? Do they recognize the NP-hard nature of VRP? |
| **Scalability & Trade-offs** | 37-43 min | Location pipeline scale, batching trade-offs, failure modes | Do they consider the GPS update firehose? Can they reason about degradation modes? |
| **Wrap-up** | 43-45 min | Summary, open questions | Clean summary of key decisions and trade-offs |

---

## Opening Problem Statement

> "Design a hyperlocal logistics and delivery platform for small and medium businesses. An SME creates a delivery request, and the system matches it to a nearby rider who picks up the package and delivers it within a promised time window. The platform serves a large Indian metro city with 50,000 merchant partners and handles 500,000 deliveries per day."

### Clarifying Questions to Expect (and What Good Answers Look Like)

| Question | Why It's Good | Key Information to Share |
|---|---|---|
| "What's the delivery radius? Is this within a city or intercity?" | Shows understanding of hyperlocal scope | Within a city, 80% of deliveries < 7 km, max 30 km |
| "What types of packages? Food delivery or general logistics?" | Package type affects matching constraints | General packages: documents, parcels, boxes. Not food (no temperature constraint) |
| "What's the delivery time expectation? Same-day or under an hour?" | Time constraint drives architecture | Three tiers: express (30 min), standard (60 min), economy (2 hours) |
| "Do riders handle multiple deliveries at once?" | Batching is a core design challenge | Yes, up to 3-4 orders per trip when compatible |
| "What's the average delivery value?" | Economics drive system constraints | $2-5 per delivery; platform must be extremely cost-efficient |
| "Are riders employees or gig workers?" | Affects control model and compliance | Gig workers; platform cannot dictate routes, only incentivize |
| "Is the fleet homogeneous or mixed?" | Vehicle type affects matching and routing | Mixed: bicycles, motorcycles, three-wheelers, mini-trucks, including EVs |

---

## Phase 1: Problem Exploration (0-7 min)

### What Distinguishes Levels

| Level | Characteristics |
|---|---|
| **Junior** | Focuses on CRUD operations (create order, assign rider); treats it as a simple marketplace; doesn't consider real-time constraints |
| **Mid** | Identifies matching and routing as core problems; thinks about GPS tracking; may not consider batching or dynamic pricing |
| **Senior** | Immediately identifies: (1) real-time matching is the critical path, (2) batching economics are essential at low delivery values, (3) ETA is a promise management problem, (4) location data scale is non-trivial |
| **Staff** | All of the above plus: asks about demand forecasting and pre-positioning, recognizes the three-way tension (speed vs. cost vs. fairness in batching), identifies that geo-partitioning is the natural scaling boundary, considers EV fleet integration and sustainability |

### Red Flags

- Treats it as a simple queue (FIFO (First-In-First-Out, like a line at a store) dispatch to nearest rider)
- Ignores delivery economics ($3 delivery can't afford heavy compute)
- Assumes perfect GPS accuracy and instant rider response
- Designs for a single global database without geo-partitioning
- Confuses ride-hailing with delivery logistics (different optimization objectives)
- Uses a graph database for real-time rider positions (wrong data structure for update frequency)

---

## Phase 2: High-Level Design (7-20 min)

### Expected Components

A strong candidate should identify these components unprompted:

1. **Order Service**: Order creation, validation, state management
2. **Matching Engine**: Rider-order assignment (the brain)
3. **Route Optimizer**: Multi-stop route planning
4. **Tracking Engine**: Real-time position broadcasting
5. **Location Ingestion**: GPS stream processing
6. **Pricing Engine**: Dynamic pricing with surge
7. **ETA Engine**: Time-to-delivery prediction
8. **Demand Forecaster**: Predictive fleet management

### Probing Questions

**Q: "How does rider matching work?"**

| Response Quality | Answer |
|---|---|
| **Weak** | "Assign the closest rider" |
| **Acceptable** | "Score riders on distance, vehicle type, and availability; pick the highest score" |
| **Strong** | "Batch orders over a short window (e.g., 30 seconds), build a cost matrix with road-network distances and multi-objective scoring, solve bipartite assignment for global optimum; pre-compute shadow assignments for rejections" |
| **Exceptional** | All of the above plus discusses why batching window size is a latency-vs-quality trade-off, explains the cost matrix construction Slowest part of the process (road-network queries dominate), and suggests contraction hierarchies for fast distance computation |

**Q: "How do you handle the GPS location data from thousands of riders?"**

| Response Quality | Answer |
|---|---|
| **Weak** | "Store in a database, query when needed" |
| **Acceptable** | "Use a time-series database; riders push location every few seconds" |
| **Strong** | "Stream processing pipeline: riders push every 3 seconds → ingestion gateway validates and deduplicates → fan-out to geospatial index (real-time) and time-series store (historical) → geofence evaluation for automatic status transitions" |
| **Exceptional** | Adds Kalman filtering for noise, map matching for road snapping, discusses at-most-once vs. at-least-once semantics for real-time vs. historical paths, mentions riders as traffic probes for speed estimation |

**Q: "What database do you use for tracking rider positions?"**

| Response Quality | Answer |
|---|---|
| **Weak** | "A relational database with lat/lng columns" |
| **Acceptable** | "A geospatial database with spatial indexes" |
| **Strong** | "An in-memory geospatial index (geohash-partitioned) for real-time queries—it must handle 5,000 writes/sec and 10,000 reads/sec with sub-millisecond latency; a separate time-series store for historical trails" |

---

## Phase 3: Deep Dive (20-37 min)

### Deep Dive Option A: Rider Matching

**Setup**: "Let's dive into the matching algorithm. You have 200 pending orders and 500 available riders. Walk me through how you assign riders to orders."

**Expected progression**:
1. Define the scoring function (what makes a good assignment?)
2. Recognize this is an assignment problem, not a search problem
3. Discuss batching vs. greedy dispatch trade-offs
4. Address the cost matrix construction Slowest part of the process
5. Handle rejection and reassignment flow

**Follow-up trap**: "A rider is 500m from a pickup but has a low acceptance rate (40%). Another rider is 2 km away but has 95% acceptance rate. Who do you assign?"

**Strong answer**: "It depends on the overall batch context. If this is the only order in the zone, the high-acceptance rider reduces reassignment latency risk. If there are many orders, the nearby rider might be assigned even with lower acceptance because the shadow assignment covers the rejection case. The scoring function balances proximity and acceptance probability—you can tune the weights based on whether the system is currently supply-constrained (favor high acceptance) or supply-abundant (favor proximity)."

### Deep Dive Option B: Route Optimization

**Setup**: "A rider has 2 orders already (Order A pickup done, heading to Order A dropoff and Order B pickup). A new Order C arrives that could be batched. How do you decide whether to add it and where to insert it?"

**Expected progression**:
1. Define insertion feasibility (time windows, capacity)
2. Enumerate insertion positions (O(n²) for pickup+dropoff pair)
3. Compute insertion cost (detour + delay to existing orders)
4. Compare against assigning to fresh rider
5. Discuss re-optimization after insertion

**Follow-up trap**: "What if inserting Order C makes Order A's delivery 8 minutes late?"

**Strong answer**: "The insertion is infeasible if it violates Order A's time window. But 'late' depends on how much slack Order A has—if the customer-facing ETA was set at p85 and we're still within the distribution, the insertion might be feasible even though the expected delivery time increased. The system should check against the hard time window, not against the optimistic ETA."

### Deep Dive Option C: ETA Prediction

**Setup**: "How do you predict delivery time with ±4 minute accuracy?"

**Expected progression**:
1. Decompose into components: travel time, pickup dwell, dropoff dwell
2. Travel time: road network with real-time traffic
3. Recognize that fixed overhead (dwell time) dominates short distances
4. Discuss probabilistic vs. point estimates
5. ETA as a promise: asymmetric cost of early vs. late

**Follow-up trap**: "Your ETA model predicts 28 minutes. The actual delivery takes 35 minutes. How do you diagnose whether this is a model problem or an operational problem?"

**Strong answer**: "Break down the error by component. Compare predicted vs. actual travel time (if travel was accurate but dwell was wrong, the dwell model needs retraining, not the travel model). Check whether the error was rider-specific (this rider is consistently slower) or zone-specific (this zone always has longer pickups—maybe it's a commercial area with elevators). Also check if this was a batch delivery and the preceding stop's delay cascaded. The trace should have all these breakpoints."

---

## Trap Questions

### Trap 1: "Can you just use Haversine distance for matching?"

**What it tests**: Understanding of road-network vs. straight-line distance.

**Trap**: Haversine distance is fast but misleading. Two points 500m apart by Haversine might be 3 km by road (river between them, one-way streets, highway divider). Using Haversine for matching produces assignments where the rider cannot reach the pickup within the time window despite appearing "close."

**Good answer**: "Haversine is fine for candidate Cutting off unnecessary steps (quick filter to eliminate definitely-too-far riders), but the actual scoring must use road-network distance. Pre-computed contraction hierarchies make road-network queries fast enough (< 1ms) for the scoring phase."

### Trap 2: "How does your system handle 500,000 orders per day?"

**What it tests**: Can the candidate distinguish between throughput and peak load?

**Trap**: 500K/day is ~6 orders/second average—trivial. But 20% of orders concentrate in the peak hour, creating 28 orders/second. And each order triggers 50+ matching evaluations, route optimization, and real-time tracking. The challenge is not the order rate but the cascade of computations per order.

**Good answer**: "500K/day average is not the challenge. Peak hour at 28 orders/second, with each triggering matching (50 candidate evaluations), route optimization (2-second solver), and 50,000 concurrent tracking sessions—that's the real load. I'd focus on the matching engine's batch-solve throughput and the location pipeline's sustained ingestion rate."

### Trap 3: "Why not just use a graph database for the delivery graph?"

**What it tests**: Understanding of update frequency vs. query patterns.

**Trap**: Graph databases are optimized for complex traversals on relatively static graphs. The delivery graph has 5,000 node position updates/second and every query needs a consistent snapshot. Traditional graph databases would collapse under this write pressure and cannot provide snapshot isolation at this frequency.

**Good answer**: "A graph database would struggle with the write throughput—5,000 position updates per second requiring index updates. The delivery graph is better modeled as an in-memory geospatial index with copy-on-write snapshots. Graph databases are useful for the road network (which changes slowly), not for the rider position overlay."

### Trap 4: "What if a rider's phone battery dies mid-delivery?"

**What it tests**: Resilience thinking for physical-world failures.

**Good answer**: "The system detects GPS silence after 30 seconds and shows 'last known position' to the tracking viewer. After 2 minutes, it alerts operations. The order is not automatically reassigned (the rider still has the package). Operations contacts the rider via phone call. If unreachable for 10 minutes, the order is flagged for manual intervention. Meanwhile, the customer is proactively notified of the tracking gap."

### Trap 5: "Your batching algorithm saves 30% per delivery. Why not always batch everything?"

**What it tests**: Understanding of the speed-cost-fairness tension.

**Good answer**: "Batching trades delivery speed for cost efficiency. Every additional order in a batch delays the first order. An express order that paid 1.8× for 30-minute delivery should not be delayed because the system wants to save money by batching it with an economy order. Batching must respect the urgency tier: express orders are never batched, standard orders batch up to 2, economy orders batch 3+. The batch tolerance is set by the SME at order creation, making it an explicit economic choice rather than a hidden optimization."

---

## Scoring Rubric

### Dimension Scores (1-5)

| Dimension | 1 (Weak) | 3 (Competent) | 5 (Exceptional) |
|---|---|---|---|
| **Problem Understanding** | Treats as simple CRUD marketplace | Identifies matching, routing, and tracking as core challenges | Articulates the three-way tension (speed/cost/fairness), recognizes SME economics constraints, asks about batching and fleet composition |
| **Architecture** | Monolithic design, single database | Microservices with clear separation; identifies geo-partitioning | Event-driven architecture with CQRS; separate real-time and analytical paths; geo-partitioned with within-city scaling strategy; back-pressure design |
| **Algorithm Design** | Greedy nearest-rider matching | Multi-objective scoring with reasonable factors | Batch matching with bipartite optimization; discusses cost matrix construction, contraction hierarchies, shadow assignments, and adaptive batch windows |
| **Scale Reasoning** | Ignores location data volume | Identifies GPS firehose as a challenge | Quantifies: 5K updates/sec, geofence evaluation optimization, discusses at-most-once for real-time vs. at-least-once for historical; back-pressure hierarchy |
| **Trade-off Articulation** | No trade-offs discussed | Mentions latency-vs-quality trade-off in matching | Deep discussion of batch window sizing, ETA percentile selection (promise buffer), insertion-vs-new-route economics, degradation hierarchy, and model-predictive control |
| **Failure Reasoning** | No failure modes considered | Mentions matching engine failover | Discusses cascade effects (batch disruption), race conditions (double assignment), degradation levels, chaos experiments; physical-world failures (battery death, GPS blackout) |

### Overall Assessment

| Score | Level | Description |
|---|---|---|
| **6-12** | Not Ready | Insufficient depth for senior SDE interview |
| **13-18** | Developing | Shows potential; needs deeper understanding of real-time systems |
| **19-24** | Competent | Solid senior-level understanding; good architecture with reasonable trade-offs |
| **25-30** | Strong | Staff-level thinking; anticipates problems, quantifies trade-offs, designs for failure |

---

## Discussion Extensions (If Time Permits)

### Extension 1: Multi-City Expansion

"You're expanding from 1 city to 10 cities. What changes?"

**Key points**: Geo-partitioned architecture means minimal changes to real-time systems. Challenges: (1) model transfer—demand and ETA models trained on City A may not work for City B (different traffic patterns, road networks); (2) cold-start in new cities with no historical data; (3) shared services (billing, merchant accounts) now serve 10× load; (4) operational tooling must support per-city dashboards with cross-city aggregation.

### Extension 2: Scheduled vs. On-Demand Economics

"30% of your merchants place the same delivery every day (e.g., a bakery delivering to 5 cafes every morning). How do you optimize?"

**Key points**: Scheduled deliveries are a planning problem (solved overnight with full VRP optimizer), not a real-time matching problem. They allow pre-committed rider allocation (guaranteed capacity at lower cost), route optimization with all orders known (optimal, not Practical rule of thumb), and lower pricing for merchants (predictable demand reduces platform risk). The challenge is mixing scheduled routes with on-demand orders without degrading either.

### Extension 3: EV Fleet Integration

"You want 50% of deliveries served by EVs within 2 years. How does this change the system?"

**Key points**: (1) Range-aware routing—every assignment must verify battery SOC covers the trip plus charging station reach. (2) Charging station integration—mid-shift charging as a waypoint in routes. (3) Matching preference—EV-first for short deliveries with ICE fallback. (4) Carbon tracking per delivery for SME dashboards. (5) Charging demand prediction—avoid all EVs needing charge at the same time.

### Extension 4: Competitive Dynamics

"A competitor launches with 50% lower prices. How does your system respond?"

**Key points**: This is not a system design question—it's a product question. But the system can enable competitive responses: (1) cost reduction through better batching (the system's optimization quality is its moat), (2) reliability differentiation (lower-priced competitors often have worse ETAs due to thinner rider supply), (3) SME retention through analytics and integration (switching cost from API integration and delivery analytics). The system can also support promotional pricing with per-merchant or per-zone price overrides.

---

## Common Mistakes and How to Redirect

| Mistake | Why It Seems Right | Why It's Wrong | Redirect |
|---|---|---|---|
| Using Haversine for matching scoring | Simple, fast, good enough for proximity | Two points 500m apart by air can be 3 km by road (rivers, highways, one-way streets) | "Haversine is great for candidate Cutting off unnecessary steps, but scoring needs road-network distance. How would you get fast road-network queries?" |
| Single global database | Simpler to reason about, fewer moving parts | Cross-city coordination is unnecessary and harmful—hyperlocal delivery is geographically bounded | "Would a rider in Mumbai ever be relevant to an order in Delhi?" |
| Greedy nearest-rider dispatch | Intuitively optimal—the closest rider should be fastest | Locally optimal but globally suboptimal; cannot anticipate future orders that could benefit from the nearby rider | "What happens if a harder order arrives 5 seconds after you assigned the nearest rider to an easy one?" |
| Point-estimate ETAs | Simpler to implement, what users see is a single number | 50th-percentile ETA means 50% of deliveries arrive "late"; asymmetric cost of late vs. early | "What percentage of deliveries will arrive after your stated ETA?" |
| Graph database for rider positions | The delivery graph sounds like a graph problem | 5,000 writes/sec with spatial query requirements; graph DBs optimize for traversal, not spatial range queries at high write volume | "How many position updates per second do you expect? Can a graph database handle that write rate?" |
| Polling for tracking updates | Simple request-response model, familiar pattern | 50,000 concurrent sessions × 1 poll/5 sec = 10,000 queries/sec; WebSocket push reduces server-side load 10× | "What's the tracking query load at peak? Is there a more efficient push model?" |

---

## Whiteboard Checkpoints

At each phase, the interviewer should see these artifacts on the whiteboard:

### After Problem Exploration (7 min)
- List of core requirements: order creation, matching, tracking, routing, pricing
- Key constraints identified: 28 orders/sec peak, 5,000 GPS updates/sec, $0.003 compute budget/delivery
- Delivery tiers: express/standard/economy with different batching rules

### After High-Level Design (20 min)
- Component diagram with at least 6-8 services
- Clear separation of real-time path (matching, tracking) from analytical path (forecasting, analytics)
- Geo-partitioning mentioned or drawn
- Data flow for order creation → rider assignment

### After Deep Dive (37 min)
- Matching algorithm detail: batch window, cost matrix, scoring function
- At least one optimization technique (contraction hierarchy, geohash Cutting off unnecessary steps)
- ETA decomposition into components (travel, dwell, variance)

### After Scalability Discussion (43 min)
- Location pipeline architecture (fan-out to geospatial index, time-series, geofence checker)
- Failure mode for at least one critical component (matching engine crash recovery)
- Graceful degradation strategy (batch matching → greedy dispatch fallback)

---

## Interviewer Preparation Notes

### Calibration Anchors

To ensure consistent scoring across interviewers, these anchors define the boundary between adjacent levels:

| Boundary | Differentiating Signal |
|---|---|
| **Junior → Mid** | Candidate recognizes that matching is not FIFO (First-In-First-Out, like a line at a store); attempts multi-objective scoring even if imperfect |
| **Mid → Senior** | Candidate spontaneously identifies batch matching as superior to greedy, and can explain why with a concrete counter-example |
| **Senior → Staff** | Candidate discusses system-level feedback loops (pricing ↔ supply, forecast ↔ positioning) and physical-world control theory concepts |

### Time Recovery Strategies

If the candidate is behind on pacing:

| Situation | Recovery |
|---|---|
| **Problem exploration overruns (> 10 min)** | Skip one clarifying question; redirect with "Let's assume [constraint] and jump to architecture" |
| **High-level design overruns (> 25 min)** | Skip one data flow diagram; focus deep dive on matching only (most signal-rich) |
| **Candidate stuck on deep dive** | Offer a hint: "What if you accumulated orders for 30 seconds before solving?" — then evaluate how they build on the hint |
| **Candidate racing ahead** | Add an extension question (EV fleet, scheduled vs. on-demand) to test depth beyond the standard scope |

### Anti-Patterns to Avoid as Interviewer

- **Leading the candidate to a specific solution**: Ask "How would you match riders?" not "Would you use batch matching?"
- **Fixating on a single component**: If the candidate gives a strong matching answer, move to a weaker area (ETA, scaling) to find their ceiling
- **Penalizing unfamiliar terminology**: A candidate who says "group orders and solve them together" without using the term "bipartite matching" should receive the same score as one who uses the formal term
- **Ignoring partial credit on trade-offs**: A candidate who identifies 2 of 3 tensions in the batching trade-off demonstrates strong reasoning even if they miss the fairness dimension

---

## Follow-Up Questions for Exceptional Candidates

If a candidate finishes the standard interview with time remaining and has demonstrated staff-level thinking, these questions test system-level reasoning:

| Question | What It Tests | Exceptional Answer Elements |
|---|---|---|
| "How would you detect that your demand forecaster is systematically wrong in a way that's invisible to aggregate metrics?" | Monitoring design beyond averages | Per-zone bias tracking; latent demand estimation; A/B testing the forecast by randomly under-serving zones to measure true demand |
| "Your best rider just got a route with 5 orders. What's the probability the route executes as planned?" | Combinatorial failure reasoning | Each stop has ~5% failure probability; P(no failure across 10 stops) = 0.95¹⁰ ≈ 60%; the more you batch, the more likely you need recovery; this creates an upper bound on batch size |
| "If you could only track one metric to judge platform health, what would it be?" | System-level prioritization | Dead-mile ratio — it captures matching quality, pre-positioning effectiveness, batch optimization, and fleet utilization in a single number; or on-time delivery variance (not rate), which captures the SME's experience of reliability |
| "A rider completes a delivery and is 200m from a pending pickup. But your system considers them 'in transit' for 30 more seconds. How do you handle this?" | Return-trip optimization awareness | Extend candidate pool to include riders whose current delivery will complete within N minutes; use predicted completion location as proximity metric; this captures 20-30% of orders with zero dead miles in dense areas |

---

## Domain-Specific Terminology Cheat Sheet for Interviewers

New interviewers may not be familiar with logistics terminology candidates might use:

| Term | Meaning | Why It Matters in This Interview |
|---|---|---|
| **Dead miles** | Distance ridden without a package | Primary cost lever; good candidates discuss minimization strategies |
| **First mile / last mile** | Rider travel to pickup / from final drop-off | Different optimization strategies for each; last-mile is the hardest |
| **Dwell time** | Time spent waiting at pickup/drop-off | Dominates ETA variance for short deliveries; often overlooked |
| **VRP / CVRPTW** | Vehicle Routing Problem variants | The formal name for the multi-stop routing optimization; candidates who name it show academic awareness |
| **Contraction hierarchy** | Pre-processed road graph for fast queries | The key data structure that makes batch matching feasible at scale |
