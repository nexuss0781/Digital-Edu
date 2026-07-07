# 05 - Scalability & Reliability

## Scalability

### Horizontal vs Vertical Scaling

| Component | Scaling Type | Strategy |
|-----------|-------------|----------|
| Feed Crawler | Horizontal | Add workers; shard feeds by hash(feed_url) |
| API Gateway | Horizontal | Stateless; auto-scale behind LB |
| Catalog Service | Horizontal | Read replicas + cache; shard by podcast_id |
| Search Service | Horizontal | Index sharding + replicas per shard |
| Recommendation | Horizontal | Pre-compute scores; serve from cache |
| DAI Servers | Horizontal | Stateless stitching; deploy at edge PoPs |
| Transcription Pipeline | Horizontal | GPU worker pool; queue-based scaling |
| Playback Sync | Horizontal | Redis Cluster; shard by user_id |
| Analytics Ingestion | Horizontal | Partition by time; append-only writes |
| Audio CDN | Horizontal | Add PoPs; content pre-positioning |
| PostgreSQL | Vertical + Horizontal | Vertical for write leader; read replicas + sharding |

### Auto-Scaling Triggers

| Component | Scale-Up Trigger | Scale-Down Trigger | Min/Max |
|-----------|-----------------|-------------------|---------|
| API Servers | CPU > 60% or p99 latency > 500ms | CPU < 30% for 10 min | 10 / 200 |
| Feed Crawlers | Queue depth > 50K pending | Queue depth < 5K for 15 min | 5 / 100 |
| Transcription Workers | GPU queue wait > 10 min | Queue empty for 30 min | 2 / 50 |
| DAI Servers | CPU > 50% or p99 > 150ms | CPU < 25% for 10 min | 20 / 500 |
| Search Replicas | Query p99 > 800ms | Query p99 < 200ms for 30 min | 3 / 20 |

### Database Scaling Strategy

#### PostgreSQL (Catalog + Users)

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph WriteLayer["Write Path"]
        App[Application]
        Router[Shard Router]
    end

    subgraph Shard1["Shard 1 (podcast_id hash 0-33%)"]
        Primary1[(Primary)]
        Replica1a[(Read Replica)]
        Replica1b[(Read Replica)]
    end

    subgraph Shard2["Shard 2 (podcast_id hash 34-66%)"]
        Primary2[(Primary)]
        Replica2a[(Read Replica)]
        Replica2b[(Read Replica)]
    end

    subgraph Shard3["Shard 3 (podcast_id hash 67-100%)"]
        Primary3[(Primary)]
        Replica3a[(Read Replica)]
        Replica3b[(Read Replica)]
    end

    App --> Router
    Router --> Primary1 & Primary2 & Primary3
    Primary1 --> Replica1a & Replica1b
    Primary2 --> Replica2a & Replica2b
    Primary3 --> Replica3a & Replica3b

    classDef write fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef primary fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef replica fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class App,Router write
    class Primary1,Primary2,Primary3 primary
    class Replica1a,Replica1b,Replica2a,Replica2b,Replica3a,Replica3b replica
```

**Sharding strategy:**
- **Podcast + Episode tables:** Shard by `hash(podcast_id)` — episodes always co-located with their podcast
- **User tables:** Shard by `hash(user_id)` — subscriptions, history co-located with user
- **Cross-shard queries** (e.g., "all subscribers of podcast X"): Scatter-gather or materialized view

#### Redis Cluster (Playback Sync + Cache)

- **6-node cluster** minimum (3 primaries + 3 replicas)
- Hash slots distributed across primaries
- Playback positions: `playback:{user_id}:{episode_id}` → hash tag on `{user_id}`
- Session cache: `session:{user_id}` → co-located with playback data

#### Analytics (Time-Series DB + Data Warehouse)

- **Hot path (0-7 days):** Time-series DB with hourly partitions
- **Warm path (7-90 days):** Columnar store with daily partitions
- **Cold path (90+ days):** Object storage in Parquet format
- **Roll-up schedule:** Raw events → hourly aggregates (after 7 days) → daily aggregates (after 90 days)

### Caching Layers

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart LR
    subgraph L1["L1: Client Cache"]
        DeviceCache[Downloaded<br/>Episodes]
        MetaCache[Metadata<br/>Cache]
    end

    subgraph L2["L2: CDN Edge"]
        EdgeAudio[Audio Files<br/>TTL: 24h]
        EdgeArt[Cover Art<br/>TTL: 7d]
    end

    subgraph L3["L3: Application Cache"]
        RedisHot[Hot Metadata<br/>TTL: 15m]
        RedisSession[User Sessions<br/>TTL: 24h]
        RedisPlayback[Playback Pos<br/>TTL: 30d]
    end

    subgraph L4["L4: DB Query Cache"]
        PgCache[PostgreSQL<br/>Buffer Pool]
    end

    L1 --> L2 --> L3 --> L4

    classDef l1 fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef l2 fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef l3 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef l4 fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class DeviceCache,MetaCache l1
    class EdgeAudio,EdgeArt l2
    class RedisHot,RedisSession,RedisPlayback l3
    class PgCache l4
```

### Hot Spot Mitigation

| Hot Spot | Cause | Mitigation |
|----------|-------|------------|
| Viral episode launch | Millions stream same episode within hours | CDN pre-warming; replicate to all edge PoPs in advance |
| Top 100 podcasts | Disproportionate traffic | Dedicated cache partition; longer TTLs; origin shield |
| Morning commute spike | 3× traffic in 7-9 AM per timezone | Rolling auto-scale with timezone-aware prediction |
| New subscriber rush | Popular show promotion drives subscriptions | Rate-limit subscription writes; async processing |
| Feed crawler thundering herd | Many feeds have same poll interval | Jitter scheduling; shard by feed hash |

### CDN Scaling & Multi-CDN Strategy

```
Multi-CDN routing decision:
├── Primary CDN: 70% of traffic (negotiated volume discount)
├── Secondary CDN: 25% of traffic (geographic optimization)
├── Tertiary CDN: 5% of traffic (overflow + failover)
└── Routing logic:
    ├── Latency-based: real-user measurement (RUM) picks fastest CDN per region
    ├── Cost-based: shift traffic to cheapest CDN during off-peak
    ├── Availability-based: circuit breaker per CDN, failover on errors > 1%
    └── Content-aware: video episodes → video-optimized CDN; audio → general CDN
```

| Scenario | CDN Strategy | Rationale |
|----------|-------------|-----------|
| Normal traffic | Primary 70% / Secondary 25% / Tertiary 5% | Cost-optimized with geographic diversity |
| Viral episode (10× spike) | Shift to all CDNs equally (33/33/33) | Distribute load; no single CDN saturated |
| CDN outage | Remaining CDNs absorb via DNS failover (<30s) | GeoDNS health checks detect failure |
| Cost optimization (off-peak) | Shift to cheapest CDN up to 90% | Take advantage of volume pricing |

### Seasonal Scaling Patterns

```
Podcast consumption follows predictable patterns:

Daily pattern (per timezone):
├── 06:00-09:00: Morning commute peak (3× baseline)
├── 09:00-12:00: Moderate (1.5× baseline)
├── 12:00-14:00: Lunch spike (2× baseline)
├── 14:00-17:00: Low (0.8× baseline)
├── 17:00-19:00: Evening commute peak (2.5× baseline)
├── 19:00-22:00: Evening listening (1.5× baseline)
└── 22:00-06:00: Overnight low (0.3× baseline)

Weekly pattern:
├── Mon-Fri: 100% baseline (commute-driven)
├── Saturday: 70% baseline (leisure listening)
└── Sunday: 60% baseline (lowest day)

Annual events:
├── New Year (Jan 1): +40% (resolutions, new podcast discovery)
├── True crime releases: +200% spike for specific shows
├── Major news events: +50-100% for news/politics podcasts
└── Summer: -15% (vacation, outdoor activities)
```

### Capacity Planning

| Resource | Current | 6-Month Projection | Scaling Action |
|----------|---------|-------------------|----------------|
| CDN egress | 120 Gbps avg | 150 Gbps (25% growth) | Pre-negotiate CDN capacity; add PoPs |
| PostgreSQL storage | 2 TB | 3.5 TB | Add shards when approaching 70% capacity |
| Transcription GPU | 8 workers | 12 workers | Triggered by queue depth > 5K sustained |
| Feed crawlers | 30 workers | 40 workers | When p99 freshness exceeds 20 min |
| Audio object storage | 30 PB | 35 PB (video adds 5 PB) | Auto-scales; budget review quarterly |

### Load Shedding Strategy

When system approaches capacity limits, shed load in priority order:

```
Priority levels (shed lowest first):
Level 0 (NEVER shed): Active audio/video streaming
Level 1 (NEVER shed): Payment processing, subscription state
Level 2 (Last resort):  Search queries, recommendations
Level 3 (Shed early):   Analytics event ingestion (buffer on client)
Level 4 (Shed first):   Transcription pipeline, feed crawling (can catch up)
Level 5 (Shed first):   AI-generated podcast creation, export jobs

Implementation:
├── Each request tagged with priority level at API Gateway
├── When CPU > 85%: reject Level 5 requests (return 503 + Retry-After)
├── When CPU > 90%: reject Level 4 requests
├── When CPU > 95%: reject Level 3 requests
└── Level 0-1 always served (dedicated capacity reservation)
```

---

## Reliability & Fault Tolerance

### Single Points of Failure (SPOF) Identification

| Component | SPOF Risk | Mitigation |
|-----------|-----------|------------|
| Database primary | High | Multi-AZ deployment; automatic failover; WAL-based replication |
| Redis primary | Medium | Redis Cluster with replicas; automatic promotion |
| Feed scheduler | Medium | Active-passive with leader election; state in DB |
| DAI server | High (revenue) | Multiple instances per region; graceful fallback to ad-free |
| Search index | Medium | Replicated shards; fallback to basic metadata search |
| Message queue | High | Clustered deployment; persistent messaging; dead-letter queues |
| DNS | High | Multiple providers; failover DNS |

### Redundancy Strategy

| Layer | Strategy | RPO | RTO |
|-------|----------|-----|-----|
| Compute | Multi-AZ deployment, N+2 capacity | N/A | < 1 min (auto-scale) |
| Database | Synchronous replica in same region + async cross-region | 0 (in-region), < 5s (cross-region) | < 30s (in-region), < 5 min (cross-region) |
| Cache | Redis Cluster with replicas | Best-effort (cache is rebuildable) | < 10s (automatic promotion) |
| Object Storage | Cross-region replication (built-in) | < 15 min | < 1 min (automatic) |
| CDN | Multi-CDN with failover | N/A (cached content) | < 30s (DNS failover) |
| Message Queue | Clustered, persistent, replicated | 0 (synchronous replication) | < 30s |

### Failover Mechanisms

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph Primary["Primary Region"]
        LB1[Load Balancer]
        API1[API Servers]
        DB1[(Primary DB)]
        Redis1[(Redis Primary)]
    end

    subgraph Secondary["Secondary Region"]
        LB2[Load Balancer]
        API2[API Servers]
        DB2[(Replica DB)]
        Redis2[(Redis Replica)]
    end

    subgraph Routing["Global Routing"]
        DNS[GeoDNS]
        HC[Health Checks]
    end

    DNS --> LB1
    DNS -.->|failover| LB2
    HC --> LB1 & LB2
    DB1 -->|async replication| DB2
    Redis1 -->|async replication| Redis2

    LB1 --> API1
    LB2 --> API2
    API1 --> DB1 & Redis1
    API2 --> DB2 & Redis2

    classDef primary fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef secondary fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef routing fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class LB1,API1,DB1,Redis1 primary
    class LB2,API2,DB2,Redis2 secondary
    class DNS,HC routing
```

### Circuit Breaker Patterns

| Service | Circuit Breaker Config | Fallback |
|---------|----------------------|----------|
| Ad Decision Service | Open after 5 failures in 10s; half-open after 30s | Serve episode without ads |
| Recommendation Service | Open after 10 failures in 30s | Return trending/popular fallback list |
| Transcription Service | Open after 3 failures in 60s | Queue for later; episode available without transcript |
| Search Service | Open after 5 failures in 15s | Fall back to basic metadata search (DB query) |
| External RSS Feeds | Per-host: open after 3 consecutive failures | Use cached version of feed |
| Playback Sync | Open after 10 failures in 30s | Store locally on device; sync when service recovers |

### Retry Strategies

| Operation | Strategy | Max Retries | Backoff |
|-----------|----------|-------------|---------|
| Feed fetch (HTTP) | Exponential backoff with jitter | 5 | 5s, 15s, 60s, 300s, 1800s |
| Episode transcoding | Fixed retry | 3 | 60s between retries |
| Ad creative fetch | Immediate retry | 2 | No delay (latency-sensitive) |
| Analytics event ingest | Buffered retry | ∞ (persistent queue) | Batch retry every 30s |
| Playback position save | At-most-once (fire-and-forget) | 0 | Client retries on next heartbeat |
| Database write | Immediate retry on transient error | 3 | 100ms, 500ms, 2s |

### Graceful Degradation

| Scenario | Degraded Behavior | User Impact |
|----------|-------------------|-------------|
| Search service down | Disable search; show only browse/subscriptions | Users can't search but can play subscribed content |
| Recommendation engine down | Show trending + editorial picks | Less personalized discovery |
| Ad service down | Serve episodes ad-free | No interruption; revenue loss |
| Transcription pipeline down | Episodes available without transcript/chapters | No search by transcript content |
| Feed crawler backlog | Delayed new episode discovery | Subscribers notified late (minutes to hours) |
| Analytics pipeline lag | Dashboard data stale | Creators see delayed stats |
| Cross-region replication lag | Playback position slightly stale on second device | Minor UX issue (seconds behind) |

### Data Consistency During Failover

| Data Type | Consistency Model During Failover | Accepted Loss |
|-----------|----------------------------------|---------------|
| Playback positions | Eventual (< 30s stale) | User may lose last 30s of position |
| Subscriptions | Consistent (synchronous replication) | None — critical user state |
| Analytics events | At-least-once (buffered on client) | Events may be delayed, not lost |
| Search index | Stale (rebuild from primary after recovery) | Search results may be 15-60 min stale |
| Feed catalog | Eventual (async replication) | New episodes delayed by replication lag |
| DAI state | Stateless (reconstructed per request) | No loss — ad decisions are per-request |

### Thundering Herd Prevention

| Scenario | Prevention |
|----------|-----------|
| Cache miss on popular episode | Coalesced requests: only one origin fetch per cache key; others wait for result |
| CDN PoP failover | Gradual traffic shift (10%→25%→50%→100%) over 60s; avoid overwhelming target PoP |
| Database primary recovery | Connection pooling with gradual ramp-up; avoid connection storm |
| Feed polling restart after outage | Jittered scheduling: spread 4.5M polls over the full interval, not all at once |
| Popular show publishes | Stagger push notifications over 25 min; CDN pre-warming before first notification sent |

### Bulkhead Pattern

| Bulkhead | Isolation | Rationale |
|----------|-----------|-----------|
| Feed ingestion ↔ Streaming | Separate compute pools, separate DB connections | Crawler issues shouldn't affect playback |
| Free tier ↔ Premium tier | Separate API rate limits, priority queues | Premium users get guaranteed resources |
| Creator upload ↔ Listener APIs | Separate upload workers | Large upload burst shouldn't slow reads |
| Ad serving ↔ Content serving | Separate thread pools/containers | Ad service latency doesn't block content |
| Real-time APIs ↔ Analytics | Separate write paths | Analytics burst doesn't affect real-time |

---

## Disaster Recovery

### Recovery Objectives

| Metric | Target | Justification |
|--------|--------|---------------|
| RTO (streaming) | 5 minutes | Streaming is core function; failover to secondary region |
| RTO (creator dashboard) | 30 minutes | Not real-time critical |
| RTO (feed ingestion) | 1 hour | Feeds can catch up; RSS is eventually consistent |
| RPO (user data) | < 5 seconds | Synchronous replication within region |
| RPO (analytics) | < 5 minutes | Async replication; events buffered on client |
| RPO (audio content) | 0 | Cross-region object storage replication |

### Backup Strategy

| Data | Backup Method | Frequency | Retention |
|------|---------------|-----------|-----------|
| PostgreSQL | Continuous WAL archival + daily base backup | Continuous + daily | 30 days (daily), 1 year (weekly) |
| Redis | RDB snapshot + AOF | Hourly RDB, continuous AOF | 7 days |
| Search index | Configuration + rebuild from source | Daily snapshot | 7 days (rebuild from DB if needed) |
| Object storage | Cross-region replication (built-in) | Continuous | Indefinite |
| Message queue | Persistent + replicated | Continuous | 7 days retention |

### Multi-Region Architecture

| Region | Role | Services |
|--------|------|----------|
| US-East | Primary (US listeners) | Full stack + primary DB write |
| US-West | Secondary US | Full stack + read replica |
| EU-West | Primary (EU listeners, GDPR) | Full stack + EU data residency |
| AP-South | CDN PoP + read replica | Edge delivery + popular content cache |

### Graceful Degradation Hierarchy

```
Level 0 — Full Service (normal operation):
├── All features available
├── Personalized recommendations
├── Full DAI with ad targeting
├── Real-time transcription
└── Video + audio streaming

Level 1 — Reduced Personalization:
├── Recommendation engine degraded → show trending/popular
├── Search falls back to metadata-only (no transcript search)
├── All other features normal
└── Trigger: Recommendation or search service > 50% error rate

Level 2 — No Ads:
├── DAI service degraded → serve all content ad-free
├── Log missed ad impressions for backfill reporting
├── Revenue loss, but no user impact
└── Trigger: Ad decision latency > 200ms for 5 min

Level 3 — Core Only:
├── Streaming (audio) works
├── Subscriptions and playback sync work
├── Search, recommendations, analytics disabled
├── Feed crawling paused (use cached catalog)
└── Trigger: > 3 services in error state

Level 4 — Emergency CDN-Only:
├── CDN serves cached audio directly (no DAI, no API)
├── Client apps use cached metadata and local playback state
├── No new content discovery; existing library only
└── Trigger: Complete backend failure (all services down)
```

### Failover Runbook

```
1. DETECT: Health check failures for > 60 seconds in primary region
2. CONFIRM: Automated alert → on-call engineer validates (avoid false positive)
3. PROMOTE: Promote read replica to primary in secondary region
4. REDIRECT: Update GeoDNS to route traffic to secondary
5. VERIFY: Confirm streaming, search, playback sync operational
6. BACKFILL: Once primary recovers, re-sync data; do NOT failback automatically
7. POSTMORTEM: Document incident; update runbook if needed
```

### Video Podcast Scaling Considerations

| Aspect | Audio-Only Impact | With Video Added |
|--------|------------------|------------------|
| CDN egress | 120 Gbps baseline | +50 Gbps for video (10% of catalog, disproportionate traffic) |
| Object storage | 30 PB | +20 PB for video variants |
| Transcoding compute | 10 GPU workers | +30 workers (video is 10-20× more compute per episode) |
| DAI complexity | Audio SSAI only | Audio SSAI + video VAST/VPAID (separate pipelines) |
| Offline downloads | 50MB per episode | 500MB-1GB per video episode (storage management critical) |

### Chaos Engineering

| Experiment | Method | Expected Outcome |
|-----------|--------|-----------------|
| Kill random DAI server | Terminate 20% of DAI instances | Remaining servers absorb load; fallback to ad-free within 2s |
| CDN PoP failure | Block traffic to one CDN region | GeoDNS routes to next-closest PoP; latency increases < 200ms |
| Database primary failure | Simulate primary crash | Automatic failover to replica within 30s; < 5s RPO |
| Feed crawler network partition | Block outbound crawler traffic | Push-based feeds (WebSub/Podping) continue; backlog builds for poll-only feeds |
| Redis cluster node failure | Kill 1 of 6 Redis nodes | Automatic promotion of replica; playback positions temporarily stale |
| Message queue broker failure | Kill 1 of 6 brokers | Remaining brokers handle partitions; no message loss |

### Performance Testing Strategy

```
Load test profiles:
├── Baseline: Simulate normal daily traffic (48M DAU equivalent)
│   ├── 833 streaming req/s, 280 search req/s, 520 feed polls/s
│   └── Validate: all SLOs met, no errors
├── Peak: Simulate 5× morning commute (4,200 streaming req/s)
│   └── Validate: auto-scaling triggers, latency stays within SLO
├── Viral episode: Simulate 10M listeners streaming single episode
│   └── Validate: CDN pre-warming works, origin shield holds
├── Feed host outage: Simulate 500K feeds returning 5xx
│   └── Validate: backoff works, no impact on streaming
└── Soak test: 24-hour sustained load at 2× baseline
    └── Validate: no memory leaks, no connection exhaustion, no disk fill
```
