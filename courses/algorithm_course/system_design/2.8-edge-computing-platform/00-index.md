# Edge Computing Platform

[Back to System Design Index](../README.md)

---

## Overview

An **Edge Computing Platform** enables developers to deploy and execute code at globally distributed Points of Presence (PoPs), bringing computation closer to end users. By running application logic at the network edge rather than in centralized data centers, these platforms achieve sub-50ms latency for request handling, eliminate cold start overhead through lightweight isolation technologies, and provide seamless global distribution via anycast routing.

Modern edge platforms use innovative isolation mechanisms—V8 isolates, Firecracker microVMs, or WebAssembly sandboxes—to run thousands of tenant workloads on shared infrastructure while maintaining security boundaries. This architecture powers real-time personalization, A/B testing at the edge, authentication, request routing, and low-latency API responses.

---

## Key Characteristics

| Characteristic | Value | Implication |
|----------------|-------|-------------|
| Traffic Pattern | Billions of requests/day, globally distributed | Anycast routing, PoP-local processing |
| Latency Sensitivity | p99 < 50ms end-to-end | Edge execution mandatory, no origin round-trip |
| Cold Start Requirement | < 5ms (isolates), < 125ms (microVMs) | V8 isolates or WASM for latency-critical paths |
| State Model | Mostly stateless, optional edge state | KV stores (eventual), Durable Objects (strong) |
| Isolation Model | Multi-tenant on shared infrastructure | Process-level (isolates) or VM-level (Firecracker) |
| Consistency | Eventual for KV, strong for Durable Objects | Choose based on use case requirements |
| Availability Target | 99.99% per PoP, 99.999% global | Automatic failover to nearest healthy PoP |

---

## Quick Navigation

| Document | Purpose |
|----------|---------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, algorithms (Step-by-step plan in plain English) |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | V8 isolates, Durable Objects, routing deep dives |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, fault tolerance, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Isolation model, threat analysis, compliance |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-offs |

---

## Complexity Rating: High

| Aspect | Complexity | Reason |
|--------|------------|--------|
| Global Distribution | High | 300+ PoPs, anycast routing, inter-PoP networking |
| Isolation Technology | High | V8 isolates, memory protection, security sandboxing |
| State Management | High | Eventual vs strong consistency, Durable Object routing |
| Cold Start Optimization | Medium | Warm pools, code pre-optimization, caching |
| Observability | Medium | Distributed tracing across global PoPs |
| Security | High | Multi-tenant isolation, DDoS protection, code sandboxing |

---

## Isolation Technology Comparison

| Technology | Cold Start | Memory Overhead | Security Model | Best For |
|------------|------------|-----------------|----------------|----------|
| **V8 Isolates** | < 5ms | ~2MB per isolate | Process-level isolation, MPK | JavaScript/TypeScript workloads |
| **Firecracker microVM** | ~125ms | ~5MB per VM | Hardware virtualization (KVM) | Full OS control, custom runtimes |
| **WASM Sandbox** | ~35μs | Minimal (~KB) | Per-request sandbox | Compiled languages (Rust, Go, C++) |
| **Containers** | 500ms-2s | 50-200MB | Namespace isolation | Long-running services (not edge) |

```mermaid
flowchart LR
    subgraph ColdStart["Cold Start Comparison"]
        WASM["WASM<br/>35μs"]
        V8["V8 Isolates<br/>5ms"]
        FC["Firecracker<br/>125ms"]
        Container["Container<br/>500ms+"]
    end

    WASM --> V8 --> FC --> Container

    style WASM fill:#c8e6c9
    style V8 fill:#dcedc8
    style FC fill:#fff9c4
    style Container fill:#ffcdd2
```

---

## Real-World Systems

| Platform | Isolation | Key Features | Scale |
|----------|-----------|--------------|-------|
| **Cloudflare Workers** | V8 Isolates | Workers KV, Durable Objects, R2 Storage | 300+ PoPs, millions of workers |
| **Fly.io** | Firecracker | Full VM control, WireGuard networking, LiteFS | Global regions, persistent VMs |
| **Deno Deploy** | V8 Isolates | TypeScript-first, Deno KV, Deno Queues | 35+ regions, sub-second deploys |
| **Vercel Edge Functions** | V8 Runtime | Next.js integration, Edge Middleware | Global edge network |
| **Fastly Compute** | WASM (Wasmtime) | 35μs cold start, any compiled language | 90+ PoPs, high-performance |
| **AWS Lambda@Edge** | Container-based | CloudFront integration, viewer/origin hooks | CloudFront edge locations |

---

## Architecture Overview

```mermaid
flowchart TB
    subgraph Users["Global Users"]
        U1["User (US)"]
        U2["User (EU)"]
        U3["User (APAC)"]
    end

    subgraph DNS["Anycast DNS"]
        ADNS["Single Anycast IP<br/>→ Nearest PoP"]
    end

    subgraph ControlPlane["Control Plane (Centralized)"]
        API["Deployment API"]
        CodeStore["Code Storage"]
        Config["Configuration"]
        Metrics["Metrics Aggregation"]
    end

    subgraph EdgePoPs["Edge PoPs (Distributed)"]
        subgraph PoP1["PoP - US West"]
            R1["Router"]
            RT1["Runtime<br/>(V8/WASM)"]
            KV1["KV Cache"]
        end

        subgraph PoP2["PoP - EU Central"]
            R2["Router"]
            RT2["Runtime<br/>(V8/WASM)"]
            KV2["KV Cache"]
        end

        subgraph PoP3["PoP - APAC"]
            R3["Router"]
            RT3["Runtime<br/>(V8/WASM)"]
            KV3["KV Cache"]
        end
    end

    subgraph Origin["Origin (Optional)"]
        OriginAPI["Origin API"]
        DB["Database"]
    end

    U1 --> ADNS
    U2 --> ADNS
    U3 --> ADNS

    ADNS --> R1
    ADNS --> R2
    ADNS --> R3

    R1 --> RT1
    R2 --> RT2
    R3 --> RT3

    RT1 --> KV1
    RT2 --> KV2
    RT3 --> KV3

    RT1 -.-> OriginAPI
    RT2 -.-> OriginAPI
    RT3 -.-> OriginAPI

    OriginAPI --> DB

    API --> CodeStore
    CodeStore --> PoP1
    CodeStore --> PoP2
    CodeStore --> PoP3

    PoP1 --> Metrics
    PoP2 --> Metrics
    PoP3 --> Metrics

    style ControlPlane fill:#e3f2fd
    style EdgePoPs fill:#f3e5f5
    style Origin fill:#fff3e0
```

---

## Key Design Decisions Summary

| Decision | Options | Recommendation | Rationale |
|----------|---------|----------------|-----------|
| Isolation Model | V8 Isolates / Firecracker / WASM | V8 Isolates (default) | Best cold start, sufficient isolation |
| Routing | Anycast / GeoDNS | Anycast | Simpler, automatic nearest-PoP |
| State Storage | KV (eventual) / Durable Objects (strong) | KV for most, DO for coordination | Match consistency to use case |
| Code Distribution | Push (proactive) / Pull (on-demand) | Hybrid | Push for popular, pull for long-tail |
| Cold Start Strategy | Warm pools / On-demand | Warm pools for hot paths | Predictable latency for critical routes |

---

## Interview Quick Reference

### Must-Know Concepts

1. **V8 Isolates**: Lightweight execution contexts within a single process, ~5ms cold start
2. **Anycast Routing**: Single IP advertised from multiple locations, BGP routes to nearest
3. **Durable Objects**: Strongly consistent, single-instance-per-ID edge state
4. **Workers KV**: Eventually consistent, globally replicated key-value store
5. **Cold Start**: Time to initialize new execution environment

### Key Trade-offs

| Trade-off | Option A | Option B |
|-----------|----------|----------|
| Isolation strength vs latency | Firecracker (stronger, slower) | V8 Isolates (weaker, faster) |
| Consistency vs latency | Durable Objects (strong, routed) | KV (eventual, local) |
| Flexibility vs cold start | Containers (flexible, slow) | WASM (compiled, instant) |
| Push vs pull deployment | Eager (higher bandwidth) | Lazy (cold start on first request) |

### Red Flags in Interviews

- Proposing containers for edge workloads (cold start too slow)
- Ignoring eventual consistency implications of KV stores
- Not considering PoP failure and automatic failover
- Assuming unlimited CPU/memory at edge (strict limits apply)
- Forgetting about debugging/observability challenges at edge

---

## Related System Designs

- [1.15 - Content Delivery Network (CDN)](../1.15-content-delivery-network-cdn/00-index.md) - Edge caching layer, PoP topology
- [1.14 - API Gateway](../1.14-api-gateway-design/00-index.md) - Request routing and transformation at the edge
- [2.3 - Function-as-a-Service (FaaS)](../2.3-function-as-a-service/00-index.md) - Serverless compute, Firecracker vs V8 isolation trade-offs
- [1.16 - DNS System Design](../1.16-dns-system-design/00-index.md) - Anycast and GeoDNS fundamentals
- [2.12 - Edge-Native Application Platform](../2.12-edge-native-application-platform/00-index.md) - Full-stack edge applications, embedded database replicas
- [2.9 - Multi-Region Active-Active](../2.9-multi-region-active-active/00-index.md) - CRDTs, conflict resolution for globally distributed state
- [1.3 - Distributed Key-Value Store](../1.3-distributed-key-value-store/00-index.md) - KV consistency models that underpin edge KV stores
- [2.13 - Edge AI/ML Inference](../2.13-edge-ai-ml-inference/00-index.md) - Model quantization, on-device inference at edge PoPs

---

## 2025-2026 Developments

| Development | Impact | Status |
|-------------|--------|--------|
| **WASI Preview 2 (wasi-http, wasi-keyvalue)** | Standardized host capabilities make edge functions portable across platforms | Shipping in Fastly Compute, Fermyon Spin |
| **Wasm Component Model (WIT interfaces)** | Polyglot edge composition — Rust calls Go calls C++ in a single sandbox | Early production adoption |
| **Smart Placement / Data Gravity Routing** | Auto-route compute to data-nearest PoP when origin calls dominate latency | Production (Cloudflare Smart Placement) |
| **Edge AI Inference (quantized models at PoP)** | 3-tier strategy: rule-based (60%) → small model (30%) → cloud GPU fallback (10%) | Emerging across major platforms |
| **Durable Objects with SQLite** | Embedded relational storage per object (up to 10GB), replacing simple KV | Production |
| **Edge Database Replicas (distributed SQLite)** | Read replicas at every PoP, single-primary writes — inverted read/write scaling | Production (Turso, LiteFS) |
| **Firecracker Snapshotting** | Snapshot/restore microVMs in <50ms, narrowing the gap with V8 isolates | Maturing |
| **Memory Protection Keys (MPK) for Isolates** | Hardware-tagged memory regions catch 92% of isolation bypasses at 1% overhead | Production at scale |
| **WebGPU at Edge** | GPU-accelerated compute in WASM sandboxes for inference and media processing | Experimental |
| **Edge Observability (OpenTelemetry at PoP)** | Per-PoP distributed traces with sub-millisecond overhead tail sampling | Early adoption |

### Industry Shift: From V8-Only to Polyglot Edge

The edge computing landscape is bifurcating: V8 isolates remain dominant for JavaScript/TypeScript workloads, but WebAssembly with the Component Model is rapidly enabling compiled languages (Rust, Go, C++) at the edge with equivalent cold start performance (~35μs). The convergence point is WASI Preview 2 — a standard set of host capabilities that makes edge functions portable across Cloudflare, Fastly, Fermyon, and wasmCloud without code changes. Smart Placement represents a more fundamental shift: rather than always running code at the user-nearest PoP, platforms now analyze origin-call patterns and automatically route data-intensive workloads near their databases, saving 5+ round-trips at 80ms each.

---

**Next: [01 - Requirements & Estimations](./01-requirements-and-estimations.md)**
