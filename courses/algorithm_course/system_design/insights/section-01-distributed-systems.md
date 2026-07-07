# Section 1: Core Distributed Systems

> Part of the [System Design Insights Index](../insights-index.md). For cross-cutting patterns, see [Insights by Category](./by-category.md).

---

### 1.1 Distributed Rate Limiter [View](../1.1-distributed-rate-limiter/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Lua Scripts as the Atomicity Primitive | Atomicity |
| 2 | Hierarchical Quota Allocation Sidesteps Global Coordination | Consistency |
| 3 | Fail-Open with Circuit Breaker is the Only Sane Default | Resilience |
| 4 | Algorithm Selection is a Per-Endpoint Decision, Not a Global One | Traffic Shaping |
| 5 | Hot Keys Require Local Aggregation, Not More Redis Throughput | Contention |
| 6 | Clock Drift at Window Boundaries Creates Silent Limit Bypass | Consistency |
| 7 | Never Use Distributed Locks for Rate Limiting | Contention |
| 8 | Thundering Herd on Window Reset is a Self-Inflicted DDoS | Traffic Shaping |
| 9 | Cost-Based Rate Limiting Transforms the Counter into a Weighted Ledger | Traffic Shaping |
| 10 | Adaptive Rate Limiting Creates a TCP-Like Feedback Loop Between System Health and Admission Control | Resilience |
| 11 | The Rate Limiter is the Best Observability Source You Already Have | Observability |
| 12 | The Sidecar-vs-Library-vs-Service Deployment Spectrum Has No Universal Winner | Architecture |

---

### 1.2 Distributed Load Balancer [View](../1.2-distributed-load-balancer/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Maglev Hashing Achieves Near-Minimal Disruption Through Permutation Tables | Data Structures |
| 2 | Two-Tier L4/L7 Architecture Separates Throughput from Intelligence | Scaling |
| 3 | Kernel Bypass (DPDK/XDP) Provides 10x Throughput by Eliminating the OS Network Stack | Scaling |
| 4 | Shallow Health Checks for Routing, Deep Health Checks for Alerting | Resilience |
| 5 | Copy-on-Write Backend Lists Eliminate the Health-Check-vs-Selection Race Condition | Contention |
| 6 | TLS Session Resumption Converts a 25-Core Problem into a 2-Core Problem | Cost Optimization |
| 7 | Connection Draining is the Difference Between Graceful and Chaotic Deployments | Resilience |
| 8 | Power of Two Choices Achieves Near-Optimal Load Distribution with O(1) State | Data Structures |
| 9 | Anycast Eliminates VIP as Single Point of Failure Through BGP Routing | Resilience |
| 10 | DSR Converts a Bandwidth Problem into a Routing Problem | Scaling |
| 11 | The Load Balancer's Availability Is More Important Than Any Backend's Availability | Resilience |
| 12 | HTTP/2 Breaks L4 Load Balancing Because Multiplexing Collapses Requests into Connections | System Modeling |

---

### 1.3 Distributed Key-Value Store [View](../1.3-distributed-key-value-store/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Virtual Nodes Transform Statistical Imbalance into Predictable Distribution | Partitioning |
| 2 | Vector Clocks Detect What Timestamps Cannot -- True Causality | Consistency |
| 3 | LSM Trees Trade Read Amplification for Sequential Write Performance | Data Structures |
| 4 | Tombstones Are the Price of Distributed Deletes -- and gc_grace_seconds is the Guardrail | Consistency |
| 5 | Sloppy Quorum with Hinted Handoff Prioritizes Availability Over Strict Replica Placement | Replication |
| 6 | Read-Your-Writes Consistency Solves the Most User-Visible Inconsistency Without Full Strong Consistency | Consistency |
| 7 | Bloom Filters Convert 8 Disk Reads into 1.04 on Average | Data Structures |
| 8 | Compare-and-Swap is the Only Safe Primitive for Read-Modify-Write on Distributed State | Atomicity |
| 9 | Network Partitions Force an Explicit AP vs CP Choice -- There Is No Middle Ground | Consensus |
| 10 | Thread-Per-Core Architecture Replaces Single-Threaded Event Loops for Multi-Core Utilization | Scaling |
| 11 | Disaggregated Storage Separates Durability from Serving, Enabling Instant Failover | Architecture |
| 12 | Key-Value Separation Reduces Write Amplification from 30x to 3-5x for Large Values | Data Structures |

---

### 1.4 Distributed LRU Cache [View](../1.4-distributed-lru-cache/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | XFetch Prevents Stampedes Without Locks or Coordination | Contention |
| 2 | Two-Tier L1/L2 Caching Absorbs Hot Keys Across the Application Fleet | Caching |
| 3 | Stale-While-Revalidate Trades Freshness for Zero User-Visible Latency | Caching |
| 4 | Count-Min Sketch Detects Hot Keys in O(1) Space Without Tracking Every Key | Data Structures |
| 5 | The Delete-Set Race Creates Permanent Staleness That TTL Cannot Fix | Consistency |
| 6 | Cross-Region Cache Invalidation via Message Queue Bounds Staleness to Seconds, Not Minutes | Consistency |
| 7 | A Cache Must Never Be the Availability Slowest part of the process -- It Is an Optimization, Not a Dependency | Resilience |
| 8 | Serialization Format Choice Can Dominate End-to-End Cache Latency | Cost Optimization |
| 9 | SET-if-Not-Exists (ADD) Prevents the Double Population Race Without Distributed Locks | Atomicity |
| 10 | Consistent Hashing with Virtual Nodes Bounds Rebalancing Impact to 1/N of the Keyspace | Partitioning |
| 11 | W-TinyLFU Admission Policy Prevents One-Hit Wonders from Polluting the Cache | Data Structures |
| 12 | Cache Warming Is a Correctness Requirement, Not an Optimization, for Systems That Cannot Tolerate Cold-Start Latency | Resilience |

---

### 1.5 Distributed Log-Based Broker [View](../1.5-distributed-log-based-broker/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | ISR is a Dynamic Durability Guarantee, Not a Fixed Replica Set | Replication |
| 2 | The Commit Log Abstraction Enables Time Travel That Traditional Queues Cannot | Streaming |
| 3 | Partition Count is the Parallelism Ceiling -- and It Cannot Be Decreased | Partitioning |
| 4 | Cooperative Rebalancing Eliminates the Stop-the-World Pause That Kills Stream Processing | Scaling |
| 5 | Idempotent Producers Turn At-Least-Once into Exactly-Once Without Application-Level Deduplication | Atomicity |
| 6 | Log Compaction Turns a Stream into a Materialized View | Streaming |
| 7 | Composite Keys Solve Partition Hot Spots Without Sacrificing Per-Entity Ordering | Partitioning |
| 8 | The Last Stable Offset (LSO) is the Hidden Cost of Exactly-Once Semantics | Consistency |
| 9 | KRaft Eliminates ZooKeeper as the Operational Achilles' Heel | Consensus |
| 10 | Batching and Compression Create a Throughput-Latency Trade-off at Every Layer | Streaming |
| 11 | Tiered Storage Decouples Retention Cost from Broker Capacity | Cost Optimization |
| 12 | Diskless Brokers Invert the Storage-Compute Coupling That Defined Log-Based Systems | Scaling |

---

### 1.6 Distributed Message Queue [View](../1.6-distributed-message-queue/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Single-Threaded Queue as the Hidden Ceiling | Contention |
| 2 | Reference Copies, Not Full Copies, on Fan-out | Data Structures |
| 3 | Topic Exchange Trie Turns Wildcard Routing from O(B) to O(W) | Data Structures |
| 4 | Quorum Queues Replace Mirrored Queues with Raft -- At a 20% Throughput Cost | Consistency |
| 5 | Memory Flow Control as Backpressure, Not Failure | Traffic Shaping |
| 6 | Poison Message Handling via x-delivery-limit | Resilience |
| 7 | Publisher Confirms and Consumer ACKs Are Orthogonal Guarantees | Atomicity |
| 8 | Prefetch Count Is the Latency-Throughput Dial | Scaling |
| 9 | Pause-Minority Prevents Split-Brain at the Cost of Minority-Side Availability | Consensus |
| 10 | Kubernetes-Native Broker Operations Transform Day-2 Complexity | Operations |
| 11 | Message Compression Trades CPU for Network Bandwidth and Storage | Cost Optimization |
| 12 | Super Streams Enable Kafka-Like Partitioned Consumption Within RabbitMQ | Architecture Evolution |

---

### 1.7 Distributed Unique ID Generator [View](../1.7-distributed-unique-id-generator/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | The Bit Layout Is the Entire Architecture | System Modeling |
| 2 | Clock Backward Jump Is an Existential Threat, Not an Edge Case (Unusual or extreme situation) | Consistency |
| 3 | Machine ID Assignment Is the Only Coordination This System Needs | Partitioning |
| 4 | Sequence Overflow Is a Poisson Distribution Problem | Traffic Shaping |
| 5 | Time-Ordered IDs Leak Information and Fragment on UUID v4 Migration | Security |
| 6 | The Lock-Free vs. Mutex Trade-off for Thread Safety | Contention |
| 7 | Custom Epoch Doubles Effective Lifetime | Cost Optimization |
| 8 | UUID v7 Unifies the Best Properties of UUID v4 and Snowflake Into a Single Standard | Data Structures |
| 9 | Time-Ordered IDs Create Write Hotspots in Globally-Distributed Databases | Partitioning |
| 10 | The Embedded Library Deployment Model Makes ID Generation the Only Distributed Systems Problem with Zero Network Overhead | Architecture |
| 11 | Database B-tree Index Locality Is the Hidden Dominator of ID Format Selection | Data Structures |

---

### 1.8 Distributed Lock Manager [View](../1.8-distributed-lock-manager/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | A Lock Without a Fencing Token Is an Illusion of Safety | Atomicity |
| 2 | Redlock Is Neither Fish Nor Fowl | Consensus |
| 3 | Watch the Predecessor, Not the Lock Holder | Data Structures |
| 4 | Lease Renewal at TTL/3 Is the Safety Margin | Resilience |
| 5 | Leader Slowest part of the process Is the Price of Linearizability | Scaling |
| 6 | Double Grant During Leader Election Is Solved by Term-Scoped Leases | Consensus |
| 7 | Minimize Lock Scope -- Lock the Write, Not the Computation | Contention |
| 8 | Ephemeral Nodes Provide Automatic Failure Detection | Resilience |
| 9 | Pre-Vote Prevents a Partitioned Node from Disrupting a Stable Cluster | Consensus |
| 10 | Deterministic Simulation Testing Finds Lock Bugs That Integration Tests Cannot | Testing |
| 11 | Learner Nodes Scale Lock Status Reads Without Increasing Write Quorum | Scaling |
| 12 | Lock Coarsening Trades Granularity for Throughput When Contention Is High | Contention |

---

### 1.9 Consistent Hashing Ring [View](../1.9-consistent-hashing-ring/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | K/N Is the Disruption Guarantee, and It Changes Everything | Partitioning |
| 2 | Virtual Nodes Transform a Theoretical Guarantee into a Practical One | Data Structures |
| 3 | Bounded Loads Turn Consistent Hashing into a Load Balancer | Traffic Shaping |
| 4 | Membership View Inconsistency Is the Silent Correctness Threat | Consistency |
| 5 | Staged Migration Prevents the Rebalancing Thundering Herd | Scaling |
| 6 | Clockwise Replica Placement Must Skip Same-Physical-Node Positions | Replication |
| 7 | The Hash Function Choice Is a 15x CPU Multiplier | Cost Optimization |
| 8 | Jump Hash Achieves O(1) Memory but Cannot Remove Nodes | Data Structures |
| 9 | Maglev's Lookup Table Trades Rebuild Cost for O(1) Runtime | Performance |
| 10 | Multi-Probe Consistent Hashing Eliminates Virtual Nodes Entirely | Data Structures |
| 11 | Weighted Virtual Nodes Enable Heterogeneous Cluster Capacity | Scaling |
| 12 | Consistent Hashing's Minimal Disruption Property Is Not Monotonic Across Multiple Changes | Consistency |

---

### 1.10 Service Discovery System [View](../1.10-service-discovery-system/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | AP Beats CP for Discovery, CP Beats AP for Configuration | Consistency |
| 2 | Self-Preservation Mode Prevents the Eviction Death Spiral | Resilience |
| 3 | Client-Side Caching Reduces Registry Load by 3000x | Caching |
| 4 | Health Checks Must Distinguish Liveness from Readiness | Resilience |
| 5 | DNS-Based Discovery Is Universal but Fundamentally Stale | Caching |
| 6 | Multi-DC Discovery Requires Local-First with Explicit Fallback | Partitioning |
| 7 | The Watch Storm Is the Service Discovery Thundering Herd | Scaling |
| 8 | The Sidecar Pattern Makes Discovery Language-Agnostic at the Cost of Per-Pod Overhead | Edge Computing |
| 9 | Registration Must Be Idempotent and Deregistration Must Be Graceful | Atomicity |
| 10 | Ambient Mesh Eliminates the Sidecar Tax While Preserving Discovery Transparency | Edge Computing |
| 11 | eBPF Moves Service Discovery into the Kernel, Eliminating Proxy Hops Entirely | Performance |
| 12 | Registry Poisoning Is Service Discovery's SQL Injection — The Attack Surface Most Teams Ignore | Security |

---

### 1.11 Configuration Management System [View](../1.11-configuration-management-system/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | The Indirect Commit Rule Prevents Silent Data Loss | Consensus |
| 2 | Watch Storms Turn a Feature Into a Denial-of-Service Vector | Contention |
| 3 | Leader Lease Closes the Stale-Read Window During Partitions | Consistency |
| 4 | Fencing Tokens Are the Only Safe Guard for Distributed Locks | Distributed Transactions |
| 5 | WAL fsync Latency Is the True Ceiling on Write Throughput | Scaling |
| 6 | Election Timeout Randomization Is a Probabilistic Solution to a Deterministic Problem | Consensus |
| 7 | Hierarchical vs. Flat Data Models Create Fundamentally Different Watch Semantics | Data Structures |
| 8 | Sharding the Keyspace Across Multiple Clusters Breaks Coordination Guarantees | Partitioning |
| 9 | GitOps Reconciliation Creates a Two-Source-of-Truth Problem | Operational Architecture |
| 10 | Configuration Validation Must Happen at Write Time, Not Just Deploy Time | Safety |
| 11 | Compaction Timing Creates a Hidden Dependency Between Watch Consumers and Storage Policy | Operational Coupling |
| 12 | Multi-Datacenter Config Federation Requires Choosing Between Latency, Consistency, and Operational Simplicity | Distributed Systems Trade-offs |

---

### 1.12 Blob Storage System [View](../1.12-blob-storage-system/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Erasure Coding Achieves Higher Durability with Lower Storage Overhead Than Replication | Data Structures |
| 2 | The Metadata Service Is the True Slowest part of the process, Not the Storage Layer | Scaling |
| 3 | CRDTs Enable Strong Consistency Without Coordination Overhead on Reads | Consistency |
| 4 | Reference Counting Prevents the Delete-During-Read Race Condition | Atomicity |
| 5 | Write Quorum for Erasure Coding Is Not Simply "Majority" | Replication |
| 6 | Repair Prioritization Must Be Exponential, Not Linear | Resilience |
| 7 | Log-Structured Storage Reduces Small Object Reads from O(n) Seeks to O(1) | Data Structures |
| 8 | Multipart Upload Assembly Requires Atomic Metadata Transition | Atomicity |
| 9 | Separating Shard Data from the LSM Tree Index Eliminates Write Amplification | Storage Engines |
| 10 | The "Power of Two Random Choices" Achieves Near-Optimal Load Distribution Without Global Coordination | Load Balancing |
| 11 | FastCDC Achieves 10x Throughput Over Rabin-based Chunking by Replacing Modular Arithmetic with Gear Fingerprinting | Algorithms |
| 12 | Five-Tier Intelligent Tiering Eliminates the Prediction Problem in Storage Lifecycle Management | Cost Optimization |

---

### 1.13 High-Performance Reverse Proxy [View](../1.13-high-performance-reverse-proxy/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Event-Driven Architecture Reduces Per-Connection Memory by 100x | Scaling |
| 2 | Edge-Triggered epoll Trades Programming Safety for Syscall Reduction | Data Structures |
| 3 | Connection Pooling Eliminates 70ms of Overhead Per Request | Caching |
| 4 | Reference-Counted Configuration Prevents Use-After-Free During Hot Reload | Atomicity |
| 5 | Slowloris Attacks Exploit the Gap Between Connection Acceptance and Request Completion | Security |
| 6 | Upstream Connection Storms Require Semaphore-Gated Connection Creation | Traffic Shaping |
| 7 | HTTP/2 Stream Exhaustion Is a Resource Attack That Bypasses Connection Limits | Resilience |
| 8 | TLS Session Resumption Converts a 2-RTT Handshake to 0-RTT | Caching |
| 9 | io_uring Replaces Syscall-Per-Operation with Shared-Memory Submission Queues | Scaling |
| 10 | Rust Memory Safety Eliminates Entire CVE Classes Without Runtime Performance Cost | Security |
| 11 | eBPF Kernel Datapath Bypasses Userspace Proxying for L4 Traffic | Performance |
| 12 | Sidecarless Ambient Mesh Replaces Per-Pod Proxies with Shared Node-Level Infrastructure | Architecture |

---

### 1.14 API Gateway Design [View](../1.14-api-gateway-design/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | The Trie-Based Router with LRU Cache Achieves O(1) Amortized Routing at 100K+ RPS | Data Structures |
| 2 | Hybrid Local + Global Rate Limiting Balances Accuracy Against Latency | Traffic Shaping |
| 3 | JWK Caching with Circuit Breaker Prevents IdP Outages from Cascading to All API Traffic | Resilience |
| 4 | Config Snapshot Per Request Eliminates the Config-Reload Race Condition | Atomicity |
| 5 | Circuit Breaker State Transitions Must Use Compare-and-Swap to Prevent Duplicate Opens | Contention |
| 6 | Plugin Chain Latency Budget Forces Architectural Tradeoffs Between Features and Performance | Scaling |
| 7 | WebSocket JWT Expiry Creates a Long-Lived Connection Authentication Gap | Security |
| 8 | Streaming Large Bodies Avoids the Memory-Explosion Trap of Request Buffering | Scaling |
| 9 | WebAssembly Plugin Isolation Solves the Extensibility-vs-Security Trilemma | Security |
| 10 | AI Gateway Pattern — LLM-Aware Rate Limiting Requires Token Budgeting, Not Request Counting | Traffic Shaping |
| 11 | eBPF Packet Filtering Moves Gateway Rejection to Kernel Space — 10x Throughput for Deny-Listed Traffic | Scaling |
| 12 | HTTP/3 QUIC Migration Creates a Dual-Stack Gateway That Must Maintain Two Connection Models Simultaneously | Resilience |

---

### 1.15 Content Delivery Network (CDN) [View](../1.15-content-delivery-network-cdn/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Surrogate Keys Transform Cache Invalidation from O(n) URL Scanning to O(1) Tag Lookup | Data Structures |
| 2 | Request Collapsing at Origin Shield Converts N Concurrent Cache Misses into 1 Origin Request | Contention |
| 3 | Anycast BGP Routing Provides Automatic Failover but Breaks TCP Session Persistence | Edge Computing |
| 4 | Soft Purge (Stale-While-Revalidate) Eliminates Purge-Induced Cache Misses | Caching |
| 5 | Live Streaming Manifests Require Different TTLs Than Segments | Caching |
| 6 | Regional Fanout with Persistent Connections Achieves Sub-200ms Global Purge | Edge Computing |
| 7 | BGP MED-Based Traffic Steering Enables Graceful PoP Degradation Under Load | Traffic Shaping |
| 8 | Origin Shield Circuit Breaker with Stale-If-Error Creates a Multi-Layer Resilience Stack | Resilience |
| 9 | WebAssembly at the Edge Transforms CDNs from Cache Layers into Distributed Application Platforms | Architecture Evolution |
| 10 | Semantic Caching Extends CDN Cache Principles to AI API Acceleration | Caching |
| 11 | QUIC/HTTP/3 Eliminates Head-of-Line Blocking but Introduces Connection Migration Challenges for Anycast CDNs | Edge Computing |
| 12 | AI-Driven Traffic Classification Shifts CDN Security from Rule-Based Filtering to Predictive Threat Mitigation | Resilience |

---

### 1.16 DNS System Design [View](../1.16-dns-system-design/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | Tiered Caching Eliminates Lock Contention at Scale | Caching |
| 2 | Negative Caching Is a Security Mechanism, Not Just an Optimization | Traffic Shaping |
| 3 | Anycast BGP Withdrawal Requires Graceful Traffic Draining | Resilience |
| 4 | Request Coalescing Prevents Thundering Herd on Cache Miss | Contention |
| 5 | Copy-on-Write Zone Updates Guarantee Query Consistency Without Read Locks | Consistency |
| 6 | EDNS Client Subnet Scope Controls Cache Sharing Granularity | Edge Computing |
| 7 | Kernel Bypass (DPDK/XDP) Provides 20x Throughput for UDP-Heavy Workloads | Scaling |
| 8 | Trie-Based Zone Lookup with Reversed Labels Enables Efficient Wildcard Matching | Data Structures |
| 9 | Zone Transfer Storms Require Staggered NOTIFY and Dedicated Transfer Infrastructure | Resilience |
| 10 | TTL Underflow Protection Prevents Zero-TTL Responses from Breaking Client Caching | Consistency |
| 11 | SVCB/HTTPS Records Collapse Connection Setup from 4 Round-Trips to 1 | Edge Computing |
| 12 | DNS-over-QUIC Eliminates Head-of-Line Blocking While Preserving UDP's Latency Profile | Scaling |

---

### 1.17 Distributed Transaction Coordinator [View](../1.17-distributed-transaction-coordinator/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | The 2PC Blocking Problem Is the Fundamental Motivation for Saga Patterns | Distributed Transactions |
| 2 | The Transactional Outbox Pattern Solves the Dual-Write Problem Without Distributed Transactions | Atomicity |
| 3 | Optimistic Locking with Version Columns Prevents Double Compensation | Contention |
| 4 | Non-Compensatable Steps Must Be Ordered Last in a Saga | System Modeling |
| 5 | Transaction Log Write Throughput Caps Coordinator TPS at ~5,000 | Scaling |
| 6 | The Slowest Participant Dominates 2PC Latency | Contention |
| 7 | Idempotency Key Races Require Atomic Insert-or-Wait Semantics | Consistency |
| 8 | Saga Choreography Creates an Implicit Distributed State Machine That Is Hard to Debug | System Modeling |
| 9 | Step Execution vs Timeout Is a Classic CAS Race That Causes Phantom Compensations | Consistency |
| 10 | Message Queue Failures in Choreography Are Solved by the Outbox, Not by Queue Redundancy | Resilience |
| 11 | Durable Execution Eliminates Accidental Complexity but Not Essential Complexity | Architecture |
| 12 | Semantic Locking Converts the Saga Isolation Problem from a Framework Concern to a Data Model Concern | Contention |

---

### 1.18 Event Sourcing System [View](../1.18-event-sourcing-system/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | The Global Position Sequencer Is the Hidden Throughput Ceiling | Contention |
| 2 | Out-of-Order Commits Are Invisible to the Writer but Catastrophic for Subscribers | Consistency |
| 3 | Snapshot Schema Evolution Is the Sleeper Complexity That Breaks Production Deploys | Consistency |
| 4 | Hot Aggregates Require Sharding the Aggregate Itself, Not Just the Event Store | Scaling |
| 5 | The Subscription Lag Spiral Is a Positive Feedback Loop That Leads to OOM Kills | Resilience |
| 6 | Upcasting Chains Transform Schema Evolution from a Migration Problem into a Code Maintenance Problem | System Modeling |
| 7 | Transactional Checkpointing Eliminates the At-Least-Once Processing Problem for Projections | Atomicity |
| 8 | Blue-Green Projections Enable Zero-Downtime Rebuilds of Read Models | Resilience |
| 9 | Optimistic Concurrency on Stream Version Is the Natural Conflict Resolution for Event Sourcing | Consistency |
| 10 | Read-Your-Writes Consistency Bridges the Gap Between Eventual Consistency and User Expectations | Consistency |
| 11 | Crypto-Shredding Is the Only GDPR-Compatible Approach That Preserves Event Immutability | Security |
| 12 | Event Sourcing with Serverless Functions Inverts the Cost Model from Provisioned Capacity to Per-Event Pricing | Cost Optimization |

---

### 1.19 CQRS Implementation [View](../1.19-cqrs-implementation/09-insights.md)

| # | Insight | Category |
|---|---------|----------|
| 1 | The Dual-Write Problem Is the Single Biggest Source of Data Loss in CQRS Systems | Atomicity |
| 2 | Partition by Aggregate ID Is the Only Reliable Way to Guarantee Event Ordering for Projections | Consistency |
| 3 | Version-Aware Projections with Event Buffering Handle Out-of-Order Delivery Gracefully | Resilience |
| 4 | LISTEN/NOTIFY on the Outbox Table Reduces Projection Lag from 50ms Average to Near-Zero | Caching |
| 5 | Synchronous Projection for Critical Paths, Async for Everything Else | Consistency |
| 6 | Read-After-Write Staleness Is Best Solved at the Client, Not the Server | Consistency |
| 7 | SELECT FOR UPDATE SKIP LOCKED Enables Parallel Outbox Relays Without Double Publishing | Contention |
| 8 | Blue-Green Projection Deployment Eliminates the Rebuild Maintenance Window | Resilience |
| 9 | Denormalizing Data into Events Prevents N+1 Query Problems in Projections | Scaling |
| 10 | The Outbox Pattern Combined with CDC Provides the Best of Both Worlds for Event Distribution | Streaming |
| 11 | Multi-Tenant CQRS Requires Tenant-Aware Projection Isolation Without Per-Tenant Infrastructure | Partitioning |
| 12 | CQRS Testing Requires Separate Strategies for Command Validation, Projection Correctness, and Eventual Consistency Verification | Resilience |

