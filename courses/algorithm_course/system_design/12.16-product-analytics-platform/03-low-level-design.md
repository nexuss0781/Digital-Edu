# 12.16 Product Analytics Platform — Low-Level Design

## Data Models

### 1. Core Event Record

The immutable event record is the fundamental unit of storage. All analytical computations derive from these records.

```
Table: events
Partitioned by: (project_id, event_date)
Sorted by: (project_id, event_date, user_id, server_received_at)
Stored as: Parquet with Zstd compression, row groups of 128MB

Columns:
  -- Envelope (typed, never null)
  event_id          STRING        -- UUID v4, globally unique, used for dedup
  project_id        STRING        -- Tenant identifier
  event_name        STRING        -- e.g. "page_viewed", "checkout_started"
  user_id           STRING        -- Stable user identifier (post-identify)
  anonymous_id      STRING        -- Pre-identify device/session identifier
  session_id        STRING        -- Session grouping key (30-min idle timeout)
  client_timestamp  TIMESTAMP     -- Client-reported event time (UTC)
  server_received_at TIMESTAMP    -- Server-assigned ingestion time (UTC)
  event_date        DATE          -- Partition key derived from client_timestamp
  sdk_version       STRING        -- SDK version for compatibility tracking
  platform          STRING        -- "web" | "ios" | "android" | "server"
  ip_address        STRING        -- Pseudonymized: last octet zeroed for GDPR
  country           STRING        -- Derived from IP via MaxMind GeoIP
  device_type       STRING        -- "desktop" | "mobile" | "tablet"
  os_name           STRING        -- e.g. "macOS", "Android"
  browser_name      STRING        -- e.g. "Chrome" (null for server-side)
  app_version       STRING        -- Mobile app version or server release

  -- Dynamic Properties (schema-on-read)
  properties        MAP<STRING,STRING>  -- Serialized as packed dict-encoded columns
                                        -- Common properties promoted to native columns
                                        -- during warm-store compaction

  -- System Metadata
  ingest_partition  INT           -- Queue partition that received this event
  governance_flags  ARRAY<STRING> -- Schema violations, PII detections
  replay_session_id STRING        -- Link to session replay recording (nullable)
```

**Storage optimizations:**
- `event_name` dictionary-encoded globally per project (typically <10K distinct values)
- `user_id` and `anonymous_id` dictionary-encoded per partition
- `properties` map stored as two parallel arrays (keys array, values array) with key dictionary shared across all rows in a row group
- Row groups sorted by `user_id` within partition to enable efficient per-user scans

---

### 2. User Properties (SCD Type 2)

User properties change over time (plan upgrades, name changes). Point-in-time correctness requires storing the full history.

```
Table: user_properties
Partitioned by: (project_id)
Sorted by: (project_id, user_id, valid_from)

Columns:
  project_id        STRING
  user_id           STRING
  property_key      STRING        -- e.g. "plan", "country", "email"
  property_value    STRING        -- Always stored as string; cast at query time
  valid_from        TIMESTAMP     -- When this value became effective
  valid_to          TIMESTAMP     -- NULL means currently active
  is_current        BOOLEAN       -- Shortcut for valid_to IS NULL
  set_by_event_id   STRING        -- Which identify() call set this value
```

**Point-in-time query pattern:**
```
FUNCTION lookup_user_property(user_id, property_key, as_of_timestamp):
  RETURN SELECT property_value
         FROM user_properties
         WHERE user_id = user_id
           AND property_key = property_key
           AND valid_from <= as_of_timestamp
           AND (valid_to IS NULL OR valid_to > as_of_timestamp)
         ORDER BY valid_from DESC
         LIMIT 1
```

---

### 3. Funnel Definition

```
Table: funnel_definitions
Stored in: OLTP metadata store (row-oriented)

Columns:
  funnel_id         UUID          -- PK
  project_id        STRING        -- FK → project
  name              STRING        -- Human-readable name
  created_by        STRING        -- User ID of creator
  created_at        TIMESTAMP
  steps             JSONB         -- Array of step definitions (ordered)
  conversion_window INTERVAL      -- Max time from step 1 to final step
  counting_method   STRING        -- "unique_users" | "unique_sessions" | "event_totals"
  global_filters    JSONB         -- Filters applied to all steps (e.g. platform=web)
  is_archived       BOOLEAN

Step definition (within steps JSONB array):
  {
    "step_index": 0,             -- 0-based ordering
    "event_name": "signup_clicked",
    "filters": [                 -- Property filters for this step
      {"property": "button_color", "operator": "eq", "value": "blue"}
    ],
    "is_exclusion_step": false,  -- If true: users who hit this step are EXCLUDED
    "label": "Clicked Sign Up"
  }
```

---

### 4. Cohort Definition

```
Table: cohort_definitions
Stored in: OLTP metadata store

Columns:
  cohort_id         UUID
  project_id        STRING
  name              STRING
  cohort_type       STRING        -- "behavioral" | "property" | "computed"
  definition        JSONB         -- Cohort criteria
  evaluation_mode   STRING        -- "dynamic" (recomputed per query) | "static" (snapshotted)
  snapshot_user_ids BINARY        -- Roaring bitmap of user IDs (for static cohorts)
  snapshot_at       TIMESTAMP     -- When static snapshot was taken
  size_estimate     BIGINT        -- HyperLogLog estimate of cohort size

Behavioral cohort definition example:
  {
    "type": "behavioral",
    "criteria": [
      {
        "event_name": "purchase_completed",
        "operator": "performed",      -- "performed" | "not_performed"
        "time_window": "last_30_days",
        "count_operator": ">=",
        "count_value": 2
      }
    ],
    "logical_operator": "AND"
  }
```

---

### 5. Retention Configuration

```
Table: retention_configs
Stored in: OLTP metadata store

Columns:
  config_id         UUID
  project_id        STRING
  name              STRING
  retention_type    STRING        -- "n_day" | "unbounded" | "bracket"
  cohort_event      STRING        -- Event that defines day 0 for a user
  return_event      STRING        -- Event that counts as a "return" (null = any event)
  cohort_granularity STRING       -- "daily" | "weekly" | "monthly"
  return_granularity STRING       -- "daily" | "weekly"
  max_periods       INT           -- How many periods to compute (e.g. 12 weeks)
  cohort_filter     JSONB         -- Optional filter on cohort event properties
  return_filter     JSONB         -- Optional filter on return event properties
  brackets          JSONB         -- For type="bracket": [{min:1,max:7},{min:8,max:30}]
```

---

## API Design

### Ingestion API

```
POST /v1/events
Content-Type: application/json
Authorization: Bearer {write_api_key}

Body:
{
  "batch": [
    {
      "event_id": "uuid-v4",          // Required for dedup
      "event_name": "page_viewed",
      "user_id": "user_123",          // Post-identify; nullable
      "anonymous_id": "anon_456",     // Always required; persists across identify()
      "timestamp": "2025-06-15T14:23:00Z",
      "properties": {
        "page_path": "/pricing",
        "referrer": "google.com",
        "plan": "free"
      },
      "context": {
        "sdk_version": "3.4.1",
        "platform": "web",
        "page": { "url": "https://example.com/pricing" },
        "user_agent": "Mozilla/5.0 ...",
        "ip": "203.0.113.42"
      }
    }
  ]
}

Response 202 Accepted:
{
  "received": 1,
  "deduplicated": 0,
  "errors": []
}

Response 400 Bad Request:
{
  "received": 0,
  "errors": [{"event_id": "uuid", "code": "MISSING_ANONYMOUS_ID", "message": "..."}]
}
```

### Funnel Query API

```
POST /v1/projects/{project_id}/queries/funnel
Authorization: Bearer {read_api_key}

Body:
{
  "funnel_id": "uuid",                // Use saved funnel definition
  // OR inline definition:
  "steps": [
    {"event_name": "signup_clicked", "filters": []},
    {"event_name": "signup_form_submitted", "filters": []},
    {"event_name": "email_verified", "filters": []}
  ],
  "conversion_window": "P7D",         // ISO 8601 duration
  "date_range": {
    "start": "2025-05-01",
    "end": "2025-05-31"
  },
  "breakdown": ["platform", "plan"],  // Property-based breakdown dimensions
  "cohort_id": "uuid",                // Optional: restrict to cohort
  "counting_method": "unique_users"
}

Response 200 OK:
{
  "query_id": "qry_abc123",
  "computed_at": "2025-06-15T14:23:10Z",
  "data_freshness": "2025-06-15T14:22:05Z",
  "steps": [
    {
      "step_index": 0,
      "event_name": "signup_clicked",
      "label": "Clicked Sign Up",
      "total_users": 45320,
      "breakdown": [
        {"values": {"platform": "web", "plan": "free"}, "users": 31200, "conversion_rate": 1.0},
        {"values": {"platform": "mobile", "plan": "free"}, "users": 14120, "conversion_rate": 1.0}
      ]
    },
    {
      "step_index": 1,
      "event_name": "signup_form_submitted",
      "total_users": 18934,
      "step_conversion_rate": 0.418,
      "overall_conversion_rate": 0.418,
      "median_time_to_convert_seconds": 47,
      "breakdown": [...]
    }
  ]
}
```

### Retention Query API

```
POST /v1/projects/{project_id}/queries/retention
Body:
{
  "cohort_event": "account_created",
  "return_event": null,               // null = any event
  "retention_type": "n_day",
  "cohort_granularity": "weekly",
  "return_granularity": "weekly",
  "max_periods": 12,
  "date_range": {"start": "2025-01-01", "end": "2025-06-01"},
  "breakdown": "plan"
}

Response:
{
  "matrix": [
    {
      "cohort_period": "2025-W01",
      "cohort_size": 1240,
      "retention": [1.0, 0.62, 0.44, 0.38, 0.35, 0.33, 0.32, ...]
      // Index 0 = week 0 (always 100%), Index N = week N retention
    }
  ]
}
```

---

## Core Algorithms (Step-by-step plan in plain English)

### Algorithm 1: Funnel Step Matching with Time Window

```
FUNCTION compute_funnel(project_id, steps, conversion_window, date_range, breakdown):

  // Phase 1: Build step bitmaps
  step_bitmaps = []
  step_user_timestamps = []    // user_id → earliest qualifying timestamp per step

  FOR step_index, step IN steps:
    user_timestamps = MAP()    // user_id → earliest timestamp for this step

    FOR event IN scan_events(project_id, date_range,
                              event_name=step.event_name,
                              filters=step.filters):
      IF event.user_id NOT IN user_timestamps:
        user_timestamps[event.user_id] = event.timestamp
      ELSE:
        user_timestamps[event.user_id] = MIN(user_timestamps[event.user_id],
                                             event.timestamp)

    step_user_timestamps.APPEND(user_timestamps)
    bitmap = build_bitmap(user_timestamps.KEYS())
    step_bitmaps.APPEND(bitmap)

  // Phase 2: Enforce ordering and time window constraints
  qualified_users = step_bitmaps[0].COPY()    // All users who hit step 0

  FOR step_index FROM 1 TO LEN(steps)-1:
    prev_timestamps = step_user_timestamps[step_index - 1]
    curr_timestamps = step_user_timestamps[step_index]

    // A user qualifies for step N if they hit step N-1 first AND
    // step N within conversion_window of step N-1
    new_qualified = EMPTY_BITMAP()
    FOR user_id IN qualified_users:
      IF user_id IN curr_timestamps:
        time_diff = curr_timestamps[user_id] - prev_timestamps[user_id]
        IF time_diff >= 0 AND time_diff <= conversion_window:
          new_qualified.ADD(user_id)

    qualified_users = new_qualified
    step_bitmaps[step_index] = qualified_users.COPY()

  // Phase 3: Compute breakdown if requested
  IF breakdown:
    RETURN compute_breakdown(step_bitmaps, step_user_timestamps, breakdown, project_id)
  ELSE:
    RETURN [{"step": i, "users": bm.CARDINALITY()} FOR i, bm IN step_bitmaps]
```

### Algorithm 2: N-Day Retention Computation

```
FUNCTION compute_retention_matrix(project_id, cohort_event, return_event,
                                   cohort_granularity, max_periods, date_range):

  matrix = []

  // Identify cohort groups (e.g. weekly cohorts)
  cohort_periods = generate_periods(date_range, cohort_granularity)

  FOR cohort_period IN cohort_periods:
    // Step 1: Find users whose first occurrence of cohort_event falls in this period
    cohort_users = MAP()  // user_id → cohort_event timestamp (first occurrence)

    FOR event IN scan_events(project_id, cohort_period,
                              event_name=cohort_event):
      IF event.user_id NOT IN cohort_users:
        cohort_users[event.user_id] = event.timestamp

    cohort_bitmap = build_bitmap(cohort_users.KEYS())
    cohort_size = cohort_bitmap.CARDINALITY()

    // Step 2: For each subsequent return period, count returning users
    retention_row = [1.0]  // Period 0 = 100%

    FOR period_offset FROM 1 TO max_periods:
      return_period = cohort_period + period_offset * cohort_granularity

      returned_users = EMPTY_BITMAP()
      FOR event IN scan_events(project_id, return_period,
                                event_name=return_event,
                                user_filter=cohort_bitmap):
        returned_users.ADD(event.user_id)

      // Intersect with cohort to ensure we only count cohort members
      returning_cohort = returned_users.AND(cohort_bitmap)
      retention_rate = returning_cohort.CARDINALITY() / cohort_size

      retention_row.APPEND(retention_rate)

    matrix.APPEND({
      "cohort_period": cohort_period,
      "cohort_size": cohort_size,
      "retention": retention_row
    })

  RETURN matrix
```

### Algorithm 3: Session-Based Path Analysis

```
FUNCTION compute_paths(project_id, anchor_event, direction, depth, date_range):
  // direction = "forward" (after anchor) or "backward" (before anchor)

  // Step 1: Find all sessions containing anchor event
  anchor_sessions = MAP()  // session_id → anchor event timestamp

  FOR event IN scan_events(project_id, date_range, event_name=anchor_event):
    IF event.session_id NOT IN anchor_sessions:
      anchor_sessions[event.session_id] = event.timestamp

  // Step 2: Reconstruct session sequences around anchor
  edge_counts = MAP()   // (from_event, to_event) → count

  FOR session_id, anchor_ts IN anchor_sessions:
    session_events = scan_session(project_id, session_id,
                                   sort_by="timestamp")

    // Find anchor position in session
    anchor_pos = FIND_INDEX(session_events, anchor_ts)

    IF direction == "forward":
      sequence = session_events[anchor_pos : anchor_pos + depth + 1]
    ELSE:
      sequence = REVERSE(session_events[anchor_pos - depth : anchor_pos + 1])

    // Build edges from consecutive events in sequence
    FOR i FROM 0 TO LEN(sequence) - 2:
      from_event = sequence[i].event_name
      to_event = sequence[i+1].event_name

      // Normalize: collapse repeated identical events ("loop detection")
      IF from_event == to_event:
        CONTINUE

      edge_key = (from_event, to_event)
      edge_counts[edge_key] = edge_counts.GET(edge_key, 0) + 1

  // Step 3: Build Sankey-compatible node/edge structure
  nodes = COLLECT_UNIQUE_EVENTS(edge_counts)
  edges = SORTED_BY_COUNT(edge_counts, descending=True)[:top_n_edges]

  RETURN {
    "anchor_event": anchor_event,
    "total_sessions": LEN(anchor_sessions),
    "nodes": [{"id": n, "label": n} FOR n IN nodes],
    "edges": [{"from": k[0], "to": k[1], "weight": v} FOR k, v IN edges]
  }
```

### Algorithm 4: Dynamic Behavioral Cohort Evaluation

```
FUNCTION evaluate_behavioral_cohort(project_id, cohort_definition, as_of_date):
  // cohort_definition.criteria = list of behavioral predicates

  candidate_bitmap = NULL  // NULL means "all users"

  FOR criterion IN cohort_definition.criteria:
    window_start = as_of_date - criterion.time_window
    window_end = as_of_date

    IF criterion.operator == "performed":
      // Find users who performed event >= count_value times
      event_counts = MAP()  // user_id → count

      FOR event IN scan_events(project_id, (window_start, window_end),
                                event_name=criterion.event_name):
        event_counts[event.user_id] = event_counts.GET(event.user_id, 0) + 1

      qualifying_users = EMPTY_BITMAP()
      FOR user_id, count IN event_counts:
        IF compare(count, criterion.count_operator, criterion.count_value):
          qualifying_users.ADD(user_id)

    ELSE IF criterion.operator == "not_performed":
      // Find all users in project, then subtract performers
      all_users = get_all_active_users(project_id, window_end)
      performers = evaluate_behavioral_cohort_performed(project_id, criterion, window)
      qualifying_users = all_users.AND_NOT(performers)

    // Apply logical AND/OR across criteria
    IF cohort_definition.logical_operator == "AND":
      IF candidate_bitmap IS NULL:
        candidate_bitmap = qualifying_users
      ELSE:
        candidate_bitmap = candidate_bitmap.AND(qualifying_users)
    ELSE:  // OR
      IF candidate_bitmap IS NULL:
        candidate_bitmap = qualifying_users
      ELSE:
        candidate_bitmap = candidate_bitmap.OR(qualifying_users)

  RETURN candidate_bitmap
```

### Algorithm 5: Property Promotion Engine

Dynamically promotes frequently-queried event properties from the schema-on-read JSON blob to native typed columns during warm-store compaction.

```
FUNCTION property_promotion_engine(project_id):
  // Phase 1: Collect property access statistics from query logs
  property_stats = MAP()  // property_key → {query_count, distinct_values, avg_scan_time_saved}

  FOR query IN get_recent_queries(project_id, last_7_days):
    FOR property IN query.referenced_properties:
      IF property NOT IN native_columns(project_id):
        stats = property_stats.GET_OR_CREATE(property)
        stats.query_count += 1
        stats.total_rows_scanned += query.rows_scanned

  // Phase 2: Score candidates for promotion
  candidates = []
  FOR property_key, stats IN property_stats:
    // Estimate scan time savings from native column vs JSON extraction
    cardinality = get_property_cardinality(project_id, property_key)

    IF cardinality > 1_000_000:
      CONTINUE  // High-cardinality properties not worth promoting (bad dictionary encoding)

    compression_ratio = estimate_dictionary_compression(cardinality)
    scan_savings_ms = stats.total_rows_scanned * JSON_EXTRACTION_COST_PER_ROW
    promotion_cost = estimate_compaction_rewrite_cost(project_id, property_key)

    score = (scan_savings_ms * stats.query_count) / promotion_cost
    IF score > PROMOTION_THRESHOLD:
      candidates.APPEND((property_key, score, cardinality))

  // Phase 3: Promote top-N candidates during next compaction cycle
  candidates.SORT_BY(score, descending=True)
  FOR property_key, score, cardinality IN candidates[:MAX_PROMOTIONS_PER_CYCLE]:
    infer_type = detect_property_type(project_id, property_key)  // STRING, INT, FLOAT, BOOLEAN
    register_native_column(project_id, property_key, infer_type)
    schedule_compaction_rewrite(project_id, property_key)
    // Existing data rewritten during compaction; new data written to native column at ingestion
```

### Algorithm 6: Auto-Capture Event Classifier

Classifies automatically captured DOM interactions into meaningful event categories using element attributes and page context.

```
FUNCTION classify_autocaptured_event(dom_event):
  // dom_event contains: element_tag, element_text, element_classes,
  //   page_url, event_type (click/input/submit), element_attributes

  // Step 1: Generate stable event name from element identity
  element_signature = HASH(
    dom_event.element_tag,
    dom_event.element_text[:50],  // Truncate to avoid PII in button text
    get_nth_child_path(dom_event),  // CSS selector path
    dom_event.page_url.pathname     // Exclude query params (may contain PII)
  )

  event_name = CONCAT("autocapture_", dom_event.event_type, "_", element_signature[:8])

  // Step 2: Classify interaction type
  classification = "unknown"
  IF dom_event.element_tag IN ["button", "a", "input[type=submit]"]:
    classification = "cta_interaction"
  ELSE IF dom_event.element_tag IN ["input", "textarea", "select"]:
    classification = "form_interaction"
    // NEVER capture input values — PII risk
    dom_event.properties.DELETE("value")
  ELSE IF dom_event.event_type == "click" AND dom_event.element_tag == "a":
    classification = "navigation"

  // Step 3: Detect rage clicks (repeated clicks on same element within 3 seconds)
  recent_clicks = get_recent_clicks(dom_event.session_id, last_3_seconds)
  same_element_clicks = FILTER(recent_clicks, el => el.element_signature == element_signature)
  IF LEN(same_element_clicks) >= 3:
    classification = "rage_click"
    dom_event.properties["rage_click_count"] = LEN(same_element_clicks) + 1

  // Step 4: Attach enrichment properties
  dom_event.properties["element_text"] = TRUNCATE(dom_event.element_text, 100)
  dom_event.properties["classification"] = classification
  dom_event.properties["page_path"] = dom_event.page_url.pathname
  dom_event.event_name = event_name

  RETURN dom_event
```

### Algorithm 7: Query Result Cache Invalidation

Maintains cache consistency by tracking dependencies between cached query results and underlying data partitions.

```
FUNCTION manage_query_cache(project_id, cache):
  // Each cache entry tracks which partitions it depends on
  // Cache entry: { query_hash, result, partition_dependencies[], cached_at, ttl }

  FUNCTION on_partition_update(project_id, partition_key):
    // partition_key = (project_id, event_date, event_name)
    // When new data lands in a partition, invalidate all cached queries that depend on it

    affected_entries = cache.get_entries_depending_on(partition_key)
    FOR entry IN affected_entries:
      IF entry.is_historical AND entry.age < entry.ttl:
        // Historical data rarely changes — only invalidate if partition was rewritten
        // (e.g., late event compaction, GDPR erasure)
        CONTINUE
      cache.INVALIDATE(entry.query_hash)

  FUNCTION on_query_execute(query, result, scanned_partitions):
    // After a cold scan, cache the result with partition dependencies
    dependencies = []
    FOR partition IN scanned_partitions:
      dependencies.APPEND(partition.key)
      partition.register_dependent_cache_entry(query.hash)

    ttl = SELECT_TTL(query)
    // Recent data: short TTL (5 min) because new events may arrive
    // Historical data (> 2 days): long TTL (30 min) because partitions are stable
    // Mixed: use shortest TTL in the range

    cache.SET(query.hash, result, dependencies, ttl)

  FUNCTION SELECT_TTL(query):
    IF query.date_range.end > NOW() - 2_DAYS:
      RETURN 5_MINUTES
    ELSE IF query.date_range.end > NOW() - 90_DAYS:
      RETURN 30_MINUTES
    ELSE:
      RETURN 2_HOURS  // Cold data almost never changes
```

### Algorithm 8: Streaming Retention Matrix Update

Incrementally updates the pre-computed retention matrix as return events arrive, avoiding expensive batch recomputation.

```
FUNCTION streaming_retention_update(event, retention_configs):
  // For each active retention config in this project, check if this event
  // contributes to any retention cell

  FOR config IN retention_configs[event.project_id]:
    // Does this event match the return event?
    IF config.return_event IS NOT NULL AND event.event_name != config.return_event:
      CONTINUE
    // If return_event is NULL, any event counts as a return

    // Look up this user's cohort membership
    cohort_memberships = get_user_cohort_periods(event.user_id, config.config_id)
    // cohort_memberships = [(cohort_period_start, cohort_period_index), ...]

    FOR cohort_start, cohort_index IN cohort_memberships:
      // Determine which return period this event falls into
      event_offset = event.client_timestamp - cohort_start
      return_period_index = FLOOR(event_offset / config.return_granularity)

      IF return_period_index < 0 OR return_period_index > config.max_periods:
        CONTINUE  // Outside the retention window

      // Atomically add user to the retention matrix cell
      matrix_key = (config.config_id, cohort_index, return_period_index)
      retention_bitmap = get_retention_bitmap(matrix_key)

      IF NOT retention_bitmap.CONTAINS(event.user_id):
        retention_bitmap.ADD(event.user_id)
        write_retention_bitmap(matrix_key, retention_bitmap)
        // Increment cardinality counter for fast reads
        increment_retention_count(matrix_key)
```

---

## Internal APIs

### Compute ↔ Storage Interface

```
RPC ReadPartition(request):
  Input:
    project_id: STRING
    partition_key: (event_date, event_name)
    columns: LIST<STRING>           // Only read requested columns
    predicate: FilterExpression      // Pushed down to scan
    user_filter: BITMAP (optional)   // Only scan events for these users
    limit: INT (optional)
  Output:
    column_batches: LIST<ColumnBatch>  // Vectorized column data
    rows_scanned: INT
    rows_matched: INT
    bytes_read: INT

RPC WriteEventBatch(request):
  Input:
    project_id: STRING
    events: LIST<EventRecord>
    target_tier: ENUM(HOT, WARM)
  Output:
    partition_keys_written: LIST<PartitionKey>
    events_written: INT
    bytes_written: INT
```

### Query Engine ↔ Executor Interface

```
RPC SubmitQueryTask(request):
  Input:
    task_id: UUID
    query_fragment: QueryPlan       // Partial query plan for this worker
    priority: ENUM(HIGH, MEDIUM, LOW)
    memory_budget_mb: INT
    timeout_ms: INT
  Output:
    result_stream: STREAM<ResultBatch>  // Streaming results back to coordinator
    execution_stats: ExecutionStats

RPC GetWorkerStatus(request):
  Input:
    worker_id: STRING
  Output:
    active_tasks: INT
    memory_used_mb: INT
    cpu_utilization_pct: FLOAT
    available_slots: INT
```

---

## Error Code Classification

| Code Range | Category | Description | Client Action |
|---|---|---|---|
| 1000–1099 | Ingestion Validation | Missing required fields, invalid timestamp, malformed event | Fix event payload; do not retry |
| 1100–1199 | Deduplication | Event already seen (bloom filter hit) | Normal; event was already processed |
| 2000–2099 | Query Syntax | Invalid funnel/retention/path query definition | Fix query parameters |
| 2100–2199 | Query Execution | Timeout, memory exceeded, partition unavailable | Retry with narrower date range or simpler query |
| 2200–2299 | Query Quota | Concurrency limit exceeded, rate limit hit | Back off; retry after Retry-After header |
| 3000–3099 | Authentication | Invalid API key, expired token, insufficient permissions | Rotate key; check permissions |
| 4000–4099 | Governance | Schema violation detected, PII flagged | Review event schema; update instrumentation |
| 5000–5099 | System | Internal error, storage unavailable | Retry with exponential backoff |

---

## Data Lifecycle Management

### Event Compaction Pipeline

```
FUNCTION event_compaction_pipeline(project_id):
  // Phase 1: Hot → Warm compaction (runs hourly)
  hot_partitions = list_hot_partitions(project_id, older_than=24_HOURS)

  FOR partition IN hot_partitions:
    events = read_hot_partition(partition)

    // Sort by (user_id, client_timestamp) for optimal scan performance
    events.SORT_BY(user_id, client_timestamp)

    // Apply dictionary encoding for low-cardinality columns
    encoded = apply_dictionary_encoding(events, columns=[
      "event_name", "platform", "country", "device_type", "os_name", "browser_name"
    ])

    // Promote frequently-queried properties to native columns
    promoted = apply_property_promotions(encoded, project_id)

    // Write as Parquet with Zstd compression
    write_parquet(promoted, warm_store,
                  partition_by=["project_id", "event_date", "event_name"],
                  row_group_size=128_MB,
                  compression="zstd_level_3")

    // Update row group statistics (min/max per column, bloom filter on user_id)
    update_partition_statistics(partition)

    // Mark hot partition for expiry
    mark_for_expiry(partition, ttl=1_HOUR)  // Safety buffer before deletion

  // Phase 2: Warm → Cold compaction (runs nightly)
  warm_partitions = list_warm_partitions(project_id, older_than=90_DAYS)

  FOR partition IN warm_partitions:
    events = read_warm_partition(partition)

    // Apply maximum compression for cold storage
    write_parquet(events, cold_store,
                  compression="zstd_level_19",  // Higher compression for archival
                  row_group_size=256_MB)

    // Register in cold store catalog
    register_cold_partition(partition, cold_store_path)

    // Garbage collect warm partition after cold write confirmed
    schedule_gc(partition, delay=24_HOURS)  // 24h safety window
```
