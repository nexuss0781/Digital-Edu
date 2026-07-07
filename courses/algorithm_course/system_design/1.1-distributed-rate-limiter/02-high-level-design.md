# High-Level Design

[← Back to Index](./00-index.md)

---

## System Architecture

### Component Overview

```mermaid
flowchart TB
    subgraph Clients
        C1[Web Client]
        C2[Mobile App]
        C3[API Consumer]
    end

    subgraph Edge["Edge Layer"]
        LB[Load Balancer]
        CDN[CDN / Edge Cache]
    end

    subgraph Gateway["API Gateway Layer"]
        AG1[API Gateway 1]
        AG2[API Gateway 2]
        AG3[API Gateway N]
    end

    subgraph RateLimiter["Rate Limiter Service"]
        RL1[Rate Limiter 1]
        RL2[Rate Limiter 2]
        RL3[Rate Limiter N]
        LC1[Local Cache]
        LC2[Local Cache]
        LC3[Local Cache]
    end

    subgraph Storage["Distributed Storage"]
        subgraph RedisCluster["Redis Cluster"]
            R1[(Redis Primary 1)]
            R2[(Redis Primary 2)]
            R3[(Redis Primary 3)]
            RS1[(Replica)]
            RS2[(Replica)]
            RS3[(Replica)]
        end
    end

    subgraph Config["Configuration"]
        CS[(Config Store)]
        CM[Config Manager]
    end

    subgraph Backend["Backend Services"]
        BS1[Service A]
        BS2[Service B]
        BS3[Service C]
    end

    C1 & C2 & C3 --> LB
    LB --> CDN
    CDN --> AG1 & AG2 & AG3

    AG1 --> RL1
    AG2 --> RL2
    AG3 --> RL3

    RL1 --- LC1
    RL2 --- LC2
    RL3 --- LC3

    RL1 & RL2 & RL3 <--> R1 & R2 & R3
    R1 --> RS1
    R2 --> RS2
    R3 --> RS3

    CM --> CS
    CS --> RL1 & RL2 & RL3

    RL1 --> BS1
    RL2 --> BS2
    RL3 --> BS3
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Load Balancer** | Distribute traffic, initial connection limiting |
| **API Gateway** | Authentication, routing, invokes rate limiter |
| **Rate Limiter Service** | Core limiting logic, algorithm execution |
| **Local Cache** | Hot key caching, reduce Redis round-trips |
| **Redis Cluster** | Distributed counter storage, atomic operations |
| **Config Store** | Rate limit rules, user tier mappings |

---

## Data Flow

### Request Allowed Flow

```mermaid
sequenceDiagram
    participant Client
    participant Gateway as API Gateway
    participant RL as Rate Limiter
    participant Cache as Local Cache
    participant Redis as Redis Cluster
    participant Backend as Backend Service

    Client->>Gateway: API Request + Auth Token
    Gateway->>Gateway: Extract User ID / API Key
    Gateway->>RL: Check Rate Limit(user_id, endpoint)

    RL->>Cache: Get cached count
    alt Cache Hit (recent)
        Cache-->>RL: Return count (if within limit)
        RL-->>Gateway: ALLOWED
    else Cache Miss or Stale
        RL->>Redis: INCR rate_limit:user_id:endpoint
        Redis-->>RL: Current count + TTL
        RL->>Cache: Update cache
        RL-->>Gateway: ALLOWED (count < limit)
    end

    Gateway->>Backend: Forward Request
    Backend-->>Gateway: Response
    Gateway-->>Client: Response + Rate Limit Headers

    Note over Client: Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

### Request Throttled Flow

```mermaid
sequenceDiagram
    participant Client
    participant Gateway as API Gateway
    participant RL as Rate Limiter
    participant Redis as Redis Cluster

    Client->>Gateway: API Request
    Gateway->>RL: Check Rate Limit(user_id, endpoint)

    RL->>Redis: GET rate_limit:user_id:endpoint
    Redis-->>RL: count = 1000 (limit = 1000)

    RL-->>Gateway: DENIED (count >= limit)

    Gateway-->>Client: HTTP 429 Too Many Requests

    Note over Client: Response includes:<br/>Retry-After: 45<br/>X-RateLimit-Reset: 1642000000
```

---

## Key Architectural Decisions

### 1. Monolith vs Microservice

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Embedded in Gateway** | Lower latency, no network hop | Tight coupling, harder to scale independently | Good for simple cases |
| **Separate Microservice** | Independent scaling, reusable | Network latency added | **Recommended** for large scale |

**Recommendation:** Separate microservice with optional local caching in gateway for hot paths.

### 2. Synchronous vs Asynchronous

| Approach | Use Case | Trade-off |
|----------|----------|-----------|
| **Synchronous** | Real-time limit enforcement | Adds latency to request path |
| **Asynchronous** | Analytics, soft limits | Cannot block requests |

**Recommendation:** Synchronous for hard limits, asynchronous for analytics/logging.

### 3. Database Choice

| Option | Pros | Cons | Best For |
|--------|------|------|----------|
| **Redis** | Fast, atomic ops, TTL support | Memory-bound | Primary choice |
| **Memcached** | Simple, fast | No atomic INCR with TTL | Basic counting |
| **In-memory (local)** | Fastest | Not distributed | Single-node, edge |
| **SQL Database** | ACID, familiar | Too slow | Never for hot path |

**Recommendation:** Redis cluster with local caching layer.

### 4. Caching Strategy

```mermaid
flowchart LR
    subgraph L1["L1: Local Cache (per node)"]
        LC[In-Memory<br/>TTL: 100-500ms<br/>Hot keys only]
    end

    subgraph L2["L2: Distributed Cache"]
        RC[Redis Cluster<br/>TTL: Window size<br/>Source of truth]
    end

    Request --> LC
    LC -->|Miss| RC
    RC -->|Response| LC
    LC -->|Hit/Updated| Response
```

**Multi-tier Caching:**
- **L1 (Local):** 100-500ms TTL, reduces Redis calls by 50-80%
- **L2 (Redis):** Source of truth, handles atomic operations

### 5. Message Queue Usage

| Scenario | Queue Needed? | Reasoning |
|----------|---------------|-----------|
| Real-time limiting | No | Must be synchronous |
| Config propagation | Optional | Pub/sub for updates |
| Audit logging | Yes | Async, non-blocking |
| Analytics | Yes | Aggregate and process |

**Recommendation:** Use pub/sub for config updates, message queue for audit logs.

---

## Architecture Pattern Checklist

- [x] **Sync vs Async:** Synchronous for enforcement, async for logging
- [x] **Event-driven vs Request-response:** Request-response for limit checks
- [x] **Push vs Pull:** Pull model (check on each request)
- [x] **Stateless vs Stateful:** Stateless services, externalized state to Redis
- [x] **Read-heavy vs Write-heavy:** Mixed (read count + write increment)
- [x] **Real-time vs Batch:** Real-time enforcement
- [x] **Edge vs Origin:** Both supported (edge for early rejection)

---

## Deployment Options

### Option A: Centralized Rate Limiter

```mermaid
flowchart TB
    subgraph DC1["Datacenter"]
        G1[Gateway 1] & G2[Gateway 2] --> RL[Rate Limiter Cluster]
        RL --> Redis[(Redis)]
    end
```

**Pros:** Simple, consistent view
**Cons:** Single point of failure, latency for remote clients

### Option B: Distributed with Shared Storage

```mermaid
flowchart TB
    subgraph DC1["Datacenter 1"]
        G1[Gateway] --> RL1[Rate Limiter]
        RL1 --> R1[(Redis Primary)]
    end

    subgraph DC2["Datacenter 2"]
        G2[Gateway] --> RL2[Rate Limiter]
        RL2 --> R2[(Redis Replica)]
    end

    R1 <-.->|Replication| R2
```

**Pros:** Geographic distribution, lower latency
**Cons:** Replication lag, eventual consistency

### Option C: Hierarchical (Edge + Origin)

```mermaid
flowchart TB
    subgraph Edge1["Edge PoP 1"]
        E1[Edge Rate Limiter]
        EL1[Local Limits]
    end

    subgraph Edge2["Edge PoP 2"]
        E2[Edge Rate Limiter]
        EL2[Local Limits]
    end

    subgraph Origin["Origin"]
        ORL[Origin Rate Limiter]
        Redis[(Redis)]
    end

    E1 & E2 --> ORL
    ORL --> Redis
    E1 --- EL1
    E2 --- EL2
```

**Pros:** Early rejection at edge, global limits at origin
**Cons:** Complex, potential double-counting

**Recommendation:** Option B for most cases, Option C for global-scale with edge requirements.

---

## Integration Points

### Upstream (Clients)

```
Rate Limit Response Headers (RFC 6585 / draft-ietf-httpapi-ratelimit-headers):

X-RateLimit-Limit: 1000          # Max requests allowed
X-RateLimit-Remaining: 456       # Requests remaining
X-RateLimit-Reset: 1640000000    # Unix timestamp when limit resets
Retry-After: 45                  # Seconds until retry (on 429)
```

### Downstream (Configuration)

```
Configuration Sources:
├── Static config files (default limits)
├── Database (user tier mappings)
├── Admin API (dynamic overrides)
└── Feature flags (A/B testing limits)
```

### Sidecar Pattern (Service Mesh)

```mermaid
flowchart LR
    subgraph Pod["Application Pod"]
        App[Application]
        SC[Sidecar Proxy]
    end

    Client --> SC
    SC -->|Rate Check| RL[Rate Limiter]
    SC --> App
```

**Use Case:** Kubernetes environments with service mesh (Istio, Linkerd)

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Redis unavailable | Cannot check limits | Fail-open with local estimation |
| Rate limiter crash | Gateway blocked | Health checks, circuit breaker |
| Network partition | Inconsistent counts | Accept temporary over-limit |
| Config store down | Stale limits | Cache config with long TTL |

**Default Failure Policy:** Fail-open (allow requests) to prioritize availability over strict enforcement.

---

## Cross-Service Consistency Model

| Data Domain | Consistency | Mechanism | Rationale |
|-------------|------------|-----------|-----------|
| **Rate limit counters** | Eventual | Redis replication + local cache | 1-2% over-limit acceptable; latency > accuracy |
| **Rate limit rules** | Strong (read-your-writes) | Config store with versioned cache invalidation | Rule changes must propagate deterministically |
| **User tier mappings** | Eventual (short lag) | Cached with 60s TTL, pub/sub invalidation | Tier upgrade takes effect within one window |
| **Audit logs** | Eventual | Async queue to append-only store | Non-blocking; best-effort ordering sufficient |
| **Override/exemptions** | Strong | Synchronous write to config store + cache bust | Override must take immediate effect |
| **Algorithm assignments** | Strong (read-your-writes) | Per-endpoint config, versioned deployment | Mid-window algorithm switch needs coordinated migration |
| **Quota allocations** | Eventual | Periodic rebalance every 5-60 minutes | Hierarchical quotas tolerate transient imbalance |

---

## External Integration Points

| Integration | Direction | Protocol | Data Exchanged | Failure Handling |
|-------------|-----------|----------|----------------|------------------|
| **API Gateway** | Inbound | gRPC / embedded SDK | Check requests, limit responses | Circuit breaker; fail-open |
| **Identity Provider** | Inbound | JWT validation | User ID, tier, org_id | Cache JWT claims; reject if unverifiable |
| **Threat Intelligence Feed** | Inbound | REST / streaming | Known-bad IPs, ASNs | Stale feed = reduced protection; alert |
| **Config Management** | Bidirectional | REST + pub/sub | Rate limit rules, tier mappings | Cache with long TTL; stale config safe |
| **Observability Pipeline** | Outbound | gRPC / UDP | Metrics, traces, logs | Best-effort; drop under backpressure |
| **Billing/Metering** | Outbound | Async queue | Usage counts per API key | Exactly-once via idempotency key |
| **Abuse Detection** | Bidirectional | gRPC / event stream | Flagged users, dynamic limits | Async; rate limiter doesn't block on response |
| **Service Mesh Control Plane** | Inbound | xDS / gRPC | Sidecar configuration, limit policies | Mesh falls back to last-known config |

---

## Cost-Based Rate Limiting Architecture

Traditional rate limiting counts requests equally. Cost-based limiting assigns different weights to different operations, allowing expensive queries to consume more quota than simple lookups.

```mermaid
flowchart TB
    subgraph CostEngine["Cost Assignment Engine"]
        CE[Cost Estimator]
        Rules[Cost Rules Table]
    end

    subgraph Limiter["Rate Limiter"]
        Check[Check Weighted Quota]
        TB[Token Bucket<br/>with cost deduction]
    end

    Request --> CE
    CE -->|cost=1| Check
    CE -->|cost=10| Check
    Rules --> CE

    Check --> TB
    TB -->|tokens >= cost| Allow([Allow])
    TB -->|tokens < cost| Deny([Deny])

    classDef engine fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef limiter fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class CE,Rules engine
    class Check,TB limiter
```

**Cost Assignment Examples:**

| Operation | Cost | Rationale |
|-----------|------|-----------|
| GET /users/:id | 1 | Simple key lookup |
| GET /search?q=... | 5 | Full-text search, CPU-heavy |
| POST /bulk-import | 50 | Batch operation, high I/O |
| GET /reports/generate | 100 | Long-running computation |
| GET /health | 0 | Free; never rate-limited |

**Why cost-based matters:** A user with a 1,000 tokens/minute limit gets 1,000 simple reads, or 200 searches, or 10 report generations. This prevents a single expensive operation from consuming resources disproportionately while maintaining fair access for lightweight operations.

---

## Adaptive Rate Limiting

Static limits set at deployment time cannot respond to changing system conditions. Adaptive rate limiting adjusts limits dynamically based on backend health signals.

```mermaid
flowchart LR
    subgraph Feedback["Feedback Loop"]
        Health[Backend Health<br/>Monitor]
        Adjuster[Limit Adjuster]
    end

    subgraph Limiter["Rate Limiter"]
        RL[Enforce Dynamic Limit]
    end

    subgraph Backend["Backend"]
        BE[Service]
        Metrics[Latency / Error Rate /<br/>Queue Depth]
    end

    BE --> Metrics
    Metrics --> Health
    Health --> Adjuster
    Adjuster -->|adjusted limit| RL
    RL --> BE

    classDef feedback fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class Health,Adjuster feedback
    class BE,Metrics,RL service
```

**Adjustment Signals:**

| Signal | Threshold | Adjustment |
|--------|-----------|------------|
| Backend p99 latency | > 2x baseline | Reduce limit by 20% |
| Backend error rate | > 5% | Reduce limit by 50% |
| Queue depth | > 80% capacity | Reduce limit by 30% |
| All healthy | Sustained 5 min | Gradually restore to base limit |

**Guard Rails:**
- Minimum limit: 10% of base (never starve all traffic)
- Maximum limit: 150% of base (prevent runaway)
- Adjustment interval: minimum 30 seconds (prevent oscillation)
- Ramp-up rate: 10% per interval (gradual recovery)
