# Deep Dive & Bottlenecks

## Deep Dive 1: GDS Integration & Seat Hold Race Conditions

### The GDS as an External Authoritative System

The defining architectural constraint of a flight booking system is that **inventory truth lives outside your system**. Unlike e-commerce (where you own the warehouse) or hotel booking (where you own the room inventory), the airline's Central Reservation System (CRS)---hosted by Amadeus Altéa, Sabre SabreSonic, or similar---is the single source of truth for seat availability.

This creates several cascading constraints:

**Latency**: GDS API calls take 500ms-2s. You cannot control this. A fan-out search to 5 providers means your minimum latency floor is the slowest provider's response time (mitigated by timeouts).

**Cost**: Each GDS API call costs $0.50-$2.00. With 100M daily searches × 5 providers, uncached costs reach $375M/day. Caching is not an optimization---it is an economic necessity.

**Reliability**: GDS systems have their own maintenance windows, rate limits, and outage patterns. Your 99.99% booking availability target depends on systems you do not control.

**Data Format Fragmentation**: Amadeus uses EDIFACT (legacy teletype format, 40+ years old), Sabre uses proprietary XML, NDC uses IATA XML/JSON. Each response must be normalized into a common internal model.

### The PNR: Aviation's Universal Record

A PNR (Passenger Name Record) is not just a database row---it is a shared, synchronized record that exists simultaneously across multiple systems:

```
PNR "ABC123" exists in:
├── Amadeus GDS (booking agent's system)
├── British Airways CRS (operating airline)
├── American Airlines CRS (codeshare partner)
├── OTA's local database (your system)
└── Travel agent's system (if booked via agent)
```

Each system may have a different record locator for the same booking. Changes must propagate across all systems via EDIFACT messages (Type B teletype). This is fundamentally a **distributed consensus problem** solved by the industry through eventual consistency and the GDS as the coordination hub.

**PNR mandatory fields (PRINT):**
- **P**hone: Contact number
- **R**eceived from: Last modifier
- **I**tinerary: At least one flight segment
- **N**ame: Passenger full name
- **T**icketing: Ticketing time limit and method

### Two-Phase Booking: Hold Then Ticket

The booking process is inherently two-phase:

```
Phase 1: HOLD (GDS creates PNR, blocks seat, starts TTL countdown)
  └─ Seat is reserved but not paid for
  └─ PNR status: HK (Holding Confirmed)
  └─ TTL: typically 15 minutes (configurable per airline)

Phase 2: TICKET (Payment succeeds, GDS issues e-ticket)
  └─ E-ticket number generated (e.g., 125-1234567890)
  └─ PNR status updated with ticket info
  └─ Seat is now permanently allocated
```

If Phase 2 does not complete within the TTL, the GDS automatically releases the hold and the seat returns to inventory. This is the airline industry's built-in **lease-based concurrency control**.

### Race Condition: Two Users, One Seat

```
Timeline:
t=0:    User A searches: "BA115, Y-class: 3 seats remaining"
t=0.5:  User B searches: "BA115, Y-class: 3 seats remaining" (same cached result)
t=2:    User A clicks "Book" → holdSeat() → GDS.createPNR()
t=2.5:  User B clicks "Book" → holdSeat() → GDS.createPNR()
t=3:    GDS processes User A's hold: SUCCESS (2 seats now remaining)
t=3.2:  GDS processes User B's hold: SUCCESS (1 seat now remaining)
         OR if only 1 seat was left: FAILURE (UC - Unable to Confirm)
```

**Resolution**: The GDS is the authoritative arbiter. It handles concurrent PNR creation requests serially within its own transaction system. The first hold to reach the GDS wins. The OTA's role is to:

1. **Optimistically show availability** from cache (may be slightly stale)
2. **Let GDS resolve conflicts** at hold time
3. **Handle rejection gracefully** with "sold out" or "price changed" messaging
4. **Sync local inventory** on rejection to prevent repeated failures

### Circuit Breaker Strategy for GDS

```
Per-Provider Circuit Breaker Configuration:
┌──────────────┬────────────┬────────────┬──────────────┐
│ Provider     │ Failure    │ Open       │ Half-Open    │
│              │ Threshold  │ Duration   │ Probe Rate   │
├──────────────┼────────────┼────────────┼──────────────┤
│ Amadeus      │ 5 failures │ 30 seconds │ 1 req / 10s  │
│              │ in 60s     │            │              │
├──────────────┼────────────┼────────────┼──────────────┤
│ Sabre        │ 5 failures │ 30 seconds │ 1 req / 10s  │
│              │ in 60s     │            │              │
├──────────────┼────────────┼────────────┼──────────────┤
│ Travelport   │ 5 failures │ 30 seconds │ 1 req / 10s  │
│              │ in 60s     │            │              │
├──────────────┼────────────┼────────────┼──────────────┤
│ Airline NDC  │ 3 failures │ 60 seconds │ 1 req / 15s  │
│              │ in 30s     │            │              │
└──────────────┴────────────┴────────────┴──────────────┘

Fallback Strategy:
- 1 provider down: serve results from remaining providers + cache
- 2 providers down: serve cached results + available provider
- All providers down: serve stale cache (clearly marked "prices may have changed")
- Booking with provider down: route to alternate GDS if flight available there
```

### NDC vs. GDS: The Dual-Channel Reality

NDC (New Distribution Capability) is IATA's XML-based standard for airlines to distribute offers directly, bypassing GDS intermediaries:

| Aspect | Traditional GDS | NDC Direct |
|--------|----------------|------------|
| **Protocol** | EDIFACT (teletype, 1980s) | XML/JSON (modern REST/SOAP) |
| **Content** | Standardized fare classes only | Rich content: images, bundles, dynamic offers |
| **Pricing** | Published fares (ATPCO filed) | Dynamic, personalized pricing |
| **Ancillaries** | Limited (basic baggage, meals) | Full catalog (bundles, upgrades, experiences) |
| **Cost to OTA** | GDS booking fee ($2-5 per segment) | Lower or zero distribution cost |
| **Coverage** | 400+ airlines | 70+ airlines (growing, major carriers first) |
| **Reliability** | Mature, well-understood | Varies significantly by airline |
| **Implementation** | Single GDS API covers many airlines | Per-airline integration effort |

**Production architecture must support both**: GDS for breadth (400+ airlines), NDC for depth (richer content, better pricing from major carriers). Aggregators (Duffel, Kiwi.com, Travelfusion) are emerging as middleware that normalize GDS + NDC into a single unified API.

---

## Deep Dive 2: Search Result Caching & Freshness

### The Caching Imperative

Flight fares change every few minutes. A seat sold on one channel immediately reduces availability across all channels. Yet caching is mandatory because:

1. **Cost**: GDS charges per API call ($0.50-2.00). Without caching, search costs exceed $300M/day.
2. **Latency**: GDS calls take 500ms-2s. Cached responses return in <10ms.
3. **GDS Rate Limits**: Providers impose request-per-second caps. Caching stays within limits.

### Two-Tier Cache Architecture

```
L1 Cache: In-Process (Application Memory)
├── TTL: 60 seconds
├── Size: ~500 MB per instance
├── Scope: Process-local, not shared
├── Use: Same route searched multiple times in quick succession
└── Hit rate: ~15-20% (helps absorb repeated searches during page navigation)

L2 Cache: Redis Cluster (Shared)
├── TTL: 180 seconds (3 minutes)
├── Size: ~25 GB across cluster
├── Scope: Shared across all search service instances
├── Use: Different users searching the same route within 3-minute window
└── Hit rate: ~65-70% for popular routes, ~30% for long-tail routes

Combined cache hit rate: ~80% (target)
Cache miss → GDS fan-out: ~20% of searches
```

### Cache Key Design

```
Primary key:   hash(origin, destination, date, passengerCounts, cabin)
Example:       "SRCH:JFK:LHR:20241215:2A0C0I:ECONOMY" → SHA256 → cache key

NOT included in key (applied as post-cache filters):
- Airline preferences
- Non-stop filter
- Price range filter
- Time-of-day filter

Rationale: Including filters in the key would fragment the cache
(100 filter combinations × 500K routes = 50M cache entries = poor hit rate).
Instead, cache the full result set and apply filters on read.
```

### Stale Fare Re-Verification

A critical pattern: **cached search results are suggestions, not commitments**. When a user selects a fare from cached results to book:

```
FUNCTION verifyFareBeforeHold(itineraryId, fareClass):
    cachedFare = getCachedFare(itineraryId, fareClass)

    // Re-verify with GDS (single targeted query, not full search)
    currentFare = gds.verifyAvailabilityAndPrice(
        itinerary.segments, fareClass
    )

    IF currentFare.unavailable:
        RETURN {status: "SOLD_OUT", suggestion: findAlternatives(itinerary)}

    IF abs(currentFare.price - cachedFare.price) > 0:
        RETURN {
            status: "PRICE_CHANGED",
            oldPrice: cachedFare.price,
            newPrice: currentFare.price,
            // Give user 5 minutes to decide
            decisionDeadline: now() + 5.minutes
        }

    RETURN {status: "CONFIRMED", price: currentFare.price}
```

### Cache Stampede Prevention

When a popular route's cache expires, hundreds of concurrent requests may all trigger GDS fan-out simultaneously:

```
FUNCTION getSearchResultsWithStampedePrevention(cacheKey, searchParams):
    result = redis.get(cacheKey)
    IF result:
        RETURN result

    // Try to acquire refresh lock (only one request refreshes)
    lockAcquired = redis.setnx("lock:" + cacheKey, myInstanceId, TTL=10s)

    IF lockAcquired:
        // This request performs the GDS fan-out
        freshResults = performGDSFanOut(searchParams)
        redis.setex(cacheKey, TTL_3_MINUTES, freshResults)
        redis.del("lock:" + cacheKey)
        RETURN freshResults
    ELSE:
        // Other requests wait briefly, then serve stale or wait for fresh
        WAIT 500ms
        result = redis.get(cacheKey)
        IF result:
            RETURN result
        // Still no result: perform own GDS call (fallback)
        RETURN performGDSFanOut(searchParams)
```

### Cache Warming for Popular Routes

```
Background Job: runs at 00:00 UTC daily

FUNCTION warmSearchCache():
    // Top 10,000 routes by search volume (last 7 days)
    popularRoutes = analytics.getTopRoutes(limit=10000)

    FOR EACH route IN popularRoutes:
        // Search for next 14 days
        FOR date IN next14Days():
            FOR cabin IN [ECONOMY, BUSINESS]:
                schedule(searchAndCache, route, date, cabin,
                         stagger = random(0, 3600s))  // spread over 1 hour
```

---

## Deep Dive 3: Fare Rules Engine

### Fare Rule Complexity

Aviation fare rules are among the most complex pricing structures in any industry. Published fares are filed through ATPCO (Airline Tariff Publishing Company) and contain up to 31 categories of rules:

```
Fare Rule Categories (selected):
├── Cat 1:  Eligibility (who can buy: government, military, student, etc.)
├── Cat 2:  Day/Time application (weekday vs weekend fares)
├── Cat 3:  Seasonality (peak, shoulder, off-peak)
├── Cat 5:  Advance purchase (must book 14/21/30 days before departure)
├── Cat 6:  Minimum stay (must stay Saturday night for cheapest fare)
├── Cat 7:  Maximum stay (must return within 30 days)
├── Cat 8:  Stopovers (allowed/not allowed, charges)
├── Cat 10: Combinability (can this fare be combined with other fares?)
├── Cat 14: Travel dates (blackout dates)
├── Cat 15: Sales dates (fare only available for purchase until date X)
├── Cat 16: Penalties (change fee: $200, cancel fee: $300)
├── Cat 25: Fare by rule (fare derived from another fare with discount)
├── Cat 31: Voluntary changes (rebooking rules)
└── Cat 33: Voluntary refunds (refund calculation rules)
```

### Fare Families

Airlines group fare classes into fare families to simplify display:

```
┌─────────────────┬──────────┬──────────────┬──────────────┬──────────────┐
│ Attribute       │ Basic    │ Main Cabin   │ Flexible     │ Business     │
│                 │ Economy  │              │              │              │
├─────────────────┼──────────┼──────────────┼──────────────┼──────────────┤
│ Fare Classes    │ K, L, V  │ M, H, B     │ Y, S         │ J, C, D     │
│ Change Fee      │ Not      │ $200         │ Free         │ Free         │
│                 │ allowed  │              │              │              │
│ Cancellation    │ Non-     │ $300 fee     │ Full refund  │ Full refund  │
│                 │ refundable│             │              │              │
│ Checked Bag     │ None     │ 1 × 23 kg   │ 2 × 23 kg   │ 2 × 32 kg   │
│ Seat Selection  │ Paid     │ Free (basic) │ Free (all)   │ Free (all)   │
│ Mileage Earn    │ 25%      │ 100%         │ 150%         │ 200%         │
│ Upgrade Eligible│ No       │ Waitlist     │ Priority     │ N/A          │
│ Min Stay        │ Sat night│ None         │ None         │ None         │
│ Advance Purchase│ 14 days  │ None         │ None         │ None         │
└─────────────────┴──────────┴──────────────┴──────────────┴──────────────┘
```

### Rule Evaluation at Different Points

Fare rules are evaluated at three distinct points in the booking lifecycle:

1. **At Search Time**: Display restrictions summary (refundable? changeable? baggage included?) to help user compare fare families.

2. **At Hold/Booking Time**: Validate that booking meets advance purchase requirement, passenger eligibility, and combinability rules (for multi-fare itineraries).

3. **At Change/Refund Time**: Apply penalty rules, calculate fare difference for rebooking, determine refund amount based on Cat 33 voluntary refund rules.

---

## Slowest part of the process Analysis

### Slowest part of the process 1: GDS Fan-Out at Peak

```
Problem: 11,600 peak searches/sec × 5 providers = 58,000 external API calls/sec
Impact: GDS connection pool exhaustion, timeout cascades, cost explosion

Mitigations:
1. Cache-first: 80% cache hit rate reduces to 11,600 GDS calls/sec
2. Connection pooling: persistent HTTP/2 connections to each GDS (pool size: 500)
3. Timeout isolation: per-provider timeout (2-3s) prevents slow provider from blocking
4. Adaptive fan-out: if cache has results from 3+ providers within 1 min, skip remaining
5. Priority queuing: booking-related GDS calls get priority over search calls
```

### Slowest part of the process 2: Seat Hold Expiry Cleanup

```
Problem: 1M bookings/day with ~30% hold-only (no payment) = 300K expired holds/day
         = ~3.5 expired holds/sec continuous, with spikes up to 50/sec

Impact: Database scanning for expired holds, GDS cancel calls for cleanup

Mitigations:
1. Partial index: WHERE status = 'ON_HOLD' AND hold_expires_at < NOW()
2. FOR UPDATE SKIP LOCKED: prevents worker contention
3. Batch processing: release 100 holds per cycle, run every 30s
4. Redis keyspace notifications: on key expiry, trigger release (no polling needed)
5. Separate database partition for hold-state bookings
```

### Slowest part of the process 3: Popular Route Cache Stampede

```
Problem: Cache expires for JFK→LHR → 500 concurrent requests all miss cache →
         500 × 5 = 2,500 GDS calls for same route

Impact: GDS rate limit hit, 499 wasted identical queries, latency spike

Mitigations:
1. Single-flight refresh: lock-based cache update (one request refreshes, others wait)
2. Cache warming: pre-populate top 10,000 routes before TTL expires
3. Jittered TTL: TTL = 3min ± random(30s) to prevent synchronized expiry
4. Stale-while-revalidate: serve slightly stale result while refresh happens in background
```

### Slowest part of the process 4: Fare Rule Evaluation Latency

```
Problem: Each itinerary may have 3-5 fare options × 31 rule categories = 150 rule evaluations
         At search time: 72 itineraries × 150 = 10,800 rule evaluations per search

Impact: CPU-bound rule evaluation can add 200-500ms to search response

Mitigations:
1. Lazy evaluation: only evaluate display-relevant rules at search time (refundable, change fee, baggage)
2. Rule cache: fare rules change daily (not per-second); cache evaluated rules per fare basis code
3. Pre-computed fare summaries: batch job that pre-evaluates rules for all active fares
4. Parallel evaluation: distribute across cores for large result sets
```

### Slowest part of the process 5: Payment + Ticketing Saga Failure Modes

```
Problem: Multi-step saga (hold → pay → ticket) crosses multiple external systems
         Any step can fail, leaving inconsistent state

Failure Scenarios and Compensations:
┌─────────────────────────┬──────────────────────────────────────────┐
│ Failure Point           │ Compensation Action                      │
├─────────────────────────┼──────────────────────────────────────────┤
│ Hold succeeds,          │ Cancel GDS PNR, restore local inventory, │
│ payment fails           │ notify user "payment failed"             │
├─────────────────────────┼──────────────────────────────────────────┤
│ Payment succeeds,       │ Auto-retry ticket issuance 3 times;     │
│ ticketing fails         │ if still fails: queue for manual ticket; │
│                         │ DO NOT refund (seat is held, retry later)│
├─────────────────────────┼──────────────────────────────────────────┤
│ Payment captured but    │ Store payment ref, retry from ticket     │
│ system crashes mid-saga │ step on recovery; idempotent operations  │
├─────────────────────────┼──────────────────────────────────────────┤
│ Hold expires during     │ Re-create hold if still available;      │
│ payment processing      │ if not: refund payment, notify user      │
└─────────────────────────┴──────────────────────────────────────────┘

Critical: The most dangerous failure is "payment captured but ticket not issued."
This MUST be handled with an outbox pattern: persist payment success BEFORE
attempting ticketing, so recovery can always complete the ticket step.
```

---

## Deep Dive 4: NDC Offer Lifecycle Management

### The Challenge of Offer-Based Distribution

Traditional GDS distribution uses published fares (filed through ATPCO) that are available to any authorized seller. NDC fundamentally changes this: airlines create **personalized offers** that are time-limited, seller-specific, and may include dynamic bundles that don't map to traditional fare classes.

```
Traditional GDS:
  Search → [Published Fares] → Any seller can book at filed price
  ├── Fares are public, deterministic, and shared
  ├── Same search = same results across all OTAs
  └── Fare class Y is fare class Y everywhere

NDC Offers:
  Search → [Airline creates personalized offer] → Offer tied to this request
  ├── Offers include unique offer_id with TTL (typically 5-30 min)
  ├── Same search from different sellers → potentially different prices
  ├── Offers may include dynamic bundles (seat + 2 bags + lounge = $950)
  └── Price can change if offer expires and is re-requested
```

### Offer Caching Challenge

NDC offers cannot be cached the same way as GDS fare results because:

```
1. Offer IDs are request-specific
   └── Caching by route-date gives wrong offer_id to different users

2. Personalized pricing means different users may get different prices
   └── Loyalty tier, purchase history, channel all affect offers

3. Solution: two-layer approach
   ├── Layer 1: Cache offer structure (flights, schedules, base content) — 15 min TTL
   │   └── Reduces API calls for display purposes
   └── Layer 2: Request fresh offer_id at hold time (always real-time)
       └── This is the NDC equivalent of "re-verify before booking"

4. Optimization: batch offer refresh
   ├── When user browses results page, pre-fetch fresh offers for top 5 viewed itineraries
   └── Reduces perceived latency when user clicks "Book"
```

### NDC Error Handling

| Error Type | GDS Equivalent | NDC Behavior | Handling |
|-----------|---------------|--------------|----------|
| Offer expired | Fare class closed | Offer_id no longer valid; must re-search | Re-request offer; if price changed, show modal |
| Fulfillment failure | Ticketing failure | Airline's system fails to create order | Retry with same offer_id (if still valid); else re-search |
| Partial order | Split PNR | Airline can only fulfill some segments | Offer alternatives for remaining segments; consider GDS fallback |
| Content mismatch | N/A (no rich content in GDS) | Displayed bundle doesn't match fulfillment | Log discrepancy, honor displayed terms, investigate with airline |

---

## Slowest part of the process 6: Multi-Currency Fare Calculation

```
Problem: Fares filed in airline's home currency, displayed in user's local currency,
         charged in user's payment currency — all three may differ

Example:
├── Filed fare: €800 (airline's base)
├── Displayed in search: $885 (at today's EUR/USD rate)
├── User's payment card: GBP → charged £695 (at card network rate)
└── Settlement: airline receives EUR via BSP (at BSP monthly rate)

Exchange rate risks:
├── Search-to-book gap: EUR/USD changes between search (cached) and booking (real-time)
│   └── Mitigation: lock exchange rate at hold time for 15-min TTL
├── Display vs. charge: bank rate differs from platform display rate
│   └── Mitigation: show "approximate" label; final charge in fare currency
├── Settlement timing: BSP settles monthly → 30-day FX exposure
│   └── Mitigation: airline's problem, not OTA's — but affects commission

Performance impact:
├── Currency conversion adds ~5ms per itinerary
├── At 72 itineraries per search: 360ms if sequential
├── Solution: batch conversion API + in-memory rate cache (updated every 5 min)
└── Target: < 10ms total for all conversions per search
```

---

## Slowest part of the process 7: Search Result Ranking Quality

```
Problem: With 72 deduplicated itineraries and 3-5 fare options each, ranking
         determines which results users see first — poor ranking = lower conversion

Current approach (weighted scoring):
├── Price weight: 40% → cheapest flights rank highest
├── Duration weight: 25% → shorter flights rank higher
├── Stops weight: 20% → non-stop > 1-stop > 2-stop
├── Airline preference weight: 15% → user's preferred airlines rank higher

Limitations:
├── Static weights don't account for user context (business vs. leisure)
├── No personalization (all users see same ranking)
├── Connection quality not scored (tight connection = risky)
└── Time-of-day preference not captured

Enhanced approach (ML-based ranking):

FUNCTION mlRankResults(itineraries, userContext):
    FOR EACH itinerary IN itineraries:
        features = {
            // Itinerary features
            price_percentile: percentileRank(itinerary.price, allPrices),
            duration_hours: itinerary.totalDuration / 60,
            num_stops: itinerary.stops,
            min_connection_time_min: min(itinerary.connectionTimes),

            // Time features
            departs_morning: itinerary.departure.hour IN [6, 12],
            departs_evening: itinerary.departure.hour IN [18, 23],
            arrives_next_day: itinerary.arrival.date > itinerary.departure.date,

            // Airline features
            airline_rating: airlineQualityScore(itinerary.operatingCarrier),
            ontime_performance: getOntimeRate(itinerary.operatingCarrier, itinerary.route),

            // User features (if logged in)
            user_searched_airline_before: userContext.previousAirlines.contains(itinerary.carrier),
            user_avg_booking_price: userContext.avgBookingPrice,
            user_trip_type: userContext.inferredTripType  // business vs leisure
        }

        itinerary.rankScore = rankingModel.predict(features)

    RETURN sortByDescending(itineraries, i -> i.rankScore)

Model training:
├── Labels: which itinerary did the user actually book? (implicit feedback)
├── Negative sampling: itineraries shown but not booked
├── Model: LambdaMART (learning-to-rank)
├── Evaluation: NDCG@10 (does the booked result appear in top 10?)
├── Retraining: weekly on last 30 days of booking data
└── Fallback: if model unavailable, use static weighted scoring
```
