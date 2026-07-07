# 14.13 AI-Native MSME Business Intelligence Dashboard — Observability

## SLI/SLO Definitions

| Service Level Indicator (SLI) | Good Event | Valid Event | SLO Target |
|---|---|---|---|
| NL query availability | Query returns a result (even if from cache or template fallback) | Any NL query request that passes authentication | 99.5% |
| NL query latency | Query response ≤ 3 s (p95) | All successful NL queries | 95% of queries under 3 s |
| NL query accuracy | Query result matches ground truth (human-evaluated weekly sample) | Queries where user provided feedback | ≥ 90% |
| Dashboard availability | Page loads within 2 s with all widgets rendering | Any authenticated dashboard page load | 99.9% |
| Data freshness | Tenant's data is ≤ 15 min old | All active tenants with connected data sources | 95% of tenants |
| Digest delivery timeliness | WhatsApp digest delivered within 5 min of scheduled time | All tenants with digest enabled | 98% |
| Insight precision | Insight rated "useful" by merchant | Insights where merchant provided feedback | ≥ 85% |

---

## Observability Philosophy

This system has a unique observability challenge: it combines traditional backend metrics (latency, throughput, error rates) with **AI quality metrics** (NL-to-SQL accuracy, insight relevance, narrative quality) and **business outcome metrics** (user engagement, digest open rates, query-to-action conversion). A latency spike is immediately detectable; a gradual decline in NL-to-SQL accuracy is not—unless specifically measured.

---

## Key Metrics

### NL-to-SQL Pipeline Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `nl_query.latency_p95` | Histogram | End-to-end NL query response time | > 3.5 s |
| `nl_query.accuracy_rate` | Gauge | % of queries with positive user feedback (rolling 7-day) | < 87% |
| `nl_query.template_hit_rate` | Gauge | % of queries handled by template cache | < 50% (model might be degrading, pushing more to LLM) |
| `nl_query.cache_hit_rate` | Gauge | % of queries served from semantic cache | < 20% |
| `nl_query.clarification_rate` | Gauge | % of queries requiring clarification dialog | > 10% (semantic graph quality issue) |
| `nl_query.validation_rejection_rate` | Counter | Queries rejected by SQL validator | > 2% (LLM generating unsafe SQL) |
| `nl_query.llm_latency_p95` | Histogram | LLM inference time only | > 1.2 s |
| `nl_query.llm_error_rate` | Counter | LLM timeouts or errors | > 1% |

### Data Ingestion Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `ingestion.sync_latency_p95` | Histogram | Time from source change to warehouse availability | > 20 min |
| `ingestion.schema_drift_events` | Counter | Schema changes detected per day | > 50 (unusual bulk migration) |
| `ingestion.dead_letter_rate` | Gauge | % of records sent to dead letter queue | > 2% per connector |
| `ingestion.connector_health` | Gauge | % of active connectors passing health check | < 95% |
| `ingestion.data_quality_score` | Gauge | Average quality score across active connectors | < 0.8 |
| `ingestion.dedup_rate` | Gauge | % of records deduplicated (high = upstream retry storms) | > 5% |

### Insight Engine Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `insights.detection_latency` | Histogram | Time from data arrival to insight generation | > 2 hours |
| `insights.precision_rate` | Gauge | % of delivered insights rated "useful" by merchants | < 70% |
| `insights.anomalies_per_tenant_day` | Gauge | Average anomalies detected per active tenant per day | > 5 (threshold too sensitive) or < 0.1 (too conservative) |
| `insights.root_cause_depth` | Histogram | Number of dimensions explored in root cause analysis | Avg < 2 (shallow analysis) |
| `insights.narrative_generation_latency` | Histogram | LLM time for insight narrative | > 2 s |
| `insights.suppression_rate` | Gauge | % of detected anomalies suppressed by novelty/dedup filters | > 90% (detecting too much noise) |

### WhatsApp Digest Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `digest.delivery_success_rate` | Gauge | % of digests successfully delivered | < 96% |
| `digest.delivery_latency_p95` | Histogram | Time from scheduled delivery to WhatsApp receipt | > 10 min |
| `digest.read_rate` | Gauge | % of delivered digests read (blue tick) | < 40% (content not engaging) |
| `digest.deep_link_click_rate` | Gauge | % of read digests where merchant taps "View Details" | < 15% |
| `digest.unsubscribe_rate` | Gauge | % of merchants opting out per month | > 5% |
| `digest.queue_depth` | Gauge | Pending digests in delivery queue | > 100K (delivery backlog) |

### Multi-Tenant Isolation Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `isolation.cross_tenant_attempts` | Counter | Queries that reference non-session tenant_ids (caught by validator) | > 0 (any occurrence is a security event) |
| `isolation.rls_enforcement_failures` | Counter | Queries that bypassed RLS (should never happen) | > 0 (critical security incident) |
| `isolation.query_cost_rejections` | Counter | Queries rejected for exceeding cost budget | Informational (no alert) |
| `isolation.audit_log_gap` | Gauge | Time since last audit log entry (detect logging failures) | > 5 min |

---

## Distributed Tracing

### Trace Structure for NL Query

Every NL query generates a distributed trace spanning multiple services:

```
Trace: nl_query_{query_id}
├── span: api_gateway (auth, rate_limit)          [5 ms]
├── span: semantic_cache_lookup                    [2 ms]
├── span: intent_classification                    [50 ms]
│   └── attribute: intent=ranking, confidence=0.95
├── span: entity_extraction                        [100 ms]
│   └── attribute: entities={metric:revenue, dim:product, ...}
├── span: schema_mapping                           [80 ms]
│   └── attribute: tables_resolved=2, confidence=0.91
├── span: llm_sql_generation                       [800 ms]
│   └── attribute: model=v2.3, prompt_tokens=1200, completion_tokens=85
├── span: sql_validation                           [50 ms]
│   └── attribute: passed=true, cost_estimate=0.3
├── span: query_execution                          [600 ms]
│   └── attribute: rows_returned=5, partitions_scanned=1
├── span: visualization_selection                  [10 ms]
│   └── attribute: chart_type=horizontal_bar_chart
└── span: narrative_generation                     [300 ms]
    └── attribute: model=v2.3, narrative_length=180_chars
```

### Trace Attributes for Debugging

Critical attributes attached to every trace:
- `tenant_id` — for tenant-scoped debugging
- `query_intent` — for pipeline stage analysis
- `llm_model_version` — for A/B testing model updates
- `cache_status` — `hit`, `miss`, `stale_hit`
- `execution_plan` — query engine's chosen execution plan (for slow query analysis)
- `data_freshness` — age of the newest data row in the result

---

## Dashboards

### Dashboard 1: NL Pipeline Health

**Purpose:** Real-time monitoring of the NL-to-SQL pipeline's accuracy and performance.

**Panels:**
1. Query volume (queries/minute) — time series
2. Latency distribution (p50, p95, p99) — heatmap
3. Accuracy rate (rolling 7-day) — gauge with 90% target line
4. Template vs. LLM vs. cache breakdown — stacked area chart
5. Clarification rate — time series with 10% alert line
6. LLM error rate — time series
7. Top 10 failing query patterns — table (updated hourly)
8. Query confidence distribution — histogram

### Dashboard 2: Tenant Data Health

**Purpose:** Monitor data ingestion, quality, and freshness across all tenants.

**Panels:**
1. Active connectors by type — pie chart
2. Sync latency distribution — heatmap
3. Schema drift events (last 24h) — time series
4. Dead letter queue depth by connector type — stacked bar
5. Data quality score distribution — histogram
6. Tenants with stale data (>1 hour) — count + list
7. Connector failure rate by type — bar chart
8. Deduplication rate — time series

### Dashboard 3: Insight Quality

**Purpose:** Monitor the insight engine's effectiveness and user satisfaction.

**Panels:**
1. Insights generated per day — time series
2. Insight precision (useful/not useful ratio) — rolling gauge
3. Suppression funnel: detected → passed novelty → passed dedup → delivered — funnel chart
4. Root cause attribution depth distribution — histogram
5. Narrative generation latency — heatmap
6. Digest delivery and read rates — dual-axis time series
7. Merchant feedback distribution — bar chart (useful, not_useful, no_feedback)
8. Top insight types by tenant vertical — heatmap

### Dashboard 4: Security & Isolation

**Purpose:** Real-time security monitoring for multi-tenant isolation.

**Panels:**
1. Cross-tenant query attempts (should be zero) — counter with alert
2. RLS enforcement events — counter (should be zero in normal operation)
3. SQL validation rejection reasons — pie chart
4. Query cost distribution by tier — box plot
5. Credential access log volume — time series
6. Adversarial pattern detection alerts — event list
7. Audit log completeness — gauge (100% = no gaps)
8. Tenant data deletion requests and completion status — table

---

## Alerting Strategy

### Severity Levels

| Level | Response Time | Notification | Examples |
|---|---|---|---|
| **P0 — Critical** | 5 min | PagerDuty + phone call | Cross-tenant data exposure, RLS bypass, credential leak |
| **P1 — High** | 15 min | PagerDuty + Slack | NL query accuracy < 85%, WhatsApp delivery < 90%, LLM service down |
| **P2 — Medium** | 1 hour | Slack | Ingestion latency > 30 min, insight precision < 70%, digest queue backlog |
| **P3 — Low** | Next business day | Slack (batch) | Template hit rate drop, schema drift volume spike, minor connector failures |

### Alert Fatigue Prevention

- **Deduplication window:** Same alert fires at most once per 15 minutes
- **Auto-resolve:** Alerts auto-resolve when the metric returns to normal for 5 minutes
- **Correlation:** Group related alerts (e.g., LLM latency spike + query accuracy drop = single incident)
- **Escalation:** Unacknowledged P1 alerts escalate to P0 after 30 minutes
- **Weekly noise review:** Ops team reviews alert-to-action ratio; alerts with <20% action rate are tuned or removed

---

## Logging Strategy

### Log Levels by Service

| Service | DEBUG | INFO | WARN | ERROR |
|---|---|---|---|---|
| NL pipeline | Full prompt + response (dev only) | Query ID, intent, latency | Low confidence, clarification triggered | LLM timeout, validation rejection |
| Ingestion | Row-level processing (dev only) | Sync start/complete, row counts | Schema drift, quality score drop | Connector failure, dead letter |
| Insight engine | Full anomaly calculation (dev only) | Insight generated, delivered | Suppression, low confidence | Detection pipeline failure |
| WhatsApp sender | Template rendering (dev only) | Delivery attempt, receipt | Delivery retry | Delivery failure, template rejection |

### Structured Log Format

All logs use structured JSON with mandatory fields:
- `timestamp` — ISO 8601 with microseconds
- `service` — originating service name
- `tenant_id` — for tenant-scoped log filtering (null for system-level)
- `trace_id` — for correlation with distributed traces
- `level` — DEBUG/INFO/WARN/ERROR
- `message` — human-readable summary
- `metadata` — service-specific structured data

### Log Retention

| Log Type | Hot (searchable) | Warm (archived) | Cold (compliance) |
|---|---|---|---|
| Security/audit | 90 days | 1 year | 7 years |
| Query logs | 30 days | 6 months | 1 year |
| Ingestion logs | 14 days | 3 months | — |
| Application logs | 7 days | 1 month | — |

---

## SLO Dashboards

### NL Query Accuracy SLO Dashboard

**Purpose:** Track NL-to-SQL accuracy against the 90% SLO with error budget visualization.

**Panels:**
1. **Error budget remaining** — Gauge showing % of monthly error budget consumed, with thresholds at 50% (yellow), 75% (orange), 90% (red)
2. **Accuracy trend** — 30-day rolling accuracy rate vs. 90% target line, broken down by query type (template, LLM, clarification)
3. **Accuracy by intent type** — Stacked bar showing accuracy for each intent (metric_query, comparison, trend, drill_down, forecast, ranking)
4. **Accuracy by tenant vertical** — Heatmap showing accuracy across industry verticals (identifies verticals where the semantic graph performs poorly)
5. **Accuracy by language** — Bar chart showing accuracy for English, Hindi, and regional languages (identifies language-specific model gaps)
6. **False confidence rate** — % of queries where the system reported high confidence (> 0.9) but the merchant marked the result as wrong (indicates calibration issues)

### Platform Availability SLO Dashboard

**Purpose:** Track availability against the 99.9% SLO with per-service breakdown.

**Panels:**
1. **Composite availability** — 30-day rolling availability gauge (target: 99.9% = 43.2 min downtime budget)
2. **Per-service availability** — Table showing availability for each critical service (API Gateway, NL pipeline, query engine, insight engine, WhatsApp sender)
3. **Downtime timeline** — Gantt-style chart showing all downtime events in the current month, colored by severity
4. **Error budget burn-down** — Line chart showing cumulative downtime minutes consumed vs. budget line
5. **Deployment correlation** — Overlay deployment events on the availability timeline to correlate deployments with incidents

---

## Incident Playbooks

### Playbook 1: NL Query Accuracy Drop Below 87%

**Trigger:** `nl_query.accuracy_rate` < 87% for 1 hour (rolling 7-day window drops below weekly target)

**Severity:** P1

**Steps:**
1. **Triage (0–5 min):** Check if accuracy drop correlates with:
   - LLM model update (check `llm_model_version` in traces) → rollback model
   - Template cache invalidation (check `template_hit_rate`) → restore template cache
   - Semantic graph bulk update (check `schema_drift_events`) → pause drift processing
2. **Isolate (5–15 min):** Identify affected tenant cohort:
   - By vertical: check accuracy-by-vertical heatmap for concentrated drops
   - By data source: check if accuracy drop correlates with a specific connector type
   - By language: check if multilingual queries are disproportionately affected
3. **Mitigate (15–30 min):**
   - If LLM-related: increase confidence threshold to 0.85 (routes more queries to clarification, fewer wrong answers)
   - If schema-related: revert semantic graph changes for affected tenants
   - If data-related: flag affected tenants' data quality scores for manual review
4. **Resolve:** Deploy fix, verify accuracy recovers above 90% for 2 hours, then close incident
5. **Post-mortem:** Required within 48 hours for any P1 accuracy incident

### Playbook 2: WhatsApp Digest Delivery Backlog > 100K

**Trigger:** `digest.queue_depth` > 100,000 pending messages

**Severity:** P2 (P1 if during primary delivery window 7:30–8:30 AM)

**Steps:**
1. **Assess (0–5 min):** Check WhatsApp API status:
   - `whatsapp_api.error_rate` — if > 10%, likely API-side issue
   - `whatsapp_api.response_latency` — if > 2 s, likely throttling
   - Check WhatsApp Business Platform status page for outage announcements
2. **Mitigate (5–15 min):**
   - If API rate-limited: reduce sending rate to 200 msg/s; extend delivery window
   - If API down: activate email fallback for undelivered digests
   - If sender-side issue: scale up sender instances; check for deadlocked workers
3. **Drain queue (15–60 min):** Monitor queue depth trending toward zero
4. **Verify:** Confirm delivery success rate returns to > 98% and queue depth < 1,000
5. **Notification:** If delivery was delayed > 30 minutes past scheduled time, send tenant notification: "Your morning digest was delayed. Here it is now."

### Playbook 3: Cross-Tenant Data Access Attempt Detected

**Trigger:** `isolation.cross_tenant_attempts` > 0

**Severity:** P0 — ALWAYS

**Steps:**
1. **Immediate (0–2 min):**
   - Page security on-call AND engineering on-call simultaneously
   - Capture full query log entry: NL input, generated SQL, tenant_id, session info, IP address
   - Verify RLS blocked the actual data access (check `rls_enforcement_failures`)
2. **Contain (2–10 min):**
   - If RLS also failed: **CRITICAL** — freeze all query execution platform-wide. Switch to dashboard-only mode (pre-rendered dashboards, no live queries)
   - If RLS caught it (expected): the defense-in-depth worked. Log as a near-miss. Continue investigation
3. **Investigate (10–60 min):**
   - Analyze the NL input: was it adversarial (attempted injection) or accidental (ambiguous query)?
   - Check if the LLM model generated the cross-tenant SQL or if it was a validator bug
   - Verify no data was actually returned to the wrong tenant
4. **Remediate:**
   - If adversarial: add the attack pattern to the input sanitization rules; re-run monthly injection test suite
   - If LLM-generated: add the pattern to the LLM's negative training examples; increase validation strictness
   - If validator bug: hotfix the validator; scan query logs for similar patterns that may have been missed

---

## Tracing Strategy

### End-to-End Trace Correlation Across Async Boundaries

The system has both synchronous paths (NL query → response) and asynchronous paths (data ingestion → insight detection → WhatsApp delivery). Traces must correlate events across these boundaries.

**Synchronous trace propagation:** Standard W3C Trace Context headers propagated through all HTTP calls in the NL query path.

**Asynchronous trace linking:** When an ingestion event triggers an insight that generates a WhatsApp digest, the trace links are:
1. Ingestion event carries `ingestion_trace_id`
2. Insight detection creates a new trace with `parent_link: ingestion_trace_id`
3. Digest compilation creates a new trace with `parent_link: insight_trace_id`
4. WhatsApp delivery creates a new trace with `parent_link: digest_trace_id`

This allows querying: "Given this WhatsApp message, what data ingestion event triggered it?" — essential for debugging "why did the merchant receive this insight?"

### Sampling Strategy

| Path | Sampling Rate | Rationale |
|---|---|---|
| NL queries with negative feedback | 100% | Every negative feedback is a potential accuracy issue |
| NL queries via LLM (non-cached) | 10% | LLM queries are the most interesting for performance analysis |
| NL queries via template/cache | 1% | Template queries are deterministic; low diagnostic value |
| Security events (cross-tenant attempts) | 100% | Every security event is forensically important |
| Insight detection pipeline | 5% | Sufficient for performance profiling; full data in metrics |
| WhatsApp delivery | 2% | Only interesting when delivery fails (failures sampled at 100%) |
| Data ingestion sync | 5% | Higher during schema drift events (100% for drift syncs) |

### Custom Span Attributes for NL Query Debugging

When an NL query produces incorrect results, the following custom span attributes enable rapid root cause identification:

| Attribute | Location | Purpose |
|---|---|---|
| `nl.original_question` | Intent classifier span | Raw user input for reproducing the issue |
| `nl.resolved_time_range` | Entity extractor span | Verify correct temporal interpretation |
| `nl.schema_mapping_alternatives` | Schema mapper span | Show what alternative mappings were considered |
| `nl.llm_prompt_hash` | SQL generator span | Identify which prompt template was used |
| `nl.sql_ast_digest` | Validator span | Compact representation for grouping similar queries |
| `nl.result_row_count` | Execution span | Quick check for "no results" vs "wrong results" |
| `nl.cache_decision` | Cache span | Why cache was hit/missed (key mismatch, TTL expired, data freshness) |
| `nl.user_feedback` | Response span (async) | Attached retroactively when feedback arrives |

---

## AI Quality Monitoring

Unlike traditional backend services, this system requires monitoring AI-specific quality dimensions that degrade gradually rather than failing abruptly.

### NL-to-SQL Model Quality Tracking

| Quality Dimension | Measurement Method | Frequency | Alert Condition |
|---|---|---|---|
| **Accuracy drift** | Compare weekly accuracy against 4-week rolling baseline | Weekly | > 3% decline from baseline |
| **Schema coverage** | % of tenants where >80% of semantic graph nodes are mapped with confidence > 0.8 | Daily | Coverage drops below 85% of active tenants |
| **Query diversity** | Shannon entropy of query intent distribution | Weekly | Entropy drops > 20% (suggests template over-fitting) |
| **Clarification rate** | % of queries requiring clarification dialog | Hourly | > 10% sustained for 24 hours |
| **LLM calibration** | Compare reported confidence with actual accuracy at each confidence level | Weekly | Brier score > 0.15 (miscalibrated) |
| **Template staleness** | Age of oldest template in active use | Weekly | Any template > 90 days without validation |

### Insight Engine Quality Tracking

| Quality Dimension | Measurement Method | Frequency | Alert Condition |
|---|---|---|---|
| **False positive rate** | % of delivered insights rated "not useful" | Rolling 7-day | > 25% "not useful" ratings |
| **Detection sensitivity** | Known anomaly injection test (inject synthetic anomalies, verify detection) | Weekly | Detection rate < 90% on synthetic anomalies |
| **Root cause accuracy** | For insights with merchant-confirmed root cause, compare system's attribution | Monthly | Root cause match rate < 70% |
| **Novelty calibration** | Compare novelty score distribution with "not useful" rate | Monthly | High-novelty insights with high "not useful" rate (novelty model broken) |
| **Narrative quality** | LLM-as-judge evaluation of narrative clarity, accuracy, actionability | Weekly | Quality score drops below 4.0/5.0 |

---

## On-Call Runbook Quick Reference

| Scenario | First Check | Likely Cause | Quick Fix | Escalation |
|---|---|---|---|---|
| NL queries timing out | `llm_queue.depth` | LLM inference overloaded | Scale up GPU pool; enable template-only mode | P1 if > 5 min |
| Dashboard 502 errors | `api_gateway.error_rate` | Backend service crash | Restart service pods; check recent deploys | P1 if > 2 min |
| WhatsApp delivery stalled | `whatsapp_api.response_code` | WhatsApp API throttling or outage | Reduce sending rate; activate email fallback | P2 if > 30 min |
| Data freshness > 1 hour | `ingestion.connector_health` | Source system outage or credential expiry | Check source health dashboard; trigger credential refresh | P2 if > 10% tenants |
| Cross-tenant alert fired | `isolation.cross_tenant_attempts` | NL injection attempt or LLM hallucination | Capture forensics; verify RLS blocked; follow Playbook 3 | P0 ALWAYS |
| Insight precision dropping | `insights.precision_rate` trend | Threshold drift or seasonal model stale | Re-run threshold calibration; check for industry events | P3 if gradual |
| Semantic graph errors | `schema_mapping.error_rate` | Schema drift from source update | Pause affected connector; review drift events | P2 if > 5% tenants |
| Cache hit rate dropping | `nl_query.cache_hit_rate` trend | Cache eviction from data freshness updates | Verify cache size; check for bulk ingestion events | P3 informational |

---

## AI Observability Standards

This system's AI components MUST implement the observability patterns defined in:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — trace model, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, human review sampling

### Required AI-Specific Metrics
- Model prediction confidence distribution
- Human override rate (target: track, not minimize)
- AI recommendation acceptance rate by decision type
- Drift detection alerts (data drift + concept drift)
- Cost per AI-assisted decision
