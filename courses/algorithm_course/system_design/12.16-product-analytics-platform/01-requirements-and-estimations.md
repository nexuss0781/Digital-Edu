# 12.16 Product Analytics Platform — Requirements & Estimations

## Functional Requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-01 | **Event Ingestion** — Accept arbitrary user events via SDK (web, mobile, server-side) with at-least-once delivery guarantee and sub-100ms acknowledgement | Clients must receive ack before TCP teardown; dedup on backend |
| FR-02 | **Event Properties** — Support schema-on-read for event properties: any key-value pair accepted, type inferred at query time | No upfront schema registration required; schema hints optional |
| FR-03 | **Funnel Analysis** — Compute ordered multi-step conversion funnels with configurable time windows, exclusion steps, and property-based breakdown | Steps must be ordered but not necessarily sequential; gaps allowed |
| FR-04 | **Retention Analysis** — Compute N-day, unbounded, and custom bracket retention cohorted by user acquisition date or first occurrence of a defining event | N-day: user must return on exactly day N; unbounded: any day on or after N |
| FR-05 | **Cohort Segmentation** — Define behavioral cohorts ("users who did X in the last 30 days") and property cohorts ("plan=enterprise") dynamically; apply any cohort to any analysis | Cohorts evaluate lazily at query time or pre-compute for reuse |
| FR-06 | **Path / Journey Analysis** — Visualize Sankey-style user flow between events: top paths after event A, most common paths before event B, drop-off at each transition | Session-aware: paths bounded by session timeout (typically 30 min idle) |
| FR-07 | **Real-Time Dashboard** — Surface live event counters and key metrics updated within 60 seconds of event occurrence | Not full query freshness—dedicated streaming rollup for key metrics |
| FR-08 | **User-Level Inspection** — Look up event history for a specific user\_id; view properties at a point in time | For debugging and customer support; access controlled by role |
| FR-09 | **Auto-Capture** — Optionally capture all DOM interactions (clicks, page views, form submissions) without explicit instrumentation | Toggleable per project; increases event volume significantly |
| FR-10 | **Event Taxonomy & Governance** — Register event schemas with required properties, types, and ownership; score event quality; flag schema violations | Schema violations still ingested; violations surfaced in data quality UI |
| FR-11 | **Alerts & Anomaly Detection** — Define metric thresholds or percentage-change rules; notify via webhook when triggered | E.g., "alert if checkout\_complete drops > 20% vs 7-day average" |
| FR-12 | **Data Export** — Export query results as CSV/JSON; stream raw events to customer's data warehouse via connector | Warehouse sync via CDC or periodic batch |
| FR-13 | **Feature Flags Integration** — Record feature flag assignment per user per event; enable flag-grouped analysis without join to external system | Flag context embedded in event envelope at SDK time |
| FR-14 | **Session Replay Linkage** — Link each event to a corresponding session replay recording for qualitative debugging | Replay stored separately; event carries session\_replay\_id reference |

---

## Extended Features

| ID | Requirement | Notes |
|---|---|---|
| EF-01 | **Session Replay** — Record DOM mutations, network requests, and console errors for qualitative debugging linked to quantitative analytics | rrweb-based recording; stored separately from event data; linked via session\_replay\_id |
| EF-02 | **AI Insight Generation** — Automatically surface anomalies, significant metric changes, and natural-language explanations without manual exploration | Anomaly detection over event volume and conversion rates; LLM-powered narrative generation |
| EF-03 | **Warehouse Sync** — Bidirectional sync with customer data warehouses: export raw events out, import business context (revenue, subscription data) in | CDC-based export; scheduled import with conflict resolution; join at query time |
| EF-04 | **Group Analytics** — Analyze behavior at the organization/company level (B2B): aggregate events across all users within a group entity | Group-level funnels, retention, and cohorts; requires group membership resolution at query time |
| EF-05 | **Predictive Analytics** — Predict churn probability, conversion likelihood, and feature adoption using ML models trained on behavioral data | Feature extraction from event sequences; real-time scoring per user; model refresh weekly |
| EF-06 | **Impact Analysis** — Automatically measure how feature launches affect key metrics by comparing pre/post event patterns across control and treatment groups | Requires integration with feature flag system; causal inference beyond A/B testing |
| EF-07 | **Data Destinations** — Route enriched events to downstream systems (CRMs, marketing automation, customer success tools) based on configurable rules | Event-driven webhook and batch export; retry with dead-letter queue; schema transformation |

---

## Migration Requirements

| Requirement | Description |
|---|---|
| **Historical Data Import** | Import historical events from CSV/JSON/Parquet with correct timestamp placement into appropriate storage tiers |
| **Identity Merge** | Import existing identity resolution mappings (anonymous → authenticated) from legacy analytics system |
| **Schema Migration** | Convert legacy fixed-schema events to schema-on-read format while preserving type information |
| **Dashboard Migration** | Translate saved funnels, retention configs, and cohort definitions from legacy analytics queries |
| **API Key Rotation** | Phase-in new API keys alongside legacy keys; dual-write period until all SDKs updated |
| **Validation Period** | 30-day parallel-run period comparing legacy and new analytics outputs for count consistency (±2% tolerance) |

---

## Out of Scope

- **A/B Testing Assignment Engine** — Assignment logic lives in a separate experimentation service (covered in 12.14); analytics platform consumes assignment events
- **Business Intelligence (BI) Dashboarding** — Ad hoc SQL queries over joined business entities; analytics platform focuses on event-based behavioral analysis
- **Data Warehouse ETL** — Transforming and modeling raw events into dimensional schemas; analytics platform stores events, not facts/dimensions
- **Clickstream Advertising Attribution** — Multi-touch attribution across ad channels requires probabilistic identity resolution beyond scope
- **Real-Time Personalization Serving** — Serving individualized recommendations in real time based on event stream; requires low-latency feature store integration

---

## Non-Functional Requirements

### Performance
| Metric | Target |
|---|---|
| Event ingestion acknowledgement latency | P99 < 100ms end-to-end from SDK to queue |
| Event pipeline to query availability | < 60 seconds for real-time tier; < 24 hours for full reprocessed accuracy |
| Funnel query latency (< 10M users, 5 steps, 30-day window) | P50 < 500ms, P99 < 2s |
| Retention query latency (12-week cohorts) | P50 < 1s, P99 < 3s |
| Path analysis query (top 20 paths after event, 30-day window) | P50 < 2s, P99 < 5s |
| Real-time dashboard metric refresh | < 60s staleness |
| User-level event lookup (last 1000 events) | P99 < 200ms |

### Reliability
| Metric | Target |
|---|---|
| Ingestion availability | 99.99% (< 52 min downtime/year) |
| Query availability | 99.9% (< 8.7 hours/year) |
| Event durability (post-ack) | 99.9999% (no data loss after acknowledgement) |
| Late event acceptance window | Up to 72 hours past event timestamp |
| Maximum acceptable event loss at SDK | 0% post-ack; < 0.1% pre-ack (network failure) |

### Scalability
| Metric | Target |
|---|---|
| Peak ingestion rate | 500K events/second sustained, 1M events/second burst |
| Unique projects (tenants) | 50,000 |
| Maximum unique users per project | 500 million |
| Maximum event properties per event | 500 key-value pairs |
| Cold storage event retention | 2 years default; configurable up to 10 years |

### Security & Compliance
| Requirement | Description |
|---|---|
| Multi-tenant isolation | Storage-level isolation per project; no cross-project query leakage |
| GDPR right-to-erasure | Delete all events by user\_id within 30 days; via tombstone + recompaction |
| PII detection | Automatic scanning of event properties for common PII patterns; flag for review |
| Data residency | Events stored in configured region; no cross-region transfer without explicit consent |
| Audit logging | All data access (query, export, user lookup) logged with actor, timestamp, query |

---

## Capacity Estimations

### Event Ingestion Volume

```
Assumptions:
  - 50,000 active projects
  - Average 20,000 DAU per project  → 1 billion total DAU-equivalents
  - Average 5 events per user per session, 2 sessions per day  → 10 events/user/day
  - Total: 1B users × 10 events = 10 billion events/day

Peak vs average:
  - Traffic is highly diurnal: 3× peak multiplier during business hours
  - Peak ingestion: 10B / 86,400 × 3 ≈ 347K events/second sustained peak
  - With burst: 500K–1M events/second (flash sales, viral launches)
```

### Storage Estimation

```
Per-event storage (columnar, compressed):
  - Envelope fields (event_name, user_id, timestamp, project_id, session_id): ~100 bytes raw
  - Average 15 event properties × 20 bytes each: ~300 bytes raw
  - Total raw: ~400 bytes/event
  - Columnar compression ratio: ~6:1 (dictionary encoding + Zstd)
  - Compressed: ~67 bytes/event

Daily ingestion:
  - 10 billion events/day × 67 bytes ≈ 670 GB/day compressed

Annual storage (2-year retention):
  - 670 GB/day × 365 × 2 ≈ 489 TB

With replication factor 3:
  - 489 TB × 3 ≈ 1.5 PB raw storage capacity required

Pre-aggregated rollup tables (10% overhead): +150 TB
User properties time-series: +50 TB
Total storage estimate: ~1.7 PB
```

### Query Volume

```
Assumptions:
  - 50,000 projects × average 10 active users each
  - Each analyst runs ~20 queries per workday (8-hour window)
  - 50,000 × 10 × 20 queries / 28,800 seconds (8h) ≈ 347 queries/second

Cache hit rate:
  - L1 result cache (identical queries): 30% hit rate
  - Warm materialized views (similar shape): 40% hit rate
  - Cold columnar scan: 30% of queries

Cold scan queries: 347 × 0.30 ≈ 104 cold queries/second
  Each cold query scans ~100M–1B rows → significant compute load
  Estimate 16-core query nodes, 10 concurrent queries per node, 20 nodes required
```

### Network Bandwidth

```
Ingestion inbound:
  - 347K events/second × 400 bytes raw = 139 MB/s ingestion bandwidth
  - With TLS overhead (+20%): ~167 MB/s

Query result outbound:
  - Average result set: 50 KB per query × 347 queries/s = 17 MB/s

Export/sync outbound:
  - 10% of events exported to warehouses: 670 GB/day × 0.1 = 67 GB/day ≈ 0.8 MB/s
```

---

## Service-Level Objectives (SLOs)

| SLO | Target | Measurement Window |
|---|---|---|
| Ingestion Availability | 99.99% | Rolling 30-day |
| Event Pipeline Freshness (P95 event visible within) | 60 seconds | Rolling 24-hour |
| Funnel Query P99 Latency | < 2 seconds | Rolling 1-hour |
| Retention Query P99 Latency | < 3 seconds | Rolling 1-hour |
| Dashboard Metric Staleness | < 60 seconds | Continuous |
| GDPR Erasure Completion | 100% within 30 days | Per request |
| Alert Trigger Latency | < 5 minutes after threshold crossed | Per alert |

---

## Latency Budget Breakdown

### Event Ingestion Path (Target: P99 < 100ms SDK-to-ack)

| Phase | Budget | Notes |
|---|---|---|
| SDK batching + compression | 0–50ms | SDK-side; configurable flush interval |
| TLS connection + HTTP POST | 10–30ms | Depends on geographic proximity to collector |
| Collector validation + dedup check | 2–5ms | Bloom filter lookup + envelope validation |
| Enrichment (geo-IP, UA parsing) | 1–3ms | In-memory lookup tables |
| Queue produce + ack | 5–15ms | 2-of-3 replica ack; local region only |
| **Total end-to-end** | **18–103ms** | P99 target: < 100ms |

### Funnel Query Path (Target: P99 < 2s for 5-step, 30-day, 10M users)

| Phase | Budget | Notes |
|---|---|---|
| L1 cache lookup | 1–5ms | Hash lookup on query signature |
| Query planning + routing | 2–10ms | Tier selection, parallelization plan |
| Parallel per-step columnar scan | 200–800ms | 5 steps × 30 daily partitions; predicate pushdown |
| Bitmap construction (per step) | 50–200ms | Build roaring bitmap from scan results |
| Step intersection + time window | 20–100ms | Sequential AND with timestamp checks |
| Breakdown computation | 50–200ms | Group-by on property dimensions |
| Result serialization | 5–20ms | JSON encoding |
| **Total (cache miss)** | **328–1335ms** | P99 target: < 2000ms |
| **Total (cache hit)** | **1–5ms** | L1 hit rate: ~30% for dashboards |

---

## Growth Projections

| Stage | Timeline | Events/Day | Projects | Storage (Compressed) | Compute Nodes |
|---|---|---|---|---|---|
| **Startup** | Month 1–6 | 100M | 500 | 7 GB/day → 2.5 TB total | 5 query nodes |
| **Growth** | Month 6–18 | 1B | 5,000 | 67 GB/day → 37 TB total | 12 query nodes |
| **Scale** | Month 18–36 | 10B | 50,000 | 670 GB/day → 489 TB total | 40 query nodes |
| **Enterprise** | Month 36+ | 50B | 200,000 | 3.4 TB/day → 2.4 PB total | 120 query nodes |

---

## Cost Estimation by Stage

| Stage | Compute/Month | Storage/Month | Network/Month | Total/Month |
|---|---|---|---|---|
| **Startup** (100M events/day) | $3,200 | $800 | $400 | ~$4,400 |
| **Growth** (1B events/day) | $12,000 | $4,500 | $2,000 | ~$18,500 |
| **Scale** (10B events/day) | $65,000 | $35,000 | $12,000 | ~$112,000 |
| **Enterprise** (50B events/day) | $240,000 | $140,000 | $45,000 | ~$425,000 |

### Key Cost Drivers

| Driver | Impact | Optimization |
|---|---|---|
| **Cold storage volume** | Linear with retention × events/day | Compression ratios (6:1+); retention policy enforcement |
| **Query compute** | Proportional to cold scan frequency | Materialized views reduce cold scans by 40%; result caching reduces by 30% |
| **Ingestion bandwidth** | Linear with event volume × avg event size | Client-side batching + compression; server-side dedup |
| **Hot store capacity** | Fixed at 24h × peak ingestion rate | Aggressive compaction; property Cutting off unnecessary steps in hot tier |
| **Message queue throughput** | Proportional to events/second | Partition count tuning; batch produce |

---

## Workload Profiles

| Workload | Query Pattern | Volume | Warehouse Size | Priority |
|---|---|---|---|---|
| **Dashboard refresh** | Cached rollup queries, 60s refresh | 60% of queries | Light (materialized view hit) | High (user-facing) |
| **Ad hoc exploration** | Arbitrary funnel/retention with custom filters | 20% of queries | Medium (warm scan) | Medium |
| **Cohort analysis** | Behavioral cohort evaluation + downstream analysis | 10% of queries | Heavy (full scan + bitmap ops) | Medium |
| **Export/sync** | Bulk event export to warehouse | 5% of queries | Heavy (sequential scan) | Low |
| **API integrations** | Programmatic queries from third-party tools | 5% of queries | Light–Medium | Low |

---

## Key Capacity Thresholds

| Threshold | Trigger | Action |
|---|---|---|
| Queue partition lag > 60s | Ingestion exceeding processing capacity | Scale stream processor consumer group |
| Hot store utilization > 80% | 24h event volume approaching memory limits | Trigger early compaction; increase hot store nodes |
| Query executor utilization > 80% sustained | Query load exceeding compute capacity | Add query worker nodes; optimize cache hit rate |
| Cold storage > 80% of provisioned | Storage growth approaching capacity | Enforce retention policies; tier to cheaper storage class |
| Bloom filter false positive rate > 0.05% | Filter needs rebuilding or resizing | Rebuild bloom filter with updated parameters |
| Per-project query queue depth > 10 | Single tenant overwhelming query capacity | Enforce per-project query concurrency limit |

---

## SLO Error Budgets

### Monthly Error Budget Calculations

| SLO | Target | 30-Day Budget | Budget Units | Measurement |
|---|---|---|---|---|
| Ingestion Availability | 99.99% | 4.32 minutes | Downtime minutes | Rolling 30-day |
| Event Pipeline Freshness (P95) | 60 seconds | 5% of events may exceed 60s | Event fraction | Rolling 24-hour |
| Funnel Query P99 Latency | < 2 seconds | 0.5% of queries may exceed 2s | Query fraction | Rolling 1-hour |
| Retention Query P99 Latency | < 3 seconds | 0.5% of queries may exceed 3s | Query fraction | Rolling 1-hour |
| Query Availability | 99.9% | 43.2 minutes | Downtime minutes | Rolling 30-day |
| GDPR Erasure | 100% within 30 days | 0 violations allowed | Request count | Per request |
| Data Durability (post-ack) | 99.9999% | 10 events lost per 10B ingested | Event count | Rolling 30-day |

### Error Budget Policy

| Budget Remaining | Status | Actions |
|---|---|---|
| > 75% | **Green** | Normal development velocity; deploy at will |
| 50–75% | **Yellow** | Limit deploys to non-ingestion components; investigate recent violations |
| 25–50% | **Orange** | All deploys require on-call review; no schema migrations; scale defensively |
| 10–25% | **Red** | Feature freeze; reliability-only work on ingestion and query paths |
| < 10% | **Exhausted** | Mandatory post-incident review; executive escalation |

---

## Hardware Reference Architecture (At Scale: 10B events/day)

| Component | Count | Specification | Role |
|---|---|---|---|
| Collector nodes | 15 | 8 vCPU, 16 GB RAM, 100 GB SSD | Stateless event intake, bloom filter, enrichment |
| Stream processors | 65 | 16 vCPU, 64 GB RAM, 500 GB NVMe | Event processing, identity resolution, governance |
| Hot store nodes | 12 | 16 vCPU, 128 GB RAM, 2 TB NVMe | In-memory + NVMe columnar (24h window) |
| Warm store nodes | 40 | 8 vCPU, 32 GB RAM, 10 TB SSD | Compressed Parquet (90-day window) |
| Query executor nodes | 32 | 32 vCPU, 128 GB RAM, 1 TB NVMe | Parallel query execution, bitmap ops |
| Identity cache nodes | 6 | 8 vCPU, 64 GB RAM | anonymous\_id → user\_id mapping |
| Queue brokers | 9 | 16 vCPU, 64 GB RAM, 4 TB SSD | Partitioned event queue (RF=3) |
| Metadata store (Raft) | 3 | 8 vCPU, 32 GB RAM, 500 GB SSD | Funnel/cohort/retention definitions |
| Cold storage | — | Object storage, ~1.7 PB | 2+ year event archive |

### Cost Distribution by Function

```
Compute cost breakdown:
  Ingestion path (collectors + stream processors + queue): 38%
  Storage (hot + warm + cold + replication): 35%
  Query execution (executors + cache + materialized view refresh): 22%
  Metadata + identity + governance: 5%
```
