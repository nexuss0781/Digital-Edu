# 13.4 AI-Native Real Estate & PropTech Platform — Scalability & Reliability

## Scalability Architecture

### Property Data Ingestion Scaling

The platform ingests data from 500+ MLS feeds, each with different update frequencies (real-time RETS/Web API, hourly batch, daily flat file), plus county recorder feeds, satellite imagery, and building sensor networks. The ingestion layer must handle both the steady-state throughput (~50K property updates/hour from MLS feeds) and bursty peaks (quarter-end when commercial leases report, spring/summer when residential listings surge 3-5x).

**MLS feed processing:**
- Each MLS feed is assigned a dedicated ingestion worker that polls at the feed's native frequency
- Workers are stateless and run behind a work queue—if a worker fails, another picks up the feed within 60 seconds
- Schema normalization is configured per-feed using a mapping definition that translates source-specific fields to the canonical property schema
- New MLS integrations are onboarded by writing a mapping definition (typically 2-4 hours of configuration, not code changes)

**Horizontal scaling strategy:**
- Ingestion workers scale horizontally with the number of MLS feeds (1 worker per 5-10 feeds)
- Entity resolution is partitioned by geography (state-level sharding) because property matching is inherently local—a property in Texas will never match a record from Massachusetts
- The entity resolution index is replicated across 3 nodes per shard for read availability during the matching process

**Satellite imagery pipeline:**
- Imagery is large (10-50 GB per coverage update) and processed asynchronously
- A dedicated GPU pool handles image segmentation (vegetation analysis, construction detection, pool identification)
- Results are written to the property feature store and trigger AVM recomputation for affected properties
- Processing is parallelized by geographic tile; tiles are independent and can run on separate GPU workers

### AVM Computation Scaling

The nightly batch valuation of 146M properties is the largest compute workload in the platform.

**Batch architecture:**
```
Phase 1: Feature Assembly (2 hours)
  - Read property features from columnar store
  - Compute derived features (days since last sale, neighborhood median, trend momentum)
  - Partition by geography (state-level, ~50 partitions)
  - Each partition processed independently on a worker pool

Phase 2: Comparable Selection (4.1 hours) — Slowest part of the process
  - For each property, query the ANN index for top-100 candidates
  - Re-rank candidates with full feature comparison
  - Select top-5 with diversity constraint
  - Parallelized across 500 workers, each processing ~292K properties

Phase 3: Model Inference (73 minutes)
  - Run ensemble (GBT + SAR + temporal) for each property
  - GBT inference: ~5 ms/property (CPU)
  - SAR inference: ~8 ms/property (requires spatial weight matrix lookup)
  - Temporal model: ~2 ms/property (census-tract index lookup)
  - Ensemble combination: ~1 ms/property

Phase 4: Compliance Check (30 minutes)
  - Run disparate impact screening on batch results
  - Flag properties where valuation error exceeds demographic parity threshold
  - Generate compliance report for regulatory review
```

**On-demand scaling:**
- On-demand valuation requests (500K/day, peak 20/sec) are handled by a stateless serving fleet
- Each server caches the ANN index in memory (~11 GB) and loads model weights at startup
- Auto-scaling based on request rate with a target latency of p99 ≤ 30s
- During lending surges (spring home-buying season), the fleet scales from 10 to 50 instances

### Building IoT Ingestion Scaling

2M sensor readings per second is the platform's highest throughput requirement.

**Architecture:**
- Building edge gateways aggregate and batch sensor readings locally (1-second batches), reducing the per-message overhead
- Readings flow through a distributed stream processing layer partitioned by building_id
- Each building's digital twin is managed by a dedicated process (actor model) that handles writes sequentially and serves reads from snapshots
- 50,000 buildings → 50,000 twin actors, distributed across a cluster of ~500 nodes (100 buildings per node)

**Time-series storage:**
- Sensor readings are stored in a time-series database optimized for write throughput and compression
- Delta encoding + run-length encoding achieves 10x compression on typical HVAC sensor data (temperatures change slowly)
- Data retention: 30-day hot (full resolution), 1-year warm (5-minute aggregates), 5-year cold (hourly aggregates)
- Tiered storage: hot data on SSDs, warm on HDDs, cold in object storage

### Property Search Scaling

10,000 queries/sec peak with p99 ≤ 200ms requires careful index design and caching.

**Index partitioning:**
- The property corpus (146M documents) is partitioned into 20 shards by geography (metro-area-based partitioning ensures that most queries hit a single shard)
- Each shard is replicated across 3 nodes for read availability and load balancing
- For cross-geography queries (e.g., "condos under $300K anywhere in California"), a scatter-gather layer fans out to relevant shards and merges results

**Caching strategy:**
- Popular searches (top 1,000 query patterns by volume) are cached with 15-minute TTL
- User personalization features are cached in a low-latency key-value store (≤ 2ms lookup)
- Geospatial filters (H3 hex to property list) are pre-computed and cached for resolution-9 hexagons

**Visual search optimization:**
- The 4.4 TB embedding store for listing photos is too large for a single server
- Embeddings are sharded by geography (same partitioning as the text index) and loaded into GPU memory for ANN search
- Each shard's HNSW index fits in 25 GB GPU memory; queries execute in ~3ms

---

## Reliability Architecture

### Building Safety System Reliability (99.999%)

The building safety path is the platform's highest-reliability requirement because failure can endanger human life.

**Edge autonomy:** Each building's edge gateway operates independently of the cloud platform. Safety logic, sensor thresholds, and actuator commands are compiled into the edge gateway firmware. The gateway continues operating through:
- Cloud connectivity loss (days to weeks)
- Local network partition (sensor-to-gateway connection still works via dedicated BACnet/IP network)
- Edge gateway power loss (UPS provides 4-hour battery backup; fail-safe defaults on power loss)

**Redundancy:**
- Dual edge gateways per building (active-standby) with sub-second failover
- Safety-critical sensors have redundant installations (two smoke detectors per zone, two CO sensors per floor)
- Actuator commands use "dead man's switch" pattern: the controller must actively send "keep current state" signals; if the signal stops, the system reverts to safe defaults

**Testing:**
- Monthly automated safety logic tests: the edge gateway simulates sensor readings that should trigger safety responses and verifies actuator commands
- Quarterly full-path integration tests: actual sensor stimulation (controlled smoke test, CO2 injection) to verify end-to-end response within 100ms budget
- All test results logged to immutable audit trail for regulatory compliance

### AVM Service Reliability

**Graceful degradation tiers:**

| Tier | Condition | Behavior |
|---|---|---|
| Full service | All models available, ANN index current | Ensemble prediction with comparables and explainability |
| Degraded - no SAR | Spatial model unavailable or stale | GBT + temporal only; wider confidence intervals; flag in response |
| Degraded - no ANN | ANN index unavailable | Fall back to brute-force comparable search (10-mile radius, recent 12 months); increased latency (2-5 seconds) |
| Minimal - cached | Model serving fleet down | Return last cached valuation with staleness timestamp; do not compute new valuation |
| Offline | Complete service outage | Return HTTP 503 with retry-after header; client falls back to tax-assessed value |

**Model deployment safety:**
- New model versions deployed via canary release: 1% of valuations served by new model for 7 days
- Canary metric: median absolute error compared against production model
- Automatic rollback if canary error exceeds production error by >0.5 percentage points
- Shadow mode: new models can run in parallel (predictions logged but not served) for evaluation

### Data Consistency for Property Records

Property records are updated by multiple async sources (MLS feeds, county records, satellite analysis, building sensors). The platform uses eventual consistency with conflict resolution rules:

**Conflict resolution priority (highest to lowest):**
1. Verified transaction (recorded deed) — authoritative for ownership, sale price
2. Active MLS listing — authoritative for listing price, listing status, listing date
3. Tax assessor records — authoritative for legal description, assessed value, parcel boundaries
4. Satellite/photo analysis — authoritative for condition score, feature detection
5. Imputed/modeled values — lowest priority; overridden by any direct observation

**Consistency guarantees:**
- **Within a single data source:** Causal ordering preserved (a status change from ACTIVE to PENDING to SOLD is never reordered)
- **Cross-source:** Eventual consistency with conflict resolution; convergence within 15 minutes of last update
- **AVM reads:** AVM batch reads a consistent snapshot of property data (point-in-time isolation) to prevent mid-batch data changes from creating inconsistent valuations

### Disaster Recovery

| Component | RPO | RTO | Strategy |
|---|---|---|---|
| Property database | 0 (zero data loss) | 30 minutes | Synchronous replication to standby region; automated failover |
| AVM model artifacts | 24 hours | 2 hours | Daily model checkpoint to object storage; standby serving fleet pre-loaded |
| Building digital twins | 5 seconds | 60 seconds | Building-level state checkpointed every 5 seconds; recovery replays recent sensor events |
| Lease document store | 0 | 1 hour | Multi-region object storage with versioning; document store rebuild from objects |
| Search indices | 1 hour | 4 hours | Index rebuild from property database; cached queries continue serving stale results during rebuild |
| Climate risk scores | 24 hours | 2 hours | Pre-computed scores in multi-region cache; refresh from batch output |

---

## Peak Load Patterns

### Seasonal Patterns

| Season | Traffic Pattern | Scaling Response |
|---|---|---|
| Spring (Mar-Jun) | Home-buying season: 3-5x search traffic; 2x AVM requests; peak MLS listing volume | Pre-scale search fleet and AVM serving by March 1; increase ANN index replication |
| Month-end | Lease renewals and rent payments: 5x lease processing volume | Auto-scale lease abstraction GPU pool; pre-warm OCR pipeline |
| Year-end | Tax planning: 3x valuation requests for tax appeal preparation | Increase on-demand AVM capacity; cache popular neighborhood-level analytics |
| Post-disaster | Hurricane/wildfire: 50-100x climate risk queries for affected region | Geographic traffic shaping; serve pre-computed scores (do not allow on-demand recomputation); queue excess requests |

### Geographic Hot Spots

When a natural disaster occurs (hurricane landfall, wildfire), climate risk queries for the affected region spike dramatically. The platform handles this via:

1. **Request coalescing:** Multiple queries for properties in the same climate grid cell within a 5-second window are coalesced into a single computation
2. **Pre-computation trigger:** When NOAA issues a severe weather watch, the platform pre-computes updated risk scores for all parcels in the watch area (typically 50K-500K parcels)
3. **Rate limiting:** API clients are rate-limited to prevent a single large portfolio manager from monopolizing compute during a surge
4. **Stale-serve:** For pre-computed scores, serve the cached value even if it is up to 24 hours old rather than queue behind recomputation

---

## Back-Pressure and Load Shedding

### Load Shedding Priority Tiers

When the platform is under stress (component failures, traffic surges, batch/on-demand contention), requests are prioritized and shed according to the following hierarchy:

| Priority | Category | Examples | Shedding Policy |
|---|---|---|---|
| **P0 — Safety** | Building safety actuation | Fire alarm response, CO2 ventilation override, emergency elevator recall | Never shed; dedicated capacity; independent of cloud |
| **P1 — Regulatory** | Compliance-required computations | Adverse action notice generation, disparate impact test execution, TCFD report generation | Never shed during regulatory windows; defer non-urgent compliance to off-peak |
| **P2 — Lending** | AVM requests from lending partners | On-demand valuations for active mortgage applications | Shed only when P0 capacity threatened; serve cached estimates with staleness warning |
| **P3 — Search** | Consumer property search | Live search queries, listing detail views | Degrade: disable visual similarity, disable personalization, serve cached results for popular queries |
| **P4 — Analytics** | Non-real-time analytics | Portfolio analytics dashboards, market trend reports, batch lease processing | Defer entirely; queue with 4-hour SLA |
| **P5 — Background** | Background enrichment | Satellite image analysis, AVM batch recomputation, embedding model training | Pause and resume; no SLA during shedding |

### Back-Pressure Mechanisms

**AVM batch ↔ on-demand contention:** The nightly batch valuation and on-demand valuation share the comparable search infrastructure (ANN index, feature store). During spring lending surges, on-demand requests can spike to 50/sec while the batch is running. Back-pressure signals:

1. ANN index query latency p99 exceeds 100ms (normal: 5ms) → batch workers reduce query rate by 50%
2. Feature store read latency p99 exceeds 50ms → batch workers pause for 10 minutes
3. On-demand queue depth exceeds 100 → batch workers suspend entirely until queue drains

**IoT ingestion back-pressure:** If the time-series database write throughput approaches capacity (80% of sustained write limit), edge gateways receive a throttle signal to reduce reporting frequency. Non-safety sensors increase their reporting interval from their configured default to 2x the default. Safety sensors are never throttled.

**Lease processing back-pressure:** GPU pools are shared between lease OCR/NLP and satellite image analysis. If lease processing queue depth exceeds 500 documents and satellite analysis is running, satellite jobs are preempted (checkpointed and paused) to free GPU capacity for lease processing. Satellite analysis resumes when lease queue depth drops below 100.

---

## Chaos Engineering Experiments

### Experiment 1: Building Edge Gateway Failover

**Hypothesis:** When the primary edge gateway fails, the standby gateway assumes control within 1 second and all safety-critical controls continue operating.

**Method:**
1. Select 10 test buildings (non-production, full sensor/actuator installation)
2. Inject gateway failure: disable primary gateway's network interface
3. Measure: (a) time for standby gateway to detect failure and assume primary role, (b) continuity of safety sensor monitoring, (c) continuity of HVAC optimization, (d) any actuator commands lost during failover

**Success criteria:**
- Failover time ≤ 1 second
- Zero safety sensor readings lost during failover
- Zero safety actuation commands delayed by more than 100ms
- HVAC optimization resumes within 30 seconds

**Blast radius control:** Test buildings only; no production impact. Gateway failover is self-contained within each building's local network.

### Experiment 2: MLS Feed Outage Resilience

**Hypothesis:** Loss of the top-3 MLS feeds (by listing volume) for 24 hours does not degrade search result quality below acceptable thresholds.

**Method:**
1. Disable ingestion workers for 3 largest MLS feeds (representing ~30% of total listing volume)
2. Monitor: (a) search index freshness for affected geographic areas, (b) listing freshness (how quickly new listings in those MLSs become stale), (c) AVM accuracy for properties in affected areas (comparables from those MLSs are not updated)

**Success criteria:**
- Search results continue serving previously-indexed listings (which age but remain accurate for up to 48 hours for most listing attributes)
- AVM accuracy degrades by ≤ 0.5% MdAPE in affected areas (comparables from the previous 12 months are still available; only new transactions are missed)
- Zero user-facing errors; degraded freshness is transparent via listing age indicators

### Experiment 3: Spatial Model Failure in AVM

**Hypothesis:** If the spatial autoregressive model component fails completely, the AVM gracefully degrades to GBT + temporal models with acceptable accuracy.

**Method:**
1. Disable SAR model serving in production (return null for spatial component)
2. AVM ensemble automatically falls through to GBT + temporal with reweighted ensemble (GBT gets 80%, temporal gets 20%)
3. Monitor: MdAPE change across geographic segments, confidence interval widths, lending partner SLA compliance

**Success criteria:**
- MdAPE increases by ≤ 1.5% nationally (from ~4.8% to ≤ 6.3%)
- Dense urban markets degrade more (SAR contributes 30-40% in cities) but rural markets are unaffected
- All valuations include a degradation flag in the API response
- No lending partner API calls fail

### Experiment 4: Climate Data Source Corruption

**Hypothesis:** If a corrupted GCM dataset is ingested (e.g., temperature values off by a factor of 10 due to unit conversion error), the validation layer catches the corruption before risk scores are published.

**Method:**
1. Inject a corrupted GCM file into the climate data ingestion pipeline (multiply all temperature projections by 10)
2. Monitor: (a) data validation layer response, (b) whether corrupted data reaches the risk scoring engine, (c) whether any pre-computed scores are affected

**Success criteria:**
- Validation layer detects the anomaly (values outside physically plausible range: >80°C global average)
- Corrupted file is quarantined and alert generated
- Risk scoring pipeline does not execute with corrupted inputs
- Zero pre-computed scores are modified

---

## Data Replication and Consistency Model

| Data Store | Replication Strategy | Consistency Model | Partition Tolerance | Recovery Strategy |
|---|---|---|---|---|
| **Property database** | Synchronous replication (2 replicas) | Strong consistency for writes; read replicas with ≤ 1s lag | Geographic partitioning by state; cross-region async replica for DR | Automated failover to synchronous replica; 30-minute RTO |
| **ANN index (comparables)** | Nightly rebuild from source; 3 replicas per geography shard | Eventual (nightly); same-day transactions via incremental insert | Sharded by metro area; shards independent | Rebuild from feature store; 4-hour RTO |
| **Time-series DB (sensors)** | Quorum writes (2-of-3 replicas) | Eventual (sub-second convergence) | Partitioned by building_id; buildings independent | Replay from edge gateway buffer (5-minute buffer); 60-second RPO |
| **Lease document store** | Multi-region object storage; versioned | Strong (per-document); eventual (cross-region) | N/A (object storage handles internally) | Rebuild extraction index from documents; 1-hour RTO |
| **Search index** | 3 replicas per shard; async replication from property DB | Eventual (15-minute lag from property DB writes) | 20 shards by geography; scatter-gather for cross-shard queries | Full rebuild from property DB; 4-hour RTO |
| **Climate risk cache** | Multi-region key-value store; replicated | Eventual (annual refresh cadence makes staleness acceptable) | Partitioned by H3 hex (resolution 4); independent | Recompute from climate grid data; 14-hour RTO |

---

## Capacity Planning Model

### Annual Growth Projections

| Dimension | Current | Year 2 | Year 3 | Scaling Lever |
|---|---|---|---|---|
| Properties in universe | 146M | 148M | 150M | New construction + data source expansion; linear growth |
| Managed buildings (IoT) | 50,000 | 80,000 | 120,000 | Sales-driven; requires edge gateway deployment per building |
| Sensor readings/sec | 2M | 3.2M | 4.8M | Proportional to managed buildings |
| On-demand AVM requests/day | 500K | 750K | 1.2M | Lending partner adoption; seasonal variance 3x |
| Search queries/sec (peak) | 10K | 15K | 20K | User growth; seasonal variance 5x |
| Leases processed/month | 100K | 200K | 350K | REIT portfolio onboarding; step-function growth |
| MLS feeds | 500 | 600 | 700 | New MLS integration; diminishing returns (long tail of small MLSs) |

### Infrastructure Cost Scaling

The dominant cost drivers scale differently:

- **IoT infrastructure:** Scales linearly with managed buildings (edge gateway hardware + network connectivity per building). Each building costs ~$5K in edge hardware + $200/month connectivity.
- **GPU compute (lease + satellite):** Scales with lease volume and satellite coverage. GPU spot instances allow 3x burst capacity.
- **AVM batch compute:** Scales sub-linearly with property universe size (incremental recomputation for unchanged properties). The comparable selection Slowest part of the process scales linearly.
- **Storage:** Time-series IoT data dominates (105 TB hot storage); grows linearly with buildings × retention period. Tiered storage (hot → warm → cold) controls cost.

---

## Entity Resolution Scaling

Entity resolution is the most maintenance-intensive subsystem as MLS feed count grows. Each new MLS feed introduces new address formats, field naming conventions, and data quality patterns.

### Scaling Challenges

| Challenge | At 100 Feeds | At 500 Feeds | At 700 Feeds (Year 3) |
|---|---|---|---|
| **Schema mappings** | 100 mapping definitions (manageable by 1 engineer) | 500 mappings; ~5 changes/week from provider-side schema updates | 700 mappings; ~10 changes/week; requires dedicated mapping team |
| **Candidate generation** | ~10K candidates per incoming record (1-state blocking) | ~50K candidates (multi-state blocking for border properties) | ~60K candidates; blocking strategy must be tuned to control candidate explosion |
| **Match model drift** | Retrain quarterly | Retrain monthly (new address formats from new regions) | Retrain bi-weekly; continuous monitoring for per-feed match quality |
| **Conflict resolution** | Simple majority rules | Weighted by source reliability + recency | Per-field conflict resolution with source-specific trust scores |

### Feed Health Monitoring

Each MLS feed is independently monitored for health indicators that affect entity resolution quality:

| Metric | Healthy Range | Degraded | Critical |
|---|---|---|---|
| **Records per hour** | Within 2σ of historical average for time-of-day | >2σ deviation for >2 hours | Zero records for >4 hours during business hours |
| **New property rate** | 1-3% of records are new canonical properties | >5% (possible entity resolution failure creating duplicates) | >10% (almost certainly creating duplicates) |
| **Merge rate** | 0.1-0.5% of records merge existing canonicals | >2% (possible over-merging; distinct properties being combined) | <0.01% for >24 hours (possible matching failure) |
| **Schema conformance** | >99% records parse successfully | 95-99% (minor schema change) | <95% (major schema change; mapping update needed) |

---

## Multi-Region Architecture Considerations

### Regional Data Sovereignty

Property data has limited cross-region sensitivity (US property records are public), but building IoT data and tenant screening data have privacy implications:

| Data Type | Region Strategy | Rationale |
|---|---|---|
| **Property records** | Primary region + async replica to DR region | Public data; single-region primary is sufficient for consistency |
| **Building IoT data** | Edge gateway stores locally; cloud processing in nearest region | Sensor telemetry may reveal occupancy patterns (PII); keep in-region; edge autonomy reduces cross-region dependency |
| **Tenant screening data** | Processed and stored in tenant's geographic region | FCRA and state privacy laws may restrict cross-state transfer; delete within 30 days |
| **Climate risk models** | Centralized compute; results cached in all regions | Climate data is not PII; centralized training is more cost-effective |
| **Search index** | Replicated shards in each region for low-latency queries | Geographic partitioning means most queries are region-local anyway |

### Cross-Region Failover

| Scenario | Failover Behavior | Data Loss Risk |
|---|---|---|
| **Primary region failure** | Property DB fails over to synchronous replica in DR region (30-min RTO); search serves from local replica; building IoT operates on edge (unaffected) | Zero for property DB (synchronous replication); up to 1 hour for search index (async) |
| **Single AZ failure within region** | AVM serving fleet distributes across AZs; surviving AZs absorb load | Zero; within-region replication handles AZ failures |
| **Building edge gateway failure** | Standby gateway assumes control within 1 second; cloud notified asynchronously | 5 seconds of sensor data (edge buffer); zero safety impact |

---

## Lease Processing Pipeline Scaling

### Backfill vs. Steady-State Scaling

Lease processing has two very different scaling profiles:

**Steady-state:** 100K leases/month = ~140/hour. Each lease requires ~5 minutes GPU time. With 4 GPUs, this is comfortably handled with 75% utilization.

**Portfolio onboarding (backfill):** When a new REIT client brings 10,000 existing leases, the backfill must complete within a contractual SLA (typically 2 weeks). This requires:

```
10,000 leases × 7 min processing time = 70,000 GPU-minutes
= ~1,167 GPU-hours
With 4 GPUs: ~292 hours = ~12 days (tight against 2-week SLA)
With 16 GPUs (burst): ~73 hours = ~3 days (comfortable margin)
```

The platform uses burst GPU capacity for backfill: auto-scale from 4 to 16 GPUs when the lease processing queue exceeds 1,000 documents. The burst capacity is shared with satellite image analysis; during backfill, satellite processing is deprioritized.

**Backfill quality assurance:** Backfill leases are typically older documents (scanned photocopies of faxes, handwritten amendments) with lower OCR quality than modern digital leases. The human review rate for backfill documents averages 25% (vs. 15% for steady-state), requiring additional review capacity during onboarding.

### Search Index Rebuild Strategy

The property search index (292 GB base + 4.4 TB embeddings) must be periodically rebuilt:

- **Incremental updates:** Individual property changes (new listings, price changes, status updates) are applied as incremental index updates within 15 minutes. This handles 99% of day-to-day operations.
- **Partial rebuild:** When a new property attribute is added to the index schema, the index must be rebuilt for all properties containing the new attribute. Partial rebuilds run as background jobs and take 4-12 hours depending on scope.
- **Full rebuild:** Required when the embedding model is retrained (new visual or semantic embeddings). The 146M property corpus requires:

```
146M × 15 photos × embedding inference = 2.19B embedding computations
At 500 embeddings/sec/GPU: 4.38M GPU-seconds = ~50 GPU-days
With 50 GPUs: ~24 hours
```

Full rebuilds run during off-peak hours (Saturday night). The old index continues serving until the new index passes quality checks (search relevance scoring on a held-out query set), then the indexes are atomically swapped.

---

## IoT Edge Fleet Management

### Firmware Update Strategy

With 50,000 edge gateways deployed across buildings, firmware updates must be coordinated carefully:

| Update Type | Frequency | Deployment Strategy | Rollback |
|---|---|---|---|
| **Safety rule update** (ASHRAE/NFPA threshold change) | Quarterly | Rolling update: 100 buildings → 1,000 → 10,000 → all; 24h hold between stages; verified by automated safety logic test at each building | Automatic rollback if safety test fails; gateway retains previous rule version |
| **Protocol driver update** (BACnet/Modbus improvements) | Monthly | Canary: 10 buildings for 7 days; if sensor liveness remains ≥99.5%, roll to fleet | Manual rollback available; gateway maintains previous + current driver versions |
| **Security patch** (vulnerability fix) | As needed | Accelerated rollout: 100 → all within 48 hours; accept higher risk of disruption for security urgency | Manual rollback; security patches rarely rolled back |
| **OS/kernel update** | Semi-annually | Rolling update over 2 weeks; each building's update triggers a supervised restart with safety system verification | Full firmware reimage from backup partition |

### Gateway Health Fleet Dashboard

| Metric | Fleet-Wide Target | Per-Building Alert |
|---|---|---|
| **Firmware version currency** | ≥95% of fleet on latest version within 30 days | Any building >60 days behind latest version |
| **CPU utilization p99** | ≤75% across fleet | Any building sustained >90% for >1 hour |
| **Memory utilization p99** | ≤80% across fleet | Any building sustained >95% for >30 minutes |
| **Cloud connectivity uptime** | ≥99.9% fleet-wide | Any building disconnected >1 hour (non-emergency) |
| **Safety test pass rate** | 100% | Any failed safety test |

---

## AVM Model Versioning and A/B Testing

### Model Version Management

The AVM ensemble is composed of multiple independently-versioned sub-models. Version management must track which combination of sub-model versions produced each valuation:

```
AVM Ensemble Version: v3.2.1
├── GBT Model: gbt-v8.4 (trained 2026-03-01, 2.4M training examples)
├── Spatial Model: sar-v3.1 (spatial weights recomputed 2026-02-15, K=15 neighbors)
├── Temporal Model: temporal-v5.0 (30-day window, per-census-tract)
├── Comparable Embeddings: embed-v6.2 (512-dim, trained on 10M property pairs)
├── Ensemble Weights: weights-v3.2 (per-geography stacked regression)
└── Compliance Layer: compliance-v2.0 (proxy test thresholds, disparity bounds)
```

Every valuation output records the full version vector. When a regulator asks "why did you value this property at $485K on March 10?", the system can reconstruct the exact model state and re-run the computation deterministically.

### A/B Testing Constraints

AVM A/B testing is constrained by fairness requirements: the platform cannot test two different valuation models if one systematically produces different values for protected demographic groups. A/B test design:

1. **Randomization:** Properties are assigned to test/control groups by canonical_id hash (deterministic, not by geography, to avoid demographic correlation)
2. **Guardrail check:** Before the test begins, verify that test and control groups have similar demographic distributions (census-tract-level demographics within 2% for all protected groups)
3. **Monitoring during test:** Track disparate impact metrics for test group independently; abort if test model's disparity exceeds production model's
4. **Statistical power:** With ~5.5M transactions/year as ground truth, a national A/B test achieves statistical significance (p<0.05 for 0.5% MdAPE improvement) in ~7 days

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

**Note:** Model updates affecting core business recommendations (predictions, classifications, rankings) must reach Stage 4 (human-reviewed production) before any customer-impacting deployment. Stage 5 limited autonomy applies only to low-risk, well-bounded recommendation categories with established rollback procedures.
