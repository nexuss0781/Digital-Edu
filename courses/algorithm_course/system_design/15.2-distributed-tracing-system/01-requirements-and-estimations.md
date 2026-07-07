# 01 — Requirements & Estimations

## Functional Requirements

### Core Features (In Scope)

1. **Span Ingestion** — Accept spans from instrumented services via OpenTelemetry protocol (OTLP) over gRPC and HTTP; support batch and streaming ingestion modes
2. **Context Propagation** — Provide SDKs that automatically inject and extract trace context (W3C Trace Context, B3) across HTTP, gRPC, message queue, and async job boundaries
3. **Sampling** — Support head-based probabilistic sampling, per-service rate-limiting sampling, and tail-based adaptive sampling at the collector tier
4. **Trace Assembly** — Assemble complete traces from out-of-order span arrivals across multiple collectors; handle missing spans and clock skew
5. **Trace Storage** — Store traces with configurable retention across hot, warm, and cold storage tiers; support trace-by-ID lookup and tag-based search
6. **Service Dependency Map** — Generate real-time service-to-service dependency graphs from span data; compute edge metrics (request rate, error rate, latency percentiles)
7. **Trace Query & Visualization** — Provide a query API and UI for searching traces by service, operation, duration, tags, and time range; render trace timelines and Gantt charts
8. **Alerting Integration** — Enable trace-based alerts: trigger when specific service paths exhibit error rates or latency above thresholds

### Explicitly Out of Scope

- **Metrics collection** — Separate system (e.g., Prometheus); traces may link to metrics via exemplars
- **Log aggregation** — Separate pipeline; traces correlate with logs via trace ID injection into log records
- **Application Performance Monitoring (APM)** — Code-level profiling, flame graphs, and CPU/memory analysis are separate concerns
- **Business analytics** — Trace data is for debugging and operational insight, not business intelligence

---

## Non-Functional Requirements

| Requirement | Target | Justification |
|---|---|---|
| **CAP Choice** | AP (Availability + Partition tolerance) | Trace data is diagnostic, not transactional; eventual consistency is acceptable; losing a few spans is tolerable, but the ingestion pipeline must never apply backpressure to production services |
| **Consistency Model** | Eventual | A trace may take 30-60 seconds to become fully assembled and queryable; spans from different services arrive asynchronously |
| **Availability** | 99.9% for ingestion, 99.5% for query | Ingestion must never fail in a way that affects production services (fire-and-forget); query availability can be lower since it's used interactively |
| **Latency — Ingestion** | p99 < 5ms at the SDK level (async, non-blocking) | Tracing overhead must be imperceptible to the instrumented service; SDKs batch and flush asynchronously |
| **Latency — Query** | p50 < 500ms, p99 < 3s for trace-by-ID; p99 < 10s for search | Engineers querying during incident response need fast results but can tolerate seconds for complex searches |
| **Durability** | Best-effort for sampled-out traces; durable (3-replica) for sampled-in traces | Once a trace passes the sampling decision, it must be reliably stored; pre-sampling data loss is acceptable |
| **Data Retention** | Hot: 7 days, Warm: 30 days, Cold: 90 days (configurable) | Balances storage cost against debugging needs; most investigations happen within 24-48 hours |

---

## Capacity Estimations (Back-of-Envelope)

### Assumptions

- **Organization scale**: 2,000 microservices, 50,000 service instances
- **Average request fan-out**: 8 spans per trace (one request touches ~8 services)
- **Inbound request rate**: 500,000 requests/sec (peak: 1.5M req/sec)
- **Head sampling rate**: 10% (retain 1 in 10 traces at the SDK level)
- **Tail sampling uplift**: Additional 5% of traces retained by tail-based sampling (errors, outliers)
- **Average span size**: 500 bytes (compressed), 2 KB (uncompressed)

### Calculations

| Metric | Estimation | Calculation |
|---|---|---|
| **Total spans generated** | 4M spans/sec | 500K req/sec × 8 spans/trace |
| **Total spans (peak)** | 12M spans/sec | 1.5M req/sec × 8 spans/trace |
| **Spans after head sampling** | 400K spans/sec | 4M × 10% sampling rate |
| **Spans after tail sampling** | 600K spans/sec | 400K head-sampled + 200K tail-sampled (errors, outliers) |
| **Ingestion bandwidth** | 300 MB/sec | 600K spans/sec × 500 bytes (compressed) |
| **Peak ingestion bandwidth** | 900 MB/sec | Peak with 3x multiplier |
| **Daily storage (compressed)** | ~26 TB/day | 300 MB/sec × 86,400 sec |
| **Hot tier storage (7 days)** | ~180 TB | 26 TB/day × 7 days |
| **Warm tier storage (30 days)** | ~780 TB | 26 TB/day × 30 days |
| **Cold tier storage (90 days)** | ~2.3 PB | 26 TB/day × 90 days |
| **Trace assembly buffer (memory)** | ~60 GB | 600K spans/sec × 2 KB × 60 sec window ÷ replication |
| **Service map edges** | ~20,000 | 2,000 services × ~10 avg dependencies |

### Query Volume Estimates

| Query Type | Estimated QPS | Notes |
|---|---|---|
| Trace-by-ID lookup | 50-200 QPS | Engineers clicking trace links from logs/alerts |
| Service + operation search | 10-50 QPS | Exploratory debugging queries |
| Service dependency map refresh | 1-5 QPS | Dashboard auto-refresh |
| Latency histogram queries | 5-20 QPS | SLO monitoring dashboards |

---

## SLOs / SLAs

| Metric | Target | Measurement |
|---|---|---|
| **Ingestion Availability** | 99.9% (8.7h downtime/year) | Percentage of time collector fleet accepts spans without error |
| **Ingestion Latency (SDK)** | p99 < 5ms overhead | Time added to instrumented service's request processing |
| **Trace Completeness** | > 95% of sampled traces have all expected spans | Measured by comparing span count against service topology expectations |
| **Trace-by-ID Query Latency** | p50 < 500ms, p99 < 3s | From query submission to full trace returned |
| **Search Query Latency** | p50 < 2s, p99 < 10s | For tag-based and time-range searches |
| **Sampling Accuracy** | 100% of error traces retained | Tail-based sampler must capture all traces with error status |
| **Service Map Freshness** | Updated within 5 minutes | Time from new service dependency appearing in traffic to showing on map |
| **Data Retention Compliance** | 100% of sampled traces retained for configured duration | No premature data loss within retention windows |

---

## SLO Error Budget & Burn-Rate Alerting

### Error Budget Calculation

```
Ingestion Availability SLO: 99.9%
    Monthly budget: 43.2 minutes downtime
    Daily budget:   1.44 minutes downtime

    Error budget remaining = (SLO_target - actual_error_rate) / (1 - SLO_target)

    Example: If actual error rate = 0.05% (99.95% availability):
        Budget consumed = (0.001 - 0.0005) / 0.001 = 50%
        Remaining: 21.6 minutes of downtime this month

Trace Completeness SLO: 95% of sampled traces have all expected spans
    Monthly budget: 5% incomplete traces
    If current incompleteness = 3%: budget consumed = 60%

Sampling Accuracy SLO: 100% error trace retention
    This is a zero-tolerance SLO; any missed error trace is a violation
    Budget: 0 missed error traces per month
```

### Burn-Rate Alert Thresholds

| Burn Rate | Window | Budget Consumed | Severity | Action |
|---|---|---|---|---|
| 14.4x | 1 hour | 2% in 1 hour (exhausts in ~3 days) | Critical (page) | Immediate investigation; likely systemic failure |
| 6x | 6 hours | 5% in 6 hours (exhausts in ~7 days) | Warning (page) | Investigate within 1 hour; likely degradation |
| 3x | 1 day | 10% in 1 day (exhausts in ~10 days) | Warning (ticket) | Investigate within 24 hours; slow burn |
| 1x | 3 days | 10% in 3 days (normal pace) | Info | Track; no action needed |

---

## Hardware & Cost Estimation

### Infrastructure Sizing

| Component | Instance Type | Count | CPU | Memory | Storage | Monthly Cost |
|---|---|---|---|---|---|---|
| **Collectors** | Compute-optimized (8 vCPU, 16 GB) | 10 | 80 vCPU | 160 GB | 100 GB SSD each | ~$4,800 |
| **Tail Samplers** | Memory-optimized (8 vCPU, 64 GB) | 10 | 80 vCPU | 640 GB | 200 GB SSD each | ~$8,000 |
| **Message Queue (brokers)** | Storage-optimized (8 vCPU, 32 GB) | 5 | 40 vCPU | 160 GB | 2 TB SSD each | ~$5,500 |
| **Hot Store (wide-column)** | Storage-optimized (16 vCPU, 64 GB) | 12 | 192 vCPU | 768 GB | 5 TB NVMe each | ~$14,400 |
| **Compaction Workers** | Compute-optimized (8 vCPU, 32 GB) | 3 | 24 vCPU | 96 GB | 500 GB SSD each | ~$1,800 |
| **Query Service** | General-purpose (8 vCPU, 32 GB) | 5 | 40 vCPU | 160 GB | 100 GB SSD each | ~$2,400 |
| **Query Cache** | Memory-optimized (4 vCPU, 32 GB) | 2 | 8 vCPU | 64 GB | — | ~$960 |
| **Load Balancers** | Managed LB | 2 | — | — | — | ~$400 |
| **Object Storage (warm, 780 TB)** | Object storage | — | — | — | 780 TB | ~$15,600 |
| **Object Storage (cold, 2.3 PB)** | Object storage archive | — | — | — | 2.3 PB | ~$9,200 |
| **Total** | | **49 instances** | **464 vCPU** | **2,048 GB** | **~3.1 PB** | **~$63,060/mo** |

### Cost-Per-Query Analysis

```
Monthly cost: ~$63,060
Monthly sampled traces: 600K spans/sec ÷ 8 spans/trace × 86,400 sec × 30 days
                      = ~194 billion spans, ~24.3 billion traces

Query volume: ~200 QPS average × 86,400 sec × 30 days = ~518M queries/month

Cost per million queries: $63,060 / 518 ≈ $121.7 / million queries
Cost per million sampled traces stored: $63,060 / 24,300 ≈ $2.59 / million traces

Note: ~80% of cost is storage (hot store + object storage).
Reducing retention from 90 to 30 days saves ~$9,200/mo (cold tier).
```

---

## Capacity Planning Formulas

### Collector Fleet Sizing

```
collectors_needed = ceil(peak_spans_per_sec / spans_per_collector)

Where:
    peak_spans_per_sec = peak_request_rate × avg_fan_out × head_sampling_rate
                       = 1.5M × 8 × 0.15 = 1.8M spans/sec (after head + tail)
    spans_per_collector = 200K spans/sec (verified by load testing)

    collectors_needed = ceil(1.8M / 200K) = 9 → provision 10 (one for headroom)
```

### Tail Sampler Memory Sizing

```
memory_per_sampler = (spans_per_sec / num_samplers) × wait_window_sec × avg_span_size × safety_factor

Where:
    spans_per_sec = 600K (after head sampling)
    num_samplers = 10
    wait_window_sec = 30
    avg_span_size = 2 KB (uncompressed in memory)
    safety_factor = 2.0 (for burst absorption + GC overhead)

    memory_per_sampler = (60K) × 30 × 2 KB × 2.0 = 7.2 GB
    → provision 64 GB per sampler (leaves room for OS, JVM, other processes)
```

### Hot Store Node Count

```
hot_store_nodes = ceil(daily_storage × retention_days / usable_capacity_per_node / replication_factor_adjustment)

Where:
    daily_storage = 26 TB/day (compressed)
    retention_days = 7
    usable_capacity_per_node = 4 TB (of 5 TB, 80% fill target)
    replication_factor = 3

    total_storage = 26 TB × 7 = 182 TB
    with_replication = 182 TB × 3 = 546 TB (but RF=3 distributes across nodes)
    hot_store_nodes = ceil(182 TB / 4 TB) × (3/3) = 46 nodes
    → This is high; use Parquet-on-object-storage for hot tier too (Tempo-style)
    → Or: reduce hot retention to 3 days: ceil(78 TB / 4 TB) = 20 nodes

    Practical: 12 wide-column nodes with 3-day hot tier;
    overflow to warm tier after 3 days instead of 7
```

### Message Queue Partition Count

```
partitions = max(
    ceil(peak_ingestion_bandwidth / per_partition_throughput),
    num_consumer_instances × 2
)

Where:
    peak_ingestion_bandwidth = 900 MB/sec
    per_partition_throughput = 50 MB/sec (conservative for durability settings)
    num_consumer_instances = 10 (tail samplers)

    partitions = max(ceil(900/50), 10 × 2) = max(18, 20) = 20
    → provision 24 partitions (allows scaling to 24 sampler instances)
```

---

## Growth Projections

| Metric | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Microservices | 2,000 | 3,500 | 5,000 |
| Service instances | 50,000 | 100,000 | 200,000 |
| Request rate (avg) | 500K/sec | 1.2M/sec | 3M/sec |
| Total spans generated | 4M/sec | 10M/sec | 24M/sec |
| Sampled spans | 600K/sec | 1.5M/sec | 3.6M/sec |
| Daily storage | 26 TB | 65 TB | 156 TB |
| Hot store capacity | 180 TB | 195 TB (3-day) | 468 TB (3-day) |
| Monthly cost | ~$63K | ~$120K | ~$250K |
| Key challenge | Establish sampling policies | Per-service cost attribution | ML-driven adaptive sampling |

---

## Scale Milestones

| Milestone | Spans/sec | Services | Storage | Key Challenge |
|---|---|---|---|---|
| **Startup** | 10K | 50 | 500 GB/day | Single collector, simple storage |
| **Growth** | 100K | 200 | 5 TB/day | Need sampling; single storage node insufficient |
| **Scale** | 1M | 1,000 | 50 TB/day | Distributed collector fleet; tiered storage; tail-based sampling |
| **Hyperscale** | 10M+ | 5,000+ | 500 TB/day | Streaming trace assembly; columnar storage; aggressive sampling with ML-driven retention |

---

## API Latency Budget Breakdown

| Operation | Component | Budget | Cumulative |
|---|---|---|---|
| **Trace-by-ID (hot tier)** | | | |
| Cache check | Query cache L1/L2 | 1ms | 1ms |
| Hot store lookup | Wide-column point read | 5-10ms | 11ms |
| Trace assembly | Build DAG + clock skew | 2-5ms | 16ms |
| Serialization + transport | gRPC response | 2-3ms | 19ms |
| **Total (cache miss)** | | | **~20ms p50** |
| **Trace-by-ID (warm tier)** | | | |
| Cache check | L1/L2 cache | 1ms | 1ms |
| Bloom filter cascade | Check ~10 blocks | 10-30ms | 31ms |
| Object storage read | Fetch Parquet row group | 50-150ms | 181ms |
| Trace assembly | Build DAG + clock skew | 2-5ms | 186ms |
| **Total (warm tier)** | | | **~200ms p50** |
| **Tag-based search** | | | |
| Index scan | Tag index + time filter | 50-200ms | 200ms |
| Trace ID fetch | Multi-block bloom + read | 200-500ms | 700ms |
| Result merge + dedup | Coordinator merge | 10-50ms | 750ms |
| **Total (search)** | | | **~750ms p50** |
