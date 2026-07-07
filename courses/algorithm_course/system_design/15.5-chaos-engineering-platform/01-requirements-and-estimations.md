# Requirements & Estimations — Chaos Engineering Platform

## Functional Requirements

### Core Features

1. **Fault Injection Engine** — Inject controlled faults across multiple layers: network (latency, packet loss, DNS failure, partition), compute (CPU pressure, memory pressure, I/O stress, process kill), application (HTTP error injection, request abort, dependency timeout), and state (disk fill, clock skew, certificate expiration, configuration corruption).

2. **Experiment Orchestration** — Define experiments as declarative specifications containing: target selection (host, container, service, zone), fault type and magnitude, duration, steady-state hypothesis, abort conditions, and scheduling. Support sequential multi-step experiments (scenarios) with conditional branching.

3. **Blast Radius Control** — Limit the scope of experiments using multiple dimensions: percentage of targets (e.g., 10% of pods in a service), geographic scope (single zone, single region), dependency depth (only direct dependencies, no cascading), and concurrent experiment limits (max N experiments running simultaneously on overlapping targets).

4. **Steady-State Hypothesis Monitoring** — Continuously evaluate user-defined metrics (error rate, latency percentiles, throughput, custom business metrics) against threshold bounds during experiment execution. Integrate with existing observability infrastructure (metrics, traces, logs) to pull real-time measurements.

5. **Automated Rollback** — Immediately revert all injected faults when: steady-state hypothesis is violated, experiment duration expires, manual abort is triggered, or the chaos platform itself detects an internal failure. Rollback must complete within a bounded time (target: <30 seconds from trigger to full reversion).

6. **GameDay Orchestration** — Coordinate multi-team, multi-experiment events with: pre-defined runbooks, escalation procedures, communication channel integration (chat, video), shared dashboards for all participants, time-boxed phases (briefing → injection → observation → debrief), and post-GameDay report generation.

7. **Experiment Library & Templates** — Maintain a catalog of pre-built experiment types (modeled after ChaosHub) with parameterizable templates, community-contributed experiments, and organizational custom experiments with approval workflows.

8. **Scheduling & Automation** — Support cron-based experiment scheduling for continuous chaos (e.g., "kill 1 random pod every business day at 2 PM"), CI/CD pipeline integration for pre-deployment resilience validation, and progressive automation from manual → scheduled → continuous.

### Extended Features

1. **EF-01: Resilience Scoring Engine** — Aggregate historical chaos experiment results into a per-service resilience score (0-100) that trends over time. Scores should factor in: fault type coverage (how many different fault types have been tested), blast radius tested (maximum blast radius at which the service still passed), recency (recent results weighted higher than stale ones), and failure-to-pass ratio (services that consistently pass score higher).

2. **EF-02: AI-Recommended Experiments** — Analyze service dependency graphs, deployment frequency, incident history, and existing chaos coverage to recommend experiments that would discover the most impactful weaknesses. Prioritize services that are frequently deployed, have high downstream dependency counts, and have never been chaos-tested.

3. **EF-03: Chaos Budget Management** — Allocate per-service chaos budgets (hours/month of intentional fault injection) analogous to SLO error budgets. Track consumption against budget. When a service exhausts its chaos budget, block further experiments until the next budget period.

4. **EF-04: Experiment Replay** — Replay a previously-run experiment with identical parameters to validate that a remediation fix actually improved resilience. Track before/after results for the same experiment template across deployments.

5. **EF-05: Cross-Region Failover Validation** — Orchestrate experiments that simulate complete region failure by coordinating fault injection across all services in a region, then validating that traffic automatically fails over to the standby region within the declared RTO.

6. **EF-06: Incident-Driven Experiment Generation** — After a production incident is resolved, automatically generate a chaos experiment that simulates the incident's root cause. Track whether the remediation survives re-injection. Link experiment results back to incident tickets.

7. **EF-07: eBPF-Based Injection** — Support kernel-level fault injection via eBPF programs for lower overhead and finer-grained targeting than traditional iptables/tc approaches. Enable per-process, per-socket, and per-syscall fault injection without requiring privileged containers.

### Out of Scope

- Building observability infrastructure (metrics collection, tracing, log aggregation) — the platform integrates with existing systems
- Application-level testing (unit tests, integration tests, load tests) — chaos engineering tests system behavior under failure, not functional correctness
- Incident management and on-call routing — the platform triggers alerts but does not manage incident response workflows
- Security chaos (adversarial simulation, red-teaming) — overlap exists but the threat model and tooling differ significantly

---

## Non-Functional Requirements

### CAP Theorem Position

**CP (Consistency + Partition Tolerance)** — The chaos control plane must maintain a consistent view of which experiments are running and which faults are injected. During a network partition, the platform must not lose track of active experiments — an orphaned fault injection with no controlling authority is a production outage waiting to happen. Availability of the experiment API can degrade (reject new experiments) during partitions; consistency of experiment state must not.

### Consistency Model

**Strong Consistency for experiment state** — The experiment lifecycle (created → approved → running → rolling_back → completed) must follow strict state machine transitions. Two agents must never simultaneously inject conflicting faults on the same target. The blast radius controller must have a globally consistent view of all active experiments to enforce cross-experiment safety limits.

**Eventual Consistency for results and metrics** — Experiment results, telemetry correlation, and historical analytics can tolerate seconds of staleness.

### Availability Target

| Component | Target | Rationale |
|-----------|--------|-----------|
| Experiment Control Plane | 99.99% | Must be available to execute rollbacks; downtime during an active experiment is catastrophic |
| Fault Injector Agents | 99.95% | Agents must respond to rollback commands; agent failure must trigger automatic fault reversion |
| Experiment API (new experiment submission) | 99.9% | Brief API unavailability is acceptable — it just delays new experiments |
| Dashboard & Reporting | 99.5% | Read-only; degradation is inconvenient but not dangerous |

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Fault injection (control plane → agent → applied) | <2s | <5s | <10s |
| Rollback (trigger → fault fully reverted) | <5s | <15s | <30s |
| Steady-state metric evaluation | <1s | <3s | <5s |
| Abort propagation (to all agents in experiment) | <1s | <3s | <5s |
| Experiment API response (create/read) | <200ms | <500ms | <1s |

### Durability Guarantees

- Experiment definitions: durable (persisted to database with replication)
- Active experiment state: durable with write-ahead log (must survive control plane restart)
- Fault injection state on agents: locally persisted (agent restart must know what faults to revert)
- Experiment results: durable (immutable audit record)
- Rollback commands: delivered with at-least-once semantics via persistent queue

---

## Capacity Estimations (Back-of-Envelope)

**Reference deployment:** Large enterprise, 5,000 hosts across 3 regions, 500 microservices, running 50 experiments/day (mix of automated and manual).

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Experiments per day | 50–200 | 10 scheduled (continuous chaos) + 5–20 manual + 30–170 CI/CD triggered |
| Concurrent experiments (peak) | 5–15 | Most experiments run 5–30 min; staggered scheduling limits concurrency |
| Fault injector agents | 5,000 | One agent per host (lightweight daemon) |
| Agent heartbeats per second | ~85 | 5,000 agents × 1 heartbeat/min ÷ 60 |
| Steady-state metric queries per second | 50–150 | 5–15 concurrent experiments × 5–10 metrics each × ~1 query/sec |
| Experiment result records per day | 50–200 | One result record per experiment |
| Experiment step records per day | 500–2,000 | Each experiment averages 10 steps (fault apply, verify, escalate, rollback) |
| Audit log entries per day | 5,000–20,000 | API calls + state transitions + agent events |
| Storage (experiment data, 1 year) | ~10 GB | Experiment definitions + results + audit logs (text-heavy, modest volume) |
| Storage (correlated telemetry snapshots, 1 year) | ~500 GB | Metric snapshots and trace samples captured during experiments |
| Agent binary size | 10–20 MB | Statically-linked binary with fault injection modules |
| Agent memory footprint | 30–50 MB | Heartbeat + fault state + rollback instructions |
| Control plane instances | 3–5 | Leader-elected cluster for consistency |

### Growth Projections

| Stage | Timeline | Experiments/Day | Agent Fleet | Concurrent Experiments |
|-------|----------|-----------------|-------------|----------------------|
| **Pilot** | Month 1-3 | 5-10 | 50-200 | 1-2 |
| **Adoption** | Month 4-12 | 20-50 | 500-2,000 | 5-10 |
| **Enterprise** | Year 2 | 50-200 | 2,000-10,000 | 10-30 |
| **Hyperscale** | Year 3+ | 200-1,000 | 10,000-100,000 | 30-100 |

### Cost Estimation (Enterprise Tier)

| Category | Monthly Cost | Percentage | Notes |
|----------|-------------|------------|-------|
| **Control plane compute** | ~$1,200 | 15% | 3-5 nodes (4 vCPU, 16 GB) |
| **SSM compute** | ~$800 | 10% | 2 nodes (8 vCPU, 32 GB) |
| **Database (Experiment DB)** | ~$1,500 | 19% | 3-node Raft cluster with SSD |
| **Command queue** | ~$600 | 8% | 3-node message broker cluster |
| **Audit log storage** | ~$400 | 5% | Append-only WORM storage, 7-year retention |
| **Agent overhead** | ~$2,500 | 32% | 5,000 agents × ~$0.50/agent/month (30 MB RAM, <1% CPU) |
| **Observability queries** | ~$500 | 6% | SSM queries to metrics backend |
| **Networking** | ~$400 | 5% | Cross-region relay traffic, heartbeats |
| **Total** | **~$7,900** | **100%** | |

### Latency Budget Breakdown

**Fault Injection Path (P99 < 10s):**

| Step | Budget | Cumulative |
|------|--------|-----------|
| API validation + BRC check | 500ms | 500ms |
| Blast radius graph traversal | 200ms | 700ms |
| Lock acquisition + reservation | 100ms | 800ms |
| Command enqueue | 50ms | 850ms |
| Queue → agent delivery | 2,000ms | 2,850ms |
| Agent fault application | 500ms | 3,350ms |
| Agent ACK propagation | 150ms | 3,500ms |
| Headroom for retries/partitions | 6,500ms | 10,000ms |

**Rollback Path (P99 < 30s):**

| Step | Budget | Cumulative |
|------|--------|-----------|
| SSHE violation detection | 5,000ms | 5,000ms |
| Grace period (worst case) | 10,000ms | 15,000ms |
| Rollback command enqueue | 50ms | 15,050ms |
| Queue → agent delivery | 2,000ms | 17,050ms |
| Agent fault reversion | 500ms | 17,550ms |
| Agent ACK propagation | 150ms | 17,700ms |
| Headroom for retries/partitions | 12,300ms | 30,000ms |

### SLO Error Budgets

| SLO | Target | Budget (30 days) | Burn Rate Alert |
|-----|--------|-----------------|-----------------|
| Control plane availability | 99.99% | 4.32 minutes | >1 min consumed in 1 hour |
| Rollback P99 < 30s | 99.9% | ~4 violations/month | >1 violation/day |
| Orphaned fault rate | 0% | 0 events | Any single event |
| Agent command delivery | 99.9% | ~50 missed commands/month | >10 missed/day |
| Blast radius accuracy | 100% | 0 violations | Any single violation |

---

## SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Rollback completion time | <30s p99 | Time from abort trigger to all faults reverted (measured by agent confirmation) |
| Orphaned fault rate | 0% | Faults still active after experiment completion or platform failure (measured by periodic reconciliation) |
| Steady-state evaluation freshness | <5s p99 | Age of the most recent metric evaluation for any running experiment |
| Blast radius accuracy | 100% | Actual impacted targets must never exceed declared blast radius |
| Experiment state consistency | Linearizable | No two control plane nodes may disagree on experiment lifecycle state |
| Agent command delivery | >99.9% | Percentage of rollback commands successfully delivered to agents |
| Audit log completeness | 100% | Every experiment state transition and fault injection event must be logged |

---

## Constraints Unique to Chaos Engineering

### Safety Constraints

| Constraint | Description | Impact |
|------------|-------------|--------|
| Blast radius ceiling | Organization-wide maximum (e.g., never affect >10% of a service's capacity) | Prevents experiments from becoming outages; hard-coded limit that requires VP-level override |
| Concurrent experiment isolation | No two experiments may inject conflicting faults on the same target simultaneously | Requires global experiment registry with target-level locking |
| Business-hours restrictions | Some experiments may only run during business hours (when engineers are available) or only outside business hours (to avoid customer impact) | Scheduling engine must enforce time windows per experiment category |
| Production gating | Experiments targeting production require additional approval (human-in-the-loop) | Approval workflow with timeout (auto-reject if not approved within N hours) |
| Dependency-aware scoping | Injecting a fault on a shared dependency (database, message queue) has a blast radius that spans all dependent services | Blast radius calculator must model the service dependency graph |

### Operational Constraints

| Constraint | Description | Impact |
|------------|-------------|--------|
| Agent deployment | Agents must be deployable without application restarts or service disruption | DaemonSet (Kubernetes) or system service with zero-downtime updates |
| Network partition resilience | If the agent loses contact with the control plane during an experiment, it must autonomously revert faults after a safety timeout | Agent-side timer with local rollback capability |
| Observability dependency | Steady-state monitoring depends on external observability systems; if those systems are also under chaos, the hypothesis cannot be evaluated | Circuit breaker: abort experiment if observability data becomes unavailable |

### Migration Requirements

Organizations transitioning from ad-hoc chaos to a platform-based approach must address:

| Migration Phase | Description | Key Challenges |
|----------------|-------------|----------------|
| **Phase 1: Inventory** | Catalog all existing chaos scripts, one-off experiments, and tribal knowledge about system resilience | Scripts scattered across repos; no standard format; undocumented experiments |
| **Phase 2: Agent Deployment** | Roll out fault injector agents across the infrastructure without disrupting production workloads | Agent requires privileged access (iptables, cgroups); security team review; container runtime compatibility |
| **Phase 3: Dependency Graph** | Build or import the service dependency graph from existing observability data | Graph completeness varies; infrastructure dependencies (DNS, LB) often missing |
| **Phase 4: Experiment Migration** | Convert existing ad-hoc scripts into platform experiment definitions with hypotheses and guardrails | Engineers resist adding structure to previously informal processes |
| **Phase 5: Approval Workflows** | Establish multi-party approval for production experiments | Organizational pushback on "bureaucracy" for resilience testing |
| **Phase 6: Continuous Integration** | Embed chaos experiments into CI/CD pipelines as deployment gates | Experiment flakiness blocks deployments; requires tuning grace periods and hypothesis thresholds |

### Anti-Requirements (Explicitly Not Goals)

| Non-Goal | Rationale |
|----------|-----------|
| 100% fault type coverage from day one | Start with network + compute faults; add state, clock, and application faults iteratively |
| Zero customer impact guarantee | Some chaos experiments will degrade customer experience within blast radius bounds; the goal is bounded, measured impact, not zero impact |
| Replacing staging or integration testing | Chaos engineering tests resilience under failure, not functional correctness |
| Automating incident response | The platform detects weaknesses; fixing them remains an engineering decision |

---

## Error Budget Policy

| Budget Status | Remaining | Action |
|---------------|-----------|--------|
| **Green** | >75% | Normal operations; all experiment types permitted |
| **Yellow** | 50–75% | Review recent incidents; restrict GameDay experiments to staging only |
| **Orange** | 25–50% | Production experiments require platform-admin approval; root cause review |
| **Red** | <25% | Production experiments suspended; only pre-approved CI/CD templates in staging |
| **Exhausted** | 0% | All experiments halted; engineering focus exclusively on platform reliability improvements |

---

## Hardware Reference Architecture

### Reference: 5,000 Hosts, 500 Services, 50 Experiments/Day

| Component | Count | Spec (per instance) | Role |
|-----------|-------|---------------------|------|
| Control plane (API + Orchestrator) | 3 | 8 vCPU, 32 GB RAM, 100 GB SSD | Leader-elected cluster; experiment state, BRC, scheduling |
| Steady-state monitor | 3 | 4 vCPU, 16 GB RAM | HA with leader election; continuous metric evaluation |
| Command queue brokers | 3 | 4 vCPU, 16 GB RAM, 200 GB SSD | Persistent messaging for agent commands |
| Experiment database | 3 (primary + 2 replicas) | 4 vCPU, 16 GB RAM, 500 GB SSD | Experiment state, results, guardrails |
| Audit log store (WORM) | 2 | 4 vCPU, 8 GB RAM, 1 TB HDD | Append-only compliance storage; 7-year retention |
| Dependency graph cache | 2 | 4 vCPU, 8 GB RAM | In-memory service topology for BRC lookups |
| Fault injector agents | 5,000 | 0.1 vCPU, 50 MB RAM (per agent) | Lightweight daemon on every host |

### Workload Profiles

| Profile | Characteristics | Sizing Impact |
|---------|----------------|---------------|
| **Manual-only (early maturity)** | 5–10 experiments/week, business hours only, staging-first | 3-node control plane, single-region |
| **CI/CD-integrated** | 50–100 experiments/day, triggered by deployments, staging + pre-prod | 5-node control plane, multi-AZ |
| **Continuous chaos** | 200–500 experiments/day, 24/7 automated, production included | 5-node control plane per region, regional agent relays |
| **GameDay-heavy** | Monthly GameDays with 20+ concurrent experiments | Burst capacity for BRC lock handling + SSM query volume |

### Key Capacity Thresholds

| Metric | Threshold | What Happens When Exceeded | Response |
|--------|-----------|---------------------------|----------|
| Concurrent experiments | 15 | BRC lock contention increases; validation latency > 1s | Partition locks by service group; add queue capacity |
| Agent fleet size | 10,000 | Heartbeat storm overwhelms control plane | Deploy regional relay nodes; increase heartbeat jitter |
| SSM queries/second | 500 | Observability backend query latency increases | Dedicated metrics endpoint for SSM; query caching |
| Audit log writes/second | 100 | Database write pressure during GameDays | Async audit writes with WAL; batch audit entries |
| Command queue depth | 1,000 | Fault injection latency exceeds 10s target | Add queue consumers; prioritize rollback over inject |
