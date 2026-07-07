# Low-Level Design

[← Back to Index](./00-index.md)

---

## Data Model

### Key Structure

```
Rate Limit Key Format:
┌─────────────────────────────────────────────────────────┐
│ rl:{dimension}:{identifier}:{window}:{endpoint}         │
└─────────────────────────────────────────────────────────┘

Examples:
- rl:user:12345:min:api/v1/orders     (per-user, per-minute)
- rl:ip:192.168.1.1:hour:api/v1/search (per-IP, per-hour)
- rl:apikey:ak_123:day:*              (per-API-key, per-day, all endpoints)
```

### Schema Design

```mermaid
erDiagram
    RATE_LIMIT_RULE {
        string rule_id PK
        string name
        string dimension "user|ip|apikey"
        string endpoint_pattern
        int limit
        int window_seconds
        string algorithm "token_bucket|sliding_window"
        string tier "free|premium|enterprise"
        timestamp created_at
        timestamp updated_at
    }

    RATE_LIMIT_STATE {
        string key PK
        int count "or tokens for token_bucket"
        timestamp last_update
        timestamp window_start
        int ttl_seconds
    }

    USER_TIER {
        string user_id PK
        string tier
        json custom_limits "override defaults"
    }

    RATE_LIMIT_RULE ||--o{ RATE_LIMIT_STATE : "applied_to"
    USER_TIER ||--o{ RATE_LIMIT_STATE : "determines_limit"
```

### Storage Patterns by Algorithm

| Algorithm | Key | Value | TTL |
|-----------|-----|-------|-----|
| **Token Bucket** | `rl:tb:{id}:{endpoint}` | `{tokens: N, last_refill: timestamp}` | None (updated on access) |
| **Fixed Window** | `rl:fw:{id}:{endpoint}:{window_id}` | `count` | Window duration |
| **Sliding Window Log** | `rl:swl:{id}:{endpoint}` | Sorted Set of timestamps | Window duration |
| **Sliding Window Counter** | `rl:swc:{id}:{endpoint}:{window_id}` | `count` | 2x window duration |

### Indexing Strategy

| Index | Purpose | Implementation |
|-------|---------|----------------|
| Primary key lookup | Rate limit check | Hash-based (Redis key) |
| User tier lookup | Determine limit | Cached in memory |
| Endpoint pattern match | Find applicable rule | Trie or prefix tree |
| Audit by user | Compliance | Time-series DB |

### Partitioning / Sharding

**Sharding Key:** `hash(user_id)` or `hash(api_key)`

```mermaid
flowchart LR
    subgraph Shard1["Shard 1 (hash 0-33%)"]
        R1[(Redis Node 1)]
    end
    subgraph Shard2["Shard 2 (hash 34-66%)"]
        R2[(Redis Node 2)]
    end
    subgraph Shard3["Shard 3 (hash 67-100%)"]
        R3[(Redis Node 3)]
    end

    Client --> Router[Consistent Hash Router]
    Router -->|user_123| R1
    Router -->|user_456| R2
    Router -->|user_789| R3
```

**Why user-based sharding:**
- Distributes load across nodes
- Co-locates all limits for a user (multi-endpoint checks efficient)
- Avoids hot spots from popular endpoints

### Data Retention

| Data Type | Retention | Reason |
|-----------|-----------|--------|
| Active counts | Window duration + buffer | Auto-expire via TTL |
| Configuration | Permanent | Required for operation |
| Audit logs | 90 days | Compliance |
| Metrics | 30 days detailed, 1 year aggregated | Capacity planning |

---

## API Design

### Rate Limit Check API

**Internal gRPC API** (service-to-service)

```
Service: RateLimiter

RPC CheckRateLimit(CheckRequest) returns (CheckResponse)
RPC GetRemainingQuota(QuotaRequest) returns (QuotaResponse)
RPC ResetLimit(ResetRequest) returns (ResetResponse)
```

**Request/Response Formats:**

```
CheckRequest {
    identifier: string      // user_id, ip, api_key
    dimension: Dimension    // USER, IP, API_KEY
    endpoint: string        // /api/v1/orders
    cost: int              // default 1, can be higher for expensive ops
    timestamp: int64       // client timestamp (for clock skew handling)
}

CheckResponse {
    allowed: bool
    current_count: int
    limit: int
    remaining: int
    reset_at: int64        // Unix timestamp
    retry_after: int       // Seconds (if denied)
}
```

### Configuration Management API

**REST API** (admin operations)

```
GET    /api/v1/rules                    # List all rate limit rules
GET    /api/v1/rules/{rule_id}          # Get specific rule
POST   /api/v1/rules                    # Create new rule
PUT    /api/v1/rules/{rule_id}          # Update rule
DELETE /api/v1/rules/{rule_id}          # Delete rule

GET    /api/v1/users/{user_id}/limits   # Get user's effective limits
PUT    /api/v1/users/{user_id}/tier     # Update user tier
POST   /api/v1/users/{user_id}/override # Temporary limit override
```

### Idempotency Handling

**Problem:** Retried requests shouldn't be double-counted.

**Solution:** Request deduplication with idempotency key

```
Request includes: X-Idempotency-Key: {uuid}

Step-by-step plan in plain English:
    IF exists(dedup_key:{idempotency_key}) THEN
        RETURN cached_response
    ELSE
        result = process_rate_limit()
        SET dedup_key:{idempotency_key} = result WITH TTL 5 minutes
        RETURN result
```

### Rate Limiting the Rate Limiter

| Endpoint | Limit | Window |
|----------|-------|--------|
| CheckRateLimit | 100,000/s per node | N/A (internal) |
| Config read APIs | 1000/min per admin | 1 minute |
| Config write APIs | 100/min per admin | 1 minute |

### Versioning Strategy

- API version in path: `/api/v1/`, `/api/v2/`
- Backward compatible changes within version
- Deprecation notice 6 months before removal
- Version sunset communicated via headers

---

## Core Algorithms

### 1. Token Bucket Algorithm

**Concept:** A bucket holds tokens; requests consume tokens; tokens refill at a steady rate.

```mermaid
flowchart TD
    Start([Request Arrives]) --> GetState[Get bucket state]
    GetState --> Refill[Calculate tokens to add<br/>based on time elapsed]
    Refill --> Check{tokens >= cost?}
    Check -->|Yes| Deduct[Deduct tokens]
    Deduct --> Allow([ALLOW Request])
    Check -->|No| Deny([DENY Request])
```

**Step-by-step plan in plain English:**

```
FUNCTION check_token_bucket(key, max_tokens, refill_rate, cost=1):
    current_time = NOW()

    // Atomic operation (Lua script in Redis)
    state = GET(key) OR {tokens: max_tokens, last_refill: current_time}

    // Calculate tokens to add
    time_passed = current_time - state.last_refill
    tokens_to_add = time_passed * refill_rate
    state.tokens = MIN(max_tokens, state.tokens + tokens_to_add)
    state.last_refill = current_time

    IF state.tokens >= cost THEN
        state.tokens = state.tokens - cost
        SET(key, state)
        RETURN {allowed: true, remaining: state.tokens}
    ELSE
        SET(key, state)
        wait_time = (cost - state.tokens) / refill_rate
        RETURN {allowed: false, retry_after: wait_time}
```

**Complexity:**
- Time: O(1)
- Space: O(1) per key

**Pros:** Allows bursts, memory efficient
**Cons:** Burst at bucket boundaries, slightly complex

---

### 2. Leaky Bucket Algorithm

**Concept:** Requests enter a queue (bucket) and are processed at a constant rate. Overflow is rejected.

```mermaid
flowchart TD
    Start([Request Arrives]) --> Check{Queue full?}
    Check -->|No| Enqueue[Add to queue]
    Enqueue --> Process[Process at constant rate]
    Process --> Allow([ALLOW])
    Check -->|Yes| Deny([DENY - Overflow])
```

**Step-by-step plan in plain English:**

```
FUNCTION check_leaky_bucket(key, bucket_size, leak_rate):
    current_time = NOW()

    state = GET(key) OR {water_level: 0, last_leak: current_time}

    // Leak water based on time passed
    time_passed = current_time - state.last_leak
    leaked = time_passed * leak_rate
    state.water_level = MAX(0, state.water_level - leaked)
    state.last_leak = current_time

    IF state.water_level < bucket_size THEN
        state.water_level = state.water_level + 1
        SET(key, state)
        RETURN {allowed: true, queue_position: state.water_level}
    ELSE
        SET(key, state)
        wait_time = 1 / leak_rate  // Time for one slot to free
        RETURN {allowed: false, retry_after: wait_time}
```

**Complexity:**
- Time: O(1)
- Space: O(1) per key

**Pros:** Smooths traffic, constant output rate
**Cons:** No burst tolerance, may delay legitimate spikes

---

### 3. Fixed Window Counter

**Concept:** Count requests in fixed time windows (e.g., every minute from :00 to :59).

```mermaid
flowchart TD
    Start([Request Arrives]) --> GetWindow[Calculate window ID<br/>window_id = timestamp / window_size]
    GetWindow --> GetCount[GET counter for window]
    GetCount --> Check{count < limit?}
    Check -->|Yes| Incr[INCREMENT counter]
    Incr --> SetTTL[Set TTL if new window]
    SetTTL --> Allow([ALLOW])
    Check -->|No| Deny([DENY])
```

**Step-by-step plan in plain English:**

```
FUNCTION check_fixed_window(key, limit, window_seconds):
    current_time = NOW()
    window_id = FLOOR(current_time / window_seconds)
    window_key = key + ":" + window_id

    // Atomic increment with TTL
    count = INCR(window_key)
    IF count == 1 THEN
        EXPIRE(window_key, window_seconds + buffer)

    IF count <= limit THEN
        RETURN {allowed: true, remaining: limit - count}
    ELSE
        reset_time = (window_id + 1) * window_seconds
        RETURN {allowed: false, retry_after: reset_time - current_time}
```

**Complexity:**
- Time: O(1)
- Space: O(1) per key per window

**Pros:** Simple, memory efficient, easy to understand
**Cons:** Boundary burst problem (2x limit at window edges)

**Boundary Problem Illustration:**

```
Window 1: [:00 - :59]    Window 2: [:00 - :59]
         ....[100 req]   [100 req]....
              ^--------------^
              200 requests in 2 seconds!
              (at boundary between windows)
```

---

### 4. Sliding Window Log

**Concept:** Store timestamp of each request; count requests within the sliding window.

```mermaid
flowchart TD
    Start([Request Arrives]) --> CleanOld[Remove timestamps<br/>older than window]
    CleanOld --> Count[Count remaining timestamps]
    Count --> Check{count < limit?}
    Check -->|Yes| Add[Add current timestamp]
    Add --> Allow([ALLOW])
    Check -->|No| Deny([DENY])
```

**Step-by-step plan in plain English:**

```
FUNCTION check_sliding_window_log(key, limit, window_seconds):
    current_time = NOW()
    window_start = current_time - window_seconds

    // Use Redis sorted set: score = timestamp, member = unique_id
    // Atomic operations
    ZREMRANGEBYSCORE(key, 0, window_start)  // Remove old entries
    count = ZCARD(key)                        // Count remaining

    IF count < limit THEN
        ZADD(key, current_time, unique_request_id)
        EXPIRE(key, window_seconds + buffer)
        RETURN {allowed: true, remaining: limit - count - 1}
    ELSE
        oldest = ZRANGE(key, 0, 0, WITHSCORES)
        retry_after = oldest.score + window_seconds - current_time
        RETURN {allowed: false, retry_after: retry_after}
```

**Complexity:**
- Time: O(log n) for sorted set operations
- Space: O(n) where n = requests in window (can be large!)

**Pros:** Most accurate, no boundary issues
**Cons:** High memory usage, slower operations

---

### 5. Sliding Window Counter (Recommended)

**Concept:** Hybrid approach - use counters from adjacent fixed windows with weighted average.

```mermaid
flowchart TD
    Start([Request Arrives]) --> GetWindows[Get current and<br/>previous window counts]
    GetWindows --> Calculate[Calculate weighted count:<br/>prev * overlap% + curr]
    Calculate --> Check{weighted < limit?}
    Check -->|Yes| Incr[Increment current window]
    Incr --> Allow([ALLOW])
    Check -->|No| Deny([DENY])
```

**Step-by-step plan in plain English:**

```
FUNCTION check_sliding_window_counter(key, limit, window_seconds):
    current_time = NOW()
    current_window = FLOOR(current_time / window_seconds)
    prev_window = current_window - 1

    current_key = key + ":" + current_window
    prev_key = key + ":" + prev_window

    // Get both counters
    current_count = GET(current_key) OR 0
    prev_count = GET(prev_key) OR 0

    // Calculate position in current window (0.0 to 1.0)
    window_start = current_window * window_seconds
    position_in_window = (current_time - window_start) / window_seconds

    // Weighted count: portion of previous window + all of current
    prev_weight = 1 - position_in_window
    weighted_count = (prev_count * prev_weight) + current_count

    IF weighted_count < limit THEN
        new_count = INCR(current_key)
        IF new_count == 1 THEN
            EXPIRE(current_key, 2 * window_seconds)  // Keep for next window's calculation
        RETURN {allowed: true, remaining: limit - weighted_count - 1}
    ELSE
        retry_after = window_seconds * (1 - position_in_window)
        RETURN {allowed: false, retry_after: retry_after}
```

**Complexity:**
- Time: O(1)
- Space: O(2) per key (two windows)

**Pros:** Accurate (Cloudflare reports 0.003% error), memory efficient, no boundary burst
**Cons:** Slightly more complex than fixed window

---

### 6. Generic Cell Rate Algorithm (GCRA)

**Concept:** Track "theoretical arrival time" (TAT) - the earliest time the next request should arrive for even spacing.

```mermaid
flowchart TD
    Start([Request Arrives]) --> GetTAT[Get TAT from storage]
    GetTAT --> CalcNew[new_tat = MAX(now, tat) + emission_interval]
    CalcNew --> Check{new_tat - now <= burst_tolerance?}
    Check -->|Yes| Update[Update TAT = new_tat]
    Update --> Allow([ALLOW])
    Check -->|No| Deny([DENY])
```

**Step-by-step plan in plain English:**

```
FUNCTION check_gcra(key, rate, burst):
    // rate = requests per second
    // burst = max burst size (in request units)

    emission_interval = 1 / rate           // Time between requests
    burst_tolerance = burst * emission_interval  // Max "debt" allowed

    current_time = NOW()
    tat = GET(key) OR current_time  // Theoretical Arrival Time

    // Calculate new TAT
    new_tat = MAX(current_time, tat) + emission_interval

    // Check if within burst tolerance
    IF new_tat - current_time <= burst_tolerance THEN
        SET(key, new_tat)
        remaining = FLOOR((burst_tolerance - (new_tat - current_time)) / emission_interval)
        RETURN {allowed: true, remaining: remaining}
    ELSE
        retry_after = tat - current_time - burst_tolerance + emission_interval
        RETURN {allowed: false, retry_after: retry_after}
```

**Complexity:**
- Time: O(1)
- Space: O(1) per key (just stores TAT timestamp)

**Pros:** Memory efficient, smooth rate enforcement, prevents micro-bursts
**Cons:** Complex to understand, requires careful time handling

---

## Algorithm Comparison Summary

| Algorithm | Memory | Accuracy | Burst Handling | Complexity | Best For |
|-----------|--------|----------|----------------|------------|----------|
| Token Bucket | O(1) | High | Allows bursts | Medium | General APIs (Stripe) |
| Leaky Bucket | O(1) | High | Smooths out | Low | Constant-rate processing |
| Fixed Window | O(1) | Medium | Boundary issue | Low | Simple cases (GitHub) |
| Sliding Log | O(n) | Very High | Accurate | High | Low-volume, high-accuracy |
| **Sliding Counter** | **O(1)** | **High** | **Balanced** | **Medium** | **High-scale (Cloudflare)** |
| GCRA | O(1) | Very High | Smooth spacing | High | Sophisticated rate shaping |

---

## State Machine

```mermaid
stateDiagram-v2
    [*] --> Normal: First request

    Normal --> Warning: usage > 80%
    Warning --> Normal: usage drops < 70%
    Warning --> Throttled: usage >= 100%
    Throttled --> Warning: window resets
    Throttled --> Normal: significant time passes

    Normal --> Normal: request allowed
    Warning --> Warning: request allowed (with warning)
    Throttled --> Throttled: request denied

    note right of Normal: Full quota available
    note right of Warning: Approaching limit<br/>Consider backing off
    note right of Throttled: Limit exceeded<br/>Requests denied
```

**State Transitions:**
- **Normal → Warning:** Return warning header to client
- **Warning → Throttled:** Start returning 429
- **Throttled → Warning:** Allow some requests again

---

## Advanced Algorithms

### 7. Cost-Based Rate Limiting

**Concept:** Assign different costs to different operations. Expensive operations consume more tokens than cheap ones.

```
FUNCTION check_cost_based_limit(key, max_tokens, refill_rate, operation_cost):
    // operation_cost comes from cost rules table
    // GET /users/:id = 1, GET /search = 5, POST /bulk = 50

    state = GET(key) OR {tokens: max_tokens, last_refill: NOW()}

    // Refill tokens based on elapsed time
    time_passed = NOW() - state.last_refill
    tokens_to_add = time_passed * refill_rate
    state.tokens = MIN(max_tokens, state.tokens + tokens_to_add)
    state.last_refill = NOW()

    IF state.tokens >= operation_cost THEN
        state.tokens = state.tokens - operation_cost
        SET(key, state)
        RETURN {
            allowed: true,
            remaining_tokens: state.tokens,
            cost_charged: operation_cost
        }
    ELSE
        wait_time = (operation_cost - state.tokens) / refill_rate
        RETURN {
            allowed: false,
            retry_after: wait_time,
            tokens_needed: operation_cost,
            tokens_available: state.tokens
        }
```

**Cost Rules Resolution:**

```
FUNCTION resolve_cost(endpoint, method, request):
    // Priority order: exact match > pattern match > method default > global default

    rules = [
        // Exact endpoint match
        cost_rules.get(method + ":" + endpoint),
        // Pattern match (e.g., /api/v1/users/*)
        cost_rules.match_pattern(method + ":" + endpoint),
        // Method default (e.g., POST = 5, GET = 1)
        method_defaults.get(method),
        // Global default
        1
    ]

    RETURN first_non_null(rules)
```

**Complexity:**
- Time: O(1) for rate check, O(k) for cost resolution (k = number of rules)
- Space: O(1) per key

**Pros:** Fair resource allocation, prevents expensive-query abuse
**Cons:** Requires maintaining cost table, cost estimation can be imprecise

---

### 8. Adaptive Rate Limiting (Load-Shedding)

**Concept:** Dynamically adjust rate limits based on backend health metrics. When backend is overloaded, reduce limits; when healthy, restore them.

```
FUNCTION adaptive_rate_limit(key, base_limit, health_monitor):
    // Calculate effective limit based on backend health
    health = health_monitor.current_state()

    adjustment_factor = calculate_adjustment(health)
    effective_limit = MAX(
        base_limit * MIN_FACTOR,  // Never go below 10% of base
        MIN(
            base_limit * MAX_FACTOR,  // Never exceed 150% of base
            base_limit * adjustment_factor
        )
    )

    // Use standard token bucket with adjusted limit
    RETURN check_token_bucket(key, effective_limit, refill_rate)

FUNCTION calculate_adjustment(health):
    // Multiplicative reduction, additive recovery
    IF health.error_rate > 0.05 THEN
        RETURN 0.5   // Cut to 50% under high errors
    IF health.p99_latency > 2 * health.baseline_p99 THEN
        RETURN 0.8   // Reduce to 80% under latency pressure
    IF health.queue_depth > 0.8 * health.queue_capacity THEN
        RETURN 0.7   // Reduce to 70% when queue is filling
    IF health.all_healthy_duration > 300 seconds THEN
        RETURN 1.0   // Full capacity after 5 min stable
    RETURN health.current_factor  // Hold current level
```

**Feedback Loop Protection:**

```
FUNCTION safe_adjust(current_factor, target_factor, last_adjust_time):
    // Prevent oscillation: minimum 30s between adjustments
    IF NOW() - last_adjust_time < 30 seconds THEN
        RETURN current_factor

    // Asymmetric: fast down, slow up
    IF target_factor < current_factor THEN
        // Reduce immediately (safety)
        RETURN target_factor
    ELSE
        // Recover gradually: +10% per interval
        RETURN MIN(target_factor, current_factor + 0.1)
```

**Complexity:**
- Time: O(1)
- Space: O(1) per key + O(1) global health state

**Pros:** Automatic back-pressure, prevents cascading failures
**Cons:** Risk of oscillation, requires tuned thresholds

---

### 9. Multi-Window Enforcement

**Concept:** Enforce multiple rate limits simultaneously (per-second, per-minute, per-hour) on a single request. All windows must allow the request.

```
FUNCTION check_multi_window(identifier, endpoint, windows):
    // windows = [
    //   {period: "second", limit: 10},
    //   {period: "minute", limit: 100},
    //   {period: "hour",   limit: 5000}
    // ]

    results = []
    most_restrictive = null

    FOR each window IN windows:
        key = build_key(identifier, endpoint, window.period)
        result = check_sliding_window_counter(key, window.limit, window.period_seconds)
        results.append(result)

        IF NOT result.allowed THEN
            IF most_restrictive IS null OR result.retry_after > most_restrictive.retry_after THEN
                most_restrictive = result

    IF most_restrictive IS NOT null THEN
        RETURN {
            allowed: false,
            retry_after: most_restrictive.retry_after,
            limiting_window: most_restrictive.window,
            windows: results  // Return all window states for headers
        }

    // All windows allow - increment all atomically
    FOR each window IN windows:
        key = build_key(identifier, endpoint, window.period)
        INCREMENT(key)

    RETURN {
        allowed: true,
        windows: results  // Client sees all quotas
    }
```

**Atomicity Challenge:**

```
// Problem: if we check all 3 windows, then increment all 3,
// another request could slip in between check and increment.
//
// Solution: Use a single Lua script that checks AND increments all windows atomically.

// Redis Lua script for multi-window atomic check-and-increment
local results = {}
local all_allowed = true

for i, window_key in ipairs(KEYS) do
    local limit = tonumber(ARGV[i])
    local count = tonumber(redis.call('GET', window_key) or 0)
    if count >= limit then
        all_allowed = false
    end
    results[i] = {count, limit}
end

if all_allowed then
    for i, window_key in ipairs(KEYS) do
        local ttl = tonumber(ARGV[#KEYS + i])
        redis.call('INCR', window_key)
        if tonumber(redis.call('GET', window_key)) == 1 then
            redis.call('EXPIRE', window_key, ttl)
        end
    end
end

return {all_allowed, results}
```

**Pros:** Prevents both burst and sustained abuse
**Cons:** Multiple Redis operations per check (mitigated by Lua script)

---

## Composite Key Resolution

Rate limiting often requires composite keys that combine multiple dimensions (user + endpoint, org + user, IP + endpoint). Resolution order matters for matching the most specific rule.

```
FUNCTION resolve_rate_limit_rule(request):
    // Resolution priority: most specific first
    candidates = [
        // Level 1: User + Endpoint (most specific)
        lookup_rule(request.user_id, request.endpoint),
        // Level 2: User + Endpoint pattern
        lookup_rule(request.user_id, pattern_match(request.endpoint)),
        // Level 3: User tier default
        lookup_rule(request.user_tier, "*"),
        // Level 4: Endpoint global
        lookup_rule("*", request.endpoint),
        // Level 5: System default
        default_rule()
    ]

    rule = first_non_null(candidates)

    // Build the rate limit key
    key = build_composite_key(rule, request)
    RETURN {rule: rule, key: key}

FUNCTION build_composite_key(rule, request):
    // Key format: rl:{scope}:{identifier}:{window}:{endpoint_hash}
    parts = ["rl"]
    parts.append(rule.scope)  // "user", "org", "ip", "apikey"

    SWITCH rule.scope:
        CASE "user":     parts.append(request.user_id)
        CASE "org":      parts.append(request.org_id)
        CASE "ip":       parts.append(hash(request.ip))
        CASE "apikey":   parts.append(hash(request.api_key))

    parts.append(rule.window_id())
    IF rule.per_endpoint THEN
        parts.append(hash(request.endpoint))

    RETURN join(parts, ":")
```

---

## Request Priority and Shedding

When the system is under load, not all requests should be treated equally. Priority-based rate limiting allows critical operations to proceed while shedding low-priority traffic.

```
FUNCTION priority_rate_limit(request, global_health):
    priority = classify_priority(request)

    // Under normal conditions, use standard limits
    IF global_health.level == HEALTHY THEN
        RETURN standard_rate_limit(request)

    // Under pressure, apply priority-based shedding
    SWITCH priority:
        CASE CRITICAL:    // auth, payments
            // Always allow (no rate limit during degradation)
            RETURN {allowed: true, priority: "critical"}
        CASE HIGH:        // core business operations
            // Use 80% of normal limit
            RETURN rate_limit(request, limit * 0.8)
        CASE NORMAL:      // standard API calls
            // Use 50% of normal limit
            RETURN rate_limit(request, limit * 0.5)
        CASE LOW:         // analytics, reporting
            // Use 10% of normal limit
            RETURN rate_limit(request, limit * 0.1)
        CASE BACKGROUND:  // batch jobs, exports
            // Block entirely during degradation
            RETURN {allowed: false, retry_after: 300, reason: "shed"}

FUNCTION classify_priority(request):
    // Priority from request metadata, endpoint config, or user tier
    IF request.endpoint IN critical_endpoints THEN RETURN CRITICAL
    IF request.user_tier == "enterprise" THEN RETURN HIGH
    IF request.headers["X-Priority"] IS NOT null THEN RETURN request.headers["X-Priority"]
    RETURN NORMAL
```
