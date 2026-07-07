# 12.16 Product Analytics Platform — Deep Dives & Bottlenecks

## Deep Dive 1: Event Ingestion Pipeline

### Architecture Detail

The ingestion pipeline must accept arbitrary event bursts while maintaining ordering guarantees strong enough for downstream funnel computation. The pipeline operates in three stages: collection, queuing, and stream processing.

**Collection tier** operates as a stateless HTTP service pool behind a load balancer. Each collector node:
1. Performs fast syntactic validation (required envelope fields, timestamp sanity check — reject events timestamped more than 7 days in the past or future)
2. Resolves anonymous\_id to user\_id via an identity resolution cache (maintained by an identify() call on login)
3. Enriches the event with geo-IP data and user-agent parsing
4. Checks the per-project bloom filter for duplicate event\_id
5. Writes accepted events to the partitioned message queue

The bloom filter check is the critical optimization: for a project receiving 1M events/day, the bloom filter has a false positive rate of 0.01% (configured for 72-hour lookback window). The filter is implemented as a counting bloom filter to support deletion (necessary for GDPR erasure of queued events).

**Queue partitioning** is by `(project_id HASH % partition_count)`. This ensures all events for a project flow through the same partition, which is critical for session reconstruction and identity stitching. However, this creates a hotspot risk when a single large customer has a traffic spike. Mitigation: overflow routing that detects partition saturation and creates temporary sub-partitions keyed by `(project_id, session_id HASH)` during spike periods.

**Stream processors** maintain a consumer group per partition and perform:
- Identity resolution: `anonymous_id → user_id` mapping (Redis cache, 24h TTL)
- Schema governance: validate against registered event schema if one exists; attach violation flags
- PII scanning: regex patterns for email, phone, SSN, credit card (surface flags; do not block)
- Dual writes: hot columnar store for immediate query availability; Parquet write-ahead for warm store

### Slowest part of the process: Late-Arriving Events

Events arriving up to 72 hours after event\_time create a correctness problem: pre-computed rollups calculated before the late event arrived are now stale. The resolution strategy is a two-phase system:

- **Phase 1 (0–60s):** Events written to hot store; rollups updated in-place atomically via idempotent merge
- **Phase 2 (24–72h):** Late events trigger a recomputation job for the affected date partition only; recomputed results replace stale rollups via a versioned swap (old rollup marked expired; new rollup atomic-committed)

A "staleness flag" is attached to query results that include date ranges with pending late-event recomputation, surfaced to users as "data for DATE may be updated within 72 hours."

### Slowest part of the process: Identity Stitching Across Devices

A user signs up on web (anonymous\_id A), later logs in on mobile (user\_id U). The identify call links U to A. But historical events with anonymous\_id A are already stored—they predate the identify call.

**Problem:** funnel queries that filter by user\_id U will miss the pre-identify web session events.

**Solution:** A graph-based identity table maps anonymous\_id → canonical user\_id. Funnel queries automatically expand user\_id filters through the identity graph: `user_id IN {U, A, ...all aliases}`. The identity graph is stored as a simple hash map in a key-value store (anonymous\_id → canonical\_user\_id), populated on every identify() call and propagated to query nodes on update.

---

## Deep Dive 2: Funnel Computation Engine

### Ordered Step Matching with Conversion Window

The funnel engine's core challenge is enforcing strict temporal ordering across steps while supporting arbitrary property breakdowns and exclusion steps—all within a sub-second query budget.

**Naive approach:** For each user, fetch all events, sort by timestamp, and check for each step in order within the time window. This is O(users × events\_per\_user × steps) and does not parallelize well.

**Production approach:** Decompose into parallel per-step scans, then join:

```
Phase 1: Per-step columnar scan (all steps in parallel)
  For step S with event_name E and filters F:
    Scan events partition WHERE event_name = E AND project_id = P AND date BETWEEN start AND end
    For each matching row: emit (user_id, event_timestamp, property_values)
    Result: user_step_table[S] = sorted list of (user_id, min_timestamp_for_this_step_per_user)

Phase 2: Step intersection with time window
  Start with step_0_users = set of user_ids in user_step_table[0]
  For each subsequent step S:
    Intersect step_S_users with step_{S-1}_users
    For each user in intersection:
      Check: step_S.timestamp >= step_{S-1}.timestamp (ordering constraint)
      Check: step_S.timestamp - step_0.timestamp <= conversion_window
    Remaining users form step_S qualified set

Phase 3: Breakdown computation
  For each breakdown dimension (e.g. "platform"):
    For each unique value of platform:
      Count qualified users at each step whose platform = value
```

The critical optimization is that Phase 1 scans run in parallel across storage tiers, and the result sets are small (one row per user per step, not one row per event per user). Even for 10M users with 5 steps, each step result set is 10M rows × 24 bytes = 240MB—fits in working memory per query worker.

### Exclusion Steps

An exclusion step filters out users who performed a disqualifying event between step N and step N+1. Implementation:

```
exclusion_bitmap = set of users who hit exclusion_event between step_N and step_N+1
qualified_step_N = qualified_step_N AND_NOT exclusion_bitmap
```

Exclusion steps increase query complexity but not asymptotic complexity—they add one parallel scan per exclusion step.

### Time-Window Per-Step vs. Global

Two time window modes exist:
1. **Global window:** User must complete all steps within conversion\_window from step 0 (simpler, common)
2. **Per-step window:** Each consecutive step pair has its own time limit (more granular, rarer)

The per-step window requires tracking the timestamp at each step for each user rather than just the step-0 timestamp, increasing memory by a factor of (number of steps). For large funnels, this is mitigated by streaming the computation step by step and discarding previous timestamps.

---

## Deep Dive 3: Retention Engine

### Cohort Matrix Pre-Computation

Retention queries are expensive when computed fully ad hoc: a 12-week retention chart over a 6-month window requires 72 individual "did user return in week X after cohort week Y?" lookups, each scanning weeks of events. The retention engine pre-materializes the cohort matrix incrementally.

**Incremental retention update:** When a return event is received for user U:
1. Look up U's cohort membership (which cohort periods does U belong to, for which return events?)
2. For each cohort membership, determine which return period this event falls into
3. Atomically set `retention_matrix[cohort_period][return_period].add(U)` on the cohort bitmap

This transforms retention computation from a batch query into a streaming update: each returning event adds one user to one cell of the matrix. The matrix is a 2D array of roaring bitmaps stored in the hot store, synced periodically to the warm/cold stores.

**Query-time computation:** When a retention query arrives, the engine:
1. Fetches the pre-computed cohort bitmaps for the requested time range
2. Computes cardinality of each cohort-period × return-period bitmap pair
3. Divides by cohort size to produce retention percentages
4. Applies any requested breakdown by fetching sub-cohorts split by property value

This reduces retention query time from O(events_in_window) to O(cohort_periods × return_periods) — typically a 100× speedup.

### Defining "Return"

Different retention definitions require careful engine support:

- **N-Day retention (strict):** User must have a return event on exactly calendar day N (not day N+1, not day N-1). Used for engagement analytics.
- **Unbounded retention:** User must have a return event on or after day N. Once a user returns, they stay "retained" for all subsequent periods. Used for billing retention.
- **Bracket retention:** User must have a return event within day ranges [D1, D2]. Used for periodic products (weekly users, monthly subscribers).

Each definition produces a different cohort matrix structure. The engine parameterizes on retention\_type and generates the correct matrix-building logic.

---

## Deep Dive 4: Path Analysis Engine

### Session Reconstruction at Scale

Path analysis requires reconstructing ordered event sequences per session—a fundamentally different access pattern from funnel queries (which access events by user\_id, not session\_id). The columnar event store is sorted by user\_id, not session\_id, so session reconstruction requires a secondary index or a separate session-ordered store.

**Secondary session index:** A compact index maps `(project_id, session_id) → list of (event_offset, event_name, timestamp)`. This index is much smaller than the full event store (no properties, just names and timestamps) and fits in warm storage with fast random access. Path queries look up session IDs in the index, then fetch full event details only for sessions containing the anchor event.

**Session timeout handling:** A session is defined as a sequence of events from one user with no gap > session\_timeout (default 30 min). Sessions are reconstructed at write time by the stream processor: when a new event arrives with a gap > 30 min from the previous event for that anonymous\_id, a new session\_id is assigned.

### Top-N Path Cutting off unnecessary steps

A naive path graph can have millions of unique edges (every distinct event-to-event transition). For visualization, only the top N edges (by frequency) are returned. Cutting off unnecessary steps strategy:

1. Build the full edge count map during scan
2. Apply minimum edge weight threshold: discard edges with count < 1% of anchor event count
3. Sort remaining edges by weight descending
4. Return top N edges, ensuring graph is connected (no dangling nodes)
5. Aggregate all pruned paths into a single "(other)" node at each depth level

---

## Deep Dive 5½: Session Replay Integration Architecture

### Linking Quantitative and Qualitative Data

Session replay records DOM mutations, network requests, and console errors — producing a video-like recording of user sessions. The analytics platform links every quantitative event to its corresponding replay via a shared `session_id`.

**Architecture:** The replay SDK (rrweb-based) runs alongside the analytics SDK. Both share a `session_id`. Replay data is stored separately from the columnar event store — replay data is sequential, not columnar, and requires a different storage model.

```
Replay storage model:
  session_id         STRING     -- Links to analytics events
  project_id         STRING
  recording_start    TIMESTAMP
  recording_end      TIMESTAMP
  full_snapshot      BINARY     -- Initial DOM state (compressed HTML tree)
  mutations          LIST<{     -- Incremental DOM changes
    timestamp: TIMESTAMP,
    type: STRING,              -- "attributes" | "childList" | "scroll" | "input"
    target_xpath: STRING,
    payload: BINARY
  }>
  network_requests   LIST<{timestamp, method, url, status_code, duration_ms}>
  console_logs       LIST<{timestamp, level, message}>
  session_score      FLOAT      -- Computed frustration score
```

**Session scoring algorithm:**
```
FUNCTION compute_session_score(session):
  score = 0.0
  score += MIN(count_rage_clicks(session) * 0.15, 0.5)      // Rage clicks
  score += MIN(count_js_errors(session) * 0.10, 0.3)        // Console errors
  score += MIN(count_dead_clicks(session) * 0.05, 0.2)      // Dead clicks
  score += MIN(count_network_errors(session) * 0.10, 0.3)   // 4xx/5xx
  score += MIN(count_slow_requests(session, 5000) * 0.05, 0.2) // > 5s requests
  RETURN MIN(score, 1.0)  // Normalized [0,1]; higher = more frustrated
```

**Funnel-to-replay linkage:** When an analyst sees a 60% drop-off at step 2, clicking "Watch sessions" returns sessions where users dropped off, ordered by frustration score:
```
SELECT session_replay_id FROM events
WHERE project_id = P
  AND user_id IN step_2_bitmap.AND_NOT(step_3_bitmap)
  AND session_replay_id IS NOT NULL
ORDER BY session_score DESC
LIMIT 10
```

---

## Deep Dive 6: Query Cache Invalidation Strategy

### The Freshness-Consistency Trade-off

Query caching faces a unique challenge: new events arrive continuously, meaning any cached result involving recent data becomes stale within seconds. Re-executing expensive queries on every request would collapse throughput.

**Two-tier invalidation model:**

**Tier 1 — TTL-based (time-bounded staleness):**
- Historical queries (date range ends > 48h ago): TTL = 30 minutes
- Recent data queries (includes today/yesterday): TTL = 5 minutes
- Dashboard queries (streaming rollup): TTL = 60 seconds

**Tier 2 — Partition-versioned (event-driven):**
- Each storage partition has a monotonic version number
- New events increment the version
- Cached results store dependency lists: `[(partition_key, version_at_cache_time)]`
- Cache lookup checks if any dependent partition version advanced
- If advanced → cache entry stale → re-execute

**Optimization:** Most queries span many partitions. The router maintains a per-project "latest partition update" timestamp — if `cached_at > latest_update` for all dependencies, the entry is valid without per-partition checks.

---

## Algorithm Complexity Analysis

| Algorithm | Time Complexity (Speed of the algorithm) | Space Complexity (Memory usage of the algorithm) | Key Variable |
|---|---|---|---|
| Funnel step scan (per step) | O(events in date range) | O(matching users) | Columnar predicate pushdown reduces effective events |
| Bitmap intersection (per step pair) | O(n/64) where n = users | O(n/8) per bitmap | SIMD-accelerated on modern CPUs |
| Retention matrix build | O(cohort_periods × events) | O(periods² × bitmap size) | Pre-materialized bitmaps reduce to O(1) per query |
| Path analysis session scan | O(sessions × avg_session_length) | O(unique_edges) | Secondary session index avoids full event scan |
| Behavioral cohort evaluation | O(criteria × events_in_window) | O(users per criterion) | Criteria scans run in parallel |
| HyperLogLog count | O(events) insert, O(1) merge | O(1KB) per sketch | 0.8% error; mergeable across partitions |
| Bloom filter dedup check | O(1) per event | O(12 bits/element) | False positive rate: 0.01% at configured size |
| Property promotion scoring | O(query_log_size × properties) | O(distinct properties) | Runs asynchronously; not on query path |

---

## Race Conditions & Edge Cases

### Race Condition 1: Concurrent Rollup Updates

When two stream processor instances attempt to update the same rollup cell for the same time window, concurrent writes can produce incorrect aggregates (lost update problem).

**Resolution:** Each rollup cell write uses compare-and-swap (CAS) semantics. The stream processor reads the current value, computes the new value, and CAS-writes. On conflict, it retries. For high-frequency rollup cells (popular events in large projects), contention can cause retry storms.

**Mitigation:** Use per-processor partial rollups: each processor maintains its own rollup accumulator and flushes to the shared rollup store every 10 seconds. The flush operation uses a merge function (addition for counts, bitmap union for distinct users) rather than a pure write, which is commutative and idempotent. This reduces CAS contention by 10–100× at the cost of 10s rollup staleness.

### Race Condition 2: Identity Resolution During Funnel Query

If a user performs step 1 as anonymous, then identify()s, then performs step 2 as user\_id, and a funnel query runs during this window, the funnel engine may not connect the two events.

**Resolution:** Identity resolution is applied at query time, not just at ingestion time. The funnel query expands user\_id filters through the current state of the identity graph. This means even pre-identify events are correctly attributed to the user's canonical ID when queries run after identification.

### Edge Case (Unusual or extreme situation): Events with Future Timestamps

Client clocks can be wrong, causing events to arrive with timestamps up to hours or days in the future. Accepting these events would corrupt date partitions.

**Resolution:** Server-assign a `server_received_at` timestamp. Use `client_timestamp` for user-facing analytics (preserves intended event order within sessions) but use `server_received_at` for partition placement. Events with `client_timestamp` more than 7 days in the future are rewritten to `server_received_at` with a flag indicating clock skew.

### Edge Case (Unusual or extreme situation): Extremely High-Cardinality Property Values

A property like `user_email` or `full_url` can have as many unique values as events, destroying dictionary encoding efficiency and causing massive bloom filter and index overhead.

**Detection:** Governance scorer computes cardinality of each property per day. Properties with cardinality > 1M within a 24-hour window are flagged as high-cardinality. Affected properties are excluded from breakdown dimensions and their dictionary encoding is replaced with direct storage.

### Edge Case (Unusual or extreme situation): Cohort Size Explosion in Retention Queries

When a retention query uses a very broad cohort event (e.g., "any page view"), the cohort size can reach hundreds of millions of users. The retention matrix has size `cohort_periods × return_periods`, and each cell requires a bitmap intersection with the cohort bitmap. For a 52-week retention chart with weekly cohorts over 12 months, that is 52 × 52 = 2,704 bitmap intersections against bitmaps of 100M+ users.

**Resolution:** Pre-filter cohort resolution by only building bitmaps for cohort sizes below a configurable threshold (default: 10M users). For larger cohorts, switch to HyperLogLog-based approximate retention (merging return-period HLL sketches with cohort HLL sketches for intersection cardinality estimation via the inclusion-exclusion principle). The approximation error (~2%) is acceptable for large cohorts where individual user-level precision is not actionable.

### Edge Case (Unusual or extreme situation): Session Timeout Boundary in Path Analysis

A user performs events at minutes 0, 15, and 29 (within one session), then event at minute 31 (new session if timeout = 30 min). Path analysis that reconstructs sessions at query time may disagree with session IDs assigned at ingestion time if clock skew exists between client and server timestamps.

**Resolution:** Session boundaries are always determined by `server_received_at`, not `client_timestamp`, ensuring consistency between session IDs assigned at ingestion time and session reconstruction at query time. A tolerance of ±5 seconds is applied at the boundary to avoid splitting events that arrive within the grace period.

### Edge Case (Unusual or extreme situation): Funnel with Repeated Event Names

A funnel where the same event appears at multiple steps (e.g., "page\_viewed → form\_submitted → page\_viewed") requires distinguishing the first "page\_viewed" from the second. Naive bitmap intersection counts users who performed the event twice, but does not enforce that the second occurrence is after the intermediate step.

**Resolution:** The funnel engine tracks per-user per-step timestamps, not just membership. For step N with the same event\_name as step M (M < N), the timestamp for step N must be strictly after the timestamp for step M+1 (the intermediate step). This is enforced during the sequential intersection phase, not during the parallel scan phase.

### Race Condition 3: GDPR Erasure During Active Query

A GDPR erasure request arrives for user\_id U while a funnel query that includes U's events is mid-execution. If the erasure marks the user's events as deleted before the query completes, partial results may include U at earlier steps but not later steps — producing inconsistent conversion counts.

**Resolution:** GDPR soft deletion is implemented as a query-time filter, not a storage-time mutation. The erasure adds user\_id U to a per-project exclusion bitmap. Active queries that started before the erasure complete using the pre-erasure bitmap state (snapshot isolation). Queries starting after the erasure will exclude U's events. Hard deletion (Parquet rewrite) happens asynchronously and does not affect in-flight queries.

### Edge Case (Unusual or extreme situation): Identity Merge Creating Cycles

If identify(A → U) and then identify(U → A) are both processed (due to SDK bugs or race conditions), the identity resolution graph contains a cycle. Query-time identity expansion would loop infinitely.

**Resolution:** The identity resolution service enforces a directed acyclic graph (DAG) constraint: each anonymous\_id can only point to one canonical user\_id, and canonical user\_ids cannot point to other user\_ids. The second identify(U → A) is rejected as invalid because U is already a canonical user\_id. If detected post-factum, cycle breaking selects the user\_id with the earliest first\_seen timestamp as canonical and redirects all other IDs to it.

### Edge Case (Unusual or extreme situation): Rollup Timestamp Boundary Mismatch

A stream processor writes an event at 23:59:59 UTC. The event's `client_timestamp` is 00:00:01 UTC the next day (1-second clock skew). The event is partitioned by `event_date` derived from `client_timestamp` (Day 2), but the streaming rollup aggregates it into the Day 1 hourly bucket (based on `server_received_at`). Dashboard counts for Day 1 and Day 2 are both slightly wrong — the event appears in Day 2 partitions but Day 1 rollups.

**Resolution:** Rollup aggregation uses `event_date` (derived from `client_timestamp`) for consistency with the storage partition key. The stream processor aligns its rollup time bucket with the partition key, not with `server_received_at`. This introduces a brief staleness for events where `client_timestamp` differs from `server_received_at` by more than the rollup window, but maintains count consistency between rollups and raw scans.

---

## Locking Strategy

| Resource | Lock Type | Scope | Duration |
|---|---|---|---|
| Bloom filter update | Lock-free CAS | Per-project partition | Microseconds |
| Rollup cell update | Optimistic CAS with retry | Per (project, date, hour, event) cell | Milliseconds |
| Retention bitmap update | Lock-free atomic bitmap OR | Per matrix cell | Microseconds |
| Identity graph update | Row-level lock in KV store | Per anonymous\_id | Milliseconds |
| Compaction file write | Exclusive partition lock | Per (project, date, event) partition | Seconds–minutes |
| Query result cache write | Lock-free with TTL race tolerance | Per query hash | Microseconds |
| GDPR exclusion bitmap update | Atomic append to exclusion set | Per project | Microseconds |

---

## Deep Dive 7: Event Taxonomy Governance Engine

### The Governance Problem at Scale

At a platform serving 50,000 product teams, event taxonomy naturally degrades without active intervention. Common failure patterns:

1. **Naming collisions:** Teams independently instrument `button_click` with completely different semantics
2. **Schema drift:** A property `amount` starts as an integer, then some implementations send strings
3. **Orphaned events:** Events that are no longer emitted but still exist in dashboards and funnels
4. **Property proliferation:** A single event type acquires 200+ properties, most used by only one team

### Governance Architecture

The governance engine operates as a sidecar to the ingestion pipeline, not as a gate:

```
FUNCTION score_event_governance(event, registered_schemas):
  score = 100  // Start at perfect
  violations = []

  // Check 1: Event name registration
  schema = registered_schemas.GET(event.project_id, event.event_name)
  IF schema IS NULL:
    score -= 20
    violations.APPEND("UNREGISTERED_EVENT")
  ELSE:
    // Check 2: Required properties present
    FOR required_prop IN schema.required_properties:
      IF required_prop NOT IN event.properties:
        score -= 10
        violations.APPEND("MISSING_REQUIRED:" + required_prop)

    // Check 3: Type consistency
    FOR prop_key, prop_value IN event.properties:
      IF prop_key IN schema.property_types:
        expected_type = schema.property_types[prop_key]
        actual_type = infer_type(prop_value)
        IF actual_type != expected_type:
          score -= 5
          violations.APPEND("TYPE_MISMATCH:" + prop_key)

    // Check 4: Unexpected properties
    known_props = schema.all_known_properties
    FOR prop_key IN event.properties.KEYS():
      IF prop_key NOT IN known_props:
        score -= 2  // Mild penalty: new properties are often intentional
        violations.APPEND("UNKNOWN_PROPERTY:" + prop_key)

  RETURN (score, violations)
```

### Governance Metrics Dashboard

Each project sees a data quality dashboard showing:
- Per-event-type quality score (rolling 7-day average)
- Top violations by frequency
- Property coverage map (which registered properties are actually being sent)
- Schema drift timeline (when type mismatches first appeared)
- Event volume trend with "zombie event" detection (events that stopped being sent)

---

## Slowest part of the process 3: Cardinality Explosion in Multi-Dimensional Breakdowns

### The Problem

A funnel query with `breakdown: ["country", "plan", "platform", "browser"]` creates a cross-product of all dimension values. If country has 200 values, plan has 5, platform has 3, and browser has 20, the breakdown produces 200 × 5 × 3 × 20 = 60,000 cells. Each cell requires a bitmap intersection to count qualifying users. Most cells will be empty or have trivially small counts, but the computation cost is proportional to the total cell count, not the non-empty count.

### Resolution

```
FUNCTION compute_breakdown_with_pruning(step_bitmaps, breakdown_dims, project_id):
  // Phase 1: Estimate cardinality per dimension
  dim_cardinalities = {}
  FOR dim IN breakdown_dims:
    dim_cardinalities[dim] = estimate_distinct_values(project_id, dim)

  total_cells = PRODUCT(dim_cardinalities.VALUES())

  // Phase 2: Apply cardinality limits
  IF total_cells > MAX_BREAKDOWN_CELLS (default: 10,000):
    // Strategy: Reduce high-cardinality dimensions to top-N values
    FOR dim IN sorted_by_cardinality_desc(breakdown_dims):
      IF total_cells <= MAX_BREAKDOWN_CELLS:
        BREAK
      top_n = MIN(dim_cardinalities[dim], 50)  // Cap at top 50
      dim_cardinalities[dim] = top_n + 1  // +1 for "Other" bucket
      total_cells = PRODUCT(dim_cardinalities.VALUES())

  // Phase 3: Compute breakdown with pruned dimensions
  // Group remaining values into "Other" bucket
  RETURN breakdown_with_other_bucket(step_bitmaps, breakdown_dims, dim_cardinalities)
```

This approach ensures breakdown queries always return within latency SLOs regardless of input dimension cardinality, at the cost of potentially grouping long-tail values into an "Other" category.

### Slowest part of the process 4: Hot Partition Skew in Multi-Tenant Ingestion

A single "whale" tenant generating 5 billion events/day (50% of total platform volume) creates asymmetric load that can overwhelm the partition assigned to that project\_id, causing queue lag that spills over to affect all tenants sharing the same queue broker.

**Root cause:** The message queue is partitioned by `project_id HASH`, meaning all events for a whale project flow through a single partition. A partition has a throughput ceiling (typically 10–50 MB/s per partition), and a whale tenant can exceed this.

**Resolution:** Adaptive sub-partitioning with transparent fan-out:

```
FUNCTION route_event_to_partition(event):
  base_partition = HASH(event.project_id) % NUM_PARTITIONS

  // Check if this project is flagged as high-volume
  IF project_volume_tier[event.project_id] == "whale":
    sub_partition = HASH(event.session_id) % WHALE_SUB_PARTITIONS
    RETURN base_partition * WHALE_SUB_PARTITIONS + sub_partition
  ELSE:
    RETURN base_partition
```

The query router is aware of sub-partitioning and fans out queries to all sub-partitions for whale tenants, merging results transparently.

---

## Real-World Case Studies

### Case Study 1: Spotify — Understanding Playlist-to-Purchase Conversion

**Scale:** 600M monthly active users, 4B events/day, 200+ event types

**Challenge:** Spotify needed to understand the journey from playlist creation to premium subscription — a multi-week funnel that spans anonymous listening sessions and authenticated account actions. The funnel crosses identity boundaries (anonymous listener → free account → premium subscriber) and has a conversion window measured in weeks, not minutes.

**Architecture choices that mattered:**
- Identity stitching graph with 3-level resolution: device\_id → anonymous\_id → user\_id, enabling attribution of pre-registration listening behavior to eventual subscribers
- Unbounded retention model: "did the user ever subscribe after creating a playlist?" rather than strict N-day retention
- Property breakdown by playlist genre, demonstrating that users who create niche genre playlists convert 3× more than users creating mainstream pop playlists

**Key metric:** Funnel queries over 600M users with 4 steps and 21-day conversion window completing in < 1.5 seconds using bitmap intersection with partitioned parallel step scans.

### Case Study 2: Shopify — Merchant Analytics at Massive Multi-Tenant Scale

**Scale:** 4.4M merchant stores, each a separate analytics tenant, 12B events/day across all stores

**Challenge:** Extreme multi-tenancy skew: 99% of merchants generate <10K events/day, but the top 100 merchants generate 50% of all events. The system must provide sub-second query performance for small merchants while preventing whale merchants from starving shared resources.

**Architecture choices that mattered:**
- Tenant-tiered storage: small merchants share pooled storage with row-level isolation; whale merchants get dedicated storage partitions and query worker pools
- Fair-scheduling query quotas: each merchant gets a proportional share of query compute based on their plan tier, not their data volume
- Rollup-first query routing: small merchants' queries almost always hit materialized views (their data is small enough to pre-aggregate fully); whale merchants' ad hoc queries hit cold columnar scans with dedicated compute

**Key metric:** 99th percentile of small-merchant funnel queries: 320ms (served entirely from rollups). 99th percentile of whale-merchant funnel queries: 4.2s (cold scan with full parallel decomposition).

### Case Study 3: Duolingo — Retention as the Core Product Metric

**Scale:** 100M monthly active learners, 2B events/day, retention is the primary KPI that drives all product decisions

**Challenge:** Duolingo measures retention not by simple N-day return, but by "streak continuation" — a learner must complete at least one lesson each day to maintain their streak. The retention definition is tightly coupled to the product's core mechanic, requiring custom retention computation that differs from standard N-day retention.

**Architecture choices that mattered:**
- Custom bracket retention with per-user streak state: the retention engine maintains a per-user bitmap of "active days" and computes streak lengths as contiguous runs in the bitmap
- Real-time streak update: each "lesson\_completed" event immediately updates the user's active-day bitmap in the hot store, ensuring the dashboard shows live streak counts
- Cohort segmentation by learning language, device platform, and notification opt-in status — enabling A/B tests on notification timing to optimize streak retention

**Key metric:** Streak-based retention computation for 100M users across 52-week cohorts: 2.1 seconds (pre-materialized streak bitmaps with incremental daily update, avoiding full re-scan).
