# High-Level Design — URL Shortener

## 1. System Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        WEB[Web App]
        API_CLIENT[API Client]
        MOBILE[Mobile App]
    end

    subgraph Edge["Edge Layer"]
        CDN[CDN / Edge Cache]
        GLB[Global Load Balancer]
    end

    subgraph Gateway["API Gateway"]
        GW[API Gateway<br/>Rate Limiting · Auth · Routing]
    end

    subgraph Services["Service Layer"]
        REDIRECT[Redirect Service<br/>Read-optimized]
        CREATE[Creation Service<br/>Write path]
        ANALYTICS_API[Analytics API<br/>Query service]
    end

    subgraph Cache["Cache Layer"]
        L1[In-Process Cache<br/>Top 100K URLs]
        L2[Distributed Cache<br/>500M URL working set]
    end

    subgraph Storage["Data Layer"]
        URL_DB[(URL Store<br/>Short code → Long URL)]
        ANALYTICS_DB[(Analytics Store<br/>Columnar / Time-series)]
    end

    subgraph Streaming["Event Pipeline"]
        QUEUE[Message Queue<br/>Click events]
        PROCESSOR[Stream Processor<br/>Aggregation · Fraud detection]
    end

    WEB --> CDN
    API_CLIENT --> GLB
    MOBILE --> GLB
    CDN --> GLB
    GLB --> GW

    GW --> REDIRECT
    GW --> CREATE
    GW --> ANALYTICS_API

    REDIRECT --> L1
    L1 -.->|miss| L2
    L2 -.->|miss| URL_DB
    CREATE --> URL_DB
    CREATE --> L2

    REDIRECT --> QUEUE
    QUEUE --> PROCESSOR
    PROCESSOR --> ANALYTICS_DB
    ANALYTICS_API --> ANALYTICS_DB

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef edge fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef stream fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class WEB,API_CLIENT,MOBILE client
    class CDN,GLB edge
    class GW gateway
    class REDIRECT,CREATE,ANALYTICS_API service
    class L1,L2 cache
    class URL_DB,ANALYTICS_DB data
    class QUEUE,PROCESSOR stream
```

---

## 2. Data Flow — Write Path (URL Creation)

### 2.1 Flow Description

1. **Client** sends POST request with long URL, optional custom alias, and optional TTL
2. **API Gateway** authenticates the request (API key or OAuth token), applies rate limiting
3. **Creation Service** validates the URL (format, reachability, reputation check)
4. If custom alias requested: check uniqueness in URL Store (strong consistency read)
5. If no custom alias: generate a unique short code via ID Generator → Base62 encode
6. **Write** the mapping (short_code → long_url + metadata) to URL Store
7. **Populate** the distributed cache with the new mapping
8. **Return** the shortened URL to the client

### 2.2 Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as API Gateway
    participant CS as Creation Service
    participant IG as ID Generator
    participant DB as URL Store
    participant CACHE as Distributed Cache

    C->>GW: POST /api/v1/urls {long_url, custom_alias?, ttl?}
    GW->>GW: Authenticate & rate limit
    GW->>CS: Forward validated request

    CS->>CS: Validate URL format & reputation

    alt Custom alias requested
        CS->>DB: CHECK alias uniqueness
        DB-->>CS: Available / Conflict
        alt Alias taken
            CS-->>GW: 409 Conflict
            GW-->>C: 409 Conflict
        end
        CS->>CS: Use custom alias as short_code
    else Generate short code
        CS->>IG: Request unique ID
        IG-->>CS: Snowflake ID
        CS->>CS: Base62 encode → short_code
    end

    CS->>DB: INSERT (short_code, long_url, metadata)
    DB-->>CS: Success
    CS->>CACHE: SET short_code → long_url
    CACHE-->>CS: OK
    CS-->>GW: 201 Created {short_url, short_code}
    GW-->>C: 201 Created {short_url, short_code}
```

---

## 3. Data Flow — Read Path (URL Redirect)

### 3.1 Flow Description

1. **User** clicks a short URL (e.g., `https://short.ly/a1B2c3`)
2. **DNS** resolves to nearest edge/CDN point of presence
3. **CDN** checks edge cache for 301 redirect (if enabled for this link)
4. On CDN miss: request reaches **API Gateway** → **Redirect Service**
5. **Redirect Service** checks in-process cache (L1) → distributed cache (L2) → URL Store (L3)
6. On any hit: return HTTP 301 or 302 redirect with `Location: <long_url>` header
7. **Asynchronously** emit a click event to the message queue (non-blocking)
8. If short code not found or expired: return 404 Not Found or 410 Gone

### 3.2 Sequence Diagram

```mermaid
sequenceDiagram
    participant U as User Browser
    participant CDN as CDN Edge
    participant RS as Redirect Service
    participant L1 as In-Process Cache
    participant L2 as Distributed Cache
    participant DB as URL Store
    participant MQ as Message Queue

    U->>CDN: GET /a1B2c3

    alt CDN cache hit (301 only)
        CDN-->>U: 301 Redirect → long_url
    else CDN miss
        CDN->>RS: Forward request

        RS->>L1: GET a1B2c3
        alt L1 hit
            L1-->>RS: long_url
        else L1 miss
            RS->>L2: GET a1B2c3
            alt L2 hit
                L2-->>RS: long_url
                RS->>L1: SET a1B2c3 (backfill)
            else L2 miss
                RS->>DB: SELECT long_url WHERE code = 'a1B2c3'
                DB-->>RS: long_url
                RS->>L2: SET a1B2c3 (backfill)
                RS->>L1: SET a1B2c3 (backfill)
            end
        end

        RS-->>U: 302 Redirect → long_url
        RS-)MQ: Async: emit click event
    end
```

---

## 4. Data Flow — Analytics Pipeline

### 4.1 Flow Description

1. **Redirect Service** emits a click event to the message queue (fire-and-forget, non-blocking)
2. **Message Queue** durably stores events with at-least-once delivery guarantee
3. **Stream Processor** consumes events in micro-batches:
   - Enriches with geo-location data (IP → country/city)
   - Parses User-Agent → device, browser, OS
   - Deduplicates using click ID (idempotent processing)
   - Detects fraud signals (bot patterns, click farms)
4. Writes enriched events to **Analytics Store** (columnar database)
5. **Materialized views** maintain pre-aggregated rollups (hourly, daily per URL)
6. **Analytics API** queries pre-aggregated data for dashboard responses

### 4.2 Analytics Data Flow Diagram

```mermaid
flowchart LR
    subgraph Capture["Event Capture"]
        RS[Redirect Service]
        MQ[Message Queue]
    end

    subgraph Process["Stream Processing"]
        GEO[Geo Enrichment<br/>IP → Location]
        UA[User-Agent<br/>Parser]
        DEDUP[Deduplication<br/>Click ID]
        FRAUD[Fraud Detection<br/>Bot filtering]
    end

    subgraph Store["Analytics Storage"]
        RAW[(Raw Events<br/>90-day retention)]
        HOURLY[(Hourly Rollups)]
        DAILY[(Daily Rollups)]
    end

    subgraph Serve["Analytics API"]
        DASH[Dashboard<br/>Queries]
        EXPORT[Data Export<br/>CSV/JSON]
    end

    RS --> MQ --> GEO --> UA --> DEDUP --> FRAUD
    FRAUD --> RAW
    RAW --> HOURLY --> DAILY
    HOURLY --> DASH
    DAILY --> DASH
    DAILY --> EXPORT

    classDef capture fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef process fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef store fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef serve fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class RS,MQ capture
    class GEO,UA,DEDUP,FRAUD process
    class RAW,HOURLY,DAILY store
    class DASH,EXPORT serve
```

---

## 5. Key Architectural Decisions

### 5.1 Synchronous Write, Asynchronous Analytics

| Decision | Synchronous URL creation; asynchronous click analytics |
|---|---|
| **Why** | The write path (URL creation) must return a usable short URL immediately—the user is waiting. Analytics, however, can tolerate seconds of delay without impacting user experience. Decoupling analytics into an async pipeline prevents click processing from adding latency to the redirect hot path. |
| **Trade-off** | Analytics data lags real-time by 1-5 seconds. Click counts shown to users may briefly undercount during traffic spikes. |
| **Alternative** | Synchronous counter increment on redirect (simpler, but adds 2-5ms to every redirect and creates write contention on the counter). |

### 5.2 Three-Tier Cache Architecture

| Decision | In-process (L1) → Distributed cache (L2) → Database (L3) |
|---|---|
| **Why** | The 100:1 read-to-write ratio means caching is the primary scaling mechanism. L1 (in-process) handles the hottest URLs with sub-millisecond latency and zero network hops. L2 (distributed cache) provides a shared, consistent view across all redirect servers. L3 (database) is the source of truth for cold URLs. |
| **Trade-off** | L1 may serve stale data for up to 15 seconds after a URL update. L2 adds a network hop (~1-2ms) but shares state. Three tiers increase operational complexity. |
| **Alternative** | Two-tier (distributed cache + DB) is simpler but sacrifices the sub-millisecond latency of L1 for hot URLs. |

### 5.3 302 as Default Redirect Status

| Decision | Use HTTP 302 (temporary) by default; offer 301 (permanent) as opt-in |
|---|---|
| **Why** | 302 ensures every click passes through the server, enabling accurate analytics, destination URL updates, and link expiration enforcement. 301 is cached by browsers indefinitely, making the short URL "unrevocable" from the user's perspective. |
| **Trade-off** | 302 means every click hits the server (higher infrastructure cost). 301 would reduce server load by 80%+ for repeat visitors but sacrifices analytics and flexibility. |
| **Alternative** | 301 with short `max-age` Cache-Control (e.g., 1 hour) as a compromise—reduces server load while maintaining some analytics granularity. |

### 5.4 Snowflake-Style ID Generation

| Decision | Use distributed Snowflake-style IDs converted to Base62 for short codes |
|---|---|
| **Why** | Snowflake IDs are coordination-free (each worker generates independently), time-ordered (enables efficient range queries), and unique across the cluster. Base62 encoding produces compact, URL-safe short codes. |
| **Trade-off** | Snowflake IDs are 64-bit, producing 11-character Base62 codes. For shorter codes (6-7 chars), can use a counter-based approach with range pre-allocation. |
| **Alternative** | MD5/SHA hash of URL (deterministic, but 128+ bits → longer codes and collision risk requires checking). Counter with Zookeeper coordination (shorter codes, but single point of failure). |

### 5.5 Separate Read and Write Services

| Decision | Split redirect handling and URL creation into separate microservices |
|---|---|
| **Why** | Read (redirect) and write (creation) have vastly different scaling profiles (100:1), latency requirements (5ms vs 200ms), and failure modes. Independent scaling allows provisioning 100x more redirect capacity without wasting resources on creation infrastructure. |
| **Trade-off** | Adds deployment complexity and requires service discovery. A monolith would be simpler for small scale. |
| **Alternative** | Single service with internal read/write separation at the thread pool level (viable up to ~10K QPS). |

---

## 6. Architecture Pattern Checklist

| Pattern | Applied? | Implementation |
|---|---|---|
| **CQRS** | ✅ Yes | Separate read (redirect) and write (creation) services with independent scaling |
| **Event Sourcing** | ⚠️ Partial | Click events are an append-only event log; URL mappings are state-based (not event-sourced) |
| **Cache-Aside** | ✅ Yes | Redirect service checks cache first, falls back to DB, then backfills cache on miss |
| **Write-Through Cache** | ✅ Yes | Creation service writes to DB and cache simultaneously |
| **Async Messaging** | ✅ Yes | Click events are published to message queue for async analytics processing |
| **Circuit Breaker** | ✅ Yes | Between redirect service and database; falls back to cache-only mode if DB is down |
| **Bulkhead** | ✅ Yes | Separate thread pools for redirect, creation, and analytics to prevent cascade |
| **Gateway Aggregation** | ✅ Yes | API gateway handles auth, rate limiting, and routing for all services |
| **Strangler Fig** | ⬜ N/A | Not applicable (greenfield design) |
| **Saga** | ⬜ N/A | No distributed transactions needed; URL creation is a single-service operation |

---

## 7. ID Generation Architecture

### 7.1 Counter Range Pre-Allocation Flow

```mermaid
sequenceDiagram
    participant CS1 as Creation Service 1
    participant CS2 as Creation Service 2
    participant RS as Range Server
    participant DB as Counter Store

    Note over RS,DB: Range Server maintains global atomic counter

    CS1->>RS: Request range (batch_size=10000)
    RS->>DB: FETCH_AND_ADD(10000)
    DB-->>RS: current_value = 500000
    RS-->>CS1: Range [500000, 509999]

    CS2->>RS: Request range (batch_size=10000)
    RS->>DB: FETCH_AND_ADD(10000)
    DB-->>RS: current_value = 510000
    RS-->>CS2: Range [510000, 519999]

    Note over CS1: Local counter: 500000
    CS1->>CS1: NextCode() → Base62(500000) = "2BLf"
    CS1->>CS1: NextCode() → Base62(500001) = "2BLg"

    Note over CS2: Local counter: 510000
    CS2->>CS2: NextCode() → Base62(510000) = "2Dq4"

    Note over CS1: After ~10K codes, requests new range
    CS1->>RS: Request range (batch_size=10000)
    RS-->>CS1: Range [520000, 529999]
```

### 7.2 Failover: Snowflake Fallback

When the Range Server is unreachable, creation services fall back to Snowflake IDs, producing longer but still valid short codes:

```
Counter Range (preferred):  6-7 character codes  (e.g., "a1B2c3")
Snowflake Fallback:         11 character codes   (e.g., "2cQaF4tXy9p")

Fallback trigger: Range Server unreachable for > 5 seconds
                  OR remaining local range < 100 codes with no range server connectivity
Recovery:         Resume counter-based generation once Range Server is reachable
```

---

## 8. Multi-Region Redirect Architecture

```mermaid
flowchart TB
    subgraph Users["Global Users"]
        US_USER[US User]
        EU_USER[EU User]
        ASIA_USER[Asia User]
    end

    subgraph DNS["GeoDNS Layer"]
        GDNS[GeoDNS - Route to nearest region]
    end

    subgraph US_REGION["US-East Region"]
        US_CDN[CDN PoP - US]
        US_REDIRECT[Redirect Service - US]
        US_CACHE[Cache Cluster - US]
        US_DB[(URL Store - US Primary)]
    end

    subgraph EU_REGION["EU-West Region"]
        EU_CDN[CDN PoP - EU]
        EU_REDIRECT[Redirect Service - EU]
        EU_CACHE[Cache Cluster - EU]
        EU_DB[(URL Store - EU Replica)]
    end

    subgraph ASIA_REGION["Asia-Pacific Region"]
        ASIA_CDN[CDN PoP - Asia]
        ASIA_REDIRECT[Redirect Service - Asia]
        ASIA_CACHE[Cache Cluster - Asia]
        ASIA_DB[(URL Store - Asia Replica)]
    end

    US_USER --> GDNS
    EU_USER --> GDNS
    ASIA_USER --> GDNS

    GDNS --> US_CDN --> US_REDIRECT --> US_CACHE --> US_DB
    GDNS --> EU_CDN --> EU_REDIRECT --> EU_CACHE --> EU_DB
    GDNS --> ASIA_CDN --> ASIA_REDIRECT --> ASIA_CACHE --> ASIA_DB

    US_DB -.->|async replication| EU_DB
    US_DB -.->|async replication| ASIA_DB

    classDef user fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef dns fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef cdn fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef db fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class US_USER,EU_USER,ASIA_USER user
    class GDNS dns
    class US_CDN,EU_CDN,ASIA_CDN cdn
    class US_REDIRECT,EU_REDIRECT,ASIA_REDIRECT service
    class US_CACHE,EU_CACHE,ASIA_CACHE cache
    class US_DB,EU_DB,ASIA_DB db
```

**Replication Model:**
- **Primary region (US-East)**: Handles all URL creations (single-writer for strong consistency)
- **Read replicas (EU, Asia)**: Serve redirect traffic with local cache + replicated URL store
- **Replication lag**: < 500ms average; new URLs may not resolve in non-primary regions for up to 1 second after creation
- **Failover**: If primary region is down, promote EU replica to primary; creation API switches via DNS failover

**Why single-writer for creation:** URL creation requires globally unique short code generation. Multi-writer would require distributed consensus for the counter range server, adding complexity for a write path that handles only 1,200 QPS. The redirect path (115K QPS) is read-only and fully served from any region.

---

## 9. Cache Warming and Invalidation Strategy

### 9.1 Cache Warming

| Trigger | Action | Scope |
|---------|--------|-------|
| **URL creation** | Write-through to L2 cache on create | Per-URL |
| **CDN edge miss** | Backfill CDN cache on first redirect per PoP | Per-PoP per-URL |
| **Server cold start** | Pre-load top 100K URLs from analytics hotlist | Per-instance |
| **New region deployment** | Bulk-load top 1M URLs from primary region | Per-region |

### 9.2 Cache Invalidation

| Event | L1 (In-Process) | L2 (Distributed) | CDN Edge |
|-------|-----------------|-------------------|----------|
| **URL updated (destination change)** | Invalidated via pub/sub notification | Explicit DELETE + re-SET | Purge API call to CDN (all PoPs) |
| **URL soft-deleted** | Expires naturally (15s TTL) | Explicit DELETE | Purge API call |
| **URL expired** | Expires naturally (15s TTL) | Background sweep | Not cached (302 uses `no-cache`) |
| **URL creation** | Not in L1 yet (populated on first redirect) | Write-through on create | Not in CDN yet |

### 9.3 Cache Stampede Prevention

```
ALGORITHM CacheStampedeProtection(short_code)
  // When a hot URL expires from cache and hundreds of concurrent requests
  // try to rebuild it simultaneously

  value ← L2_CACHE.GET("url:" + short_code)
  IF value != NULL:
    RETURN value

  // Acquire a distributed lock for this key
  lock_acquired ← L2_CACHE.SET_NX("lock:url:" + short_code, worker_id, TTL = 5s)

  IF lock_acquired:
    // This worker rebuilds the cache
    value ← DB.GET(short_code)
    IF value != NULL:
      L2_CACHE.SET("url:" + short_code, value, TTL = 1 hour)
    L2_CACHE.DELETE("lock:url:" + short_code)
    RETURN value
  ELSE:
    // Another worker is rebuilding; wait briefly and retry from cache
    SLEEP(50ms)
    RETURN L2_CACHE.GET("url:" + short_code) OR DB.GET(short_code)
```
