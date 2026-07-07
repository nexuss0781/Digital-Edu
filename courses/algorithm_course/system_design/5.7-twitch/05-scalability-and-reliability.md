# Scalability & Reliability

## 1. Scalability

### 1.1 Horizontal vs Vertical Scaling Decisions

| Component | Strategy | Rationale |
|-----------|----------|-----------|
| **Chat Edge Nodes** | Horizontal | Each node handles ~50K connections; add nodes linearly with viewer count |
| **PubSub Cluster** | Horizontal | Shard by channel hash; add nodes as channel count grows |
| **API Gateway** | Horizontal | Stateless; scale behind load balancer |
| **Transcoding** | Horizontal + Vertical | Horizontal (more origin servers) + Vertical (ASIC hardware for 10x density) |
| **PostgreSQL** | Vertical first, then horizontal | Vertical for OLTP (300K+ TPS on single cluster); shard when limits hit |
| **Redis** | Horizontal (cluster mode) | Shard by key prefix (channel_id, user_id) |
| **Ingest PoPs** | Horizontal (geographic) | Deploy new PoPs in underserved regions |

### 1.2 Auto-Scaling Triggers

| Component | Metric | Scale-Up Trigger | Scale-Down Trigger | Cooldown |
|-----------|--------|-----------------|-------------------|----------|
| Chat Edge | Active connections / node | > 40K connections | < 15K connections | 5 min |
| API Services | CPU utilization | > 65% for 3 min | < 30% for 10 min | 5 min |
| Transcoding | Queue depth | > 10 pending streams | < 2 pending streams | 10 min |
| Search (OpenSearch) | Query latency p99 | > 500ms for 2 min | < 100ms for 15 min | 10 min |
| Replication Tree | Cache miss rate | > 5% for 5 min | < 1% for 15 min | 5 min |

### 1.3 Database Scaling Strategy

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph Primary["Primary Database Cluster"]
        PW["Primary Writer<br/>(PostgreSQL)"]
    end

    subgraph ReadReplicas["Read Replicas"]
        R1["Replica 1<br/>(API reads)"]
        R2["Replica 2<br/>(Discovery reads)"]
        R3["Replica 3<br/>(Analytics reads)"]
    end

    subgraph Shards["Sharded Tables"]
        SH1["Shard 1<br/>(channels A-M)"]
        SH2["Shard 2<br/>(channels N-Z)"]
        SH3["Shard 3<br/>(overflow)"]
    end

    subgraph TimePart["Time-Partitioned"]
        TP1["chat_messages<br/>(current month)"]
        TP2["chat_messages<br/>(last month)"]
        TP3["chat_messages<br/>(archive → cold storage)"]
    end

    PW -->|"Streaming Replication"| R1
    PW -->|"Streaming Replication"| R2
    PW -->|"Streaming Replication"| R3

    PW --> SH1
    PW --> SH2
    PW --> SH3

    PW --> TP1
    TP1 -.->|"Partition rotation"| TP2
    TP2 -.->|"Archive"| TP3

    classDef primary fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef replica fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef shard fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef time fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class PW primary
    class R1,R2,R3 replica
    class SH1,SH2,SH3 shard
    class TP1,TP2,TP3 time
```

**Key Decisions:**
- **PostgreSQL** is the primary OLTP database (~94% of 125+ DB hosts)
- Largest cluster handles 300K+ TPS
- Read replicas serve API and Discovery queries
- Chat messages are time-partitioned (monthly) for efficient retention and archival
- Subscriptions and follows are hash-sharded by `channel_id`

### 1.4 Caching Layers

| Layer | Technology | Hit Rate | Data | TTL |
|-------|-----------|----------|------|-----|
| **L1: In-Process** | Local memory | ~95% for hot keys | Stream metadata, user sessions | 10-30s |
| **L2: Distributed** | Redis Cluster | ~90% | Subscriber lists, viewer counts, emote data | 1-5 min |
| **L3: CDN Edge** | Replication Tree | ~85-95% | HLS segments, manifests, thumbnails | Segment duration (~2s) |
| **L4: Client** | Player buffer | N/A | Pre-fetched segments | 2-6s |

### 1.5 Hot Spot Mitigation

| Hot Spot | Problem | Solution |
|----------|---------|----------|
| **Mega-streamer ingest** | Single stream consuming disproportionate origin resources | Dedicated origin capacity; ASIC transcoding for top channels |
| **Trending category** | All browse traffic hits same category index | Cache category listings at API layer; stagger refresh |
| **Chat in viral channel** | Single channel PubSub topic overloaded | Shard PubSub topic by viewer segment; message sampling |
| **Go-live surge** | Popular streamer goes live → 500K simultaneous manifest requests | Pre-warm edge caches when stream starts; stagger viewer notification delivery |
| **Drops campaign** | Game drops event causes 5-10x traffic spike | Dedicated capacity reservation; CDN pre-positioning |

---

## 2. Reliability & Fault Tolerance

### 2.1 Single Points of Failure (SPOF) Identification

| Component | SPOF Risk | Mitigation |
|-----------|-----------|------------|
| Intelligest Routing Service | High — all routing decisions flow through IRS | Multi-AZ deployment; PoP fallback to cached routes |
| Transcoding Origin | Medium — stream assigned to single origin | IRS can re-route to alternate origin; stream restarts in <5s |
| PubSub Cluster | Medium — chat delivery depends on it | Cluster with replicas; channels redistributed on node failure |
| PostgreSQL Primary | High — single writer for transactional data | Synchronous standby; automatic failover (< 30s) |
| Payment Gateway | High — all financial transactions | Multi-provider (redundant payment processors); queue-based retry |
| DNS | High — all client resolution | Multiple DNS providers; anycast |

### 2.2 Redundancy Strategy

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph Region1["Primary Region"]
        API1["API Cluster"]
        DB1["PostgreSQL Primary"]
        REDIS1["Redis Primary"]
        ORIGIN1["Transcoding Origins"]
    end

    subgraph Region2["Secondary Region"]
        API2["API Cluster (Standby)"]
        DB2["PostgreSQL Standby"]
        REDIS2["Redis Replica"]
        ORIGIN2["Transcoding Origins"]
    end

    subgraph Global["Global Layer"]
        DNS["GeoDNS / Anycast"]
        POPS["~100 PoPs (Active-Active)"]
        EDGE["Edge Cache (Active-Active)"]
    end

    DNS --> POPS
    POPS --> ORIGIN1
    POPS --> ORIGIN2
    ORIGIN1 --> EDGE
    ORIGIN2 --> EDGE

    DB1 -->|"Streaming Replication"| DB2
    REDIS1 -->|"Async Replication"| REDIS2

    classDef primary fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef secondary fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef global fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class API1,DB1,REDIS1,ORIGIN1 primary
    class API2,DB2,REDIS2,ORIGIN2 secondary
    class DNS,POPS,EDGE global
```

**Redundancy by Component:**

| Component | Redundancy Level | Strategy |
|-----------|-----------------|----------|
| PoPs | N+2 per region | Active-active; anycast DNS |
| Origin DCs | N+1 globally | Active-active; IRS distributes load |
| Chat Edge | N+1 per cluster | Rolling deployment; connection draining |
| Database | 1 primary + 3+ replicas | Synchronous standby for failover |
| Redis | Cluster mode (3 masters + 3 replicas) | Automatic slot redistribution |
| Event Bus | 3x replication factor | Partition reassignment on broker failure |

### 2.3 Failover Mechanisms

| Scenario | Detection | Failover Action | Recovery Time |
|----------|-----------|----------------|---------------|
| Origin DC failure | Capacitor health check fails (5s) | IRS stops routing to DC; in-flight streams re-routed | 5-10s (stream restart) |
| Chat Edge node crash | TCP keepalive timeout (30s) | Viewers auto-reconnect to different Edge | 3-5s (reconnect) |
| PostgreSQL primary failure | Streaming replication lag > threshold | Promote synchronous standby | < 30s |
| Redis node failure | Cluster PING timeout (3s) | Cluster redistributes hash slots | < 5s |
| Payment processor down | Health check failures | Switch to backup payment processor | < 2s (transparent) |
| DNS provider failure | Synthetic monitoring | Remove provider from NS delegation | 30-60s (TTL-dependent) |

### 2.4 Circuit Breaker Patterns

```
Chat Moderation (Clue) Circuit Breaker:
  CLOSED: Normal operation — all messages evaluated
    → If error rate > 50% over 10s window → OPEN

  OPEN: Clue is bypassed
    → Messages pass through with async moderation
    → Potentially harmful messages deleted retroactively
    → After 30 seconds → HALF-OPEN

  HALF-OPEN: Send 10% of messages to Clue
    → If success rate > 90% → CLOSED
    → If error rate > 50% → OPEN

Similar patterns for:
  - Payment processing (fallback to queue-based)
  - Recommendation engine (fallback to popularity-based)
  - Search service (fallback to cached results)
  - Notification service (fallback to best-effort delivery)
```

### 2.5 Retry Strategies

| Operation | Strategy | Max Retries | Backoff |
|-----------|----------|-------------|---------|
| HLS segment fetch (viewer) | Exponential backoff | 3 | 100ms, 500ms, 2s |
| Chat message send | Immediate retry once | 1 | 0ms (same Edge node) |
| Subscription purchase | Idempotent retry | 5 | 1s, 2s, 4s, 8s, 16s |
| Origin routing query | Retry with fallback | 2 | 500ms, then cached route |
| Event bus publish | Retry with DLQ | 5 | 100ms exponential, then dead-letter |
| VOD upload to object storage | Chunked retry | 10 per chunk | 1s exponential |

### 2.6 Graceful Degradation

| Degradation Level | Trigger | What's Affected | User Experience |
|-------------------|---------|----------------|-----------------|
| **Level 1: Cosmetic** | Search service slow | Discovery page | Cached results shown; slight staleness |
| **Level 2: Feature** | Recommendation engine down | Personalization | Fall back to popularity-based browse |
| **Level 3: Quality** | Transcoding capacity saturated | Stream quality | Reduce quality ladder (3 variants instead of 5) |
| **Level 4: Chat** | Chat infrastructure overloaded | Chat features | Slow mode enforced globally; message sampling |
| **Level 5: Video** | CDN capacity critical | Video delivery | Reduce bitrate caps; disable lowest-latency mode |
| **Level 6: Commerce** | Payment system issues | Purchases | Queue purchases for later processing; disable gift subs |

### 2.7 Bulkhead Pattern

```
Separate resource pools (bulkheads) for:

┌──────────────────────────────────────────────┐
│ Video Pipeline Bulkhead                       │
│  - Dedicated origin compute                  │
│  - Separate network paths                    │
│  - Independent scaling group                 │
├──────────────────────────────────────────────┤
│ Chat Bulkhead                                │
│  - Dedicated Edge node fleet                 │
│  - Separate PubSub cluster                   │
│  - Independent connection pools              │
├──────────────────────────────────────────────┤
│ Commerce Bulkhead                            │
│  - Isolated database cluster                 │
│  - Dedicated payment processing threads      │
│  - Separate rate limiting                    │
├──────────────────────────────────────────────┤
│ API Bulkhead                                 │
│  - Separate service fleet for 3rd-party API  │
│  - Independent rate limiting and quota        │
│  - Throttle without affecting core experience│
└──────────────────────────────────────────────┘

Key principle: A Bits purchase surge should never
affect video transcoding or chat delivery.
```

---

## 3. Disaster Recovery

### 3.1 Recovery Objectives

| Component | RTO (Recovery Time) | RPO (Recovery Point) | Strategy |
|-----------|--------------------|--------------------|----------|
| Live video delivery | 10 seconds | N/A (live) | Automatic origin failover via IRS |
| Chat service | 30 seconds | 0 (stateless messages) | Auto-reconnect to alternate Edge |
| User database | 5 minutes | < 1 second | Synchronous standby promotion |
| Payment ledger | 15 minutes | 0 (synchronous replication) | Cross-region standby |
| VOD storage | 4 hours | < 1 hour | Cross-region object replication |
| Analytics/Data Lake | 24 hours | < 6 hours | Batch re-processing from event log |

### 3.2 Backup Strategy

| Data | Method | Frequency | Retention | Location |
|------|--------|-----------|-----------|----------|
| PostgreSQL | WAL archiving + base backup | Continuous WAL + daily base | 30 days | Cross-region object storage |
| Redis | RDB snapshots + AOF | RDB every 6 hours; AOF continuous | 7 days | Cross-AZ |
| Event Bus | Log retention | Continuous (replicated) | 7 days | 3x replication |
| Object Storage (VODs) | Cross-region replication | Continuous | Per retention policy | Multi-region |
| Configuration | Git-based + secrets vault | On change | Indefinite | Multi-region |

### 3.3 Multi-Region Considerations

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph NA["North America"]
        PoP_NA["PoPs (US, Canada)"]
        Origin_NA["Origin DCs"]
        Edge_NA["Edge Caches"]
        DB_NA["DB Primary"]
    end

    subgraph EU["Europe"]
        PoP_EU["PoPs (EU)"]
        Origin_EU["Origin DCs"]
        Edge_EU["Edge Caches"]
        DB_EU["DB Replica"]
    end

    subgraph APAC["Asia-Pacific"]
        PoP_APAC["PoPs (APAC)"]
        Origin_APAC["Origin DCs"]
        Edge_APAC["Edge Caches"]
        DB_APAC["DB Replica"]
    end

    PoP_NA --> Origin_NA
    PoP_EU --> Origin_EU
    PoP_APAC --> Origin_APAC

    Origin_NA --> Edge_NA
    Origin_EU --> Edge_EU
    Origin_APAC --> Edge_APAC

    DB_NA -->|"Async Replication"| DB_EU
    DB_NA -->|"Async Replication"| DB_APAC

    Origin_NA <-->|"Backbone"| Origin_EU
    Origin_EU <-->|"Backbone"| Origin_APAC

    classDef na fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef eu fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef apac fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class PoP_NA,Origin_NA,Edge_NA,DB_NA na
    class PoP_EU,Origin_EU,Edge_EU,DB_EU eu
    class PoP_APAC,Origin_APAC,Edge_APAC,DB_APAC apac
```

**Multi-Region Strategy:**
- **Video ingest**: Active-active across all regions (PoPs in ~100 locations)
- **Transcoding**: Active-active (IRS routes to nearest origin with capacity)
- **Video delivery**: Active-active (Replication Tree spans all regions)
- **Chat**: Active-active per region (Edge nodes regional; PubSub cross-region for shared channels)
- **Database**: Primary in NA; read replicas in EU/APAC; writes always routed to primary
- **Payments**: NA primary with synchronous standby; failover requires manual promotion for financial safety

---

## 8. Chaos Engineering

### Failure Injection Scenarios

| Scenario | Component Targeted | Steady-State Hypothesis | Injection Method |
|----------|-------------------|------------------------|-----------------|
| **PoP outage** | Ingest | Streams auto-reroute to next-closest PoP within 10s | Shut down PoP's external connectivity |
| **Origin DC failure** | Transcoding | IRS reroutes streams to remaining origins; viewer impact <30s | Kill origin processes |
| **Edge node crash** | CDN | Viewers reconnect to adjacent edge; rebuffer <5s | Terminate edge process |
| **PubSub node failure** | Chat | Chat messages continue via remaining PubSub nodes | Network partition PubSub node |
| **Database primary failure** | PostgreSQL | Standby promotes within 30s; reads continue on replicas | Stop primary process |
| **Payment gateway timeout** | Commerce | Retry with backup gateway; no double charges | Inject latency on gateway calls |
| **DNS resolution failure** | Global | Clients use cached DNS; fallback to hardcoded IPs | Poison DNS for test domains |

### Resilience Testing Cadence

| Test Type | Frequency | Scope | Owner |
|-----------|-----------|-------|-------|
| **Unit chaos** (single component) | Weekly (automated) | One service or node | Service team |
| **Integration chaos** (cross-service) | Monthly | Connected services (e.g., ingest → transcode → CDN) | Platform team |
| **Region failover** | Quarterly | Full regional failover | Infrastructure team |
| **Game day** (planned full exercise) | Biannually | Platform-wide with stakeholders | SRE + all teams |

---

## 9. Data Integrity and Consistency

### Consistency Guarantees by Data Type

| Data Type | Consistency Model | Guarantee | Trade-off |
|-----------|------------------|-----------|-----------|
| **Subscription status** | Strong (CP) | Payment confirmed before entitlement granted | Higher latency for subscription activation |
| **Bits balance** | Strong (CP) | Debit-before-cheer with optimistic locking | Prevents negative balances; occasional cheer rejection |
| **Viewer count** | Eventual (AP) | ±5% accuracy, 15-second reconciliation | Scalable counting; acceptable for social proof |
| **Chat delivery** | Best-effort (AP) | Messages may be lost during failures | Availability > guaranteed delivery for chat |
| **VOD availability** | Eventual (AP) | VOD appears within minutes of stream end | Async processing; no impact on live stream |
| **Follow/unfollow** | Eventual (AP) | Propagates within seconds | Cached aggressively; stale reads acceptable |

### Idempotency Patterns

| Operation | Idempotency Key | Strategy |
|-----------|----------------|----------|
| **Subscription purchase** | `{user_id}:{channel_id}:{billing_period}` | Database unique constraint + payment gateway dedup |
| **Bits cheer** | `{transaction_id}` (client-generated) | Idempotency table with 24-hour TTL |
| **Gift subscription** | `{gift_id}` (server-generated) | Two-phase: reserve → confirm |
| **Chat message** | `{nonce}` (client-generated) | Edge dedup buffer (5-second window) |
| **Clip creation** | `{user_id}:{channel_id}:{timestamp_bucket}` | Rate limit + dedup by time proximity |

---

## 10. Capacity Modeling for Events

### Pre-Event Capacity Calculator

```
ALGORITHM EventCapacityPlan(expected_peak_viewers, event_duration_hours)
  // Video infrastructure
  concurrent_streams ← 1 + featured_co_streams  // Usually 1-10 for events
  transcoding_cores ← concurrent_streams × 5 × 1.5  // 1.5x safety margin
  edge_bandwidth_gbps ← expected_peak_viewers × 5 Mbps / 1000
  edge_nodes_needed ← CEIL(expected_peak_viewers / 50000)  // 50K viewers/edge

  // Chat infrastructure
  chat_edge_nodes ← CEIL(expected_peak_viewers / 40000)  // 40K connections/node
  pubsub_partitions ← CEIL(chat_edge_nodes / 4)  // 4 edges per PubSub partition
  expected_chat_rate ← MIN(expected_peak_viewers × 0.02, 10000)  // 2% participation, max 10K msg/s

  // Commerce (subscription/Bits surge)
  payment_tps ← expected_peak_viewers × 0.001  // 0.1% purchase rate per minute
  bits_tps ← expected_peak_viewers × 0.005  // Higher during hype moments

  RETURN {
    transcoding: {cores: transcoding_cores, pre_warm: TRUE},
    cdn: {edges: edge_nodes_needed, bandwidth_gbps: edge_bandwidth_gbps, pre_warm: TRUE},
    chat: {edges: chat_edge_nodes, pubsub: pubsub_partitions, slow_mode: expected_peak_viewers > 100000},
    commerce: {payment_tps: payment_tps, bits_tps: bits_tps, pre_scale: TRUE},
    monitoring: {alert_sensitivity: "high", war_room: expected_peak_viewers > 500000}
  }
```

### Historical Event Scaling Data

| Event | Peak Viewers | Pre-Scale Factor | Actual vs Predicted | Issues |
|-------|-------------|-------------------|--------------------|---------|
| **Major esports final** | 2.5M | 3x normal | 1.8x predicted | Edge cache cold start in APAC |
| **New game launch** | 1.5M | 2x normal | 2.2x predicted (underestimated) | Transcoding queue backed up |
| **Charity marathon** | 500K sustained 48h | 1.5x normal | 1.1x predicted | DB connection pool exhaustion at hour 36 |
| **Drops campaign** | 3M spike over 30 min | 4x normal | 1.5x predicted | Notification service overwhelmed |

---

## 11. Load Shedding Strategy

### Graceful Degradation Under Extreme Load

```
ALGORITHM LoadSheddingDecision(component, current_load, max_capacity)
  load_ratio ← current_load / max_capacity

  IF load_ratio < 0.8:
    RETURN NORMAL  // Full service

  IF load_ratio < 0.9:
    // Level 1: Reduce non-essential features
    DISABLE animated emotes in chat
    REDUCE presence updates to 5s intervals
    DISABLE real-time viewer count updates (use cached)
    RETURN DEGRADED_L1

  IF load_ratio < 0.95:
    // Level 2: Protect core experience
    ENABLE chat slow mode globally (5s per message)
    DISABLE clip creation for non-partners
    REDUCE transcoding variants from 5 to 3 for non-partners
    STOP accepting new streams from non-partners
    RETURN DEGRADED_L2

  IF load_ratio >= 0.95:
    // Level 3: Emergency — protect existing sessions
    REJECT new viewer connections (show "try again later")
    REJECT new stream connections (except partners)
    DISABLE all non-video/chat features (commerce, clips, VOD)
    ENABLE aggressive chat message sampling
    RETURN EMERGENCY

  // All levels preserve: active streams, active chat, active subscriptions
```

### Load Shedding by Service

| Service | Shedding Trigger | What Gets Shed | What's Preserved |
|---------|-----------------|----------------|-----------------|
| **Ingest** | Origin CPU >90% | New non-partner streams rejected | Active streams continue |
| **Transcoding** | Queue depth >1000 | Reduce quality variants (5→3→1) | At least one variant always produced |
| **CDN** | Edge bandwidth >90% | New viewer connections queued | Active viewer sessions maintained |
| **Chat** | Edge connections >45K/node | New connections to overflow node | Active chat sessions continue |
| **Commerce** | Payment gateway latency >5s | Disable gift subs; queue non-critical purchases | Active subscription renewals processed |
| **API** | Request rate >100% budget | Third-party apps rate limited more aggressively | First-party features unrestricted |
