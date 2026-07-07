# Interview Guide

## 45-Minute Pacing Guide

| Time | Phase | Focus | Tips |
|------|-------|-------|------|
| 0-5 min | **Clarify & Scope** | Ask about scale, geography, vehicle types, surge requirement | Establish you understand it is a real-time geospatial matching problem, not a CRUD booking system |
| 5-10 min | **High-Level Architecture** | Draw the core components: rider/driver apps, API gateway, dispatch, matching engine, supply service, geo index, trip service, pricing | Name the services; show data flow for the ride request path |
| 10-20 min | **Deep Dive: Matching & Location** | Geospatial indexing (H3 vs geohash), two-phase matching (geo filter + ETA ranking), location ingestion pipeline at 875K writes/s | This is where you differentiate---spend the most time here |
| 20-28 min | **Deep Dive: Surge Pricing** | H3 zone-level demand/supply computation, smoothing, fare lock-in, market-clearing mechanism | Show you understand the economics, not just the engineering |
| 28-35 min | **Trip State Machine & Reliability** | State transitions, driver crash recovery, payment failure handling, distributed saga | Demonstrate fault tolerance thinking |
| 35-40 min | **Scalability & Trade-offs** | City-based sharding, why geo index fits in memory, failure modes, degradation hierarchy | Proactively discuss what happens when things fail |
| 40-45 min | **Wrap Up** | Summarize key decisions, mention what you'd explore further (ML-based matching, pool rides, multi-stop) | Leave the interviewer with a clear mental model |

---

## Opening Talking Points

Start with these to establish credibility:

1. **"This is fundamentally a real-time geospatial matching problem at write-heavy scale."** Establishes you understand the core challenge---not just "connect rider to driver."

2. **"The key tension is between location freshness and matching latency. Drivers update locations every 4 seconds, and we need to match within 1 second."** Shows you understand the real-time constraints.

3. **"I'll focus on three pillars: the geospatial index for driver tracking, the two-phase matching engine, and surge pricing as a supply-demand balancing mechanism."** Gives the interviewer a roadmap.

4. **"At Uber's scale---28M trips/day, 875K location updates per second---the architecture must be write-optimized for the location pipeline and read-optimized for the matching path."** Anchors the discussion with concrete numbers.

---

## 10 Likely Interview Questions

### 1. How do you find the nearest available driver?

**Expected Answer**: Use H3 hexagonal grid (not a database query). Encode rider's location to H3 cell at resolution 9. Query the in-memory index for drivers in that cell and expanding rings of adjacent cells. Filter by status (AVAILABLE) and vehicle type. This is Phase 1 (geo filter, <50ms). Then compute driving ETA for top 5 candidates using the routing engine (Phase 2, <500ms). Rank by composite score (ETA weight 50%, acceptance rate 20%, rating 15%, heading alignment 15%).

**Key insight**: Nearest by straight-line distance is NOT necessarily fastest to arrive. A driver 2km away heading toward you on the same road beats a driver 1km away across a highway.

### 2. Why H3 hexagonal grid instead of geohash?

**Expected Answer**: Three advantages: (1) Uniform cell area---a geohash cell at the same precision varies in size by latitude, so a 5km radius search in Reykjavik and Mumbai would cover different areas. H3 cells are consistent. (2) Equidistant neighbors---each hexagon has exactly 6 neighbors at equal distance, making ring queries natural. Geohash rectangles have 8 neighbors at varying distances. (3) No boundary artifacts---geohash cells can split a neighborhood boundary; two adjacent geohash cells may require searching 4 cells total due to edge effects.

### 3. How does surge pricing work?

**Expected Answer**: Surge is computed per H3 resolution-7 zone (neighborhood-level, ~5 km2) every 60-120 seconds. Count open ride requests (demand) and available drivers (supply) in each zone, including adjacent zones at reduced weight. Compute demand/supply ratio. Map ratio to multiplier via a configurable lookup table. Apply smoothing (max 0.5x change per interval) and regulatory caps. Publish updated multipliers to a cache. Ride requests read the pre-computed multiplier---no computation at request time.

**Economic insight**: Surge is not price gouging---it is a market-clearing mechanism. Higher prices increase supply (drivers go online or relocate) and decrease demand (riders who can wait, do), converging to equilibrium.

### 4. What happens if the driver declines or doesn't respond?

**Expected Answer**: The offer has a 15-second timeout. If declined or expired, the dispatch service re-dispatches to the next best candidate (from the original candidate list or a new query with expanded radius). Maximum 3 attempts. If all 3 fail, the rider is notified that no drivers are available. Each dispatch attempt is logged in the TRIP_OFFER table for analytics (understanding decline patterns, optimizing matching).

### 5. How do you handle GPS spoofing?

**Expected Answer**: Multi-signal validation: (1) Impossible speed detection---if two consecutive location updates imply >200 km/h, flag it. (2) Teleportation detection---if a driver "jumps" 10km in 10 seconds. (3) Sensor cross-check---compare GPS with cell tower triangulation. (4) Mock location API detection on Android. (5) Route plausibility---if trip route distance exceeds 3x straight-line distance, investigate. Flagged drivers are reviewed and potentially deactivated.

### 6. How do you scale the location ingestion pipeline for 875K updates/second?

**Expected Answer**: Tiered pipeline: Driver app -> WebSocket gateway -> Message queue (partitioned by driver_id) -> Consumer workers -> In-memory geospatial index. Key optimizations: (1) Partition by driver_id for ordering guarantees. (2) Filter stationary drivers (~40% reduction in index writes). (3) Deduplicate within 1-second windows. (4) City-based sharding of the geo index (no city exceeds ~75K updates/s). The message queue absorbs bursts; consumers auto-scale based on lag.

### 7. What if the matching service goes down?

**Expected Answer**: Matching engine is stateless---it reads from the geo index and routing engine. Immediate failover to standby instances. If the routing engine is also down (so ETA computation is impossible), fall back to distance-only matching: rank candidates by straight-line distance instead of driving ETA. Less accurate but keeps matching operational. This is Level 3 in the degradation hierarchy.

### 8. How does the trip state machine handle driver app crashes?

**Expected Answer**: (1) Heartbeat-based health check---driver app sends heartbeats every 10 seconds. Three missed heartbeats trigger a health check. (2) State digest on phone---the dispatch system sends an encrypted state digest to the driver app. On reconnection, the app returns the digest for rapid state recovery. (3) Trip continuity---the trip stays in its current state (e.g., IN_PROGRESS) during the gap; the rider sees the last known driver location. (4) Orphan detection---if the driver doesn't reconnect within 5 minutes, alert the safety team and offer the rider support options.

### 9. How do you handle multi-city deployment?

**Expected Answer**: City-based sharding. Each city (or region) has its own geospatial index, trip data partition, and surge computation. A trip in Mumbai never queries driver data in London. Regional data centers serve nearby cities for low latency. User profiles are replicated across regions (for traveling users) with eventual consistency. Analytics data is aggregated to a global warehouse asynchronously.

### 10. How is the ETA computed?

**Expected Answer**: ETA is computed by the routing engine using the road network graph, real-time traffic data, and turn penalties. For matching, ETAs are computed in parallel for the top 5 candidates (each ~100ms). Caching strategies: (1) Grid-to-grid ETA matrix pre-computed between H3 resolution-7 cell centers. (2) Popular route cache for frequent origin-destination pairs (airports, stations). (3) Fallback: straight-line distance * road factor (1.4) / average speed if routing engine is unavailable.

### 11. How would you design ride pooling?

**Expected Answer**: Pool matching is fundamentally different from single-rider matching. Instead of finding the nearest driver, you search active pools with available capacity. For each candidate pool, compute the detour cost: the additional time added for all existing riders if this new rider is inserted. Constraints: maximum detour (10 min), maximum capacity (3 riders), minimum route overlap (40%). The waypoint sequencer reorders pickup/dropoff stops to minimize total trip time. Pricing uses a shared-cost allocation: each rider pays a discounted fare proportional to their segment of the route. The key trade-off is that pool matching is O(active_pools * waypoints) per request, much more expensive than standard matching. Most platforms limit pool matching to the top 50 active pools by geographic proximity.

### 12. How would you handle autonomous vehicle integration?

**Expected Answer**: Autonomous vehicles change three things: (1) No driver acceptance step—the dispatch system directly assigns vehicles, reducing matching latency but requiring guaranteed vehicle availability. (2) Fleet positioning becomes a platform responsibility—unlike human drivers who choose where to wait, AV fleets must be proactively repositioned based on demand forecasts. (3) New constraints: battery/fuel level, charging station routing, maintenance scheduling, passenger safety verification (is the right person boarding?). The matching engine adds a vehicle_type filter (AV vs. human-driven), and the pricing service may offer different rates. The trip state machine drops DISPATCHED (no acceptance needed) but adds VEHICLE_PREPARING (autonomous pre-trip safety checks).

---

## Trade-offs to Proactively Raise

| Decision | Trade-off | Why This Choice |
|----------|-----------|-----------------|
| **In-memory geo index vs. database spatial index** | Memory cost vs. write throughput | 460MB of memory is trivial; 875K writes/s to a database is not feasible |
| **H3 vs. geohash** | Uber-specific library vs. industry standard | H3's uniform cells and equidistant neighbors make proximity queries consistent globally |
| **Two-phase matching (geo + ETA) vs. ETA-only** | Accuracy vs. latency | Computing ETA for all drivers in a city (~100K) would take minutes; geo filter narrows to 5-10 candidates in microseconds |
| **Event-driven location pipeline vs. direct writes** | Latency (adds ~1s) vs. throughput | Direct writes to the geo index at 875K/s would overwhelm it; the queue provides buffering and ordering |
| **City-based sharding vs. global index** | Operational complexity vs. data locality | A global index is unnecessary (no cross-city queries) and would introduce latency for distant cities |
| **Persistent trip state machine vs. in-memory state** | Write overhead vs. durability | Every state transition is a database write (~20ms), but trip states CANNOT be lost |
| **Surge smoothing vs. instant adjustment** | Responsiveness vs. stability | Instant surge changes cause oscillation (drivers chase zones, surge spikes/drops rapidly). Smoothing dampens oscillation but delays response to genuine demand changes by ~2 minutes. |
| **Distance-only fallback matching vs. no matching during outage** | Accuracy vs. availability | Distance-only matching produces suboptimal matches (driver 1km away across a river vs. 2km away on the same road) but keeps the platform operational |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Can you use a standard relational database for driver locations?" | Understanding of write throughput limits | "A relational DB with spatial index handles hundreds of writes/s, not 875K/s. The index would be constantly rebuilding. An in-memory geospatial index with H3 cells handles this because updates are hash map operations (O(1)), not B-tree rebalances." |
| "Why not just compute ETA for all nearby drivers?" | Understanding of computational cost | "There might be 500 available drivers within 5km. Each ETA computation calls the routing engine (~100ms). 500 * 100ms = 50 seconds sequentially, or ~10 seconds with 50 parallel workers. The two-phase approach narrows to 5 candidates first, making it 5 * 100ms = 500ms total." |
| "Why not use a pub/sub model where riders subscribe to nearby driver updates?" | Understanding of scale vs. utility | "With 3.5M drivers updating 250 times/minute each, the pub/sub fan-out would be enormous. A rider only needs nearby drivers when actively requesting a ride (a few seconds), not continuously. Pull-based querying at ride request time is far more efficient." |
| "What if surge pricing is wrong---do you refund?" | Understanding of fare lock-in | "The upfront fare shown to the rider is locked for 5 minutes. The rider confirms at that price. If surge changes after confirmation, the locked fare applies. The final fare may differ from the estimate due to route changes, but the surge component is locked." |
| "How do you prevent drivers from gaming surge?" | Understanding of incentive design | "Drivers who consistently go offline in one zone and reappear in a surge zone are flagged. The system detects patterns: repeated offline/online cycles correlated with surge activation. Additionally, surge zones are small enough (~2.5km radius) that physically relocating takes time, by which point the surge may have subsided." |
| "Can you use a simpler system for a small city with 100 drivers?" | Demonstrate scaling awareness | "Absolutely. For 100 drivers, a simple relational DB with PostGIS handles it fine. The H3 index, message queue pipeline, and multi-shard architecture are solutions to scale problems that don't exist at 100 drivers. Start simple, add complexity as needed. The city-based sharding model supports this: each city can run a simpler or more complex stack independently." |

---

## Phase-by-Phase Walkthrough

### Phase 1: Requirements (5 min)

**Questions to ask the interviewer:**

1. "What's the expected scale---single city, national, or global deployment?" (Determines sharding strategy)
2. "Should I design for standard rides only, or include pool/shared rides?" (Pool changes matching fundamentally)
3. "Is surge pricing in scope, or should I treat pricing as a black box?" (Surge is a deep topic)
4. "Should I consider scheduled rides, or focus on on-demand?" (Scheduled rides add pre-matching)
5. "Are there specific vehicle types (economy, premium, XL) or just one class?" (Affects matching filters)
6. "How important is the safety system architecture?" (Crash detection, emergency response)

**Anchor with constraints:**

```
"Based on our discussion, I'll design a ride-hailing platform that:
 - Handles 28M trips/day, 875K location updates/second
 - Matches riders to drivers in under 1 second
 - Uses H3 hexagonal grid for geospatial indexing
 - Computes surge pricing per neighborhood every 1-2 minutes
 - Supports city-based sharding for geographic data locality
 - Ensures zero trip state loss through persistent state machine"
```

### Phase 2: High-Level Design (5 min)

Draw the core architecture with these components:
1. **Rider App + Driver App** → API Gateway + WebSocket Gateway
2. **Location Ingestion Pipeline**: Driver App → WebSocket → Message Queue → Consumer → Geo Index
3. **Matching Engine**: Reads from Geo Index + ETA Service → dispatches to driver
4. **Trip Service**: Persistent state machine for trip lifecycle
5. **Pricing Service**: Reads from Stream Processor → computes surge per zone
6. **Payment Service**: Charges rider, pays driver

Key insight to share: "Location ingestion (875K writes/s) and matching (~1K requests/s) must be separated because writes outnumber reads by 875x."

### Phase 3: Deep Dive (20 min)

Expect the interviewer to pick one of these areas:

**Option A: Geospatial Matching** (most common)
- H3 hexagonal grid: uniform cells, equidistant neighbors, hierarchical resolution
- Two-phase matching: geo filter (microseconds) + ETA ranking (hundreds of ms)
- Composite scoring: ETA 50%, acceptance rate 20%, rating 15%, heading 15%
- Race condition: two riders requesting the same driver → optimistic locking with driver lock TTL

**Option B: Surge Pricing**
- Zone-level computation (H3 res-7, ~5 km²)
- Smoothing: max 0.5x change per interval, 5-min minimum activation
- Fare lock-in: 5-minute price lock after rider sees estimate
- Economic insight: surge is market-clearing, not gouging

**Option C: Trip State Machine & Reliability**
- Persistent state transitions with conditional updates
- Idempotent operations for retry safety
- Driver crash recovery via heartbeats + state digest
- Decoupled payment (trip completes even if payment fails)

### Phase 4: Scalability (5 min)

Cover:
- City-based sharding (natural partition key, zero cross-shard queries)
- Graceful degradation hierarchy (4 levels from full to queued matching)
- Pre-provisioned scaling for predictable peaks (NYE, concerts)
- Disaster recovery via driver-side state digests

### Phase 5: Wrap-Up (5 min)

Mention extensions:
- Ride pooling (combinatorial optimization challenge)
- Autonomous vehicle integration (removes driver acceptance, adds battery constraints)
- Multi-modal transport (ride-hail + transit + micro-mobility)
- Supply repositioning (proactive demand management)

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|---------------|-----------------|
| Starting with the database schema | Misses the core challenge (real-time matching) | Start with the matching problem and location pipeline |
| Treating it as a CRUD application | Ignores real-time and geospatial aspects | Emphasize the event-driven, real-time nature from the start |
| Using a relational database for location tracking | Cannot handle write throughput | Explain in-memory geospatial index with clear justification |
| Ignoring the two-phase matching design | Results in either slow matching or inaccurate matching | Explicitly separate geo filter from ETA ranking |
| Describing surge as "just multiply the price" | Misses the economic and engineering complexity | Explain zone-level computation, smoothing, demand forecasting |
| Forgetting driver app crash scenarios | Ignores the most common failure mode | Discuss heartbeats, state digest, and orphan trip detection |
| Designing a global monolith | Doesn't account for geographic data locality | Explain city-based sharding and why cross-city queries are unnecessary |
| Over-engineering day 1 | Designing for 100M trips/day when asked about 10K | Design for 10x current scale, mention what changes at 100x |

---

## Key Numbers to Memorize

| Number | Context |
|--------|---------|
| **28M** trips/day | Uber's current daily volume |
| **875K** location updates/second | 3.5M drivers * 1 update / 4 seconds |
| **< 1s** matching latency | From ride request to driver notification |
| **< 2s** location ingestion lag | From GPS reading to geospatial index |
| **3.5M** concurrent online drivers | Peak simultaneous location reporters |
| **460 MB** geospatial index size | Fits in memory on a single server |
| **~1,000** trips/second at peak | 3x average of 325 TPS |
| **15 seconds** offer timeout | Time driver has to accept/decline |
| **3 attempts** max re-dispatch | Before "no drivers available" |
| **H3 res 9** for driver indexing | ~0.1 km2 cells, ~174m edge length |
| **H3 res 7** for surge zones | ~5.16 km2 cells, neighborhood-level |
| **1-2 min** surge update interval | How often surge multipliers are recomputed |

---

## Questions to Ask the Interviewer

1. "What's the expected scale---are we designing for a single city, a country, or global deployment?"
2. "Should I include carpooling / shared rides, or focus on single-rider trips?"
3. "Is there a specific vehicle type requirement (economy only, or economy + premium + XL)?"
4. "Should I design the pricing engine (surge) in depth, or can I treat it as a black box?"
5. "How important is the driver side---should I design the driver-facing features in detail?"
6. "Are there regulatory constraints I should consider (surge caps, driver labor classification)?"

---

## Extension Topics (If Time Permits)

If you finish early or the interviewer asks "what else would you add?":

1. **Ride pooling (shared rides)**: Matching becomes a combinatorial optimization---find a driver who can pick up 2-3 riders with overlapping routes. Requires real-time route matching and detour minimization.

2. **Scheduled rides**: Rider books a ride 30 minutes to 24 hours in advance. System must pre-match a driver at the scheduled time without over-committing supply.

3. **Multi-stop trips**: Rider adds intermediate stops. The fare calculation and ETA must account for wait time at each stop.

4. **ML-based matching**: Instead of a hand-tuned scoring function, use a trained model that predicts trip completion probability (considering driver acceptance rate, rider cancellation history, traffic patterns).

5. **Autonomous vehicle integration**: Self-driving vehicles change the matching problem: no driver acceptance step, but fleet positioning and charging/refueling become new constraints.

6. **Multi-modal transportation**: Rider opens app and sees options: ride-hail (8 min, $15), scooter to transit + ride-hail from station (25 min, $8), bike to destination (35 min, $3). Requires integration with public transit APIs, micro-mobility fleet management, and a unified trip planner that optimizes for time, cost, or carbon footprint.

7. **EV fleet management**: Battery level becomes a matching constraint. A driver with 15% battery cannot be dispatched for a 30-km trip. The system must route drivers to charging stations during idle time, predict charging needs based on upcoming demand, and coordinate fleet-wide charging to avoid overloading stations.

8. **Supply repositioning**: Proactively nudge idle drivers toward predicted demand zones. Use demand forecasting models (event calendars, weather, historical patterns) to suggest repositioning. The incentive design matters: drivers who reposition earn a guaranteed minimum even if no trip materializes.

---

## Scoring Rubric

### Junior Level (Meets Bar)
- Identifies ride-hailing as a real-time geospatial matching problem, not a CRUD booking system
- Designs the core ride request flow (rider request → find driver → dispatch → trip)
- Mentions geospatial indexing (geohash or H3) for finding nearby drivers
- Basic trip state machine (request → accept → in_progress → complete)
- Recognizes that location updates are high-throughput writes
- Basic understanding of surge pricing (higher price when demand exceeds supply)

### Senior Level (Strong Hire)
- Designs the two-phase matching pipeline (geo filter + ETA ranking) with latency budget
- Explains why H3 hexagonal grid is preferred over geohash (uniform cells, equidistant neighbors)
- Handles driver state machine crash recovery (heartbeats, state digest, orphan detection)
- Designs the tiered location ingestion pipeline (WebSocket → queue → consumer → geo index)
- Discusses city-based sharding with clear data locality justification
- Addresses surge pricing computation architecture (zone-level, smoothing, fare lock-in)
- Proposes graceful degradation hierarchy (distance-only matching, cached surge, queued matching)
- Discusses ETA caching strategies (grid-to-grid matrix, popular route cache, fallback)

### Staff Level (Exceptional)
- Designs ride pooling as a combinatorial optimization problem with detour constraints
- Discusses ML-enhanced matching (predicted acceptance, trip completion probability)
- Proposes supply repositioning using demand forecasting models
- Addresses autonomous vehicle integration and its architectural implications
- Discusses multi-modal transport integration and unified trip planning
- Designs the EV fleet charging optimization as a constraint satisfaction problem
- Proposes cell-based architecture for blast radius isolation across cities
- Discusses scheduled rides with pre-matching and supply buffer management
- Addresses driver earnings fairness as a matching constraint (fair distribution of trips)
- Designs the safety detection pipeline (crash detection, route deviation, emergency response)

---

## Anti-Patterns to Watch For

| Anti-Pattern | Why It's Wrong | Correct Approach |
|-------------|---------------|--------------------|
| **Using a relational database for live driver locations** | Cannot sustain 875K writes/s; spatial index rebalancing creates lock contention | In-memory geospatial index (H3 cells) with O(1) hash map updates |
| **Computing ETA for all nearby drivers** | 500 drivers × 100ms routing call = 50s total; infeasible even with parallelism | Two-phase matching: geo-filter to 5-10 candidates, then ETA-rank the shortlist |
| **City-wide surge pricing** | A demand spike at the airport raises prices across the entire city unfairly | Neighborhood-level (H3 res-7) surge with adjacent-zone weighting |
| **Instant surge adjustment without smoothing** | Creates oscillation: surge activates → drivers flock → surge drops → drivers leave → surge spikes again | Max 0.5x change per interval, 5-minute minimum activation, exponential moving average |
| **Global index for all cities** | Unnecessary cross-city queries; single point of failure; higher latency for distant cities | City-based sharding with independent geo indexes per city |
| **Treating payment failure as trip failure** | The physical trip happened; the rider was transported; the payment is a separate concern | Decouple trip completion from payment; queue failed payments for retry |
| **Pub/sub for driver location to riders** | 3.5M drivers × continuous updates creates massive fan-out; riders only need locations briefly | Pull-based query at ride request time; push only matched driver location via WebSocket |
| **Single-threaded matching for fairness** | Creates a global Slowest part of the process; matching is inherently parallelizable per city | Partition matching by city; parallelize within city; fairness via scoring function weights |
