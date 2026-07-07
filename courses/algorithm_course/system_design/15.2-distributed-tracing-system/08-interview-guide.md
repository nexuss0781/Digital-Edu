# 08 — Interview Guide

## Interview Pacing (45-min Format)

| Time | Phase | Focus | Key Points |
|---|---|---|---|
| 0-5 min | **Clarify** | Scope and requirements | Ask: scale (services, QPS), consistency needs, sampling requirements, multi-tenancy, storage budget |
| 5-10 min | **Data Model** | Span schema and context propagation | Define span fields (trace_id, span_id, parent_span_id, operation, tags, logs); explain W3C Trace Context; discuss how context crosses process boundaries |
| 10-20 min | **High-Level Architecture** | Ingestion pipeline and storage | Draw: SDK → Agent → Collector → Queue → Storage; explain why each component exists; discuss sampling placement |
| 20-30 min | **Deep Dive** | Tail-based sampling OR trace assembly | Choose one: explain the sampling paradox, buffer management, and decision policies; OR explain out-of-order assembly, clock skew, missing spans |
| 30-40 min | **Scale & Trade-offs** | Storage tiering, reliability, bottlenecks | Discuss hot/warm/cold storage tiers; capacity math; explain graceful degradation when components fail |
| 40-45 min | **Wrap Up** | Service map, security, observability | Mention service dependency graph generation; PII concerns in traces; meta-observability (tracing the tracer) |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **The Sampling Paradox**: This is the central architectural tension. Any candidate who jumps to "store everything" or "sample 1% randomly" without discussing the trade-offs is missing the core problem. The interviewer wants to hear about the fundamental tension between observability completeness and cost, and how tail-based sampling resolves it at the cost of operational complexity.

2. **Write-heavy with bursty reads**: Unlike most systems where you design for either reads or writes, a tracing system must handle extreme write throughput (millions of spans/sec) while serving bursty, latency-sensitive read queries (engineers debugging during incidents). The write and read paths are almost entirely decoupled.

3. **The meta-observability challenge**: How do you monitor the monitoring system? This is a unique problem that doesn't appear in most system design interviews. Mentioning the circular dependency and your strategy to break it demonstrates depth.

4. **Context propagation is an organizational problem**: Unlike most distributed systems where the hard parts are technical, context propagation's hardest challenge is ensuring every team in the organization properly instruments their services. This socio-technical insight impresses interviewers.

### Where to Spend Most Time

- **Sampling strategy** (the single most impactful design decision)
- **Storage design** (how to make trace data affordable at scale)
- **Trace assembly** (demonstrates understanding of distributed systems fundamentals: out-of-order events, clock skew, partial failures)

### What Not to Spend Time On

- UI/UX details of the trace visualization (not architecturally interesting)
- Specific OpenTelemetry SDK API details (too implementation-specific)
- Authentication/authorization details (unless specifically asked)

---

## Trade-offs Discussion

### Trade-off 1: Head-Based vs. Tail-Based Sampling

| Decision | Head-Based Sampling | Tail-Based Sampling |
|---|---|---|
| | **Pros:** Near-zero overhead; no buffering needed; consistent decision across all services (deterministic on trace ID) | **Pros:** Informed decision (sees complete trace); guarantees retention of error/outlier traces; supports complex sampling rules |
| | **Cons:** Uninformed (can't know at start if trace will be interesting); systematically misses rare errors | **Cons:** Requires buffering all spans until trace completes; high memory usage; operational complexity; adds latency to trace availability |
| **Recommendation** | Use head-based as the first tier for volume reduction (90% drop), then tail-based at the collector for intelligent retention of the remaining stream |

### Trade-off 2: Wide-Column Store vs. Columnar Object Storage

| Decision | Wide-Column (Cassandra/ScyllaDB) | Columnar on Object Storage (Parquet) |
|---|---|---|
| | **Pros:** Low-latency point lookups (trace by ID in <10ms); high write throughput; automatic TTL-based expiration | **Pros:** 10-100x cheaper per TB; supports efficient column-scoped queries (predicate pushdown); virtually unlimited scale |
| | **Cons:** Expensive per TB; operational overhead (cluster management); tag-based search requires separate indices | **Cons:** Higher read latency (100ms-1s for point lookups); requires bloom filters for trace ID lookup; batch-oriented (not real-time writes) |
| **Recommendation** | Use wide-column for hot tier (0-7 days) for fast trace-by-ID lookups; use columnar on object storage for warm/cold tiers (7-90 days) for cost efficiency |

### Trade-off 3: Consistent Hashing vs. Random Distribution for Collectors

| Decision | Consistent Hashing by Trace ID | Random/Round-Robin Distribution |
|---|---|---|
| | **Pros:** All spans of a trace reach the same collector; enables local trace assembly and tail-based sampling | **Pros:** Simpler; better load distribution; no rebalancing issues during scaling |
| | **Cons:** Scaling events cause trace fragmentation during rebalancing; hot trace IDs create hot collectors | **Cons:** Cannot do tail-based sampling locally (requires distributed state); trace assembly requires a separate aggregation step |
| **Recommendation** | Use consistent hashing for tail-based sampling workloads; accept the rebalancing complexity in exchange for local trace visibility |

### Trade-off 4: Trace Completeness vs. Latency

| Decision | Wait Longer for Complete Traces | Decide Quickly on Partial Traces |
|---|---|---|
| | **Pros:** Higher trace completeness; more accurate sampling decisions; better clock skew correction | **Pros:** Lower memory usage; faster trace availability; simpler buffer management |
| | **Cons:** Higher memory usage in the sampler buffer; traces not queryable for longer; risk of buffer exhaustion during traffic spikes | **Cons:** May make sampling decisions on incomplete data (miss errors in late-arriving spans); orphaned subtrees |
| **Recommendation** | Default 30-second wait window with adaptive reduction under memory pressure; accept lower completeness during high-load periods |

### Trade-off 5: Per-Span vs. Per-Trace Storage Model

| Decision | Per-Span (Individual Rows) | Per-Trace (Grouped) |
|---|---|---|
| | **Pros:** Individual span queries are fast; incremental writes (don't need to wait for full trace); simpler write path | **Pros:** Trace-by-ID retrieval is a single read; better compression (spans within a trace share metadata); fewer I/O operations per trace read |
| | **Cons:** Trace-by-ID retrieval requires reading N rows (one per span); more I/O for the most common query pattern | **Cons:** Must buffer spans until trace is complete before writing; late-arriving spans require append operations; larger minimum write size |
| **Recommendation** | Per-span for hot tier (optimized for fast writes); per-trace for warm/cold tiers (optimized for read efficiency after compaction) |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---|---|---|
| **"Why not just log everything and grep?"** | Understand the difference between logs and traces | Logs are per-service, unstructured, and lack causal relationships. Traces capture the *causal chain* across services with timing data. Grepping logs by request ID gives you individual service perspectives; traces give you the complete request journey with parent-child timing, enabling latency attribution. They complement each other. |
| **"Can't you just sample 100% of traces?"** | Understand scale economics | At 4M spans/sec and 2KB per span, 100% sampling generates 26 TB/day of storage. At even modest storage costs, this becomes $500K+/year in storage alone, plus proportional query and compute costs. More importantly, 100% sampling degrades query performance because searches must scan vastly more data. Sampling is not a limitation—it's an intentional design choice. |
| **"What if the message queue goes down?"** | Test failure thinking | Graceful degradation: collectors buffer spans in memory (30s window), then fall back to writing directly to hot store (bypassing tail sampling). Worst case: head-only sampling for the duration of the outage. Critical: the application services are never affected—SDKs fire-and-forget. |
| **"How do you handle a service that doesn't propagate trace context?"** | Test real-world operational thinking | This is inevitable in a large organization. The trace breaks into disconnected subtrees. We detect "missing parent" spans and create synthetic placeholder spans to preserve partial structure. We also build a "propagation coverage" dashboard that identifies services with high rates of orphaned spans, enabling targeted instrumentation fixes. |
| **"Why not use Elasticsearch for everything?"** | Understand storage trade-offs | Elasticsearch works well for search-oriented workloads but is expensive for the write-heavy, append-only nature of trace data. Indexing every field creates massive storage overhead. Wide-column stores handle the write path better; columnar formats on object storage handle cost efficiency better. Elasticsearch might be used as an optional tag index layer, but not as the primary span store at scale. |
| **"How do you trace async processes like message queue consumers?"** | Test context propagation depth | The producer injects trace context into the message headers. The consumer extracts the context and creates a new span with a FOLLOWS_FROM reference (not CHILD_OF, since it's asynchronous). This preserves the causal chain across async boundaries. For batch consumers processing multiple messages, each message starts its own trace continuation. |

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---|---|---|
| **Designing a synchronous ingestion path** | Any latency in the tracing pipeline adds latency to every instrumented service | Design fire-and-forget ingestion: SDK batches async, agent buffers, collector writes to queue |
| **Single storage tier** | Either too expensive (fast storage) or too slow (cheap storage) | Design tiered storage: hot (fast, expensive, short retention) → warm/cold (slow, cheap, long retention) |
| **Ignoring sampling entirely** | Implies infinite storage budget; shows lack of scale awareness | Lead with sampling as the first design decision; explain head vs. tail trade-offs |
| **Custom context propagation format** | Creates interoperability problems; breaks at organizational boundaries | Use W3C Trace Context standard; mention backwards compatibility with B3 format |
| **Assuming ordered span arrival** | In a distributed system, spans arrive out of order by definition | Design for async assembly with a wait window; handle missing spans and clock skew |
| **Designing for strong consistency** | Trace data is diagnostic; strong consistency adds unnecessary cost and latency | Eventual consistency is fine; traces becoming queryable 30-60 seconds after completion is acceptable |
| **Making the tracing system a SPOF** | If the tracing system failure impacts production services, it's a liability, not a tool | Design for isolation: SDK failures never propagate; fire-and-forget semantics; graceful degradation at every tier |

---

## Questions to Ask Interviewer

### Clarifying Questions (Ask First)

| Question | Why It Matters |
|---|---|
| What's the scale? (number of services, QPS) | Determines whether you need sampling at all, and how complex the storage tier needs to be |
| Is multi-tenancy required? | Changes isolation model, storage partitioning, and access control design |
| What's the storage budget? | Drives the sampling rate and retention policy decisions |
| Are there existing tracing standards in use? (Zipkin B3, W3C, etc.) | Determines context propagation format and backwards compatibility needs |
| Is cross-region tracing needed? | Adds complexity to trace assembly, storage replication, and clock skew handling |
| What level of trace completeness is acceptable? | Informs sampling strategy aggressiveness and buffer sizing |

### Follow-up Questions (If Time Permits)

| Question | What It Reveals |
|---|---|
| Should the service map be real-time or batch-computed? | Affects streaming vs. batch processing architecture |
| Are there compliance requirements for trace data? (GDPR, SOC2) | Drives PII scrubbing, data retention, and access control design |
| Is integration with existing metrics/logging systems expected? | Determines whether exemplar-based correlation is needed |
| Should the system support trace-based testing? | Advanced feature: comparing traces between deployments for regression detection |

---

## Advanced Discussion Topics

### Topic 1: Sampling Strategy Evolution

**Setup**: "Your tracing system starts at 50 services with 10% head sampling. Over 2 years, the org grows to 2,000 services. How does the sampling strategy evolve?"

**What to discuss**:
- Year 1: Uniform 10% head sampling works; storage is affordable; tail sampling not yet needed
- Year 1.5: High-volume services dominate storage; introduce per-service rate limits; first request for "why wasn't this traced?" from an engineer debugging a rare error → motivation for tail sampling
- Year 2: Deploy tail-based sampling; prioritize error traces, latency outliers, custom rules (e.g., "always trace requests from tenant X"); head sampling rate drops to 1% for volume control, tail sampling retains the diagnostically valuable traces
- Year 2+: ML-driven adaptive sampling that learns which code paths produce interesting traces; per-service cost attribution so teams understand their tracing budget; dynamic sampling rate adjustment based on remaining monthly budget

### Topic 2: Context Propagation Across Trust Boundaries

**Setup**: "Your company acquires another company. Both use distributed tracing but different formats. How do you stitch traces across the organizational boundary?"

**What to discuss**:
- W3C Trace Context as the lingua franca: both systems adopt the standard header
- API gateway at the boundary extracts incoming trace context and re-injects in the target format
- Trust: the acquired company's trace IDs must not collide with yours (128-bit random IDs make collision negligible)
- Access control: span-level RBAC prevents each org from seeing the other's span details while preserving trace structure
- Baggage propagation: business context (tenant ID, feature flags) may need filtering at the boundary

### Topic 3: Tracing as a Platform for Testing

**Setup**: "An engineering leader asks: 'Can we use tracing to detect regressions between deployments?' How would you design trace-based testing?"

**What to discuss**:
- Capture baseline traces from canary traffic on the current version
- After deployment, capture comparable traces on the new version
- Diff trace structures: new spans (new dependencies), missing spans (removed calls), latency changes
- Statistical comparison: is the p50/p99 latency for operation X significantly different between versions?
- Integration with CI/CD: block deployment if trace regression exceeds threshold
- Challenges: sampling means you can't guarantee identical trace coverage; need high sampling rate during canary periods

### Topic 4: Cost Optimization at Scale

**Setup**: "The CFO says tracing costs are growing faster than revenue. How do you reduce costs without losing debugging capability?"

**What to discuss**:
- Per-service cost attribution: show each team how much their services cost in tracing storage
- Reduce hot tier retention from 7 days to 3 days (most investigations happen within 24h)
- Columnar storage for warm/cold tiers: 15-20x compression vs. wide-column
- Aggressive head sampling for high-volume, low-value services (health checks, readiness probes)
- Tail sampling ensures error traces are always retained regardless of cost pressure
- Consider Tempo-style architecture: skip wide-column hot tier entirely, use Parquet-on-object-storage with local SSD cache

---

## Red Flags

| Red Flag | Why It's Concerning |
|---|---|
| **"Store 100% of traces"** | Ignores scale economics; at 4M spans/sec, storage costs become prohibitive; suggests no understanding of sampling as a core design constraint |
| **"Use Elasticsearch for everything"** | Elasticsearch is expensive for write-heavy append-only workloads; indexing overhead is disproportionate to trace query patterns; confuses search with trace retrieval |
| **"Synchronous span ingestion"** | Any synchronous path from SDK to storage means tracing latency becomes application latency; violates the fundamental "fire-and-forget" principle |
| **"Single storage tier"** | Either too expensive (fast storage for 90 days) or too slow (cheap storage for 7-day queries); demonstrates no awareness of access pattern differences between hot and cold data |
| **"Custom trace context header"** | Reinventing W3C Trace Context creates interoperability problems; every new service, library, and third-party integration must be custom-instrumented |
| **"The tracing system is always correct"** | Traces are eventually consistent, probabilistically sampled, and subject to clock skew; treating them as ground truth leads to incorrect debugging conclusions |
| **"Just add more collectors"** | Horizontal scaling without consistent hashing breaks tail-based sampling; without trace-ID affinity, you need a separate aggregation layer |

---

## Whiteboard Sketch Guide

### 5-Minute Sketch (Core Architecture)

Draw these components left-to-right:

```
[Service + SDK] → [Agent] → [LB (hash by trace_id)] → [Collector]
                                                           ↓
                                                    [Message Queue]
                                                           ↓
                                            [Tail Sampler (buffer + decide)]
                                                           ↓
                                            [Hot Store]  →  [Warm/Cold (Object Storage)]
                                                           ↓
                                            [Query Service + Cache] → [UI]
```

**Annotate**: "fire-and-forget" at SDK→Agent; "consistent hash" at LB; "30s buffer" at Tail Sampler; "7d hot, 30d warm, 90d cold" at storage tiers.

### 15-Minute Sketch (Detailed)

Add to the 5-minute sketch:
1. **Sampling decision flow**: Head sampling at Agent (10% probability) → Tail sampling at Collector (error/latency/custom rules)
2. **Storage tiers**: Hot (wide-column, 7d, fast) → Warm (Parquet on object storage, 30d, cheap) → Cold (compressed Parquet, 90d, archive)
3. **Index layer**: Bloom filters for trace ID lookup; inverted index for tag-based search
4. **Service map generator**: Consumes from the span stream; emits (caller, callee, metrics) edges
5. **Cross-region**: Show two regions with local pipelines + federation query router

---

## 30-Second Elevator Pitch

> "A distributed tracing system captures the end-to-end journey of every request across thousands of microservices. The core tension is **sampling**: you can't afford to store every trace, but the most valuable ones—errors and latency outliers—are statistically rare. We solve this with **hybrid head+tail sampling**: head sampling reduces volume 90% at the SDK level, then tail-based sampling at the collector buffers complete traces and guarantees 100% retention of error traces. Storage uses **three tiers**: a hot wide-column store for fast recent lookups, and columnar Parquet on object storage for cost-efficient long-term retention with 15x compression. The system must be **invisible when healthy** (zero overhead on instrumented services) and **indispensable during incidents** (fast trace retrieval for debugging)."

---

## Follow-Up Questions by Seniority Level

### Mid-Level Engineer

| Question | Expected Depth |
|---|---|
| How does context propagation work across HTTP boundaries? | Explain traceparent header; trace ID + parent span ID; mention W3C standard |
| What happens when the message queue is unavailable? | Collectors buffer in memory; fall back to head-only sampling; SDKs unaffected |
| Why not use a relational database for trace storage? | Write volume too high; trace-by-ID is a point lookup, not a join; wide-column or columnar is better fit |

### Senior Engineer

| Question | Expected Depth |
|---|---|
| How do you handle tail-based sampling across a collector fleet? | Consistent hashing by trace ID ensures trace affinity; local buffering; drain protocol during rebalancing |
| What's your approach to clock skew correction? | Practical rule of thumb based on CLIENT/SERVER span pairs; cap adjustment at threshold; warn on large corrections; don't correct async (PRODUCER/CONSUMER) spans |
| How would you design multi-tenant isolation? | Per-tenant ingestion quotas; tenant-partitioned storage; RBAC with span-level visibility; separate message queue partitions for noisy-tenant isolation |

### Staff+ Engineer

| Question | Expected Depth |
|---|---|
| How does the sampling strategy evolve as the organization grows? | Start with uniform head sampling; add per-service rate limits; deploy tail sampling for error/outlier retention; evolve to ML-driven adaptive sampling with cost budgets |
| How do you instrument the tracing system itself? | Metrics with exemplars (not self-tracing); separate lightweight monitoring path; canary traces for end-to-end validation; no dependency on the main pipeline |
| What's the relationship between tracing, metrics, and logs? | Three pillars of observability; traces provide exemplars for metrics; trace IDs in logs enable correlation; each pillar serves different query patterns (aggregate vs. specific vs. verbose) |

---

## Key Metrics Reference

| Metric | Good | Warning | Critical |
|---|---|---|---|
| Ingestion rate | Within 20% of baseline | >50% above baseline (potential flood) | Drops to 0 (pipeline failure) |
| Span rejection rate | <1% | 1-5% | >10% |
| Trace completeness | >97% | 90-95% | <90% |
| Tail sampler buffer utilization | <60% | 60-80% | >80% |
| Hot store write latency (p99) | <100ms | 100ms-1s | >1s |
| Trace-by-ID query latency (p99) | <1s | 1-3s | >5s |
| Compaction lag | <30 min | 30 min - 2 hours | >4 hours |
| Error trace retention | 100% | <100% (SLO violation) | — |
| Service map freshness | <2 min | 2-5 min | >5 min |

---

## Evaluation Rubric

| Level | What to Expect |
|---|---|
| **Junior** | Describes basic span model and ingestion pipeline; may miss sampling entirely; single storage tier; doesn't address failure scenarios |
| **Mid-Level** | Understands head-based sampling; designs reasonable ingestion pipeline; mentions Cassandra or Elasticsearch for storage; basic error handling |
| **Senior** | Explains head vs. tail sampling trade-offs; designs tiered storage; addresses clock skew and trace assembly; discusses graceful degradation; mentions PII concerns |
| **Staff** | Leads with the sampling paradox as the central design tension; designs hybrid sampling with adaptive policies; discusses meta-observability; articulates organizational challenges of context propagation; considers cost optimization across storage tiers |
| **Principal** | All of the above plus: discusses trace-based testing, continuous profiling integration, ML-driven sampling, cross-region trace federation, and the evolution from tracing to full observability platform |

---

## Comparison: Tracing Storage Backends

| Backend | Hot Tier | Warm/Cold Tier | Indexing | Cost Profile | Best For |
|---|---|---|---|---|---|
| **Cassandra + Object Storage** | Cassandra (RF=3, TTL) | Parquet on object storage | Separate tag index tables | High (Cassandra nodes are expensive) | Organizations with existing Cassandra expertise; high-throughput write requirements |
| **Elasticsearch + Object Storage** | Elasticsearch | Searchable snapshots | Built-in inverted index | Very high (index overhead 3-5x data size) | Full-text search over trace data; analytics-heavy use cases |
| **ClickHouse** | ClickHouse (MergeTree engine) | ClickHouse cold storage | Built-in columnar indexes | Medium | SQL-based analytics on trace data; when trace storage doubles as analytics warehouse |
| **Parquet-only (Tempo-style)** | Object storage + local SSD cache | Object storage | Bloom filters only | Low | Cost-optimized; when most queries are trace-by-ID; organizations accepting 100-200ms p50 query latency |
| **ScyllaDB + Object Storage** | ScyllaDB (low-latency C++ implementation) | Parquet on object storage | Separate tag index | Medium-high | Ultra-low-latency trace-by-ID lookups; latency-sensitive debugging workflows |

### Decision Framework

```
IF primary_concern == COST:
    USE Parquet-only (Tempo-style)
    // Lowest cost; accept higher query latency for trace-by-ID

ELIF primary_concern == QUERY_LATENCY:
    USE ScyllaDB (hot) + Parquet (warm/cold)
    // Sub-10ms trace-by-ID from hot tier

ELIF primary_concern == ANALYTICS:
    USE ClickHouse
    // SQL analytics on trace data; rich aggregations

ELIF primary_concern == FULL_TEXT_SEARCH:
    USE Elasticsearch (hot) + Object Storage (cold)
    // When engineers need to search trace tags and logs as free text

ELIF primary_concern == OPERATIONAL_SIMPLICITY:
    USE Parquet-only (Tempo-style)
    // Fewest moving parts; object storage handles durability
```

---

## Extended Scoring Rubric

| Dimension | 0-3 (Weak) | 4-6 (Adequate) | 7-8 (Strong) | 9-10 (Exceptional) |
|---|---|---|---|---|
| **Data Model & Propagation** (0-10) | Vague span definition; no mention of trace context headers | Correct span schema; mentions W3C Trace Context; understands parent-child relationships | Discusses span kinds (CLIENT/SERVER/PRODUCER/CONSUMER); baggage propagation; cross-transport propagation (HTTP, gRPC, message queue) | Addresses edge cases: async patterns, fan-out, batch processing; discusses propagation coverage as organizational challenge; mentions eBPF auto-instrumentation |
| **Sampling Strategy** (0-10) | No sampling or naive uniform sampling | Explains head-based sampling; understands the cost problem | Designs hybrid head+tail; explains sampling paradox; discusses adaptive policies | ML-driven sampling; per-service cost budgets; discusses sampling consistency across services; addresses the "always trace errors" guarantee |
| **Storage & Query** (0-10) | Single storage tier; no indexing strategy | Tiered storage (hot/cold); mentions wide-column or columnar | Bloom filters for trace ID lookup; dedicated columns for predicate pushdown; compaction pipeline design | Tempo-style Parquet-on-object-storage; discusses compression ratios; designs cross-tier query federation; addresses cross-region trace assembly |
| **Operational Maturity** (0-10) | No failure handling; no monitoring | Basic retry strategies; mentions graceful degradation | Circuit breakers; adaptive back-pressure; PII scrubbing; meta-observability strategy | Chaos experiment design; canary monitoring; cross-region failover; cost optimization with per-service attribution; discusses organizational adoption challenges |
