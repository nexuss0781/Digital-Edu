# Edge-Native Feature Flags

[← Back to System Design Index](../README.md)

---

## Overview

**Edge-Native Feature Flags** is a specialized architecture that evaluates feature flags directly at globally distributed edge locations (CDN Points of Presence) without requiring round-trips to origin servers. By pushing flag configurations to edge nodes and performing evaluation locally, these systems achieve sub-10ms latency for flag decisions anywhere in the world.

Unlike traditional feature flag systems where SDKs fetch flag states from centralized servers, edge-native systems pre-position flag data at 100+ edge locations and evaluate targeting rules locally. This eliminates network latency from the critical path, enabling use cases like edge middleware personalization, A/B testing at CDN layer, and geo-targeted experiences.

This design focuses on the **edge evaluation layer** - how flags sync to edge, how evaluation happens locally, and how consistency is maintained globally. For the general feature flag control plane and SDK architecture, see [2.7 Feature Flag Management](../2.7-feature-flag-management/00-index.md).

---

## Key Characteristics

| Characteristic | Value | Implication |
|----------------|-------|-------------|
| **Evaluation Location** | Edge PoPs (100-300+ locations) | No origin round-trip for flag decisions |
| **Latency Target** | <5ms P50, <15ms P99 | In-memory evaluation at edge mandatory |
| **Propagation Speed** | <1 second globally | Streaming (SSE) required, polling insufficient |
| **Consistency Model** | Eventual (ms-second staleness) | Brief inconsistency acceptable for flags |
| **Data Model** | Push-based distribution | Flags pre-positioned before requests arrive |
| **Caching Strategy** | Multi-layer (memory → KV → origin) | Graceful degradation on failures |
| **Availability** | 99.99% per PoP, 99.999% global | Anycast routing to healthy PoPs |

---

## Complexity Rating

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Overall** | **Medium-High** | Combines edge computing, streaming, and distributed caching |
| **Edge Sync** | High | Push-based distribution to 100+ PoPs in <1 second |
| **Local Evaluation** | Medium | Rule matching and consistent hashing at edge |
| **Consistency** | Medium-High | Staleness budgets, read-your-writes guarantees |
| **Fallback/Resilience** | Medium | Multi-layer fallback, bootstrap patterns |
| **Observability** | High | Distributed tracing across global edge network |

---

## Document Navigation

| # | Document | Description |
|---|----------|-------------|
| 01 | [Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning |
| 02 | [High-Level Design](./02-high-level-design.md) | Edge architecture, push vs pull, data flow |
| 03 | [Low-Level Design](./03-low-level-design.md) | Data model, APIs, evaluation algorithms |
| 04 | [Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Edge sync, segment caching, consistency deep dives |
| 05 | [Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, fault tolerance, DR |
| 06 | [Security & Compliance](./06-security-and-compliance.md) | Edge security, data exposure, threat model |
| 07 | [Observability](./07-observability.md) | Metrics, logging, tracing across edge PoPs |
| 08 | [Interview Guide](./08-interview-guide.md) | Pacing, trade-offs, trap questions |

---

## Related Patterns

| Pattern | Link | Relationship |
|---------|------|-------------|
| **Feature Flag Management** | [2.7](../2.7-feature-flag-management/00-index.md) | **Foundation** — Control plane, SDKs, experimentation engine; edge-native extends this to the CDN layer |
| **Edge Computing Platform** | [2.12](../2.12-edge-native-application-platform/00-index.md) | **Sibling** — Edge databases, rendering, V8 isolates; flags are one use case of edge compute |
| **CDN Design** | [1.15](../1.15-content-delivery-network-cdn/00-index.md) | **Underlying** — PoP distribution, anycast routing, cache invalidation patterns directly apply to flag sync |
| **Distributed LRU Cache** | [1.4](../1.4-distributed-lru-cache/00-index.md) | **Pattern** — Hot/cold tiering, eviction strategies applied at edge memory-constrained workers |
| **Service Discovery** | [1.10](../1.10-service-discovery-system/00-index.md) | **Analogy** — Watch-based push invalidation for endpoint changes mirrors SSE-based push for flag changes; staleness trade-offs are equivalent |
| **Function-as-a-Service** | [2.3](../2.3-function-as-a-service/00-index.md) | **Runtime** — Edge flag evaluation runs inside V8 Isolates or WASM modules on serverless edge platforms; cold start patterns overlap |
| **Consistent Hashing Ring** | [1.9](../1.9-consistent-hashing-ring/00-index.md) | **Pattern** — Consistent hashing ensures deterministic percentage bucketing; the same user always lands in the same rollout bucket regardless of which edge PoP evaluates the flag |
| **Multi-Region Active-Active** | [2.9](../2.9-multi-region-active-active/00-index.md) | **Infrastructure** — Multi-region flag propagation faces the same consistency vs latency trade-offs as active-active data replication |

---

## Core Components

| Component | Responsibility | Key Challenge |
|-----------|---------------|---------------|
| **Edge Flag Store** | Local storage of flag configs at each PoP | Memory efficiency, fast lookups |
| **Sync Service** | Push flag updates to all edge nodes | <1 second global propagation |
| **Edge Evaluator** | Evaluate targeting rules locally | Sub-5ms latency, consistent bucketing |
| **Segment Cache** | Cache user segment memberships at edge | Staleness vs memory trade-off |
| **Fallback Manager** | Handle edge failures gracefully | Multi-layer default resolution |
| **Bootstrap Service** | Initialize flags on cold start | Eliminate first-request latency |

---

## Edge Evaluation vs Traditional Evaluation

| Aspect | Traditional (Origin) | Edge-Native |
|--------|---------------------|-------------|
| **Evaluation Location** | App server or SDK | Edge PoP (CDN worker) |
| **Network Hops** | 1+ round-trips to flag service | Zero (local evaluation) |
| **Latency** | 10-100ms (network dependent) | <5ms (memory access) |
| **Data Freshness** | Real-time (fetch on demand) | Eventually consistent (<1s lag) |
| **Failure Mode** | Service unavailable = no flags | Edge continues with cached data |
| **Scale** | Origin must handle all traffic | Distributed across 100+ PoPs |
| **Use Cases** | Server-side apps, batch jobs | Edge middleware, CDN routing, SSR |

---

## Distribution Model Comparison

| Model | Description | Latency | Freshness | Best For |
|-------|-------------|---------|-----------|----------|
| **Push CDN** | Proactively replicate to all PoPs | <5ms reads | <1s propagation | Edge-native flags (Vercel Edge Config) |
| **Pull CDN** | Fetch from origin on cache miss | Cold start penalty | Fresh on miss | Traditional CDN caching |
| **Streaming (SSE)** | Server pushes updates to edge | Sub-second | Real-time | LaunchDarkly, Unleash Enterprise |
| **Polling** | Edge periodically fetches updates | 10-60s lag | Stale window | Fallback mode |
| **Hybrid** | Push + pull for long-tail | Optimized | Balanced | Production systems |

---

## Real-World Systems

| System | Provider | Approach | Latency | Scale |
|--------|----------|----------|---------|-------|
| **Flag Delivery at Edge** | LaunchDarkly | CDN-based push, SSE streaming | 25ms bootstrap | 100 PoPs |
| **Edge Config** | Vercel | Push-based global replication | <5ms P50, <15ms P99 | Global edge |
| **Edge SDK** | Statsig | Pre-evaluated configs pushed | <1ms evaluation | 30+ SDKs |
| **Enterprise Edge** | Unleash | Streaming to self-hosted edge | Milliseconds | 16+ regions |
| **Edge Flags** | Upstash | Global Redis with edge caching | Sub-ms (cached) | Global |
| **Cloudflare + Flags** | Various | Workers KV + flag integration | Sub-50ms | 300+ PoPs |

---

## Performance Targets

| Metric | Target | Industry Reference |
|--------|--------|-------------------|
| Edge evaluation latency | <5ms P50, <15ms P99 | Vercel Edge Config |
| Global propagation | <1 second | LaunchDarkly, Split |
| Bootstrap/cold start | <25ms | LaunchDarkly Edge |
| Memory per PoP | <50MB for 10K flags | Efficient encoding |
| Availability (per PoP) | 99.99% | Standard SLA |
| Availability (global) | 99.999% | Anycast failover |

---

## Modern Developments (2025-2026)

### WebAssembly Edge Evaluation

WASM-based flag evaluators are replacing V8 Isolate-specific implementations, enabling the same evaluation logic to run across heterogeneous edge platforms (CDN workers, IoT gateways, mobile devices) from a single compiled binary. WASM Components with the Component Model allow flag evaluation modules to be composed with application-specific targeting logic without recompiling the core evaluator. Cold start for WASM-based evaluators is sub-millisecond, compared to 5-50ms for V8 Isolate initialization.

### CRDT-Based Flag State Synchronization

**Conflict-free Replicated Data Types (CRDTs)** are being adopted for flag state synchronization across edge PoPs. Instead of a single source of truth with push distribution, each PoP maintains a CRDT replica that can accept local writes (flag override for a specific region) and merge with remote replicas without coordination. This enables **regional flag overrides** where a flag can be toggled at a specific PoP without waiting for origin round-trip — useful for emergency kill switches during regional incidents. The G-Counter CRDT tracks evaluation counts across PoPs, and OR-Set CRDTs manage segment memberships that can be updated from any edge location.

### AI-Driven Targeting at Edge

ML models are being deployed at edge PoPs to perform real-time audience segmentation for flag targeting. Instead of pre-computed segments, an edge-local ML model evaluates user features (device type, location, behavioral signals from the current session) and assigns segment memberships in real-time. This enables **context-aware targeting** that adapts to the user's current session without round-trips to origin for segment evaluation. Quantized models (INT8) running in WASM achieve sub-millisecond inference, keeping the total flag evaluation under the 5ms budget.

### Server-Side Rendering Integration

Edge flags have become deeply integrated with server-side rendering (SSR) frameworks, where flag decisions influence not just content toggling but the entire render tree. Edge middleware evaluates flags before the page renders, injecting the appropriate component variants into the SSR pipeline. This eliminates the "flash of default content" entirely — the user receives a fully personalized page on the first byte. The flag evaluation results are serialized into the HTML as hydration data, ensuring client-side JavaScript maintains consistency with the server-rendered state without additional API calls.

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│                 EDGE-NATIVE FEATURE FLAGS                       │
├─────────────────────────────────────────────────────────────────┤
│  SCALE TARGETS                                                  │
│  • 100-300+ edge PoPs globally                                  │
│  • <5ms P50, <15ms P99 evaluation latency                       │
│  • <1 second global propagation                                 │
│  • 10K+ flags per organization                                  │
│  • Millions of evaluations/second (distributed)                 │
├─────────────────────────────────────────────────────────────────┤
│  KEY PATTERNS                                                   │
│  • Push-based distribution (not pull)                           │
│  • Streaming (SSE) for real-time updates                        │
│  • In-memory evaluation at edge (no network hop)                │
│  • Multi-layer fallback (memory → KV → origin → defaults)       │
│  • Consistent hashing for sticky bucketing                      │
│  • Bootstrap flags in initial HTML response                     │
├─────────────────────────────────────────────────────────────────┤
│  CRITICAL DECISIONS                                             │
│  • Push vs Pull distribution model                              │
│  • Staleness budget per flag type                               │
│  • Segment caching strategy at edge                             │
│  • Fallback behavior on edge failure                            │
│  • Bootstrap vs lazy initialization                             │
├─────────────────────────────────────────────────────────────────┤
│  INTERVIEW FOCUS AREAS                                          │
│  • Push-based CDN vs pull-based (cold start elimination)        │
│  • Streaming vs polling trade-offs                              │
│  • Consistency model (eventual is acceptable)                   │
│  • Multi-layer resilience and fallback                          │
│  • Edge memory constraints and flag encoding                    │
└─────────────────────────────────────────────────────────────────┘
```

---

**Next:** [Requirements & Estimations →](./01-requirements-and-estimations.md)
