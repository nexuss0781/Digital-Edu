# Distributed Rate Limiter - System Design

## System Overview

A **Distributed Rate Limiter** is a critical infrastructure component that controls the rate of requests clients can make to a service within a specified time window. It protects backend services from being overwhelmed, ensures fair resource allocation among users, and provides defense against abuse and DDoS attacks.

In a distributed environment, rate limiting becomes significantly more complex as state must be synchronized or shared across multiple nodes, requiring careful consideration of consistency, latency, and fault tolerance trade-offs.

---

## Key Characteristics

| Characteristic | Value | Implication |
|----------------|-------|-------------|
| **Traffic Pattern** | Read-heavy | High throughput on limit checks |
| **Latency Sensitivity** | Very High | Must add minimal overhead (< 5ms p99) |
| **Consistency Requirement** | Eventual (typically) | Small over-limit acceptable for performance |
| **Availability Requirement** | Very High | Failure mode decisions critical |
| **State Management** | Shared/Distributed | Requires coordination mechanism |

---

## Complexity Rating

**Medium-High**

- Conceptually straightforward (count requests, enforce limits)
- Significant complexity in distributed coordination
- Multiple algorithm choices with different trade-offs
- Race conditions and consistency challenges
- Critical operational concerns (fail-open vs fail-closed)

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/Non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture, data flow, key decisions, diagrams |
| [03 - Low-Level Design](./03-low-level-design.md) | Data model, API design, algorithm Step-by-step plan in plain English |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Race conditions, distributed consistency, Slowest part of the process analysis |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, fault tolerance, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Threat model, DDoS protection, security headers |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | Pacing, trade-offs, trap questions, common mistakes |

---

## Algorithm Summary

| Algorithm | Burst Handling | Memory | Accuracy | Use Case |
|-----------|---------------|--------|----------|----------|
| **Token Bucket** | Allows bursts | O(1) | High | Stripe, general APIs |
| **Leaky Bucket** | Smooths bursts | O(1) | High | Constant-rate processing |
| **Fixed Window** | Boundary spike | O(1) | Medium | GitHub API, simple cases |
| **Sliding Window Log** | Accurate | O(n) | Very High | Low-volume, high-accuracy |
| **Sliding Window Counter** | Balanced | O(1) | High | Cloudflare, high-scale |
| **GCRA** | Smooth, spacing | O(1) | Very High | Sophisticated rate shaping |

---

## Real-World References

| Company | Approach | Key Insight |
|---------|----------|-------------|
| **Stripe** | Token Bucket + Redis | 4 limiter types, traffic prioritization |
| **Cloudflare** | Sliding Window Counter | Edge enforcement, 0.003% error rate |
| **GitHub** | Fixed Window + Sharded Redis | Client-side sharding for scale |
| **Databricks** | Token Bucket | 10x tail latency improvement |

---

## Key Trade-offs at a Glance

```
Consistency ←――――――――――――――→ Latency
     ↑                           ↑
     Strong consistency          Local caching
     Single point of truth       Eventual consistency
     Higher latency              Lower latency

Accuracy ←――――――――――――――→ Memory
     ↑                           ↑
     Sliding window log          Fixed counters
     Per-request timestamps      O(1) storage
     O(n) memory                 Lower accuracy
```

---

## Quick Reference: Scale Numbers

| Metric | Value | Context |
|--------|-------|---------|
| Target throughput | 1M QPS | Design ceiling for distributed deployment |
| Per-node capacity | 50K QPS | Before horizontal scaling trigger |
| Check latency (p99) | < 5ms | Must add < 5% overhead to backend p99 |
| Memory per key | ~75 bytes | Token bucket: tokens + last_refill + TTL |
| Active keys (100M DAU) | 500M | 100M users × 5 endpoints each |
| Total storage (with replication) | ~225 GB | 75 GB raw × 3 replicas |
| Availability target | 99.99% | 52.6 min/year allowed downtime |
| Acceptable over-limit | 1-2% | Eventual consistency trade-off |
| Sliding window accuracy | 99.997% | Cloudflare-reported error rate |
| Redis failover time | 10-15s | Sentinel detection + promotion |
| Config propagation | < 30s | Rule changes across all nodes |
| Local cache hit rate | 70-80% | L1 + L2 combined Redis bypass |

---

## Key Trade-Offs

| Trade-Off | Option A | Option B | Default Choice |
|-----------|----------|----------|----------------|
| Consistency vs Latency | Strong (single Redis primary) | Eventual (local cache + async sync) | Eventual — slight over-limit acceptable |
| Fail-Open vs Fail-Closed | Allow all on failure | Block all on failure | Fail-open — availability over protection |
| Accuracy vs Memory | Sliding window log (O(n)) | Sliding window counter (O(1)) | Counter — 0.003% error is acceptable |
| Embedded vs Service | In-gateway (no network hop) | Separate microservice | Service — independent scaling wins |
| Global vs Local Limits | Single counter (accurate) | Per-node quotas (fast) | Hierarchical — quota allocation with periodic rebalance |
| Burst vs Smooth | Token bucket (burst-tolerant) | Leaky bucket (constant rate) | Per-endpoint decision, not global |

---

## Related Designs

| System | Relationship | Link |
|--------|-------------|------|
| **API Gateway** | Primary integration point; rate limiter as gateway middleware or sidecar | [View](../2.4-api-gateway/00-index.md) |
| **Load Balancer** | Connection-level limiting complements application-level rate limiting | [View](../2.2-load-balancer/00-index.md) |
| **Circuit Breaker** | Rate limiter uses circuit breaker for Redis fallback; similar resilience pattern | [View](../1.3-circuit-breaker/00-index.md) |
| **Distributed Cache** | Redis as rate limit state store; caching strategies for hot keys | [View](../1.4-distributed-cache/00-index.md) |
| **Service Mesh** | Sidecar-based rate limiting in Kubernetes environments | [View](../2.7-service-mesh/00-index.md) |
| **DDoS Protection** | Rate limiter as application-layer defense within multi-layer DDoS mitigation | [View](../1.7-ddos-protection/00-index.md) |
| **Payment Gateway** | Financial APIs require per-endpoint algorithm selection and strict accuracy | [View](../8.1-payment-gateway/00-index.md) |
| **Notification System** | Rate limiting outbound notifications to prevent user fatigue and provider throttling | [View](../5.1-notification-system/00-index.md) |

---

---

## Sources

1. Stripe Engineering — "Rate limiters and load shedders" (2017, updated 2024)
2. Cloudflare Blog — "How we built rate limiting capable of scaling to millions of domains" (2017)
3. GitHub Engineering — "Rate limiting at scale"
4. Databricks — "Rate Limiting for Apache Spark Structured Streaming" (2023)
5. IETF Draft — "RateLimit Header Fields for HTTP" (draft-ietf-httpapi-ratelimit-headers-08, 2024)
6. Redis Documentation — Lua scripting, Redis Cluster, Sentinel
7. Kong Gateway — "Rate Limiting Best Practices" (2024)
8. Figma Engineering — "An alternative approach to rate limiting" (GCRA, 2023)
