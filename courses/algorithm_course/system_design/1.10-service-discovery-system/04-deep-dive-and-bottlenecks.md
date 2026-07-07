# Deep Dive & Bottlenecks

[← Back to Index](./00-index.md)

---

## Critical Component 1: Health Checking

### Why Health Checking Is Critical

Health checking determines which instances receive traffic. Poor health checking leads to:
- **False Positives**: Healthy instances marked DOWN → reduced capacity
- **False Negatives**: Unhealthy instances marked UP → request failures
- **Flapping**: Rapid UP/DOWN transitions → routing instability

```mermaid
flowchart TB
    subgraph Problem["Health Check Challenges"]
        P1["Network Blip<br/>≠ Instance Down"]
        P2["Slow Response<br/>≠ Instance Down"]
        P3["Health Endpoint Up<br/>≠ Service Functional"]
        P4["Overloaded Instance<br/>May Fail Checks"]
    end

    subgraph Impact["Impact"]
        I1["Traffic to Dead Instances<br/>→ User Errors"]
        I2["Good Instances Removed<br/>→ Capacity Loss"]
        I3["Cascading Failures<br/>→ System Overload"]
    end

    P1 & P2 & P3 & P4 --> I1 & I2 & I3
```

### Health Check Models Comparison

| Model | How It Works | Pros | Cons |
|-------|-------------|------|------|
| **Push (Heartbeat)** | Instance sends periodic heartbeats to registry | Service controls timing, less registry load | Requires service modification, firewall issues |
| **Pull (Polling)** | Registry periodically probes instance | No service changes, works with legacy | Registry load scales with instances |
| **Hybrid** | Heartbeat for liveness, pull for readiness | Comprehensive | Complexity |

### Push vs. Pull Deep Dive

```
┌─────────────────────────────────────────────────────────────────────┐
│  PUSH MODEL (HEARTBEAT)                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Instance ──heartbeat──► Registry                                   │
│  Instance ──heartbeat──► Registry                                   │
│  Instance ──────X────── Registry (missed)                           │
│  Instance ──────X────── Registry (missed → mark DOWN)               │
│                                                                      │
│  Pros:                                                               │
│  + Service controls check timing                                    │
│  + Lower registry CPU/network load                                   │
│  + Scales better (N instances send, not N probes)                   │
│  + Works through NAT (outbound connections)                          │
│                                                                      │
│  Cons:                                                               │
│  - Requires service to implement heartbeat logic                    │
│  - Can't detect "zombie" processes (running but not healthy)        │
│  - Clock skew can cause premature expiration                         │
│  - Network partition: registry thinks instance is down               │
│                                                                      │
│  Best For: High instance count, service supports heartbeat           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  PULL MODEL (REGISTRY PROBES)                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Registry ──GET /health──► Instance                                  │
│  Registry ◄──200 OK──────── Instance                                │
│  Registry ──GET /health──► Instance                                  │
│  Registry ◄──500 Error───── Instance (mark failing)                 │
│                                                                      │
│  Pros:                                                               │
│  + No service modification needed                                    │
│  + Can verify actual endpoint functionality                          │
│  + Detects zombie processes                                          │
│  + Registry has full control over check logic                        │
│                                                                      │
│  Cons:                                                               │
│  - Registry load increases with instance count                      │
│  - Firewall rules needed (registry → instances)                     │
│  - Check timing controlled by registry, not service                 │
│  - Distributed health checkers need coordination                     │
│                                                                      │
│  Best For: Legacy services, black-box monitoring, few instances      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  HYBRID MODEL (CONSUL APPROACH)                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Heartbeat for Liveness:                                         │
│     Instance ──heartbeat──► Registry (every 10s)                    │
│     "I'm alive and want to stay registered"                         │
│                                                                      │
│  2. Pull for Readiness:                                             │
│     Registry ──GET /health──► Instance (every 30s)                  │
│     "Are you actually ready to serve traffic?"                       │
│                                                                      │
│  3. Local Agent (Consul):                                           │
│     Local Agent ──check──► Instance (same host)                     │
│     Avoids cross-network health check traffic                        │
│                                                                      │
│  States:                                                             │
│  - Heartbeat ✓ + Health ✓ → UP                                      │
│  - Heartbeat ✓ + Health ✗ → UNHEALTHY (still registered)           │
│  - Heartbeat ✗ → EVICTED (regardless of health)                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Health Check Timing Trade-offs

| Parameter | Short (e.g., 5s) | Long (e.g., 60s) | Recommendation |
|-----------|------------------|------------------|----------------|
| **Check Interval** | Faster detection, higher load | Slower detection, lower load | 10-30s for most cases |
| **Timeout** | More false positives on slow response | Delayed detection of failures | 5-10s (< interval) |
| **Healthy Threshold** | Faster recovery, risk of flapping | Slower recovery, stable | 2-3 consecutive |
| **Unhealthy Threshold** | Faster detection, risk of false positives | Tolerates transient failures | 2-3 consecutive |

### Preventing False Positives and Negatives

```
┌─────────────────────────────────────────────────────────────────────┐
│  FALSE POSITIVE MITIGATION                                           │
│  (Healthy instance incorrectly marked DOWN)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Problem: Single network blip causes instance removal                │
│                                                                      │
│  Solutions:                                                          │
│  1. Consecutive failure threshold (3+ failures before DOWN)          │
│  2. Longer timeout (tolerate slow responses)                        │
│  3. Multiple health check types (HTTP + TCP)                        │
│  4. Jitter in check timing (avoid synchronized checks)              │
│  5. Local agent checks (avoid cross-network failures)               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  FALSE NEGATIVE MITIGATION                                           │
│  (Unhealthy instance incorrectly marked UP)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Problem: Health endpoint returns 200, but service is broken         │
│                                                                      │
│  Solutions:                                                          │
│  1. Deep health checks (verify dependencies: DB, cache)              │
│  2. Functional health checks (actual request processing)             │
│  3. Synthetic transactions (test real user flows)                    │
│  4. Readiness vs. liveness separation                               │
│  5. Request error rate monitoring (circuit breaker feedback)         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Critical Component 2: Consistency Models (CP vs. AP)

### The CAP Trade-off in Service Discovery

```mermaid
flowchart TB
    subgraph CAP["CAP Theorem Applied"]
        C["Consistency<br/>All nodes see same data"]
        A["Availability<br/>System responds to requests"]
        P["Partition Tolerance<br/>Works despite network splits"]
    end

    subgraph Reality["Reality: Choose 2"]
        CP["CP Systems<br/>Consistent but may be unavailable<br/>etcd, ZooKeeper"]
        AP["AP Systems<br/>Available but eventually consistent<br/>Eureka, Gossip"]
    end

    CAP --> Reality
```

### CP Systems (Strong Consistency)

```
┌─────────────────────────────────────────────────────────────────────┐
│  CP SYSTEMS: etcd, ZooKeeper, Consul (Raft mode)                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  How It Works:                                                       │
│  - Leader handles all writes                                        │
│  - Writes replicated to majority before acknowledged                 │
│  - Reads can go to leader (linearizable) or followers               │
│                                                                      │
│  Registration Flow:                                                  │
│  Service ──register──► Leader                                       │
│  Leader ──replicate──► Follower1, Follower2                        │
│  Follower1, Follower2 ──ack──► Leader                              │
│  Leader ──success──► Service (only after majority ack)              │
│                                                                      │
│  During Partition:                                                   │
│  ┌─────────────────┐       ┌─────────────────┐                      │
│  │ Minority Side   │       │ Majority Side   │                      │
│  │                 │   X   │                 │                      │
│  │ Leader (old)    │◄─────►│ Followers       │                      │
│  │ Cannot write!   │       │ Elect new leader│                      │
│  │ Rejects reqs    │       │ Accepts writes  │                      │
│  └─────────────────┘       └─────────────────┘                      │
│                                                                      │
│  Pros:                                                               │
│  + Strong consistency - no stale reads                              │
│  + Well-suited for configuration, leader election                   │
│                                                                      │
│  Cons:                                                               │
│  - Unavailable during partition (minority side)                     │
│  - Higher latency (wait for majority)                               │
│  - Leader Slowest part of the process for writes                                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### AP Systems (High Availability)

```
┌─────────────────────────────────────────────────────────────────────┐
│  AP SYSTEMS: Eureka, Consul (Gossip), Nacos (AP mode)               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  How It Works:                                                       │
│  - No leader, all nodes accept writes                               │
│  - Changes propagate via gossip protocol                            │
│  - Eventually consistent (seconds to converge)                      │
│                                                                      │
│  Registration Flow:                                                  │
│  Service ──register──► Node1                                        │
│  Node1 ──success──► Service (immediate)                             │
│  Node1 ──gossip──► Node2, Node3 (background)                       │
│                                                                      │
│  During Partition:                                                   │
│  ┌─────────────────┐       ┌─────────────────┐                      │
│  │ Side A          │       │ Side B          │                      │
│  │                 │   X   │                 │                      │
│  │ Node1, Node2    │◄─────►│ Node3, Node4    │                      │
│  │ Accepts writes! │       │ Accepts writes! │                      │
│  │ Serves stale    │       │ Serves stale    │                      │
│  └─────────────────┘       └─────────────────┘                      │
│                                                                      │
│  Pros:                                                               │
│  + Always available - partition tolerant                            │
│  + Lower latency (no consensus needed)                              │
│  + Scales horizontally                                               │
│                                                                      │
│  Cons:                                                               │
│  - Stale reads possible during/after partition                      │
│  - Conflicts need resolution (last-write-wins, merge)               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### When to Use Each

| Scenario | CP or AP | Reasoning |
|----------|----------|-----------|
| **Service Discovery** | AP preferred | Stale data better than no data; failover critical |
| **Configuration** | CP preferred | Consistency important for config; can retry |
| **Leader Election** | CP required | Must have single leader, consistency critical |
| **Feature Flags** | Either | Depends on flag criticality |
| **Service Mesh Control Plane** | CP | Consistent routing rules required |

---

## Critical Component 3: Self-Preservation Mode (Eureka)

### The Problem

During network partition, registry may think all instances are down (no heartbeats). Evicting all instances would cause complete service outage.

```mermaid
flowchart TB
    subgraph Normal["Normal Operation"]
        N1["100 instances registered"]
        N2["95 instances healthy"]
        N3["5 instances evicted"]
    end

    subgraph Partition["During Network Partition"]
        P1["Registry loses connectivity"]
        P2["No heartbeats received"]
        P3["Without protection:<br/>All 100 instances evicted!"]
        P4["With protection:<br/>Registry enters self-preservation"]
    end

    Normal --> Partition
```

### Self-Preservation Algorithm

```
ALGORITHM SelfPreservationCheck():
    // Eureka's self-preservation mechanism

    CONSTANTS:
        RENEWAL_THRESHOLD = 0.85  // 85% of expected renewals
        MIN_INSTANCES = 10        // Minimum for self-preservation

    PROCESS:
        // Calculate expected renewals per minute
        total_instances = registry.GetInstanceCount()
        IF total_instances < MIN_INSTANCES:
            RETURN  // Not enough instances for self-preservation

        expected_renewals_per_min = total_instances * (60 / HEARTBEAT_INTERVAL)

        // Count actual renewals in last minute
        actual_renewals = CountRenewalsInLastMinute()

        renewal_ratio = actual_renewals / expected_renewals_per_min

        IF renewal_ratio < RENEWAL_THRESHOLD:
            // Enter self-preservation mode
            EnterSelfPreservation()
            Log.Warn("Self-preservation mode activated", {
                expected: expected_renewals_per_min,
                actual: actual_renewals,
                ratio: renewal_ratio
            })
        ELSE IF self_preservation_active AND renewal_ratio >= RENEWAL_THRESHOLD:
            // Exit self-preservation mode
            ExitSelfPreservation()
            Log.Info("Self-preservation mode deactivated")

    ALGORITHM EnterSelfPreservation():
        self_preservation_active = TRUE
        // Stop evicting instances due to missed heartbeats
        // Continue accepting new registrations
        // Continue serving discovery requests with potentially stale data

    ALGORITHM EvictExpiredInstances():
        IF self_preservation_active:
            // Don't evict, keep stale data
            Log.Debug("Skipping eviction due to self-preservation")
            RETURN

        // Normal eviction logic
        FOR EACH instance WHERE lease.expired:
            EvictInstance(instance)
```

### Self-Preservation Trade-offs

| Without Self-Preservation | With Self-Preservation |
|--------------------------|----------------------|
| Network blip → mass eviction | Network blip → no eviction |
| Clean registry (no stale data) | Potentially stale data |
| Possible complete outage | Graceful degradation |
| Simple logic | Additional complexity |

---

## Critical Component 4: Multi-Datacenter Challenges

### WAN Federation Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  MULTI-DC FEDERATION CHALLENGES                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  DC1 (US-East)              DC2 (US-West)              DC3 (EU)     │
│  ┌─────────────┐            ┌─────────────┐            ┌─────────┐  │
│  │ Registry    │◄──100ms──►│ Registry    │◄──150ms──►│ Registry│  │
│  │ Cluster     │   WAN     │ Cluster     │   WAN     │ Cluster │  │
│  └─────────────┘            └─────────────┘            └─────────┘  │
│                                                                      │
│  Challenges:                                                         │
│                                                                      │
│  1. Latency: 100-300ms RTT across continents                        │
│     - Can't use synchronous replication                              │
│     - Strong consistency too expensive                               │
│                                                                      │
│  2. Bandwidth: Limited/expensive WAN links                          │
│     - Can't replicate all health check data                         │
│     - Need efficient delta sync                                      │
│                                                                      │
│  3. Partition: WAN links fail more often than LAN                   │
│     - Each DC must operate independently                            │
│     - Need local-first query strategy                               │
│                                                                      │
│  4. Consistency: Changes take time to propagate                     │
│     - Instance registered in DC1, not yet visible in DC2            │
│     - Need to handle cross-DC staleness                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Multi-DC Strategies

```
┌─────────────────────────────────────────────────────────────────────┐
│  STRATEGY 1: LOCAL-FIRST WITH FALLBACK                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Query Flow:                                                         │
│  1. Client queries local DC registry                                │
│  2. Local registry returns local instances (preferred)              │
│  3. If local instances insufficient, include remote DC instances    │
│                                                                      │
│  ALGORITHM DiscoverWithLocality(service, client_zone):              │
│      local_instances = GetLocalInstances(service, client_zone)      │
│      IF local_instances.count >= MIN_HEALTHY_INSTANCES:             │
│          RETURN local_instances                                      │
│      ELSE:                                                           │
│          remote_instances = GetRemoteInstances(service)             │
│          RETURN local_instances + remote_instances                  │
│                                                                      │
│  Pros: Low latency for local, failover for disasters                │
│  Cons: Remote data may be stale                                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  STRATEGY 2: GOSSIP-BASED WAN REPLICATION (Consul)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Architecture:                                                       │
│  - LAN gossip within each DC (fast, frequent)                       │
│  - WAN gossip between DCs (slower, less frequent)                   │
│  - Each DC has "WAN gateway" nodes                                   │
│                                                                      │
│  DC1                                DC2                              │
│  ┌─────────────────┐               ┌─────────────────┐              │
│  │ Node1 ◄──► Node2│               │ Node4 ◄──► Node5│              │
│  │   ▲        ▲    │               │   ▲        ▲    │              │
│  │   │  LAN   │    │               │   │  LAN   │    │              │
│  │   ▼        ▼    │               │   ▼        ▼    │              │
│  │ Node3 (Gateway) │◄───WAN────────│ Node6 (Gateway) │              │
│  └─────────────────┘               └─────────────────┘              │
│                                                                      │
│  WAN Gossip:                                                         │
│  - Service catalog: Replicated (eventually consistent)              │
│  - Health status: NOT replicated (too expensive)                    │
│  - On cross-DC query: Probe health on-demand                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  STRATEGY 3: INDEPENDENT REGISTRIES WITH SERVICE MESH                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Architecture:                                                       │
│  - Each DC has independent registry                                 │
│  - Service mesh handles cross-DC routing                            │
│  - Mesh control plane syncs endpoints                               │
│                                                                      │
│  DC1                          DC2                                    │
│  ┌─────────────┐              ┌─────────────┐                       │
│  │ Registry 1  │              │ Registry 2  │                       │
│  └──────┬──────┘              └──────┬──────┘                       │
│         │                            │                               │
│         ▼                            ▼                               │
│  ┌─────────────┐              ┌─────────────┐                       │
│  │ Mesh Ctrl   │◄─────────────│ Mesh Ctrl   │                       │
│  │ Plane       │   Sync       │ Plane       │                       │
│  └──────┬──────┘              └──────┬──────┘                       │
│         │                            │                               │
│         ▼                            ▼                               │
│  ┌─────────────┐              ┌─────────────┐                       │
│  │ Service     │              │ Service     │                       │
│  │ + Sidecar   │◄─────────────│ + Sidecar   │                       │
│  └─────────────┘   Direct     └─────────────┘                       │
│                    mTLS                                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Critical Component 5: Client-Side Caching

### Why Client Caching Is Critical

```
Without Caching:
  - 1000 services, each calling payment-service 100x/second
  - = 100,000 discovery requests/second to registry
  - Registry becomes Slowest part of the process

With Caching (30s TTL):
  - Each service fetches once per 30 seconds
  - = 33 discovery requests/second to registry (1000/30)
  - 3000x reduction in registry load
```

### Caching Strategies

```
┌─────────────────────────────────────────────────────────────────────┐
│  STRATEGY 1: TTL-BASED CACHE                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  cache = Map<ServiceName, CacheEntry>                               │
│                                                                      │
│  ALGORITHM GetInstances(service):                                   │
│      entry = cache.Get(service)                                     │
│      IF entry AND entry.expires_at > NOW():                         │
│          RETURN entry.instances                                      │
│      ELSE:                                                           │
│          instances = registry.Discover(service)                     │
│          cache.Put(service, {instances, expires_at: NOW() + TTL})   │
│          RETURN instances                                            │
│                                                                      │
│  TTL Selection:                                                      │
│  - 10-30 seconds: Good balance for most services                    │
│  - 60+ seconds: Very stable services, config                         │
│  - 1-5 seconds: Rapidly changing services (use watch instead)       │
│                                                                      │
│  Cons: Can serve stale data up to TTL duration                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  STRATEGY 2: WATCH-BASED INVALIDATION                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Client maintains:                                                   │
│  - Local cache of service instances                                 │
│  - Watch connection to registry                                     │
│                                                                      │
│  ALGORITHM:                                                          │
│  1. Initial fetch populates cache                                   │
│  2. Watch stream receives change events                             │
│  3. On event: update cache immediately                              │
│                                                                      │
│  ┌────────┐        ┌──────────┐                                     │
│  │ Client │◄───────│ Registry │                                     │
│  │        │ Watch  │          │                                     │
│  │ Cache  │ Stream │          │                                     │
│  └────────┘        └──────────┘                                     │
│                                                                      │
│  On Event: payment-1 added                                          │
│  Client: cache.Add("payment", "payment-1")                          │
│                                                                      │
│  Pros: Near real-time updates, no TTL staleness                     │
│  Cons: Watch connection overhead, reconnection handling             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  STRATEGY 3: TTL + WATCH (HYBRID)                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Best of both worlds:                                                │
│  - TTL cache as fallback                                            │
│  - Watch for real-time updates                                      │
│  - If watch disconnects, fall back to TTL                           │
│                                                                      │
│  ALGORITHM GetInstances(service):                                   │
│      IF watchConnected AND cache.Has(service):                      │
│          RETURN cache.Get(service)  // Always fresh via watch      │
│      ELIF cache.Has(service) AND NOT cache.Expired(service):        │
│          RETURN cache.Get(service)  // TTL fallback                 │
│      ELSE:                                                           │
│          instances = registry.Discover(service)                     │
│          cache.Put(service, instances, TTL)                         │
│          RETURN instances                                            │
│                                                                      │
│  RECOMMENDATION: Use this hybrid approach in production             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Critical Component 6: eBPF and Kernel-Level Discovery

### Why eBPF Changes the Discovery Architecture

Traditional service discovery operates in userspace — a library or sidecar proxy resolves service names to endpoints. eBPF moves this resolution into the Linux kernel, fundamentally changing the performance and operational model.

```
┌─────────────────────────────────────────────────────────────────────┐
│  TRADITIONAL vs eBPF DISCOVERY PATH                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TRADITIONAL (Sidecar Proxy):                                        │
│  App → connect(service-vip:80)                                       │
│    → iptables DNAT → sidecar proxy (userspace)                      │
│    → proxy resolves endpoint from control plane cache                │
│    → proxy opens new connection to backend pod                       │
│    → response returns through proxy                                  │
│  Latency added: 0.5-2ms per hop × 2 hops = 1-4ms overhead          │
│  Memory: ~100MB per sidecar × 1000 pods = ~100GB aggregate          │
│                                                                      │
│  eBPF (Kernel-Level):                                                │
│  App → connect(service-vip:80)                                       │
│    → eBPF program intercepts connect() syscall                       │
│    → BPF map lookup: service-vip → [pod-ip-1, pod-ip-2]             │
│    → Rewrite destination address in-kernel                           │
│    → Direct TCP connection to backend pod                            │
│  Latency added: < 1 microsecond                                     │
│  Memory: ~1KB per service entry in BPF maps                         │
│                                                                      │
│  Performance comparison (p99 latency overhead):                      │
│  ┌────────────────────────────────────────────────────┐              │
│  │ Sidecar (Envoy):  ████████████████████ 2.1ms       │              │
│  │ Ambient (ztunnel): █████████ 0.9ms                 │              │
│  │ eBPF (Cilium):     ░ 0.003ms                       │              │
│  │ No mesh (direct):  (baseline)                      │              │
│  └────────────────────────────────────────────────────┘              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### eBPF Endpoint Map Management

```
ALGORITHM eBPFEndpointSync:
    // Control plane keeps eBPF maps in sync with service endpoints

    STRUCTURE BPFServiceEntry:
        service_ip: IPv4/IPv6      // ClusterIP or virtual IP
        service_port: uint16
        backends: List<BackendEntry>
        lb_algorithm: enum         // RoundRobin, Random, Maglev

    STRUCTURE BackendEntry:
        pod_ip: IPv4/IPv6
        pod_port: uint16
        weight: uint16
        node_id: uint16            // For locality-aware routing

    ALGORITHM OnEndpointUpdate(service, endpoints):
        // Called by control plane when endpoints change

        key = BPFMapKey{
            ip: service.cluster_ip,
            port: service.port
        }

        value = BPFMapValue{
            backends: endpoints.Filter(e => e.health == READY),
            count: endpoints.healthy_count,
            algorithm: service.lb_policy
        }

        // Atomic map update — no traffic disruption
        bpf_map_update(SERVICE_MAP, key, value, BPF_ANY)

        // Update per-backend entries for weighted selection
        FOR EACH backend IN value.backends:
            bpf_map_update(BACKEND_MAP, backend.id, backend, BPF_ANY)

    ALGORITHM OnConnect(socket, dest_ip, dest_port):
        // eBPF program attached to connect() syscall

        key = BPFMapKey{ip: dest_ip, port: dest_port}
        entry = bpf_map_lookup(SERVICE_MAP, key)

        IF entry IS NULL:
            RETURN PASSTHROUGH  // Not a service VIP, let it through

        // Select backend based on algorithm
        backend = SelectBackend(entry, socket.source_cookie)

        // Rewrite destination in-kernel
        socket.dest_ip = backend.pod_ip
        socket.dest_port = backend.pod_port

        RETURN OK
```

### Trade-offs: eBPF vs Sidecar vs Ambient

| Dimension | Sidecar Proxy | Ambient Mesh | eBPF Kernel |
|-----------|--------------|--------------|-------------|
| **Latency overhead** | 1-4ms (2 hops) | 0.5-1ms (1 hop) | < 0.01ms |
| **Memory per pod** | 50-100MB | 0 (shared node) | 0 |
| **Memory per node** | N × sidecar | ~50MB (ztunnel) | ~1MB (BPF maps) |
| **L7 visibility** | Full | Via waypoint | Limited |
| **mTLS** | Per-pod termination | Per-node (ztunnel) | Requires WireGuard/IPsec |
| **Failure blast radius** | Single pod | Single node | Single node |
| **Kernel requirement** | Any OS | Any OS | Linux 5.10+ |
| **Debugging** | Proxy access logs | ztunnel logs | bpftool, BPF tracing |

---

## Case Study: Large-Scale Service Discovery Migration

### Scenario: 50,000-Instance Fleet Moving from Sidecar to Hybrid Discovery

A large e-commerce platform running 50,000 service instances across 3 regions encountered scaling limits with their sidecar-based service mesh:

```
┌─────────────────────────────────────────────────────────────────────┐
│  MIGRATION CASE STUDY                                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Before (Sidecar Mesh):                                              │
│  - 50,000 pods × 80MB sidecar = 4TB aggregate memory for proxies   │
│  - P99 inter-service latency: 12ms (including 3ms proxy overhead)  │
│  - 150 sidecar OOM kills/week during traffic spikes                 │
│  - Control plane pushing configs to 50K sidecars: 45 second lag    │
│                                                                      │
│  After (Hybrid: eBPF L4 + Waypoint L7):                             │
│  - eBPF for all L4 discovery and load balancing (95% of traffic)   │
│  - Waypoint proxies for 12 services needing L7 routing/auth        │
│  - Aggregate proxy memory: 4TB → 180GB (96% reduction)              │
│  - P99 inter-service latency: 9.2ms (eliminated proxy hops)        │
│  - Zero OOM kills (no per-pod proxy to exhaust memory)              │
│  - Endpoint propagation: 45s → 800ms (BPF map updates)             │
│                                                                      │
│  Migration Strategy (18 months):                                     │
│  Phase 1: Deploy eBPF datapath alongside existing sidecars          │
│  Phase 2: Migrate L4 traffic to eBPF, keep sidecars for L7         │
│  Phase 3: Replace remaining sidecars with waypoint proxies          │
│  Phase 4: Decommission sidecar injector                             │
│                                                                      │
│  Key lesson: Not all services need L7 — 95% of inter-service       │
│  traffic is simple RPC that needs only endpoint resolution and      │
│  mTLS, which eBPF handles at near-zero cost.                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Slowest part of the process Analysis

### Slowest part of the process 1: Registry as Single Point of Failure

| Symptom | Cause | Mitigation |
|---------|-------|------------|
| All discovery fails | Single registry node | Deploy cluster (3-5 nodes) |
| Slow discovery | Overloaded registry | Scale horizontally, client caching |
| Inconsistent results | Split-brain | Quorum-based consensus |

### Slowest part of the process 2: Health Check Overhead

| Symptom | Cause | Mitigation |
|---------|-------|------------|
| Registry CPU high | Polling too many instances | Use push model, local agents |
| Network congestion | Frequent health checks | Increase interval, use local checks |
| False positives | Network blips | Increase unhealthy threshold |

### Slowest part of the process 3: Watch Fan-out

| Symptom | Cause | Mitigation |
|---------|-------|------------|
| High memory usage | Too many watch connections | Limit watchers per service |
| Slow notifications | Broadcasting to many clients | Use intermediary aggregators |
| Connection churn | Clients reconnecting | Exponential backoff, stable connections |

---

## Performance Optimization Summary

| Slowest part of the process | Impact | Mitigation | Trade-off |
|------------|--------|------------|-----------|
| Single registry | Complete failure | Cluster, consensus | Complexity |
| Health check load | Registry overload | Push model, local agents | Service changes required |
| Stale cache | Wrong routing | Watch + TTL | Connection overhead |
| Watch fan-out | Memory, latency | Aggregation | Added hop |
| WAN latency | Slow cross-DC | Local-first, async replication | Staleness |
