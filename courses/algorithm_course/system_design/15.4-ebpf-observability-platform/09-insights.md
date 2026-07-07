# Insights — eBPF-based Observability Platform

## Insight 1: The Verifier Is Not a Safety Net — It Is the Architect That Shapes Every Design Decision

**Category:** System Modeling

**One-liner:** Unlike traditional systems where you design the architecture and then implement it, eBPF-based systems must design their architecture around what the kernel verifier will accept — making the verifier the de facto architect of the system.

**Why it matters:** In conventional software, you design a protocol parser with while loops, dynamic allocation, and recursive descent, then optimize later. In eBPF, this approach produces programs that the verifier categorically rejects. The instruction limit (1M verified instructions across all paths), stack size cap (512 bytes), mandatory bounded loops, and NULL-check requirements after every map lookup are not bugs to work around — they are architectural constraints that force fundamentally different designs. Protocol parsers must use fixed-bound unrolled loops. Complex policy evaluations must be decomposed into chains of smaller programs linked by tail calls (max 33 hops). Large state must live in maps rather than on the stack. This constraint propagation is so pervasive that experienced eBPF architects think "verifier-first": they design the data flow and program decomposition to satisfy verifier limits, then fill in the logic. The practical implication for system design interviews is that any candidate who designs an eBPF platform without discussing verifier constraints is designing a system that cannot be built.

---

## Insight 2: In-Kernel Filtering Inverts the Traditional Observability Cost Model — You Pay for What You Don't Collect, Not What You Do

**Category:** Cost Optimization

**One-liner:** Traditional observability charges per-byte ingested and stored; eBPF's in-kernel filtering means the expensive decision is choosing what to capture, and everything you filter out in the kernel costs approximately zero.

**Why it matters:** In a traditional agent-based observability pipeline (log shipper → collector → storage), cost scales linearly with the volume of data collected: every event is serialized, transmitted, indexed, and stored. Reducing cost means reducing collection, which means reducing visibility. eBPF inverts this model. The kernel generates millions of events per second regardless — syscalls, packets, scheduling events happen whether you observe them or not. The eBPF program's job is not to generate events but to filter the kernel's event stream, dropping 99% of events before they ever cross the kernel-user boundary. The cost of running an eBPF program on an event that gets filtered is ~100ns of CPU — negligible. The cost of NOT filtering (letting everything cross to user space) is catastrophic: context switches, memory copies, serialization, network transfer. This means the marginal cost of adding a new eBPF filter that captures an additional 0.1% of events is near-zero (the kernel already processes all events), while the marginal cost of the same expansion in a traditional system would be 0.1% more storage, bandwidth, and processing. The design implication is that eBPF systems should default to "capture everything, filter aggressively" rather than the traditional "opt-in to what you want to observe."

---

## Insight 3: The Ring Buffer Is Not Just a Queue — Its Fill Level Is the System's Most Important Control Signal

**Category:** Back-Pressure

**One-liner:** The ring buffer's fill ratio is the single most actionable metric in the entire platform because it sits at the kernel-user boundary and simultaneously reflects upstream event rate, downstream processing capacity, and system health.

**Why it matters:** Most observability systems have multiple independent signals for different problems: CPU utilization for processing capacity, queue depth for throughput, error rates for correctness. The eBPF ring buffer uniquely collapses these into a single signal. When the ring buffer fill level rises above 50%, it means the user-space consumer is falling behind the kernel producer. But the cause could be any of: (1) an application burst generating more kernel events than normal, (2) the agent's consumer thread being CPU-starved by application workloads, (3) the collector being unreachable (agent buffering causes GC pressure slowing the consumer), or (4) a newly loaded eBPF program producing more events than expected. The ring buffer fill level is therefore both a symptom and a control input: the adaptive sampling algorithm uses it to dynamically adjust in-kernel filtering, creating a feedback loop where the kernel data plane self-regulates based on user-space capacity. This feedback loop is the platform's primary defense against cascade failure — and it operates entirely without human intervention or external coordination.

---

## Insight 4: eBPF Program Pinning Creates a Unique Split-Brain Lifecycle — The Data Plane Survives Control Plane Death

**Category:** Reliability

**One-liner:** When the user-space agent crashes, eBPF programs pinned to the BPF filesystem continue running in the kernel, capturing events and enforcing security policies — creating a data plane that is strictly more available than its control plane.

**Why it matters:** In every other observability and security system, the agent IS the system. If the Prometheus exporter crashes, metrics stop being collected. If the Falco user-space daemon crashes, security monitoring stops. eBPF breaks this coupling. Programs and maps pinned to `/sys/fs/bpf/` persist across agent restarts, kernel module unloads, and even container restarts (since the BPF filesystem is a kernel-level construct). This means: (1) Security enforcement continues during agent upgrades — no "enforcement gap" during rolling updates. (2) Events accumulate in the ring buffer during agent downtime and are consumed on restart — no "observation gap" (up to the ring buffer's capacity). (3) The agent's startup is fast (re-attach to existing programs) rather than cold (load, verify, JIT, attach all programs from scratch). The architectural implication is that the agent should be designed as a stateless controller that manages eBPF program lifecycle, not as a stateful component that IS the data pipeline. The data pipeline runs in kernel space and has a fundamentally different availability characteristic than the user-space agent.

---

## Insight 5: Protocol Parsing in eBPF Is Not a Miniature Application Parser — It Is a Probabilistic Classifier with Bounded Confidence

**Category:** Data Structures

**One-liner:** eBPF protocol parsers cannot perform complete protocol parsing (verifier constraints prevent it), so they function as probabilistic classifiers that identify protocols with high but imperfect confidence based on byte-pattern matching of the first N bytes.

**Why it matters:** A proper HTTP/1.1 parser handles chunked transfer encoding, pipeline requests, header continuation lines, and arbitrary header ordering. An eBPF "parser" reads the first 8 bytes, checks for "GET ", "POST", "PUT ", or "HTTP", and if matched, extracts the path using a bounded loop (max 128 bytes). This is not parsing — it's classification. The confidence level is high (>99.9% for HTTP/1.1) because HTTP request methods are highly distinctive, but it's not 100%. A binary protocol whose first 4 bytes happen to be 0x47455420 ("GET ") will be misclassified as HTTP. Similarly, HTTP/2 with HPACK-compressed headers and multiplexed streams cannot be fully parsed in eBPF — the platform extracts what it can (connection preface, frame types, stream IDs) and defers full parsing to user space. The design implication is that eBPF-based L7 observability must treat protocol identification as a classification problem with a confidence score, not a deterministic parsing result. Events with low confidence should be flagged for user-space re-evaluation, and metrics derived from eBPF protocol parsing should acknowledge a small error margin.

---

## Insight 6: The Cgroup-to-Pod Mapping Is the Platform's Most Fragile Dependency — And It Updates on a Different Clock Than the Kernel Events It Enriches

**Category:** Consistency

**One-liner:** eBPF programs identify workloads by cgroup ID (a kernel concept), but operators need pod names and namespaces (a Kubernetes concept) — and the mapping between these two identities is maintained by a user-space informer that may lag behind kernel events by 100-500ms.

**Why it matters:** When a new pod starts, the sequence is: (1) container runtime creates the cgroup and starts the process (kernel-level, immediate), (2) eBPF programs capture events from the new cgroup ID (kernel-level, within microseconds), (3) the kubelet registers the pod with the API server (control plane, 10-100ms later), (4) the agent's Kubernetes informer receives the pod event and updates the cgroup-to-pod map (user-space, 50-500ms later). During the gap between steps 2 and 4, events from the new pod carry a cgroup ID that has no corresponding pod identity. The agent must either: (a) drop these events (losing observability during pod startup), (b) store them with "unknown" identity and retroactively enrich them when the mapping arrives (complex, memory-intensive), or (c) accept that the first few hundred milliseconds of a pod's life are observed but not attributed. Option (c) is the pragmatic choice, but it creates a blind spot that is exactly when pods are most likely to exhibit interesting behavior (initialization, dependency checks, startup failures). The deeper issue is that this is not a solvable problem — it's a fundamental consequence of the kernel and Kubernetes operating on different clocks with different consistency models.

---

## Insight 7: Adaptive Sampling Under Load Is a Control Theory Problem Disguised as a Systems Engineering Decision

**Category:** Scaling

**One-liner:** The feedback loop between ring buffer fill level and in-kernel sampling rate is a classic proportional-integral (PI) controller, and tuning it incorrectly causes the same instability problems as any poorly-tuned control system — oscillation, overshoot, and steady-state error.

**Why it matters:** When the ring buffer reaches 75% full, the naive approach is to immediately drop 50% of events. This works for a steady-state overload but causes oscillation under bursty workloads: the buffer fills during a burst → sampling kicks in → buffer drains rapidly → sampling disengages → next burst fills the buffer again → repeat. The oscillation means the system alternates between "full visibility" and "half visibility" rather than converging to a stable sampling rate. The correct approach borrows from control theory: use a proportional term (sampling rate proportional to current fill level) plus an integral term (adjust baseline sampling rate based on the trend of fill level changes over the last N seconds). The proportional term reacts to immediate pressure; the integral term prevents steady-state error (chronic under-sampling or over-sampling). Additionally, the controller must have hysteresis: engage sampling at 75% fill but only disengage at 50% fill, preventing rapid on/off cycling at the threshold. The system design implication is that any eBPF platform that describes its sampling strategy as a simple threshold ("drop events when buffer is X% full") has not thought through the dynamics of bursty real-world workloads.

---

## Insight 8: Security Enforcement in eBPF Has an Asymmetric Blast Radius — A False-Positive Kill Is Worse Than Missing a True-Positive Detection

**Category:** Security

**One-liner:** When an eBPF-based security enforcer (LSM hook) kills a process or denies a syscall based on a policy match, the false-positive cost is an application outage; when it misses a true positive, the cost is a security alert arriving 10ms later via the detection path — making enforcement far riskier than detection.

**Why it matters:** The appeal of synchronous eBPF enforcement is undeniable: stop the attack before it succeeds, in-kernel, in microseconds. But the operational reality is that security policies are imperfect. A policy that blocks execution of any binary not in an allowlist sounds safe until a legitimate sidecar container starts a binary that wasn't in the allowlist because it was added in the latest image update that the security team hadn't reviewed yet. The LSM hook kills the process. The pod enters CrashLoopBackOff. The application experiences an outage caused by the security system that was supposed to protect it. The asymmetry is that a missed detection (false negative) results in an alert arriving via the asynchronous event pipeline 10-100ms later — still fast enough for human or automated response, and without application impact. A false-positive enforcement (kill/deny) causes immediate, visible, customer-impacting damage. The architectural implication is that enforcement policies should be promoted through a maturity lifecycle: observe-only → alert-only → enforce-in-staging → enforce-in-production — and that the enforce-in-production stage should only be reached after weeks of alert-only operation with zero false positives.

---

## Insight 9: The eBPF Observability Platform's True Competitive Moat Is Not Data Collection — It Is the Kernel-Side Data Reduction Ratio

**Category:** Architecture

**One-liner:** Every observability vendor can collect metrics and traces; the differentiating capability of eBPF is the 100-1000x data reduction that happens before events cross the kernel-user boundary, because this reduction determines the platform's overhead, cost, and scalability ceiling.

**Why it matters:** A kernel generates 500K-2M events per second per node (syscalls, packets, scheduling events). A traditional observability agent that captures even 10% of these events would need to process 50K-200K events/sec in user space — requiring significant CPU, memory, and network bandwidth. The eBPF platform's value is not that it captures these events (the kernel generates them regardless) but that it reduces them. In-kernel aggregation (count syscalls per PID rather than forwarding each syscall), in-kernel filtering (drop events from uninteresting pods), and in-kernel correlation (match HTTP request/response in the connection map and emit one event instead of two) reduce the volume by 100-1000x before the first byte crosses to user space. This reduction ratio is the platform's most important architectural metric: it determines per-node CPU overhead (<1% vs. 5-10%), bandwidth to the collector (5 MB/s vs. 500 MB/s), and storage cost ($X vs. $100X). Two eBPF platforms with identical user-space architectures but different kernel-side reduction ratios will have dramatically different operational characteristics. The design interview implication is that any discussion of eBPF observability that focuses on the user-space pipeline without discussing in-kernel data reduction has missed the platform's most important architectural property.

---

## Insight 10: The Tail Call Budget Is a Micro-Economy — Each Protocol Parser Competes for 33 Slots That Cannot Be Expanded

**Category:** Resource Management

**One-liner:** eBPF's tail call limit of 33 hops creates a fixed resource budget that every protocol parser, security evaluator, and event emitter must share — making tail call slot allocation a capacity planning problem analogous to port allocation.

**Why it matters:** When the platform supports 8 protocols (HTTP/1, HTTP/2, gRPC, DNS, Kafka, MySQL, PostgreSQL, Redis), each requiring 1-3 tail calls for parsing, the total consumption is 15-20 of the 33 available slots. Adding new protocol support (MQTT, AMQP, custom binary protocols) directly consumes from this finite budget. Unlike memory or CPU, the tail call limit cannot be increased by provisioning more hardware — it is a hard kernel constraint. The architectural implication is that the protocol detection program (the entry point that classifies traffic and routes to the appropriate parser) must be highly efficient: inline processing for simple protocols (HTTP/1, DNS can often be handled without a tail call) and reserve tail calls for complex protocols that genuinely require multi-program decomposition (HTTP/2 with HPACK, gRPC with protobuf framing). A platform that naively assigns one tail call per protocol will hit the ceiling at ~30 protocols; one that optimizes for inlining can support significantly more. The tail call budget must be a first-class concern in the protocol support roadmap, not a limit discovered when adding the 34th protocol fails.

---

## Insight 11: eBPF Map Memory Is Kernel Memory — Overallocation Starves Applications, Not the Observer

**Category:** Resource Isolation

**One-liner:** Unlike user-space memory where the agent's memory limit protects applications, eBPF map memory is allocated from the kernel's memory pool and counts against the system's total available memory — meaning map overallocation can trigger the OOM killer against application workloads, not the agent.

**Why it matters:** Container resource limits (cgroups) constrain user-space memory. The agent container's memory limit of 512 MB protects applications from agent memory leaks. But eBPF map memory (connection tracking maps, per-CPU arrays, ring buffers) is allocated via the kernel's `kmalloc` or `vmalloc`, outside of any cgroup's memory accounting. A 200 MB connection tracking map plus 256 MB of ring buffers consumes 456 MB of kernel memory that is invisible to Kubernetes resource accounting. If a node has 8 GB total memory, 1 GB for the kernel, and 7 GB for pods, the 456 MB of eBPF map memory effectively reduces available pod memory to 6.5 GB — but Kubernetes doesn't know this. Pods may be scheduled based on 7 GB available and then face OOM pressure because the eBPF platform has consumed kernel memory that the scheduler didn't account for. The mitigation is to (1) include eBPF map memory in node capacity planning, (2) set `RLIMIT_MEMLOCK` to cap the maximum locked memory per process, and (3) monitor `ebpf_map_memory_bytes` as a key capacity metric that feeds into cluster autoscaler decisions.

---

## Insight 12: The CO-RE Relocation Failure Is Silent and Data-Corrupting — Worse Than a Loud Crash

**Category:** Correctness

**One-liner:** When a CO-RE relocation encounters a struct field that has been renamed or removed in the target kernel, the relocation may succeed with the wrong offset rather than failing — causing the eBPF program to read garbage data from kernel structs, producing silently incorrect metrics.

**Why it matters:** CO-RE's promise is "compile once, run everywhere" — the ELF object contains relocation entries that map struct field accesses to the correct offsets based on the target kernel's BTF. This works perfectly when fields exist and have the same semantics across kernels. The dangerous case is when a kernel developer renames a field (e.g., `tcp_sock.srtt` becomes `tcp_sock.srtt_us` in a later kernel — same concept, different unit and name) or repurposes a field for a different use. If the BTF relocation finds a field at the expected offset that has a different semantic meaning, the program loads and runs successfully but reads the wrong data. A latency metric that reads `srtt` (in μs) when the kernel now stores `srtt_us` (in ns) would report latencies 1000x too low — a subtle bug that might not be caught for weeks. The mitigation is comprehensive integration testing across the target kernel matrix (not just "does the program load" but "does it produce correct output") and semantic validation of critical fields (if TCP RTT readings are <1μs on a WAN link, something is wrong). This is the eBPF equivalent of a silently corrupt data pipeline — the system appears healthy while producing incorrect results.
