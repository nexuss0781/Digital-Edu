# 14.11 AI-Native Digital Storefront Builder for SMEs — Scalability & Reliability

## Scaling Strategy

### Tier 1: Stateless Service Scaling

All API services (product manager, order manager, inventory manager, store builder) are stateless and horizontally scalable behind a load balancer. Auto-scaling policies:

| Service | Scaling Metric | Scale-up Threshold | Scale-down Threshold | Min/Max Instances |
|---|---|---|---|---|
| Storefront API | Request rate + latency p95 | > 70% CPU or p95 > 100ms | < 30% CPU for 10 min | 10 / 200 |
| Product Manager | Request rate | > 60% CPU | < 25% CPU for 15 min | 5 / 100 |
| Inventory Manager | Event queue depth | > 1000 pending events | < 100 pending events | 5 / 50 |
| Store Builder | Active store creations | > 50 concurrent builds | < 10 concurrent builds | 3 / 30 |
| Order Manager | Order rate | > 500 orders/min | < 100 orders/min | 5 / 80 |

### Tier 2: Database Scaling

**Product catalog database (write-heavy, read-heavy):**
- **Sharding strategy:** Hash-based sharding on `store_id` across 64 shards. Each shard holds ~47K stores with ~2.3M products.
- **Shard rebalancing:** When a shard exceeds 80% capacity, the shard is split using consistent hashing. New stores are assigned to the lightest shard.
- **Read replicas:** 2 read replicas per shard for dashboard queries and analytics. Replica lag alert at 5 seconds.

**Order database (write-heavy, time-series-like):**
- **Partitioning:** Range-partitioned by `placed_at` month. Current month partition is on fast storage; older partitions on standard storage.
- **Hot partition:** Orders from the current day are additionally cached in a distributed cache for rapid order status lookups.

**Inventory database (contention-hot):**
- **Dedicated cluster:** Inventory records are on a separate database cluster from product and order data to isolate contention.
- **In-memory cache:** Hot inventory records (products with active sessions) are cached with write-through semantics. Cache TTL: 30 seconds.
- **Optimistic locking:** Version-based concurrency control prevents lost updates without pessimistic locks that would create bottlenecks.

### Tier 3: CDN and Edge Scaling

**Storefront delivery architecture:**

```
Customer request → CDN edge node (cache hit? → serve)
                               ↓ (cache miss)
                        Origin shield (regional cache)
                               ↓ (shield miss)
                        Origin server (SSG renderer)
                               ↓
                        Generate page → cache at all layers
```

- **CDN nodes:** 200+ edge locations globally, concentrated in India (40+ PoPs)
- **Cache hit ratio target:** > 95% for storefront pages
- **Cache invalidation:** Product update → targeted purge of affected URLs (product page, category page, homepage if featured product)
- **TTL strategy:** Static assets (images, CSS, JS): 1 year with content-hash URLs. Product pages: 5 minutes at edge, with stale-while-revalidate for 60 seconds.

### Tier 4: AI/GPU Scaling

**Content generation GPU pool:**

| Pool | Purpose | Instance Type | Min/Max | Scaling Metric |
|---|---|---|---|---|
| Sync | Store creation (latency-critical) | GPU instances (inference-optimized) | 4 / 20 | Queue depth + wait time |
| Async | Bulk generation, regeneration | GPU instances (throughput-optimized) | 2 / 15 | Queue depth |
| Image | Visual analysis + processing | GPU instances | 3 / 12 | Image queue depth |

**Cost optimization:**
- Spot/preemptible instances for async pool (60% cost savings; job checkpointing handles preemption)
- Model quantization (INT8) for inference reduces GPU memory, allowing 2× batch size per GPU
- Request coalescing: multiple small inference requests batched into single GPU call

### Tier 5: Event Bus Scaling

**Partition strategy:**
- Product events: partitioned by `product_id` (ensures per-product ordering)
- Order events: partitioned by `store_id` (ensures per-store ordering)
- Inventory events: partitioned by `product_id` (matches inventory contention patterns)

**Consumer scaling:**
- Each channel adapter runs as a consumer group with configurable parallelism
- WhatsApp adapter: 10 consumers (limited by API rate limits, not processing capacity)
- Web adapter: 50 consumers (CDN invalidation is fast)
- Marketplace adapters: 5-20 consumers per marketplace (varies by API limits)

---

## Multi-Region Strategy

### Active-Passive with Regional CDN

**Architecture:** Single primary region for writes (product management, order processing, store creation). CDN distributes read traffic globally. Analytics queries routed to regional read replicas.

**Rationale:** The merchant base is primarily India-focused. Multi-region active-active introduces catalog consistency challenges (split-brain for product updates) that are not justified until the platform expands to multiple countries.

**Regional read replicas:**
- India North (primary): All writes + reads
- India South: Read replica for storefront serving + analytics
- Singapore: Read replica for Southeast Asian storefront traffic
- Frankfurt: Read replica for European storefront traffic (if merchants target global customers)

### Future: Active-Active for Multi-Country

When the platform expands to multiple countries:
- Each country gets its own write region for local merchants
- Cross-country product sharing uses asynchronous replication
- Payment orchestration is region-specific (different gateways per country)
- Content generation models are region-specific (different languages, SEO strategies)

---

## Fault Tolerance

### Failure Scenario 1: Payment Gateway Outage

**Impact:** Customers cannot complete purchases on affected stores.

**Detection:** Health checker pings each gateway every 30 seconds. If success rate drops below 90% in a 5-minute window, gateway is marked DEGRADED.

**Response:**
1. Automatic failover to secondary gateway for affected payment methods
2. Merchant notification: "Payment processing temporarily using backup provider. No action required."
3. In-flight transactions on failed gateway: retry on backup gateway after 30-second timeout
4. Post-recovery: verify all transactions settled correctly; run reconciliation check

**RTO:** < 2 minutes (automatic failover). **RPO:** Zero (no payment data loss; in-flight transactions retry).

### Failure Scenario 2: Content Generation Pipeline Down

**Impact:** New store creation proceeds without AI-generated descriptions; products show placeholder text.

**Detection:** GPU health monitoring + inference latency tracking. Pipeline health endpoint checked every 60 seconds.

**Response:**
1. Store creation continues with template-based descriptions (pre-generated per category)
2. Products queued for AI description generation when pipeline recovers
3. Merchant notified: "Your store is live. Product descriptions will be enhanced by AI within 24 hours."
4. Priority queue: stores created during outage get first AI processing when pipeline recovers

**RTO:** Store creation unaffected (graceful degradation). AI descriptions: recovery time + queue drain. **RPO:** Zero (no data loss; requests are durably queued).

### Failure Scenario 3: Multi-Channel Sync Failure (Channel API Down)

**Impact:** Product updates not reflected on affected channel. Risk of stale prices or oversold inventory.

**Detection:** Channel adapter health check (API ping + last successful sync timestamp). Alert if no successful sync in 30 minutes.

**Response:**
1. Events continue accumulating in the channel's event queue (durable, no data loss)
2. Inventory sync failure for a channel triggers: increase safety buffer for that channel to prevent overselling
3. If channel is down > 2 hours: temporarily delist products on that channel (if supported by channel API)
4. On recovery: drain event queue in order; prioritize inventory events over catalog updates
5. Post-recovery drift scan to verify all products are consistent

**RTO:** Automatic recovery when channel API recovers. **RPO:** Zero (event queue is durable).

### Failure Scenario 4: Database Shard Failure

**Impact:** Stores on the affected shard cannot update products or process orders.

**Detection:** Database health monitoring with 10-second heartbeat. Automated failover to standby replica within 30 seconds.

**Response:**
1. Automatic failover to synchronous standby replica (promoted to primary)
2. Application reconnects automatically via connection pool health check
3. Brief write unavailability during promotion (typically 10-30 seconds)
4. Read traffic continues serving from remaining replicas

**RTO:** 30-60 seconds (automatic promotion). **RPO:** Zero for synchronous replication; < 5 seconds for async replicas.

### Failure Scenario 5: CDN Failure (Edge Node)

**Impact:** Storefront pages slow or unavailable for customers near the affected edge.

**Detection:** CDN provider's built-in health checking and automatic failover.

**Response:**
1. CDN automatically routes traffic to next-nearest healthy edge node
2. Increased latency for affected region (additional 50-100ms) but no downtime
3. If origin shield fails: direct origin requests (highest latency, highest load)
4. Origin auto-scales to handle additional load from cache misses

**RTO:** < 30 seconds (CDN automatic failover). **RPO:** N/A (read-only static content).

---

## Disaster Recovery

### Backup Strategy

| Data | Backup Frequency | Retention | Recovery Method |
|---|---|---|---|
| Product catalog DB | Continuous WAL + daily snapshot | 30 days | Point-in-time recovery (WAL replay) |
| Order DB | Continuous WAL + daily snapshot | 7 years (compliance) | Point-in-time recovery |
| Product images | Cross-region replication (real-time) | Indefinite | Serve from replica region |
| Event store | Cross-region replication | 90 days | Replay events from replica |
| Merchant configs | Daily snapshot + change log | 90 days | Restore from snapshot |
| AI models | Versioned in model registry | All versions | Deploy previous version |

### DR Procedures

**Full region failure:**
1. DNS failover to DR region (automated, < 5 minutes)
2. DR region database promoted from read replica to read-write
3. CDN origin updated to DR region endpoints
4. Storefront serving continues from CDN cache during transition
5. Event bus consumers restart from last committed offset in DR region
6. Channel adapters reconnect from DR region (channels see brief sync gap)

**DR Testing:**
- Quarterly DR drill: simulated region failure with controlled failover
- Chaos engineering: monthly random service failures in production to verify circuit breakers and fallback paths
- Data integrity verification: weekly checksum comparison between primary and DR region databases

---

## Load Shedding and Backpressure

### Tiered Load Shedding

When the system is under extreme load (festival season, viral product), load shedding is applied in priority order:

| Priority | Service | Shedding Strategy |
|---|---|---|
| P0 (never shed) | Checkout + Payment | Reserved capacity; scale aggressively |
| P1 (last resort) | Storefront rendering | Serve stale cache; extend CDN TTL to 1 hour |
| P2 (shed under pressure) | Store creation | Queue new creations; show "high demand, your store will be ready in 15 min" |
| P3 (shed early) | AI content generation | Defer all non-critical generation; use template descriptions |
| P4 (shed first) | Analytics + Reporting | Rate limit dashboard queries; serve cached analytics |

### Backpressure Signals

- **Event queue depth > 10,000:** Channel adapters apply rate limiting; batch size increases
- **GPU queue wait > 30 seconds:** New content generation requests receive degraded-quality immediate response
- **Database connection pool > 80%:** Non-critical reads (analytics, search) routed to read replicas only
- **CDN origin requests > 5,000/s:** Increase CDN TTL dynamically; enable stale-while-revalidate for all storefront pages

---

## Chaos Engineering Experiments

### Experiment 1: Payment Gateway Failover Under Load

**Hypothesis:** When the primary UPI gateway is killed during peak checkout, the routing algorithm fails over to the backup gateway within 2 minutes with zero duplicate charges.

**Procedure:**
1. During peak hours (8-10 PM), inject 100% failure rate on the primary UPI gateway's health check endpoint
2. Monitor: failover detection time, payment success rate during transition, duplicate charge count
3. Verify: in-flight transactions on the failed gateway are retried exactly once on backup with idempotency key check

**Success criteria:** Payment success rate stays above 93% during the 2-minute failover window. Zero duplicate charges. Merchant notification sent within 5 minutes.

**Observed failure mode (from first run):** The routing algorithm correctly detected degradation and rerouted traffic, but the backup gateway's success rate dropped from 96% to 89% due to sudden 3× volume increase. Resolution: pre-warm backup gateway with 20% traffic split during normal operations (cost: 0.1% higher average fee; benefit: instant capacity on failover).

### Experiment 2: CDN Origin Shield Failure

**Hypothesis:** If the regional origin shield fails, the CDN edge nodes fail through to the origin servers without violating the storefront TTFB SLO.

**Procedure:**
1. Disable the origin shield for the primary region
2. Monitor: CDN cache hit ratio, origin request rate, storefront TTFB p95, origin server CPU
3. Duration: 30 minutes during moderate traffic

**Success criteria:** TTFB p95 remains below 300ms (relaxed from 200ms SLO). Origin servers auto-scale to handle increased load. No 5xx errors served to customers.

**Observed failure mode:** Origin request rate spiked 8× (from cache miss rate increase). Origin auto-scaler took 4 minutes to scale, during which TTFB p95 reached 1.2 seconds. Resolution: added a hot-standby origin pool that activates within 30 seconds when shield failure is detected.

### Experiment 3: Event Bus Partition Leader Failure

**Hypothesis:** When an event bus partition leader fails, consumer groups rebalance and resume processing with no event loss and at most 30 seconds of additional sync lag.

**Procedure:**
1. Kill the broker hosting partition leaders for 10 product-event partitions
2. Monitor: consumer group rebalance time, event processing lag, duplicate event detection
3. Verify: all events emitted during the failure window are processed exactly once after recovery

**Success criteria:** Rebalance completes in < 30 seconds. No events lost. Duplicate delivery rate < 0.1% (handled by idempotent consumers).

### Experiment 4: Concurrent Viral Merchants on Same Shard

**Hypothesis:** When two merchants on the same database shard both go viral simultaneously, the noisy-neighbor mitigation prevents p95 query latency for other merchants on that shard from exceeding 50ms.

**Procedure:**
1. Inject synthetic traffic to two merchants on the same shard (100× normal for each)
2. Monitor: query latency for 10 other co-located merchants, connection pool utilization, read replica lag
3. Duration: 2 hours (long enough to trigger auto-migration)

**Success criteria:** Co-located merchant p95 query latency stays below 50ms. At least one viral merchant migrated to dedicated shard within 3 hours. Migration itself does not cause additional latency spike.

---

## Data Replication and Consistency Model

| Data Store | Replication | Consistency | RPO | Notes |
|---|---|---|---|---|
| **Product catalog DB** | Synchronous within region; async cross-region | Strong within shard; eventual across regions | 0 (sync); < 5s (async) | Read replicas serve dashboard queries with < 5s staleness |
| **Inventory DB** | Synchronous within cluster | Strong (linearizable for reservations) | 0 | Dedicated cluster; no async replicas for inventory writes |
| **Order DB** | Synchronous within region; async cross-region | Strong for order writes; eventual for analytics reads | 0 (sync); < 10s (async) | Time-partitioned; hot partition on fast storage |
| **Event store** | Synchronous within cluster; async cross-region | Per-partition ordered, exactly-once within consumer group | 0 (sync); < 30s (async) | Partition key = product_id for per-product ordering |
| **Search index** | Async from product events | Eventual (< 2 min from product update to searchable) | < 2 min | Weekly full reindex for consistency verification |
| **CDN edge cache** | CDN-managed replication | Eventual (TTL-based with invalidation) | TTL (5 min) or explicit purge | Product-to-URL dependency graph for targeted invalidation |

---

## Capacity Planning

### Growth Projections

| Metric | Current | +6 months | +12 months | Scaling Trigger |
|---|---|---|---|---|
| Active storefronts | 3M | 5M | 8M | Add product DB shard at 80% shard capacity |
| Total products | 150M | 250M | 400M | Add search index nodes at 70% cluster capacity |
| Daily page views | 300M | 500M | 800M | Increase CDN edge PoPs; add origin capacity |
| Daily orders | 2M | 3.5M | 6M | Scale inventory cluster; add payment gateway capacity |
| GPU inference/day | 200K | 350K | 600K | Add GPU instances; evaluate model quantization for 2× throughput |

### Cost Scaling Model

| Component | Linear With | Sub-Linear Strategy |
|---|---|---|
| CDN bandwidth | Page views | Improve cache hit ratio (95% → 97%); reduce page weight via better image compression |
| GPU compute | New products + regeneration | Attribute-level caching; speculative pre-generation; model distillation |
| Storage | Products × image variants | Lazy variant generation; deduplication for identical product images across merchants |
| Database IOPS | Orders + inventory updates | Hot data caching; cold data archival; query optimization |
| Channel sync | Product updates × channels | Delta sync (changed fields only); batch API utilization; adaptive sync frequency |

---

## Channel Adapter Scaling

### Per-Channel Scaling Characteristics

| Channel | Slowest part of the process | Max Throughput | Scaling Strategy |
|---|---|---|---|
| **Web (CDN)** | CDN invalidation API rate | 10,000 purges/s | URL batching; product-to-URL dependency graph reduces purge volume by 95% |
| **WhatsApp** | Business API rate limit (80 req/s) | ~6.9M updates/day | Priority queue (inventory first); batch endpoint; 80% utilization cap |
| **Instagram** | Graph API rate limit (200 calls/hr per app) | ~4,800/day | Multiple app registrations; batch product updates; off-peak sync for description changes |
| **Marketplaces** | Varies (100-500 req/min per marketplace) | Marketplace-dependent | Per-marketplace rate limiter; bulk feed upload where supported; FTP/SFTP feeds for large catalogs |

### Adapter Fleet Health Monitoring

| Metric | Alert Threshold | Auto-Action |
|---|---|---|
| Consumer lag (events behind) | > 5,000 events for > 10 min | Scale consumer group; increase batch size |
| API error rate | > 5% for > 15 min | Circuit breaker open; queue events; alert ops |
| Rate limit utilization | > 90% sustained | Reduce non-critical sync frequency; alert capacity planning |
| Dead letter queue depth | > 100 events | Alert ops; investigate common failure pattern |

---

## Storefront Rendering Pipeline Scaling

### ISR Worker Pool

The rendering pipeline uses a worker pool model for page regeneration:

| Worker Type | Purpose | Min/Max | Scaling Metric |
|---|---|---|---|
| **Priority workers** | Inventory-affecting page regeneration | 5 / 30 | Priority queue depth; zero-wait guarantee |
| **Standard workers** | Price and content page regeneration | 10 / 100 | Standard queue depth + age of oldest item |
| **Background workers** | Full-store regeneration (theme change, bulk update) | 3 / 20 | Background queue depth |

**Thundering herd prevention:**
- Correlated update detection: when > 100 stores trigger regeneration within 1 minute, the system identifies the common cause (bulk promotion, pricing recommendation wave, platform-wide policy change)
- Pre-scaling: if the cause is a platform-initiated action (pricing recommendation sent to N merchants), pre-scale workers 3× before the acceptance window opens
- Rate smoothing: non-priority regeneration requests are spread across a 30-minute window using jittered delays

---

## Multi-Region Failover Procedure

### Detailed Failover Sequence

```
1. Detection: Health checker detects primary region failure (3 consecutive failed probes, 30s interval)
2. Decision: Automated failover if failure persists > 2 minutes (manual override available)
3. DNS update: Route 53 health check triggers failover to DR region endpoints (propagation: 30-60s)
4. Database promotion: DR read replica promoted to read-write (30s)
5. Event bus: Consumer groups restart from last committed offset in DR region
6. CDN origin: Origin endpoint updated to DR region (CDN continues serving cached content during switch)
7. Channel adapters: Reconnect from DR region; channel APIs see brief sync gap (< 5 min)
8. Verification: Automated smoke tests validate all critical paths (store serving, payments, sync)
9. Notification: Ops team and merchant support notified; status page updated

Total failover time: 3-5 minutes
Data loss window: < 5 seconds (async replication lag)
```

### Failover Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Async replication lag | Up to 5 seconds of committed writes may be lost | WAL archival to cross-region object storage for point-in-time recovery |
| In-flight store creations | Partially created stores may be in inconsistent state | Idempotent creation pipeline; retry-on-recovery cleans up partial states |
| Payment settlements | T+1 settlement reports from gateways arrive at primary region | Gateway webhook endpoints registered in both regions; settlement reconciliation re-runs post-failover |
| GPU workload migration | GPU instances in DR region may not have latest models | Model registry syncs across regions; DR GPU pool periodically warm-started |

---

## Search Index Scaling Strategy

### Index Architecture

The search index serves two distinct workloads with different scaling characteristics:

| Workload | Scale | Latency Target | Index Type |
|---|---|---|---|
| **Customer product search** | 150M products, 15K searches/sec peak | < 50ms p95 | Full-text with faceted search; product attributes, descriptions, categories |
| **Merchant product management** | Per-merchant catalog (50-500 products) | < 100ms p95 | Filtered by `store_id`; supports merchant's dashboard search |

**Scaling approach:**
- **Sharding:** Index sharded by `store_id` hash across 32 shards. Each shard holds ~4.7M products. Customer search queries fan out across all shards with scatter-gather.
- **Replication:** 2 replicas per shard for read scaling. During peak traffic, replicas increased to 3 via auto-scaling.
- **Incremental indexing:** Product events consumed from event bus in near-real-time. Indexing lag: < 2 minutes from product update to searchable.
- **Full reindex:** Weekly during off-peak (Sunday 2-10 AM). Rebuilds index from canonical product DB. Serves as consistency verification — differences between incremental and full reindex trigger investigation.

### Index Capacity Planning

| Current | +6 months | +12 months | Action Trigger |
|---|---|---|---|
| 150M docs, 32 shards | 250M docs | 400M docs | Add shard when avg shard size > 6M docs |
| 2 replicas/shard | 2-3 replicas | 3 replicas | Add replica when search p95 > 40ms |
| 15K searches/sec peak | 25K/sec | 40K/sec | Scale replicas; evaluate caching for common queries |

---

## Inventory Hot-Spot Mitigation

### Hot Product Detection and Response

When a product receives 10× its trailing 7-day average order rate within a 1-hour window, it is classified as a "hot product" and receives special handling:

| Detection Stage | Threshold | Response |
|---|---|---|
| **Warm** | 3× average order rate | Pre-cache inventory in distributed cache; increase safety buffers |
| **Hot** | 10× average order rate | Dedicated inventory cache entry with 5-second TTL; disable async channel sync for this product (sync becomes priority) |
| **Critical** | 50× average rate or stock < 10 units with active demand | Queue-based reservation with strict serialization; real-time dashboard alert to merchant |

### Contention Reduction for Hot Products

```
Standard path (cold product):
  Reserve → Optimistic lock on inventory row → Update → Emit event

Hot product path:
  Reserve → Claim from pre-decremented counter in distributed cache
    → If cache counter > 0: decrement atomically → confirm reservation
    → If cache counter = 0: check DB (cache may be stale) → if DB > 0: refill cache
    → Async: persist reservation to DB within 1 second
```

This cache-first approach reduces database contention from 500 req/s to ~50 req/s for the hottest products, with the cache absorbing 90% of reservation attempts.

---

## Data Lifecycle Management

### Storage Tiering Strategy

| Data Age | Storage Tier | Access Pattern | Cost (relative) |
|---|---|---|---|
| 0-30 days | Hot (SSD-backed) | Active queries, real-time dashboards | 1× |
| 30-90 days | Warm (standard) | Occasional analytics, merchant history lookup | 0.4× |
| 90 days - 7 years | Cold (archive) | Compliance queries, audit requests | 0.1× |
| > 7 years | Deleted (non-compliance data) or Archived (compliance-required) | None / rare legal requests | 0.05× |

### Automated Tier Migration

```
Daily job (2 AM):
  1. Identify order records > 30 days old → migrate to warm tier
  2. Identify order records > 90 days old → migrate to cold tier
  3. Identify analytics events > 90 days old → aggregate and archive; delete raw events
  4. Identify product images for deleted stores > 90 days → purge from object storage and CDN
  5. Verify compliance-required data has not been prematurely deleted
```

### Image Deduplication

Across 3 million stores, merchants frequently upload identical or near-identical product images (same product sourced from the same manufacturer). The platform implements perceptual hashing to detect duplicate images:

| Deduplication Level | Method | Storage Savings | Impact |
|---|---|---|---|
| **Exact match** | SHA-256 hash comparison | ~5% of total image storage | Zero quality impact |
| **Near-duplicate** | Perceptual hash (pHash, dHash) with Hamming distance < 5 | ~8% additional | Shared base image; per-merchant metadata preserved |
| **Cross-merchant** | Not deduplicated (privacy boundary) | N/A | Each merchant's images are isolated even if identical |

## AI Release Ladder

Every AI model or capability change in this system MUST follow this rollout sequence:

| Stage | Description | Gate Criteria |
|-------|-------------|---------------|
| 1. Offline Evaluation | Benchmark against historical ground truth | Meets baseline metrics |
| 2. Shadow Mode | Run in parallel with production, compare outputs | No regression on key metrics |
| 3. Canary (Blast-Radius Capped) | 1-5% traffic, human review of all outputs | Error rate < threshold |
| 4. Human-Reviewed Production | AI recommends, human approves all actions | Approval rate > 90% |
| 5. Limited Autonomous Production | AI acts within pre-approved boundaries | Continuous monitoring, no alerts |
| 6. Instant Rollback | One-click revert to previous model/rules | < 5 min rollback time |

**Note:** AI capabilities that directly interact with end users or execute actions on their behalf must reach Stage 4 (human-reviewed production) with domain-expert sign-off before deployment. Stage 5 limited autonomy applies only to well-bounded, low-risk action categories with established rollback procedures.
