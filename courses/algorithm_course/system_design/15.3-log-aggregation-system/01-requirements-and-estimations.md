# 15.3 Requirements & Estimations

## Functional Requirements

### Core Features (In Scope)

1. **Log Ingestion** --- Accept log events from heterogeneous sources (application logs, infrastructure logs, security audit logs) via multiple protocols (OTLP/gRPC, HTTP/JSON, Syslog, file tailing) at millions of events per second
2. **Log Parsing & Structuring** --- Transform unstructured/semi-structured log data into structured, queryable records: timestamp extraction, severity normalization, JSON/logfmt/grok parsing, multiline assembly (stack traces)
3. **Log Indexing** --- Build searchable indexes over ingested log data with configurable granularity: full-text indexing for high-value fields, metadata-only indexing for cost-sensitive streams, bloom-filter acceleration for needle-in-haystack queries
4. **Log Search & Query** --- Interactive search across log data with a query language supporting: field-level filtering, full-text search, regular expressions, aggregations (count, rate, percentiles), time-range windowing, and live tail/streaming
5. **Storage Tiering & Retention** --- Automatically transition log data across storage tiers (hot/warm/cold/frozen) based on age and access patterns, with configurable retention policies per data stream, tenant, and compliance classification
6. **Log Routing & Filtering** --- Route incoming logs to different processing pipelines, indexes, or storage backends based on source, content, severity, or custom rules; drop or sample low-value streams at ingestion time
7. **Alerting on Log Patterns** --- Trigger alerts based on log content: threshold alerts (error count > N in window), pattern-absence alerts (expected heartbeat log not seen), keyword alerts (security-sensitive terms detected)
8. **Correlation** --- Enrich log records with trace IDs, span IDs, and request IDs to enable cross-signal correlation with metrics and distributed traces in the broader observability platform
9. **Multi-Tenancy** --- Isolate log data, quotas, and access between tenants (teams, services, environments) with per-tenant ingestion limits, retention policies, and query resource budgets

### Advanced Features (Phase 2)

10. **Log Pattern Clustering** --- Automatically cluster log messages into pattern templates using online algorithms (Drain); detect new patterns, track pattern volume trends, and identify anomalous pattern appearances correlated with incidents or deployments
11. **Log-to-Metric Conversion** --- Extract structured metrics from high-volume log patterns at ingestion time (e.g., HTTP access logs → request duration histograms); reduce storage for repetitive patterns while preserving operational signal
12. **Natural Language Query** --- Support natural-language queries ("show me errors from the payment service in the last hour") translated to the native query language via LLM-powered query generation; validated against schema before execution
13. **Cross-Signal Correlation** --- Unified query interface that joins log events with metrics anomalies and trace spans by shared identifiers (trace_id, request_id), enabling root-cause analysis across all three observability signals
14. **Data Export & Portability** --- Bulk export API for compliance and migration; standard formats (Parquet, JSON Lines); support for continuous streaming export to downstream analytics systems

### Out of Scope

- Metric collection and time-series storage (covered by 15.1 Metrics & Monitoring System)
- Distributed trace collection and span storage (covered by 15.2 Distributed Tracing System)
- Application Performance Monitoring (APM) correlation UI
- SIEM (Security Information and Event Management) rule engine --- though security log ingestion is in scope
- Real-time log-derived metric generation (e.g., counters from log patterns) --- mentioned but not deep-dived

---

## Non-Functional Requirements

### CAP Theorem & Consistency

| Aspect | Choice | Justification |
|---|---|---|
| CAP Position | **AP** (Availability + Partition Tolerance) | Log ingestion must never block; it is acceptable to have brief search delays (eventual consistency) but unacceptable to lose logs or reject writes during network partitions |
| Consistency Model | **Eventual Consistency** with tunable read-after-write | Ingested logs become searchable within a configurable refresh interval (default 1-5 seconds); during this window, recently ingested logs may not appear in search results; acceptable trade-off for ingestion throughput |
| Durability Guarantee | **At-least-once delivery** from source to durable storage | Logs may be duplicated under failure scenarios (agent retry, Kafka rebalance); deduplication is best-effort, not guaranteed; acceptable because log consumers tolerate duplicates better than gaps |

### Availability

| Tier | Target | Justification |
|---|---|---|
| Ingestion Pipeline | **99.95%** (26 min downtime/year) | Log loss during ingestion downtime is permanent; durable queue buffer provides minutes of tolerance, but sustained outage causes data loss |
| Search/Query | **99.9%** (8.7 hrs downtime/year) | Search degradation during incidents is painful but not catastrophic; cached dashboards and recent-data prioritization provide graceful degradation |
| Alerting | **99.95%** (26 min downtime/year) | Missed log-based alerts during outages can have security implications; redundant alert evaluation paths required |

### Latency Targets

| Operation | p50 | p95 | p99 |
|---|---|---|---|
| Ingestion (source to durable buffer) | 50 ms | 200 ms | 500 ms |
| Ingestion (source to searchable) | 2 s | 5 s | 15 s |
| Search (recent data, < 1 hour window) | 200 ms | 1 s | 3 s |
| Search (warm data, 1-30 day window) | 1 s | 5 s | 15 s |
| Search (cold data, > 30 day window) | 5 s | 30 s | 120 s |
| Live tail (new event to screen) | 500 ms | 2 s | 5 s |
| Alerting rule evaluation | 15 s | 30 s | 60 s |

---

## Capacity Estimations (Back-of-Envelope)

### Assumptions

- Large enterprise / cloud-native platform: 5,000 microservices across 50,000 containers
- Average log volume per container: 500 events/minute (mix of INFO, DEBUG, ERROR)
- Average log event size: 500 bytes (structured JSON with typical fields)
- Peak-to-average ratio: 5x during incidents/deployments
- Retention: 7 days hot, 30 days warm, 90 days cold, 365 days frozen
- Compression ratio: 10x (LZ4 for hot, ZSTD for warm/cold)

### Core Metrics

| Metric | Estimation | Calculation |
|---|---|---|
| **Events/second (average)** | ~417K events/s | 50,000 containers x 500 events/min / 60 |
| **Events/second (peak)** | ~2.1M events/s | 417K x 5 (peak factor) |
| **Raw throughput (average)** | ~200 MB/s | 417K events/s x 500 bytes |
| **Raw throughput (peak)** | ~1 GB/s | 2.1M events/s x 500 bytes |
| **Daily raw volume** | ~17 TB/day | 200 MB/s x 86,400 seconds |
| **Daily compressed volume** | ~1.7 TB/day | 17 TB / 10 (compression ratio) |
| **Hot tier storage (7 days)** | ~12 TB compressed | 1.7 TB/day x 7 days |
| **Warm tier storage (30 days)** | ~51 TB compressed | 1.7 TB/day x 30 days |
| **Cold tier storage (90 days)** | ~153 TB compressed | 1.7 TB/day x 90 days |
| **Frozen tier storage (365 days)** | ~620 TB compressed | 1.7 TB/day x 365 days |
| **Total storage (all tiers)** | ~836 TB compressed | Sum of all tiers |
| **Index storage overhead** | ~2-50 TB (hot tier) | Varies by strategy: 12 TB x 0.15 (label-only) to 12 TB x 4.0 (full-text inverted) |
| **Search QPS (average)** | ~50 queries/s | Engineers, dashboards, alerting rules |
| **Search QPS (during incident)** | ~500 queries/s | 10x surge as engineers investigate |

### Bandwidth Estimation

| Path | Bandwidth | Calculation |
|---|---|---|
| Agent-to-Kafka (ingestion) | ~200 MB/s avg, ~1 GB/s peak | Raw event throughput |
| Kafka-to-Indexers | ~200 MB/s avg | Matches ingestion rate |
| Indexer-to-Hot-Storage writes | ~20-40 MB/s | After compression + indexing |
| Hot-to-Warm tier migration | ~1.7 TB/day batch | Once per day, off-peak |
| Search query fan-out | ~500 MB/s peak | 500 queries/s x 1 MB avg scan per query |

---

## SLOs / SLAs

| Metric | Target | Measurement | Alert Threshold |
|---|---|---|---|
| **Ingestion Availability** | 99.95% | Percentage of time ingestion endpoints accept writes without error | < 99.9% over 5-min window |
| **Data Completeness** | 99.99% | Percentage of emitted log events that appear in search within 60 seconds | < 99.95% over 15-min window |
| **Search Availability** | 99.9% | Percentage of search queries that return results (even partial) within timeout | < 99.5% over 5-min window |
| **Search Latency (hot tier, p99)** | < 3 seconds | 99th percentile latency for queries over data < 1 hour old | p99 > 5s over 5-min window |
| **Ingestion-to-Searchable Lag** | < 15 seconds (p99) | Time from event emission to appearance in search results | p99 > 30s over 5-min window |
| **Alert Evaluation Lag** | < 60 seconds (p99) | Time from log event ingestion to alert firing (if matching rule exists) | p99 > 120s over 5-min window |
| **Data Durability** | 99.999% | Percentage of acknowledged log events that are not lost | Any confirmed data loss |
| **Storage Cost Efficiency** | < $0.50/GB/month (blended) | Average cost per GB across all tiers, amortized monthly | > $0.75/GB/month |
| **PII Redaction Coverage** | 99.9% | Percentage of PII instances detected and redacted before indexing | < 99.5% (compliance risk) |
| **Cross-Signal Correlation** | > 95% | Percentage of log events with valid trace_id linked to distributed traces | < 80% (correlation degraded) |

### Performance Requirements

| Dimension | Requirement | Justification |
|-----------|------------|---------------|
| Concurrent searches | 200+ concurrent queries without degradation | Enterprise-scale debugging during incidents |
| Live tail latency | < 2s from event emission to display | Real-time debugging during active deployments |
| Pattern clustering | Process 100% of ingested events online | Anomaly detection must cover full event stream |
| Query fan-out | Search across 100+ shards in parallel | Large time-range queries span many daily indexes |
| Agent CPU overhead | < 2% of host CPU | Logging agent must not impact application performance |
| Agent memory limit | < 256 MB per agent | Memory-constrained container sidecars |

---

## Traffic Patterns & Seasonality

### Daily Pattern
```
Events/sec
2.0M |                    *****
     |                 ***     ***
1.5M |              ***           ***
     |           ***                 ***
1.0M |        ***                       ***
     |     ***                             ***
 500K|  ***         Normal business hours      ***
     |**                                          **
   0 |------------------------------------------------
     00:00  04:00  08:00  12:00  16:00  20:00  24:00
                         UTC
```

### Incident Spike Pattern
- **Trigger**: Service outage, deployment failure, security incident
- **Amplification**: 5-10x baseline within 60 seconds
- **Duration**: 15-120 minutes
- **Composition shift**: ERROR/WARN logs spike from ~5% to ~40% of volume
- **Query spike**: 10x concurrent search load as engineers investigate
- **Critical requirement**: The ingestion spike and query spike are perfectly correlated---the system is under maximum write AND read load simultaneously

### Deployment Wave Pattern
- **Trigger**: Rolling deployment across service fleet
- **Amplification**: 2-3x baseline for 10-30 minutes per service
- **Composition**: Startup/shutdown logs, health check logs, configuration reload logs
- **Key challenge**: Multiple services deploying concurrently can create sustained 3-5x load for hours during deployment windows

---

## Growth Projections (Year 1-5)

| Metric | Year 1 | Year 2 | Year 3 | Year 5 |
|--------|--------|--------|--------|--------|
| Daily raw volume | 17 TB | 35 TB | 70 TB | 200 TB |
| Peak events/sec | 2.1M | 4.5M | 9M | 25M |
| Total retained storage | 836 TB | 1.8 PB | 3.6 PB | 10 PB |
| Hot tier nodes | 12 | 25 | 50 | 140 |
| Search QPS (peak) | 500 | 1,200 | 3,000 | 8,000 |
| Monthly cost (blended) | $24K | $45K | $80K | $180K |

**Growth drivers**: New microservices, increased log verbosity for debugging, compliance-driven retention extensions, expansion into security analytics (SIEM-adjacent workloads).

---

## Per-Tenant Quota Model

| Tier | Max Ingestion (events/s) | Max Daily Volume (GB) | Max Concurrent Queries | Max Query Time Range | Retention |
|------|-------------------------|-----------------------|-----------------------|---------------------|-----------|
| **Free/Internal** | 10,000 | 50 | 5 | 7 days | 30 days |
| **Standard** | 50,000 | 500 | 20 | 30 days | 90 days |
| **Enterprise** | 500,000 | 5,000 | 100 | 365 days | 7 years |
| **Dedicated** | Unlimited (dedicated infra) | Unlimited | Unlimited | Unlimited | Custom |

### Quota Enforcement Points

```
Ingestion Path:
  1. API Gateway: per-API-key rate limit (events/s, bytes/s)
  2. Queue Producer: per-tenant topic partition quota (bytes/s)
  3. Stream Processor: per-tenant daily volume counter (reject when exceeded)

Query Path:
  1. Query Frontend: per-tenant concurrent query limit
  2. Query Executor: per-query resource budget (memory, scan bytes, timeout)
  3. Result Cache: per-tenant cache allocation (proportional to tier)
```

---

## Cost Model by Indexing Strategy

| Strategy | Ingestion Cost ($/TB) | Storage Cost ($/TB/mo) | Search Cost ($/query avg) | TCO at 17 TB/day (annual) |
|----------|----------------------|------------------------|--------------------------|--------------------------|
| **Full-Text Inverted (ELK)** | $12 (CPU-heavy indexing) | $150-$300 (1.5-3x overhead) | $0.001 (fast lookup) | $2.4M-$4.5M |
| **Label-Only (Loki)** | $3 (minimal indexing) | $15-$30 (object storage) | $0.05 (brute-force scan) | $350K-$600K |
| **Bloom Filter (LogScale)** | $5 (bloom construction) | $20-$40 (compressed blocks) | $0.005 (bloom skip) | $450K-$750K |
| **Columnar (ClickHouse)** | $4 (append-only) | $10-$25 (15-50x compression) | $0.01 (columnar scan) | $300K-$500K |
| **Hybrid (Recommended)** | $8 (hot) / $3 (cold) | $150 (hot) / $20 (cold) | $0.003 (blended) | $500K-$900K |

**Key insight**: The hybrid approach costs 3-5x less than full-text-everywhere while preserving sub-second search for recent data (where 90% of queries target).

---

## Network Bandwidth Breakdown

| Path | Bandwidth (Average) | Bandwidth (Peak) | Protocol | Compression |
|------|---------------------|-------------------|----------|-------------|
| App → OTel Collector | ~200 MB/s aggregate | ~1 GB/s | stdout / OTLP gRPC | None (local) |
| OTel Collector → Queue | ~200 MB/s | ~1 GB/s | gRPC with LZ4 | 3-5x (LZ4) |
| Queue → Stream Processor | ~200 MB/s | ~1 GB/s | Queue consumer protocol | Already compressed |
| Processor → Indexer | ~180 MB/s | ~900 MB/s | Internal gRPC | Structured, compressed |
| Indexer → Hot Storage | ~20-40 MB/s | ~100 MB/s | Local disk write | 10x (indexed + compressed) |
| Hot → Warm Migration | ~1.7 TB/day (batch) | N/A | Internal copy | Force-merged |
| Warm → Cold Migration | ~1.7 TB/day (batch) | N/A | Object storage upload | ZSTD recompression |
| Query Fan-out → Storage | ~500 MB/s peak | ~2 GB/s incident peak | Scatter-gather | Block-level fetch |

---

## Operational Estimations

| Metric | Estimation | Notes |
|--------|------------|-------|
| **Queue brokers required** | 5 (baseline), 10 (peak) | 200 MB/s per broker capacity |
| **Stream processor instances** | 10 (baseline), 40 (peak) | ~50K events/s per instance |
| **Indexer instances** | 8 (baseline), 30 (peak) | ~100K events/s per writer |
| **Hot tier storage nodes** | 12 | 1 TB SSD per node, 7-day retention |
| **Query executor instances** | 6 (baseline), 20 (peak) | ~50 concurrent queries per instance |
| **Daily compaction I/O** | ~5 TB read + write | Segment merge across all hot-tier shards |
| **Team size (operations)** | 3-5 SREs | For a platform serving 5K microservices |
| **Segment merges/hour (hot)** | ~200 | Background merge operations across all hot-tier shards |
| **Bloom filter memory (hot)** | ~3 GB | Memory-mapped bloom filters for all hot-tier segments |
| **Term dictionary size (hot)** | ~5 GB | FST-compressed term dictionaries across hot segments |
| **Queue topic count** | ~500 | One topic per tenant per data stream class |
| **Total partition count** | ~4,000 | Across all topics (avg 8 partitions per topic) |
| **PII redaction throughput** | ~400K events/s | Must match full ingestion rate (fail-closed) |
| **Daily lifecycle transitions** | ~2 TB moved | Hot→warm migration volume |
| **Configuration parameters** | ~50 per tenant | Routing rules, retention policies, quotas, PII patterns |
