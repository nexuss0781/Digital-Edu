# Observability — AI-Native Data Catalog & Governance

## Key Metrics

### Catalog Health Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `catalog.entity_count` | Gauge | Total entities in the catalog by type | Sudden drop > 5% (mass deletion) |
| `catalog.metadata_freshness_p99` | Histogram | Time from source change to catalog reflection | > 5 minutes |
| `catalog.stale_entity_ratio` | Gauge | Percentage of entities not updated in 30+ days | > 30% |
| `catalog.orphan_entity_count` | Gauge | Entities with no owner and no recent usage | > 10% of total |
| `catalog.description_coverage` | Gauge | Percentage of entities with non-empty descriptions | < 60% |
| `catalog.lineage_coverage` | Gauge | Percentage of tables with at least one lineage edge | < 80% |
| `catalog.graph_size_nodes` | Gauge | Total nodes in metadata graph | Monitor growth rate for capacity planning |
| `catalog.graph_size_edges` | Gauge | Total edges (relationships) in metadata graph | Monitor growth rate for capacity planning |

### Ingestion Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `ingestion.events_per_second` | Counter | Metadata change events processed per second | Drop > 50% from baseline |
| `ingestion.connector_status` | Gauge | Health status per connector (healthy/degraded/failed) | Any connector in "failed" state |
| `ingestion.connector_latency_p99` | Histogram | Time per connector crawl cycle | > 10 minutes |
| `ingestion.parse_failure_rate` | Counter | SQL statements that failed AST parsing | > 5% of total |
| `ingestion.event_bus_lag` | Gauge | Consumer lag on metadata event partitions | > 10,000 events |
| `ingestion.schema_drift_events` | Counter | Schema changes detected per hour | Spike > 3x baseline (mass migration?) |
| `ingestion.connector_credential_expiry` | Gauge | Days until connector credential expires | < 7 days |
| `ingestion.backpressure_events` | Counter | Times connector throttled due to event bus congestion | > 0 sustained |

### Search & Discovery Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `search.query_latency_p50` | Histogram | Search response time (median) | > 200ms |
| `search.query_latency_p99` | Histogram | Search response time (tail) | > 1s |
| `search.click_through_rate` | Gauge | Percentage of searches that result in a click | < 30% (ranking quality issue) |
| `search.zero_result_rate` | Gauge | Percentage of searches returning no results | > 10% |
| `search.refinement_rate` | Gauge | Percentage of searches followed by a refined query | > 40% (users not finding what they need) |
| `search.index_sync_lag` | Gauge | Delay between graph write and search index update | > 5 seconds |
| `search.semantic_search_latency_p50` | Histogram | Vector similarity search response time | > 500ms |
| `search.position_of_click` | Histogram | Average rank position of clicked results | > 3.0 (ranking quality issue) |

### Classification Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `classification.columns_scanned_per_hour` | Counter | Classification throughput | Drop > 50% |
| `classification.auto_applied_rate` | Gauge | Percentage of classifications applied without human review | < 50% (threshold too high) or > 95% (threshold too low) |
| `classification.pending_review_backlog` | Gauge | Classifications awaiting human review | > 500 |
| `classification.override_rate` | Gauge | Percentage of auto-classifications overridden by humans | > 15% (model accuracy issue) |
| `classification.precision_estimate` | Gauge | Estimated precision from human review feedback | < 90% |
| `classification.unclassified_pii_columns` | Gauge | Known PII columns without classification tags | > 0 (compliance risk) |
| `classification.llm_fallback_rate` | Gauge | Percentage of classifications requiring LLM disambiguation | > 10% (model quality issue or data complexity) |
| `classification.model_drift_score` | Gauge | Statistical distance between training distribution and production data | > 0.1 (retrain needed) |

### Policy & Governance Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `policy.evaluation_latency_p99` | Histogram | Time to evaluate access policy | > 50ms |
| `policy.deny_rate` | Gauge | Percentage of access requests denied | Spike > 2x baseline |
| `policy.masking_applied_count` | Counter | Number of columns actively masked | Monitor for unexpected drops |
| `policy.untagged_pii_ratio` | Gauge | PII columns without governance policy coverage | > 0% |
| `policy.policy_change_count` | Counter | Policy modifications per day | Spike outside change windows |
| `policy.cache_hit_rate` | Gauge | Percentage of policy evaluations served from cache | < 80% (cache sizing issue) |
| `policy.conflict_count` | Counter | Policy conflicts detected per day | > 0 requires review |

### NL-to-SQL Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `nlsql.response_latency_p50` | Histogram | Time to generate SQL from natural language | > 3s |
| `nlsql.confidence_score_avg` | Gauge | Average confidence of generated SQL | < 0.7 |
| `nlsql.self_correction_rate` | Gauge | Percentage of queries needing SQL repair loop | > 30% |
| `nlsql.user_acceptance_rate` | Gauge | Percentage of generated SQL that users execute | < 50% |
| `nlsql.llm_error_rate` | Counter | LLM API failures or timeouts | > 2% |
| `nlsql.context_window_overflow_rate` | Gauge | Percentage of queries where schema context exceeded token limit | > 5% |
| `nlsql.cache_hit_rate` | Gauge | Percentage of NL queries served from response cache | Track for cost optimization |

### Active Metadata Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `active_metadata.event_processing_latency_p99` | Histogram | Time from event emission to downstream action | > 30s |
| `active_metadata.automation_trigger_count` | Counter | Automated actions triggered per hour | Monitor for unexpected spikes |
| `active_metadata.dead_letter_queue_size` | Gauge | Events that failed processing after retries | > 0 requires investigation |
| `active_metadata.tag_propagation_latency` | Histogram | Time to propagate a tag through lineage subgraph | > 60s |
| `active_metadata.event_dedup_rate` | Gauge | Percentage of events deduplicated (redundant) | > 50% (source emitting too many events) |

### AI Agent Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `agent.api_calls_per_hour` | Counter | AI agent API calls | Spike > 5x baseline (possible abuse) |
| `agent.unique_agents_active` | Gauge | Distinct AI agents accessing catalog | Monitor for unauthorized agents |
| `agent.datasets_discovered_per_session` | Histogram | Datasets found per agent session | Track for API effectiveness |
| `agent.policy_denial_rate` | Gauge | Percentage of agent access requests denied | > 20% (agent misconfigured) |

### Adoption Metrics (Business-Critical)

| Metric | Type | Description | Target |
|--------|------|-------------|--------|
| `adoption.weekly_active_users` | Gauge | Unique users accessing the catalog per week | > 60% of data practitioners |
| `adoption.searches_per_user_per_week` | Gauge | Average search frequency | > 10 |
| `adoption.time_to_first_discovery` | Histogram | Time for new user to find their first useful dataset | < 5 minutes |
| `adoption.certified_asset_ratio` | Gauge | Percentage of frequently-used assets that are certified | > 40% |
| `adoption.domain_coverage` | Gauge | Percentage of domains with active ownership | 100% |
| `adoption.description_contribution_rate` | Counter | Descriptions added/updated per week per domain | > 0 for every active domain |
| `adoption.data_contract_coverage` | Gauge | Percentage of production tables covered by data contracts | > 30% |

---

### Data Contract Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `contracts.active_count` | Gauge | Number of active data contracts | Monitor trend |
| `contracts.violation_count_24h` | Counter | Contract violations in last 24 hours | > 0 requires investigation |
| `contracts.coverage_ratio` | Gauge | Production tables with active contracts / total production tables | < 20% (low adoption) |
| `contracts.validation_latency_p99` | Histogram | Time to validate schema change against contracts | > 5s |
| `contracts.breaking_change_blocked` | Counter | Breaking changes prevented by contract validation | Track for value demonstration |

### Capacity Planning Metrics

| Metric | Type | Description | Capacity Trigger |
|--------|------|-------------|-----------------|
| `capacity.graph_db_storage_used_pct` | Gauge | Metadata graph storage utilization | > 70% → plan expansion |
| `capacity.search_heap_used_pct` | Gauge | Search index memory utilization | > 75% → add nodes |
| `capacity.event_bus_partition_count` | Gauge | Number of event bus partitions | < 2x consumer count → rebalance |
| `capacity.connector_pod_utilization` | Gauge | Average connector pod CPU utilization | > 80% sustained → scale up |
| `capacity.classification_queue_depth` | Gauge | Pending classification items | > 24 hours of backlog → scale workers |
| `capacity.cache_memory_used_pct` | Gauge | Redis cache memory utilization | > 85% → increase cache size or tune TTLs |
| `capacity.audit_storage_30d_growth` | Gauge | Audit log storage growth rate | Project 12-month runway; alert if < 3 months |

---

## SLO Dashboard Design

### SLO Budget Tracking

```
SLO: Availability (99.9%)
  Monthly error budget: 43.8 minutes
  Budget consumed: ████░░░░░░ 35% (15.3 min)
  Burn rate: 1.2x (within tolerance)

SLO: Search Latency (p99 < 1s)
  Monthly budget: 0.1% of queries > 1s
  Budget consumed: ██░░░░░░░░ 18%
  Burn rate: 0.6x (healthy)

SLO: Metadata Freshness (< 5 min)
  Monthly budget: 0.1% of sources > 5 min
  Budget consumed: ███████░░░ 68% ⚠️
  Burn rate: 2.3x (warning — investigate connector lag)

SLO: Classification Accuracy (> 95% precision)
  Quarterly measurement (last review)
  Precision: 96.2%  Recall: 91.4%
  Next review: 2026-06-15

SLO: Policy Enforcement (100%, zero bypass)
  Violations detected: 0
  Last audit: 2026-03-15
```

---

## Logging Strategy

### Structured Log Format

```
{
  "timestamp": "2026-03-10T14:30:00.000Z",
  "service": "search-service",
  "level": "INFO",
  "trace_id": "abc123def456",
  "span_id": "span789",
  "user_id": "user-42",
  "event": "search_query",
  "query": "customer orders",
  "filters": {"type": "table", "domain": "commerce"},
  "result_count": 23,
  "latency_ms": 145,
  "cache_hit": false
}
```

### Log Levels

| Level | When | Examples | Volume (est.) |
|-------|------|---------|--------------|
| **ERROR** | System failure requiring immediate attention | Connector auth failure, graph write conflict, LLM API timeout | < 100/day |
| **WARN** | Degraded operation, potential issue | Classification confidence below threshold, search index lag > 5s, stale connector | < 1,000/day |
| **INFO** | Normal operations, audit-worthy events | Search queries, policy evaluations, classification results, entity updates | ~500K/day |
| **DEBUG** | Detailed troubleshooting | SQL parsing details, ranking score breakdowns, cache hit/miss details | ~5M/day (sampled) |

### Log Retention by Service

| Service | Retention | Storage Strategy | Purpose |
|---------|-----------|-----------------|---------|
| API Gateway | 30 days | Hot storage → cold archive | Traffic analysis, abuse detection |
| Search Service | 90 days | Hot (7d) → warm (90d) | Ranking quality analysis, query patterns |
| Policy Service | 7 years | WORM object storage | Compliance audit trail |
| Classification Engine | 1 year | Hot (30d) → warm (1y) | Model accuracy tracking, feedback loop |
| Ingestion Pipeline | 30 days | Hot storage | Connector debugging, freshness analysis |
| NL-to-SQL Engine | 90 days | Hot (7d) → warm (90d) | Quality analysis, prompt optimization |

---

## Distributed Tracing

### Key Trace Paths

| Path | Spans | Purpose | Latency Budget |
|------|-------|---------|---------------|
| **Search query** | API Gateway → Auth → Search Service → Search Index → Ranking Model → Policy Filter → Response | End-to-end search latency breakdown | < 1s total |
| **Metadata ingestion** | Connector → SQL Parser → Event Bus → Active Metadata Processor → Graph Write → Index Update | Ingestion pipeline latency per event | < 60s total |
| **Classification** | Classification Worker → Data Sampling → NER Model → Confidence Scoring → Tag Write | Classification pipeline per column | < 5s per column |
| **NL-to-SQL** | NL Query → Intent Extraction → Catalog RAG → LLM Inference → SQL Validation → Policy Check | NL query latency breakdown | < 5s total |
| **Policy evaluation** | Policy Service → Tag Resolution → Policy Matching → Decision → Audit Log | Access decision latency | < 50ms total |
| **Active metadata** | Event → Rule Matching → Action Execution → Downstream Notification | Automation pipeline latency | < 10s total |
| **Impact analysis** | Lineage Service → Graph Traversal → Consumer Enumeration → Notification | Impact query latency | < 5s (3 hops) |

### Trace Propagation

- **W3C Trace Context** headers propagated across all HTTP and gRPC calls
- **Event bus messages** carry trace context in message headers for async pipeline tracing
- **Connector traces** linked to source system audit logs via correlation IDs
- **LLM traces** include prompt token count, completion token count, model version, and latency breakdown (queue time vs inference time)

### Trace Sampling Strategy

| Traffic Type | Sampling Rate | Justification |
|-------------|---------------|---------------|
| Error traces | 100% | Every error must be debuggable |
| Slow traces (> 2x p50) | 100% | Tail latency investigation |
| Normal search queries | 10% | Sufficient for aggregate analysis |
| Ingestion events | 1% | High volume; sample is representative |
| Policy evaluations | 5% | Moderate volume; governance-relevant |
| NL-to-SQL queries | 100% | Low volume; every query is valuable for improvement |

---

## Alerting Rules

### Critical (Page-Worthy)

| Alert | Condition | Runbook Action |
|-------|-----------|----------------|
| **Graph database down** | Primary unreachable for > 30s | Verify failover to standby; check replication lag |
| **Policy service unresponsive** | Policy evaluation latency > 5s or error rate > 5% | Restart policy service; fallback to cached decisions |
| **Connector credential expired** | Any connector fails authentication | Rotate credentials in secrets manager; verify auto-rotation config |
| **Mass entity deletion** | > 1000 entities deleted in 1 hour | Investigate source; may indicate accidental drop or malicious activity |
| **Untagged PII detected** | Auto-classification finds PII column with no governance policy | Alert data steward; apply default masking policy immediately |
| **Dead letter queue growing** | Active metadata DLQ size > 100 | Investigate failed events; fix processing errors; replay after fix |
| **SLO budget exhausted** | Any SLO > 80% budget consumed with > 50% of month remaining | Incident review; identify root cause; freeze non-critical changes |

### Warning

| Alert | Condition | Runbook Action |
|-------|-----------|----------------|
| **Search quality degradation** | Click-through rate drops > 20% week-over-week | Review ranking model; check for index corruption; analyze zero-result queries |
| **Classification backlog growing** | Pending review queue > 500 items | Scale classification workers; review confidence threshold |
| **Lineage coverage gap** | New tables detected without lineage for > 24 hours | Check SQL parser compatibility; add missing connector |
| **Adoption declining** | WAU drops > 10% week-over-week | Survey users; check for UX issues; review search quality |
| **Event bus consumer lag** | Lag > 10,000 events sustained for > 5 minutes | Scale consumers; check for slow downstream writes |
| **LLM latency spike** | NL-to-SQL p50 > 5s | Check LLM provider status; switch to cached/smaller model |
| **Cache hit rate drop** | Policy cache hit rate < 70% for > 10 minutes | Check for mass policy changes; review cache sizing |

### Informational (Log-Only)

| Alert | Condition | Purpose |
|-------|-----------|---------|
| **New source connected** | First metadata received from new connector | Track onboarding progress |
| **Classification model retrained** | Model artifact updated | Track model lifecycle |
| **Data contract created** | New contract registered | Track contract adoption |
| **Scheduled maintenance window** | Planned downtime approaching | Pre-emptive SLO budget awareness |

---

## Dashboards

### Dashboard 1: Catalog Health Overview

- Entity count by type (line chart, 30-day trend)
- Metadata freshness distribution (histogram)
- Description coverage by domain (bar chart)
- Quality score distribution (histogram)
- Stale and orphan entity counts (single-stat with trend)
- Lineage coverage by source (bar chart)
- Active metadata event processing rate (time series)

### Dashboard 2: Ingestion Pipeline

- Events processed per second (time series)
- Connector status grid (green/yellow/red per connector)
- SQL parse failure rate (time series with annotation for new source additions)
- Event bus consumer lag (time series per partition)
- Schema drift events (bar chart by source)
- Connector credential expiry countdown (table sorted by days remaining)
- Backpressure events per connector (time series)

### Dashboard 3: Governance & Compliance

- Policy evaluation rate and deny rate (time series)
- Classification coverage (gauge: % of columns classified)
- PII-tagged columns without masking policy (single-stat, must be 0)
- Policy change audit trail (table with timestamps, users, actions)
- Compliance dashboard: GDPR erasure requests fulfilled vs pending
- Data contract SLO compliance rate (gauge per contract)
- AI governance: datasets with bias metadata vs total datasets used for AI

### Dashboard 4: Search & User Experience

- Search latency percentiles (p50, p95, p99 over time)
- Click-through rate and zero-result rate (time series)
- Top search queries (ranked list with click-through rates)
- NL-to-SQL usage and acceptance rate (time series)
- User adoption: WAU, searches per user, time-to-first-discovery
- Average click position (lower is better — indicates ranking quality)
- Semantic search vs keyword search usage split

### Dashboard 5: SLO Budget Tracker

- SLO burn rate for each SLO (multi-line time series)
- Error budget remaining per SLO (gauge chart)
- SLO violation timeline (event markers on a timeline)
- Monthly SLO summary table (target vs actual)
- Budget consumption forecast (trend line with projection)

### Dashboard 6: AI Agent Activity

- Agent API calls per hour (time series)
- Unique agents active (gauge)
- Agent policy denial rate (time series)
- Datasets accessed by agents vs humans (stacked area chart)
- Agent session duration and depth (histogram)

---

## Operational Runbooks

### Runbook: Search Latency Spike

```
Trigger: search.query_latency_p99 > 1s for 5 minutes

Step 1: Check search index cluster health
  → If RED: node failure — search cluster auto-rebalances; wait 5 min
  → If YELLOW: replica missing — verify shard replication

Step 2: Check index sync lag
  → If lag > 10s: event bus consumer may be stuck; check consumer group status

Step 3: Check vector store latency
  → If semantic_search_latency > 500ms: vector index may need re-optimization

Step 4: Check for query pattern anomaly
  → Large facet computation on high-cardinality field?
  → Unusual query volume spike (DDoS or automation loop)?

Step 5: If unresolved after 15 min
  → Disable semantic search (BM25 fallback)
  → Page on-call engineer
```

### Runbook: Connector Failure

```
Trigger: ingestion.connector_status == "failed" for any connector

Step 1: Check connector logs for auth errors
  → Credential expired → rotate in secrets manager

Step 2: Check source system availability
  → Source down → wait for source recovery; circuit breaker isolates

Step 3: Check network connectivity
  → Firewall rule change? DNS resolution failure?

Step 4: Check for schema change at source
  → New table type or API version not supported by connector?
  → Update connector to latest version

Step 5: If connector repeatedly crashes
  → Check resource limits (OOM?)
  → Increase memory/CPU limits
  → Check for poison metadata (extremely large schema?)
```

### Runbook: Classification Accuracy Degradation

```
Trigger: classification.override_rate > 15% for 7 days

Step 1: Analyze override patterns
  → Which PII types are being overridden? (false positive analysis)
  → Which data sources have highest override rate?

Step 2: Check for data distribution drift
  → New data source with unusual column naming conventions?
  → New language/locale in text columns?

Step 3: Review recent model changes
  → Was the model retrained recently? Check training data quality.
  → Was the confidence threshold changed?

Step 4: Initiate targeted retraining
  → Collect overridden examples as new training data
  → Retrain for specific PII types showing degradation
  → A/B test new model against current on shadow traffic

Step 5: If systematic issue
  → Raise auto-apply threshold temporarily (reduce false positives)
  → Increase human review staffing until model improves
```

---

## AI Observability Standards

This system's AI components MUST implement the observability patterns defined in:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — trace model, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, human review sampling

### Required AI-Specific Metrics
- Analysis accuracy against ground truth (where available)
- Alert precision and recall rates
- Dashboard query latency percentiles
- Insight freshness (time from data ingestion to insight availability)
- False positive rate for automated alerts
