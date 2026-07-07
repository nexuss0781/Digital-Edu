# Function-as-a-Service (FaaS) - System Design

## System Overview

A **Function-as-a-Service (FaaS)** platform enables developers to deploy and execute discrete units of code (functions) without managing underlying infrastructure. The platform handles provisioning, scaling (including scaling to zero), and execution of functions in response to events or HTTP requests. This serverless compute model fundamentally shifts operational responsibility from developers to the platform.

The system separates concerns between a **control plane** that manages function deployments, configuration, and scaling decisions, and a **data plane** that handles actual function invocation in isolated execution environments. The key technical challenges include minimizing cold start latency, ensuring strong multi-tenant isolation, and efficiently managing a fleet of ephemeral compute resources.

---

## Key Characteristics

| Characteristic | Value | Implication |
|----------------|-------|-------------|
| **Execution Model** | Stateless, ephemeral | Functions must be idempotent; no local state between invocations |
| **Scaling** | 0 to N (auto) | Pay-per-use, but cold starts when scaling from zero |
| **Isolation** | MicroVM / Container / V8 Isolate | Trade-off between security strength and startup latency |
| **Invocation** | Event-driven (sync/async) | HTTP, queue, storage events, scheduled triggers |
| **Resource Allocation** | Memory-based | CPU allocated proportionally to memory |
| **Billing Granularity** | Millisecond (typically) | Efficient for short-lived, bursty workloads |

---

## Complexity Rating

**High**

- Cold start optimization across multiple runtime dimensions
- Multi-tenant isolation with MicroVMs or container sandboxing
- Distributed scheduling with placement optimization
- Event source integration (HTTP, queues, storage, cron)
- Warm pool management and predictive scaling
- Multi-tier caching for code artifacts
- Burst scaling under sudden load spikes

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/Non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture, data flow, key decisions, diagrams |
| [03 - Low-Level Design](./03-low-level-design.md) | Data model, API design, algorithm Step-by-step plan in plain English |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Cold starts, Firecracker, Placement deep dives, Slowest part of the process analysis |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, fault tolerance, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Isolation model, threat model, compliance |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | Pacing, trade-offs, trap questions, common mistakes |

---

## Core Components Summary

| Component | Responsibility | Criticality |
|-----------|---------------|-------------|
| **API Gateway / Frontend** | Request routing, authentication, throttling, request transformation | Critical - entry point for all invocations |
| **Function Registry** | Store function metadata, versions, configurations | Critical - source of truth for deployments |
| **Worker Manager** | Manage execution environment lifecycle, warm pools | Critical - orchestrates function execution |
| **Placement Service** | Decide which worker hosts function instances | Critical - affects cold start and locality |
| **Worker Fleet** | Execute functions in isolated sandboxes (MicroVM/Container) | Critical - actual compute execution |
| **Code Storage** | Store and serve function deployment packages | Important - code artifact delivery |
| **Event Router** | Route events from sources to function invocations | Important - enables async patterns |
| **Scaling Controller** | Make scaling decisions (scale up/down, warm pools) | Important - efficiency and responsiveness |

---

## Algorithm Summary

| Algorithm/Pattern | Purpose | Complexity | Key Insight |
|-------------------|---------|------------|-------------|
| **Warm Pool Management** | Maintain pre-warmed execution environments | O(1) lookup | Trade memory cost for latency reduction |
| **Placement Algorithm** | Select optimal worker for function instance | O(workers) | Balance locality, load, and cold start probability |
| **Burst Scaling** | Handle sudden traffic spikes | O(1) decision | Pre-allocated burst capacity with rate limiting |
| **Code Caching (Multi-tier)** | Reduce code download latency | O(1) per tier | L1 (local) → L2 (shared) → L3 (object storage) |
| **Predictive Warming** | Anticipate demand and pre-warm | ML-based | Historical patterns, time-of-day, event correlation |
| **Snapshot/Restore** | Fast MicroVM initialization | O(1) restore | Pre-captured memory state after initialization |

---

## Architecture Trade-offs at a Glance

```
MicroVM (Firecracker) ←―――――――――→ V8 Isolates
          ↑                              ↑
    Strong isolation              Near-zero cold start
    Any language/runtime          JavaScript/WASM only
    ~125ms startup                <5ms startup
    (AWS Lambda)                  (Cloudflare Workers)

Provisioned Concurrency ←――――――→ On-Demand Only
          ↑                              ↑
    Guaranteed warm              Pay only for invocations
    Predictable latency          Cold starts during spikes
    Higher baseline cost         Lower cost if traffic sparse
    (Latency-sensitive apps)     (Variable/dev workloads)

Synchronous Invocation ←―――――――→ Asynchronous (Queue-based)
          ↑                              ↑
    Immediate response           Decoupled, resilient
    Timeout constraints          Retry with backoff
    Direct error handling        Dead letter queues
    (HTTP APIs)                  (Event processing)
```

---

## Real-World References

| Provider | Technology | Scale | Key Innovation |
|----------|------------|-------|----------------|
| **AWS Lambda** | Firecracker MicroVMs | Trillions of invocations/month | Firecracker: <125ms boot, <5MB overhead |
| **Cloudflare Workers** | V8 Isolates | Millions of requests/second (edge) | <5ms cold start, global edge deployment |
| **Google Cloud Functions** | gVisor (2nd gen) | Global scale | Cloud Run integration, concurrency per instance |
| **Azure Functions** | Hyper-V / Container | Enterprise scale | Durable Functions (stateful workflows) |
| **Vercel Edge Functions** | V8 Isolates | Global edge | Streaming responses, Next.js integration |
| **OpenFaaS** | Containers | Self-hosted | Kubernetes-native, open source |

---

## Related Patterns

| Pattern | Link | Relationship |
|---------|------|-------------|
| **Container Orchestration** | [2.2](../2.2-container-orchestration-system/00-index.md) | Kubernetes is the underlying scheduler for many open-source FaaS platforms; understanding pod scheduling informs worker placement |
| **Service Discovery** | [1.10](../1.10-service-discovery-system/00-index.md) | FaaS platforms require ultra-fast service discovery for ephemeral function instances; registration latency directly impacts cold start time |
| **API Gateway** | [1.14](../1.14-api-gateway-design/00-index.md) | HTTP-triggered functions route through API gateways; gateway throttling and transformation happen before function invocation |
| **CI/CD Pipeline** | [2.4](../2.4-cicd-pipeline-build-system/00-index.md) | Function deployment pipelines share build, test, and versioning patterns with CI/CD systems; artifact storage and caching strategies overlap |
| **Feature Flag Management** | [2.7](../2.7-feature-flag-management/00-index.md) | Feature flags control function version routing (canary, blue-green) and enable progressive rollouts of new function code |
| **Code Execution Sandbox** | [12.9](../12.9-code-execution-sandbox/00-index.md) | Shares isolation techniques (MicroVM, gVisor, V8 Isolates) and the same multi-tenant security concerns; sandbox startup latency is a shared challenge |
| **Edge Computing Platform** | [2.12](../2.12-edge-native-application-platform/00-index.md) | Edge FaaS deploys functions at CDN PoPs using V8 Isolates or WASM for sub-5ms cold starts; architectural patterns overlap significantly |
| **Distributed Rate Limiter** | [1.1](../1.1-distributed-rate-limiter/00-index.md) | Per-function and per-account concurrency limits in FaaS are rate limiting problems; burst scaling limits create capacity cliffs analogous to rate limiter behavior |

---

## Modern Developments (2025-2026)

### WebAssembly (WASM) as a Universal Serverless Runtime

WebAssembly has emerged as a third isolation model alongside MicroVMs and V8 Isolates. WASM Components (using the Component Model specification) provide near-native execution speed with sandboxed isolation, sub-millisecond cold starts, and language-agnostic support (Rust, Go, Python, C++ all compile to WASM). The WASI (WebAssembly System Interface) standard enables WASM modules to access filesystem, networking, and other system resources in a capability-based security model — each function receives only the capabilities it explicitly requests. This positions WASM as a potential convergence point: stronger isolation than V8 Isolates (no shared runtime vulnerabilities), faster cold starts than MicroVMs, and broader language support than either.

### Snapshot-Based Cold Start Elimination

Snapshot/restore technology has expanded beyond individual VM snapshots to **fleet-wide snapshot pools**. Instead of capturing a snapshot per function version, platforms now maintain pre-initialized snapshot templates for each runtime+version combination (e.g., "Python 3.12 + common ML libraries"). When a function cold starts, the platform clones the closest matching snapshot and applies only the function-specific code delta — reducing cold starts for complex ML inference functions from 5-10 seconds to under 200ms. Some platforms extend this with **on-demand snapshot materialization**, where snapshots are lazily restored from compressed storage as memory pages are accessed (copy-on-read), further reducing restore time.

### GPU-Attached Serverless for AI Inference

The most significant 2025-2026 development is **GPU-attached serverless** for running AI/ML inference workloads. Functions can now request fractional GPU resources (e.g., 10% of an A100) with time-sliced sharing across tenants. The cold start challenge is amplified: model loading (2-30GB) and GPU context initialization (100-500ms) dominate startup time. Solutions include model caching on GPU memory across invocations, GPU memory snapshot/restore, and pre-loaded model pools that function instances attach to rather than loading independently.

### Durable Execution and Serverless Workflows

**Durable execution** frameworks have matured to allow long-running workflows that survive function timeouts, infrastructure failures, and even deployment updates. The function runtime automatically checkpoints execution state at each await point, storing it in durable storage. If the function is interrupted (timeout, crash, spot instance reclamation), execution resumes from the last checkpoint with full local variable state restored. This pattern transforms serverless from "short-lived stateless functions" to "infinitely-running stateful workflows" without any explicit state management code.

---

## Related Systems

- **Container Orchestration** (Kubernetes) - Underlying infrastructure for some FaaS platforms
- **API Gateway** - Often integrated for HTTP-triggered functions
- **Message Queue** (SQS, Kafka) - Event sources for async invocation
- **Object Storage** (S3) - Function code storage, event triggers
- **Service Mesh** - Internal traffic management for platform components
- **Observability Stack** (CloudWatch, Datadog) - Function monitoring and tracing
