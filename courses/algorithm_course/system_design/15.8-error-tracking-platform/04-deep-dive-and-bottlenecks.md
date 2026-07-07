# Deep Dive & Bottlenecks — Error Tracking Platform

## Critical Component 1: The Fingerprinting Engine

### Why This Is Critical

The fingerprinting engine is the intellectual core of the platform. It determines whether two error events represent the same bug or different bugs. Get it wrong, and the platform's primary value proposition collapses:

- **Over-grouping** (merging unrelated bugs): Developers waste time investigating a single issue that actually contains multiple root causes. Fixing one doesn't fix the others, eroding trust.
- **Under-grouping** (splitting one bug into many issues): The issue list explodes with duplicates. A bug affecting 10,000 users appears as 50 separate issues with 200 users each, making severity assessment impossible.

The grouping accuracy directly determines developer productivity and platform adoption.

### How It Works Internally

The engine operates as a **priority chain of grouping strategies**:

1. **Client-side fingerprint** — The SDK developer explicitly sets `fingerprint: ["payment-gateway-timeout"]`. This takes absolute precedence. Used for known error patterns where the default algorithm fails.

2. **Server-side fingerprint rules** — Project-level rules authored in a declarative syntax: `type:NetworkError message:"timeout*" → fingerprint: ["network-timeout"]`. Evaluated in order; first match wins.

3. **Stack trace-based grouping** — The default and most common strategy. The algorithm:
   - Filters to in-app frames only (excludes library/framework code)
   - Normalizes each frame: strips line numbers (too volatile), lowercases filenames, strips data-like suffixes
   - Concatenates exception type + normalized frames into a string
   - Computes SHA-256 hash as the fingerprint
   - Platform-specific behaviors: JavaScript uses filename + context line (function names are unstable after minification); Python uses module + function + context line; native platforms use demangled function names only

4. **Exception-based grouping** — Fallback when no stack trace is available. Uses exception type + cleaned exception message (stripped of data-like content: timestamps, UUIDs, numbers, URLs).

5. **Message-based grouping** — Last resort for errors with no stack trace and no structured exception. Strips all data-like content from the message and hashes the skeleton. Highly prone to over-grouping.

**Hierarchical grouping** is an advanced feature that produces multiple hash levels. The primary hash groups events into an issue. Secondary hashes enable sub-grouping within the issue UI, showing developers distinct code paths that contribute to the same top-level issue. This addresses the limitation that a single hash can't capture partial similarity.

### Performance Characteristics

| Operation | Time Complexity (Speed of the algorithm) | Space Complexity (Memory usage of the algorithm) | Typical Latency |
|-----------|----------------|-----------------|-----------------|
| Frame normalization | O(1) per frame | O(1) per frame | <0.01ms |
| In-app frame filtering | O(F) where F = total frames | O(F) for filtered set | <0.1ms |
| Strip-data regex chain | O(M × R) where M = message length, R = regex count | O(M) for cleaned message | <0.5ms |
| SHA-256 hash computation | O(N) where N = concatenated components length | O(1) for hash output | <0.01ms |
| Cache lookup (fingerprint → issue) | O(1) amortized (hash table) | N/A | <1ms (cache hit), 2ms (DB fallback) |
| Full fingerprint pipeline (per event) | O(F + M × R) | O(F) | <1ms total (cache hit) |

### Grouping Strategy Distribution

At scale, the distribution of fingerprinting strategies reveals system health:

| Strategy | Healthy Distribution | Signal |
|----------|---------------------|--------|
| Stack trace-based | 70-80% | Primary path; most reliable grouping |
| Exception type + message | 10-15% | Errors without stack traces (API errors, config errors) |
| Client-side custom | 5-10% | Developer overrides for known patterns |
| Server-side rules | 3-5% | Admin-configured grouping rules |
| Message-only (fallback) | <5% | Should be minimized; unreliable grouping |

A sudden shift in distribution (e.g., stack trace strategy drops from 75% to 40%) often indicates a symbolication failure — without resolved frames, the algorithm falls back to exception/message strategies.

### Failure Modes

| Failure Mode | Cause | Impact | Mitigation |
|-------------|-------|--------|------------|
| **Hash collision** | Different stack traces produce same hash after normalization | Unrelated bugs merged into one issue | Include more frame information (context lines); allow manual split |
| **Hash instability** | Code refactoring changes function names/filenames | Same bug appears as new issue after deploy | Normalize aggressively (strip module paths, version suffixes); use context lines as stable identifiers |
| **Framework noise** | Framework frames dominate the stack trace | Bugs in different user code group together because they share framework call stack | Filter to in-app frames; maintain per-platform frame classification rules |
| **Message stripping over-aggression** | Data stripping removes meaningful parts of error message | Different errors like "table users not found" and "table orders not found" merge | Preserve domain-specific identifiers; allow custom stripping rules |
| **Minification without source maps** | JavaScript stack traces contain mangled names | All errors from the same minified file collapse into one issue | Strongly encourage source map upload; warn when symbolication fails |

### Handling Failures

- **Manual merge/split:** Developers can merge multiple issues into one or split an issue into multiple. These overrides persist and take precedence over algorithmic grouping for future events.
- **Grouping version migration:** When the algorithm improves, existing issues aren't retroactively re-grouped (would cause chaos). Instead, new grouping versions create new issues, and the platform auto-links "similar" issues across versions.
- **Feedback loop:** Track merge/split rates as quality signals. A spike in manual merges indicates the algorithm is under-grouping; a spike in splits indicates over-grouping. These metrics drive algorithm improvements.

---

## Critical Component 2: Source Map Symbolication Service

### Why This Is Critical

Modern web applications ship minified JavaScript where a stack trace looks like `a.js:1:34523` instead of `UserProfile.render (user-profile.js:142:8)`. Without symbolication, stack traces are unreadable and issues are ungroupable (all errors from the same minified file produce identical fingerprints). Symbolication is the gateway to useful error tracking for web and mobile applications.

### How It Works Internally

**Source map structure:** A source map is a JSON file containing a VLQ (Variable-Length Quantity) encoded mapping from generated positions (line:column in minified code) to original positions (file:line:column in source code), plus an array of original source filenames and a names array for identifier mapping.

**Symbolication pipeline:**

1. **Source map lookup:** Given the error's release version and the minified filename from the stack frame, query the source map index: `(release="frontend@2.4.1", filename="~/static/js/app.min.js")` → source map storage path.

2. **Source map parsing:** Parse the VLQ-encoded `mappings` field into a position lookup table. This is CPU-intensive for large source maps (10-50 MB decoded). The parsed result is cached in-memory using an LRU cache keyed by `(release, filename)`.

3. **Position resolution:** For each stack frame, binary search the parsed mappings to find the original file, line, column, and function name corresponding to the generated position.

4. **Context extraction:** Retrieve the original source file content (embedded in the source map or referenced externally) and extract the surrounding code lines for display in the UI.

5. **Frame enrichment:** Replace the minified frame with the resolved original frame. Mark the frame with a `symbolicated: true` flag.

### Failure Modes

| Failure Mode | Cause | Impact | Mitigation |
|-------------|-------|--------|------------|
| **Missing source map** | Not uploaded for this release; upload delayed by CI/CD pipeline | Events stored with minified frames; grouping degrades | Queue events for retro-symbolication; alert on missing source maps |
| **Mismatched source map** | Source map doesn't match the deployed code (version mismatch) | Wrong file/line resolution; misleading stack traces | Validate source map checksum against deployed bundle; require release-locked uploads |
| **Oversized source maps** | Large monorepo bundles produce 50+ MB source maps | Parsing timeout; memory pressure on symbolicator nodes | Stream-parse the VLQ mappings; set size limits; encourage code splitting |
| **Stale cache** | Cached source map from old release served for new release | Incorrect symbolication | Key cache by `(release, filename)` — different releases never collide |
| **Source map without sources** | `sourcesContent` field empty; original files not embedded | Position resolved but no context lines displayed | Accept gracefully; show resolved position without context |

### Handling Failures

- **Retro-symbolication queue:** When a source map upload arrives, query for unsymbolicated events matching that release and re-process them. This handles the upload-lag scenario.
- **Symbolication timeout:** If parsing exceeds 5 seconds for a single frame, store the raw frame and flag the event as "partially symbolicated." Retry during off-peak hours.
- **Source map size budget:** Enforce a per-release source map size limit (default: 500 MB total). Warn during upload if exceeded.

---

## Critical Component 3: Spike Protection & Quota Management

### Why This Is Critical

Error events are inherently bursty. A single bad deploy can increase error volume by 100x in seconds. Without spike protection:
- One project's error storm overwhelms the processing pipeline, increasing latency for all projects
- A customer's monthly event quota is consumed in minutes by a single incident
- The columnar store receives an overwhelming burst that degrades query performance for all users

### How It Works Internally

**Three-layer protection:**

1. **SDK-side rate limiting:** The relay returns `429` with `X-Sentry-Rate-Limits` headers specifying per-category (error, transaction, attachment) cooldown periods. The SDK respects these and drops/samples events locally. This is the first line of defense and reduces network bandwidth during spikes.

2. **Relay-side spike detection:** The relay tracks per-project event rates in a sliding window (1-minute buckets). A spike is detected when the current rate exceeds the project's spike threshold, which is computed from a 7-day weighted historical baseline with hourly seasonality. When a spike is detected:
   - Dynamic sampling is applied: events are accepted probabilistically based on `hash(event_id) % 100 < sample_rate`
   - Consistent hashing on event_id ensures the same event is always accepted or rejected (prevents partial event sets)
   - The sample rate is logged with each accepted event so analytics can extrapolate true volumes

3. **Quota enforcement:** Each organization has an event quota (monthly or daily). Quota counters are tracked in the cache cluster (Redis) with atomic increments. When the quota is 80% consumed, a warning notification is sent. When exhausted, all events for the organization are rejected with `429` until the next billing period.

### Failure Modes

| Failure Mode | Cause | Impact | Mitigation |
|-------------|-------|--------|------------|
| **Baseline cold start** | New project has no historical data | Spike threshold defaults to a low value; normal traffic flagged as spike | Use organization-level baseline as initial estimate; ramp up over first week |
| **Seasonal false positive** | Legitimate traffic pattern change (product launch, marketing campaign) | Real events unnecessarily throttled | Allow manual threshold override; detect sustained rate increases (>1 hour) and adjust baseline |
| **Quota race condition** | Distributed relay nodes independently decrement quota | Slight over-acceptance (~1-2%) due to stale quota reads | Acceptable imprecision; reconcile with hourly batch accounting; hard-limit at 110% |
| **Noisy neighbor in bus** | High-volume project floods message bus partition | Other projects' events delayed | Separate partitions per project tier; priority queues for premium customers |

---

## Concurrency & Race Conditions

### Race Condition 1: Concurrent Fingerprint Upsert

**Scenario:** Two events with the same fingerprint arrive simultaneously. Both workers query the database, find no existing issue, and both attempt to create a new issue.

**Solution:** Use a database UPSERT with a unique constraint on `(project_id, fingerprint_hash)`:

```
INSERT INTO issues (project_id, fingerprint_hash, title, first_seen, ...)
VALUES ($1, $2, $3, $4, ...)
ON CONFLICT (project_id, fingerprint_hash)
DO UPDATE SET
    event_count = issues.event_count + 1,
    last_seen = GREATEST(issues.last_seen, EXCLUDED.first_seen)
RETURNING issue_id, (xmax = 0) AS is_new
```

The `xmax = 0` trick distinguishes between an INSERT (new issue) and an UPDATE (existing issue), which determines whether to trigger a "new issue" alert.

### Race Condition 2: Issue State Transition Conflicts

**Scenario:** Developer A resolves an issue while Developer B assigns it, simultaneously.

**Solution:** Last-write-wins is acceptable for this use case. The `updated_at` timestamp ensures the UI shows the most recent state. For critical transitions (resolve → regress), the regression detector uses compare-and-swap: only transition from RESOLVED to REGRESSED if the current status is still RESOLVED.

### Race Condition 3: Quota Decrement Under Spike

**Scenario:** 50 relay nodes simultaneously decrement the project quota counter in Redis.

**Solution:** Use Redis `INCRBY` (atomic increment) for quota tracking. Accept ~1-2% overage from read-check-write races on the "quota exhausted?" check. Reconcile with a periodic batch job. Hard-reject when the counter exceeds 110% of quota.

---

## Slowest part of the process Analysis

### Slowest part of the process 1: Source Map Parsing Latency

**Problem:** Large source maps (10-50 MB) take 1-5 seconds to parse. During a deploy, hundreds of events from the new release arrive before the source map cache is warm, causing a parsing thundering herd.

**Mitigation:**
- **Pre-warm cache on upload:** When a source map is uploaded, immediately parse and cache it. This means the first event after deploy hits a warm cache.
- **Parsing queue with deduplication:** If multiple events need the same source map parsed simultaneously, only one worker parses it; others wait on a shared future/promise.
- **Stream parsing:** Parse VLQ mappings incrementally instead of loading the entire source map into memory.
- **Bounded concurrency:** Limit concurrent source map parsing to prevent memory exhaustion (each parsed map can consume 200-500 MB in memory).

### Slowest part of the process 2: Fingerprint Cache Invalidation During Algorithm Upgrades

**Problem:** When the fingerprinting algorithm is updated, the cached fingerprint for an event's attributes may produce a different hash. This creates a period where the same bug produces two different fingerprints (old algorithm and new algorithm), splitting a single issue into two.

**Mitigation:**
- **Versioned fingerprints:** Store the algorithm version alongside the fingerprint. During migration, compute both old and new fingerprints and link them.
- **Gradual rollout:** Roll out the new algorithm project-by-project. Provide a preview tool that shows how grouping would change before committing.
- **Never re-group retroactively:** New algorithm applies only to new events. Existing issue→fingerprint mappings are preserved. Auto-link "similar" issues across algorithm versions.

### Slowest part of the process 3: Alert Evaluation During Spikes

**Problem:** During an error spike, thousands of new events arrive per second. The alert engine must evaluate rules for each event without itself becoming a Slowest part of the process. If alert evaluation falls behind, developers receive notifications minutes after a problem starts.

**Mitigation:**
- **Pre-filter in the pipeline:** Tag events with `is_new_issue`, `is_regression`, and `exceeds_rate_threshold` during processing. The alert engine only evaluates rules for tagged events, ignoring the vast majority.
- **Rate-limit alert delivery:** No more than 1 alert per rule per frequency window (configurable, default: 5 minutes). This prevents alert flooding during spikes.
- **Separate alert queue:** Alert evaluation runs on a dedicated message bus topic with its own consumer group, isolated from the main event processing path.

---

## Critical Component 4: Envelope Protocol & SDK Transport

### Why This Is Critical

The SDK-to-relay transport protocol determines both the data fidelity and the overhead imposed on client applications. The envelope format must efficiently encode heterogeneous payloads (errors, transactions, sessions, attachments) while minimizing CPU and memory impact on the client.

### How It Works Internally

**Envelope structure:** The envelope is a binary format consisting of:
1. **Header line:** JSON object with `event_id`, `dsn`, `sdk` metadata (newline-terminated)
2. **Item header:** JSON object per item with `type` (event, attachment, session), `length`, `content_type`
3. **Item payload:** Raw bytes of the item content (JSON for events, binary for attachments)

Multiple items can be packed into a single envelope, enabling batched submission of related payloads (e.g., error event + associated breadcrumb attachment + session update) in a single HTTP request.

**SDK-side buffering:**
- Events are queued in-memory (max 30 events) when the relay is unreachable
- Retry with exponential backoff: 1s, 2s, 4s, 8s (max 4 retries)
- Oldest events are dropped when the buffer is full (newest events are more diagnostic)
- Session data is aggregated locally and flushed periodically (every 60s) to reduce transmission volume

**Transport optimizations:**
- gzip compression reduces payload size by 70-85% (5 KB → 1 KB typical)
- Connection reuse via HTTP/2 or persistent HTTP/1.1 connections
- Client-side sampling: SDK can be configured to send only N% of events (client-side decision, before any network I/O)

### Failure Modes

| Failure Mode | Cause | Impact | Mitigation |
|-------------|-------|--------|------------|
| **SDK buffer overflow** | Relay unreachable for extended period | Events dropped silently on client side | Persist buffer to local storage (mobile SDKs); increase buffer size for high-error apps |
| **Envelope corruption** | Network interruption during transmission | Partial envelope received by relay | Relay validates envelope structure; rejects partial payloads; SDK retries full envelope |
| **Protocol version mismatch** | Old SDK version sends deprecated format | Relay cannot parse envelope | Relay supports multiple protocol versions simultaneously; graceful fallback |
| **Compression bomb** | Malicious actor sends highly compressed payload that expands to GBs | Relay OOM during decompression | Enforce decompressed size limit (200 KB); streaming decompression with early abort |

---

## Critical Component 5: AI-Assisted Grouping (2025-2026 Development)

### Why This Is Critical

Rule-based fingerprinting algorithms reach a ceiling at ~95% accuracy. The remaining 5% of mis-grouped errors — particularly in dynamic languages, multi-threaded applications, and microservice architectures — require semantic understanding of error similarity that Practical rule of thumb rules cannot capture.

### How It Works Internally

**Embedding-based similarity:**
1. Extract a structured representation from each event: exception type, top 5 in-app frames (function name + filename), cleaned error message
2. Feed the structured representation through a pre-trained text embedding model to produce a fixed-dimensional vector (e.g., 384 dimensions)
3. For new events, compute cosine similarity against existing issue centroids (average embedding of the issue's events)
4. If similarity exceeds a threshold (e.g., 0.92), assign to the most similar issue
5. If no similar issue exists, create a new issue with the event's embedding as the initial centroid

**Hybrid approach:** The embedding model is used as a secondary signal, not a replacement for the deterministic fingerprinting algorithm:

```
IF deterministic_fingerprint matches existing issue:
    ASSIGN to existing issue (high confidence)
ELSE IF embedding similarity > 0.92 with existing issue:
    SUGGEST merge to developer (medium confidence, requires human confirmation)
ELSE:
    CREATE new issue
```

**Training data:** The model is fine-tuned on historical merge/split actions — when developers merge two issues, the model learns that those error patterns are similar; when developers split an issue, the model learns that those patterns are distinct.

### Challenges

| Challenge | Details |
|-----------|---------|
| **Latency** | Embedding computation adds 5-10ms per event; acceptable for background grouping suggestions, too slow for inline fingerprinting |
| **Cold start** | New projects have no merge/split history; model falls back to a generic pre-trained baseline |
| **Concept drift** | Code changes alter what "similar" means; model must be periodically retrained |
| **Explainability** | Developers want to understand why two errors were grouped; embedding similarity lacks interpretable reasoning |

---

## Edge Cases

### Edge Case (Unusual or extreme situation) 1: Framework-Dominated Stack Traces

**Scenario:** A React application wraps all component rendering in an error boundary. Every unhandled error in any component produces a stack trace where 90% of frames are React internals (`React.createElement`, `commitRoot`, `performSyncWork`). Two completely different bugs in two different components produce nearly identical stack traces because the in-app frames differ only in the leaf component name.

**Impact:** Over-grouping — unrelated bugs in `UserProfile` and `PaymentForm` merge into a single issue because both share the same React framework frames.

**Solution:** The `is_in_app` frame filter is critical. Mark React internals as "not in-app" and fingerprint only on the 1-2 application frames. Maintain a per-framework blocklist of frame patterns that should be excluded from fingerprinting. For React specifically, use the component name from the error boundary's `componentStack` string rather than the JavaScript stack trace.

### Edge Case (Unusual or extreme situation) 2: Rate Limit Header Propagation in Microservices

**Scenario:** A backend service receives `429 Too Many Requests` from the error tracking relay. The service's error handler catches the `429` response and reports it as an error — to the same error tracking platform. This creates a feedback loop: rate limiting causes error reports, which increase event volume, which triggers more rate limiting.

**Impact:** Quota exhaustion from self-referential error reporting.

**Solution:** SDKs must never report their own transport errors to the same DSN. The SDK's internal HTTP client exceptions (connection refused, timeout, 429) are logged locally but excluded from event capture. This is enforced in the SDK's error filter chain.

### Edge Case (Unusual or extreme situation) 3: Time Zone-Dependent Error Patterns

**Scenario:** A financial application throws validation errors for date parsing that depend on the user's time zone. The error message includes the invalid date string: `"Invalid date: 03/20/2026"`. Users in different time zones produce different date strings, creating dozens of fingerprints for what is the same bug (a date format mismatch).

**Impact:** Under-grouping — the same date parsing bug appears as 30+ issues (one per unique date string in the error message).

**Solution:** The `strip_data()` function in the fingerprinting algorithm must normalize date patterns. The regex `\d{2}/\d{2}/\d{4}` should replace date strings with `<date>`, collapsing all variants into a single fingerprint.

### Edge Case (Unusual or extreme situation) 4: Source Map Revocation After Security Incident

**Scenario:** A security audit reveals that source maps for release `v3.2.0` were accidentally uploaded with embedded API keys in the `sourcesContent` field. The security team deletes the source maps. However, events already symbolicated using those source maps have resolved frames that reference the original source code paths — which may themselves contain sensitive information in variable names or comments.

**Impact:** PII/secret exposure persists in already-symbolicated event data even after source map deletion.

**Solution:** Source map deletion must trigger a cascade: (1) delete the source map files, (2) re-process affected events to replace resolved frames with minified frames (de-symbolication), (3) invalidate the symbolicator cache for the affected release. This is expensive but necessary for security compliance.

---

## Real-World Case Studies

### Case Study 1: Sentry's Fingerprinting Evolution

**Context:** Sentry processes billions of error events per month across hundreds of thousands of projects. Their fingerprinting algorithm has gone through 5+ major revisions.

**Challenge:** When Sentry updated their grouping algorithm from v1 to v2 (changing how JavaScript frames were normalized), it affected ~30% of all issues across the platform. A global rollout would have caused millions of "new issue" alerts and broken existing integrations (issues linked in JIRA, Slack notifications, etc.).

**Solution:**
- **Hierarchical migration:** New algorithm applied only to new events. Existing issue→fingerprint mappings preserved.
- **Preview API:** Before enabling the new algorithm, projects could preview how their issue list would change — showing which issues would merge and which would split.
- **Gradual rollout:** Opt-in per project, then per organization, then default-on for new projects, and finally default-on for all projects with a 30-day grace period.
- **Cross-version linking:** Issues created by the old algorithm and the new algorithm for the same bug were auto-linked as "similar," allowing developers to manually merge if desired.

**Lesson:** Fingerprinting algorithm changes are database migrations for developer workflows. They require the same care as schema migrations in production databases.

### Case Study 2: Discord's Error Spike During Outage

**Context:** Discord's error tracking system received a 500x spike during a major CDN outage in 2023 — every client worldwide simultaneously encountered connection errors.

**Challenge:** The spike overwhelmed the message bus (queue depth grew to millions), processing workers fell behind by minutes, and the alert engine was evaluating rules against a backlog instead of real-time events. Developers received "new issue" alerts 15 minutes late — defeating the purpose of real-time error tracking.

**Solution:**
- **Three-tier spike protection:** SDK-side sampling (respond to `429` immediately), relay-side dynamic sampling (hash-based consistent sampling), and per-project message bus partitions with independent consumer groups.
- **Alert pipeline separation:** Decoupled alert evaluation from event processing. Events tagged with `is_new_issue` flag during processing are routed to a separate high-priority topic with dedicated consumers.
- **Adaptive baseline:** Spike detection uses per-project, per-hour-of-week baselines (168 buckets) with 7-day weighted rolling average. A CDN outage at 3 AM triggers spike protection at a much lower absolute rate than one at 3 PM.

**Lesson:** The alert pipeline must have independent scaling and priority guarantees. During a 500x spike, only ~0.01% of events trigger alerts, but those alerts are the most important data the platform produces.

### Case Study 3: Shopify's Source Map Scale Challenge

**Context:** Shopify's merchant-facing platform consists of dozens of independently deployed frontend applications, each producing source maps. During peak deploy cycles (Black Friday preparation), ~10,000 source map uploads per hour arrive, totaling 50+ TB of source map storage.

**Challenge:** Source map parsing is CPU-intensive (VLQ decoding). When 100+ deploys happen simultaneously, the symbolicator service experienced thundering herd: hundreds of events from different new releases all requesting source map parsing simultaneously, causing memory exhaustion (each parsed source map consumes 200-500 MB in memory).

**Solution:**
- **Pre-warm on upload:** When a source map is uploaded, immediately parse and cache the result — before any events arrive. This eliminates the cold-start thundering herd.
- **Parsing deduplication:** A semaphore keyed by `(release, filename)` ensures only one worker parses a given source map. Other requests for the same source map wait on a shared future.
- **Memory-bounded parsing pool:** Maximum 10 concurrent source map parsing operations per symbolicator node, with a queue for overflow. Memory usage is bounded at ~5 GB per node.
- **Source map size budgets:** Per-release limits (500 MB total, 50 MB per individual map) enforce code-splitting discipline.

**Lesson:** Source map parsing is the most resource-intensive operation in the pipeline per invocation. Treating it as a scheduled resource (bounded concurrency, pre-warming) rather than an on-demand operation is essential at scale.

### Case Study 4: Mobile Crash Reporting at Uber

**Context:** Uber's mobile applications (iOS + Android) report crashes that require native symbol resolution — dSYM files for iOS and ProGuard mapping files for Android. Unlike web source maps, native debug symbols can be hundreds of megabytes per release.

**Challenge:** Native symbolication requires maintaining a symbol cache of 2+ TB (thousands of releases across dozens of apps). Each crash report requires downloading and parsing the correct debug symbol file for the specific app version, build variant, and architecture. Cache miss rate of even 1% means thousands of unsymbolicated crash reports per day.

**Solution:**
- **Two-tier symbol cache:** In-memory LRU for recently-used symbol tables (hot: last 24h of releases) + on-disk cache for historical releases (warm: last 90 days). Cold symbols fetched from object storage on demand.
- **Architecture-specific parsing:** iOS dSYM files contain architecture-specific symbol tables (arm64, x86_64 for simulator). The symbolicator must select the correct architecture based on the crash report's device info.
- **Proactive caching:** CI/CD integration pre-populates the symbol cache during the build process, before the app reaches any user device.
- **Aggregated crash groups:** For mobile, crash-free session rate per release is the primary metric. Individual crash reports are sampled (10% stored, 100% counted) to manage storage costs.

**Lesson:** Mobile crash symbolication is fundamentally different from web source map resolution — larger symbols, architecture-specific parsing, and the impossibility of retroactive source map upload (app already on user devices). The architecture must handle both modalities.

---

## Additional Slowest part of the process Analysis

### Slowest part of the process 4: ClickHouse MergeTree Compaction During Write Spikes

**Problem:** During a 100x event spike, the columnar store receives massive bursts of batch inserts. The MergeTree engine creates many small data parts that must be merged in the background. If merges fall behind, the number of parts per partition grows, degrading query performance (each query must scan more parts) and eventually hitting the `max_parts_count_for_partition` limit, causing write rejections.

**Mitigation:**
- **Write buffering:** Processing workers buffer events and write in larger batches during spikes (1s or 5K events, whichever comes first) to reduce the number of small parts
- **Partition sizing:** Daily partitions per project limit the scope of merge operations. For high-volume projects, add sub-daily partitions (6-hour windows).
- **Merge throttle monitoring:** Alert when `PartsPerPartition` exceeds 80% of the configured limit. Scale ClickHouse merge threads during spikes.
- **TTL-based cleanup:** Expired partitions (>90 days) are dropped entirely rather than merged, eliminating background merge overhead for historical data.

### Slowest part of the process 5: Relational DB Write Amplification from Issue Upserts

**Problem:** Every event triggers an issue upsert in PostgreSQL: `INSERT ON CONFLICT DO UPDATE SET event_count = event_count + 1, last_seen = GREATEST(...)`. During a spike of 100K events/sec, this creates 100K upserts/sec against the issues table. Even with the UPSERT optimization, this saturates the PostgreSQL primary's write throughput (typically ~50K TPS for simple updates).

**Mitigation:**
- **Write coalescing:** Instead of upserting per-event, batch issue counter updates. Processing workers accumulate per-issue deltas in a local buffer for 1 second, then flush a single UPDATE per issue. A spike of 100K events/sec hitting 1,000 issues becomes 1,000 UPDATEs/sec instead of 100K.
- **Counter approximation:** Use the columnar store as the authoritative event count source. The relational store's `event_count` is an approximate "fast counter" updated every 5 seconds from the local buffer. Display `~count` in the issue list and exact count in the detail view.
- **Connection pooling:** PgBouncer in transaction mode limits concurrent connections to PostgreSQL to 100 (vs. 1,000+ workers), preventing connection exhaustion.

### Slowest part of the process 6: Fingerprint Cache Warming After Deployment of New Release

**Problem:** When a new release is deployed, errors start arriving with new stack traces. The fingerprint cache (keyed by `fingerprint_hash → issue_id`) has no entries for these new fingerprints. Every event requires a database lookup to check if the fingerprint already exists, creating a thundering herd of DB queries for the same new fingerprint.

**Mitigation:**
- **Probabilistic early-insert:** The first event with a new fingerprint inserts the issue and populates the cache. Concurrent events for the same fingerprint hit the UPSERT's ON CONFLICT path and immediately update the cache entry.
- **Negative caching with short TTL:** Cache "fingerprint not found" with a 5-second TTL to prevent repeated DB lookups for genuinely new fingerprints that are in the process of being created.
- **Cache-aside with read-through:** If the cache doesn't have the fingerprint, the worker reads from the DB and populates the cache atomically using `SET NX` (set-if-not-exists) to prevent cache stampede.

---

## Race Condition 4: Retro-Symbolication vs. New Event Processing

**Scenario:** A source map upload triggers retro-symbolication of event E1 (updating its stack frames in the columnar store). Simultaneously, a new event E2 with the same fingerprint arrives and is being processed. The retro-symbolication job updates the issue's culprit field based on E1's resolved frames, while the processing worker updates the culprit based on E2's already-resolved frames.

**Solution:** The culprit field uses last-write-wins semantics. Since both E1 and E2 are valid events for the issue, either culprit is acceptable. The retro-symbolication job only updates the culprit if the current culprit contains unresolved (minified) frame references — it does not overwrite a culprit that was already set from a symbolicated event. This is checked via a compare-and-swap:

```
UPDATE issues SET culprit = $new_culprit
WHERE issue_id = $id AND culprit LIKE '%app.min.js%'
```

### Race Condition 5: Alert Rule Modification During Evaluation

**Scenario:** An admin modifies an alert rule (changing the threshold from 10 to 100 events) while the alert engine is mid-evaluation using the old threshold.

**Solution:** Alert rules are versioned. When the alert engine begins evaluation, it snapshots the rule version. If the rule is modified during evaluation, the modification creates a new version. The next evaluation cycle uses the new version. The current evaluation completes with the snapshotted version. This prevents partial application of rule changes.

---

## Grouping Quality Metrics and Feedback Loop

### Quantifying Grouping Accuracy

| Metric | What It Measures | Healthy Range | Alert Threshold |
|--------|-----------------|--------------|-----------------|
| Merge rate | % of issues merged by users per week | 2-5% | >10% (under-grouping) |
| Split rate | % of issues split by users per week | 1-3% | >5% (over-grouping) |
| New issue rate / event rate | Ratio of new issues to new events | 0.01-0.1% | >1% (excessive fragmentation) |
| Events per new issue (first hour) | Average events in a new issue's first hour | 10-100 | <3 (possible over-fragmentation) |
| Cross-release stability | % of issues that persist across releases | 60-80% | <40% (fingerprint instability) |

### Automated Grouping Health Score

```
grouping_health_score =
    (1.0 - merge_rate / MERGE_BASELINE) × 0.3 +
    (1.0 - split_rate / SPLIT_BASELINE) × 0.3 +
    (1.0 - new_issue_fragmentation_score) × 0.2 +
    cross_release_stability × 0.2

// Score range: 0.0 (terrible) to 1.0 (perfect)
// Alert if score drops below 0.7 for >1 hour
```
