# Requirements & Estimations — eBPF-based Observability Platform

## Functional Requirements

### Core Features

1. **Zero-Instrumentation Telemetry Collection** — Capture metrics, traces, and logs from kernel events (syscalls, network packets, file I/O, process lifecycle) without modifying application code, container images, or deployment manifests.

2. **Protocol-Aware L7 Observability** — Parse application-layer protocols (HTTP/1.1, HTTP/2, gRPC, DNS, Kafka, MySQL, PostgreSQL, Redis) directly in kernel space to extract request/response metadata (status codes, latencies, payload sizes) without decrypting TLS at the application layer.

3. **Continuous Profiling** — Sample CPU stack traces at configurable intervals (default: 19 Hz per logical CPU) and aggregate into flame graphs for on-demand and historical analysis. Support for on-CPU, off-CPU, memory allocation, and lock contention profiling.

4. **Network Flow Observability** — Track L3/L4 connections with full Kubernetes identity resolution (pod, service, namespace, labels) for network policy visibility, dependency mapping, and anomaly detection.

5. **Security Event Detection** — Monitor process execution, file access, network connections, and capability usage against configurable policy rules. Support both detection (alert-only) and enforcement (kill, signal, override) modes.

6. **Runtime Enforcement** — Execute synchronous policy decisions in-kernel (via LSM hooks and Tetragon-style TracingPolicy) to block unauthorized operations before they complete, without round-tripping to user space.

7. **Kubernetes-Native Identity** — Enrich all events with Kubernetes metadata (pod name, namespace, labels, service account, node) using cgroup-to-pod mapping maintained in eBPF maps.

8. **Distributed Trace Correlation** — Extract trace context (W3C Trace Context, B3 headers) from L7 protocol parsing to stitch service-to-service request flows without requiring application-side trace propagation libraries.

### Out of Scope

- Application Performance Management (APM) with code-level instrumentation (bytecode injection, monkey-patching)
- Log content parsing and structured extraction (the platform captures syscall-level I/O, not log semantics)
- Long-term storage and analytics (the platform produces telemetry; downstream systems like time-series databases and object storage handle retention)
- Windows or non-Linux kernel support
- eBPF program development IDE or authoring tools

---

## Non-Functional Requirements

### CAP Theorem Position

**AP (Availability + Partition Tolerance)** — Observability data is inherently tolerant of eventual consistency. A node's eBPF programs must continue capturing events even if the central collector is unreachable. Local buffering with best-effort delivery is acceptable; losing 0.1% of events during a network partition is vastly preferable to blocking application workloads.

### Consistency Model

**Eventual Consistency** — Telemetry events are append-only and immutable. Events captured on different nodes may arrive at the collector out of order; the processing pipeline reorders by timestamp within a configurable window (default: 30 seconds). Kubernetes identity enrichment uses locally-cached metadata with eventual consistency from the API server.

### Availability Target

| Component | Target | Rationale |
|-----------|--------|-----------|
| eBPF data plane (in-kernel) | 99.999% | Must never crash the kernel; verifier guarantees safety |
| User-space agent (per-node) | 99.95% | Agent restarts recover within seconds; eBPF programs persist in kernel |
| Central collector | 99.9% | Temporary unavailability causes local buffering, not data loss |
| Query/dashboard layer | 99.9% | Standard web service availability |

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| eBPF event capture (kernel → ring buffer) | <1μs | <5μs | <10μs |
| Event delivery (kernel → user-space agent) | <100μs | <500μs | <1ms |
| End-to-end (event → queryable in dashboard) | <5s | <15s | <30s |
| Profile query (flame graph render) | <500ms | <2s | <5s |
| Security policy enforcement (in-kernel decision) | <1μs | <5μs | <10μs |

### Durability Guarantees

- eBPF events in the ring buffer: best-effort (may be dropped under extreme load with counter tracking)
- Events delivered to user-space agent: at-least-once (WAL-backed local buffer)
- Events forwarded to central collector: at-least-once with idempotent deduplication
- Security audit events: guaranteed delivery with separate high-priority channel

---

## Capacity Estimations (Back-of-Envelope)

**Reference deployment:** 1,000 Kubernetes nodes, 50,000 pods, 200 microservices, 500K RPS aggregate.

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Raw kernel events/sec/node | 500K–2M | ~10K syscalls/sec/pod × 50 pods/node + network events |
| Post-filter events/sec/node | 5K–50K | In-kernel filtering reduces volume 10-100x (only interesting events pass) |
| Aggregate events/sec (cluster) | 5M–50M | 1,000 nodes × 5K–50K filtered events/node |
| Network flows/sec (cluster) | 2M | ~40 connections/sec/pod × 50K pods |
| Profile samples/sec (cluster) | 19M | 19 Hz × 1,000 nodes × ~1,000 logical CPUs total |
| Per-node agent memory | 200–500 MB | Ring buffer (64 MB) + map cache (128 MB) + processing buffers |
| Per-node eBPF map memory | 50–200 MB | Connection tracking maps + pid-to-pod maps + policy maps |
| Event bandwidth (per node → collector) | 5–50 MB/s | 50K events/sec × 100–1000 bytes/event (after compression) |
| Aggregate bandwidth (cluster → collector) | 5–50 GB/s | 1,000 nodes × 5–50 MB/s |
| Storage (1 day, post-aggregation) | 50–200 TB | Aggregated metrics + sampled traces + security events |
| Storage (30 days, tiered) | 200–500 TB | Hot tier (3 days) + warm tier (27 days, compressed) |
| Profile storage (30 days) | 10–30 TB | Compressed pprof-format profiles |

---

## SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Event capture overhead (CPU) | <1% per node | Measured via bpftop; eBPF program execution time ÷ wall clock time |
| Event capture overhead (latency) | <5μs p99 added to syscall | Kernel tracepoint overhead measurement |
| Event delivery completeness | >99.9% | Delivered events ÷ captured events (tracked via per-program counters) |
| Security enforcement latency | <10μs p99 | Time from hook entry to policy decision (measured in-kernel) |
| End-to-end dashboard freshness | <30s p99 | Timestamp of most recent event visible in query |
| Profile availability | >99.5% | Percentage of time windows with profile data available |
| Kernel compatibility | >95% of deployed kernels | Percentage of production kernel versions where all eBPF programs load successfully |
| Agent restart recovery | <10s | Time from agent crash to full event capture resumption |

---

## Constraints Unique to eBPF

### Verifier Constraints

| Constraint | Limit | Impact |
|------------|-------|--------|
| Instruction count | 1M verified instructions (kernel ≥5.2) | Complex protocol parsers may need to be split into multiple programs chained via tail calls |
| Stack size | 512 bytes | No recursive algorithms; all state must use maps or per-CPU arrays |
| Loop bounds | Must be provably bounded | Loops require `#pragma unroll` or explicit bounds; no while(true) patterns |
| Memory access | Must be bounds-checked | Every pointer dereference requires explicit null/bounds checks that the verifier can track |
| Helper functions | Allowlisted per program type | Not all map types and helpers are available in all contexts (e.g., no `bpf_probe_read` in XDP) |

### Kernel Version Matrix

| Feature | Minimum Kernel | Notes |
|---------|---------------|-------|
| Basic kprobes/tracepoints | 4.15 | Sufficient for basic syscall tracing |
| BTF support | 5.2 | Required for CO-RE portability |
| Ring buffer | 5.8 | Preferred over perf buffer for event streaming |
| LSM hooks | 5.7 | Required for security enforcement |
| Bloom filter map | 5.16 | Useful for high-performance set membership |
| User ring buffer | 6.1 | Enables user-space → kernel communication |
| BPF arena | 6.9 | Shared memory between BPF programs and user space |

---

## SLO Error Budgets

| SLO | Target | Error Budget (30 days) | Escalation Policy |
|-----|--------|----------------------|-------------------|
| Event capture overhead <1% CPU | 99.9% of 1-min windows | 43 minutes of >1% overhead | P3 → engineering if >10 min sustained |
| Event delivery completeness >99.9% | 99.9% per hour | 43 seconds of <99.9% delivery per 30 days | P2 → on-call if sustained >5 min |
| Security enforcement latency <10μs p99 | 99.99% | 4.3 minutes of >10μs p99 | P1 → immediate page (security policy gap) |
| Dashboard freshness <30s p99 | 99.5% | 3.6 hours | P3 → engineering if >30 min |
| Agent restart recovery <10s | 99.95% | 21.6 minutes | P2 → on-call if >30s recovery observed |
| Kernel compatibility >95% | 95% of fleet | 5% of nodes in degraded mode | P3 → track in quarterly planning |
| Profile availability >99.5% | 99.5% of time windows | 3.6 hours of missing profiles | P4 → low priority (regenerable) |

### Error Budget Burn Rate Alerting

```
Fast burn:  >14.4× burn rate for 1 hour  → 2% of 30-day budget consumed in 1 hour → PAGE
Slow burn:  >6× burn rate for 6 hours    → 5% of 30-day budget consumed in 6 hours → TICKET
Normal:     <1× burn rate                → HEALTHY
```

---

## Bandwidth & Throughput Estimates

| Path | Direction | Bandwidth | Calculation |
|------|-----------|-----------|-------------|
| Kernel → ring buffer (per node) | In-kernel | 100-500 MB/s | 50K events × 2KB avg pre-filter event size (most filtered in-kernel) |
| Ring buffer → agent (per node) | Shared memory | 12-125 MB/s | 50K events × 256 bytes post-filter avg |
| Agent → regional collector (per node) | gRPC + TLS | 1-10 MB/s | Post-aggregation; RED metrics + sampled traces + security events |
| Regional → central collector (per region) | gRPC + TLS | 0.5-5 GB/s | 250-500 nodes per region |
| Collector → TSDB (write) | Storage protocol | 200 MB/s | 1M series × 16 bytes × 1 write/15s |
| Collector → trace store (write) | Storage protocol | 1-5 GB/s | 5K traces/sec × 10 spans × 2KB |
| Dashboard → query engine (read) | HTTPS | 10-50 MB/s | 100 concurrent users × 10 panels × 10-50 KB/panel |

---

## Hardware Infrastructure Estimates

### Per-Node Resources (Agent + eBPF)

| Resource | Allocation | Rationale |
|----------|-----------|-----------|
| CPU | 500m (0.5 cores) | Ring buffer consumption + enrichment + gRPC streaming |
| Memory | 512 MB | Ring buffers (256 MB) + map cache (44 MB) + WAL (100 MB) + processing (64 MB) |
| eBPF map memory (kernel) | 50-200 MB | Connection tracking (32 MB) + pod mapping (8 MB) + policy (4 MB) + per-CPU arrays |
| Disk (WAL) | 1 GB reserved | Local buffering during collector outage (1 hour at 10 MB/min) |
| Network | 10 Mbps sustained, 100 Mbps burst | Agent → collector streaming |

### Collector Cluster (per 1,000 nodes)

| Resource | Per Instance | Instances | Total |
|----------|-------------|-----------|-------|
| CPU | 8 cores | 10 (regional) + 5 (central) | 120 cores |
| Memory | 4 GB | 15 | 60 GB |
| Network | 1 Gbps | 15 | 15 Gbps aggregate |
| SSD (buffer) | 50 GB | 15 | 750 GB |

### Storage Backend (per 1,000 nodes, 30-day retention)

| Store | Storage | IOPS | Bandwidth |
|-------|---------|------|-----------|
| Time-series DB (hot: 3 days) | 300 GB | 50K writes/sec | 200 MB/s write |
| Time-series DB (warm: 27 days) | 2 TB | 5K reads/sec | 100 MB/s read |
| Trace store (hot: 7 days) | 6 TB | 20K writes/sec | 1 GB/s write |
| Trace store (warm: 23 days) | 15 TB | 2K reads/sec | 200 MB/s read |
| Profile store (30 days) | 3 TB | 5K writes/sec | 100 MB/s write |
| Security audit log (30 days) | 3 GB | 1K writes/sec | 10 MB/s write |

---

## Cost Optimization Levers

| Lever | Savings | Trade-off |
|-------|---------|-----------|
| **Increase in-kernel filtering** | 50-80% reduction in collector + storage cost | More complex eBPF programs; verifier risk |
| **Aggressive trace sampling** | 90%+ reduction in trace storage | Tail latency analysis less accurate; rare errors may be missed |
| **Metric downsampling** | 60% storage savings (1m vs 15s) | Reduced resolution for historical analysis |
| **Edge aggregation** | 80% bandwidth reduction | Raw events unavailable for forensics (unless separately sampled) |
| **Profile deduplication** | 90-99% profile storage reduction | CPU for dedup computation; dedup ratio depends on workload diversity |
| **Ring buffer right-sizing** | Reduce per-node memory overhead | Risk of event loss during bursts if undersized |
| **Regional storage** | Avoid cross-region replication cost for non-critical data | Regional queries only; cross-region queries require federation |

---

## Unit Economics Analysis

### Cost Per Observed Node Per Month

```
Infrastructure cost model (1,000-node cluster):

  Agent overhead per node:
    CPU: 0.5 cores × $0.04/core-hour × 720 hours       = $14.40/node/month
    Memory: 512 MB (user-space) + 200 MB (kernel maps)
            0.7 GB × $0.005/GB-hour × 720 hours          = $2.52/node/month
    Agent subtotal:                                       = $16.92/node/month

  Collection tier (shared across 1,000 nodes):
    15 collector instances × 8 cores × $0.04/core-hour × 720 = $3,456/month
    Per node:                                              = $3.46/node/month

  Storage (30-day retention, per node share):
    Metrics: 0.3 TB × $0.10/GB                            = $30/node/month
    Traces: 0.9 TB × $0.05/GB (warm storage)              = $45/node/month
    Profiles: 0.05 TB × $0.10/GB                          = $5/node/month
    Security: 0.003 TB × $0.20/GB (replicated)             = $0.60/node/month
    Storage subtotal:                                      = $80.60/node/month

  Total cost per observed node:                            ≈ $101/node/month

  Comparison:
    Traditional APM (agent + SDK instrumentation):        $120-200/node/month
    eBPF platform (zero-instrumentation):                 $101/node/month
    Savings:                                              15-50%
    + eliminates developer time for SDK integration
```

### Scaling Breakpoints

| Cluster Size | Architecture | Key Cost Driver | Cost/Node/Month |
|-------------|-------------|----------------|-----------------|
| <100 nodes | Flat collector (3 instances) | Storage | ~$130 (fixed costs amortized over fewer nodes) |
| 100-1,000 nodes | Regional + central collectors | Collection tier + storage | ~$101 |
| 1,000-10,000 nodes | Multi-region, hierarchical | Storage + cross-region replication | ~$85 (edge aggregation reduces storage) |
| >10,000 nodes | Federated, per-region autonomous | Operational complexity | ~$75 (maximum economy of scale) |
