# Section 4: Social Media Platforms

> Part of the [System Design Insights Index](../insights-index.md). For cross-cutting patterns, see [Insights by Category](./by-category.md).

---

### 4.1 Facebook [View](../4.1-facebook/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | TAO's Two-Tier Cache as a Write-Conflict Eliminator | Consistency |
| 2 | Shard ID Embedded in Object ID -- Immutable Routing Without Lookups | Partitioning |
| 3 | Hybrid Fan-Out with Dynamic Threshold Adjustment | Scaling |
| 4 | Lease-Based Cache Regeneration to Prevent Thundering Herds | Caching |
| 5 | Multi-Objective Feed Ranking with Integrity as a Hard Constraint | System Modeling |
| 6 | Read-Your-Writes via Time-Bounded Routing | Consistency |
| 7 | Pool Isolation in Caching to Prevent Cross-Domain Eviction | Caching |
| 8 | Idempotent Post Creation via Client-Generated Keys | Atomicity |
| 9 | AI-Driven Content Moderation as a Real-Time Integrity Gateway | System Modeling |
| 10 | From Social Graph to Interest Graph -- Unconnected Content as 50% of Feed | Architecture Evolution |
| 11 | User True Interest Survey (UTIS) as a Ranking Calibration Signal | Feedback Loops |
| 12 | Infrastructure Capital Expenditure as a Structural Moat | Cost Optimization |

---

### 4.2 Twitter/X [View](../4.2-twitter/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Retweet Weight as a Viral Amplification Accelerator | System Modeling |
| 2 | 220 CPU-Seconds in 1.5 Wall-Clock Seconds via Massive Parallelism | Scaling |
| 3 | Asymmetric Follow Graph Creates a 10x Higher Celebrity Threshold | Traffic Shaping |
| 4 | Counter Sharding for Engagement Metrics Under Extreme Contention | Contention |
| 5 | 1-Second Search Indexing Through Kafka Buffering and Tuned ES Refresh | Streaming |
| 6 | Source-Level Retweet Deduplication to Prevent Feed Repetition | Data Structures |
| 7 | Trend Detection via Velocity-Based Anomaly Detection with Predictive Forecasting | Streaming |
| 8 | Graceful Degradation Ladders for Timeline Assembly | Resilience |
| 9 | Community Notes Bridging Algorithm Resists Political Polarization by Design | Consistency |
| 10 | Manhattan's Tunable Consistency Enables Per-Use-Case Durability Trade-offs | Consistency |
| 11 | Dynamic Celebrity Threshold Adapts Fan-out Strategy to Real-time System Load | Traffic Shaping |
| 12 | Grok Integration Creates a Second Inference Path Competing for Timeline Latency Budget | Architecture Evolution |

---

### 4.3 Instagram [View](../4.3-instagram/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Mandatory Media Processing Pipeline -- Every Post Is Compute-Intensive | System Modeling |
| 2 | AV1 Codec Adoption with Two-Phase Encoding for Latency vs Quality | Cost Optimization |
| 3 | Defense-in-Depth TTL for Stories Expiration | Distributed Transactions |
| 4 | Andromeda -- Sublinear Inference Cost for Explore Retrieval | Data Structures |
| 5 | Three-Tier Feature Store for ML Serving at 90 Million Predictions Per Second | Caching |
| 6 | Lazy CDN Invalidation with Client-Side Validation for Ephemeral Content | Edge Computing |
| 7 | Last-Write-Wins with Client Timestamps for Follow/Unfollow Toggle Races | Consistency |
| 8 | Super Resolution as a Bandwidth Multiplier on Both Server and Client | Edge Computing |
| 9 | MSVP Custom Silicon Eliminates the Generalist Tax on Video Transcoding | Cost Optimization |
| 10 | Model Registry with Stability Metrics Converts 1,000+ ML Models from Chaos to Coordinated System | System Modeling |
| 11 | "Your Algorithm" Tool Transforms Opaque ML Ranking into User-Controllable Preferences | System Modeling |
| 12 | LLM-Based Content Moderation Catches Semantic Violations That Pattern Matching Cannot | Security |

---

### 4.4 LinkedIn [View](../4.4-linkedin/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Full Graph Replication Instead of Sharding for Sub-50ms BFS | Partitioning |
| 2 | Canonical Edge Storage for Bidirectional Consistency | Consistency |
| 3 | Dwell Time as Primary Ranking Signal to Resist Engagement Gaming | System Modeling |
| 4 | Two-Sided Marketplace Scoring for Job Matching | System Modeling |
| 5 | Bidirectional BFS Reduces Node Visits by 4000x | Data Structures |
| 6 | Tiered Feed Cache Invalidation Based on Connection Strength | Caching |
| 7 | Auto-Accept as a Race Condition Resolution Strategy | Consistency |
| 8 | LLM-Based Content Quality Scoring with Batch-Plus-Fallback Architecture | Cost Optimization |
| 9 | LiGNN Cross-Domain Embeddings Unify Heterogeneous Signals into a Single Recommendation Space | ML Architecture |
| 10 | Economic Friction as the Primary Spam Prevention Mechanism for InMail | System Modeling |
| 11 | AI-Powered Collaborative Writing Creates a Feedback Loop Between Content Quality and Platform Value | Architecture Evolution |
| 12 | The Economic Graph as a Platform-Wide Knowledge Abstraction | System Integration |

---

### 4.5 TikTok [View](../4.5-tiktok/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Interest Graph vs Social Graph -- The Architectural Divergence | System Modeling |
| 2 | Collisionless Embedding Tables via Cuckoo HashMap | Data Structures |
| 3 | Lyapunov Optimization for Bandwidth-Constrained Prefetching | Traffic Shaping |
| 4 | 50ms End-to-End Inference Budget with Strict Phase Allocation | Scaling |
| 5 | 30-50% Exploration Injection to Prevent Filter Bubbles | System Modeling |
| 6 | Multi-CDN Load Balancing with Predictive Content Positioning | Edge Computing |
| 7 | ACID Transactions for Gift Processing in a Eventually-Consistent System | Atomicity |
| 8 | Progressive Video Upload with On-Demand Transcoding | Cost Optimization |
| 9 | Commerce Graph Overlay -- Merging Product Recommendations into the Content Feed | System Integration |
| 10 | Graduated Exposure as a Natural A/B Test for Content Quality | Algorithmic Design |
| 11 | Multi-Modal Embedding Fusion for Content Understanding | ML Architecture |
| 12 | Regulatory-Driven Data Architecture -- Project Texas and Project Clover as Architectural Constraints | Compliance Architecture |

---

### 4.6 Tinder [View](../4.6-tinder/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | S2 Geometry over Geohashing for Uniform Geo-Distribution | Data Structures |
| 2 | Atomic Check-and-Lock for Mutual Match Detection | Contention |
| 3 | Epsilon-Greedy Exploration in Recommendation Queues | System Modeling |
| 4 | Geoshard-Level Dynamic Splitting for Hot Spots | Scaling |
| 5 | TinVec Two-Tower Embeddings for Reciprocal Matching | System Modeling |
| 6 | Swipe Event Partitioning by Swiper ID | Streaming |
| 7 | Match Notification Rate Limiting and Batching | Traffic Shaping |
| 8 | Fork-Writing Strategy for Live Redis Migrations | Resilience |
| 9 | Chemistry -- Multimodal AI for Intent-Aware Matching | ML Architecture |
| 10 | Facial Liveness Verification as a Trust Infrastructure Layer | Security |
| 11 | Decentralized API Gateway with Per-Team Configuration | API Design |
| 12 | Container-Based Adaptive Geoshard Load Balancing | Partitioning |

---

### 4.7 WhatsApp [View](../4.7-whatsapp/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Erlang/BEAM's 2KB Processes as the Connection Scaling Secret | Scaling |
| 2 | X3DH + Double Ratchet for Asynchronous E2EE at Scale | Security |
| 3 | Store-and-Forward with Mnesia for Zero Long-Term Server Storage | Consistency |
| 4 | Sender Keys Protocol for O(1) Group Encryption | Scaling |
| 5 | Atomic Prekey Claim to Prevent Forward Secrecy Violations | Atomicity |
| 6 | Connection Takeover with Atomic Presence Updates | Consistency |
| 7 | Multi-Device Session Isolation for Ratchet Independence | Consistency |
| 8 | Offline Queue Disk Spillover with TTL-Based Eviction | Resilience |
| 9 | Multi-Device Architecture Without Phone-as-Primary Dependency | Consistency |
| 10 | Channels as Broadcast Architecture -- One-to-Many Without Group E2EE | Scaling |
| 11 | Privacy-Preserving AI with On-Device Processing | Security |
| 12 | MLS Protocol as the Future of Scalable Group Encryption | Scaling |

---

### 4.8 Snapchat [View](../4.8-snapchat/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Volatile Memory as a Deletion Guarantee, Not a Performance Optimization | Data Structures |
| 2 | Multi-Layer CDN Expiration for Stories TTL Coordination | Caching |
| 3 | On-Device ML with a 16.67ms Frame Budget | Edge Computing |
| 4 | Graceful View Window for Sender-Initiated Deletion | Atomicity |
| 5 | H3 Hexagonal Indexing with K-Anonymity for Snap Map | Security |
| 6 | Tiered Device Capability Models for AR Quality | Resilience |
| 7 | Deletion Queue Auto-Scaling with Prioritized Processing | Traffic Shaping |
| 8 | Multicloud as a Cost Optimization Strategy, Not Just Resilience | Cost Optimization |
| 9 | Screenshot Detection Creates an Imperfect but Necessary Trust Signal | Security |
| 10 | Snap Streaks as a Behavioral Lock-In Mechanism with Reliability Requirements | Resilience |
| 11 | Conversational AI (My AI) Requires Guardrails That Standard Chatbots Do Not | Safety |
| 12 | Envoy Service Mesh at 10M+ QPS as the Uniform Multicloud Abstraction | Infrastructure |

---

### 4.9 Telegram [View](../4.9-telegram/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Pointer-Based Fanout for 43M-Subscriber Channels | Scaling |
| 2 | PTS/QTS/SEQ State Model for Multi-Device Sync | Replication |
| 3 | Deterministic Tiebreaker for Simultaneous Secret Chat Initiation | Consensus |
| 4 | MTProto Binary Protocol for 58% Bandwidth Reduction | Cost Optimization |
| 5 | Chunked Resumable Upload with SHA256 Deduplication for Large Files | Resilience |
| 6 | Pre-Computed Subscriber Shards at Subscription Time | Partitioning |
| 7 | Version Vector with Separate Edit Fanout for Channel Edits | Consistency |
| 8 | Tiered Search Indexing with In-Memory Recent and Batch Historical | Caching |
| 9 | Topic-Based Threading Partitions a 200K-Member Supergroup Into Independent Message Streams | Partitioning |
| 10 | Mini App Session Bridging Extends MTProto Auth to WebView Without Token Exposure | Security |
| 11 | Append-Only Message Log with Tombstone Deletion Enables Global "Delete for Everyone" | Consistency |
| 12 | Stories 24h TTL Storage Uses Ring Buffer Semantics to Avoid Garbage Collection | Data Structures |

---

### 4.10 Slack/Discord [View](../4.10-slack-discord/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Hierarchical Fanout for Large Channels | Scaling |
| 2 | Consistent Hashing for Channel-to-Server Affinity | Partitioning |
| 3 | Selective Presence Subscriptions | Traffic Shaping |
| 4 | Presence Storm Mitigation Through Batching and Debouncing | Traffic Shaping |
| 5 | Process-Per-Entity Concurrency Model | System Modeling |
| 6 | Request Coalescing to Eliminate Hot-Partition Amplification | Contention |
| 7 | Single-Level Threading as a Deliberate UX and Engineering Trade-off | System Modeling |
| 8 | SFU Over MCU for Voice at Scale | Scaling |
| 9 | Idempotency Keys for Message Deduplication | Atomicity |
| 10 | Snowflake IDs for Distributed Message Ordering | Consistency |
| 11 | Optimistic Concurrency Control with Version Tracking | Consistency |
| 12 | GC-Free Databases for Predictable Tail Latency | Data Structures |
| 13 | Search Scalability Through Workspace and Time-Based Sharding | Search |

---

### 4.11 Reddit [View](../4.11-reddit/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Subreddit-Sharded Vote Queues for Hot Spot Isolation | Partitioning |
| 2 | Optimistic UI with Read-Your-Writes for Vote Counts | Consistency |
| 3 | The Hot Algorithm's Logarithmic Vote Dampening | System Modeling |
| 4 | Wilson Score for Confidence-Weighted Comment Ranking | System Modeling |
| 5 | ThingDB's Two-Table Flexible Schema Model | Data Structures |
| 6 | PostgreSQL UPSERT for Atomic Vote Deduplication | Atomicity |
| 7 | Invalidate-on-Write for Comment Tree Cache Consistency | Caching |
| 8 | Sampled Aggregation with Diversity Constraints for r/all | Scaling |
| 9 | Community-Based Sharding vs. User-Based Fanout | Partitioning |
| 10 | Batch Score Updates with Priority and Debouncing | Traffic Shaping |
| 11 | Selective Time-Decay Recalculation | Cost Optimization |
| 12 | Comment Tree Depth Limiting with "Load More" Stubs | Data Structures |
| 13 | Shadowbanning for Transparent Vote Manipulation Prevention | Security |
| 14 | Graceful Degradation Under Extreme Load | Resilience |
| 15 | Go Migration with Tap-Compare and Sister Datastore Validation | Resilience |
| 16 | Server-Driven UI for Mobile Feed Decoupling | Architecture Evolution |
| 17 | Transitional Shim for Protocol Migration | Architecture Evolution |

