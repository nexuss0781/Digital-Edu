# Observability — Web Crawlers

## The Crawler Observability Challenge

A web crawler has a unique observability requirement: the system's "correctness" is not just about internal health (are services running?) but about external effectiveness (are we crawling the right pages at the right frequency?). A crawler can be perfectly healthy internally — all services green, no errors — while being fundamentally ineffective: wasting bandwidth on low-value pages, missing high-value hosts due to over-aggressive politeness, or silently losing coverage because a frontier partition is serving stale URLs.

Observability must cover three dimensions:
1. **Infrastructure health** — Are the crawler's components running correctly?
2. **Crawl effectiveness** — Is the crawler maximizing coverage and freshness within its budget?
3. **Politeness compliance** — Is the crawler respecting all rate limits and robots.txt directives?

---

## Platform Metrics (USE/RED)

### Frontier Metrics

| Category | Metric | Type | Description | Alert Threshold |
|----------|--------|------|-------------|-----------------|
| **Utilization** | `frontier_queue_depth` | Gauge (per partition) | URLs queued in the frontier | >100M per partition (overloaded) |
| **Utilization** | `frontier_back_queue_active` | Gauge | Back queues with at least one URL | Drop >20% in 1h indicates host loss |
| **Saturation** | `frontier_dequeue_wait_ms` | Histogram | Time fetchers wait for a URL | p99 >500ms (fetchers starving) |
| **Saturation** | `frontier_enqueue_backpressure` | Counter | Enqueue requests rejected due to full partition | >0 sustained (partition needs scaling) |
| **Errors** | `frontier_partition_errors` | Counter | Partition-level errors (checkpoint failure, heap corruption) | >0 per 5 minutes |
| **Rate** | `frontier_enqueue_rate` | Counter | URLs enqueued per second | Sustained drop >30% indicates link extraction problem |
| **Rate** | `frontier_dequeue_rate` | Counter | URLs dequeued per second | Should track fetcher throughput |

### Fetcher Fleet Metrics

| Category | Metric | Type | Description | Alert Threshold |
|----------|--------|------|-------------|-----------------|
| **Rate** | `fetcher_pages_fetched_total` | Counter | Total pages successfully fetched | Drop >20% from baseline |
| **Rate** | `fetcher_bytes_received_total` | Counter | Total bytes downloaded | Sustained drop indicates network issue |
| **Duration** | `fetcher_response_time_ms` | Histogram | HTTP response time per fetch | p99 >10s (network or host issues) |
| **Errors** | `fetcher_http_errors_total` | Counter (by status) | 4xx and 5xx responses | 5xx rate >5% indicates target host issues or crawler problems |
| **Errors** | `fetcher_timeout_total` | Counter | Connection or read timeouts | >1% of fetches |
| **Errors** | `fetcher_dns_failure_total` | Counter | DNS resolution failures | >0.1% of lookups |
| **Utilization** | `fetcher_active_connections` | Gauge (per worker) | Current open TCP connections | >90% of connection limit |
| **Utilization** | `fetcher_worker_cpu_percent` | Gauge | CPU usage per fetcher worker | >80% sustained |

### DNS Resolver Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `dns_cache_hit_rate` | Gauge | Percentage of DNS lookups served from cache | <90% (cache too small or TTLs too short) |
| `dns_cache_size` | Gauge | Number of entries in DNS cache | Monitor growth trend |
| `dns_resolution_time_ms` | Histogram | Time for DNS resolution (cache miss) | p99 >500ms |
| `dns_upstream_errors` | Counter | Failed upstream DNS queries | >1% of misses |

### Deduplication Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `dedup_url_bloom_filter_size` | Gauge | Current number of entries in Bloom filter | >90% of capacity |
| `dedup_url_bloom_false_positive_estimate` | Gauge | Estimated false positive rate | >2% (rebuild needed) |
| `dedup_content_exact_duplicates` | Counter | Pages detected as exact content duplicates | Rate >20% sustained (possible crawl inefficiency) |
| `dedup_content_near_duplicates` | Counter | Pages detected as near-duplicates via SimHash | Informational |
| `dedup_simhash_query_latency_ms` | Histogram | SimHash index lookup time | p99 >100ms |

### Politeness Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `politeness_robots_violations` | Counter | Pages fetched in violation of robots.txt | **>0 (critical — must be zero)** |
| `politeness_crawl_delay_violations` | Counter | Fetches that violated Crawl-delay timing | >0 per hour |
| `politeness_robots_cache_hit_rate` | Gauge | robots.txt cache hit rate | <80% (too many cache misses) |
| `politeness_robots_refresh_failures` | Counter | Failed robots.txt fetch attempts | >5% of refresh attempts |
| `politeness_host_backoff_active` | Gauge | Hosts currently in backoff due to errors | Spike >10% of active hosts |
| `politeness_adaptive_delay_avg_ms` | Gauge | Average adaptive delay across all active hosts | Trend monitoring |

---

## Crawl Effectiveness Metrics

These metrics measure whether the crawler is doing its job well — not just running, but running effectively.

### Coverage Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| `coverage_known_urls_total` | Total URLs in the URL database | Growth trend monitoring |
| `coverage_hosts_crawled_24h` | Distinct hosts crawled in the last 24 hours | >80% of known active hosts |
| `coverage_new_urls_discovered_24h` | New URLs found in the last 24 hours | Healthy discovery rate |
| `coverage_pages_fetched_24h` | Total pages fetched in the last 24 hours | Should meet SLO (>1B) |

### Freshness Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| `freshness_top1m_p50_age_hours` | Median age of last crawl for top 1M pages | <4 hours |
| `freshness_top1m_p99_age_hours` | 99th percentile age for top 1M pages | <24 hours |
| `freshness_all_pages_p50_age_days` | Median age of last crawl for all known URLs | <14 days |
| `freshness_all_pages_p99_age_days` | 99th percentile age for all known URLs | <30 days |
| `freshness_content_change_rate` | Percentage of recrawled pages that had changed content | 30-50% indicates good recrawl scheduling |

### Efficiency Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| `efficiency_duplicate_fetch_rate` | Percentage of fetches that returned unchanged content | <5% |
| `efficiency_trap_urls_blocked_24h` | URLs blocked by spider trap detection | Informational |
| `efficiency_robots_blocked_rate` | Percentage of URLs blocked by robots.txt | Informational (10-20% is typical) |
| `efficiency_redirect_rate` | Percentage of fetches that resulted in redirects | <15% |
| `efficiency_error_rate` | Percentage of fetches resulting in 4xx/5xx | <10% |
| `efficiency_bytes_per_unique_page` | Average bytes fetched per unique page stored | Decreasing trend indicates dedup improvements |

---

## Logging

### What to Log

| Event | Log Level | Key Fields |
|-------|-----------|------------|
| Page fetch success | INFO | url_hash, host, http_status, response_time_ms, content_length, content_changed |
| Page fetch error | WARN | url_hash, host, error_type, http_status, retry_count |
| robots.txt fetch | INFO | host, http_status, directives_count, crawl_delay |
| robots.txt violation attempt | ERROR | url_hash, host, directive_that_blocked |
| Spider trap detected | WARN | host, trap_type, url_pattern, urls_blocked |
| New host discovered | INFO | host, source_url, initial_url_count |
| Frontier partition failover | ERROR | partition_id, old_primary, new_primary, failover_time_ms |
| Bloom filter rebuild | INFO | partition_id, old_size, new_size, false_positive_rate |
| Content duplicate detected | DEBUG | url_hash, duplicate_of, match_type (exact/near) |
| Host circuit breaker open | WARN | host, error_count, backoff_duration |

### Log Levels Strategy

| Level | Usage | Volume |
|-------|-------|--------|
| ERROR | Component failures, robots.txt violations, data corruption | <0.01% of events |
| WARN | Fetch errors, trap detections, circuit breaker activations | ~1% of events |
| INFO | Successful fetches, robots.txt updates, host discoveries | ~10% of events (sampled) |
| DEBUG | Dedup decisions, priority calculations, queue operations | Disabled in production; enabled per-partition for debugging |

### Structured Logging Format

```
{
  "timestamp": "2026-03-10T14:30:05.123Z",
  "level": "INFO",
  "component": "fetcher",
  "worker_id": "fetcher-us-east-042",
  "event": "page_fetch_success",
  "url_hash": "a1b2c3d4",
  "host": "example.com",
  "http_status": 200,
  "response_time_ms": 342,
  "content_length_bytes": 45230,
  "content_changed": true,
  "content_hash": "e5f6a7b8",
  "links_extracted": 47,
  "new_links": 3,
  "partition_id": "p-042",
  "region": "us-east"
}
```

---

## Distributed Tracing

### Trace Propagation Strategy

The crawler pipeline is a multi-stage data flow, not a request-response chain. Tracing follows a URL's journey through the pipeline:

**Trace ID:** Derived from the URL hash. This means all operations related to a specific URL (enqueue, dequeue, fetch, parse, dedup, store) share the same trace, even if they happen hours apart.

**Key Spans:**

| Span | Parent | Description |
|------|--------|-------------|
| `url.enqueue` | Root | URL inserted into frontier |
| `url.dequeue` | `url.enqueue` | URL pulled from frontier for fetching |
| `url.dns_resolve` | `url.dequeue` | DNS resolution for the URL's host |
| `url.fetch` | `url.dequeue` | HTTP request to target host |
| `url.parse` | `url.fetch` | HTML parsing and link extraction |
| `url.dedup_check` | `url.fetch` | Content deduplication check |
| `url.store` | `url.dedup_check` | Page content stored to object storage |
| `url.recrawl_schedule` | `url.store` | Next crawl time computed and set |

### Sampling Strategy

At 11,500 pages/second, tracing every URL would generate overwhelming volume. Sampling strategy:

| Category | Sampling Rate | Rationale |
|----------|--------------|-----------|
| Normal fetches | 0.1% (1 in 1,000) | Baseline visibility |
| Error fetches | 100% | Every error needs investigation |
| Spider trap triggers | 100% | Trap detection needs full context |
| robots.txt violations | 100% | Compliance violations must be fully traced |
| Slow fetches (>5s) | 100% | Performance issues need investigation |
| Top-1M page fetches | 10% | Higher visibility for important pages |

---

## Alerting

### Critical Alerts (Page-Worthy)

| Alert | Condition | Runbook |
|-------|-----------|---------|
| **Crawl throughput collapse** | pages_fetched_rate < 50% of baseline for >15 min | Check frontier partitions, fetcher fleet health, DNS resolver |
| **robots.txt violation** | politeness_robots_violations > 0 | Immediately investigate; may need emergency fetcher shutdown |
| **Frontier partition down** | Partition unreachable and failover did not occur within 30s | Manual failover intervention; check standby health |
| **DNS resolver failure** | dns_upstream_errors > 10% for >5 min | Switch to backup resolvers; investigate primary |
| **All fetchers in region offline** | fetcher_active_connections = 0 for a region | Check network connectivity, auto-scaling, region health |

### Warning Alerts

| Alert | Condition | Runbook |
|-------|-----------|---------|
| Bloom filter near capacity | dedup_url_bloom_filter_size > 85% capacity | Schedule Bloom filter rebuild |
| Freshness SLO degrading | freshness_top1m_p50_age_hours > 6 hours | Check recrawl scheduler, frontier priority queues |
| High duplicate fetch rate | efficiency_duplicate_fetch_rate > 10% for >1 hour | Check dedup service health, Bloom filter false positive rate |
| Spider trap surge | trap_urls_blocked > 10,000 per host per hour | Review trap detection rules; may need host blocklist update |
| Fetcher error rate elevated | fetcher_http_errors_total (5xx) > 5% for >30 min | Check top hosts by error count; likely target host issues |
| DNS cache hit rate low | dns_cache_hit_rate < 85% for >30 min | Increase cache size; investigate TTL distribution |
| Frontier enqueue backpressure | frontier_enqueue_backpressure > 0 for >10 min | Scale frontier partition or reduce link extraction rate |

### Dashboard Design

**Primary Dashboard — Crawl Overview:**
- Real-time crawl throughput (pages/sec) with 24h trend
- Coverage: known URLs, hosts crawled today, new URLs discovered
- Freshness heatmap: top pages by staleness
- Error rate by category (4xx, 5xx, timeout, DNS)
- Frontier queue depth per partition

**Secondary Dashboard — Politeness & Compliance:**
- robots.txt violation counter (should always be 0)
- Per-host crawl rate distribution
- Active backoff hosts count
- robots.txt cache hit rate and refresh rate

**Tertiary Dashboard — Efficiency:**
- Duplicate fetch rate trend
- Content change rate (recrawl effectiveness)
- Spider trap detections per host
- Bytes per unique page trend
- Priority queue distribution (are high-priority queues draining?)

---

## SLO Dashboards

### Dashboard 1: Crawl Throughput SLO

**SLO:** >1 billion pages fetched per rolling 24-hour window

| Panel | Metric | Visualization | Alert Threshold |
|-------|--------|--------------|-----------------|
| Current throughput | `fetcher_pages_fetched_total` (rate) | Time-series line with 24h rolling average | <75% of target (750M/day) |
| Error budget remaining | `1 - (time_below_slo / total_time)` | Gauge (green >90%, yellow >50%, red <50%) | Error budget <50% |
| Throughput by region | `fetcher_pages_fetched_total{region}` (rate) | Stacked area chart | Any region contributing <10% of expected |
| Fetcher utilization | `fetcher_active_connections / fetcher_max_connections` | Heatmap per worker | >95% (workers saturated) or <20% (workers idle) |
| Queue depth trend | `frontier_queue_depth` (sum all partitions) | Time-series with trend line | Sustained growth >10%/hour (falling behind) |

### Dashboard 2: Freshness SLO

**SLO:** Top-1M pages <4 hours stale (p50), <24 hours stale (p99)

| Panel | Metric | Visualization | Alert Threshold |
|-------|--------|--------------|-----------------|
| Top-1M freshness distribution | `freshness_top1m_age_hours` | Histogram with p50/p99 markers | p50 >6h or p99 >36h |
| Freshness heatmap | Staleness by host category (news, commerce, blog, other) | Heatmap (color = age) | News hosts >2h stale |
| Recrawl effectiveness | `freshness_content_change_rate` | Gauge | <20% (crawling too often) or >70% (crawling too rarely) |
| Recrawl backlog | URLs due for recrawl but not yet dequeued | Time-series | Growing backlog >2 hours behind |
| Change frequency estimation accuracy | Predicted change rate vs. actual observed change rate | Scatter plot | Systematic bias >20% |

### Dashboard 3: Compliance Health

**SLO:** 0 robots.txt violations; >99.9% crawl-delay compliance

| Panel | Metric | Visualization | Alert Threshold |
|-------|--------|--------------|-----------------|
| robots.txt violations (cumulative) | `politeness_robots_violations` | Big number (should be 0) | >0 (critical page) |
| Crawl-delay compliance rate | `1 - (crawl_delay_violations / total_fetches)` | Gauge | <99.9% |
| Active backoff hosts | `politeness_host_backoff_active` | Time-series | Spike >10% of crawled hosts |
| robots.txt cache freshness | Percentage of cached robots.txt entries within TTL | Gauge | <90% (many stale entries) |
| AI opt-out compliance | Pages blocked by AI-specific robots.txt or ai.txt directives | Counter (trend) | Informational |

---

## Incident Detection Playbooks

### Playbook 1: Crawl Throughput Collapse

**Detection:** `fetcher_pages_fetched_rate` < 50% of 24h baseline for > 15 minutes

**Diagnostic Steps:**

| Step | Check | Tool | Expected vs. Problem |
|------|-------|------|---------------------|
| 1 | Frontier partition health | `frontier_partition_errors`, `frontier_dequeue_wait_ms` | All partitions responsive; dequeue <100ms |
| 2 | Fetcher fleet health | `fetcher_worker_count`, `fetcher_active_connections` | >80% of workers active; connections within normal range |
| 3 | DNS resolver health | `dns_upstream_errors`, `dns_resolution_time_ms` | <1% errors; p99 <500ms |
| 4 | Content store write health | Content store write latency, error rate | p99 <5s; <1% errors |
| 5 | Network connectivity | Per-region fetcher-to-frontier latency | <200ms cross-region; <10ms same-region |
| 6 | External cause | Global internet disruption, major CDN outage | Check external monitoring services |

**Escalation:** If root cause not identified within 30 minutes → page on-call SRE; if robots.txt violations detected → immediate engineering lead notification.

### Playbook 2: Freshness SLO Degradation

**Detection:** `freshness_top1m_p50_age_hours` > 6 hours for > 1 hour

**Diagnostic Steps:**

| Step | Check | Tool | Expected vs. Problem |
|------|-------|------|---------------------|
| 1 | Recrawl scheduler running | Scheduler process health, last batch timestamp | Batch within last 15 minutes |
| 2 | Priority queue distribution | Front queue depths (F1 vs F4) | F1 (highest priority) draining fastest |
| 3 | Top-1M URL distribution across partitions | Per-partition count of top-1M URLs | Uniform distribution; no hot partition |
| 4 | Politeness blocking top hosts | Back queue wait times for top-1M hosts | Not blocked by aggressive crawl-delay |
| 5 | Recrawl scheduling accuracy | Predicted vs. actual change frequency for top-1M | Predictions within 2x of actual |

**Mitigation:** Temporarily increase priority weight for recrawl URLs in the front queue selector; consider dedicated fetcher pool for top-1M hosts.

### Playbook 3: Spider Trap Outbreak

**Detection:** `trap_urls_blocked` > 100,000 per host per hour for any single host, or aggregate trap detections > 10x baseline

**Diagnostic Steps:**

| Step | Check | Tool | Expected vs. Problem |
|------|-------|------|---------------------|
| 1 | Identify affected hosts | Top hosts by trap URL count | Small number of hosts (likely real traps) vs. many hosts (possible false positives) |
| 2 | URL pattern analysis | Sample trapped URLs; check for repeating segments, calendar patterns | Clear trap pattern vs. ambiguous |
| 3 | Content uniqueness check | SimHash distribution for trapped URLs | Low uniqueness = real trap; high uniqueness = possible false positive |
| 4 | Host legitimacy check | Is host a known large site (Wikipedia, Amazon)? | Known large site flagged = false positive; unknown site = likely trap |
| 5 | Crawl budget impact | How much crawl budget was consumed before trap was detected? | If >100K fetches wasted, tighten early detection threshold |

**Resolution:** For confirmed traps: add to host blocklist. For false positives: increase URL budget for the host; add to trap detection allowlist.

---

## Observability for Operational Excellence

### Crawl Budget Accounting

Track how the daily crawl budget is allocated across different activities:

| Budget Category | Target Allocation | Metric |
|-----------------|-------------------|--------|
| Top-1M recrawls | 5-10% | `budget_top1m_recrawl_fetches / total_fetches` |
| High-priority recrawls (top 100M) | 20-30% | `budget_high_recrawl_fetches / total_fetches` |
| Standard recrawls | 30-40% | `budget_standard_recrawl_fetches / total_fetches` |
| New page discovery | 20-30% | `budget_discovery_fetches / total_fetches` |
| robots.txt fetches | 0.5-1% | `budget_robots_fetches / total_fetches` |
| Wasted (duplicates, errors, traps) | <5% | `budget_wasted_fetches / total_fetches` |

### Host Health Monitoring

Per-host aggregate metrics that identify problematic hosts before they impact SLOs:

| Metric | Computation | Use Case |
|--------|------------|----------|
| Host response time trend | EMA of response time over 7 days | Detect hosts degrading — proactively increase crawl delay |
| Host error rate trend | EMA of error rate over 7 days | Detect hosts becoming unreliable — reduce crawl priority |
| Host content change rate | Fraction of recrawls that found changed content | Optimize recrawl interval per host |
| Host crawl ROI | (unique pages with changed content) / (total fetches to host) | Identify hosts where crawl effort is wasted |
| Host URL discovery rate | New URLs discovered per fetch on this host | Identify hosts with deep link structures worth exploring |

### Anomaly Detection

| Anomaly | Detection Method | Response |
|---------|-----------------|----------|
| Sudden spike in URLs from a single host | Z-score on per-host URL discovery rate | Possible trap or site explosion — trigger trap detector review |
| DNS resolution pointing to unexpected IP | Compare resolved IP against historical IP for host | Possible DNS hijacking — pause crawling and verify |
| Content hash collision across unrelated hosts | Two unrelated hosts serving identical content hashes | Possible content farm or mirror network — flag for review |
| Fetcher region throughput asymmetry | Deviation >2x between regions | Network issue or regional infrastructure problem |
| robots.txt change rate spike | Multiple hosts changing robots.txt within short window | Possible industry-wide policy change (new AI opt-out wave) — verify compliance |

---

## Capacity Monitoring

### Resource Utilization Tracking

| Resource | Metric | Warning Threshold | Critical Threshold | Capacity Planning Action |
|----------|--------|-------------------|-------------------|-------------------------|
| Frontier partition memory | RAM utilization per partition | >80% | >90% | Add partitions or increase instance size |
| Bloom filter capacity | Entries vs. designed capacity | >85% | >95% | Schedule rebuild with larger capacity |
| Fetcher connection pool | Active connections / max connections | >85% | >95% | Add fetcher workers |
| Content store write IOPS | Current vs. provisioned IOPS | >75% | >90% | Scale storage tier |
| DNS cache memory | Cache size vs. allocated memory | >80% | >90% | Increase cache allocation |
| Cross-region bandwidth | Used vs. provisioned bandwidth | >70% | >85% | Upgrade interconnect capacity |
| URL database disk usage | Used vs. total disk space | >75% | >85% | Add shards or archive old data |
| Crawl log storage | Daily log volume growth rate | Growth >20% month-over-month | Growth >50% month-over-month | Review log sampling rates; archive strategy |

### Weekly Operational Health Report

Automated report covering key operational metrics for the prior 7 days:

| Section | Metrics Included |
|---------|-----------------|
| Throughput summary | Avg/peak pages/sec; daily page count; comparison to prior week |
| Freshness summary | p50/p99 staleness for top-1M, top-100M, all pages |
| Coverage summary | New URLs discovered; new hosts discovered; total coverage |
| Efficiency summary | Duplicate fetch rate; content change rate; wasted budget % |
| Compliance summary | robots.txt violations (must be 0); crawl-delay compliance rate |
| Infrastructure summary | Partition health; fetcher fleet utilization; DNS cache performance |
| Cost summary | Compute, storage, bandwidth costs; cost per unique page fetched |
| Anomalies | Flagged hosts; trap detections; unusual patterns |

---

## Observability Anti-Patterns

| Anti-Pattern | Why It's Harmful | Better Approach |
|-------------|-----------------|-----------------|
| Alerting on every 5xx response | At 1B pages/day, even 0.1% 5xx rate = 1M errors/day — overwhelming noise | Alert on sustained error rate per host; use circuit breaker pattern for individual hosts |
| Dashboard shows only aggregate throughput | Hides per-region and per-partition imbalances | Break down by region, partition, and priority level |
| Logging every URL fetched at INFO level | 11,500 log entries/second overwhelms log infrastructure | Sample at 0.1%; log 100% of errors and anomalies |
| Treating all pages as equally important for freshness | Top-1M pages and tail pages have vastly different freshness requirements | Separate freshness dashboards by importance tier |
| Monitoring only internal health | Crawler can be healthy internally but ineffective externally (low coverage, stale index) | Add crawl effectiveness metrics (coverage, freshness, content change rate) |
| Single alert threshold for all regions | Different regions have different baselines (Asia-Pacific processes fewer hosts than Europe) | Per-region adaptive thresholds based on historical baselines |
