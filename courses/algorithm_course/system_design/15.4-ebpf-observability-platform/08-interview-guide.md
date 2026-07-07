# Interview Guide — eBPF-based Observability Platform

## Interview Pacing (45-min format)

| Time | Phase | Focus |
|------|-------|-------|
| 0-5 min | Clarify | Scope the system: observability only, or security enforcement too? Cluster size? Kernel version constraints? Which protocols to parse? |
| 5-15 min | High-Level | Three-layer architecture (kernel data plane → node agent → central collector), eBPF program lifecycle, data flow from kernel event to dashboard |
| 15-30 min | Deep Dive | Pick 1-2: verifier constraints shaping design, ring buffer back-pressure, protocol parsing in kernel, or security enforcement architecture |
| 30-40 min | Scale & Trade-offs | Scaling the collector, kernel version compatibility matrix, ring buffer vs. perf buffer, in-kernel filtering vs. user-space filtering |
| 40-45 min | Wrap Up | Summarize key decisions, acknowledge trade-offs, discuss the meta-challenge of observing the observer |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **The verifier is an architectural constraint, not a bug:** Unlike most systems where you design the architecture first and implement it, eBPF systems are designed around what the verifier will accept. The verifier's instruction limits, stack size restrictions, and bounded-loop requirements fundamentally shape how protocol parsers, policy engines, and event pipelines are structured. Mentioning this early signals deep understanding.

2. **Zero-instrumentation is a spectrum, not a binary:** The platform can capture network flows and syscall events with true zero instrumentation, but capturing distributed traces (W3C Trace Context) requires parsing L7 headers which requires protocol-specific eBPF programs. TLS-encrypted traffic requires hooking into crypto libraries (uprobes), which is still "no application changes" but is instrumenting the runtime. Being precise about what "zero instrumentation" actually means demonstrates maturity.

3. **The observer must not become the observed:** The recursive challenge of an observability platform monitoring itself is a unique design constraint. Spend 30 seconds on this to show you've thought about the meta-problem.

4. **Kernel coupling creates a unique compatibility challenge:** No other observability system has a hard dependency on the specific Linux kernel version running on each node. CO-RE/BTF largely solves this, but the candidate should discuss what happens when it doesn't (fallback strategies, feature probing).

### Where to Spend Most Time

- **Deep Dive (15-30 min):** The verifier and ring buffer are the two most interview-relevant components. The verifier because it demonstrates understanding of a unique constraint that doesn't exist in user-space systems; the ring buffer because it's a classic systems design problem (producer-consumer under load, back-pressure, graceful degradation).

- **Don't spend time on:** Detailed storage layer design (time-series DB internals), dashboard UI architecture, or CI/CD for eBPF programs. These are important in practice but not what makes this system design unique.

---

## Trade-offs Discussion

### Trade-off 1: In-Kernel Filtering vs. User-Space Filtering

| Decision | In-Kernel Filtering | User-Space Filtering |
|----------|---------------------|---------------------|
| | **Pros:** 10-100x volume reduction before crossing kernel boundary; sub-microsecond latency; no context switch overhead | **Pros:** Arbitrary filtering logic; no verifier constraints; easier to update rules dynamically |
| | **Cons:** Limited by verifier (no unbounded loops, 512B stack); harder to debug; requires kernel programming expertise | **Cons:** Full event volume crosses kernel-user boundary; high CPU/memory overhead; context switch per event |
| **Recommendation** | In-kernel for volume reduction (drop uninteresting events early); user-space for complex correlation and behavioral analysis |

### Trade-off 2: Ring Buffer vs. Perf Buffer

| Decision | Ring Buffer (BPF_MAP_TYPE_RINGBUF) | Perf Buffer (BPF_MAP_TYPE_PERF_EVENT_ARRAY) |
|----------|-----------------------------------|---------------------------------------------|
| | **Pros:** Single shared buffer (memory efficient); global event ordering; 7% overhead on 32-core systems; reserve-commit API prevents torn reads | **Pros:** Available on older kernels (4.x+); per-CPU isolation eliminates cross-CPU contention; simpler programming model |
| | **Cons:** Requires kernel 5.8+; cross-CPU CAS contention under extreme load; single consumer | **Cons:** N × buffer_size memory; events out-of-order across CPUs; 35% overhead on 32-core systems |
| **Recommendation** | Ring buffer as primary path; perf buffer as fallback for pre-5.8 kernels |

### Trade-off 3: CO-RE vs. Per-Kernel Compilation

| Decision | CO-RE (Compile Once – Run Everywhere) | Per-Kernel Compilation (BCC-style) |
|----------|----------------------------------------|-------------------------------------|
| | **Pros:** Single binary for all kernel versions; no kernel headers needed at runtime; sub-second load time | **Pros:** Works on any kernel (even without BTF); can use kernel-version-specific features; runtime-generated code can optimize for specific kernel |
| | **Cons:** Requires BTF-enabled kernel (5.2+, ~95% of modern production kernels); CO-RE relocations may not cover all struct layout changes | **Cons:** Requires kernel headers on every node; compilation takes seconds (slow startup); LLVM/Clang dependency at runtime |
| **Recommendation** | CO-RE as primary path with pre-compiled fallback binaries for known non-BTF kernels |

### Trade-off 4: Synchronous Enforcement vs. Asynchronous Detection

| Decision | Synchronous (LSM hooks) | Asynchronous (Event streaming) |
|----------|--------------------------|-------------------------------|
| | **Pros:** Prevents the operation before it completes; no recovery needed; <10μs latency | **Pros:** Complex behavioral analysis; ML-based anomaly detection; no risk of false-positive blocking |
| | **Cons:** False positives block legitimate operations (operational risk); limited policy complexity (verifier constraints); can kill processes | **Cons:** Operation already completed when detected; can only alert, not prevent; 10-100ms delay |
| **Recommendation** | Synchronous for high-confidence, simple policies (known bad binaries, namespace violations); asynchronous for complex behavioral patterns |

### Trade-off 5: Full Event Capture vs. Sampling

| Decision | Full Capture | Statistical Sampling |
|----------|-------------|---------------------|
| | **Pros:** Complete visibility; no sampling bias; every event available for forensics | **Pros:** Dramatically lower overhead; predictable resource usage; sufficient for statistical analysis |
| | **Cons:** Enormous data volume (500K-2M events/sec/node); expensive storage; higher CPU overhead | **Cons:** Rare events may be missed; tail latency analysis less accurate; forensic analysis limited |
| **Recommendation** | Full capture with in-kernel filtering (drop uninteresting events) for network/syscall events; full capture without sampling for security events; configurable head-based sampling for traces |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|----------------------|-------------|
| "Why not just use OpenTelemetry SDK instrumentation instead of eBPF?" | Understand when eBPF adds value vs. traditional APM | "OTel SDK gives richer application-level context (business metrics, custom spans), but requires code changes in every service. eBPF provides a baseline of network, syscall, and profiling data for ALL services — including third-party, legacy, and infrastructure components — without any code changes. The ideal is both: eBPF for universal baseline, OTel SDK for application-specific enrichment." |
| "eBPF adds overhead to every syscall — isn't that dangerous in production?" | Test understanding of eBPF overhead characteristics | "The verifier guarantees programs terminate and don't corrupt kernel state, so they're safe. Overhead is typically <1% CPU: each eBPF program runs in ~100-500ns, and not all syscalls trigger eBPF programs (only attached hooks). The key insight is that in-kernel filtering means you pay the capture cost once but avoid the much larger cost of sending millions of events to user space. Netflix, Meta, and Cloudflare run eBPF in production on every server." |
| "What if the kernel version doesn't support eBPF?" | Test awareness of compatibility challenges | "Three-tier approach: (1) CO-RE programs for BTF-enabled kernels (5.2+, ~95% of production), (2) pre-compiled fallback binaries for specific known kernels without BTF, (3) minimal program suite for very old kernels (4.15+) with basic tracing only. The agent probes kernel features at startup and loads the most capable program suite available. In the worst case, the agent runs in passive mode — no eBPF, just log/metric forwarding." |
| "Can eBPF see inside encrypted (TLS) traffic?" | Test nuanced understanding of eBPF capabilities | "eBPF cannot decrypt TLS — it doesn't have access to TLS keys. But there are two approaches to observe encrypted traffic: (1) Hook into the crypto library (OpenSSL, BoringSSL) via uprobes at the point where plaintext is handed to the library for encryption, or received after decryption. This captures the plaintext without breaking TLS. (2) For kTLS (kernel TLS), hook at the sendmsg/recvmsg level where the kernel handles encryption. Both approaches work without application code changes, but they're library-specific and require knowing which crypto library the application uses." |
| "How do you handle a noisy neighbor pod generating millions of events?" | Test understanding of resource isolation in shared kernel space | "Per-cgroup rate limiting in eBPF. Each eBPF program checks a per-cgroup counter before emitting events. If a pod exceeds its event budget (e.g., 10K events/sec), additional events are dropped at the kernel level — they never reach the ring buffer or user space. The drop counter is always incremented, so the noisy pod's suppression is itself observable. This is the bulkhead pattern applied at the kernel level." |
| "What happens if your eBPF agent crashes?" | Test understanding of the kernel/user-space split | "This is where eBPF's architecture shines. eBPF programs and maps are pinned to the BPF filesystem. When the agent crashes, the eBPF programs continue running in the kernel, writing events to the ring buffer. The ring buffer accumulates events. When the agent restarts (typically <10 seconds as a DaemonSet), it re-attaches to the pinned programs and ring buffers, and drains the accumulated events. There's no observability gap — just a brief delay in event delivery. Security enforcement also continues uninterrupted because the policy maps and LSM programs persist." |

---

## Common Mistakes to Avoid

1. **Treating eBPF as "just a library"** — eBPF is not a library you call from your code; it's a program you load into the kernel that runs independently. The agent and the eBPF program have separate lifecycles, separate failure modes, and communicate only through maps and ring buffers.

2. **Ignoring the verifier** — Designing a protocol parser or policy engine without considering verifier constraints leads to programs that look correct but cannot be loaded. The verifier must be treated as a first-class architectural constraint, not an afterthought.

3. **Assuming all kernels are equal** — A design that works on kernel 6.1 may fail on kernel 5.4. CO-RE helps, but feature probing and graduated program suites are essential for production deployments across heterogeneous kernel fleets.

4. **Conflating "no code changes" with "no overhead"** — eBPF adds CPU overhead (typically <1%, but real). It adds memory overhead (maps, ring buffers). It adds complexity (verifier errors, kernel compatibility). The value proposition is not "free monitoring" — it's "monitoring without application code changes."

5. **Designing a flat collector** — At 1,000+ nodes, a single collector tier creates a fan-in Slowest part of the process. Hierarchical collection (node → regional → central) is essential for scalability.

6. **Forgetting the meta-observability problem** — If the observability platform goes down, who observes the outage? The platform must have a self-monitoring path that is independent of its primary event pipeline.

7. **Over-indexing on security enforcement** — eBPF can block processes, deny syscalls, and kill containers. But false-positive enforcement in production is catastrophic. Start with detection-only policies; promote to enforcement only after high confidence is established.

---

## Questions to Ask Interviewer

| Question | Why It Matters |
|----------|----------------|
| What's the expected cluster size? (100 nodes vs. 10,000 nodes) | Determines collector architecture (flat vs. hierarchical) and storage strategy |
| Which kernel versions are in production? | Determines CO-RE vs. fallback strategy, available eBPF features |
| Is security enforcement in scope, or just observability? | Dramatically changes the risk profile and complexity (enforcement has higher blast radius) |
| What protocols does the application fleet use? (HTTP/1, HTTP/2, gRPC, custom) | Determines protocol parser complexity and verifier constraints |
| Is TLS termination at the load balancer or in-pod? | Determines whether TC hooks see plaintext or encrypted traffic |
| What's the existing observability stack? (Prometheus, Jaeger, etc.) | eBPF platform should complement, not replace, existing instrumentation |
| What's the tolerance for event loss under extreme load? | Determines ring buffer sizing and sampling strategy |

---

## Estimation Questions

### GPU/Compute Estimation

**Q: How many collector instances do you need for a 5,000-node cluster?**

```
Given:
  - 5,000 nodes, 50K events/sec/node (post-filter)
  - Total: 250M events/sec
  - Collector capacity: 500K events/sec/instance
  - Regional collectors (50 nodes each): 100 regional instances
  - Central collectors (aggregate from regionals): 20 instances
  - With 2x headroom: 200 regional + 40 central = 240 total
  - CPU per instance: 8 cores → 240 × 8 = 1,920 cores for collection tier
```

### Storage Estimation

**Q: What's the 30-day storage cost for metrics, traces, and profiles?**

```
Metrics:
  - 5,000 nodes × 1,000 series/node = 5M active series
  - 16 bytes/point × 1 point/15s × 86,400s × 30 days = 276 TB (raw)
  - With 3-day hot (full) + 27-day warm (1m downsampled): ~50 TB

Traces:
  - 500K RPS × 1% sampling × 2KB/span × 3 spans/trace × 86,400s × 30 days = 2.2 PB (raw)
  - With 7-day hot + 23-day compressed warm + aggressive TTL: ~300 TB

Profiles:
  - 5,000 nodes × 6 profiles/min × 10KB × 43,200 min = 12.6 TB (raw)
  - With stack dedup (100:1): ~126 GB → compressed: ~50 GB

Total: ~350 TB with tiered storage and compression
```

---

## Advanced Discussion Topics

### Topic 1: eBPF vs. Sidecar Proxy for Service Mesh Observability

**Discussion prompt:** "Many service meshes use sidecar proxies (Envoy) for L7 observability. Cilium is replacing this with eBPF. What are the trade-offs?"

**Expected answer depth:**

| Dimension | Sidecar Proxy | eBPF |
|-----------|---------------|------|
| **Deployment** | Per-pod sidecar (injected via mutating webhook) | Per-node DaemonSet (kernel-level) |
| **Resource overhead** | ~50 MB memory + ~50m CPU per pod | ~512 MB + 500m CPU per node (shared across all pods) |
| **L7 parsing** | Full protocol parsing in user space (unlimited complexity) | Bounded parsing in kernel (verifier-constrained) |
| **Latency** | +1-2ms per request (proxy hop) | ~0 added latency (passive observation, no proxy hop) |
| **TLS handling** | Terminate + re-encrypt (full L7 access) | Must hook crypto library (uprobe) or observe plaintext at socket layer |
| **Total cluster overhead** | 50K pods × 50 MB = 2.5 TB memory | 1K nodes × 512 MB = 512 GB memory |

**Strong candidate answer:** "The sidecar model gives richer L7 data and easier TLS handling, but at 5x+ the resource cost. eBPF is better for baseline observability (RED metrics, dependency maps) with near-zero overhead. The ideal architecture uses eBPF for universal baseline and targeted sidecar injection only for services needing advanced traffic management (retries, circuit breaking, header manipulation)."

### Topic 2: In-Kernel ML Inference for Security

**Discussion prompt:** "Could you run ML-based anomaly detection directly in eBPF programs?"

**Expected answer depth:** "In theory, yes — eBPF supports bounded loops and per-CPU arrays that could implement a simple decision tree or lookup table. In practice, the verifier constraints make real ML impractical in-kernel: no floating point (integer arithmetic only), 512-byte stack (no large weight matrices), no dynamic memory allocation. The practical approach is to run simple threshold-based classifiers in-kernel (binary feature matching) and route interesting events to user-space for ML inference. Recent research (BPF-ML) has demonstrated simple neural network inference in eBPF, but it's limited to very small models (<100 parameters) and adds significant per-event CPU overhead."

### Topic 3: eBPF Program Hot-Patching

**Discussion prompt:** "How do you update eBPF programs on a running system without losing events?"

**Expected answer depth:** "Three approaches with different trade-offs: (1) **Atomic program replacement:** Use `bpf_link_update()` to atomically swap the eBPF program attached to a hook. The old program continues executing for any in-flight invocations; new invocations use the new program. Zero event loss, but requires the new program to be compatible with existing map layouts. (2) **Tail call array update:** Replace entries in the tail call program array. Each entry is updated atomically. Programs currently executing the old tail call chain complete with the old code; new invocations use the new chain. (3) **Rolling DaemonSet update:** Restart agents one node at a time. During restart, eBPF programs and ring buffers persist (pinned to BPF filesystem). Events accumulate in the ring buffer during the ~10 second restart window. This is the simplest approach but briefly pauses event delivery."

---

## Expanded Trap Questions

### Trap: "eBPF is just kprobes with a nicer API, right?"

**What the interviewer is testing:** Whether the candidate understands the breadth of eBPF beyond kernel tracing.

**Strong answer:** "Kprobes are one of ~30 eBPF program types. eBPF also provides: XDP for packet processing at the NIC driver level (before the kernel networking stack), TC hooks for traffic control, LSM hooks for security enforcement, cgroup hooks for resource accounting, fentry/fexit for zero-overhead function tracing, and perf_events for CPU profiling. The key innovation is not 'nicer kprobes' but a general-purpose in-kernel virtual machine with a safety verifier, JIT compiler, and a rich set of data structures (maps) for kernel-user communication."

### Trap: "Just use a bigger ring buffer to avoid event loss"

**What the interviewer is testing:** Understanding that memory is finite and the real solution is adaptive behavior, not brute-force sizing.

**Strong answer:** "Increasing the ring buffer helps with short bursts but doesn't solve sustained overload — you'd need an infinitely large buffer for an unbounded event stream. The correct approach is adaptive sampling: use the ring buffer fill level as a control signal to dynamically reduce event volume in-kernel. Security events are never sampled; non-critical events are sampled proportionally to pressure. This creates a bounded-resource system that degrades gracefully. Additionally, ring buffer memory is kernel memory — allocating too much can pressure the OOM killer to target application workloads."

### Trap: "Why can't you just use ptrace instead of eBPF?"

**What the interviewer is testing:** Understanding performance characteristics of kernel instrumentation mechanisms.

**Strong answer:** "ptrace stops the traced process for every event (PTRACE_SYSCALL intercepts require two context switches per syscall — one at entry, one at exit). On a process making 10K syscalls/sec, that's 20K forced context switches/sec, adding ~10ms overhead per second. eBPF runs synchronously in the kernel's execution path — no context switch, no process pause. The overhead is ~100ns per event vs. ~1-10μs per event with ptrace. Additionally, ptrace can only trace one process at a time per tracer; eBPF programs attached to kernel hooks observe ALL processes automatically."

---

## Red Flags

| Red Flag | What It Indicates |
|----------|------------------|
| "eBPF programs can do anything in kernel space" | Misunderstands verifier constraints; doesn't grasp the fundamental safety model |
| "Just capture all events and process them in user space" | Doesn't understand the kernel-user boundary cost; would produce a system with >10% CPU overhead |
| "Use a database to store connection state" | Confuses kernel-space and user-space programming; eBPF programs can only use eBPF maps, not external databases |
| "Deploy the eBPF agent as a sidecar container" | Misunderstands that eBPF programs run in the host kernel; per-pod sidecars cannot access each other's kernel events |
| "Use Docker exec to load eBPF programs" | Conflates container runtime with kernel programming; eBPF programs are loaded via bpf() syscall, not container exec |
| "The verifier is optional for production" | Dangerously wrong; the verifier is the ONLY safety mechanism preventing kernel crashes |
| "Just use BCC (Python-based) for production" | BCC requires kernel headers and runtime compilation; unsuitable for production at scale (CO-RE is the answer) |

---

## Detailed Scoring Rubric

| Phase | Points | Junior (L4-L5) | Senior (L6) | Staff (L7+) |
|-------|--------|-----------------|-------------|-------------|
| **Requirements (0-5 min)** | 10 | Lists basic observability requirements | Distinguishes enforcement vs. detection scope; asks about kernel version constraints | Probes for TLS termination location, protocol mix, existing instrumentation — each changes the architecture |
| **High-Level Design (5-15 min)** | 30 | Basic agent → collector pipeline | Three-layer architecture with kernel/user-space/cluster separation; identifies ring buffer as key data bridge | Component responsibility matrix; ADRs for ring buffer vs. perf buffer, CO-RE vs. BCC; discusses hierarchical collection |
| **Deep Dive (15-30 min)** | 40 | Knows eBPF runs in kernel | Explains verifier constraint propagation; designs ring buffer back-pressure; discusses protocol parsing bounds | Discusses tail call chaining for verifier limits; PI controller for adaptive sampling; connection tracking map contention under 1M ops/sec; BTF relocation failure modes |
| **Scale & Trade-offs (30-40 min)** | 15 | "Add more collectors" | Edge aggregation, per-cgroup rate limits, multi-region deployment | Capacity planning with concrete numbers; chaos engineering experiments; data lifecycle with tiered storage; ARM64 fleet considerations |
| **Wrap-up (40-45 min)** | 5 | Summarizes decisions | Acknowledges trade-offs clearly | Connects decisions to business impact; discusses observability platform market landscape |

### Follow-Up Questions for Strong Candidates

| Question | What It Tests | Expected Depth |
|----------|---------------|---------------|
| "How would you handle a fleet with 20% of nodes running non-BTF kernels?" | Pragmatic fallback strategy at scale | BTFHub archive; pre-compiled binaries for top-N kernel versions; accept degraded mode for long-tail; track and drive kernel upgrades |
| "Design the policy promotion lifecycle for a new security rule" | Operational maturity of enforcement | observe (shadow mode, no logs) → log (emit events, no alerts) → alert (fire alerts, no action) → enforce-staging → enforce-production; with automated rollback on false positive spike |
| "How would you add support for a new custom protocol (e.g., MQTT)?" | Understanding of the extensibility model | Write eBPF program with bounded MQTT parser; add to tail call chain after protocol classification; test against verifier across kernel matrix; add to graduated program suite |

---

## Estimation Walk-Through: Ring Buffer Sizing

**Prompt for candidate:** "Walk me through how you'd size the ring buffer for a node running 200 microservice pods."

**Expected calculation:**

```
Step 1: Estimate event rate
  - 200 pods × avg 100 RPS/pod = 20,000 HTTP requests/sec
  - Each request generates ~2 events (request + response)
  - Network events: 40,000/sec
  - Syscall events (post-filter): ~10,000/sec
  - Security events: ~100/sec
  - Profile samples: ~1,000/sec (19 Hz × ~50 active CPUs)
  - Total: ~51,100 events/sec

Step 2: Estimate event size
  - Network events: 256 bytes avg (5-tuple + L7 metadata)
  - Syscall events: 128 bytes avg
  - Security events: 512 bytes avg (includes binary path, args)
  - Profile samples: 64 bytes avg (pid + stack hash + count)

Step 3: Calculate throughput
  - Network: 40,000 × 256 = 10.2 MB/s
  - Syscall: 10,000 × 128 = 1.3 MB/s
  - Security: 100 × 512 = 0.05 MB/s
  - Profile: 1,000 × 64 = 0.06 MB/s
  - Total: ~11.6 MB/s

Step 4: Apply safety factor
  - Target drain interval: 2 seconds (how far ahead producer can be)
  - Safety factor: 4× (handle 4× burst over sustained rate)
  - Buffer size = 11.6 MB/s × 2s × 4 = 92.8 MB → round to 128 MB

Step 5: Split across ring buffers
  - Network ring buffer: 64 MB
  - Syscall ring buffer: 32 MB
  - Security ring buffer: 16 MB (smaller but never sampled)
  - Profile ring buffer: 16 MB
  - Total: 128 MB
```

**Strong answer identifies:** (1) The safety factor accounts for burst traffic, (2) security events get a separate ring buffer despite low volume to guarantee delivery, (3) ring buffer size is a power of 2 for memory mapping efficiency.

| Dimension | Junior (L4-L5) | Senior (L6) | Staff (L7+) |
|-----------|-----------------|-------------|-------------|
| **Architecture** | Describes eBPF at a high level; basic agent → collector pipeline | Three-layer architecture with kernel/user-space/cluster separation; ring buffer as data bridge | Discusses verifier as architectural constraint; CO-RE portability; hierarchical collection |
| **Deep Dive** | Knows eBPF programs run in kernel | Explains verifier purpose, map types, ring buffer vs. perf buffer | Discusses verifier instruction limits, tail call chaining, bounded loop idioms, protocol parsing under verifier constraints |
| **Scalability** | "Add more collectors" | Per-node filtering, edge aggregation, ring buffer sizing | Adaptive sampling, per-cgroup rate limits, hierarchical collection with regional aggregation, NUMA-aware ring buffer selection |
| **Security** | "eBPF runs as root" | CAP_BPF separation, unprivileged BPF disabled | BPF token signing, JIT hardening, enforcement vs. detection trade-off, verifier CVE awareness |
| **Trade-offs** | Identifies one trade-off | Discusses 2-3 with clear recommendations | Frames each decision with specific numbers (overhead %, latency, kernel version requirements) and explains when each side of the trade-off wins |
| **Failure Handling** | "Restart the agent" | Agent crash recovery via BPF pinning; ring buffer accumulates events | WAL-backed local buffer; security event priority channel; graceful degradation matrix (full → reduced → minimal → passive) |
