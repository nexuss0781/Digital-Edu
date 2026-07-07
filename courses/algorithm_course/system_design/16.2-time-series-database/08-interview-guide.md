# Interview Guide --- Time-Series Database

## Interview Pacing (45-min Format)

| Time | Phase | Focus | Key Deliverables |
|------|-------|-------|-----------------|
| 0-5 min | **Clarify** | Ask scope questions; confirm requirements | Write workload profile, query patterns, scale targets, consistency model |
| 5-15 min | **High-Level Design** | Core architecture, data flow | Write path (WAL → head block → compaction → object storage), read path (inverted index → chunk scan → aggregation), block-based time partitioning |
| 15-30 min | **Deep Dive** | Pick 1-2: compression, inverted index, compaction, downsampling | Gorilla encoding algorithm, posting list intersection, block merge strategy, tiered retention |
| 30-40 min | **Scale & Trade-offs** | Cardinality management, failure scenarios, multi-tenancy | Cardinality enforcement pipeline, ingester replication, compaction under load, disaggregated vs. monolithic |
| 40-45 min | **Wrap Up** | Summarize trade-offs, handle follow-ups | Key decisions with justifications, areas for future improvement |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **The compression algorithm is the centerpiece**: Unlike most system design interviews where the storage layer is abstracted away, a TSDB interview expects you to understand Gorilla compression at the bit level. Delta-of-delta for timestamps and XOR for float values are not just implementation details---they are the core innovation that makes the system economically viable.

2. **Cardinality, not volume, is the scaling axis**: Most candidates think in terms of data volume (GB/TB). Interviewers want to hear about cardinality (number of unique time series) as the dominant scaling constraint. A system with 100M series is harder to operate than one with 1B data points across 1M series.

3. **Time-based partitioning changes everything**: The single most important architectural insight is that time is the primary partition key. This makes deletion O(1), query Cutting off unnecessary steps trivial, and compaction independently parallelizable---but it also means point deletes are expensive and out-of-order data requires special handling.

4. **The query engine is a search engine in disguise**: Label-based series resolution via inverted index and posting list intersection is directly analogous to search engine query resolution. Candidates who can draw this connection demonstrate deep architectural understanding.

### Where to Spend Most Time

- **15 minutes**: Write path (WAL → head block → compaction → storage tiering). This is the core data flow and where most interesting trade-offs live.
- **10 minutes**: Compression deep dive (Gorilla algorithm). Demonstrates understanding of why the system works at all.
- **5 minutes**: Read path and inverted index. Show you understand the query resolution strategy.
- **5 minutes**: Cardinality management and failure scenarios. Shows operational maturity.

---

## Trade-offs Discussion

### Trade-off 1: Gorilla Chunks vs. Columnar Parquet

| Decision | Option A: Gorilla Chunks | Option B: Columnar Parquet | Recommendation |
|----------|--------------------------|---------------------------|----------------|
| | **Pros**: Append-friendly (O(1) per sample); 12x compression for regular data; low per-write overhead; proven in production (Prometheus, VictoriaMetrics) | **Pros**: Better analytical query performance (column Cutting off unnecessary steps, predicate pushdown); 10-20x compression across data types; standard format (data lake ecosystem); better for wide tables (multi-field) | **Hybrid**: Gorilla for hot path (in-memory head block, fast append); Parquet for cold storage (better columnar scan, ecosystem compatibility, lower cost) |
| | **Cons**: Must decompress entire chunk to read any sample; poor for analytical queries; proprietary format; compression degrades for irregular data | **Cons**: Higher write overhead (batch-oriented); more complex encoding pipeline; requires Arrow-compatible infrastructure | InfluxDB 3.0 validates this hybrid approach |

### Trade-off 2: Pull vs. Push Ingestion

| Decision | Option A: Pull (Scrape) | Option B: Push (Agent) | Recommendation |
|----------|-------------------------|------------------------|----------------|
| | **Pros**: Natural service discovery; scrape failure = health signal; centralized control; regular timestamps (excellent compression) | **Pros**: Works across firewalls; supports ephemeral workloads; scales ingestion to agents; works for IoT/edge | **Hybrid**: Pull for long-lived services; Push for ephemeral jobs, IoT, cross-network sources. Align with data source lifecycle. |
| | **Cons**: Requires network reachability; struggles with short-lived processes; server does all the work | **Cons**: No built-in health signal; requires agent-side buffering; irregular timestamps degrade compression; push storms possible | |

### Trade-off 3: Monolithic vs. Disaggregated

| Decision | Option A: Monolithic | Option B: Disaggregated | Recommendation |
|----------|---------------------|-------------------------|----------------|
| | **Pros**: Simple deployment; low latency (all local); few moving parts; easy to operate | **Pros**: Independent scaling per component; object storage for unlimited retention; multi-tenancy; failure isolation | **Scale-dependent**: Monolithic for <50M series, single-tenant. Disaggregated for >50M series, multi-tenant, or cloud-native deployment. |
| | **Cons**: Single-node caps at ~20-50M series; no multi-tenancy; compaction contends with queries | **Cons**: Operational complexity; coordination service dependency; network latency between components | |

### Trade-off 4: In-Order-Only vs. Out-of-Order Acceptance

| Decision | Option A: Reject OOO | Option B: Accept OOO (with window) | Recommendation |
|----------|---------------------|------------------------------------|----------------|
| | **Pros**: Simpler storage engine; better compression (strictly ordered); less memory; faster compaction | **Pros**: Supports push-based agents with clock skew; handles network delays gracefully; enables batch backfill; no data loss from ordering | **Accept OOO** with bounded window (5-60 min). The real world produces out-of-order data. Early Prometheus's OOO rejection was its biggest user pain point. |
| | **Cons**: Data loss from late-arriving samples; incompatible with push architectures; poor fit for IoT/edge | **Cons**: Memory overhead for OOO buffer; compaction must merge OOO data; slightly worse compression for mixed blocks | |

### Trade-off 5: Pre-Aggregation (Recording Rules) vs. Query-Time Aggregation

| Decision | Option A: Pre-Aggregate | Option B: Query-Time Only | Recommendation |
|----------|------------------------|---------------------------|----------------|
| | **Pros**: Fast dashboard loads; predictable query performance; reduces fan-out | **Pros**: No maintenance overhead; always up-to-date; no storage overhead for pre-computed series; supports ad-hoc exploration | **Both**: Pre-aggregate known hot queries (dashboard panels queried by many users); query-time for ad-hoc and exploration. Recording rules are the TSDB equivalent of materialized views. |
| | **Cons**: Storage overhead; stale until next evaluation; must be maintained; doesn't help ad-hoc queries | **Cons**: Expensive for high-cardinality aggregations; unpredictable performance; dashboard load time depends on series count | |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Why not just use a relational database with a timestamp column?" | Understand TSDB-specific optimizations | Acknowledge it works at small scale. Explain: (1) 12x compression via Gorilla vs. row-per-point in RDBMS; (2) time-partitioned blocks enable O(1) retention deletion vs. expensive DELETE queries; (3) inverted label index enables sub-second series resolution vs. B-tree on metric name; (4) append-only WAL is simpler than MVCC. At 1M samples/second, an RDBMS falls over. |
| "What happens when a developer adds `user_id` as a metric label?" | Test cardinality awareness | This is the cardinality explosion scenario. Explain the combinatorial growth (N users x existing label combinations). Describe the enforcement pipeline: per-metric cardinality cap at ingestion, series creation rate limiting, cardinality analysis dashboard. The fix is always to drop the unbounded label. Prevention is better than cure. |
| "How does your system handle a 3-hour network partition between ingesters?" | Test failure recovery understanding | Each ingester has a local WAL. During partition, ingesters continue accepting writes locally (AP choice). After partition heals: (1) replication catches up via WAL shipping; (2) query engine deduplicates overlapping samples from replicas; (3) compaction resolves any duplicate blocks. Data is safe as long as WAL is durable. |
| "Your compression ratio dropped from 12x to 3x. What happened?" | Test understanding of compression assumptions | Gorilla compression depends on data regularity. Possible causes: (1) Irregular scrape intervals (delta-of-delta is no longer zero); (2) Volatile values (random-walk gauges produce large XOR differences); (3) New event-driven push sources with irregular timestamps; (4) High-entropy values (hashes, UUIDs encoded as floats). Diagnosis: check `tsdb_chunk_compression_ratio` by metric; identify degraded series; separate irregular sources into a different storage tier. |
| "How do you query data across both raw and downsampled tiers?" | Test multi-resolution query understanding | Query engine selects the appropriate resolution tier based on time range and step. For a 30-day query at 1-hour step, it reads from the 1-hour downsampled tier. For a 1-hour query at 15-second step, it reads raw data. The boundary between tiers is transparent to the user. Edge Case (Unusual or extreme situation): the transition point where raw data ends and downsampled begins requires stitching, and the aggregation semantics must match (can't average an average). |
| "What if compaction gets stuck and blocks keep accumulating?" | Test operational maturity | Compaction backlog causes query degradation (more files to scan) but no data loss. Immediate mitigation: scale compactor workers. Diagnosis: check compaction duration histogram for slow jobs; check disk space for space-exhaustion failures. Long-term: separate compaction onto dedicated nodes; rate-limit concurrent jobs to prevent resource contention. |

---

## Common Mistakes to Avoid

1. **Designing a general-purpose database**: TSDBs make extreme trade-offs (append-only, no point updates, time-partitioned) that general-purpose databases don't. If your design looks like PostgreSQL with a timestamp column, you've missed the point.

2. **Ignoring cardinality**: Candidates who only discuss data volume (GB) without mentioning cardinality (series count) are missing the dominant scaling constraint. Cardinality determines memory usage, index size, and query fan-out.

3. **Treating compression as magic**: Saying "we compress the data" without explaining Gorilla encoding or its assumptions signals surface-level knowledge. The interviewer wants to hear about delta-of-delta timestamps and XOR float encoding, and when they degrade.

4. **Forgetting out-of-order data**: Designing a system that only accepts in-order samples ignores push-based architectures, distributed agents with clock skew, and batch backfill---all common in real-world deployments.

5. **Skipping the query path**: Candidates often spend all time on the write path. The read path (inverted index → series resolution → chunk scan → aggregation) is equally important and where the search-engine analogy provides powerful insight.

6. **Not discussing downsampling trade-offs**: Mentioning "we downsample old data" without explaining what's lost (spikes, baselines, duration information) and what's preserved (min/max/sum/count tuple) shows incomplete understanding.

7. **Over-engineering day 1**: Designing a fully disaggregated architecture with 12 microservices when the requirements suggest 5M series is over-engineering. Start simple (single-node TSDB) and explain when and why to disaggregate.

8. **Ignoring operational concerns**: Compaction tuning, retention enforcement, cardinality monitoring, and meta-monitoring are not afterthoughts---they are core to operating a TSDB at scale.

---

## Questions to Ask Interviewer

1. **Scale**: "What's the expected number of active time series? This determines whether we need a single-node or distributed architecture."
2. **Ingestion model**: "Is data primarily push-based (agents/IoT) or pull-based (scraping)? This affects compression assumptions and out-of-order handling."
3. **Query patterns**: "Are queries primarily real-time dashboards (recent data, narrow time range) or historical analysis (long time range, downsampled)?"
4. **Retention**: "How long must we retain data at full resolution vs. downsampled? This drives the storage tiering strategy."
5. **Multi-tenancy**: "Is this a single-tenant or multi-tenant system? Multi-tenancy adds cardinality enforcement, resource isolation, and cost attribution."
6. **Consistency**: "Is read-after-write consistency required, or is eventual consistency (within seconds) acceptable?"
7. **Data types**: "Are we storing only numeric time-series, or also histograms, strings, or multi-field records?"

---

## Scoring Rubric (Interviewer Reference)

| Level | Criteria |
|---|---|
| **Strong Hire** | Explains Gorilla compression (DoD + XOR) with bit-level detail; identifies cardinality as the dominant scaling constraint; describes inverted index with posting list intersection; discusses compaction pipeline with failure handling; proposes tiered retention with downsampling semantics (min/max/sum/count); addresses out-of-order ingestion; meta-monitoring awareness |
| **Hire** | Solid write path (WAL → head → blocks → object storage); understands compression at a high level; mentions cardinality as important; describes time-based partitioning benefits; discusses basic query path; identifies compaction as necessary; mentions retention policies |
| **Lean Hire** | Reasonable architecture but missing TSDB-specific optimizations; describes general database patterns; mentions compression without explaining how; aware of time-series characteristics but doesn't exploit them in design |
| **No Hire** | Designs a relational database with timestamp column; no awareness of compression algorithms; no discussion of cardinality; no time-based partitioning; ignores compaction entirely; treats it as a generic key-value store |

---

## Advanced Discussion Topics

### Topic 1: When NOT to Use a TSDB

| Scenario | Why Not TSDB | Better Alternative |
|----------|-------------|-------------------|
| Sparse event data (< 100 events/min) | TSDB optimized for dense, regular series; sparse data wastes index memory | Event store, log aggregation, or general-purpose database |
| Need for complex joins across entities | TSDBs have no join capability; label-based filtering only | Relational database or analytical warehouse |
| String/text time-series data | Gorilla compression only works on numeric float64 values | Log aggregation system or document store |
| Need point updates or deletes | TSDB is append-only; updates require tombstone + compaction | Key-value store or relational database |
| Low cardinality with random access | < 1000 series with random-key lookups | Redis, general-purpose database |

### Topic 2: The Meta-Monitoring Paradox

Discussion prompt: "Your TSDB monitors your entire infrastructure. What monitors the TSDB?"

**Expected discussion points:**
- Circular dependency: if the TSDB is down, its own metrics stop flowing
- Solution: a small, independent TSDB instance (the "meta-monitor") that monitors the primary TSDB
- The meta-monitor should be operationally isolated: different cluster, different failure domain
- Key meta-metrics: ingestion rate, query latency, head block memory, compaction lag, WAL size
- Alternative: push critical TSDB health metrics to a different system (simple log file + alerting)

### Topic 3: TSDB as the Foundation for AIOps

Discussion prompt: "How would you extend this TSDB to support ML-based anomaly detection on metric streams?"

**Expected discussion points:**
- Recording rules can compute rolling statistics (mean, stddev) as pre-computed series
- Anomaly detection runs as a consumer that reads metric streams and applies ML models
- Feature store: recent metric windows as feature vectors for real-time inference
- Exemplars link detected anomalies to specific traces for root cause analysis
- Challenge: training data labeling — most TSDB data has no "anomaly/normal" labels

---

## Red Flags in Candidate Responses

| Red Flag | What It Reveals | Strong Answer |
|----------|----------------|---------------|
| "We'll use PostgreSQL with a timestamp column" | Misses TSDB-specific optimizations | "RDBMSs fall over at 1M samples/sec; TSDB's Gorilla compression, time partitioning, and inverted index are essential" |
| "Cardinality? We'll just add more storage" | Conflates volume with cardinality | "Cardinality is a memory problem (index), not a disk problem. Adding disk doesn't help." |
| "We'll compress the data" (without specifics) | Surface-level knowledge | "Gorilla: delta-of-delta for timestamps (96% compress to 1 bit), XOR for floats (51% to 1 bit)" |
| No mention of compaction | Missing a core component | "Without compaction, block count grows linearly, query performance degrades, tombstones are never applied" |
| "We'll reject out-of-order data" | Ignores push architectures | "Rejecting OOO loses data from distributed agents with clock skew — accept within a bounded window" |
| Treating downsampling as simple averaging | Incorrect aggregation semantics | "Must store (min, max, sum, count) because average of averages is statistically incorrect" |
| "We'll shard by metric name" | Incorrect sharding strategy | "Shard by series hash (metric + labels) for even distribution; metric-name sharding creates hot spots" |
| No discussion of WAL durability | Missing write-path fundamentals | "WAL ensures zero data loss for acknowledged writes; head block is in-memory and volatile without WAL" |

---

## Scenario-Based Deep Dives

### Scenario 1: "A Developer Adds `pod_name` as a Label to All Metrics"

**What to evaluate:** Cardinality awareness and enforcement design.

**Expected answer:**
- Calculate impact: 500 metrics × 50K pods = 25M new series (may double total)
- Impact: index memory doubles, head block memory doubles, ingestion rate spikes
- Detection: series creation rate alert fires; per-metric cardinality cap triggers
- Resolution: drop `pod_name` from metrics where it's not needed; use recording rules for per-pod aggregations
- Prevention: cardinality enforcement at ingestion; label pattern blocklist

### Scenario 2: "Compression Ratio Drops from 12x to 3x for a Subset of Metrics"

**What to evaluate:** Understanding of Gorilla compression assumptions.

**Expected answer:**
- Diagnosis: check `tsdb_compression_ratio` by metric; identify degraded series
- Root causes: (a) event-driven push with irregular timestamps, (b) volatile gauges (queue depth), (c) hash/UUID encoded as float
- Impact: 4x storage increase for affected metrics; capacity planning surprise
- Solution: separate irregular metrics into different storage path; use different compression (Parquet/dictionary) for non-regular data
- Prevention: monitor compression ratio per metric type; alert on sustained degradation

### Scenario 3: "Compaction Falls 6 Hours Behind During Peak Traffic"

**What to evaluate:** Operational maturity and compaction understanding.

**Expected answer:**
- Immediate: check block count per time range; verify queries still working (slower, but not broken)
- Root cause: compaction I/O contention with ingestion; not enough compaction workers
- Mitigation: rate-limit compaction I/O; add dedicated compaction nodes; skip compaction for blocks nearing retention expiry
- Impact if unresolved: query latency degrades (more blocks to scan); tombstones not applied; disk usage grows
- Not a data loss event — this is a performance issue, not a durability issue

---

## Candidate Self-Assessment Checklist

| # | Checkpoint | Strong Signal |
|---|-----------|---------------|
| 1 | Explain Gorilla compression at bit level | DoD for timestamps (1, 2, or 4 bytes); XOR for values (leading zeros, trailing zeros, meaningful bits) |
| 2 | Identify cardinality as the binding constraint | Series count → index memory → node capacity; not data volume |
| 3 | Design the write path | WAL → head block → compaction → object storage; double-buffer swap |
| 4 | Describe the inverted index | Posting list intersection; analogous to search engine; must fit in memory |
| 5 | Handle out-of-order ingestion | Separate OOO head block; merge during compaction; configurable window |
| 6 | Explain downsampling semantics | (min, max, sum, count) tuple; avg of averages is wrong; type-aware for counters |
| 7 | Discuss compaction beyond "merge blocks" | Tombstone application, OOO resolution, query complexity bounding |
| 8 | Design multi-resolution queries | Tier selection by time range and step; stitch across tiers; aggregation correctness |
| 9 | Address meta-monitoring | Independent TSDB instance; no circular dependency; isolated failure domain |
| 10 | Explain when a TSDB is NOT the right choice | Sparse events, string data, random access, complex joins |

---

## Extended Scoring Rubric

| Dimension | Weak (1) | Adequate (2) | Strong (3) | Exceptional (4) |
|-----------|----------|--------------|------------|------------------|
| **Storage Engine** | Generic key-value or relational model | Mentions time partitioning and compression | Explains Gorilla encoding at bit level; discusses block format and compaction pipeline | Discusses hybrid Gorilla + Parquet strategy; explains compression assumptions and failure modes |
| **Query Engine** | SQL with WHERE timestamp; full table scan | Mentions indexing but unclear on mechanism | Explains inverted index with posting list intersection; understands search engine analogy | Discusses Roaring bitmaps, regex matcher optimization, query splitting with step alignment caching |
| **Cardinality** | No mention; treats as volume problem | Mentions cardinality limits exist | Explains combinatorial growth; describes enforcement pipeline (rate limit, per-metric cap) | Discusses cardinality as adversarial problem; explains why auto-scaling cannot solve it; proposes cardinality firewall |
| **Operational Maturity** | No discussion of monitoring or failure modes | Mentions replication and backup | Discusses compaction health, WAL recovery, meta-monitoring paradox | Describes chaos engineering scenarios; designs operational runbooks; addresses compression monitoring |
| **Architecture** | Single-node only; no scaling discussion | Mentions sharding by metric name | Designs hash-ring-based distribution with replication; discusses monolithic vs. disaggregated | Proposes two-level sharding (tenant → series); discusses cell-based isolation; explains write-local/query-global |

### Scoring Weights

| Dimension | Weight | Justification |
|-----------|--------|---------------|
| Storage Engine | 30% | Core TSDB-specific knowledge; distinguishes TSDB from generic database |
| Query Engine | 20% | Inverted index is architecturally critical; often undertested |
| Cardinality | 20% | The #1 operational problem; tests production awareness |
| Operational Maturity | 15% | Separates design-only candidates from production-ready engineers |
| Architecture | 15% | Tests scaling judgment; monolithic vs. disaggregated decision |

---

## Extended Discussion Topics

### Topic 4: Disaggregated vs. Monolithic — The Transition Point

**Discussion prompt:** "At what scale does a single-node TSDB become untenable, and what does the migration to a distributed architecture look like?"

**Expected discussion points:**
- Single-node caps: ~20-50M series (memory-bound by head block + index)
- Transition trigger: when series count exceeds single-node memory or when multi-tenancy is required
- Migration path: start with vertical scaling (more RAM), then disaggregate components incrementally (compactor first, then query, then ingester ring)
- Cell-based architecture: assign tenants to cells (independent ingester ring + query pool); large tenants get dedicated cells
- Key risk during migration: data continuity — blocks must be accessible to both old and new architectures during transition
- Lesson: design for disaggregation from the start (even if you deploy monolithically) by using clean interfaces between components

### Topic 5: Recording Rules as Materialized Views

**Discussion prompt:** "How do recording rules work, and when should you use pre-aggregation vs. query-time computation?"

**Expected discussion points:**
- Recording rules evaluate a PromQL expression on a schedule (every 15-60s) and write the result as a new time series
- Analogous to materialized views in relational databases
- Use case: dashboard queries that aggregate thousands of series and are executed by many users simultaneously
- Trade-offs: storage overhead (new series per rule), staleness (evaluated periodically, not real-time), maintenance burden
- Anti-pattern: creating recording rules for ad-hoc queries that are run once — adds storage without benefit
- Best practice: create recording rules only for queries that appear on dashboards viewed by >5 people or that are evaluated as alert conditions

### Topic 6: Native Histograms — The Cardinality Game Changer

**Discussion prompt:** "Classic Prometheus histograms create N+2 series per histogram. How do native histograms solve this, and what do you give up?"

**Expected discussion points:**
- Classic histograms: 20 buckets × label combinations = 22 series per unique label set
- Native histograms: encode entire distribution in one series using exponential bucketing
- Trade-off: exponential buckets may not align with SLO boundaries (e.g., < 200ms)
- But: 22x cardinality reduction makes histogram monitoring practical at scale
- Impact on storage: reduces index memory, head block memory, and query fan-out for histogram-heavy workloads
- Migration strategy: run classic and native in parallel; validate percentile accuracy; cut over when confident

---

## Quick Reference Card

```
TSDB SYSTEM DESIGN — KEY NUMBERS
═══════════════════════════════════════
Compression:     ~1.37 bytes/point (12x) with Gorilla
                 Degrades to 2-3x for irregular data

Series overhead: ~320 bytes/series (index + head chunk)
                 25M series ≈ 8 GB index memory

Head block:      2-hour window, ~120 bytes/series overhead
                 25M series ≈ 20 GB head block memory

Ingestion:       1.67M samples/sec at 25M series (15s interval)
                 ~330 MB/s ingestion bandwidth

Block levels:    L0=2h → L1=6h → L2=24h → L3=72h (optional)

Downsampling:    (min, max, sum, count) per interval
                 Never average of averages

WAL recovery:    With checkpoints: 10-30s
                 Without checkpoints: 3-5 minutes

Key scaling constraint: Cardinality (series count), NOT data volume

Compaction roles: (1) merge blocks, (2) apply tombstones,
                  (3) resolve OOO data, (4) bound query complexity

Architecture transition: Monolithic < 50M series
                         Disaggregated > 50M or multi-tenant
═══════════════════════════════════════
```
