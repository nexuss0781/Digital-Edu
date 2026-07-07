# 04 — Deep Dives and Bottlenecks: Customer Data Platform

## Deep Dive 1: Identity Resolution Engine

### The Core Problem

Identity resolution is the hardest correctness problem in a CDP. A single user might appear as dozens of distinct records — an anonymous browser session, a mobile app user, an email newsletter subscriber, a CRM contact — before ever authenticating. When they log in, the CDP must stitch all of these fragments into one coherent profile. The challenge is that this stitching must happen in milliseconds, under concurrent load, in a distributed environment where the same user may be generating events on multiple devices simultaneously.

### Identity Cluster Structure

The identity graph maintains connected components (clusters) of identifier nodes. Every node has a `profile_id` pointing to the canonical unified profile for that cluster. A cluster might look like:

```
anonymous_id: "anon_abc" ── [session_link] ── user_id: "user_xyz"
                                                     │
device_id: "dev_001" ─── [device_link] ──────────────┘
                                                     │
email_hash: "sha256_..." ─── [auth_link] ────────────┘
```

All four nodes point to the same `profile_id`. The BFS traversal to find all nodes in a cluster is O(k) where k is the cluster size — typically 2–10 nodes for consumer CDPs, up to 50 for B2B accounts with many device sharing.

### Merge Conflicts Under Concurrency

The most dangerous scenario is a **concurrent merge**. Consider two streams arriving simultaneously:

- Stream A: Event with `anon_id: X` + `user_id: U1` → links X to profile P1
- Stream B: Event with `anon_id: X` + `user_id: U2` → links X to profile P2

Without coordination, both writes succeed, and `anon_id: X` ends up pointing to two different profiles. The resolution is to acquire a distributed lock keyed on a deterministic hash of the sorted identifier set before any merge. This serializes concurrent merges on overlapping clusters. Locks are short-lived (held for < 100ms) and implemented with a compare-and-swap operation in the identity graph's backing store.

### Survivorship Rules

When merging N profiles into one survivor, trait values must be reconciled. The platform applies configurable survivorship rules:

| Trait Type | Default Survivorship Rule |
|---|---|
| PII traits (email, phone, name) | Most recently updated value wins |
| Account traits (plan, tier) | Highest-authority source wins (priority-ranked sources) |
| Behavioral computed traits | Re-computed from merged event history |
| Audience memberships | Union of all memberships from all merging profiles |
| Consent state | Most restrictive consent wins (can only escalate, not relax) |

### Profile Fragmentation and the Split Problem

The inverse of merge is **split** — when two profiles that were merged are found to be distinct individuals (e.g., a shared device). Splits are rare but catastrophic if handled incorrectly. A naive split is impossible if downstream systems have already ingested the merged profile. The production approach is **soft split**: create a new profile for the newly-distinguished individual, migrate only clearly-owned identifiers to the new profile, and retain a "split-from" link for audit. Any events received before the split timestamp remain attributed to the original profile.

### Identity Resolution Accuracy Metrics

```
Precision = True Merges / (True Merges + False Merges)
Recall    = True Merges / (True Merges + Missed Merges)

For deterministic matching:  Precision ~99.9%, Recall limited by data completeness
For probabilistic matching:   Precision ~85–95% (tunable via confidence threshold)
```

A false merge (two distinct people merged into one profile) is far more harmful than a missed merge (two records for the same person remaining separate), because it contaminates profile data for both individuals and can cause incorrect personalization or consent violations. Production CDPs default to conservative merge thresholds for probabilistic matching.

---

## Deep Dive 2: Real-Time Audience Engine

### Streaming CEP Architecture

The streaming segment evaluator processes every event that enters the CDP and checks whether it causes any profile to enter or exit an audience. The key data structure is a **segment index** — a pre-compiled, inverted index from event names and trait names to the set of segment IDs that contain rules referencing them.

```
segment_index["Product Viewed"] = { seg_001, seg_042, seg_117, ... }
segment_index["trait:total_spend"] = { seg_003, seg_089, ... }
```

When an event arrives, the evaluator does an O(1) lookup in this index to find the relevant segments, then evaluates only those segments — not all 50,000. This brings per-event evaluation cost from O(S) to O(k) where k is the average number of segments referencing a given event type, typically 5–50.

### Stateful Event Count Tracking

Many segment rules reference event counts within a time window: "User viewed product at least 3 times in the last 7 days". This requires maintaining per-user event count state. Two approaches:

**Approach A: In-profile event counts** — Store a sliding window count map on the profile document: `{ "Product Viewed:7d": 12, "Order Completed:30d": 3 }`. Updated atomically on each event. Fast to read, but requires careful TTL management and increases profile document size.

**Approach B: Separate time-series store** — Maintain event counts in a separate key-value store (profile_id + event_name + window → count). Decoupled from profile writes but requires an extra read hop during segment evaluation.

Production CDPs use Approach A for hot windows (≤ 30 days) and Approach B or batch recomputation for longer windows.

### Batch Path for Complex Segments

Segments that cannot be expressed as streaming rules (because they require historical aggregations, full-table scans, or SQL window functions) are evaluated on a batch schedule:

1. **Segment scheduler** triggers batch refresh based on configured cron or on profile-dirty events
2. **Query compiler** translates the segment SQL into an optimized query against the event store + profile store
3. **Incremental evaluator** identifies profiles that had relevant events since the last refresh (the "dirty set") and evaluates only those profiles
4. **Membership writer** upserts audience membership for all profiles in the dirty set

The incremental approach reduces batch refresh cost dramatically: instead of scanning all 1B profiles every 15 minutes, only the ~1-5% of profiles that received events since the last refresh are re-evaluated.

### Consistency Between Streaming and Batch Paths

A profile's segment membership may be partially evaluated by the streaming path and partially by the batch path. For segments with dual evaluation (streaming for some rules, batch for others), a reconciliation pass runs after each batch refresh to ensure the final membership state is consistent with both evaluation results.

---

## Deep Dive 3: Destination Fan-out System

### Fan-out Topology

At 43B events/day fanning out to an average of 5 destinations each, the delivery subsystem processes ~215B deliveries/day — about 2.5M per second at peak. The fan-out topology is:

```
Profile Update Event
        │
        ▼
Fan-out Router (determines relevant destinations based on filters + consent)
        │
        ├──► Destination Queue A (CRM connector — real-time webhook)
        ├──► Destination Queue B (Ad platform — batch every 6h)
        ├──► Destination Queue C (Email platform — real-time webhook)
        └──► Destination Queue D (Warehouse sync — continuous streaming)
```

Each destination queue is an independent durable queue (backed by the same streaming infrastructure as the ingest queue). The fan-out router is a stateless service that reads from the profile update event stream and writes to per-destination queues. It applies:

1. **Destination filter matching**: does this event type match the destination's event filter?
2. **Audience filter matching**: is the user in the required audience for this destination?
3. **Consent check**: does the user have the required consent purposes for this destination?
4. **Schema transformation**: map CDP event/profile fields to destination-specific payload structure

### Rate Limiting and Backpressure

Different destination APIs have wildly different rate limits — a webhook destination might accept 10K/sec; an email platform might accept 100/sec. The delivery worker for each destination enforces its configured rate limit using a token bucket algorithm. When the bucket is exhausted, the worker pauses dequeuing and waits for the bucket to refill.

This backpressure naturally causes the destination's queue to grow. The system monitors queue depth per destination:

- **Warning threshold** (e.g., 1M messages): alert but continue
- **Critical threshold** (e.g., 10M messages): pause new fan-out for this destination, prioritize draining
- **Overflow threshold** (e.g., 100M messages): activate queue overflow to object storage (spillover), alert on-call

### Idempotent Delivery

Because the delivery system guarantees at-least-once delivery, it must handle the case where a delivery succeeds at the destination but the acknowledgment is lost (causing a retry). Each delivery record contains a `delivery_id` (stable UUID computed from the trigger event ID + destination ID). Destinations that support idempotency keys receive this ID in a request header. For destinations that do not support idempotency, the delivery worker uses a short-lived deduplication bloom filter (TTL: 72 hours) to detect recently-delivered IDs and skip re-delivery.

### Circuit Breaker Per Destination

Each destination's delivery worker maintains an independent circuit breaker with three states:

- **Closed** (normal): all deliveries attempted
- **Open** (failing): deliveries not attempted, error returned immediately; re-attempts scheduled at half-open intervals
- **Half-open**: one test delivery attempted; if successful, circuit closes; if failed, circuit stays open

Opening the circuit prevents cascading load on a struggling destination. It also prevents queue buildup — messages accumulate at a controlled rate with a clear TTL rather than indefinitely.

---

## Deep Dive 4: Event Pipeline and Schema Registry

### Schema Registry Architecture

The schema registry stores the canonical shape of every registered event type. At ingest, before an event enters the processing queue, it is validated against the schema for its event name. Invalid events go to a dead-letter queue with full metadata for debugging.

Schema evolution is a critical operational concern:

| Change Type | Classification | Handling |
|---|---|---|
| Add optional property | Additive (safe) | Allowed; old consumers ignore new field |
| Add required property | Breaking | Blocked or requires new schema version |
| Remove property | Breaking | Blocked; use deprecation flag then remove after migration |
| Change property type | Breaking | Blocked unless widening (e.g., int → float) |
| Rename property | Breaking | Blocked; add new + deprecate old |
| Change event name | Breaking | Blocked; alias old name to new with migration |

Schema versions are stored with their validity period. The registry supports both backward compatibility (new schema can read old data) and forward compatibility (old schema can read new data). The default mode is backward-compatible: consumers can handle events from older schema versions.

### Event Deduplication

SDKs implement retry logic, which means the platform must handle duplicate events. Deduplication is performed at the ingest edge using the event's `event_id` (UUID, client-generated):

```
FUNCTION deduplicateEvent(event: EventRecord) -> Bool:
  // Bloom filter for fast negative check (probabilistic, ~0.1% false positive rate)
  IF NOT deduplication_bloom_filter.mightContain(event.event_id):
    deduplication_bloom_filter.add(event.event_id)
    RETURN false  // not a duplicate

  // Bloom filter positive: confirm with exact lookup (last 24h window)
  IF exact_dedup_cache.exists(event.event_id):
    metrics.increment("event.duplicate_rejected")
    RETURN true  // confirmed duplicate

  exact_dedup_cache.set(event.event_id, TTL=24h)
  RETURN false  // false positive from bloom filter
```

The combination of a bloom filter (O(1) fast path) and exact cache (O(1) confirmation for bloom positives) keeps deduplication efficient even at millions of events per second.

---

## Race Conditions and Edge Cases

### Race Condition 1: Concurrent Profile Updates

Two events for the same user arrive simultaneously and both attempt to update the same profile. Without coordination, the second write may overwrite the first.

**Solution**: Profile writes use optimistic concurrency control — each write includes the current profile `version` field. If the version has changed since the read, the write fails and retries. Combined with CRDT-style merge semantics for the trait map (last-writer-wins per trait key), profile updates are safe under concurrent writes.

### Race Condition 2: Consent Change During Fan-out

A user revokes consent at the same moment a profile update is being fanned out to destinations.

**Solution**: The fan-out router re-checks consent at the time of dequeuing from the destination queue, not just at the time of enqueueing. This "consent at delivery" check ensures that consent changes take effect within one dequeue cycle (typically seconds). A small window of non-compliance is possible; logging captures any deliveries that occurred between consent revocation and the effective cutoff.

### Race Condition 3: Erasure During Active Processing

An erasure request arrives while events for the subject are still in the ingest queue.

**Solution**: The erasure pipeline first marks the profile as `erasure_requested` in a fast-path lookup table. The event processor checks this lookup before writing to the profile store. Events that arrive after the erasure flag is set are dropped (not processed). The erasure pipeline then proceeds to delete the profile from each storage tier in order of sensitivity (live stores first, archives last), issuing a signed deletion receipt for each.

### Slowest part of the process Analysis

| Slowest part of the process | Root Cause | Solution |
|---|---|---|
| **Identity graph hot partitions** | High-traffic profiles (e.g., bot traffic, test accounts) create hot nodes in the graph DB | Per-node write rate limiting; bot detection to filter noise before identity processing |
| **Profile write contention** | High-frequency event streams for a single user cause many concurrent profile updates | Event batching window (100ms) before profile write; CRDT merge at write |
| **Fan-out queue depth spike** | Viral campaign triggers massive audience entry event for millions of profiles simultaneously | Throttled fan-out with configurable emission rate per destination; spillover to object storage |
| **Batch segment refresh latency** | Full re-scan of 1B profiles is too slow for 15-min refresh cycle | Incremental evaluation on dirty profiles only; pre-aggregate event counts in materialized views |
| **Schema validation throughput** | Parsing and validating JSON schema for every event at 2M events/sec is CPU-intensive | Pre-compiled schema validators cached per event type; async validation for non-critical event types |

---

## Deep Dive 5: Computed Traits Engine

### Why It Is Critical

Computed traits transform raw event streams into actionable profile attributes — "total purchases in last 30 days," "days since last login," "lifetime revenue." These traits are the primary inputs to audience segment rules and are the single most-queried field on a profile during personalization requests. A stale or incorrect computed trait directly causes wrong audience membership and wrong personalization.

### Architecture

Computed traits have two evaluation modes:

**Real-time computed traits** (event-triggered): Updated on every qualifying event. Example: `total_purchases_30d` increments when an "Order Completed" event arrives.

**Scheduled computed traits** (batch-triggered): Recomputed on a schedule or when a dependency changes. Example: `days_since_last_login` must decrement daily regardless of event arrival.

```
ComputedTraitDefinition:
    trait_name:          string
    workspace_id:        string
    input_events:        list<string>     // Event types that trigger recomputation
    aggregation_type:    enum { count | sum | min | max | avg | first | last | unique_count }
    aggregation_field:   string?          // Property to aggregate (null for count)
    time_window:         duration?        // Rolling window (null for all-time)
    filter_condition:    expression?      // Optional filter on input events
    evaluation_mode:     enum { real_time | scheduled | hybrid }
    schedule:            cron?            // For scheduled traits
    depends_on:          list<string>     // Other computed traits this depends on
```

### The Cascade Dependency Problem

Computed traits can depend on other computed traits: `customer_tier` depends on `lifetime_revenue`, which depends on `total_purchases`. When `total_purchases` is updated, `lifetime_revenue` must be recomputed, then `customer_tier` must be recomputed. This creates a dependency DAG.

```
FUNCTION recompute_trait_cascade(profile, updated_trait):
    // Build the recomputation order (topological sort of dependency DAG)
    recomputation_order = topological_sort(
        get_dependents(updated_trait.trait_name)
    )

    FOR EACH dependent_trait IN recomputation_order:
        new_value = evaluate_trait(profile, dependent_trait)
        IF new_value != profile.traits[dependent_trait.trait_name]:
            profile.traits[dependent_trait.trait_name] = new_value
            // Trigger segment re-evaluation for this trait change
            emit_trait_change_event(profile.id, dependent_trait.trait_name, new_value)

    RETURN updated_traits
```

### Time Window Expiry

Rolling-window traits (e.g., "purchases in last 30 days") have a subtle problem: values change not only when new events arrive but also when old events fall out of the window. A purchase made 31 days ago no longer counts, even if no new event arrived.

**Solution:** A background "window expiry" sweeper runs periodically (every hour) and recomputes traits whose window boundary has changed since the last sweep. Profiles are flagged for recomputation only if they have events near the window boundary (within 1 day of falling off), avoiding full scans.

---

## Edge Cases

### Edge Case (Unusual or extreme situation) 1: Identity Cluster Explosion

A shared device in a public kiosk generates identity links for hundreds of different users, all connected through the same `device_id`. Without protection, all these users merge into a single massive cluster, corrupting all their profiles.

**Defense:**
- Cluster size ceiling: if merging would create a cluster larger than N nodes (configurable, default: 100), the merge is rejected
- Device identifier weight decay: device IDs that appear with > 10 distinct user IDs within 30 days are automatically demoted to "untrusted" and excluded from merge decisions
- The demoted device is flagged for review; an operator can choose to split the affected clusters

### Edge Case (Unusual or extreme situation) 2: Consent Change Race During Bulk Import

A bulk file import of 10M events arrives simultaneously with a consent revocation for profiles within the import. The import processor has already loaded events into the processing pipeline before the consent change propagates.

**Defense:**
- The consent enforcement layer re-checks consent at the profile write step, not just at ingest
- Events processed between the consent revocation and the cache propagation (< 30 seconds) are caught by a post-processing consent audit that runs hourly
- Any profiles written in violation are retroactively scrubbed from non-consented destinations

### Edge Case (Unusual or extreme situation) 3: Survivorship Rule Conflict with Warehouse Reverse ETL

A warehouse-computed trait (e.g., `churn_risk_score`) is synced back to the CDP profile via reverse ETL. Simultaneously, the CDP's own computed trait engine calculates a conflicting value for the same trait from real-time events.

**Defense:**
- Each trait has a designated "source of authority" (CDP-computed vs. warehouse-computed)
- Reverse ETL traits are written with a distinct source tag; the profile store enforces that only the authoritative source can update a given trait
- If both sources attempt to update the same trait, the authoritative source wins; the conflict is logged in the audit trail

### Edge Case (Unusual or extreme situation) 4: Profile Merge Invalidates In-Flight Deliveries

Profile P1 and P2 merge into P1 while a delivery for P2 is in-flight to a destination. The destination receives a delivery with `profile_id: P2`, but P2 no longer exists.

**Defense:**
- The merge operation writes a redirect record: `P2 → P1` in the identity graph
- The delivery worker, on receiving a delivery for P2, follows the redirect and delivers with `profile_id: P1`
- The redirect has a TTL (7 days); after TTL, any residual deliveries for P2 are dropped and logged as "stale redirect"

---

## Real-World Case Studies

### Case Study 1: E-Commerce Platform — 500M Profiles, 1.5M Events/Sec

**Context:** A global e-commerce platform processes 500M customer profiles across 12 geographic regions, handling 1.5M events/sec during peak shopping seasons (3× normal). Their CDP powers real-time personalization (product recommendations shown during page load) and audience activation for 200+ marketing destinations.

**Key architectural decisions:**
- **Cell-based profile store:** Each geographic region operates as a cell with its own profile store. Cross-region identity resolution uses a global "identity hub" that contains only identifier hashes (no PII), routing full profile lookups to the correct regional cell. This satisfies data residency requirements while enabling cross-region identity stitching.
- **Priority-tiered event processing:** During peak, non-personalization events (analytics events, page views without user context) are routed to a deferred queue with 5-minute processing SLA, while identity-linked events maintain their < 500ms SLA. This reduces pipeline load by 60% during peak without degrading personalization quality.
- **Pre-warmed edge profile cache:** The top 5% of profiles (by recent activity) are pre-populated into CDN edge caches. Profile lookup for these hot profiles completes in < 5ms, enabling in-page personalization without visible latency.

**Lesson:** Cell-based architecture with a thin global identity hub preserves data sovereignty while enabling global identity resolution. Priority tiering during peak is essential for maintaining SLOs without over-provisioning for worst-case load.

### Case Study 2: Media Streaming Service — Identity Stitching Across 8 Device Types

**Context:** A streaming service with 200M subscribers must stitch user identity across smart TVs, mobile apps, web browsers, set-top boxes, gaming consoles, voice assistants, car dashboards, and wearables. A single household may have 15+ devices and 4–6 user profiles.

**Key architectural decisions:**
- **Household-aware identity model:** Identity graph supports a three-tier hierarchy: device → individual → household. Device-level identities are low-confidence (shared devices) while individual-level identities are high-confidence (authenticated sessions). Household grouping enables content recommendations that consider the whole household's viewing patterns.
- **Probabilistic matching with ML:** Beyond deterministic matching (email, phone), the platform uses a gradient-boosted model trained on viewing patterns, login timing, and device proximity signals to identify the same user across devices with ~92% precision. The confidence score determines whether a merge is auto-applied (> 95%) or queued for review (85–95%).
- **Consent per device:** Each device has independent consent state, not just each user. A user may consent to personalization on their phone but not on the shared family TV. The consent model is a matrix: user × device × purpose.

**Lesson:** Consumer CDPs must model household and device hierarchies, not just individual identity. Probabilistic matching is essential for cross-device stitching but must be gated by confidence thresholds to prevent over-merging.

### Case Study 3: B2B SaaS — Account-Level Segmentation with 50M Companies

**Context:** A B2B SaaS platform tracks individual user activity across 50M company accounts. Audience segments target accounts (not individuals): "companies where 3+ users viewed pricing page in last 14 days" or "accounts with declining weekly active users."

**Key architectural decisions:**
- **Account-level computed traits:** The computed trait engine aggregates individual-level events into account-level metrics (active users per week, features adopted, support tickets filed). These account traits are the primary input to B2B audience segmentation.
- **Account identity via domain matching:** Individual user emails are grouped into accounts via domain extraction (`user@company.com` → account `company.com`). Freemail domains (gmail.com, outlook.com) are excluded from domain matching and use a separate IP-based or self-reported company identifier.
- **Hierarchical audience evaluation:** Segment rules operate at the account level: "evaluate whether the ACCOUNT satisfies this condition, based on aggregated activity of its MEMBERS." The CEP evaluator maintains per-account counters, not per-individual counters, reducing the evaluation state by 10–100×.

**Lesson:** B2B CDPs invert the identity model from individual-centric to account-centric. Account identity (domain matching, IP clustering, self-report) is a distinct problem from individual identity (device stitching, authentication linking).

---

## Performance Optimization Patterns

### Pattern 1: Write Batching for Profile Store

At 500K events/sec, the profile store receives ~500K read-modify-write cycles per second. Many events affect the same profile within a short window (a user generating multiple clicks in sequence). Write batching coalesces these into fewer store operations:

```
FUNCTION batchedProfileWrite(event_buffer: List<ProfileUpdate>, window_ms: 200):
  // Group updates by profile_id
  grouped = groupBy(event_buffer, update => update.profile_id)

  FOR EACH (profile_id, updates) IN grouped:
    // Read profile once
    profile = profileStore.read(profile_id)

    // Apply all updates in event timestamp order
    FOR EACH update IN sortBy(updates, u => u.event_timestamp):
      applyUpdate(profile, update)

    // Write profile once (instead of N times)
    profileStore.write(profile)

  // Result: N events on same profile → 1 read + 1 write instead of N reads + N writes
```

Write batching reduces profile store IOPS by 3–5× during peak periods at the cost of adding up to `window_ms` latency to profile update propagation.

### Pattern 2: Bloom Filter Deduplication at Edge

The edge collector maintains a time-windowed bloom filter to reject duplicate events before they enter the ingest queue:

```
Configuration:
  - Bloom filter size: 128 MB per collector instance
  - False positive rate: 0.01% (1 in 10,000)
  - TTL window: 5 minutes (events older than 5 minutes are not checked)

Operation:
  - On event receipt: check if event_id exists in bloom filter
  - If exists (probable duplicate): return 200 OK (idempotent) without enqueuing
  - If not exists: add to bloom filter and enqueue normally
  - Every 5 minutes: rotate bloom filter (current → old, new → current)

Impact:
  - Eliminates 10-15% of duplicate events during normal operation
  - Eliminates 50-80% during SDK retry storms (network instability)
  - Reduces ingest queue throughput requirement proportionally
```

### Pattern 3: Lazy Audience Membership Hydration

The profile lookup API supports an `include` parameter that controls which data is returned. Audience membership hydration is expensive (50K audience bitmaps per profile) but rarely needed in full:

```
Optimization levels:
  Level 0 (default): Return profile traits only. No audience data. Latency: 3-8ms
  Level 1 (summary): Return count of active audiences + top 10 by recency. Latency: 5-12ms
  Level 2 (specified): Return membership for specific audience IDs only. Latency: 8-20ms
  Level 3 (full): Return all audience memberships. Latency: 15-45ms

Most personalization use cases need Level 0 or Level 2 — checking if the user is in a
specific audience. Only analytics dashboards need Level 3. This optimization reduces
profile lookup p99 from 45ms to 12ms for 90% of requests.
```
