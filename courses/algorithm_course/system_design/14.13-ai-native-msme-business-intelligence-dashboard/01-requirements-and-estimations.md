# 14.13 AI-Native MSME Business Intelligence Dashboard — Requirements & Estimations

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR-01 | **Natural language querying** — Accept business questions in natural language (English + 10 regional languages), translate to SQL via a multi-stage NL-to-SQL pipeline, execute against the tenant's data warehouse, and return results with auto-selected visualizations and narrative explanations | Query accuracy ≥ 90% on first attempt; clarification dialog when confidence < 70%; support for follow-up questions with conversational context ("now break that down by region"); response time ≤ 3 seconds for p95 queries |
| FR-02 | **Automated data source connectors** — Pluggable connectors for common MSME data sources: accounting software (Tally, Zoho Books), POS systems, e-commerce platforms, bank statement parsers, spreadsheet uploads (CSV/Excel); CDC-based incremental sync with schema drift detection | Support 20+ connector types; initial data ingestion ≤ 30 minutes for 1 million rows; incremental sync latency ≤ 15 minutes; AI-assisted column mapping with merchant confirmation; data quality scoring per source |
| FR-03 | **Semantic graph construction** — Automatically build a business semantic layer from raw data schemas: infer business concepts from column names, detect table relationships, resolve entity ambiguities, and map raw fields to standardized business metrics (revenue, margin, customer lifetime value) | Cold-start graph generation ≤ 10 minutes; semantic mapping accuracy ≥ 85% (verified by merchant); support for merchant corrections that retrain the mapping model; versioned graph with rollback |
| FR-04 | **Auto-insight generation** — Continuously analyze all tracked KPIs for anomalies, trend changes, and significant patterns; generate narrative explanations with root cause attribution; rank insights by business impact | Detect anomalies within 1 hour of data arrival; false positive rate ≤ 15% after 30-day learning period; root cause drill-down to at least 3 dimensions (product, channel, customer segment, time period); impact quantification in revenue terms |
| FR-05 | **KPI tracking and alerting** — Pre-configured and custom KPI definitions with configurable thresholds; real-time monitoring with alert escalation via WhatsApp, SMS, and in-app notifications | Support 50+ pre-built KPI templates per industry vertical; custom KPI builder via natural language ("track ratio of returns to sales by product category weekly"); threshold alerts with suppression for known seasonality |
| FR-06 | **Industry benchmark comparison** — Provide anonymized peer benchmarks for key KPIs segmented by industry, geography, revenue band, and business age; show percentile rankings and trend comparisons against the cohort | Minimum cohort size of 50 tenants for benchmark generation; differential privacy with ε ≤ 1.0; monthly benchmark refresh; benchmark categories for 30+ MSME verticals |
| FR-07 | **WhatsApp business digest** — AI-curated daily/weekly business summaries delivered via WhatsApp Business API: top 3 ranked insights, KPI status indicators (green/yellow/red), anomaly alerts with suggested actions, tap-to-explore deep links | Delivery within configurable time window (default 8:00 AM local time); message body ≤ 1024 characters per template; support for rich media (charts as images); read receipt tracking; digest personalization based on merchant's focus areas |
| FR-08 | **Interactive dashboard builder** — Drag-and-drop dashboard creation for users who prefer visual exploration; AI-suggested widget layouts based on connected data sources; auto-refresh with configurable intervals | Support 15+ chart types; dashboard sharing with role-based access; scheduled exports (PDF, Excel); mobile-responsive layouts; embeddable widgets via iframe with auth tokens |
| FR-09 | **Conversational analytics context** — Maintain conversation history for follow-up queries; support refinements ("exclude online orders"), drill-downs ("break that by city"), and comparisons ("compare with last quarter"); persist sessions for returning users | Context window of 10 previous queries per session; session persistence for 7 days; named sessions ("Monday review") that users can resume; exportable conversation threads |
| FR-10 | **Data blending and preparation** — AI-assisted data joining across sources; automatic type coercion, null handling, and deduplication; computed columns via natural language formulas; scheduled data transformations | Support joins across up to 5 data sources; AI suggests join keys from value overlap analysis; transformation lineage tracking; rollback for incorrect transformations |
| FR-11 | **Report scheduling and distribution** — Scheduled report generation and delivery via email, WhatsApp, or in-app; parameterized reports (e.g., "weekly sales report for each store location"); PDF and Excel export with branded headers | Cron-based scheduling with timezone awareness; report generation ≤ 60 seconds; distribution list management; report versioning with historical archive |
| FR-12 | **Goal tracking and forecasting** — Set business goals (revenue targets, customer acquisition, expense budgets) with AI-generated forecasts showing probability of achievement; proactive alerts when trajectory deviates from target | Forecast accuracy within ±15% for 30-day horizon; support for manual adjustments to forecast assumptions; confidence intervals displayed; "what-if" scenario modeling via natural language |
| FR-13 | **Multi-language support** — Accept NL queries in English, Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, and code-mixed inputs (e.g., "last week ka revenue"); generate narratives and digests in the merchant's preferred language | Support 8+ languages; code-mixed query accuracy ≥ 85%; language detection confidence ≥ 95%; zero-shot support for new languages within 3 months |
| FR-14 | **Audit and compliance reporting** — Generate GST-ready reports, tax computation summaries, and compliance dashboards from connected accounting data; 7-year tamper-evident data retention with exportable audit trails | GST report generation ≤ 30 seconds; automated reconciliation across accounting and bank data; compliance status dashboard with traffic-light indicators |

---

## Out of Scope

- **ETL pipeline management** — No custom data transformation scripting; the platform handles data prep via AI-assisted tooling, not user-written ETL jobs
- **Real-time streaming analytics** — Data freshness targets are 15-minute incremental sync, not sub-second event streaming; no CEP (complex event processing)
- **Data science workbench** — No Jupyter notebooks, custom model training, or Python/R scripting; analytics are consumed through NL queries and pre-built dashboards
- **Multi-tenant data sharing** — No cross-tenant data collaboration or shared datasets; benchmarks use anonymized aggregates only
- **Transactional operations** — No write-back to source systems; the platform is read-only analytics, not an operational tool for placing orders or updating inventory

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| NL-to-SQL query response (p95) | ≤ 3 s | Users expect conversational speed; >5 s feels broken for a "chat with data" interface |
| NL-to-SQL accuracy (first attempt) | ≥ 90% | Below 85%, users lose trust and revert to manual dashboard exploration |
| Dashboard page load (p95) | ≤ 2 s | Standard web application expectation; dashboards with 10+ widgets |
| Auto-insight detection latency | ≤ 1 hour from data arrival | Insights on yesterday's data must be ready for the morning WhatsApp digest |
| Data connector sync (p95) | ≤ 15 min incremental | Merchants expect "current" data when asking questions; 15-min staleness is acceptable |
| Semantic graph cold-start | ≤ 10 min | Onboarding experience: merchant connects data and gets first usable query within 15 minutes |
| WhatsApp digest delivery (p95) | Within 5 min of scheduled time | Late delivery misses the merchant's morning routine window |
| Benchmark computation | ≤ 4 hours (nightly batch) | Benchmarks are not real-time; nightly refresh is sufficient |
| Report generation (p95) | ≤ 60 s | Scheduled reports should not queue for minutes during peak delivery windows |

### Reliability & Availability

| Metric | Target |
|---|---|
| Platform availability | 99.9% (≤ 8.76 hours downtime/year) |
| Data pipeline reliability | 99.95% (no data loss during ingestion) |
| NL query service availability | 99.5% (LLM dependency allows slightly lower) |
| WhatsApp delivery success rate | ≥ 98% (dependent on WhatsApp API availability) |
| Scheduled report delivery | 99.9% on-time delivery |
| Data retention | 3 years hot storage, 7 years cold archive |

---

## Capacity Estimations

### User Scale

| Parameter | Estimate | Basis |
|---|---|---|
| Total registered MSMEs | 2 million | Target market: India's 63M+ MSMEs; 3% initial penetration |
| Monthly active tenants (MAT) | 800,000 (40% of registered) | Typical SaaS engagement rate for SME analytics tools |
| Daily active tenants (DAT) | 200,000 (25% of MAT) | Merchants check dashboards 1-2× daily on average |
| Avg users per tenant | 2.5 | Owner + 1-2 managers/accountants |
| Peak concurrent users | 100,000 | Morning (8-10 AM) and evening (6-8 PM) check-in patterns |

### Query Scale

| Parameter | Estimate | Calculation |
|---|---|---|
| NL queries per DAT per day | 5 | Light analytics usage pattern for MSME users |
| Total NL queries per day | 1,000,000 | 200K DAT × 5 queries |
| Peak NL queries per second | 30 | 1M queries / 86,400s × 2.5 (peak factor) |
| Dashboard widget refreshes/day | 5,000,000 | 200K DAT × 5 widgets avg × 5 refreshes |
| Auto-insight evaluations/day | 800,000 | 1 evaluation per MAT per day |
| WhatsApp digests per day | 600,000 | 75% of MAT opt-in to daily digest |

### Storage

| Parameter | Estimate | Calculation |
|---|---|---|
| Avg data per tenant | 500 MB (raw), 200 MB (columnar compressed) | ~100K transactions × 5 KB avg row size; 2.5× compression |
| Total raw data | 1 PB | 2M tenants × 500 MB |
| Total compressed analytical store | 400 TB | 2M tenants × 200 MB |
| Semantic graph per tenant | 50 KB | ~200 tables, 2000 columns, relationship metadata |
| Total semantic graphs | 100 GB | 2M tenants × 50 KB |
| Query logs (30-day retention) | 15 TB | 30M queries/month × 500 bytes avg × 30 days |
| Materialized view cache | 80 TB | 800K MAT × 100 MB avg (pre-aggregated summaries) |

### Compute

| Component | Estimate | Calculation |
|---|---|---|
| NL-to-SQL LLM inference | 120 GPU-hours/day | 1M queries × 0.4s avg GPU time per query |
| Auto-insight detection | 80 CPU-hours/day | 800K tenants × 0.36s avg per evaluation |
| Narrative generation (LLM) | 40 GPU-hours/day | 1M queries + 800K insights × 0.1s avg per narration |
| Data ingestion pipeline | 200 CPU-hours/day | 800K incremental syncs × 0.9s avg |
| Benchmark aggregation (nightly) | 50 CPU-hours | Aggregation across 2M tenants with differential privacy |

### Cost Estimation (Monthly)

| Component | Monthly Cost | Notes |
|---|---|---|
| Compute (analytical queries) | $85,000 | Columnar query engine cluster |
| GPU inference (NL-to-SQL + narration) | $120,000 | 160 GPU-hours/day × 30 days |
| Object storage (raw data) | $25,000 | 1 PB at $0.025/GB |
| Columnar analytical storage | $40,000 | 400 TB with replication |
| WhatsApp Business API | $18,000 | 600K messages/day × $0.001 avg per utility message × 30 |
| Data connectors (API calls) | $15,000 | Rate-limited API calls to source systems |
| CDN and networking | $8,000 | Dashboard asset delivery |
| **Total estimated** | **~$311,000/month** | **$0.16/MAT/month** or **$0.39/DAT/month** |

---

## SLO Summary Dashboard

| SLO | Target | Measurement | Alert Threshold |
|---|---|---|---|
| NL query accuracy | ≥ 90% | Weekly sample of 1000 queries human-evaluated | < 87% triggers model review |
| NL query latency (p95) | ≤ 3 s | Real-time percentile tracking | > 4 s triggers auto-scaling |
| Platform availability | 99.9% | Uptime monitoring per service | < 99.8% triggers incident review |
| WhatsApp delivery rate | ≥ 98% | Delivery receipts from WhatsApp API | < 96% triggers channel investigation |
| Auto-insight precision | ≥ 85% | Monthly sample of 500 insights human-evaluated | < 80% triggers threshold tuning |
| Data freshness | ≤ 15 min | Max lag across all active connectors per tenant | > 30 min triggers connector health check |
| Dashboard load time (p95) | ≤ 2 s | Real user monitoring (RUM) | > 3 s triggers performance review |
| Benchmark coverage | ≥ 80% of verticals | % of tenants with benchmarks available | < 70% triggers cohort expansion |

---

## Bandwidth and Throughput Estimates

### LLM Token Budget

| Operation | Avg Input Tokens | Avg Output Tokens | Daily Volume | Daily Token Budget |
|---|---|---|---|---|
| NL-to-SQL generation | 1,200 (schema context + query + few-shot) | 85 (SQL query) | 400K (40% of 1M queries hit LLM) | 514M tokens |
| Narrative generation | 400 (result set + context) | 150 (explanation + follow-ups) | 1M queries + 880K insights | 1.03B tokens |
| Digest composition | 600 (3 insights + KPI summary) | 250 (compressed narrative) | 600K digests | 510M tokens |
| Column mapping | 800 (column samples + ontology) | 100 (mapping suggestions) | 50K (schema drift + onboarding) | 45M tokens |
| **Total daily** | — | — | — | **~2.1B tokens/day** |

### Network Throughput

| Path | Peak Throughput | Sustained Throughput | Protocol |
|---|---|---|---|
| Client → API Gateway | 5,000 req/s | 1,500 req/s | HTTPS (TLS 1.3) |
| API Gateway → NL Pipeline | 3,000 req/s | 800 req/s | gRPC (HTTP/2) |
| NL Pipeline → LLM Inference | 500 req/s | 200 req/s | gRPC (batched) |
| Query Engine → Warehouse | 2,000 queries/s | 600 queries/s | Native protocol |
| Ingestion → Warehouse | 50,000 rows/s | 15,000 rows/s | Bulk insert |
| WhatsApp Sender → API | 500 msg/s | 200 msg/s | HTTPS |

---

## SLO Error Budgets

| SLO | Target | Error Budget (30-day) | Budget Consumption Rate | Escalation |
|---|---|---|---|---|
| Platform availability | 99.9% | 43.2 minutes downtime | > 50% consumed in first 15 days → freeze deployments | P1 incident if > 75% consumed |
| NL query latency (p95) | ≤ 3 s | 0.5% of queries can exceed 3 s = ~5,000 queries/day | Track rolling 7-day; > 3% burn rate → auto-scale | P2 if sustained > 5% burn for 24 hours |
| NL query accuracy | ≥ 90% | 10% of queries can be inaccurate = ~100,000 queries/month | Weekly cohort evaluation; > 12% inaccuracy → model review | P1 if accuracy < 85% for 7 consecutive days |
| WhatsApp delivery | ≥ 98% | 2% of digests can fail = ~12,000/day | Hourly check; > 4% failure rate → channel investigation | P1 if delivery < 95% for 2 consecutive hours |
| Data freshness | ≤ 15 min | 5% of connectors can exceed 15 min = ~40,000 connectors | Per-connector monitoring; stale > 1 hour → auto-reconnect | P2 if > 10% of connectors stale for 30+ minutes |
| Auto-insight precision | ≥ 85% | 15% of insights can be irrelevant = ~120,000/month | Monthly batch evaluation with human raters | P3 if precision < 80% for 2 consecutive weeks |

**Error budget policy:**
- When a budget is consumed beyond 75%, non-essential deployments are frozen until the budget resets at month-end
- When a budget is consumed beyond 90%, the responsible team enters "reliability sprint" mode — all feature work pauses until the SLO is restored
- Monthly error budget review: any SLO that consumed > 50% of its budget gets a root cause analysis and a prevention plan

---

## Hardware and Infrastructure Estimates

### Compute Infrastructure (Target Scale — 2M Tenants)

| Component | Instance Type | Count | Specification | Monthly Cost |
|---|---|---|---|---|
| NL-to-SQL service | CPU-optimized, 16 vCPU, 32 GB RAM | 8–40 (auto-scaled) | Handles intent classification, entity extraction, schema mapping, SQL validation | $12,000–$60,000 |
| LLM inference pool | GPU instances, 1 GPU + 48 GB VRAM each | 4–20 (auto-scaled) | Serves SQL generation and narrative generation | $40,000–$200,000 |
| Query engine cluster | Memory-optimized, 32 vCPU, 256 GB RAM | 16–80 (auto-scaled) | Columnar analytical query execution | $50,000–$250,000 |
| Insight engine | CPU-optimized, 16 vCPU, 64 GB RAM | 8–20 (auto-scaled) | Anomaly detection, root cause analysis, ranking | $8,000–$20,000 |
| Ingestion workers | General-purpose, 8 vCPU, 16 GB RAM | 8–40 (auto-scaled) | Data connector sync, schema mapping, quality scoring | $4,000–$20,000 |
| WhatsApp delivery | General-purpose, 4 vCPU, 8 GB RAM | 4–10 | Digest compilation, rate-limited delivery | $2,000–$5,000 |
| API gateway | CPU-optimized, 8 vCPU, 16 GB RAM | 6–20 (auto-scaled) | Authentication, rate limiting, routing | $4,000–$14,000 |

### Storage Infrastructure

| Store | Technology | Capacity | Replication | Monthly Cost |
|---|---|---|---|---|
| Hot analytical store | Columnar engine (SSD-backed) | 300 TB | 2× (primary + replica) | $45,000 |
| Warm analytical store | Compressed columnar (HDD-backed) | 400 TB | 2× | $16,000 |
| Cold archive | Object storage | 300 TB | 3× (cross-region) | $7,500 |
| Semantic graph store | Key-value store (SSD-backed) | 200 GB | 3× (synchronous) | $800 |
| Query result cache | In-memory key-value store | 2 TB | 2× (primary + replica) | $12,000 |
| Materialized views | Columnar engine (SSD-backed) | 100 TB | 1× (recomputable) | $15,000 |
| Metadata & config | Relational database | 500 GB | 3× (multi-AZ) | $2,000 |
| Query/audit logs | Log analytics store | 20 TB (hot) | 2× | $8,000 |

### Network and Bandwidth

| Traffic Type | Estimated Monthly Volume | Cost |
|---|---|---|
| Ingestion (source → platform) | 50 TB inbound | $0 (free inbound) |
| API responses (platform → client) | 20 TB outbound | $1,500 |
| Cross-region replication | 30 TB | $2,700 |
| CDN (dashboard assets) | 15 TB | $1,200 |
| WhatsApp API calls | 18M messages/month | $18,000 |

### Total Infrastructure Cost Summary

| Category | Monthly Cost | % of Total |
|---|---|---|
| Compute | $140,000–$370,000 | 45–55% |
| Storage | $106,300 | 25–35% |
| Network & APIs | $23,400 | 7–10% |
| Monitoring & observability | $15,000 | 4–5% |
| Security (HSM, WAF, audit) | $12,000 | 3–4% |
| **Total at target scale** | **~$300,000–$530,000/month** | — |
| **Per MAT (800K)** | **$0.38–$0.66/month** | — |
| **Per DAT (200K)** | **$1.50–$2.65/month** | — |

### Cost Optimization Levers

| Lever | Savings | Trade-off |
|---|---|---|
| Template promotion (reduce LLM calls by 60%) | $70K–$120K/month | Requires template maintenance; 3-week ramp-up |
| Semantic caching (25% query hit rate) | $30K–$50K/month | 15-min staleness; cache invalidation complexity |
| Tiered storage (30/40/30 hot/warm/cold) | $25K/month | Cold queries take 5-10× longer |
| Smaller LLM for simple queries | $40K–$60K/month | Accuracy drops ~2% for distilled model |
| Lazy MV refresh (70% of views) | $15K/month | Some queries hit stale data (flagged with indicator) |
| Spot/preemptible instances for insight batch | $10K/month | Requires checkpoint-based fault tolerance |

### Unit Economics at Scale

| Scale | Tenants | Revenue (at ₹500/month) | Infrastructure Cost | Gross Margin |
|---|---|---|---|---|
| Year 1 | 200K registered, 50K paid | ₹2.5 Cr/month ($300K) | $80K | 73% |
| Year 2 | 800K registered, 200K paid | ₹10 Cr/month ($1.2M) | $250K | 79% |
| Year 3 | 2M registered, 500K paid | ₹25 Cr/month ($3.0M) | $400K | 87% |

**Key insight:** Gross margin improves with scale because:
1. Template and cache hit rates increase (more queries → more patterns → more templates)
2. Materialized view reuse improves (similar tenants share query patterns)
3. LLM inference cost per query decreases with batching at higher volume
4. Storage cost per tenant decreases with better compression across larger datasets
5. Benchmark cohorts become denser (more tenants per cohort → better benchmarks → higher engagement)
6. WhatsApp API volume discounts apply at higher message volumes

**Break-even analysis:** At ₹500/month per paid tenant, the platform reaches break-even at ~100K paid tenants (50K paid × ₹500 = ₹2.5 Cr/month ≈ $300K, matching Year 1 infrastructure costs). With a 25% paid conversion rate, this requires 400K registered tenants — achievable in Year 1 with a strong go-to-market in India's MSME segment.
