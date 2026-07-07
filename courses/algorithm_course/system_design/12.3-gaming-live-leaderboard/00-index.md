# 12.3 Gaming: Live Leaderboard System

## System Overview

A Live Leaderboard System is the real-time ranking infrastructure that ingests continuous streams of player score updates, maintains globally ordered rankings across millions of concurrent players, and serves sub-100ms rank queries that power competitive gaming experiences—from casual mobile games to esports tournaments with millions of spectators. Modern leaderboard platforms process 50,000+ score updates per second, maintain sorted rankings across 100M+ player entries using in-memory sorted data structures (primarily sorted sets in key-value stores), support multiple ranking dimensions (global, regional, friend-circle, seasonal, tournament-specific), compute percentile positions in Logarithmic Time (Time grows slowly as data grows), handle seasonal resets without downtime, and push real-time rank changes to subscribed clients via persistent connections. These systems adopt a CQRS (Command Query Responsibility Segregation) architecture with separated write and read paths—score submissions flow through a validation pipeline into an append-only event log before updating in-memory ranking structures, while rank queries are served from read-optimized replicas with CDN caching for popular leaderboard segments (top-100, top-1000). The core challenge is maintaining exact global ordering at scale: a single sorted set can hold ~50M entries before memory constraints force sharding, at which point cross-shard rank computation requires scatter-gather coordination with merge algorithms—trading exact ranking for sub-second latency through approximate ranking techniques like bucket-based counting, segment trees, or probabilistic data structures.

---

## Key Characteristics

| Characteristic | Description |
|---|---|
| **Architecture Style** | CQRS with event-sourced score submissions, in-memory ranking engine, and read-replica fan-out for query serving |
| **Core Abstraction** | Score as an immutable event that transitions through validation → ranking update → notification pipeline, with the sorted set as the canonical ranking structure |
| **Processing Model** | Real-time for score ingestion and rank queries; micro-batch for cross-shard rank reconciliation; batch for historical snapshots, seasonal analytics, and leaderboard archival |
| **Data Structure** | Sorted sets (skip list + hash table) for O(log N) insert/rank/range operations; segment trees for approximate percentile queries at billion-entry scale |
| **Query Patterns** | Top-N retrieval, individual rank lookup, "around-me" relative ranking, friend-circle leaderboard, percentile position, historical rank trajectory |
| **Data Consistency** | Strong consistency for individual score updates (atomic sorted set operations); eventual consistency for cross-shard global rankings and friend leaderboards |
| **Availability Target** | 99.99% for rank queries (read path), 99.95% for score submissions (write path), zero data loss for validated scores |
| **Latency Targets** | < 50ms for top-N queries, < 100ms for individual rank lookup, < 500ms for score update propagation to ranking, < 2s for cross-shard global rank |
| **Scalability Model** | Vertical scaling of sorted set instances up to ~50M entries; horizontal sharding with scatter-gather for larger populations; read replicas for query fan-out |

---

## Quick Navigation

| Document | Focus Area |
|---|---|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity math for score throughput and memory |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, CQRS data flows, score submission and rank query paths |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API contracts, sorted set operations, sharded merge algorithms |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Sharded ranking engine, score validation pipeline, seasonal reset mechanism |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Sharding strategies, read replicas, failover, reset without downtime |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Anti-cheat, score validation, rate limiting, PII in public leaderboards |
| [07 - Observability](./07-observability.md) | Score processing latency, rank accuracy metrics, anomaly detection |
| [08 - Interview Guide](./08-interview-guide.md) | 45-minute pacing, leaderboard-specific traps, trade-off discussions |
| [09 - Insights](./09-insights.md) | Key architectural insights and cross-cutting patterns |

---

## What Differentiates This System

| Dimension | Naive Leaderboard | Production Live Leaderboard |
|---|---|---|
| **Ranking** | SQL ORDER BY on scores table | In-memory sorted sets with O(log N) rank lookup, sharded across instances |
| **Score Updates** | Direct DB write, re-query for rank | Event-sourced pipeline: validate → sorted set ZADD → async DB persist → notification |
| **Scale** | Single database, thousands of players | Sharded ranking engine, 100M+ players, 50K updates/sec |
| **Query Types** | Top-10 only | Top-N, around-me, friend circle, percentile, historical trajectory |
| **Consistency** | Full table scan per query | Atomic sorted set operations with eventual cross-shard consistency |
| **Latency** | Seconds (SQL query on large table) | Sub-50ms (in-memory sorted set with read replicas) |
| **Resets** | DELETE all, rebuild from scratch | Atomic key rotation with pre-warmed replacement, zero downtime |
| **Anti-cheat** | None | Multi-layer validation: server-authoritative scoring, statistical anomaly detection, replay verification |
| **Real-time** | Polling-based | WebSocket/SSE push with delta-compressed rank updates |
| **Multi-dimension** | Single global board | Per-game, per-region, per-season, per-tournament, friend-circle boards |

---

## What Makes This System Unique

### 1. The Ranking Problem Is Deceptively Simple Until You Need Global Order at Scale
Getting the "rank" of a player sounds trivial—sort by score, count position. But `SELECT COUNT(*) FROM scores WHERE score > ?` is O(N) and takes 35+ seconds on a 50M-row table. In-memory sorted sets solve this with O(log N) rank lookups, but a single instance tops out at ~50M entries due to memory constraints. Beyond that, you need sharded sorted sets where computing a global rank requires scatter-gather across all shards—and the merge step introduces latency proportional to shard count. The fundamental tension is between exact global ordering (which requires centralized knowledge) and horizontal scalability (which requires distributed state).

### 2. Read-to-Write Ratio Creates an Asymmetric Scaling Challenge
Leaderboards exhibit extreme read amplification: every score update triggers not just the updater's rank query but potentially thousands of nearby players checking if their rank changed. A 50K writes/sec workload generates 200K+ reads/sec, and during events (season end, tournament finale), read amplification can reach 100x. The system must scale reads independently from writes—read replicas for queries, primary instances for updates—without the replication lag creating visible rank inconsistencies.

### 3. Seasonal Resets Are a Unique Distributed Systems Problem
Unlike most systems where data accumulates monotonically, leaderboards periodically reset—clearing millions of entries and starting fresh. A naive reset (DELETE all keys) creates a thundering herd: millions of players simultaneously submit new scores to an empty leaderboard, and anyone querying during the reset sees stale or empty results. The solution requires atomic key rotation (swap from `leaderboard:season:7` to `leaderboard:season:8`), pre-warming the new leaderboard, archiving the old one asynchronously, and coordinating the switchover across all shards—a distributed transaction across in-memory data stores.

### 4. "Around-Me" Queries Break the Top-Heavy Assumption
Most caching strategies optimize for the "hot" top of the leaderboard—the top-100 or top-1000 that everyone views. But "around-me" queries (show my rank ±10 positions) are uniformly distributed across the entire ranking. A player ranked 4,523,891st needs the same query performance as the player ranked 1st. This means the entire sorted set must be query-ready, not just the top segment—invalidating the common assumption that leaderboard data has a "hot head" and "cold tail."

---

## Scale Reference Points

| Metric | Value |
|---|---|
| **Global gaming market** | ~$250 billion (2026) |
| **Players with leaderboard interaction** | 100M–500M monthly across major platforms |
| **Score updates (peak)** | 50,000–200,000 updates/sec during global events |
| **Rank queries (peak)** | 200,000–1,000,000 queries/sec |
| **Unique leaderboard instances** | 10,000–100,000 (per-game, per-mode, per-season, per-region) |
| **Entries per leaderboard (large)** | 10M–100M players |
| **In-memory footprint per 10M entries** | ~800 MB–1.2 GB (sorted set with 8-byte scores, 16-byte member IDs) |
| **Top-N query latency** | < 10ms (in-memory, local replica) |
| **Rank lookup latency** | < 50ms (single shard), < 200ms (cross-shard scatter-gather) |
| **Score-to-rank propagation** | < 500ms (P99) |
| **Seasonal reset frequency** | Weekly to quarterly, depending on game |
| **Historical snapshot retention** | 1–3 years for regulatory and analytics purposes |

---

## Technology Landscape

| Layer | Component | Role |
|---|---|---|
| **Client SDK** | Game client integration | Score reporting, rank polling, WebSocket subscription for real-time updates |
| **API Gateway** | Rate-limited entry point | Authentication, request routing, payload validation, DDoS protection |
| **Score Ingestion Service** | Validation pipeline | Server-authoritative score verification, anti-cheat checks, deduplication |
| **Ranking Engine** | In-memory sorted sets | Core ranking data structure: ZADD, ZRANK, ZREVRANGE, ZINCRBY operations |
| **Query Service** | Read-optimized layer | Top-N, around-me, friend circle, percentile queries served from read replicas |
| **Notification Service** | Real-time push | WebSocket/SSE connections for rank change notifications, delta compression |
| **Snapshot Service** | Periodic archival | Point-in-time leaderboard captures for historical queries and seasonal archives |
| **Reset Orchestrator** | Season lifecycle | Atomic leaderboard rotation, pre-warming, archive triggering, shard coordination |
| **Persistence Layer** | Durable storage | Score event log (append-only), player metadata, historical snapshots |
| **Analytics Pipeline** | Stream + batch processing | Score distribution analysis, engagement metrics, anomaly detection |
| **Anti-Cheat Service** | Fraud detection | Statistical scoring analysis, replay verification, behavioral profiling |

---

## Architecture Evolution: From Single Sorted Set to Global Platform

| Phase | Architecture | Scale | Trigger for Next Phase |
|---|---|---|---|
| **Phase 1: Single Instance** | One sorted set, no sharding, 2 read replicas | < 50M entries, < 100K queries/sec | Memory exceeds 80% of instance capacity |
| **Phase 2: Sharded + Replicated** | Hash-sharded sorted sets, 3+ replicas per shard, CDN caching | 50M–500M entries, < 1M queries/sec | Multi-region latency requirements emerge |
| **Phase 3: Multi-Region** | Regional ranking engines with global aggregation, edge caches | 500M+ entries, < 5M queries/sec | Platform serves multiple games/titles |
| **Phase 4: Platform Service** | Multi-tenant leaderboard-as-a-service, per-game isolation, usage-based metering | Billions of entries across tenants | Growth plateaus, optimization focus shifts to cost |

### Key Evolutionary Decisions

```
Phase 1 → 2: When to shard?
  Signal: Single instance P99 latency > 5ms or memory > 80%
  Risk: Premature sharding adds scatter-gather complexity for no benefit
  Rule of thumb: Shard at 30-40M entries, well before the 50M degradation cliff

Phase 2 → 3: When to go multi-region?
  Signal: Player complaints about latency from distant regions (> 150ms RTT)
  Risk: Cross-region consistency adds 100-200ms to global rank queries
  Rule of thumb: Deploy regional when > 20% of players are > 100ms from origin

Phase 3 → 4: When to become a platform?
  Signal: Multiple games/studios requesting leaderboard infrastructure
  Risk: Multi-tenancy requires noisy-neighbor isolation and usage metering
  Rule of thumb: When supporting 10+ distinct games, platform economics justify investment
```

---

## Related Patterns

| Related Topic | Connection to Live Leaderboard |
|---|---|
| [1.3 Distributed Key-Value Store](../1.3-distributed-key-value-store/00-index.md) | Sorted sets are the fundamental ranking primitive — understanding in-memory KV store internals (skip lists, hash tables, replication) directly informs leaderboard engine design |
| [1.5 Distributed Log-Based Broker](../1.5-distributed-log-based-broker/00-index.md) | The append-only event log for score durability mirrors log-based broker architecture — partitioning, retention, and replay semantics are shared concerns |
| [1.18 Event Sourcing System](../1.18-event-sourcing-system/00-index.md) | Score submissions as immutable events, ranking engine as a materialized view, and event replay for recovery are direct applications of event sourcing |
| [1.19 CQRS Implementation](../1.19-cqrs-implementation/00-index.md) | The separated write path (score ingestion) and read path (rank queries) with independent scaling is a canonical CQRS implementation |
| [12.2 Gaming: Multiplayer Game State Sync](../12.2-gaming-multiplayer-game-state-sync/00-index.md) | Server-authoritative game state is the upstream source of leaderboard scores — game state sync determines what scores are generated and how they're validated |
| [12.4 Gaming: Matchmaking System](../12.4-gaming-matchmaking-system/00-index.md) | Rating systems (Elo, Glicko-2) share sorted-data challenges with leaderboards — both maintain ordered rankings with concurrent updates and percentile-based queries |
| [1.1 Distributed Rate Limiter](../1.1-distributed-rate-limiter/00-index.md) | Multi-layer rate limiting for score submissions and rank queries uses token bucket and sliding window patterns from distributed rate limiter design |
| [1.4 Distributed LRU Cache](../1.4-distributed-lru-cache/00-index.md) | Leaderboard tiering (hot/warm/cold) with LRU eviction for inactive leaderboards and multi-tier response caching shares eviction and warming patterns |

---

*Next: [Requirements & Estimations →](./01-requirements-and-estimations.md)*
