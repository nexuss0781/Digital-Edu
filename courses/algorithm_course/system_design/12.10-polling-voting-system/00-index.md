# 12.10 Design a Polling/Voting System

## System Overview

A Polling/Voting System is a write-heavy, latency-sensitive platform that enables users to create polls with multiple options, cast votes, and view aggregated results in real time. The core engineering challenge lies in absorbing massive vote bursts—millions of votes arriving within minutes during viral events, live broadcasts, or celebrity-driven polls—while maintaining vote integrity (no double-voting, no lost votes), delivering real-time result updates, and keeping the system available under extreme write contention. Production systems must handle peak write rates exceeding 100,000 votes per second on a single hot poll, aggregate results with sub-second freshness, enforce one-vote-per-user semantics without becoming a Slowest part of the process, and support diverse poll types (single-choice, multi-choice, ranked-choice, time-bounded) across web, mobile, and embedded contexts.

---

## Key Characteristics

| Characteristic | Description |
|---|---|
| **Architecture Style** | CQRS (Command Query Responsibility Segregation) with event-driven write path and materialized read views; write-optimized ingestion decoupled from read-optimized result serving |
| **Core Abstraction** | The Sharded Vote Counter—a distributed, partitioned counter that absorbs high-concurrency writes by spreading vote increments across N shards, then periodically merges them into a materialized result view |
| **Processing Model** | Synchronous vote acknowledgment (accept-or-reject in < 50ms) with asynchronous aggregation; real-time result streaming via server-sent events or WebSocket |
| **Data Consistency** | Strong consistency for vote deduplication (exactly-once voting per user per poll); eventual consistency for result tallies (sub-second staleness acceptable) |
| **Availability Target** | 99.99% for vote ingestion during active polls; 99.9% for result retrieval |
| **Latency Targets** | < 50ms vote acceptance P99; < 200ms result freshness P95; < 500ms end-to-end from vote cast to updated results visible |
| **Scalability Model** | Horizontally sharded write path partitioned by poll_id; read path served from pre-aggregated materialized views in cache; auto-scaled ingestion tier absorbs vote spikes |

---

## Quick Navigation

| Document | Focus Area |
|---|---|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, vote lifecycle, key CQRS decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API contracts, sharded counter algorithms, Step-by-step plan in plain English |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Vote ingestion pipeline, real-time aggregation, deduplication engine |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Hot poll mitigation, auto-scaling, fault tolerance, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Vote integrity, bot detection, ballot stuffing prevention, privacy |
| [07 - Observability](./07-observability.md) | Metrics, dashboards, anomaly detection, tracing |
| [08 - Interview Guide](./08-interview-guide.md) | Pacing, trade-offs, trap questions, common mistakes |
| [09 - Insights](./09-insights.md) | Key architectural insights and cross-cutting patterns |

---

## What Differentiates This System

| Dimension | Naive Poll System | Production Voting Platform |
|---|---|---|
| **Vote Storage** | Single row per option with `UPDATE count = count + 1` | Sharded counters with N shards per option; writes distributed randomly across shards to eliminate row-level lock contention |
| **Deduplication** | Check database before each vote (serial query) | Bloom filter + distributed set membership check; probabilistic fast-path rejection, authoritative slow-path verification |
| **Result Serving** | `SELECT SUM(count) GROUP BY option` on every request | Pre-aggregated materialized view in cache, updated by background aggregation pipeline every 100-500ms |
| **Hot Poll Handling** | Same infrastructure for 10 votes/sec and 100K votes/sec | Adaptive shard count that scales with vote velocity; overflow queuing; dedicated hot-poll infrastructure |
| **Consistency** | Full read-after-write consistency (slow) | Strong consistency for dedup (did I already vote?); eventual consistency for tallies (what are current results?) |
| **Scale** | Single database, vertical scaling | Write-path sharded by poll_id across multiple database nodes; read-path served entirely from cache tier |

---

## What Makes This System Unique

### 1. The Hot Counter Problem Is the Defining Challenge

Unlike most systems where writes are distributed across many entities (e.g., messages across conversations, orders across users), a polling system concentrates millions of writes on a single logical entity—one poll with a few options. When a celebrity posts a poll, 100,000 votes per second may target 4-5 options. This extreme write concentration on a handful of rows is the system's defining engineering problem, and it requires a fundamentally different approach from typical database operations: sharded counters that trade read simplicity for write scalability.

### 2. CQRS Is Not Optional—It's Architecturally Necessary

In most systems, CQRS is an optimization choice. In a voting system, it's a necessity. The write path (accepting votes) and read path (serving results) have fundamentally different performance profiles, consistency requirements, and scaling characteristics. Writes need low-latency deduplication and high-throughput counter increments; reads need fast aggregated results with sub-second freshness. Trying to serve both from the same data model creates an impossible tension between write contention and read performance.

### 3. The Deduplication-Throughput Tension

Enforcing one-vote-per-user requires checking every incoming vote against all previous votes for that poll—a read operation on the write path. At 100K votes/second, this check becomes the Slowest part of the process. The system must use a layered deduplication strategy: a fast probabilistic filter (Bloom filter) rejects known duplicates in microseconds, while a slower authoritative check (distributed set lookup) catches false negatives. This layered approach is unique to systems where uniqueness constraints must be enforced at extreme write throughput.

### 4. Time-Bounded Consistency Windows

Polls have explicit time boundaries (open/close times), which creates a unique consistency requirement: results must be exactly correct after a poll closes, but can be approximately correct while the poll is active. This allows the system to use eventual consistency during the high-throughput active period and switch to a synchronous reconciliation phase at close time—a pattern rarely seen in other distributed systems.

---

## Complexity Rating

| Dimension | Rating | Notes |
|---|---|---|
| **Write Throughput** | ★★★★★ | Extreme write concentration on hot counters; sharded counter design required |
| **Consistency** | ★★★★☆ | Split consistency model: strong for dedup, eventual for tallies, exact at close |
| **Concurrency** | ★★★★★ | Millions of concurrent writers targeting the same logical entity |
| **Security** | ★★★★☆ | Bot detection, ballot stuffing prevention, vote integrity, anonymous voting |
| **Scale** | ★★★★☆ | Must handle 10x-100x traffic spikes during viral events |
| **Domain Complexity** | ★★★☆☆ | Poll types, ranking algorithms, time-bounded lifecycle |

---

## Key Trade-offs at a Glance

| Trade-off | Dimension A | Dimension B | Typical Resolution |
|---|---|---|---|
| **Write Throughput vs Read Simplicity** | Sharded counters (fast writes) | Aggregated reads require summing shards (slower reads) | CQRS: sharded writes + materialized read views |
| **Dedup Accuracy vs Throughput** | Check every vote (accurate, slow) | Skip checks (fast, allows duplicates) | Bloom filter fast-path + authoritative slow-path |
| **Result Freshness vs Cost** | Aggregate on every vote (fresh, expensive) | Periodic batch aggregation (stale, cheap) | Sub-second periodic aggregation with push invalidation |
| **Strong vs Eventual Consistency** | Every reader sees latest tally (slow) | Readers see stale tally (fast) | Eventual during active poll; strong reconciliation at close |
| **Shard Count vs Aggregation Cost** | More shards (lower write contention) | More shards (higher read/aggregation cost) | Adaptive sharding: start small, increase with vote velocity |
| **Anonymous vs Identified Voting** | Privacy-preserving (no voter tracking) | Fraud-resistant (track who voted) | Cryptographic commitment: store vote proof without revealing voter identity |

---

## Scale Reference Points

| Metric | Small Platform | Medium Platform | Large Platform |
|---|---|---|---|
| Daily active polls | 1,000 | 50,000 | 500,000+ |
| Daily votes cast | 500K | 25M | 500M+ |
| Peak votes/sec (single poll) | 500 | 10,000 | 100,000+ |
| Peak votes/sec (platform-wide) | 1,000 | 50,000 | 500,000+ |
| Concurrent active polls | 200 | 10,000 | 100,000+ |
| Avg options per poll | 4 | 5 | 6 |
| Shards per hot option | 10 | 50 | 500+ |
| Result freshness | 5s | 1s | 200ms |
| Vote acceptance latency (P99) | 100ms | 50ms | 20ms |

---

## Technology Landscape

| Component | Technology Options | Selection Criteria |
|---|---|---|
| **Vote Ingestion** | Stateless API tier behind load balancer | Horizontal scalability, auto-scaling speed |
| **Vote Queue** | Distributed message broker, streaming platform | Throughput, ordering, durability |
| **Deduplication Store** | In-memory data grid, distributed cache with set operations | Sub-millisecond lookup, memory-efficient set storage |
| **Sharded Counters** | Key-value store with atomic increment, wide-column store | Write throughput, atomic operations |
| **Result Cache** | Distributed cache cluster | Sub-millisecond reads, pub/sub for invalidation |
| **Result Materialization** | Stream processor, change data capture pipeline | Aggregation latency, exactly-once semantics |
| **Poll Metadata** | Relational database with read replicas | ACID for poll lifecycle, strong consistency |
| **Real-Time Push** | WebSocket gateway, server-sent events | Connection count, message fan-out efficiency |
| **Bot Detection** | Rate limiting, CAPTCHA, behavioral analysis | False positive rate, user friction |
| **Analytics** | Columnar store, time-series database | Historical analysis, trend detection |

---

## Related Patterns

| Pattern | Where It Appears | Connection |
|---------|-----------------|------------|
| **Sharded Counter with Periodic Merge** | Vote Counter ↔ Aggregation Worker | Distributes write contention across N independent keys; background merge produces single materialized value |
| **Bloom Filter Fast-Path Rejection** | Dedup Service L1 layer | Microsecond probabilistic filter rejects known duplicates without network call; no false negatives guarantee correctness |
| **CQRS with Materialized View** | Write Path ↔ Read Path | Write-optimized sharded counters and read-optimized cache are fundamentally different data structures connected by async aggregation |
| **Adaptive Interval Processing** | Aggregation Worker frequency | 100ms for hot polls, 5s for cold polls—compute budget allocated proportionally to rate of change |
| **Atomic Compare-and-Swap via SADD** | Dedup Service L2 layer | Set-add return value (1=new, 0=exists) functions as lock-free CAS for concurrent dedup |
| **Hierarchical Fan-Out** | WebSocket result push | Edge servers subscribe to single source; each fans out locally, reducing Slowest part of the process from O(subscribers) to O(edge servers) |
| **Reconciliation Phase at State Boundary** | Poll Closing workflow | Transitional `Closing` state drains in-flight votes, performs final aggregation, and cross-verifies counts before marking results authoritative |
| **Split Consistency Model** | Dedup (strong) vs Results (eventual) | Consistency budget allocated where correctness impact is highest: write path integrity over read path freshness |

---

## Evolution Timeline

| Era | Model | Key Shift |
|-----|-------|-----------|
| Pre-2010 | Form-based polls, server-rendered results | Simple `COUNT(*)` queries; no real-time updates; page refresh to see results |
| 2010–2015 | AJAX-based live polling on social platforms | JavaScript-driven UI updates; long polling for result freshness; single-server architectures |
| 2015–2018 | WebSocket streaming, embedded widgets | Real-time push results; third-party embeddable polls; mobile-first design |
| 2018–2021 | Distributed counters, CQRS at scale | Sharded write paths; celebrity-scale viral polls; adaptive infrastructure |
| 2021–2024 | AI-powered bot detection, cross-platform polls | Behavioral analysis replaces CAPTCHA; polls embedded in stories, live streams, messaging apps |
| 2024–2026 | Ranked-choice at scale, verifiable polling | Instant-runoff voting for mainstream use; cryptographic vote verification; edge-computed result aggregation |
| 2026+ | Decentralized polling, AI-generated polls | On-device vote privacy; AI creates polls from trending topics; cross-platform federation protocols |

---

## Related Designs

| Design | Relevance |
|--------|-----------|
| [1.5 - Distributed Log-Based Broker](../1.5-distributed-log-based-broker/) | Event streaming for vote events, queue partitioning patterns |
| [4.2 - Real-Time Notification System](../4.2-real-time-notification-system/) | WebSocket fan-out, push notification patterns for result updates |
| [6.8 - Real-Time Collaborative Editor](../6.8-real-time-collaborative-editor/) | Concurrent write handling, operational transformation parallels |
| [8.3 - Stock Trading Platform](../8.3-zerodha/) | Predictable thundering herd (market open ≈ viral poll launch), binary streaming at scale |
| [12.5 - Rate Limiter](../12.5-rate-limiter/) | Token bucket and sliding window patterns for vote rate control |
| [12.13 - Bot Detection System](../12.13-bot-detection-system/) | Multi-signal bot scoring, behavioral analysis for ballot stuffing prevention |

---

## Sources

- Engineering blogs on high-throughput counter systems
- Academic research on distributed voting protocols and Bloom filter optimization
- Industry case studies: Twitter Polls, Instagram Polls, Twitch Predictions architecture
- NIST guidelines on electronic voting system security
- Research papers on sharded counter design and adaptive scaling
