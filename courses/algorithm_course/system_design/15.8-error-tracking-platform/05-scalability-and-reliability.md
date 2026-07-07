# Scalability & Reliability — Error Tracking Platform

## Scalability

### Horizontal vs Vertical Scaling

| Component | Strategy | Rationale |
|-----------|----------|-----------|
| Relay gateway | Horizontal | Stateless; add nodes behind load balancer for more ingestion capacity |
| Message bus | Horizontal (partitions) | Add partitions for throughput; add brokers for capacity |
| Processing workers | Horizontal | Stateless event processors; scale with bus consumer lag |
| Symbolicator | Horizontal + Vertical | CPU-intensive parsing benefits from larger instances; add nodes for throughput |
| Columnar store | Horizontal (sharding) | Shard by project + time; add nodes for storage and query capacity |
| Relational DB | Vertical primary + Horizontal reads | Primary for writes; read replicas for UI queries |
| Cache cluster | Horizontal (sharding) | Consistent hashing across Redis nodes |

### Auto-Scaling Triggers

| Component | Scale-Up Trigger | Scale-Down Trigger | Min/Max Nodes |
|-----------|-----------------|-------------------|---------------|
| Relay gateway | CPU > 60% OR p99 latency > 200ms | CPU < 30% for 10 min | 10 / 100 |
| Processing workers | Consumer lag > 30s | Lag < 5s for 15 min | 20 / 200 |
| Symbolicator | CPU > 70% OR queue depth > 100 | CPU < 30% for 10 min | 5 / 50 |
| Query cluster | Query p99 > 3s | p99 < 1s for 30 min | 5 / 30 |

### Database Scaling Strategy

**Columnar Store (Events):**
- **Sharding key:** `(project_id, toDate(received_at))` — ensures all events for a project on a given day are co-located for efficient queries
- **Replication:** 2 replicas per shard for read availability and fault tolerance
- **Time-based partitioning:** Daily partitions enable efficient TTL-based data expiration (drop entire partition vs. row-by-row delete)
- **Tiered storage:** SSD for hot tier (7 days), HDD for warm tier (30 days), object storage for cold (90+ days)

**Relational Store (Issues):**
- **Primary for writes:** Single primary handles issue upserts, state changes, assignments
- **Read replicas:** 2 replicas for UI/API read queries (issue list, search)
- **Partitioning:** Range partition by `project_id` for large installations; most queries are project-scoped
- **Connection pooling:** PgBouncer in transaction mode to handle 1000s of concurrent worker connections

### Caching Layers

| Layer | What's Cached | TTL | Eviction |
|-------|--------------|-----|----------|
| **L1: In-process** | Parsed source maps (LRU, 50 per worker) | 1 hour | LRU when memory exceeds 2 GB |
| **L2: Distributed cache** | Fingerprint → issue_id mapping | 24 hours | LRU; invalidated on issue merge/split |
| **L2: Distributed cache** | Project config (DSN, rate limits, alert rules) | 5 minutes | Push invalidation on config change |
| **L2: Distributed cache** | Quota counters (events used / limit) | Until reset | Atomic increment; TTL aligned to billing period |
| **L2: Distributed cache** | Spike baseline (hourly rates) | 48 hours | Recomputed daily |
| **L3: Object storage** | Source map files | Release lifetime | Explicit deletion on release cleanup |

### Hot Spot Mitigation

**Problem:** A single project experiencing a massive error spike can overwhelm:
- The message bus partition (if partitioned by project)
- The columnar store shard (if sharded by project)
- The cache node holding that project's fingerprint data

**Mitigations:**
1. **Sub-partitioning:** High-volume projects are automatically assigned multiple message bus partitions (detected by monitoring per-project throughput)
2. **Write spreading:** Events are written to the columnar store in micro-batches (every 1 second or 1000 events, whichever comes first) — amortizes per-event overhead
3. **Cache key distribution:** Fingerprint cache keys include a hash prefix that distributes across multiple cache nodes, preventing a single project from hot-spotting one node
4. **Quota-based throttling:** Once spike protection triggers, the relay reduces accepted events before they reach downstream systems

---

## Reliability & Fault Tolerance

### Single Points of Failure Identification

| Component | SPOF Risk | Mitigation |
|-----------|----------|------------|
| Relay gateway | **Low** — stateless, multi-node | Load balancer distributes; SDK retries handle individual node failures |
| Message bus | **Medium** — central data path | Multi-broker cluster with replication factor 3; automatic partition leader election |
| Processing workers | **Low** — stateless consumers | Consumer group rebalancing handles worker failures; at-least-once processing |
| Relational DB primary | **High** — single write path | Synchronous replication to hot standby; automatic failover with <30s downtime |
| Columnar store | **Medium** — query availability | Replicated shards; queries routed to healthy replicas |
| Symbolicator | **Low** — stateless with cache | Degradation: events stored unsymbolicated; retro-symbolicated when symbolicator recovers |
| Cache cluster | **Medium** — quota enforcement | Redis Cluster with automatic failover; degradation: fall back to DB for fingerprint lookup |

### Redundancy Strategy

- **Relay:** N+2 redundancy across 3 availability zones; DNS-based failover
- **Message bus:** 3x replication per partition across AZs; in-sync replica set of 2 for acknowledge
- **Processing workers:** 2x the minimum needed capacity to absorb node failures during peak
- **Storage:** All writes replicated to 2+ AZs before acknowledgment; cross-region async replication for disaster recovery

### Failover Mechanisms

**Relay failover:**
- SDKs maintain a prioritized list of relay endpoints (primary + fallback)
- If the primary returns errors or times out, the SDK switches to the fallback
- DNS health checks remove unhealthy relay nodes from the load balancer

**Database failover:**
- Relational DB: Streaming replication with automatic failover via consensus-based leader election (e.g., Patroni). Read replicas promote automatically. Typical failover time: 10-30 seconds.
- Columnar store: Query routing layer detects unhealthy shards and redirects to replicas. Write path fails over to a replica promoted to primary.

**Cache failover:**
- Redis Cluster with sentinel for automatic master-replica failover
- If entire cache cluster is unavailable: relay falls back to "allow all" (don't reject events due to cache failure); fingerprint lookup falls back to relational DB (slower but correct)

### Circuit Breaker Patterns

| Circuit | Trigger | Open State Behavior | Recovery |
|---------|---------|-------------------|----------|
| Symbolicator | 50% error rate over 30s | Skip symbolication; store raw frames | Half-open after 30s; close after 10 successes |
| External integrations (Slack, PagerDuty) | 3 consecutive failures | Queue notifications for retry | Half-open after 60s |
| Relational DB reads | p99 > 5s over 1 min | Serve from cache; degrade UI (show cached counts) | Half-open after 15s |
| Source map object storage | 5 consecutive fetch failures | Skip symbolication for this release | Half-open after 30s |

### Retry Strategies

| Operation | Retry Policy | Backoff | Max Retries | Idempotency |
|-----------|-------------|---------|-------------|-------------|
| SDK → Relay | Exponential with jitter | 1s, 2s, 4s, 8s | 4 | Event ID deduplication |
| Processing worker failure | Requeue to message bus | Immediate (different worker) | 3 | Event ID deduplication |
| Symbolication failure | Retry with backoff | 5s, 30s, 5m | 3 | Idempotent by event_id |
| Alert notification delivery | Exponential with jitter | 10s, 30s, 60s, 300s | 5 | Idempotent by (rule_id, event_id) |
| DB write failure | Immediate retry | 100ms, 500ms, 2s | 3 | UPSERT is idempotent |

### Graceful Degradation

| Scenario | Degraded Behavior | User Impact |
|----------|-------------------|-------------|
| Symbolicator down | Events stored with raw stack traces; symbolicated later | Minified frames in UI temporarily; grouping may be less accurate |
| Columnar store slow | Issue counts show "approximate" badge; search results delayed | Dashboard numbers lag; search takes longer |
| Cache cluster down | Fingerprint lookups hit DB directly; quota checks use pessimistic estimation | Higher DB load; possible brief over-acceptance of events |
| Alert engine behind | Alerts delayed but not lost; catch up when queue drains | Late notifications for new issues/regressions |
| Relational DB read replica lag | UI shows slightly stale issue metadata | Event counts may be a few seconds behind |

### Bulkhead Pattern

- **Ingestion bulkhead:** Relay nodes are partitioned into pools — standard and premium. Premium customers' traffic is isolated from standard traffic, ensuring SLA guarantees during spikes.
- **Processing bulkhead:** Message bus has separate topics for high-priority (first event for a new issue, regressions) and standard events. High-priority consumers are never starved by bulk event processing.
- **Query bulkhead:** Columnar store separates query resources for real-time dashboards (short queries, strict timeout) and ad-hoc search (long queries, relaxed timeout). A complex search query cannot starve dashboard rendering.

---

## Disaster Recovery

### RTO / RPO

| Component | RTO | RPO | Strategy |
|-----------|-----|-----|----------|
| Ingestion pipeline | 5 minutes | 0 (SDKs retry) | Multi-AZ active-active; DNS failover |
| Event data (columnar) | 1 hour | 5 minutes | Cross-region async replication |
| Issue metadata (relational) | 15 minutes | 1 minute | Synchronous standby in same region; async cross-region |
| Source maps (object storage) | 30 minutes | 0 (replicated) | Multi-region object storage with versioning |
| Cache (Redis) | 5 minutes | Reconstructible | Cache is ephemeral; rebuilt from DB on recovery |

### Backup Strategy

- **Relational DB:** Continuous WAL archiving to object storage. Point-in-time recovery to any second within the last 7 days. Daily base backups retained for 30 days.
- **Columnar store:** Daily snapshots per shard to object storage. Incremental backups for each partition.
- **Source maps:** Already in replicated object storage. Versioned to prevent accidental overwrites.
- **Configuration:** Infrastructure-as-code; all relay/pipeline configuration version-controlled.

### Multi-Region Considerations

- **Active-passive:** Primary region handles all traffic. DR region receives async-replicated data. Failover promoted manually or automatically if primary is unreachable for >5 minutes.
- **Data residency:** EU customers can opt into EU-only data processing where events never leave the EU region. Requires a full regional deployment (relay → bus → processing → storage) within the EU.
- **SDK failover:** SDKs are configured with primary and secondary relay endpoints. If primary is unreachable (3 consecutive failures with 5-second timeout), SDK switches to secondary.
- **Cross-region latency:** Source maps are replicated to all regions where SDKs send events, ensuring symbolication doesn't require cross-region fetches.

---

## Capacity Planning

### Growth Projection Formulas

```
Storage Growth (monthly):
  hot_storage = daily_events × avg_compressed_size × hot_retention_days
  warm_storage = daily_events × avg_compressed_size × warm_retention_days
  cold_storage = daily_events × avg_compressed_size × cold_retention_days
  source_map_storage = daily_uploads × avg_map_size × map_retention_days
  total_monthly_growth = (hot + warm + cold + source_map) × 1.1  // 10% overhead

Processing Capacity:
  relay_nodes = peak_events_per_sec / events_per_sec_per_node × 1.5  // 50% headroom
  worker_nodes = peak_events_per_sec / processing_rate_per_node × 2.0  // spike absorption
  symbolicator_nodes = symbolication_eligible_events_per_sec / symbolications_per_sec_per_node × 1.5

Fingerprint Cache Sizing:
  active_fingerprints = total_projects × avg_active_issues_per_project
  cache_memory = active_fingerprints × (64 bytes hash + 8 bytes issue_id + 32 bytes metadata)
  // Example: 50K projects × 100 active issues = 5M entries × 104 bytes = 520 MB
```

### Caching Strategy

| Layer | What's Cached | Size Formula | Hit Rate Target | Miss Penalty |
|-------|--------------|-------------|----------------|-------------|
| **L1: In-process (per worker)** | Parsed source maps (LRU, top 50) | 50 × 300 MB = 15 GB per node | >80% | 500ms-3s (parse from raw) |
| **L2: Distributed (Redis)** | Fingerprint → issue_id | 5M entries × 104 B = 520 MB | >90% | 2ms DB round-trip |
| **L2: Distributed (Redis)** | Project config (DSN, rate limits) | 50K projects × 2 KB = 100 MB | >99% | 5ms DB round-trip |
| **L2: Distributed (Redis)** | Spike baselines (hourly rates) | 50K projects × 168 × 8 B = 67 MB | >95% | 100ms (recompute from columnar) |
| **L3: Object storage** | Source map files | Thousands of releases × 5 MB = TBs | >99% | 50-200ms (object storage GET) |

### Load Testing Strategy

| Scenario | Traffic Pattern | Duration | Success Criteria |
|----------|---------------|----------|-----------------|
| **Steady-state** | Constant 5,800 events/sec across 50K projects | 1 hour | p99 processing latency < 15s; 0 rejected events |
| **Spike absorption** | 100x spike (580K events/sec) for 5 minutes | 10 min total | Spike protection triggers; no pipeline crash; recovery < 2 min |
| **Deploy surge** | 1,000 simultaneous deploys; 50K source map uploads in 1 hour | 2 hours | Symbolicator pre-warm completes; retro-symbolication queue < 10K |
| **Thundering herd** | New release with cold source map cache; 10K events in first 10 seconds | 15 min | Only 1 parse per source map; others wait on shared future |
| **Quota exhaustion** | Single project hits quota limit during spike | 30 min | Events rejected at relay; other projects unaffected |
| **Failover** | Kill primary DB; kill 50% of workers | 1 hour | Alert pipeline delivers within 60s; data loss = 0 |
| **Cache failure** | Flush entire Redis cluster | 30 min | Platform continues with degraded latency; cache rebuilds within 5 min |

---

## Streaming Patterns

### Real-Time Issue Stream

The platform provides a WebSocket-based real-time event stream for the issue detail page, enabling developers to watch new events arrive during active debugging:

```
WebSocket: /api/0/issues/{issue_id}/events/stream/

Message format:
{
  "type": "event",
  "data": {
    "event_id": "evt-uuid",
    "timestamp": "2026-03-10T09:15:23Z",
    "release": "frontend@2.4.1",
    "user": {"id": "hash-123"},
    "browser": "Chrome 120",
    "os": "macOS 14.2"
  }
}
```

**Fan-out strategy:** Processing workers publish new event notifications to a pub/sub channel keyed by `issue_id`. WebSocket servers subscribe to the channels for active connections. When an event is processed, the notification is published once and fanned out to all connected clients watching that issue.

### Event Processing Pipeline Patterns

| Pattern | Implementation | Benefit |
|---------|---------------|---------|
| **Micro-batching** | Workers accumulate events for 1s or 1K events before columnar store write | Reduces write amplification; amortizes per-batch overhead |
| **Priority channels** | Separate message bus topics for first-event-per-issue, regressions, and bulk events | Ensures new issue alerts are not delayed by bulk processing |
| **Dead letter queue** | Events that fail processing 3 times are moved to a DLQ with error context | Prevents poisoned events from blocking the pipeline |
| **Backpressure propagation** | Consumer lag metrics trigger relay-side sampling before bus overflow | End-to-end backpressure without data loss |

---

## Migration Strategy: Monolith to Distributed Pipeline

Many error tracking platforms start as monolithic applications and must migrate to a distributed architecture as scale increases. This phased approach minimizes risk:

### Phase 1: Extract the Ingestion Layer (Week 1-4)

Deploy relay gateways in front of the monolith. The relay handles rate limiting and spike protection, forwarding accepted events to the existing monolith. **Benefit:** Immediate spike protection without modifying the processing pipeline.

### Phase 2: Introduce the Message Bus (Week 4-8)

Insert a message bus between the relay and the monolith. The monolith consumes from the bus instead of receiving direct HTTP requests. **Benefit:** Decouples ingestion from processing; enables replay for debugging.

### Phase 3: Extract Processing Workers (Week 8-16)

Break the monolith's event processing into stateless workers that consume from the bus. Start with normalization and fingerprinting as separate services. **Benefit:** Independent scaling of processing stages; teams can deploy processing logic independently.

### Phase 4: Migrate to Columnar Analytics (Week 16-24)

Dual-write events to both the existing relational store and a new columnar store. Gradually shift read queries to the columnar store. Once verified, stop writing events to the relational store. **Benefit:** 10-100x improvement in aggregation query performance.

---

## Operational Maturity Model

| Level | Capability | Key Metrics | Automation |
|-------|-----------|------------|------------|
| **L1: Reactive** | Manual scaling; alert-driven operations | Uptime, basic throughput | Manual deploy; script-based recovery |
| **L2: Measured** | Capacity planning; SLO tracking | Error budget burn rate; consumer lag | Auto-scaling for relay/workers; automated DB failover |
| **L3: Proactive** | Predictive scaling; chaos engineering | Spike prediction accuracy; cache efficiency | Pre-scale before predicted spikes; automated chaos experiments |
| **L4: Optimized** | Cost-per-event optimization; multi-region active-active | Cost/event; cross-region latency | Automatic region routing; workload migration |
| **L5: Self-Healing** | Autonomous remediation; ML-driven operations | MTTR < 1 min; zero-touch recovery | Auto-remediation for known failure modes; ML-based anomaly response |

---

## Cost Attribution Model

| Component | Cost Driver | Per-Event Cost (at scale) | Optimization Lever |
|-----------|-----------|--------------------------|-------------------|
| **Ingestion** | Network bandwidth + relay compute | ~$0.000001 | Edge caching; compression |
| **Processing** | CPU for normalization + fingerprinting | ~$0.000005 | Batch processing; skip enrichment for sampled events |
| **Symbolication** | CPU for VLQ parsing (cache miss only) | ~$0.00005 (amortized) | Pre-warm cache; limit source map size |
| **Columnar storage** | Disk + compression | ~$0.000003/day retained | Tiered retention; aggressive compression |
| **Relational storage** | IOPS for issue upserts | ~$0.000002 | Write coalescing; approximate counters |
| **Cache** | Memory for fingerprint + config cache | ~$0.0000005 | TTL tuning; eviction optimization |
| **Alert delivery** | Notification channel API calls | ~$0.001 per alert | Frequency capping; deduplication |
| **Total per-event (amortized)** | | **~$0.00002** | At 500M events/day = ~$10K/day |

---

## Concurrent Access Scaling

### Writer Scaling Strategy

| Challenge | Solution | Details |
|-----------|---------|---------|
| Multiple workers writing same issue | Write coalescing buffer | Accumulate per-issue deltas locally, flush every 1s |
| Columnar store write contention | Time-based partitioning | Daily partitions per project isolate write paths |
| Source map upload during deploy surge | Upload queue with rate limiting | Max 100 concurrent uploads per organization |
| Quota counter race condition | Atomic Redis INCRBY | Accept ~1-2% overage; reconcile hourly |

### Reader Scaling Strategy

| Challenge | Solution | Details |
|-----------|---------|---------|
| Dashboard queries during spike investigation | Read replicas for relational DB | 2 replicas for issue list queries |
| Event search across large time windows | Columnar store shard replicas | Queries routed to least-loaded replica |
| Real-time event stream for issue detail | WebSocket fan-out via pub/sub | One publish per event; fan-out at WebSocket tier |
| Source map download during retro-symbolication | CDN-backed object storage | Cache-Control headers for immutable releases |

---

## Real-World Scaling Patterns

### Pattern 1: Sentry's ClickHouse Migration

**Context:** Sentry migrated from PostgreSQL to ClickHouse for event storage, processing billions of events per month.

**Challenge:** PostgreSQL performed well for issue metadata but degraded at analytical query patterns — "count errors by release, grouped by browser, in the last 7 days" required scanning millions of rows in a row-oriented format.

**Solution:**
- Introduced Snuba as an abstraction layer over ClickHouse, providing query translation, schema management, and multi-tenant isolation
- Partitioned by `(project_id, toDate(received_at))` for efficient per-project time-bounded scans
- Used `LowCardinality` encoding for high-frequency string columns (platform, browser, environment) — reducing storage by 5-10x
- Implemented query timeouts (30s for dashboard queries, 120s for ad-hoc search) to prevent runaway queries from affecting other tenants

**Result:** 100x improvement in aggregation query performance; 15x storage reduction via columnar compression; enabled sub-second dashboard rendering at billion-event scale.

### Pattern 2: Multi-Tenant Isolation at Scale

**Context:** Large SaaS error tracking platforms serve 10K+ organizations with wildly different event volumes — from 100 events/day to 100M events/day.

**Challenge:** A single organization's error spike can consume disproportionate resources, degrading service for all tenants (noisy neighbor problem).

**Solution — Four-layer isolation:**
1. **Relay tier:** Separate relay pools for premium and standard tiers; per-project rate limiting
2. **Bus tier:** High-volume projects assigned dedicated message bus partitions; priority topics for premium customers
3. **Processing tier:** Worker pools partitioned by customer tier; premium workers never starved by standard processing
4. **Storage tier:** ClickHouse cluster with per-project resource quotas; query governor limits concurrent queries per organization

**Result:** Premium tier SLA (99.99% ingestion, <5s processing p99) maintained even during standard tier spikes.

### Pattern 3: Edge Relay Network

**Context:** Global platform serving SDKs from applications deployed in 50+ countries.

**Challenge:** SDK-to-relay latency of 200-400ms for users far from the processing region; affects event delivery reliability during high-error scenarios (when networks are also often degraded).

**Solution:**
- Deploy lightweight relay nodes in 15+ edge locations (same locations as CDN PoPs)
- Edge relays perform DSN validation, rate limiting, envelope parsing, and PII scrubbing locally
- Accepted events are forwarded to the core processing region via an internal message bus bridge
- Source map uploads are replicated to edge locations for local symbolicator cache warming

**Result:** SDK-to-relay latency reduced to <50ms for 95% of global traffic; 30% reduction in event loss during network disruptions.

---

## Data Quality Integration

### Quality Gates in the Ingestion Pipeline

| Gate | Location | Check | Action on Failure |
|------|----------|-------|-------------------|
| **Envelope integrity** | Relay | Valid envelope structure, correct content-type, within size limits | Reject with 400; SDK retries not recommended |
| **DSN validity** | Relay | DSN key exists, project active, not suspended | Reject with 401; SDK reports auth error |
| **Schema conformance** | Normalizer | Event matches expected schema; required fields present | Strip invalid fields; warn in processing log |
| **Timestamp sanity** | Normalizer | Event timestamp within ±24 hours of server time | Adjust to server timestamp; tag as `clock_skew` |
| **Stack trace integrity** | Normalizer | At least one frame with filename or function name | Accept but warn; fingerprinting falls back to message-based |
| **PII compliance** | Normalizer | Scrubbing rules applied; no unscrubbed PII in configured fields | Apply server-side scrubbing; log compliance action |

### Release Health Accuracy

Crash-free session rate is a critical business metric that must be accurate within 0.1% for release decisions:

| Accuracy Challenge | Impact | Mitigation |
|-------------------|--------|------------|
| Session start/end timing | Sessions not closed properly (app kill, crash) | SDK sends session heartbeats; server infers session end after timeout |
| Duplicate session reports | Same session counted twice after SDK retry | Deduplication on `session_id` |
| Late-arriving sessions | Session data arrives after release health dashboard is computed | Recompute crash-free rate with configurable staleness window (default: 1 hour) |
| Sampling interaction | Spike protection samples events but not sessions | Sessions tracked separately from error events; never sampled |

---

## Degradation Priority Matrix

During a major incident affecting the platform itself, components are shed in this order:

| Priority | Component | Shed Strategy | User Impact |
|----------|----------|--------------|-------------|
| **P0 (Never shed)** | Event ingestion (relay → bus) | Scale relay indefinitely; queue in bus | Events never lost |
| **P1 (Last resort)** | Alert pipeline | Delay evaluation; queue alerts | Alerts delayed but not lost |
| **P2 (Shed if necessary)** | Symbolication | Store raw frames; retro-symbolicate later | Minified stack traces in UI temporarily |
| **P3 (Shed early)** | Real-time dashboard updates | Serve cached/stale dashboards | Dashboard numbers lag by minutes |
| **P4 (Shed first)** | Ad-hoc search queries | Return "service degraded" for complex queries | Search temporarily unavailable |
| **P5 (Always shed under load)** | Aggregation batch jobs | Postpone rollup computation | Trend charts show stale data |

---

## Storage Tiering Strategy

### Columnar Store Tiering

| Tier | Storage Medium | Retention | Access Pattern | Compression | Cost Ratio |
|------|---------------|-----------|---------------|-------------|-----------|
| **Hot** | NVMe SSD | 24 hours | Real-time dashboards, active investigation | LZ4 (fast) | 1x (baseline) |
| **Warm** | SSD | 7-30 days | Search queries, trend analytics | ZSTD level 3 | 0.4x |
| **Cold** | HDD | 30-90 days | Compliance, forensic investigation | ZSTD level 9 | 0.1x |
| **Archive** | Object storage | 90-365 days | Legal hold, rare access | ZSTD level 19 | 0.03x |

### Tiering Migration Policy

```
Tier transition triggers:
  Hot → Warm:  partition_age > 24 hours
  Warm → Cold: partition_age > 30 days
  Cold → Archive: partition_age > 90 days
  Archive → Delete: partition_age > retention_policy (per org)

Transition process:
  1. Background worker identifies eligible partitions
  2. Recompress data to target tier's compression level
  3. Move data to target storage medium
  4. Update partition metadata in the catalog
  5. Verify data integrity (checksum comparison)
  6. Delete source data from previous tier
```

### Source Map Storage Optimization

Source maps are immutable after upload and follow a predictable access pattern:

| Phase | Access Frequency | Storage Strategy |
|-------|-----------------|-----------------|
| First 24h after upload | Very high (all events from new release) | In-memory LRU cache on symbolicator nodes |
| Days 2-7 | High (ongoing errors from this release) | Distributed Redis cache |
| Days 7-30 | Moderate (decreasing as new releases deployed) | Object storage with CDN |
| Days 30-90 | Low (retro-symbolication, forensic investigation) | Object storage cold tier |
| After 90 days (default) | Negligible | Deleted per retention policy |

---

## Database Compaction and Maintenance

### ClickHouse Maintenance Schedule

| Task | Frequency | Purpose | Impact During Execution |
|------|-----------|---------|----------------------|
| Background merges | Continuous | Consolidate small parts into larger ones | 10-20% CPU overhead; transparent to queries |
| TTL-based partition drops | Daily (3 AM UTC) | Remove expired partitions | Brief metadata lock; no query impact |
| OPTIMIZE TABLE (final merge) | Weekly (Sunday 2 AM) | Force-merge to optimal part count | High I/O for 1-2 hours; elevated query latency |
| Orphan part cleanup | Weekly | Remove failed mutation artifacts | Negligible impact |
| Distributed table health check | Daily | Verify replica consistency | Read-only; no write impact |

### PostgreSQL Maintenance

| Task | Frequency | Purpose | Impact |
|------|-----------|---------|--------|
| VACUUM ANALYZE on issues table | Every 6 hours | Reclaim dead tuples from frequent UPSERTs | Brief table-level lock; <1s for typical table |
| Index REINDEX | Monthly | Rebuild bloated indexes from high update rate | Can run CONCURRENTLY; minimal impact |
| Connection pool health check | Every 5 min | Verify PgBouncer pool health, kill stale connections | Transparent |
| WAL archiving verification | Continuous | Ensure point-in-time recovery capability | Transparent; alert if lag > 5 minutes |
