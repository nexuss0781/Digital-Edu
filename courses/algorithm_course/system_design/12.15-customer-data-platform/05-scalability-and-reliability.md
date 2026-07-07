# 05 — Scalability and Reliability: Customer Data Platform

## Horizontal Scaling Strategy

### Ingest Layer Scaling

The edge collector fleet is stateless and scales horizontally behind a global load balancer with anycast routing. Each collector instance handles ~50,000 events/sec; at peak 2M events/sec, approximately 40 instances run in parallel. Auto-scaling is event-rate driven, with scale-up triggered at 70% capacity and scale-down after a 10-minute cooldown.

The ingest queue is the primary buffer between the stateless collector tier and the stateful processing tier. The queue scales independently by adding partitions. Each workspace is assigned to a set of partitions at workspace creation; hot workspaces are re-assigned to dedicated partitions if their event rate exceeds a threshold.

### Event Processing Pipeline Partitioning

The event pipeline (identity resolution, profile writing, segment evaluation) is the stateful core. Partitioning strategy:

```
Partitioning key: workspace_id + murmur3(anonymous_id OR user_id)

This ensures:
  - All events for the same user land on the same partition
  - Per-user ordering is preserved within the partition
  - Workspaces are spread across partitions (no hot workspace concentrating on one node)
  - Re-partitioning is possible by adding partitions and migrating at workspace granularity
```

Each partition is processed by a single pipeline worker. The pipeline worker is a micro-batch processor: it pulls a batch of 500–1000 events from its partition, runs identity resolution and profile updates for the batch, then commits progress. Micro-batching amortizes the overhead of distributed locks and database round-trips.

### Profile Store Sharding

The profile store uses consistent hashing on `profile_id` to distribute load across shards. Each shard handles ~100M profiles. Shard topology:

| Tier | Shards | Replica Factor | Purpose |
|---|---|---|---|
| Hot tier | 20 shards | 3 replicas each | Most-recently-updated profiles (updated in last 7 days) |
| Warm tier | 50 shards | 2 replicas each | Active but less frequent profiles |
| Cold tier | Object storage | N/A | Inactive profiles, compressed and archived |

Profiles are promoted/demoted between tiers based on last-activity timestamp. Cold profiles are rehydrated to the hot tier on event arrival (first-time active session cost: ~100ms for rehydration).

### Identity Graph Sharding

The identity graph is sharded by `workspace_id + cluster_id`. All nodes in the same identity cluster (connected component) must be on the same shard to allow atomic cluster operations without cross-shard coordination. When a merge operation would combine nodes from different shards, a two-phase merge protocol is used:

1. **Phase 1**: Lock all affected shards, validate that both clusters still exist in their expected states
2. **Phase 2**: Write the merged cluster to the target shard, mark the source shard's nodes as redirects
3. **Phase 3**: Asynchronously clean up redirect nodes after all readers have updated their caches

The key insight: identity merges that cross shard boundaries are rare (< 0.1% of merges), so the two-phase protocol cost is acceptable.

### Audience Engine Scaling

The streaming CEP evaluator is the highest fan-out component — it evaluates every event against potentially thousands of segment rules. Scaling strategy:

**Vertical fan-out**: Each CEP worker instance maintains a complete in-memory copy of the streaming segment rule set for its assigned workspace set. Rule evaluation is CPU-bound and memory-local, making vertical scaling (larger instances with more cores) effective up to ~50,000 streaming rules per instance.

**Horizontal fan-out**: Multiple CEP worker instances per workspace partition. Each instance processes all events on its partition independently — segment evaluation is idempotent so duplicate membership-change events are fine (the downstream membership writer deduplicates on `profile_id + segment_id + direction`).

---

## Event Pipeline Reliability

### At-Least-Once Delivery Guarantees

The ingest queue uses acknowledgment-based consumption: events are not removed from the queue until the consumer explicitly acknowledges successful processing. If a pipeline worker crashes mid-batch, the unacknowledged events are redelivered to another worker after a timeout (default: 30 seconds).

This means each event may be processed more than once. The pipeline must be idempotent:

- **Identity resolution**: Graph node creation is idempotent (upsert by identifier value); merge operations use the distributed lock to prevent duplicate merges
- **Profile updates**: Trait upserts are idempotent (last-write-wins per key, using the event's `timestamp` for ordering)
- **Segment evaluation**: Membership entry/exit events are idempotent at the membership writer (upsert by `profile_id + segment_id`)
- **Destination delivery**: Each delivery attempt uses a stable `delivery_id`; see deduplication in section 04

### Dead Letter Queue Handling

Events that fail processing after N retries (default: 3) are moved to a dead letter queue (DLQ). The DLQ is organized by failure reason:

| DLQ Category | Contents | Handling |
|---|---|---|
| `schema_violation` | Events failing schema validation | Review and update schema; replay if schema was wrong |
| `identity_error` | Events where identity resolution threw an unhandled error | Alert on-call; fix bug; replay |
| `profile_write_error` | Transient write failures | Automatic replay after 5-min cooldown |
| `processing_poison_pill` | Events that crash the worker repeatably | Quarantine and manual investigation |

DLQ replay is a standard operational procedure — events are re-enqueued with the same `event_id` (deduplication prevents double-processing of events that partially succeeded).

---

## Multi-Region Architecture

### Region Topology

The CDP operates in a minimum of 3 geographic regions to provide both low-latency ingest globally and regulatory data residency compliance:

```
Region 1 (us-east):   Primary region; full stack; workspace default
Region 2 (eu-west):   Full stack; EU-resident workspaces processed and stored here
Region 3 (ap-south):  Full stack; APAC-resident workspaces
```

Each region is fully capable of handling all CDP operations independently. Cross-region traffic occurs only for:
- **Global identity matching** (optional, for cross-region user stitching with explicit consent)
- **Replication** of workspace metadata (destination configs, schema registry) for reference
- **DR failover** traffic if a region is unavailable

### Workspace Data Residency

A workspace has a configured home region. All event data, profile data, and identity graph data for that workspace is stored and processed in the home region only. No PII leaves the home region. Workspace metadata (non-PII configuration) is replicated to all regions for low-latency management API access.

### Active-Active Ingest

Edge collectors in all regions accept events for any workspace. Events received in a non-home-region collector are forwarded to the home region's ingest queue via an encrypted tunnel with minimal latency overhead (~30–50ms for cross-region hop). This allows global SDK deployment without requiring clients to route to a specific region.

An alternative (for workspaces with strict data residency requirements) is **home-region-only ingest**: the SDK endpoint resolves via GeoDNS to the home region, ensuring events never leave the home region even in transit.

---

## Disaster Recovery

### Recovery Time and Point Objectives

| Component | RTO | RPO | Recovery Strategy |
|---|---|---|---|
| Ingest queue | 1 minute | 0 (no data loss) | Multi-AZ with automatic failover |
| Profile store | 5 minutes | 5 minutes | Active-passive replication; promote replica on primary failure |
| Identity graph | 10 minutes | 5 minutes | Active-passive replication; rebuild from event log if needed |
| Audience membership cache | 15 minutes | Acceptable loss (re-evaluatable) | Rebuild from profile store + segment definitions |
| Destination queues | 5 minutes | 0 (persisted to durable store) | Multi-AZ; resume from last checkpoint |
| Audit log | 0 (not in critical path) | 0 | Multi-AZ append-only log with synchronous replication |

### Event Replay for Recovery

The raw event store (the append-only log of all ingested events) is the system of truth. If any downstream state (profile store, identity graph, audience memberships) is corrupted or lost, it can be reconstructed by replaying events from the beginning or from a checkpoint. This property is the foundation of the CDP's disaster recovery strategy.

The replay pipeline:
1. Restore profile store from latest snapshot (5-min RPO)
2. Replay all events received after the snapshot timestamp from the event log
3. Identity resolution and profile updates are re-applied
4. Segment memberships are re-evaluated
5. Destination queues are re-populated for events within the retry window

Full replay from scratch for 1B profiles takes approximately 4–8 hours. Partial replay (from a recent checkpoint) typically takes < 30 minutes.

---

## Load Shedding

When the system approaches capacity limits, it applies ordered load shedding to preserve core functionality:

| Priority | Component | Action Under Overload |
|---|---|---|
| 1 (Preserve) | Event ingest | Never shed; queue buffers absorb bursts |
| 2 (Preserve) | Identity resolution | Slow path: batch processing instead of real-time |
| 3 (Degrade gracefully) | Streaming segment evaluation | Skip low-priority segments; flag for batch catch-up |
| 4 (Degrade gracefully) | Destination delivery | Increase delivery batch size; accept higher latency |
| 5 (Acceptable shed) | Computed trait recomputation | Defer recomputation; serve stale computed traits |
| 6 (Acceptable shed) | Batch segment refresh | Skip refresh cycle; serve stale memberships |

This ordered shedding ensures that event collection (the most critical function — prevents data loss) is protected at all costs, while less critical derived functions degrade gracefully under load.

---

## Back-Pressure Mechanisms

### Ingest Back-Pressure

When the event processing pipeline cannot keep up with ingest volume, back-pressure must propagate upstream without dropping events:

```
FUNCTION apply_ingest_back_pressure(queue_depth, queue_capacity):
    fill_ratio = queue_depth / queue_capacity

    IF fill_ratio < 0.5:
        RETURN LEVEL_0  // Normal: accept all events at full rate

    IF fill_ratio < 0.7:
        RETURN LEVEL_1  // Warning: increase batch size, log warning
        // Action: pipeline workers increase micro-batch from 500 to 2000 events

    IF fill_ratio < 0.85:
        RETURN LEVEL_2  // Elevated: throttle low-priority workspaces
        // Action: free-tier workspaces rate-limited to 50% capacity
        // Enterprise workspaces continue at full rate

    IF fill_ratio < 0.95:
        RETURN LEVEL_3  // Critical: throttle all workspaces
        // Action: all workspaces rate-limited; SDK receives 429 with Retry-After header
        // Edge collectors buffer locally for up to 60 seconds before dropping

    RETURN LEVEL_4  // Emergency: reject new events
    // Action: return 503 to SDK; events buffered client-side for retry
    // Alert: P0 page to on-call; auto-scale pipeline workers
```

### Back-Pressure Signal Propagation

| Signal Source | Signal Type | Propagation Path | Response Time |
|---|---|---|---|
| Processing queue depth | Queue fill ratio | Queue → edge collectors via health endpoint | < 5 seconds |
| Profile store write latency | p99 > 200ms | Profile store → pipeline workers via circuit breaker | < 10 seconds |
| Identity graph lock contention | Lock wait > 500ms | Graph store → pipeline workers → queue consumer pause | < 15 seconds |
| Destination queue depth | Per-destination overflow | Destination queue → fan-out router → selective pause | < 30 seconds |
| Memory pressure on CEP workers | Heap usage > 80% | CEP worker → orchestrator → pause non-critical segment eval | < 10 seconds |

### Destination Back-Pressure

When a destination's queue depth exceeds thresholds, the fan-out router must decide how to handle continued incoming events:

```
FUNCTION handle_destination_back_pressure(destination, queue_depth):
    IF queue_depth < destination.warning_threshold:
        RETURN DELIVER_NORMALLY

    IF queue_depth < destination.critical_threshold:
        // Batch-coalesce: aggregate multiple events into fewer delivery payloads
        RETURN DELIVER_BATCHED(batch_size = 100, batch_window = 30s)

    IF queue_depth < destination.overflow_threshold:
        // Pause fan-out for this destination; events accumulate in the source stream
        // Other destinations continue receiving normally
        RETURN PAUSE_FANOUT(resume_when = queue_depth < critical_threshold * 0.5)

    // Overflow: spill queue to object storage
    RETURN SPILL_TO_COLD_STORAGE(
        retention = 72h,
        replay_on_recovery = TRUE
    )
```

---

## Chaos Engineering Experiments

| Experiment | Target | Hypothesis | Blast Radius |
|---|---|---|---|
| **Kill 25% of edge collectors** | Ingest tier | Event ingestion rate remains within 5% of baseline; no events dropped (queue absorbs burst) | 25% of collector fleet in one AZ |
| **Inject 500ms latency on profile store writes** | Profile store | Event-to-profile propagation p99 increases but stays < 2s; no pipeline stalls; back-pressure engages cleanly | One profile store shard |
| **Network partition between identity graph and pipeline** | Identity graph | Identity resolution falls back to "create new profile" mode; merges queued for reconciliation after partition heals; no events dropped | Single AZ partition |
| **Kill the streaming CEP leader** | Audience engine | Leader re-election completes in < 30 seconds; streaming evaluation resumes from checkpoint; batch path covers gap | CEP leader node |
| **Overwhelm a single destination** | Destination delivery | Circuit breaker opens within 10 seconds; queue for this destination grows but doesn't affect other destinations; back-pressure does not propagate to ingest | Single destination |
| **Corrupt the segment index** | Audience engine | Automatic segment index rebuild triggers from the segment configuration store within 60 seconds; streaming eval paused during rebuild; batch covers gap | CEP workers for affected workspace |
| **Flood a single workspace** | Multi-tenant isolation | Noisy-neighbor workspace is throttled at its configured rate limit; other workspaces maintain their SLOs; no cross-workspace impact | Single workspace's event stream |

---

## Capacity Planning Formulas

### Compute Sizing

```
Edge collectors:
  instances = ceil(peak_events_per_second / 50,000) × 1.5 (headroom)
  Example: ceil(2,000,000 / 50,000) × 1.5 = 60 instances

Pipeline workers:
  instances = ceil(peak_events_per_second / micro_batch_throughput)
  micro_batch_throughput = batch_size / (identity_resolution_time + profile_write_time)
  Example: 1,000 / (50ms + 30ms) = 12,500 events/sec/worker
  instances = ceil(2,000,000 / 12,500) = 160 workers

CEP evaluators:
  instances = ceil(segment_evaluations_per_second / per_instance_capacity)
  segment_evaluations_per_second = events/sec × avg_segments_per_event
  Example: 2,000,000 × 25 = 50M evaluations/sec
  per_instance_capacity = 500,000 evaluations/sec (CPU-bound)
  instances = ceil(50,000,000 / 500,000) = 100 CEP workers

Fan-out routers:
  instances = ceil(delivery_attempts_per_second / per_instance_throughput)
  Example: ceil(2,500,000 / 100,000) = 25 instances
```

### Storage Growth Projection

```
Raw event growth (compressed):
  daily = avg_events_per_second × 86,400 × avg_event_size / compression_ratio
  Example: 500,000 × 86,400 × 1 KB / 3 = 14 TB/day

  90-day hot tier: 14 TB × 90 = 1.26 PB
  Annual cold archive: 14 TB × 365 = 5.1 PB/year

Profile store growth:
  incremental = new_profiles_per_day × profile_size
  Example: 5M new profiles/day × 8.5 KB = 42.5 GB/day
  Annual: ~15 TB/year (net of profile deactivation)
```

---

## Hardware Reference Architecture

### Reference: 1B Profiles, 2M Events/Sec Peak, 100 Workspaces

| Component | Count | Spec (per instance) | Role |
|---|---|---|---|
| Edge collectors | 60 | 4 vCPU, 8 GB RAM | Stateless event receivers with schema validation |
| Ingest queue brokers | 9 (3 per AZ) | 8 vCPU, 32 GB RAM, 2 TB NVMe | Partitioned durable queue; 3-way replication |
| Pipeline workers | 160 | 8 vCPU, 32 GB RAM | Identity resolution + profile updates + segment eval dispatch |
| Profile store nodes | 60 (20 shards × 3 replicas) | 8 vCPU, 64 GB RAM, 1 TB NVMe | Document store with hot/warm tiering |
| Identity graph nodes | 12 (4 shards × 3 replicas) | 16 vCPU, 64 GB RAM, 500 GB NVMe | Graph database for identity clusters |
| CEP evaluators | 100 | 8 vCPU, 32 GB RAM | Streaming segment rule evaluation |
| Fan-out routers | 25 | 4 vCPU, 16 GB RAM | Consent check + schema transform + per-destination routing |
| Destination workers | 200 (pool) | 4 vCPU, 8 GB RAM | Per-destination delivery with rate limiting |
| Batch segment executors | 20 | 16 vCPU, 64 GB RAM | Periodic batch segment refresh; incremental evaluation |
| Consent cache | 6 (3 per AZ) | 4 vCPU, 16 GB RAM | Read-through consent lookups |
| Object storage | — | — | Raw event archive; destination queue spillover |

### Cost Distribution

| Category | Share | Notes |
|---|---|---|
| Compute (pipeline + CEP + fan-out) | 40% | CPU-bound workloads; scales linearly with event volume |
| Storage (event archive + profile store) | 25% | Dominated by raw event retention at PB scale |
| Network egress (destination delivery) | 20% | Fan-out multiplier makes egress the surprise cost driver |
| Queue infrastructure | 10% | Ingest + destination queues; high-IOPS requirement |
| Identity graph + consent cache | 5% | Modest compute but requires low-latency NVMe |

---

## Disaster Recovery Runbooks

### Runbook 1: Profile Store Primary Failure

**Detection:** Profile write latency > 1s for 60 seconds OR profile store health check returns unhealthy.

**Steps:**
1. Verify failure is not a false alarm (check from multiple monitoring endpoints)
2. Promote replica to primary in the affected shard (automated; < 5 min RTO)
3. Verify pipeline workers reconnect to new primary within 30 seconds
4. Verify profile read API latency returns to normal
5. Rebuild replacement replica from promoted primary
6. Post-incident: replay any events received during the failover window from the event log

### Runbook 2: Identity Graph Corruption

**Detection:** Identity resolution quality metrics show sudden drop in precision (false merge rate > 1%) or recall.

**Steps:**
1. Pause all identity merge operations (queue identity events for later processing)
2. Identify the scope of corruption (affected clusters, affected workspaces)
3. If scope is limited: rollback affected clusters from the identity graph changelog
4. If scope is wide: restore from latest snapshot; replay identity events from checkpoint
5. Resume merge operations; monitor quality metrics for 1 hour before clearing incident
6. RTO: 10 min (pause) + 30 min (restore) = 40 min; RPO: 5 min

### Runbook 3: Complete AZ Failure

**Detection:** All components in one AZ become unreachable.

**Steps:**
1. Edge collectors in surviving AZs absorb 100% of traffic (auto-scaling engaged)
2. Queue partitions on failed AZ brokers are reassigned to surviving brokers (automatic; ISR-based)
3. Profile store replicas in surviving AZs are promoted to primary (automatic; < 5 min)
4. Pipeline workers are restarted in surviving AZs (auto-scaling adds capacity)
5. Destination delivery continues from surviving AZ workers (queues are multi-AZ)
6. Estimated RTO: 5 minutes (automated failover); RPO: 0 (synchronous replication)

---

## Split-Brain Recovery

### Scenario: Network Partition Between Profile Store Shards

During a network partition, two replicas of the same profile store shard may accept conflicting writes. On partition heal:

```
FUNCTION reconcile_profile_split_brain(shard):
    primary_state = read_all_profiles(shard.primary)
    replica_state = read_all_profiles(shard.replica)

    FOR EACH profile_id IN union(primary_state.keys(), replica_state.keys()):
        primary_version = primary_state.get(profile_id)
        replica_version = replica_state.get(profile_id)

        IF primary_version IS NULL:
            // Profile created on replica during partition — adopt it
            shard.primary.write(replica_version)
        ELSE IF replica_version IS NULL:
            // Profile created on primary during partition — replicate to replica
            shard.replica.write(primary_version)
        ELSE IF primary_version.version == replica_version.version:
            CONTINUE  // No conflict
        ELSE:
            // Conflict: apply CRDT merge semantics
            merged = crdt_merge(primary_version, replica_version)
            // For traits: LWW per key using event timestamp
            // For consent: most restrictive wins
            // For audience memberships: union
            shard.primary.write(merged)
            shard.replica.write(merged)
            log_audit("split_brain_resolved", profile_id, merged)

    RETURN ReconciliationResult(
        profiles_checked = len(union(primary_state.keys(), replica_state.keys())),
        conflicts_resolved = count_conflicts
    )
```

---

## Multi-Region Architecture

### Region Deployment Topology

```
Region A (Primary — EU):
  - Full CDP stack (ingest, identity, profile, audience, delivery)
  - Handles all EU-resident profiles (GDPR data residency)
  - Primary event store for EU workspaces
  - Synchronous replication within region (3 AZs)

Region B (Primary — US):
  - Full CDP stack
  - Handles all US-resident profiles
  - Primary event store for US workspaces
  - Synchronous replication within region (3 AZs)

Region C (Secondary — APAC):
  - Read replicas for profile lookup API (low-latency reads)
  - Edge collectors for ingest (events routed to primary region for processing)
  - Local delivery workers for APAC-based destinations
  - Async replication from primary region (< 5 second lag)
```

### Cross-Region Identity Resolution

Profiles may span regions when a user interacts from multiple geographies. The identity resolver handles this via a two-tier approach:

```
Tier 1: Region-Local Resolution
  - Each region resolves identities against its local identity graph
  - If all identifiers in an event match profiles in the local region, resolution
    is local-only (no cross-region traffic)

Tier 2: Global Resolution (Rare)
  - If a local resolution produces no match AND the event carries a hard identifier
    (email hash, phone hash), a cross-region lookup is performed
  - Cross-region lookup uses a global identifier directory: a lightweight index
    mapping hard identifiers to (region, profile_id) pairs
  - If the identifier is found in another region, the local region creates a
    "shadow profile" with a reference to the authoritative region
  - Profile reads for shadow profiles are proxied to the authoritative region
```

### Data Residency Enforcement

| Requirement | Implementation |
|---|---|
| EU data stays in EU | Profile store, event store, and identity graph for EU workspaces deployed exclusively in EU region |
| Processing stays in region | Pipeline workers only process events from same-region ingest queues |
| Cross-region delivery | Events from EU profiles can be delivered to destinations in other regions (the delivery is an export, not storage) |
| Audit trail | Audit log entries include the processing region; any cross-region access is flagged |

---

## Graceful Degradation Modes

### Mode 1: Identity Resolution Degradation

**Trigger:** Identity graph latency > 500ms p99 for > 5 minutes

```
Degraded behavior:
  - Disable probabilistic identity matching (only deterministic hard-ID matching)
  - Events with only anonymousId are attached to the anonymous profile without
    merge attempts
  - Queue deferred merges for batch processing when identity graph recovers
  - Impact: Temporary increase in unstitched profiles; no data loss
  - Recovery: Batch merge job processes deferred merges; typically clears within
    1 hour of identity graph recovery
```

### Mode 2: Segment Evaluation Degradation

**Trigger:** Streaming CEP backlog > 60 seconds OR CEP worker CPU > 90%

```
Degraded behavior:
  - Disable streaming evaluation for low-priority segments (segments not
    feeding real-time destinations)
  - Increase batch evaluation frequency from 15 min to 5 min for affected segments
  - Route all new segment evaluations to batch path
  - Impact: Audience membership updates delayed from < 1s to 5-15 minutes
  - Recovery: Gradually re-enable streaming evaluation as CEP backlog clears
```

### Mode 3: Destination Delivery Degradation

**Trigger:** Total destination queue depth > 100M messages OR fan-out router queue > 50M

```
Degraded behavior:
  - Enable batch coalescing: instead of per-event delivery, coalesce profile
    updates over 5-minute windows and deliver the final state only
  - Disable delivery to non-critical destinations (marked as "best-effort"
    in destination configuration)
  - Enable spillover: new delivery records written to object storage instead
    of queue; consumed by a slower background worker
  - Impact: Delivery latency increases to 5-15 minutes for coalesced destinations;
    non-critical destinations may see delays of hours
  - Recovery: Drain queues before disabling coalescing; monitor queue depth trend
```

### Mode 4: Full Ingest Throttling

**Trigger:** Pipeline processing capacity < 50% of ingest rate for > 10 minutes

```
Degraded behavior:
  - Enable per-workspace rate limiting at edge collectors
  - Return HTTP 429 (Too Many Requests) with Retry-After header
  - Prioritize workspaces by tier (enterprise > growth > free)
  - SDK clients implement exponential backoff and local event buffering
  - Impact: Events are delayed but not lost (SDK buffers locally)
  - Recovery: Scale pipeline workers; gradually lift rate limits as capacity
    recovers; drain SDK client buffers via burst allowance
```
