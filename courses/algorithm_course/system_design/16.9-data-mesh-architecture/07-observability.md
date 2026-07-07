# Observability — Data Mesh Architecture

## Metrics (USE/RED)

### Key Metrics to Track

#### Data Product Health Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `dp.freshness.age_seconds` | Gauge | Time since last data refresh per product | > declared SLO threshold |
| `dp.quality.completeness_pct` | Gauge | Percentage of non-NULL values per required field | < declared SLO threshold |
| `dp.quality.schema_conformance` | Gauge | Percentage of records passing schema validation | < 99% |
| `dp.quality.custom_rules_passed` | Gauge | Percentage of custom quality rules passing | < declared threshold |
| `dp.quality.composite_score` | Gauge | Weighted composite quality score (0.0-1.0) | < 0.8 |
| `dp.slo.compliance_rate` | Gauge | Percentage of time the product meets its declared SLOs | < 95% |
| `dp.consumers.active_count` | Gauge | Number of active consumers in last 30 days | — (informational) |
| `dp.consumers.query_count` | Counter | Total queries against the product | — (informational) |
| `dp.status` | Gauge | Current lifecycle status (published/deprecated/degraded) | Status changed to DEGRADED |

#### Platform Service Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `catalog.search.latency_ms` | Histogram | Discovery search response time | p99 > 500ms |
| `catalog.search.result_count` | Histogram | Number of results per search query | Avg > 500 (noise) |
| `catalog.registration.latency_ms` | Histogram | Time to register a data product | p99 > 60s |
| `catalog.products.total` | Gauge | Total registered data products | — (capacity planning) |
| `catalog.products.by_status` | Gauge | Products by status (published, deprecated, draft) | Deprecated > 20% of total |

#### Governance Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `governance.evaluation.latency_ms` | Histogram | Policy evaluation duration | p99 > 30s |
| `governance.evaluation.pass_rate` | Gauge | Percentage of products passing all policies | < 80% (systemic issue) |
| `governance.violations.count` | Counter | Policy violations by category and severity | ERROR count > 0 (blocking) |
| `governance.policies.total` | Gauge | Total active governance policies | — (complexity tracking) |
| `governance.coverage_pct` | Gauge | Percentage of known datasets registered as governed products | < 70% |

#### Lineage Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `lineage.graph.nodes` | Gauge | Total nodes in lineage graph | — (capacity planning) |
| `lineage.graph.edges` | Gauge | Total edges in lineage graph | — (capacity planning) |
| `lineage.query.latency_ms` | Histogram | Lineage traversal response time | p99 > 2s |
| `lineage.cross_domain.edges` | Gauge | Cross-domain dependency count | — (mesh connectivity health) |
| `lineage.orphaned_products` | Gauge | Products with no upstream or downstream dependencies | > 30% of total (isolation concern) |

#### Federated Query Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `query.federated.latency_ms` | Histogram | Cross-domain query response time | p99 > 30s |
| `query.federated.domains_accessed` | Histogram | Number of domains accessed per query | > 5 (complexity warning) |
| `query.federated.subquery_timeout` | Counter | Subqueries that timed out per domain | > 5% per domain |
| `query.federated.partial_results` | Counter | Queries returning partial results | > 1% |
| `query.access.denied` | Counter | Queries denied by access control | Sudden spike (possible attack) |

#### Mesh Health Metrics (Aggregate)

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `mesh.products.slo_compliant_pct` | Gauge | Percentage of products meeting SLOs | < 90% |
| `mesh.products.avg_quality_score` | Gauge | Average quality score across all products | < 0.75 |
| `mesh.domains.active` | Gauge | Domains with at least one published product | — |
| `mesh.domains.publishing_cadence` | Gauge | Average days between publishes per domain | > 30 days (stale domain) |
| `mesh.contracts.active` | Gauge | Total active data contracts | — |
| `mesh.contracts.violation_rate` | Gauge | Percentage of publishes that violate contracts | > 5% |

### Dashboard Design

**Dashboard 1: Mesh Health Overview**
- Total data products by status (published, deprecated, draft) — stacked bar
- SLO compliance rate across all products — gauge
- Average quality score trend — time series
- Active domains and publishing cadence — heatmap
- Cross-domain dependency count — time series
- Governance coverage percentage — gauge

**Dashboard 2: Data Product Detail (per product)**
- Freshness timeline — time series showing time-since-refresh vs. SLO threshold
- Quality score breakdown — stacked area (completeness, conformance, custom rules)
- Consumer activity — query count over time
- SLO compliance history — time series with violation markers
- Schema version timeline — event markers on time axis
- Lineage subgraph — interactive dependency graph

**Dashboard 3: Governance & Compliance**
- Policy evaluation pass/fail rates — stacked bar by category
- Violation trends by severity (ERROR vs. WARNING) — time series
- Top violated policies — ranked table
- Governance coverage by domain — heatmap
- Access grant expiration forecast — burndown chart
- PII classification coverage — gauge per domain

**Dashboard 4: Federated Query Performance**
- Cross-domain query latency distribution — histogram
- Subquery latency by domain — box plot comparison
- Timeout rate by domain — bar chart
- Most expensive queries — top-K table
- Partial result frequency — time series

---

## Logging

### What to Log

| Event | Log Level | Content |
|-------|-----------|---------|
| Product registration | INFO | Product ID, domain, owner, schema summary, governance result |
| Governance evaluation | INFO | Product ID, policies evaluated, pass/fail, violations |
| Contract validation | INFO | Producer ID, consumer IDs, compatibility result, violations |
| Consumer data access | INFO | Consumer ID, product ID, query type, rows returned, latency |
| Access denial | WARN | Consumer ID, product ID, denied reason, policy that denied |
| SLO violation | WARN | Product ID, SLO metric, expected value, actual value |
| Schema change detected | INFO | Product ID, old version, new version, change summary |
| Product deprecation | INFO | Product ID, deprecated by, sunset date, consumers notified |
| Governance policy change | INFO | Policy ID, changed by, before/after summary |
| Cross-domain query failure | WARN | Query ID, domains involved, failing domain, error type |
| Data quality anomaly | WARN | Product ID, metric, expected range, actual value, deviation |

### Log Levels Strategy

| Level | Production Volume | Use Case |
|-------|------------------|----------|
| ERROR | < 50/min | Platform service failures, metadata store errors, unrecoverable publish failures |
| WARN | < 500/min | SLO violations, access denials, contract violations, quality anomalies |
| INFO | < 5,000/min | Product registrations, governance evaluations, consumer queries |
| DEBUG | Disabled in prod | Policy rule execution details, search ranking scores, caching decisions |
| TRACE | Never in prod | Individual field-level contract checks, lineage graph traversal steps |

### Structured Logging Format

```
{
  "timestamp": "2026-03-10T14:32:01.234Z",
  "level": "WARN",
  "component": "quality_monitor",
  "event": "slo_violation",
  "product_id": "urn:dp:sales:customer-ltv:1.2.0",
  "domain": "sales",
  "owner_team": "sales-analytics",
  "slo_metric": "freshness",
  "slo_target": "< 24 hours",
  "actual_value": "26.5 hours",
  "violation_duration_minutes": 150,
  "consumers_affected": 12,
  "alert_sent": true
}
```

---

## Distributed Tracing

### Trace Propagation Strategy

Data mesh operations span multiple services. A data product registration touches the publishing pipeline, contract validator, governance engine, catalog, and lineage service — all of which must be traceable as a single operation.

**Trace context propagation:**

```
Domain Team Submit
  └── Publishing Pipeline
        ├── Contract Validator
        │     └── Consumer Contract Lookup (per consumer)
        ├── Governance Engine
        │     └── Policy Evaluation (per policy)
        ├── Catalog Registration
        │     └── Metadata Store Write
        ├── Lineage Update
        │     └── Graph Store Write
        └── Quality Monitor Initialization
              └── SLO Configuration
```

### Key Spans to Instrument

| Span | Parent | Key Attributes |
|------|--------|---------------|
| `publish.pipeline` | Root | product_id, domain, version |
| `contract.validate` | pipeline | consumer_count, compatibility_mode |
| `governance.evaluate` | pipeline | policy_count, pass, violations |
| `catalog.register` | pipeline | metadata_size, index_update_time |
| `lineage.update` | pipeline | edges_added, cross_domain_edges |
| `quality.initialize` | pipeline | slo_count, rules_configured |
| `query.federated` | Root | domains_accessed, subquery_count |
| `query.subquery` | federated | domain, latency, rows_returned |
| `access.evaluate` | query | consumer_id, product_id, decision |

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| **Metadata store unreachable** | Health check fails for > 60s | P1 | Verify replica health; check network; failover if needed |
| **Governance engine down** | All instances unhealthy for > 120s | P1 | Publishing is blocked; restart instances; check metadata store connectivity |
| **Mass SLO violation** | > 20% of products violating SLOs simultaneously | P1 | Check shared infrastructure; identify common upstream failure |
| **Data quality anomaly** | Quality score drops > 30% in 1 hour for any product | P1 | Contact product owner; check upstream data sources; consider rollback |
| **Access control bypass detected** | Data access without valid authorization token | P1 | Immediate investigation; revoke compromised tokens; audit access logs |

### Warning Alerts

| Alert | Condition | Severity | Runbook |
|-------|-----------|----------|---------|
| **Product SLO violation** | Single product violating freshness or quality SLO | P2 | Notify product owner; check domain pipeline health |
| **Contract violation on publish** | Product publish blocked by contract incompatibility | P2 | Review schema change; coordinate with affected consumers |
| **High governance failure rate** | > 30% of publishes failing governance in a domain | P2 | Review domain's publishing practices; check for policy clarity issues |
| **Lineage graph inconsistency** | Orphaned edges or missing nodes detected | P3 | Run lineage reconciliation job; check recent publish events |
| **Catalog search degradation** | Search latency p99 > 1 second for > 10 min | P3 | Check search index health; consider reindexing |
| **Stale domain** | Domain has not published in > 60 days | P3 | Contact domain lead; verify domain is still active |
| **Access grant expiration surge** | > 50 grants expiring in next 7 days | P3 | Notify consumers to renew access before expiration |

### Runbook References

| Runbook | Scenario | Key Steps |
|---------|----------|-----------|
| RB-001 | Metadata store failover | Verify replica lag → Promote secondary → Update service connections → Verify catalog operations |
| RB-002 | Mass SLO violation triage | Identify common upstream → Check shared infrastructure → Contact affected domain owners → Communicate to consumers |
| RB-003 | Data quality incident | Identify affected product → Quarantine (mark DEGRADED) → Notify consumers → Root cause analysis → Rollback or fix → Restore status |
| RB-004 | Governance policy rollback | Identify problematic policy → Revert to previous version → Re-evaluate affected products → Communicate to domains |
| RB-005 | Cross-domain query performance degradation | Identify slow domain → Check domain storage health → Consider materialized view → Adjust query timeouts |
| RB-006 | Stale data product detection | Verify last refresh timestamp → Contact product owner → Check domain pipeline → Escalate to domain lead → Auto-degrade if unresponsive |
| RB-007 | Lineage graph inconsistency | Run reconciliation comparing declared lineage vs. actual query patterns → Identify phantom edges → Remove or validate → Report drift metrics |
| RB-008 | Shadow data product discovery | Audit network traffic for data movement outside governed channels → Identify unregistered datasets → Contact owning teams → Onboard to mesh or document exception |

---

## Data Product Health Score Dashboard

### Composite Health Score Calculation

Each data product receives a health score (0-100) composed of weighted dimensions:

| Dimension | Weight | Source | Green (> 80) | Yellow (50-80) | Red (< 50) |
|-----------|--------|--------|-------------|---------------|------------|
| Freshness compliance | 25% | SLO monitoring | Within declared SLO | 1-2x SLO overshoot | > 2x SLO overshoot |
| Quality score | 25% | Quality monitor | All rules passing | < 5% rule violations | > 5% rule violations |
| Schema stability | 15% | Contract validator | No breaking changes in 90 days | MINOR changes in 30 days | MAJOR changes in 30 days |
| Consumer satisfaction | 15% | Query success rate | > 99% query success | 95-99% query success | < 95% query success |
| Documentation freshness | 10% | Metadata analysis | Updated within 90 days | Updated within 180 days | Not updated in 180+ days |
| Owner responsiveness | 10% | Alert acknowledgment | Alerts acked within 4 hours | Acked within 24 hours | Acks pending > 24 hours |

### Mesh-Wide Observability Metrics

| Metric | Description | Target | Diagnostic Use |
|--------|-------------|--------|---------------|
| `mesh.adoption.domains_active` | Domains with ≥ 1 published product | 100% of eligible domains | Adoption tracking |
| `mesh.adoption.time_to_first_product` | Days from domain onboarding to first publish | < 14 days | Platform friction indicator |
| `mesh.governance.coverage_pct` | % of known analytical data registered as governed products | > 80% | Shadow data detection |
| `mesh.topology.cross_domain_edge_pct` | % of lineage edges crossing domain boundaries | 30-50% | Collaboration health |
| `mesh.topology.orphan_product_pct` | % of products with zero consumers | < 15% | Product relevance |
| `mesh.topology.avg_depth` | Average critical path depth in lineage | 3-5 hops | Dependency chain fragility |
| `mesh.contracts.violation_rate_7d` | 7-day rolling contract violation rate | < 3% | Contract health |
| `mesh.publishing.rejection_rate_7d` | 7-day rolling governance rejection rate | 5-15% | Policy calibration |
| `mesh.cost.per_product_monthly` | Platform cost / active products | Decreasing trend | Economy of scale |
| `mesh.consumers.dark_consumption_pct` | % of queries from unregistered consumers | < 10% | Access governance gap |

### SLO Dashboard Design

**Data Product Owner SLO View:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Product: Customer Lifetime Value (sales:customer-ltv:1.2.0)     │
│ Owner: sales-analytics | Status: PUBLISHED | Health: 92/100    │
├─────────────────────────────────────────────────────────────────┤
│ Freshness SLO: < 24h │ Current: 3.2h │ Compliance (30d): 99.8% │
│ Completeness SLO: > 99.5% │ Current: 99.7% │ Compliance: 100%  │
│ Availability SLO: 99.9% │ Current: 99.95% │ Error budget: 87%   │
├─────────────────────────────────────────────────────────────────┤
│ Consumers: 12 active (3 cross-domain) │ Queries/day: 450        │
│ Contract status: 8 consumers subscribed, 0 violations          │
│ Last schema change: 14 days ago (MINOR: added ltv_confidence)  │
└─────────────────────────────────────────────────────────────────┘
```

**Error Budget Tracking:**

```
FUNCTION compute_error_budget(product_id, slo_metric, window_days):
    slo_target = get_slo_target(product_id, slo_metric)  // e.g., 99.9%
    total_checks = get_check_count(product_id, slo_metric, window_days)
    violations = get_violation_count(product_id, slo_metric, window_days)

    allowed_violations = FLOOR(total_checks * (1 - slo_target / 100))
    remaining_budget = allowed_violations - violations
    budget_pct = (remaining_budget / allowed_violations) * 100

    RETURN {
        slo_target: slo_target,
        total_checks: total_checks,
        violations: violations,
        allowed_violations: allowed_violations,
        remaining_budget: remaining_budget,
        budget_percentage: budget_pct,
        burn_rate: violations / (window_days * checks_per_day),
        projected_exhaustion: IF budget_pct > 0 THEN
            remaining_budget / burn_rate ELSE "EXHAUSTED"
    }
```

---

## Anomaly Detection for Data Products

### Statistical Anomaly Detection Pipeline

Rather than fixed thresholds, the quality monitor uses statistical anomaly detection for each data product:

| Metric | Detection Method | Parameters | Alert Condition |
|--------|-----------------|-----------|-----------------|
| Record count | Z-score on rolling 30-day window | μ ± 3σ | Count outside 3σ band |
| Null rate per field | Exponential weighted moving average | α = 0.1, threshold = 2σ | Rate exceeds 2σ from EWMA |
| Schema conformance | Exact match (binary) | N/A | Any non-conforming record |
| Refresh latency | Seasonal decomposition (daily/weekly) | 90-day baseline | Residual > 3σ |
| Value distribution | KS-test against baseline distribution | p < 0.01, window = 1000 records | Distribution shift detected |
| Cross-domain query latency | Percentile tracking | p99, rolling 1-hour window | p99 > 2x 7-day baseline |

### Anomaly Response Workflow

```
1. Anomaly detected by quality monitor
2. Classify severity:
   a. Statistical deviation within SLO → INFO (log only)
   b. SLO violation predicted within 4 hours → WARN (alert owner)
   c. SLO violated → ERROR (alert owner + consumers)
   d. Multiple products affected simultaneously → CRITICAL (page platform oncall)
3. Enrich alert with context:
   - Recent schema changes on this product
   - Recent changes to upstream products (lineage)
   - Similar anomalies on related products
   - Owner acknowledgment history
4. Route alert to appropriate responder:
   - Product-specific: product owner
   - Domain-wide: domain lead
   - Platform-wide: platform SRE
```

---

## Distributed Tracing for Cross-Domain Queries

### End-to-End Trace Example

A cross-domain federated query that joins Sales and Marketing products generates the following trace:

```
Trace ID: abc123-def456-ghi789
Duration: 4.2 seconds
Status: SUCCESS (partial — Marketing subquery slow)

query.federated [4.2s]
├── access.evaluate [12ms]
│   ├── access.check.sales.customer_ltv [3ms] → ALLOW
│   └── access.check.marketing.campaign_perf [8ms] → ALLOW (column restricted)
├── query.plan [45ms]
│   └── optimizer.choose_strategy [38ms] → HASH_JOIN (Sales broadcast)
├── query.subquery.sales [320ms]
│   ├── query.push_filter [2ms] → WHERE segment = 'enterprise'
│   └── query.fetch [315ms] → 12,400 rows, 1.2 MB
├── query.subquery.marketing [3.8s] ← SLOW
│   ├── query.push_filter [2ms] → WHERE year = 2026
│   └── query.fetch [3.79s] → 84,000 rows, 8.4 MB
├── query.join [85ms]
│   └── hash_join.execute [80ms] → 11,200 matched rows
└── query.result [5ms] → 11,200 rows returned

Annotations:
  - marketing subquery 3.5x slower than SLA baseline (1.1s)
  - column masking applied: marketing.user_email excluded
  - freshness: sales data 2h old, marketing data 18h old
```

---

## Operational Playbooks

### Playbook: New Domain Onboarding Observability Setup

When a new domain joins the mesh, the platform automatically provisions:

```
1. Domain-level dashboard in the monitoring system
   - Products by status (published, deprecated, draft)
   - Domain-wide SLO compliance rate
   - Publishing activity timeline
   - Consumer activity across domain products

2. Default alerts for the domain
   - Any product SLO violation → domain owner
   - Governance rejection rate > 30% → domain lead
   - Product staleness (no refresh in 3x SLO) → product owner
   - Consumer complaint (access denied spike) → domain admin

3. Domain health score
   - Composite of all product health scores
   - Weighted by product tier (Platinum products weight 3x)
   - Displayed on mesh-wide leadership dashboard
```

### Playbook: Incident Response for Cross-Domain Data Quality Failure

```
Trigger: Quality anomaly detected on keystone product (> 10 downstream consumers)

Step 1: Triage (0-15 min)
  - Quality monitor detects anomaly (statistical deviation or SLO breach)
  - Auto-generated incident ticket with:
    * Affected product ID, owner, domain
    * Anomaly type and severity
    * List of downstream products (from lineage)
    * Consumer count and names

Step 2: Impact Assessment (15-30 min)
  - Lineage service traces all downstream products
  - Each downstream product's owner receives notification
  - Federated query engine annotates queries involving the affected product with a warning badge
  - If product is classified as Platinum, page the product owner

Step 3: Containment (30-60 min)
  - Product owner decides: fix forward or rollback
  - If rollback: platform reverts to previous known-good version (stored snapshot)
  - If fix forward: owner publishes updated product through normal pipeline
  - During containment: product status set to DEGRADED in catalog

Step 4: Resolution (1-4 hours)
  - Root cause identified and documented in incident record
  - Fix deployed and verified (quality score restored)
  - Product status restored to PUBLISHED
  - Downstream product owners confirm their products are healthy

Step 5: Post-Incident (24-48 hours)
  - Post-incident review documented
  - Quality rules updated to detect similar issues earlier
  - Lineage-based blast radius reviewed for accuracy
```
