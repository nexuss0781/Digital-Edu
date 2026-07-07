# Observability — eBPF-based Observability Platform

## The Meta-Challenge: Observing the Observer

An eBPF-based observability platform faces a unique recursive challenge: **it must monitor itself using the same mechanisms it provides to others, without creating infinite feedback loops.** If the observability platform's own agent generates events that are captured by its own eBPF programs, which generate more events, the system could spiral into unbounded self-observation.

### Self-Observation Architecture

```
Design Principle: Separate the "observation of others" path from the
"observation of self" path at the eBPF level.

Implementation:
  1. The agent's own PID/cgroup is registered in an "exclude" map
  2. All eBPF programs check this map first and skip events from the agent
  3. Agent self-metrics are emitted via a separate, lightweight channel
     (direct Prometheus exposition, not through the eBPF pipeline)
  4. Meta-monitoring uses a separate, minimal eBPF program that only
     tracks the agent's resource consumption (CPU, memory, FD count)
```

---

## Metrics (USE/RED)

### eBPF Data Plane Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `ebpf_program_run_count` | Counter (per program) | Number of times each eBPF program was triggered | N/A (informational) |
| `ebpf_program_run_duration_ns` | Histogram (per program) | Execution time of each eBPF program invocation | p99 >10μs for any program |
| `ebpf_program_errors_total` | Counter (per program) | Number of errors (helper call failures, map lookup misses) | >100/min for any program |
| `ebpf_map_entries_count` | Gauge (per map) | Current number of entries in each map | >90% of max_entries |
| `ebpf_map_memory_bytes` | Gauge (per map) | Memory consumed by each map | >80% of allocated budget |
| `ebpf_ringbuf_used_bytes` | Gauge | Current ring buffer fill level | >75% triggers adaptive sampling |
| `ebpf_ringbuf_dropped_events` | Counter | Events dropped due to ring buffer full | >0 for any 1-minute window |
| `ebpf_ringbuf_discarded_events` | Counter | Events intentionally discarded (adaptive sampling) | N/A (expected under load) |
| `ebpf_verifier_rejections` | Counter | Programs that failed verification | >0 indicates compatibility issue |

### Node Agent Metrics (USE)

| Category | Metric | Description | Alert Threshold |
|----------|--------|-------------|-----------------|
| **Utilization** | `agent_cpu_seconds_total` | CPU consumed by the agent process | >400m sustained (80% of 500m limit) |
| **Utilization** | `agent_memory_rss_bytes` | Resident memory of the agent | >400 MB (80% of 512 MB limit) |
| **Utilization** | `agent_open_fds` | Open file descriptors (BPF fds, sockets) | >80% of ulimit |
| **Saturation** | `agent_ringbuf_consumer_lag_events` | Events waiting in ring buffer | >10K events |
| **Saturation** | `agent_wal_buffer_bytes` | Bytes buffered in local WAL | >100 MB |
| **Saturation** | `agent_grpc_pending_bytes` | Bytes waiting to be sent to collector | >50 MB |
| **Errors** | `agent_event_processing_errors` | Events that failed enrichment or serialization | >10/min |
| **Errors** | `agent_collector_send_failures` | Failed gRPC send attempts | >5/min |
| **Errors** | `agent_k8s_watch_disconnects` | K8s API watch stream disconnections | >1/hour |

### Collector Metrics (RED)

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `collector_events_received_total` | Counter | Total events received from all agents | Rate drop >50% over 5 min |
| `collector_events_processed_total` | Counter | Events successfully written to storage | Rate divergence >5% from received |
| `collector_event_processing_duration` | Histogram | Time to process and store each event batch | p99 >2s |
| `collector_errors_total` | Counter (by error type) | Processing errors (deserialization, storage write) | >100/min |
| `collector_connected_agents` | Gauge | Number of agents with active gRPC streams | Drop >10% from expected |
| `collector_backpressure_signals` | Counter | Number of SLOW_DOWN/PAUSE signals sent | >10/min |

### Service-Level Metrics (RED for Observed Services)

| Metric | Description | Labels |
|--------|-------------|--------|
| `http_requests_total` | Total HTTP requests observed | source_service, dest_service, method, status_code |
| `http_request_duration_seconds` | Request latency | source_service, dest_service, method |
| `http_errors_total` | HTTP 4xx/5xx responses | source_service, dest_service, status_code |
| `dns_queries_total` | DNS queries observed | query_type, response_code |
| `dns_query_duration_seconds` | DNS resolution latency | query_type |
| `tcp_connections_total` | TCP connections established | source_service, dest_service |
| `tcp_connection_errors_total` | TCP connection failures (resets, timeouts) | source_service, dest_service, error_type |

### Dashboard Design

**Tier 1: Platform Health Dashboard (SRE)**
- eBPF program load status (per node, per program type)
- Ring buffer utilization heat map (nodes × time)
- Event throughput (events/sec, cluster-wide and per-node)
- Agent resource consumption (CPU, memory, across all nodes)
- Collector ingestion lag
- Kernel version distribution across the fleet

**Tier 2: Service Observability Dashboard (Developer)**
- Service dependency map (auto-discovered from network flows)
- Per-service RED metrics (rate, errors, duration)
- Top-N slowest endpoints
- DNS resolution performance
- Per-service flame graph (CPU profile)

**Tier 3: Security Dashboard (Security Operator)**
- Policy enforcement actions (allow/deny/kill timeline)
- Security event severity distribution
- Process execution anomalies
- Network policy violations
- File access audit trail

### Alerting Thresholds

#### Critical Alerts (Page-Worthy)

| Alert | Condition | Impact |
|-------|-----------|--------|
| `eBPFAgentDown` | No heartbeat from agent for >60s | Complete observability loss for that node |
| `RingBufferOverflow` | `ebpf_ringbuf_dropped_events` > 0 sustained for 5 min | Unrecoverable event loss |
| `SecurityEnforcementFailure` | Security program failed to load on a node | Security policy not enforced on that node |
| `CollectorIngestionStopped` | `collector_events_received_total` rate = 0 for 5 min | No new data flowing into the platform |
| `VerifierRejection` | Program failed verification after upgrade | Feature regression; reduced observability on affected nodes |

#### Warning Alerts

| Alert | Condition | Impact |
|-------|-----------|--------|
| `RingBufferHighUtilization` | `ebpf_ringbuf_used_bytes / size` > 0.75 for 10 min | Approaching event loss; adaptive sampling active |
| `AgentHighCPU` | `agent_cpu_seconds_total` rate > 0.4 for 15 min | Agent may be impacting application workloads |
| `CollectorBackPressure` | `collector_backpressure_signals` > 0 for 10 min | Agents buffering locally; delayed data |
| `MapNearCapacity` | `ebpf_map_entries_count / max_entries` > 0.9 | Map may start evicting entries; potential data loss |
| `WALBufferGrowing` | `agent_wal_buffer_bytes` > 50 MB and increasing | Collector may be unreachable; local buffer filling |
| `KernelVersionUnsupported` | Node kernel version not in compatibility matrix | eBPF programs running in degraded mode |

---

## Logging

### What to Log

| Component | Log Events | Level |
|-----------|-----------|-------|
| Agent startup | Programs loaded, maps created, features detected | INFO |
| Program load failure | Verifier rejection with error details | ERROR |
| Feature probe results | Kernel capabilities detected | INFO |
| Ring buffer statistics | Fill level, drop count (periodic) | DEBUG |
| Collector connection | Connect, disconnect, reconnect events | INFO |
| Policy update | Security policy loaded/updated/removed | INFO |
| Graceful degradation | Fallback program loaded, sampling activated | WARN |
| Agent resource warning | Approaching CPU/memory limits | WARN |

### Log Levels Strategy

| Level | Usage | Volume |
|-------|-------|--------|
| ERROR | Component failure requiring human attention | <10/hour in normal operation |
| WARN | Degraded operation; system still functional | <100/hour |
| INFO | Significant lifecycle events (startup, connection, policy change) | <1,000/hour |
| DEBUG | Periodic statistics, detailed event processing | Disabled by default; enable per-component |

### Structured Logging Format

```
{
  "timestamp": "2026-03-10T10:05:19.432Z",
  "level": "WARN",
  "component": "ring_buffer_consumer",
  "node_id": "node-042",
  "message": "Adaptive sampling activated",
  "details": {
    "ring_buffer_name": "network_events",
    "fill_ratio": 0.78,
    "sampling_ratio": 0.5,
    "events_per_sec": 85000
  }
}
```

---

## Distributed Tracing (of the Platform Itself)

### Trace Propagation Strategy

The platform does not use traditional distributed tracing for its internal operations (it would create circular dependency). Instead, it uses **causal event IDs**:

- Each event batch is assigned a `batch_id` at the agent
- The collector preserves `batch_id` through its pipeline
- When querying, the path of any specific event can be traced: `kernel capture → ring buffer → agent processing → collector → storage`
- Timing information at each stage enables latency breakdown without distributed tracing

### Key Spans (Conceptual)

| Span | Start | End | Key Attributes |
|------|-------|-----|---------------|
| `kernel_capture` | eBPF program entry | Ring buffer submit | program_type, event_type, cpu_id |
| `ringbuf_transit` | Ring buffer submit | Consumer read | queue_depth, wait_time |
| `agent_processing` | Consumer read | WAL write | enrichment_time, aggregation_time |
| `collector_delivery` | gRPC send | ACK received | batch_size, compression_ratio |
| `storage_write` | Collector receive | Storage ACK | storage_backend, write_latency |

---

## Alerting

### Runbook References

| Alert | Runbook |
|-------|---------|
| `eBPFAgentDown` | Check node status; verify DaemonSet pod health; check agent logs for OOM or crash loop; verify kernel compatibility |
| `RingBufferOverflow` | Increase ring buffer size; identify noisy pods; enable adaptive sampling; consider per-cgroup rate limits |
| `SecurityEnforcementFailure` | Check verifier log; verify kernel version; try loading fallback program; escalate if security policy is critical |
| `CollectorIngestionStopped` | Check collector health; verify network connectivity; check storage backend status; verify agent connection status |
| `VerifierRejection` | Review verifier error log; check if kernel was recently upgraded; verify BTF availability; try reduced program variant |

---

## Meta-Monitoring Anti-Patterns

| Anti-Pattern | Problem | Solution |
|-------------|---------|----------|
| **Self-observation loop** | Agent's own events captured by its eBPF programs | Exclude agent cgroup from observation maps |
| **Alert-on-alert** | Alert firing triggers events that fire more alerts | Alert deduplication with cooldown period; suppress self-referential alerts |
| **Profiling the profiler** | CPU profiler sampling the profiler's own stack traces | Profiler excludes its own PID from sampling |
| **Dashboard-induced load** | Dashboard queries generate query events that update dashboards | Query API events excluded from real-time pipeline; only captured in audit log |

---

## SLI/SLO Definitions

| SLI | Definition | Measurement Method | SLO Target | Burn Rate Alert |
|-----|-----------|-------------------|------------|-----------------|
| **Event capture overhead** | CPU time spent in eBPF programs ÷ total CPU time | `bpftop` or per-program run_time_ns counter | <1% per node | >1.5% sustained 10 min |
| **Event delivery completeness** | Events delivered to collector ÷ events captured in kernel | Kernel-side capture counter vs. collector-side receive counter | >99.9% per hour | <99.5% sustained 5 min |
| **Security enforcement latency** | Time from LSM hook entry to policy decision return | In-kernel timestamp diff (ktime_get_ns at entry and exit) | <10μs p99 | >15μs p99 sustained 1 min |
| **Dashboard freshness** | Max age of most recent event visible in query results | Periodic probe: emit marker event, measure time until queryable | <30s p99 | >60s sustained 5 min |
| **Agent availability** | Percentage of time agent is running and consuming events | Heartbeat from agent to management server (every 10s) | >99.95% per node | 2 missed heartbeats |
| **Ring buffer utilization** | Ring buffer used bytes ÷ total capacity | Per-ring-buffer gauge metric | <75% p95 | >90% sustained 1 min |
| **Kernel compatibility** | Percentage of fleet nodes running full eBPF suite | Agent reports capability level; management server aggregates | >95% of fleet | <90% |

---

## SLO Dashboard Designs

### Platform Health SLO Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ eBPF Platform Health — SLO Status                       │
├──────────────────────────┬──────────────────────────────┤
│ Event Delivery SLO       │ Ring Buffer Utilization       │
│ ████████████░░ 99.94%    │ Heat map: nodes × time        │
│ Budget remaining: 72%    │ [green/yellow/red per cell]   │
│ Trend: stable            │ Cluster p95: 42%              │
├──────────────────────────┼──────────────────────────────┤
│ Enforcement Latency SLO  │ Agent Availability SLO        │
│ ████████████████ 99.99%  │ ████████████████ 99.98%       │
│ Budget remaining: 94%    │ Budget remaining: 86%          │
│ p99: 7.2μs               │ Nodes down: 1/1000            │
├──────────────────────────┼──────────────────────────────┤
│ Dashboard Freshness SLO  │ Kernel Compatibility           │
│ ████████████░░ 99.7%     │ Full suite:     948 nodes      │
│ Budget remaining: 40%    │ Reduced suite:   42 nodes      │
│ p99: 22s                 │ Minimal suite:   10 nodes      │
└──────────────────────────┴──────────────────────────────┘
```

### Security Enforcement SLO Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ Security Enforcement — Real-Time Status                  │
├──────────────────────────┬──────────────────────────────┤
│ Active Policies: 47      │ Enforcement Actions (24h)      │
│ Observe-only: 12         │ Allow: 847,291                 │
│ Alert-only: 23           │ Deny: 342                      │
│ Enforce: 12              │ Kill: 7                        │
├──────────────────────────┼──────────────────────────────┤
│ Policy Evaluation p99    │ False Positive Rate             │
│ 4.2μs (target <10μs)    │ 0.00% (last 7 days)            │
│ [sparkline chart]        │ Promotion candidates: 3         │
├──────────────────────────┼──────────────────────────────┤
│ Coverage Gaps             │ Audit Log Status                │
│ Nodes without LSM: 10    │ Replication lag: 2ms            │
│ Policies pending: 0      │ Storage: 2.1 GB (30-day)        │
└──────────────────────────┴──────────────────────────────┘
```

---

## Incident Playbooks

### Playbook 1: Ring Buffer Overflow (Event Loss)

**Alert:** `RingBufferOverflow` — `ebpf_ringbuf_dropped_events > 0` sustained for 5 minutes.

**Severity:** P1 (data loss)

**Steps:**
1. **Identify scope:** Which nodes? Which ring buffer (network, syscall, security, profile)?
2. **Check adaptive sampling:** Is it active? If yes, sampling should prevent overflow — if overflow persists despite sampling, the consumer is critically stalled.
3. **Check agent health:** CPU utilization, memory, GC pauses. If agent is healthy, the event volume exceeds ring buffer capacity.
4. **Immediate mitigation:**
   - If consumer stalled: restart agent (eBPF programs persist; ring buffer drains on restart)
   - If volume-driven: increase ring buffer size via ConfigMap update + agent restart
   - If caused by noisy pod: identify the pod (`ebpf_events_per_cgroup` metric), apply per-cgroup rate limit
5. **Post-incident:** Review ring buffer sizing formula; consider if in-kernel filtering should be more aggressive

### Playbook 2: Security Enforcement False Positive

**Alert:** Application team reports unexpected `CrashLoopBackOff` coinciding with security policy enforcement.

**Severity:** P1 (application outage)

**Steps:**
1. **Confirm causality:** Check `security_enforcement_actions` for kill/deny events matching the crashing pod
2. **Identify policy:** Which TracingPolicy CRD triggered the enforcement? Which rule matched?
3. **Immediate mitigation:**
   - Switch the policy from enforce → alert-only (reduces blast radius to zero)
   - Restart the affected pods
4. **Root cause analysis:**
   - Was the policy too broad? (e.g., binary allowlist missing a legitimate new binary)
   - Was it a race condition? (e.g., binary updated but allowlist not yet refreshed)
5. **Prevention:** Add the binary to the allowlist; extend observe-only period before re-enabling enforcement
6. **Post-incident:** Update the policy promotion lifecycle documentation

### Playbook 3: Agent Down on Multiple Nodes

**Alert:** `eBPFAgentDown` — No heartbeat from >5% of agents for >60 seconds.

**Severity:** P2 (observability degradation; eBPF programs still running)

**Steps:**
1. **Check DaemonSet status:** Are pods being scheduled? Check for resource quota exhaustion, node affinity issues
2. **Check node health:** Are nodes themselves unhealthy? (OOM, disk pressure, network issues)
3. **Check recent changes:** Was a new agent version deployed? Was a kernel upgrade rolled out?
4. **If deployment-related:** Roll back DaemonSet to previous version
5. **If resource-related:** Check agent resource limits; investigate memory leak or CPU spike
6. **Note:** eBPF programs continue running and events accumulate in ring buffers. When agents recover, they drain accumulated events. Security enforcement remains active.

---

## Tracing Strategy

### Async Boundary Correlation

The platform cannot use traditional distributed tracing for its own internal pipeline (circular dependency). Instead, it uses causal correlation:

| Event Boundary | Correlation Key | How It's Propagated |
|---------------|----------------|---------------------|
| eBPF capture → ring buffer | `event_seq` (per-CPU sequence number) | Written by eBPF program; read by consumer |
| Ring buffer → agent processing | `batch_id` (assigned at consumption) | Consumer assigns to each batch of events |
| Agent → collector | `batch_id` + `node_id` | Sent in gRPC stream metadata |
| Collector → storage | `batch_id` + `node_id` + `storage_shard` | Written as event metadata |
| Storage → query result | `event_id` (unique: node_id + batch_id + event_seq) | Returned in query response |

### Sampling Strategy for Platform Events

| Event Type | Sampling Rate | Rationale |
|-----------|--------------|-----------|
| eBPF program load/unload | 100% | Rare events; critical for audit |
| Agent lifecycle (start/stop/restart) | 100% | Rare events; critical for debugging |
| Ring buffer statistics | 100% at 10s intervals | Small volume; essential for capacity planning |
| Per-event processing latency | 0.1% | High volume; statistical sampling sufficient |
| gRPC stream metrics | 100% at 30s intervals | Connection-level, not per-event |
| Collector storage write latency | 1% | High volume; statistical sampling sufficient |

### Custom Span Attributes for eBPF Events

| Attribute | Description | Use Case |
|-----------|-------------|----------|
| `ebpf.program_id` | Unique identifier of the eBPF program that generated the event | Correlate events to specific programs for debugging |
| `ebpf.program_type` | kprobe, tracepoint, TC, XDP, LSM, perf_event | Filter events by program type in queries |
| `ebpf.kernel_version` | Kernel version on the source node | Diagnose version-specific issues |
| `ebpf.capability_level` | FULL, REDUCED, MINIMAL, PASSIVE | Track fleet capability distribution |
| `ebpf.ring_buffer_fill` | Fill ratio at time of event submission | Correlate event quality with ring buffer pressure |
| `ebpf.sampling_active` | Whether adaptive sampling was active when event was captured | Flag events that may be from a sampled window |

---

## AI Quality Monitoring (for ML-Based Detection)

### Behavioral Detection Model Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `detection_model_inference_latency` | Time to evaluate behavioral rule on an event | p99 >50ms |
| `detection_model_true_positive_rate` | Confirmed alerts ÷ total alerts (based on operator feedback) | <80% over 30-day rolling window |
| `detection_model_false_positive_rate` | Dismissed alerts ÷ total alerts | >5% over 7-day window |
| `detection_model_feature_drift` | KL divergence between training and current feature distributions | >0.1 for any feature |
| `detection_model_stale_rules` | Behavioral rules not triggered in 90 days | Count >10 (may indicate dead rules) |

---

## On-Call Runbook Quick Reference

| Scenario | First Response | Escalation Trigger |
|----------|---------------|-------------------|
| Single agent down | Check DaemonSet pod; restart if needed; eBPF programs persist | >5 agents down simultaneously |
| Ring buffer overflow on one node | Identify noisy pod; apply per-cgroup rate limit | Overflow on >5% of nodes |
| Verifier rejection after kernel upgrade | Load fallback program variant; report kernel incompatibility | >10% of fleet in degraded mode |
| Collector ingestion stopped | Check collector health; verify storage backend; check network | All collectors in a region down |
| Security policy blocking legitimate traffic | Switch to alert-only mode immediately; investigate rule | Any P1 application impacted |
| Profile store unavailable | Low priority; profiles are regenerable; investigate at next business day | Profiles unavailable for >24h |
| Cross-region replication lag >1 min (security logs) | Check network between regions; check storage write latency | Lag >5 min (compliance risk) |
| Agent memory OOM | Check for memory leak; verify ring buffer sizing; increase limit | Recurring OOM across nodes |
