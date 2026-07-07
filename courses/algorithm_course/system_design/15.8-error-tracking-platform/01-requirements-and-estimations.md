# Requirements & Estimations — Error Tracking Platform

## Functional Requirements

### Core Features

1. **Error Event Ingestion** — Accept error events from SDKs across all major platforms (JavaScript, Python, Java, Go, Ruby, iOS, Android, .NET) via a lightweight envelope protocol. Each event includes exception type, stack trace, breadcrumbs, tags, user context, device/OS info, and release version. Support batched and compressed payloads. Target <1% CPU overhead on client applications.

2. **Stack Trace Symbolication** — Automatically de-obfuscate and symbolicate stack traces using uploaded source maps (JavaScript), ProGuard mapping files (Android), dSYM files (iOS), and debug symbol files (native). Map minified function names and line numbers back to original source code. Cache resolved source maps per release for fast lookup.

3. **Error Fingerprinting & Issue Grouping** — Apply a multi-strategy fingerprinting algorithm to group similar error events into issues. Strategies include: stack trace-based grouping (normalize frames, hash function names and filenames), exception type + message grouping (with data stripping), custom client-side fingerprints, and server-side fingerprint rules. Support hierarchical grouping for sub-issue drill-down.

4. **Release Tracking & Regression Detection** — Associate every error event with a release version. Track first-seen and last-seen timestamps per issue per release. Automatically detect regressions: an issue marked as resolved that reappears in a new release triggers a regression alert. Provide release health dashboards showing crash-free session rates, new issues, and error volume deltas.

5. **Alerting & Notifications** — Rule-based and metric-based alert conditions: new issue detected, issue regression, error count exceeds threshold (absolute or percentage), spike in error rate. Deliver alerts via email, webhook, chat integrations, and push notification. Support per-project alert rules with configurable frequency caps.

6. **Issue Management & Triage** — Assign issues to team members, set priority levels, link to external issue trackers. Support bulk operations (merge, ignore, resolve). Track issue lifecycle: unresolved → ignored / resolved → regressed. Provide first-seen, last-seen, event count, affected user count per issue.

7. **Search & Analytics** — Full-text search across error messages, tags, and breadcrumbs. Faceted filtering by release, environment, browser, OS, custom tags. Time-series charts for error trends. Top-N queries (most frequent issues, most affected users). Support saved searches and dashboards.

8. **Context & Breadcrumbs** — Display the chronological trail of user actions (clicks, navigations, API calls), console logs, and system events leading up to the error. Show request/response data, environment variables (redacted), and custom context set by developers.

### Out of Scope

- Application performance monitoring (APM) / distributed tracing — complementary but separate system
- Log aggregation and full-text log search
- Uptime monitoring and synthetic checks
- Feature flag management
- User session replay (video recording)

---

## Assumptions & Constraints

| # | Assumption / Constraint | Impact |
|---|------------------------|--------|
| 1 | SDK payload sizes vary from 500 bytes (simple errors) to 200 KB (errors with full breadcrumbs, request bodies, and local variables) | Ingestion relay must handle variable-size payloads; compression is mandatory for SDK transport |
| 2 | Source map uploads lag deployment by 5-60 seconds in typical CI/CD pipelines | System must handle unsymbolicated events gracefully; retro-symbolication is a first-class requirement |
| 3 | Error traffic is anti-correlated with system health — spikes during outages, not during normal operation | Architecture cannot be designed for average load; spike capacity is the design constraint |
| 4 | Multi-platform support means stack trace formats are fundamentally different (JavaScript minified, Python module paths, native stripped symbols, Java ProGuard-obfuscated) | Fingerprinting engine must be platform-aware; no universal normalization algorithm exists |
| 5 | DSN keys are embedded in client-side code and are inherently public | Security model must assume authentication tokens are compromised; defense via rate limiting and origin validation |
| 6 | Developers expect sub-second issue list loading even across millions of events | Relational store must be optimized for issue list queries; event counts can be approximate |
| 7 | GDPR right-to-erasure applies to error events containing user PII (emails, IPs, usernames) | Deletion must propagate across columnar store, relational store, backups, and source map metadata |

## User Personas

| Persona | Role | Primary Access Pattern | Latency Expectation |
|---------|------|----------------------|---------------------|
| **Frontend Developer** | Investigates JavaScript errors post-deploy | Search by release + stack trace drill-down; breadcrumb analysis | Issue detail < 1s; symbolicated frames expected |
| **Mobile Developer** | Debugs crash-free session regressions | Release health dashboard; crash grouping by device/OS | Crash-free rate accurate within 5 min of deploy |
| **Backend Engineer** | Triages server-side exceptions | Filter by exception type + service; assign to team | Issue list sorted by frequency, updated in real-time |
| **SRE / On-Call** | Responds to error rate alerts during incidents | Alert channel integration; error rate trends; spike detection | Alert delivery < 30s from first occurrence |
| **Engineering Manager** | Monitors team's error backlog and resolution velocity | Dashboard: open issues, MTTR, regression rate | Weekly trends; data can be hours stale |
| **Platform Admin** | Manages quotas, billing, project configuration | Admin API; quota usage; spike protection settings | Management API < 500ms |

---

## Non-Functional Requirements

### CAP Theorem Position

**AP (Availability + Partition Tolerance)** — Error ingestion must never be rejected due to internal consistency issues. SDKs retry on failure, so at-least-once delivery is acceptable. Eventual consistency for issue counts and aggregations is fine as long as no events are lost. Strong consistency is required only for issue state transitions (resolve, merge) and alert rule evaluation.

### Consistency Model

**Tiered Consistency:**
- **Event ingestion:** Eventual consistency — events may arrive out of order; deduplication handles retries
- **Issue metadata (counts, first-seen):** Eventual consistency — counters converge within seconds
- **Issue state (resolved, assigned):** Sequential consistency — state transitions must be ordered to prevent lost updates
- **Alert evaluation:** Read-your-writes — alert rules must see the latest event counts to avoid missed or duplicate alerts
- **Billing/quota:** Linearizable — quota decrements must be exactly-once to prevent over/under-billing

### Availability Target

| Component | Target | Rationale |
|-----------|--------|-----------|
| Ingestion API (Relay) | 99.95% | SDKs buffer locally and retry; brief outages acceptable |
| Event processing pipeline | 99.9% | Events are queued; processing can catch up after delays |
| Web UI / API | 99.9% | Standard web application availability |
| Alerting pipeline | 99.95% | Delayed alerts reduce the platform's core value |
| Source map storage | 99.9% | Symbolication can be deferred; events stored unsymbolicated |

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Event ingestion (SDK → accepted) | <50ms | <200ms | <500ms |
| Event processing (accepted → stored) | <2s | <5s | <15s |
| New issue alert (first event → notification) | <10s | <30s | <60s |
| Issue detail page load | <500ms | <1.5s | <3s |
| Search query (7-day window) | <1s | <3s | <5s |
| Trend aggregation (30-day) | <2s | <5s | <10s |
| Source map symbolication | <500ms | <2s | <5s |

### Durability Guarantees

- **Error events:** At-least-once delivery with deduplication; zero event loss after acceptance by the ingestion layer
- **Issue metadata:** Durable with write-ahead log; survives single-node failures
- **Source maps / debug symbols:** Replicated object storage; retained for the lifetime of the associated release (configurable, default 90 days)
- **Alert history:** Immutable audit log of all triggered alerts and delivery attempts
- **Billing events:** Write-ahead logged with exactly-once processing for accurate quota tracking

---

## Capacity Estimations (Back-of-Envelope)

**Reference deployment:** Mid-to-large SaaS platform — 10,000 organizations, 50,000 projects, serving applications with 500M monthly active users collectively.

### Event Volume

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Error events/day (normal) | ~500M | 50K projects × 10K events/day avg |
| Error events/day (spike) | ~5B | 10x during major outages/bad deploys |
| Events/sec (average) | ~5,800 | 500M / 86,400s |
| Events/sec (peak) | ~100K | Spike scenarios, correlated with deploy cycles |
| Avg event payload size | ~5 KB | Stack trace + breadcrumbs + context (compressed: ~1 KB) |
| Source map uploads/day | ~50K | Release deploys across all projects |
| Avg source map size | ~5 MB | Minified JS with mappings (compressed: ~1.5 MB) |

### Storage

| Tier | Retention | Size | Calculation |
|------|-----------|------|-------------|
| Hot (real-time queries) | 24 hours | ~500 GB | 500M events × 1 KB compressed |
| Warm (search & analytics) | 30 days | ~15 TB | 500 GB/day × 30 days |
| Cold (compliance/forensics) | 90 days | ~45 TB | 500 GB/day × 90 days |
| Source maps / debug symbols | 90 days per release | ~7.5 TB | 50K uploads/day × 1.5 MB × 90 days |
| Issue metadata (relational) | Indefinite | ~500 GB | 50M issues × 10 KB metadata |

### Compute

| Component | Resources | Calculation |
|-----------|-----------|-------------|
| Ingestion relay nodes | 30 nodes | 5,800 events/sec / 200 events/sec/node (with spike headroom) |
| Event processing workers | 50 nodes | Fingerprinting + symbolication + enrichment at ~120 events/sec/node |
| Symbolication workers | 20 nodes | Source map parsing is CPU-intensive; ~50 symbolications/sec/node |
| Analytics query cluster | 15 nodes | ClickHouse cluster for aggregation queries |
| Relational DB | 3 nodes | PostgreSQL primary + 2 read replicas for issue metadata |
| Cache cluster | 10 nodes | Redis for fingerprint cache, rate limits, quotas |

### Network Bandwidth

| Path | Bandwidth | Calculation |
|------|-----------|-------------|
| SDKs → Ingestion relay | ~8 Gbps peak | 100K events/sec × 1 KB compressed × 8 bits |
| Relay → Message queue | ~10 Gbps peak | Enriched envelopes slightly larger |
| Processing → Storage | ~5 Gbps | Processed events to columnar store |
| Source map uploads | ~1 Gbps peak | During deploy windows |

---

## SLOs / SLAs

| Metric | SLO | SLA | Measurement |
|--------|-----|-----|-------------|
| Event ingestion success rate | >99.9% | >99.5% | Accepted events / total events received |
| Event processing latency (p99) | <15s | <30s | Time from ingestion to searchable in UI |
| New issue alert latency | <30s | <60s | Time from first event to alert delivery |
| Issue grouping accuracy | >95% | >90% | Correct grouping as measured by merge/split rate |
| Search query latency (p99) | <5s | <10s | 7-day window queries |
| Platform availability | 99.95% | 99.9% | Uptime of ingestion + alerting pipeline |
| Source map symbolication rate | >99% | >95% | Events successfully symbolicated / events requiring symbolication |
| Crash-free session accuracy | >99.9% | >99.5% | Accuracy of reported crash-free rates |

---

## Constraints Unique to Error Tracking

### The Spike Problem

| Constraint | Impact |
|------------|--------|
| Correlated error bursts | A bad deploy or infrastructure failure causes all users to hit the same bug simultaneously; event volume can spike 100x in seconds |
| Quota exhaustion risk | Without spike protection, a single bad deploy can consume an organization's entire monthly event quota in minutes |
| Noisy neighbor isolation | One project's error storm must not affect other projects' ingestion or alerting latency |
| SDK-side rate limiting | Client SDKs must participate in back-pressure; the platform returns rate-limit headers that SDKs respect |

### The Grouping Dilemma

| Metric | Typical Value | Impact |
|--------|---------------|--------|
| Unique fingerprints per day | ~50K new issues | Across all projects; each needs first-occurrence alert evaluation |
| Merge rate (user-initiated) | ~2-5% of issues | Indicates under-grouping — fingerprints too specific |
| Split rate (user-initiated) | ~1-3% of issues | Indicates over-grouping — unrelated errors merged |
| False merge cost | High | Developer investigates wrong root cause; fix doesn't resolve the actual bug |
| False split cost | Medium | Same bug appears as multiple issues; duplicated triage effort |

---

## Failure Tolerance Requirements

| Component | Failure Mode | Tolerable Duration | Acceptable Degradation |
|-----------|-------------|-------------------|----------------------|
| Relay gateway | Complete outage | <2 min (SDKs buffer locally) | SDKs queue up to 30 events; retry with exponential backoff |
| Message bus | Partition leader election | <30s | Events queued at relay; processing pauses briefly |
| Symbolicator | Service unavailable | Hours | Events stored with raw frames; retro-symbolicated on recovery |
| Fingerprint cache | Cache cluster failure | Minutes | Fall back to relational DB lookup; higher latency, correct results |
| Relational DB | Primary failover | <30s | Issue list shows stale data from read replica; writes queued |
| Columnar store | Shard unavailable | <1 hour | Queries degraded (partial results); writes buffered in message bus |
| Alert engine | Processing delay | <5 min | Alerts delayed but not lost; catch-up on queue drain |

## Scaling Tiers

| Tier | Organizations | Events/Day | Storage (30-day) | Processing Nodes | Columnar Nodes |
|------|--------------|------------|-----------------|------------------|----------------|
| **Startup** | 1-100 | 1M-10M | 10-100 GB | 2-5 | 3 |
| **Growth** | 100-1,000 | 10M-100M | 100 GB-1 TB | 5-20 | 5-10 |
| **Scale** | 1K-10K | 100M-1B | 1-10 TB | 20-100 | 10-30 |
| **Enterprise** | 10K+ | 1B-10B | 10-100 TB | 100-500 | 30-100 |
| **Hyperscale** | 50K+ | 10B+ | 100+ TB | 500+ | 100+ |

## Workload Characterization

### Event Size Distribution

| Event Type | Avg Size (Raw) | Avg Size (Compressed) | Proportion | Notes |
|-----------|---------------|----------------------|-----------|-------|
| Simple exception (no breadcrumbs) | 1 KB | 300 B | 15% | Backend errors, simple crashes |
| Standard error (breadcrumbs + context) | 5 KB | 1 KB | 60% | Typical web/mobile error with user trail |
| Rich error (breadcrumbs + request body + local vars) | 20 KB | 4 KB | 20% | Detailed debug mode captures |
| Oversized error (attachments, minidumps) | 100-200 KB | 30-60 KB | 5% | Native crash minidumps, screen captures |

### Processing Cost per Event

| Stage | CPU Cost | I/O Cost | Notes |
|-------|---------|---------|-------|
| Envelope parsing + validation | ~0.1ms | None | CPU-bound; dominated by decompression |
| Schema normalization | ~0.5ms | None | Field extraction, type coercion |
| Source map symbolication (cache hit) | ~2ms | 1 cache read | Binary search on pre-parsed mapping table |
| Source map symbolication (cache miss) | ~500ms-3s | 1 object storage read + VLQ parse | Dominated by source map parsing |
| Fingerprint computation | ~1ms | 1 cache read + conditional DB write | Frame normalization + SHA-256 |
| Geo-IP + device enrichment | ~0.5ms | 1 cache read | MaxMind DB lookup |
| Columnar store write (batched) | ~0.1ms amortized | 1 batch write per 1K events | Micro-batch writes every 1s or 1K events |
| Issue upsert (relational) | ~2ms | 1 DB round-trip | UPSERT with unique constraint |

### SLO Error Budget Policy

| SLO | Target | Monthly Budget | Burn Rate Alert | Escalation |
|-----|--------|---------------|-----------------|------------|
| Ingestion success rate | 99.9% | 43.2 min downtime | >2x burn in 1h → page | P1 incident |
| Processing latency (p99 < 15s) | 99.5% | 3.6h of violations | >5x burn in 30min → page | P1 incident |
| Alert delivery (< 60s) | 99.5% | 3.6h of violations | >3x burn in 1h → notify | P2 incident |
| Grouping accuracy (> 95%) | 95% | 5% misclassification | Merge/split rate > 10% → notify | Algorithm review |
| Platform availability | 99.95% | 21.6 min/month | >2x burn in 1h → page | P0 incident |

### Consistency Requirements by Operation

| Operation | Consistency Level | Rationale |
|-----------|------------------|-----------|
| Event ingestion acceptance | Eventual | SDKs retry; deduplication handles duplicates |
| Fingerprint → issue assignment | Sequential | Same fingerprint must consistently map to same issue |
| Issue state transition | Sequential | Resolve → regress must be ordered |
| Event count per issue | Eventual | Approximate fast counter acceptable for list view |
| Quota accounting | Eventual (biased toward over-accept) | 1-2% overage acceptable; under-acceptance is trust-destroying |
| Alert rule evaluation | Read-your-writes | Must see latest event to prevent missed alerts |
| Release health (crash-free rate) | Eventual | Recomputed periodically; 1-hour staleness acceptable |
| Source map upload acknowledgment | Strong | Upload must be durable before CI/CD proceeds |

### Access Pattern Distribution

| Access Pattern | Proportion | Characteristics | Optimization |
|---------------|-----------|----------------|-------------|
| Issue list browsing | 35% | Filter by project + status; sort by last_seen; paginate | Relational DB indexes on `(project_id, status, last_seen)` |
| Issue detail view | 25% | Point lookup by issue_id; fetch related events | Relational for issue; columnar for event list |
| Event search | 15% | Full-text across message + tags; time-bounded; faceted | Columnar store with skip indexes |
| Trend aggregation | 10% | GROUP BY release, browser, time bucket | Pre-computed rollups in columnar store |
| Release health dashboard | 10% | Crash-free rates; new issues per release; comparison | Materialized views or periodic batch computation |
| Alert rule evaluation | 5% | Real-time count queries on recent events | In-memory counters + cache; avoid heavy queries |

### Ingestion Burst Profile

Error event arrival follows a bimodal pattern — steady-state with superimposed spikes:

| Scenario | Duration | Multiplier | Frequency | Trigger |
|----------|----------|-----------|-----------|---------|
| Normal operation | Continuous | 1x | Always | Baseline error rate of running applications |
| Deploy window | 15-30 min | 3-5x | Several times/day | New code released; initialization errors + new bugs |
| Infrastructure degradation | 1-4 hours | 10-20x | Weekly | Database slow, third-party API timeout, cache failure |
| Bad deploy (single app) | 5-30 min | 50-100x | Monthly | Critical bug in hot path; every request errors |
| Global outage | 1-6 hours | 100-500x | Quarterly | CDN failure, DNS outage, cloud region incident |
