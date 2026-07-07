# 15.1 Design a Metrics & Monitoring System

## System Overview

A metrics and monitoring system is a distributed infrastructure platform that ingests, stores, queries, and alerts on time-series data emitted by applications and infrastructure at massive scale. The core engineering challenge is building a time-series database (TSDB) that can ingest millions of unique time series at sub-second latency, compress and retain petabytes of metric data with aggressive compression ratios (12-15x through Gorilla-style encoding), answer arbitrary aggregation queries across hundreds of billions of data points within seconds, and evaluate thousands of alerting rules continuously without introducing latency that causes missed incidents. Unlike traditional databases optimized for CRUD operations on business entities, a TSDB must handle an append-only, monotonically timestamped write workload where data is written once and queried many times across flexible time windows, label dimensions, and aggregation functions. The system must support a dimensional data model where each metric is identified not by a single key but by a metric name plus an arbitrary set of key-value labels (e.g., `http_requests_total{method="GET", endpoint="/api/users", region="us-east", status="200"}`)---creating a combinatorial explosion of unique time series that is the single most dangerous scaling challenge in monitoring (cardinality explosion). Production monitoring platforms like Datadog process over 100 trillion events, Prometheus powers the observability layer for millions of Kubernetes clusters, and Grafana serves as the universal dashboard frontend---each solving different parts of the same fundamental problem: making operational data actionable at machine speed. The system must also handle the meta-challenge of being the most critical infrastructure component that cannot itself fail unobserved: monitoring the monitoring system requires careful architectural separation to avoid circular dependencies.

---

## Related Designs

| System | Relationship |
|---|---|
| [1.2 Rate Limiter](../1.2-rate-limiter/00-index.md) | Token bucket and sliding window algorithms used in ingestion admission control |
| [1.4 Distributed Cache](../1.4-distributed-cache/00-index.md) | Query result caching, chunk caching, and metadata caching for read path acceleration |
| [15.2 Distributed Tracing](../15.2-distributed-tracing/00-index.md) | Exemplar links connect metrics to trace spans; complementary observability signal |
| [15.3 Centralized Logging](../15.3-centralized-logging/00-index.md) | Log-derived metrics (error rate from log counts); shared OTLP pipeline |
| [15.4 Alerting & Incident Management](../15.4-alerting-incident-management/00-index.md) | Alert manager as a separate system; notification routing and on-call scheduling |
| [2.14 Event-Driven Architecture](../2.14-event-driven-architecture/00-index.md) | Event bus for alert state transitions and notification delivery |
| [16.1 NewSQL Database](../16.1-newsql-database/00-index.md) | Distributed consensus and consistency models; WAL-based durability |

## Evolution Timeline

| Era | Period | Paradigm | Characteristics |
|---|---|---|---|
| **Nagios/Zabbix** | 2002-2012 | Host-centric polling | ICMP/SNMP checks, check scripts, RRDtool storage, host-level alerting |
| **StatsD/Graphite** | 2011-2015 | Application metrics push | UDP push, carbon storage, whisper files, basic aggregation |
| **Prometheus** | 2015-2020 | Pull-based dimensional model | PromQL, label-based cardinality, local TSDB, service discovery |
| **Distributed TSDB** | 2019-2023 | Horizontally scalable metrics | Cortex/Mimir/Thanos, object storage, multi-tenant, hash ring |
| **OpenTelemetry Native** | 2023-2025 | Unified telemetry pipeline | OTLP as standard protocol, collector-based routing, exemplars linking metrics to traces |
| **AI-Augmented** | 2025-present | Intelligent observability | ML-driven anomaly detection, automatic root cause correlation, eBPF zero-instrumentation collection, native histograms |

## Key Technical Vocabulary

| Term | Definition |
|---|---|
| **Cardinality** | Number of unique time series; the dominant scaling constraint (grows combinatorially with label dimensions) |
| **Head Block** | In-memory buffer holding the most recent 2 hours of data; append target for incoming samples |
| **Gorilla Encoding** | Delta-of-delta (timestamps) + XOR (values) compression achieving ~12x ratio on regular metrics |
| **Posting List** | Sorted list of series IDs for a given (label_name, label_value) pair; foundation of the inverted index |
| **Recording Rule** | Pre-computed PromQL expression stored as a new time series; trades storage for query speed |
| **Exemplar** | A trace ID attached to a specific metric sample, creating a bridge between metrics and traces |
| **Native Histogram** | Single time series encoding an entire distribution (replacing N+2 fixed-bucket series); dramatically reduces histogram cardinality |
| **OTLP** | OpenTelemetry Protocol; vendor-neutral wire format for metrics, traces, and logs |
| **DDSketch** | Logarithmic bucketing algorithm for fully mergeable, relative-error-guaranteed percentile computation |
| **eBPF Collection** | Kernel-level metric collection via extended Berkeley Packet Filters; zero application instrumentation required |
| **Scrape Interval** | Frequency at which a pull-based collector fetches metrics from a target (typically 15-60 seconds) |
| **WAL** | Write-Ahead Log; sequential append-only log ensuring durability before in-memory acknowledgment |

---

## Key Characteristics

| Characteristic | Description |
|---|---|
| **Write Pattern** | Append-only, immutable time-series data; extremely write-heavy (10:1 to 100:1 write-to-read ratio at ingestion layer); writes are batched and sequential within each time series but massively parallel across series; no updates or deletes of individual data points |
| **Data Model** | Dimensional metric model: each time series is uniquely identified by a metric name + sorted set of label key-value pairs; data points are (timestamp, value) tuples appended to a series; the label set creates the cardinality space that must be indexed |
| **Query Pattern** | Time-range aggregation queries: "give me the 95th percentile of request latency across all pods in region X over the last 6 hours, grouped by service"; queries fan out across many series and time ranges, requiring efficient label-based indexing and pre-aggregated rollups |
| **Compression** | Gorilla-style encoding achieves 1.37 bytes per data point (12x compression): delta-of-delta for timestamps (96% compress to 1 bit), XOR for float values (51% compress to 1 bit); critical for making petabyte-scale retention economically viable |
| **Cardinality Sensitivity** | System performance degrades non-linearly with cardinality: 10M active series is routine, 100M is challenging, 1B requires purpose-built architecture (Mimir/VictoriaMetrics); each new label value creates a new time series that must be indexed, stored, and queryable |
| **OpenTelemetry Integration** | OTLP (OpenTelemetry Protocol) is the vendor-neutral standard for metric ingestion (2024-2026); OTel Collector acts as a universal gateway supporting receivers for Prometheus, StatsD, OTLP, and eBPF sources; semantic conventions standardize metric naming and labeling across the industry |
| **Cost Sensitivity** | Observability costs can exceed the infrastructure being monitored at scale; per-team cardinality budgets, cost attribution, and automatic demotion of low-value metrics are emerging as first-class architectural requirements |
| **Alerting** | Continuous rule evaluation engine that processes thousands of alerting rules against live metric streams; must balance evaluation frequency (faster detection) against query load (more TSDB pressure); supports threshold, anomaly detection, and composite alert types |
| **Multi-Tenancy** | Enterprise platforms must isolate tenants at ingestion (rate limiting, cardinality caps), storage (data separation), query (resource quotas), and alerting (notification routing) layers while sharing infrastructure for cost efficiency |
| **Exemplar Support** | Exemplars attach trace context (trace_id, span_id) to specific metric samples, creating a click-to-trace drill-down path from aggregate dashboards to individual request traces; bridge between the metrics and tracing observability signals |
| **Native Histograms** | Exponential histograms encode entire distributions in a single time series (replacing N+2 fixed-bucket series), reducing histogram cardinality by 95% while providing better accuracy through dynamically-adjusted bucket boundaries |
| **eBPF Collection** | Kernel-level metric collection via extended Berkeley Packet Filters provides zero-instrumentation coverage of network, I/O, and scheduling metrics; creates a universal baseline layer independent of application instrumentation |

---

## Industry Landscape (2025-2026)

| Platform | Architecture | Differentiator | Scale Reference |
|---|---|---|---|
| **Prometheus** | Pull-based, single-node TSDB, PromQL | Ubiquitous in Kubernetes; de facto open standard | Millions of deployments; ecosystem defines the metric model |
| **Grafana Mimir** | Disaggregated multi-tenant TSDB, object storage | Horizontally scalable Prometheus; open source | Billion+ active series in large deployments |
| **VictoriaMetrics** | Monolithic or clustered TSDB, custom compression | Superior compression ratios; simpler operations | Claims 10x compression over Prometheus TSDB |
| **Thanos** | Sidecar-based Prometheus extension, object storage | Global query view across federated Prometheus instances | Multi-cluster federation without replacing Prometheus |
| **Datadog** | SaaS, push-based, proprietary TSDB | Full-stack observability with AI-powered insights | 100+ trillion events processed; SaaS market leader |
| **OpenTelemetry** | Collector-based pipeline, OTLP protocol | Vendor-neutral standard; unified metrics/traces/logs | De facto industry standard for telemetry collection |

---

## Quick Navigation

| [09 --- Insights](./09-insights.md) | 12 non-obvious architectural insights unique to metrics systems |

---

## Architectural Trade-off Summary

| Trade-off | Options | Decision Driver |
|---|---|---|
| Pull vs. Push ingestion | Pull (Prometheus), Push (Datadog), Hybrid | Source lifecycle: pull for long-lived, push for ephemeral |
| Monolithic vs. Disaggregated TSDB | Single process vs. microservices | Scale threshold: monolithic <20M series, disaggregated >20M |
| Fixed-bucket vs. Native histograms | N+2 series vs. single exponential series | Cardinality budget: native histograms reduce histogram cardinality 95% |
| Local disk vs. Object storage | SSD vs. cloud object storage | Retention: local for <30 days, object storage for longer retention |
| Recording rules vs. Query-time | Pre-computed vs. on-the-fly aggregation | Access pattern: pre-compute for hot dashboards, on-the-fly for ad-hoc |
| Downsampling aggressiveness | Full resolution vs. tiered rollups | Cost vs. accuracy: tier by age (15d full-res → 90d 5-min → 13mo 1-hr) |

---

## Quick Navigation

| Document | Focus |
|---|---|
| [01 --- Requirements & Estimations](./01-requirements-and-estimations.md) | Functional requirements, capacity math for millions of time series, SLOs |
| [02 --- High-Level Design](./02-high-level-design.md) | Architecture, write path, read path, alerting pipeline, key decisions |
| [03 --- Low-Level Design](./03-low-level-design.md) | TSDB data model, Gorilla compression, inverted index, API design, PromQL |
| [04 --- Deep Dives & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Cardinality explosion, compaction, query fanout, WAL recovery |
| [05 --- Scalability & Reliability](./05-scalability-and-reliability.md) | Horizontal scaling, sharding strategies, federation, disaster recovery |
| [06 --- Security & Compliance](./06-security-and-compliance.md) | Multi-tenancy isolation, metric data sensitivity, access control |
| [07 --- Observability](./07-observability.md) | Meta-monitoring: how to monitor the monitoring system itself |
| [08 --- Interview Guide](./08-interview-guide.md) | 45-min pacing, TSDB-specific traps, cardinality trade-offs, scoring rubric |
| [09 --- Insights](./09-insights.md) | 12 non-obvious architectural insights unique to metrics systems |

---

## Complexity Rating: **Very High**

| Dimension | Rating | Justification |
|---|---|---|
| Data Model Complexity | Very High | Dimensional label model creates combinatorial cardinality space; inverted index design is non-trivial; compression algorithms require bit-level encoding |
| Write Path | High | Millions of concurrent series, WAL durability, in-memory buffering with periodic flush, exactly-once semantics at scale |
| Read/Query Path | Very High | Arbitrary label-based aggregation across billions of data points; query language design (PromQL); pre-aggregation vs. on-the-fly trade-offs |
| Operational Complexity | Very High | Self-referential monitoring problem; cardinality management is an ongoing operational discipline, not a one-time design decision |
| Scaling Challenges | Very High | Cardinality is the dominant scaling axis, not data volume; horizontal scaling requires consistent hashing across label space |

---

## What Differentiates Naive vs. Production

| Dimension | Naive Approach | Production Reality |
|---|---|---|
| **Storage** | Store each data point as a row in a relational database with columns for metric name, timestamp, and value; use B-tree indexes for lookups | Purpose-built TSDB with columnar chunk storage: data points within a series are stored contiguously in compressed chunks using Gorilla encoding (delta-of-delta for timestamps, XOR for floats); head block in memory with WAL for durability; periodic compaction into immutable blocks on disk; inverted index maps label sets to series IDs for O(1) lookup |
| **Cardinality** | Allow arbitrary labels with no limits; discover cardinality problems only when the system falls over (OOM, query timeout, disk exhaustion) | Cardinality as a first-class resource: per-tenant cardinality caps enforced at ingestion; cardinality analysis tools that identify high-cardinality labels before they cause problems; automatic label dropping or aggregation for labels exceeding thresholds; cost attribution per label dimension |
| **Querying** | Scan all data points in the time range, filter by labels in application code, compute aggregations in a single thread | Inverted index for label-based series selection (analogous to a search engine's posting lists); chunk-level time range Cutting off unnecessary steps; vectorized aggregation across matched series; query parallelism with per-query memory limits; pre-aggregated rollups for common queries; query result caching with series-fingerprint invalidation |
| **Alerting** | Cron job that runs every minute, executes each alert query sequentially against the TSDB, sends notifications directly via email/webhook | Streaming alert evaluation engine: rules are compiled into evaluation groups with configurable intervals; each evaluation is a TSDB query with strict timeout; alert state machine (INACTIVE -> PENDING -> FIRING -> RESOLVED) with configurable pending duration to avoid flapping; notification pipeline with deduplication, grouping, silencing, and routing; separate alertmanager component to decouple alert evaluation from notification delivery |
| **Ingestion** | HTTP endpoint that accepts one data point per request; synchronous write to disk | Batch ingestion: agents collect and pre-aggregate locally, send compressed batches (Protocol Buffers / OTLP); write path buffers in memory (head block), appends to WAL for durability, periodically flushes to disk blocks; backpressure via admission control when ingestion exceeds capacity |
| **Multi-Tenancy** | Shared database with a `tenant_id` column; no resource isolation; one tenant's cardinality explosion degrades all tenants | Tenant-isolated ingestion pipeline: per-tenant rate limits, cardinality caps, and storage quotas enforced at the ingestion gateway; query-time tenant isolation via per-tenant query concurrency limits and memory quotas; optional physical isolation (separate TSDB instances) for premium tenants; cross-tenant aggregation prohibited by default |
| **Retention** | Keep all data forever at full resolution; storage costs grow linearly | Tiered retention with downsampling: full resolution for recent data (e.g., 15 days), 5-minute rollups for medium-term (e.g., 90 days), 1-hour rollups for long-term (e.g., 1 year); data automatically downsampled and compacted; object storage for cold tier with on-demand rehydration for historical queries |

---

## What Makes This System Unique

### The Cardinality Problem Is the Defining Engineering Challenge

Unlike most distributed systems where the primary scaling axis is data volume (bytes) or request rate (QPS), a metrics system's dominant scaling constraint is **cardinality**---the number of unique time series. Each unique combination of metric name + label values creates a new series that must be separately indexed, buffered in memory, flushed to disk, and made queryable. A single metric `http_requests_total` with labels `{method, endpoint, status, region, pod}` can generate millions of unique series in a large Kubernetes deployment. The inverted index that maps labels to series must fit in memory for fast query resolution, and each active series consumes RAM for the in-memory head block. Cardinality grows combinatorially with labels, making it an adversarial scaling problem: a single developer adding an unbounded label (like `user_id` or `trace_id`) to a metric can take down the entire monitoring cluster. Production systems must treat cardinality as a managed resource with quotas, alerting, and enforcement---not just a property of the data.

### Time-Series Compression Is a Bet on Data Regularity

Gorilla-style compression achieves 12x compression (1.37 bytes per point vs. 16 bytes uncompressed) by exploiting a deep insight about metric data: timestamps are regular (scrape intervals are fixed, so delta-of-delta is usually zero), and values change slowly (CPU usage, request count, error rate tend to be similar to their previous value). This regularity is not guaranteed---it's a bet. If a metric's values are truly random (e.g., a hash or a random ID encoded as a float), XOR compression degrades to worse-than-uncompressed. If scrape intervals are highly irregular (e.g., event-driven push metrics), delta-of-delta encoding provides little benefit. The TSDB's compression ratio is therefore a function of data regularity, which is a function of what users choose to monitor and how they instrument their code. This creates a feedback loop between instrumentation practices and storage costs.

---

### The Self-Referential Monitoring Problem

A metrics system must be the most reliable component in the infrastructure because every other component depends on it for operational visibility. But the monitoring system itself needs monitoring---and this creates a circular dependency. If the TSDB's ingestion pipeline is overloaded, the metrics that would tell you about the overload are the ones being dropped. Production systems solve this through architectural separation: a lightweight, independent "meta-monitoring" stack (often a separate, minimal Prometheus instance) that monitors the primary monitoring system's health. This meta-monitoring system must be radically simpler and more reliable than the primary system, operating on a small, fixed set of internal health metrics with no dependency on the primary system's availability.

### Pull vs. Push Is Not a Binary Choice

Prometheus popularized the pull model (monitoring server scrapes targets), while Datadog and OpenTelemetry use push (agents send data to the server). The trade-off is deeper than it appears. Pull provides natural service discovery (if you can scrape it, it's alive), built-in health checking (scrape failure = potential outage), and centralized control (the server decides what to collect). Push supports ephemeral workloads (batch jobs, serverless functions that exist for seconds), scales the ingestion load (agents do the work of sending, not the server of fetching), and works across network boundaries (agents can push through firewalls where the server couldn't reach in to scrape). Most production systems end up hybrid: Prometheus uses pull but provides Pushgateway for batch jobs; Datadog uses push but the agent acts as a local pull-based collector. The architectural insight is that the ingestion model is not a global system choice but a per-source decision based on the source's lifecycle and network topology.

### The Native Histogram Revolution (2024-2026)

Fixed-bucket histograms have been the standard for distribution metrics since Prometheus's inception, but they carry two fundamental flaws: (1) bucket boundaries must be chosen at instrumentation time before the actual distribution is known, and (2) each histogram generates N+2 time series, making histograms the leading source of cardinality explosion. Native histograms (exponential histograms in OpenTelemetry) solve both problems by encoding the entire distribution as a single time series with dynamically-adjusted, exponentially-spaced bucket boundaries. This reduces histogram cardinality by 10-50x (a histogram that previously generated 22 series now generates 1) while providing better accuracy for tail percentiles. The trade-off is increased per-sample storage cost (a native histogram sample is larger than a single counter sample) and the need for new query functions---but the net impact on system capacity is overwhelmingly positive because the cardinality reduction dominates. Native histograms represent the most significant change to the metrics data model since the dimensional label model itself, and their adoption is reshaping how monitoring systems handle distribution data.

### eBPF Is Redefining the Instrumentation Boundary

Traditionally, application metrics require explicit instrumentation: developers add counter increments, histogram observations, and gauge updates to their code. eBPF (extended Berkeley Packet Filters) upends this model by collecting metrics at the kernel level---network request counts, latency distributions, TCP retransmits, DNS resolution times, file I/O patterns---without any application code changes. The architectural implications are profound: eBPF-based collection produces a consistent, high-fidelity baseline of infrastructure and network metrics across every workload, regardless of language, framework, or instrumentation maturity. This creates a two-tier metric model: eBPF provides the universal infrastructure layer (guaranteed coverage), while application instrumentation provides the business logic layer (custom metrics). The challenge is that eBPF metrics are kernel-scoped (per-process, per-socket) rather than application-scoped (per-request, per-user), requiring correlation with application-level context to be fully actionable. This correlation between eBPF-derived and application-derived metrics is an active area of innovation in the observability space.
