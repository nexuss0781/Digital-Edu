# Requirements & Estimations — Web Crawlers

## Functional Requirements

### Core Features

1. **URL Discovery & Extraction** — Parse fetched HTML pages to extract hyperlinks, normalize them to canonical form, and feed new URLs back into the crawl frontier. Support extraction from various content types (HTML, XML sitemaps, RSS feeds) and handle relative URLs, redirects, and URL-encoded characters.

2. **URL Frontier Management** — Maintain a priority-ordered queue of billions of URLs awaiting crawl. The frontier combines two scheduling dimensions: *priority* (which URLs are most important to fetch) and *politeness* (which URLs can be fetched now without violating per-host rate limits). Support both first-crawl discovery and recrawl scheduling.

3. **Distributed Page Fetching** — Download web pages via HTTP/HTTPS using a fleet of distributed fetcher workers. Handle connection pooling, timeouts, redirect chains (with depth limits), content-type detection, encoding negotiation, and conditional GET (If-Modified-Since) for recrawl efficiency.

4. **Politeness Enforcement** — Respect robots.txt directives (Disallow, Crawl-delay, Sitemap), enforce per-host and per-IP rate limits, and adaptively reduce crawl rate when target hosts show signs of stress (elevated response times, increased error rates). Cache robots.txt files with TTL-based refresh.

5. **URL & Content Deduplication** — Prevent duplicate work at two levels: (a) URL-level deduplication via normalization and Bloom filters to avoid re-enqueuing known URLs, and (b) content-level deduplication via cryptographic hashes (exact match) and locality-sensitive hashing (SimHash/MinHash for near-duplicates) to avoid re-indexing identical or substantially similar content.

6. **Spider Trap Detection** — Identify and avoid URL patterns that generate unbounded crawl work: infinitely deep directory structures, calendar pages with no end date, session IDs creating infinite URL variations, and dynamically generated content with no new information. Enforce per-host URL budget limits and URL depth/length thresholds.

7. **Recrawl Scheduling** — Determine when to revisit previously crawled pages based on their historical change frequency, page importance (PageRank or similar), and freshness requirements. Prioritize frequently-changing high-value pages (news homepages, product listings) over rarely-changing low-value pages (old blog posts, archived content).

8. **DNS Resolution** — Perform high-throughput DNS lookups with a local caching resolver to avoid overwhelming upstream DNS servers. Cache results with TTL awareness and support pre-fetching for URLs in the near-term crawl queue.

### Out of Scope

- **Search ranking and indexing** — The crawler feeds content to the indexer but does not build or query the search index itself
- **Content rendering** — JavaScript-heavy single-page applications require a separate rendering pipeline (headless browser farm); the base crawler handles static HTML
- **Natural language processing** — Content classification, entity extraction, and language detection are downstream pipeline stages
- **Advertising and monetization** — How search results are monetized is orthogonal to the crawl infrastructure
- **User-facing search API** — Query serving, result ranking, and snippet generation are separate systems

---

## Non-Functional Requirements

### CAP Theorem Position

**AP (Availability + Partition Tolerance)** — The crawl system must continue operating during network partitions. It is acceptable for different frontier partitions to temporarily have inconsistent views of URL state (one partition may re-enqueue a URL that another partition has already crawled). Deduplication catches these duplicates eventually. Halting the crawl during a partition is unacceptable — every hour of downtime means millions of pages become stale.

### Consistency Model

**Eventual Consistency for URL state** — Whether a URL has been "seen" or "crawled" can propagate with small delays across frontier partitions. The deduplication layer (Bloom filters, content hashes) provides probabilistic guarantees that converge to correctness over time. A small percentage of duplicate fetches is acceptable; missing pages entirely is not.

**Strong Consistency for robots.txt enforcement** — A fetcher must never violate a robots.txt directive due to stale data. Robots.txt cache entries must be refreshed before they expire, and a missing or expired robots.txt must trigger a fresh fetch before any page on that host is crawled.

### Availability Target

| Component | Target | Rationale |
|-----------|--------|-----------|
| Frontier Service | 99.95% | Frontier unavailability halts all crawling; brief interruptions cause cascading queue starvation |
| Fetcher Fleet | 99.9% | Individual fetcher failures are tolerated; fleet-level availability matters |
| DNS Resolver Cache | 99.99% | Every fetch requires DNS; resolver downtime blocks the entire pipeline |
| Content Storage | 99.9% | Brief write delays are tolerable; fetched pages can be buffered |
| Deduplication Service | 99.9% | Downtime causes duplicate fetches (wasteful but not catastrophic) |

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| URL enqueue (frontier insert) | <5ms | <20ms | <50ms |
| URL dequeue (next URL to crawl) | <10ms | <50ms | <100ms |
| DNS resolution (cached) | <1ms | <5ms | <10ms |
| DNS resolution (cache miss) | <50ms | <200ms | <500ms |
| Page fetch (network round-trip) | <500ms | <2s | <5s |
| robots.txt fetch and parse | <100ms | <500ms | <1s |
| Content dedup check (Bloom filter) | <1ms | <5ms | <10ms |
| Content dedup check (SimHash) | <10ms | <50ms | <100ms |

### Durability Guarantees

- **Fetched page content:** Durable — stored in distributed object storage with replication; content loss requires expensive re-fetching
- **URL frontier state:** Durable with periodic checkpointing — complete frontier loss requires full reconstruction from the URL database (hours of recovery)
- **Crawl metadata (timestamps, ETags, change frequency):** Durable — stored in the URL database; loss degrades recrawl scheduling quality
- **Deduplication state (Bloom filters):** Reconstructible — Bloom filter loss causes temporary duplicate fetches until rebuilt from the URL database
- **robots.txt cache:** Ephemeral with TTL — cache loss triggers re-fetches on next access (minor bandwidth cost)

---

## Capacity Estimations (Back-of-Envelope)

**Reference deployment:** Web-scale search engine crawler covering ~10 billion known URLs, fetching ~1 billion pages per day.

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Known URLs in frontier | ~10 billion | Based on estimated crawlable web size |
| Pages fetched per day | ~1 billion | Target for comprehensive web coverage |
| Pages fetched per second (avg) | ~11,500 | 1B / 86,400 seconds |
| Pages fetched per second (peak) | ~25,000 | ~2.2x average (diurnal patterns — crawl more when target regions are off-peak) |
| Average page size (compressed) | ~50 KB | HTML + headers after gzip decompression and stripping |
| Daily bandwidth (inbound) | ~50 TB | 1B pages x 50 KB |
| Unique hosts discovered | ~500 million | ~10B URLs across ~500M distinct hosts |
| DNS lookups per second | ~5,000 | With 95% cache hit rate: 11,500 x 0.05 = ~575 misses, plus prefetch |
| robots.txt fetches per day | ~5 million | 500M hosts / 100 (not all active) with 24h TTL refresh |
| New URLs discovered per day | ~500 million | ~50 outgoing links per page x 1B pages, ~1% are genuinely new |
| Bloom filter size (URL dedup) | ~12 GB | 10B entries x 10 bits/entry for 1% false positive rate |
| Storage per day (raw pages) | ~50 TB | 1B pages x 50 KB average |
| Storage per year (raw pages) | ~18 PB | 50 TB x 365 days |
| URL metadata storage | ~2 TB | 10B URLs x ~200 bytes metadata each |
| Fetcher worker count | ~5,000 | Each worker handles ~200 concurrent connections = 1M connections total |
| Concurrent TCP connections | ~1 million | 5,000 workers x 200 connections each |

---

## SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Crawl throughput | >1B pages/day | Pages successfully fetched and stored per 24h rolling window |
| Freshness (top-1M pages) | <4 hours stale | Time since last successful crawl for the top 1M pages by importance |
| Freshness (all known pages) | <30 days stale | 90th percentile age of last successful crawl across all known URLs |
| Politeness violation rate | 0% | Pages fetched in violation of robots.txt Disallow directives |
| Crawl-delay compliance | >99.9% | Percentage of fetches respecting the host's Crawl-delay directive |
| Duplicate fetch rate | <5% | Percentage of fetches that retrieve content identical to the last crawl |
| Spider trap escape rate | >99% | Percentage of detected traps where the crawler successfully stopped within 1,000 URLs |
| DNS resolution success rate | >99.99% | Percentage of DNS lookups that resolve successfully |
| Fetcher availability | >99.9% | Percentage of time the fetcher fleet is operating at >80% capacity |

---

## Constraints Unique to Web Crawlers

### Politeness Constraints

| Constraint | Description | Impact |
|------------|-------------|--------|
| robots.txt compliance | Must fetch and obey robots.txt before crawling any page on a host | Requires robots.txt cache with TTL; expired entries block crawling until refreshed |
| Crawl-delay enforcement | Some hosts specify minimum seconds between requests | Reduces effective throughput per host; some hosts set aggressively high delays (60s+) |
| Per-host rate limiting | Even without explicit Crawl-delay, should not exceed ~1 request/second per host | Limits how fast any single host can be crawled regardless of page importance |
| IP-based throttling | Multiple hosts on the same IP (shared hosting) share a rate limit | Requires IP-to-host mapping; shared hosting makes per-host limits insufficient |
| Adaptive backoff | Must reduce crawl rate when host shows stress signals (5xx errors, rising latency) | Fetchers need feedback loop from response metrics to politeness parameters |

### Scale Constraints

| Constraint | Description | Impact |
|------------|-------------|--------|
| Frontier size | Billions of URLs must be prioritized and dequeued efficiently | In-memory priority queues impossible; requires disk-backed frontier with hot/cold partitioning |
| DNS throughput | Thousands of DNS lookups per second; upstream resolvers have rate limits | Local caching resolver with TTL management; pre-resolution for queued URLs |
| Connection limits | Operating system limits on concurrent TCP connections per machine | Worker fleet must be distributed; connection pooling with per-host limits |
| Storage growth | Petabytes per year of raw page content | Tiered storage: recent crawls on fast storage, historical on cold object storage |
| URL normalization ambiguity | Same page reachable via many URL variants | Aggressive normalization rules with domain-specific overrides; residual duplicates caught by content dedup |

---

## Latency Budget Breakdown

### Page Fetch Pipeline (End-to-End)

| Stage | Latency (p50) | Latency (p99) | Notes |
|-------|--------------|---------------|-------|
| Frontier dequeue | 10ms | 100ms | Heap operation + back queue lookup |
| robots.txt check | <1ms (cached) | 500ms (cache miss → fetch) | 95%+ cache hit rate |
| DNS resolution | <1ms (cached) | 500ms (cache miss → upstream) | 95%+ cache hit rate |
| TCP connection | 50ms | 200ms | Persistent connection reuse reduces this to ~0ms for warm hosts |
| TLS handshake | 30ms | 100ms | Session resumption reduces this to ~0ms for warm hosts |
| HTTP request/response | 200ms | 2s | Dominated by target host response time |
| Content dedup check (Bloom) | <1ms | 10ms | In-memory Bloom filter |
| Content dedup check (SimHash) | 10ms | 100ms | Index lookup for near-duplicate detection |
| HTML parsing + link extraction | 5ms | 50ms | Depends on page size and complexity |
| Content store write | 10ms | 50ms | Async; does not block next fetch |
| **Total (warm path)** | **~290ms** | **~3s** | Dominated by HTTP response time |
| **Total (cold path)** | **~800ms** | **~5s** | DNS miss + robots.txt miss + new TCP/TLS |

### Read/Write Ratio Analysis

| Operation | Read Rate | Write Rate | Ratio | Pattern |
|-----------|-----------|------------|-------|---------|
| Frontier operations | 11,500 dequeue/s | 25,000 enqueue/s (link discovery) | 1:2.2 | Write-heavy (more URLs discovered than fetched) |
| URL database | 500 queries/s (admin, analytics) | 11,500 updates/s (crawl results) | 1:23 | Write-heavy |
| Bloom filter | 25,000 lookups/s (dedup checks) | 5,000 inserts/s (new URLs) | 5:1 | Read-heavy |
| Content store | 100 reads/s (indexer downstream) | 11,500 writes/s (new pages) | 1:115 | Extremely write-heavy |
| DNS cache | 11,500 lookups/s | 575 inserts/s (cache misses) | 20:1 | Read-heavy |
| robots.txt cache | 11,500 checks/s | 58 refreshes/s | 198:1 | Read-heavy |

---

## Hardware Requirements

| Component | Instance Type | Count | Spec Per Instance | Total |
|-----------|--------------|-------|-------------------|-------|
| Frontier partitions | High-memory, moderate CPU | 256 | 8 vCPUs, 32 GB RAM, 500 GB SSD | 8 TB RAM, 128 TB SSD |
| Fetcher workers | Network-optimized | 5,000 | 4 vCPUs, 8 GB RAM, 100 GB local SSD | 40 TB RAM |
| DNS resolvers | Low-latency | 12 (3/region × 4 regions) | 4 vCPUs, 16 GB RAM | 192 GB RAM |
| URL database | Storage-optimized | 20 shards | 8 vCPUs, 64 GB RAM, 2 TB SSD | 1.28 TB RAM, 40 TB SSD |
| Content store | Object storage | N/A | Managed service | 18 PB/year |
| Content dedup | Memory-optimized | 10 | 8 vCPUs, 64 GB RAM | 640 GB RAM |
| Admin/monitoring | General purpose | 5 | 4 vCPUs, 16 GB RAM | 80 GB RAM |

### Estimated Monthly Cost

| Category | Monthly Cost | % of Total |
|----------|-------------|------------|
| Compute (fetchers — spot instances) | ~$180K | 25% |
| Compute (frontier, dedup, DNS — on-demand) | ~$120K | 17% |
| Storage (object storage — 50 TB/day) | ~$250K | 35% |
| Network (50 TB/day inbound + cross-region) | ~$100K | 14% |
| Database (URL database, managed service) | ~$50K | 7% |
| Monitoring/observability | ~$15K | 2% |
| **Total** | **~$715K/month** | **100%** |

---

## Additional Capacity Scenarios

### Scenario 1: News-Focused Crawler

A crawler optimized for news freshness rather than general web coverage:

| Metric | General Crawler | News Crawler |
|--------|----------------|-------------|
| Target hosts | 500M | 50,000 (news publishers only) |
| Known URLs | 10B | 500M (news articles) |
| Pages fetched/day | 1B | 100M |
| Recrawl frequency (top hosts) | 4 hours | 5 minutes |
| Average page size | 50 KB | 30 KB (text-heavy articles) |
| Daily bandwidth | 50 TB | 3 TB |
| Fetcher workers | 5,000 | 500 |
| Freshness SLO (top-10K pages) | <4 hours | <15 minutes |
| Special requirements | N/A | RSS/Atom feed monitoring; breaking news detection; sitemap ping support |

### Scenario 2: Dark Web / Deep Web Crawler

A crawler targeting content behind login walls, dynamic pages, and non-indexed sites:

| Metric | General Crawler | Deep Web Crawler |
|--------|----------------|-----------------|
| Target sites | 500M | 100,000 (curated list) |
| Pages per site | ~20 | ~10,000 (deep content behind navigation) |
| JavaScript rendering required | <10% of pages | >80% of pages |
| Rendering farm size | N/A | 2,000 headless browser instances |
| Fetch time per page (average) | 200ms | 3-5 seconds (rendering) |
| Pages fetched/day | 1B | 10M |
| Special requirements | N/A | Form interaction, session management, CAPTCHA handling, authenticated crawling |

---

## SLO Error Budgets

| SLO | Target | Error Budget (30-day) | Budget in Minutes | What Consumes Budget |
|-----|--------|----------------------|-------------------|---------------------|
| Crawl throughput | >1B pages/day | 1% (3.6 days below target in 360-day year) | 8,640 min/year | Frontier outages, fetcher fleet issues, DNS failures |
| Freshness (top-1M) | <4h stale p50 | 0.1% (43 min/month where p50 >4h) | 43 min/month | Recrawl scheduler issues, priority queue starvation |
| Politeness violations | 0% | 0 violations | 0 | No budget — every violation is an incident |
| Fetcher availability | 99.9% | 0.1% (43 min/month downtime) | 43 min/month | Worker crashes, auto-scaler failures, region outages |
| DNS resolution | 99.99% | 0.01% (4.3 min/month) | 4.3 min/month | Resolver failures, upstream DNS issues |

---

## Growth Projections

### Web Growth Assumptions

| Year | Estimated Crawlable Web Size | Growth Rate | Implication |
|------|------------------------------|------------|-------------|
| 2024 | ~4.5 billion indexed pages (major search engines) | Baseline | Current coverage represents <50% of crawlable web |
| 2025 | ~5.2 billion | +15% | AI-generated content accelerates page creation |
| 2026 | ~6.5 billion | +25% | Synthetic content explosion; quality filtering becomes essential |
| 2027 | ~8 billion | +23% | Continued growth; deep web content increasingly exposed |

### Capacity Growth Requirements

| Resource | Year 1 → Year 3 Growth | Scaling Strategy |
|----------|------------------------|-----------------|
| Frontier partitions | 256 → 512 | Consistent hash rebalancing; double during maintenance window |
| Fetcher workers | 5,000 → 10,000 | Horizontal scaling; spot instances |
| Bloom filter memory | 12 GB → 27 GB | Periodic rebuild at larger capacity |
| Content store | 18 PB → 40 PB cumulative | Tiered retention; aggressive cold archival |
| URL database | 2 TB → 4.5 TB | Add shards; archive crawl events >1 year |
| DNS cache | 50 GB/region → 100 GB/region | Increase instance size |
| Network bandwidth | 4.6 Gbps → 10 Gbps | Upgrade interconnects; add regional content stores |

---

## Key Sizing Formulas

| Formula | Purpose | Variables |
|---------|---------|-----------|
| `pages_per_sec = pages_per_day / 86,400` | Convert daily target to per-second rate | pages_per_day |
| `bloom_bits = -n × ln(p) / (ln(2))²` | Size Bloom filter for target false positive rate | n = URLs, p = FPR |
| `bloom_hashes = (m/n) × ln(2)` | Optimal hash function count | m = bits, n = URLs |
| `max_hosts_parallel = bandwidth / (avg_page_size × avg_crawl_delay)` | Theoretical max parallel host crawling | bandwidth, page_size, delay |
| `storage_per_year = pages_per_day × avg_page_size × 365` | Annual raw storage requirement | pages_per_day, avg_page_size |
| `fetcher_count = target_concurrent_connections / connections_per_worker` | Required fetcher fleet size | connections, per_worker |
| `dns_miss_rate_qps = pages_per_sec × (1 - cache_hit_rate)` | DNS upstream query load | pages_per_sec, hit_rate |

---

## Operational Constraints

### Network Constraints

| Constraint | Value | Impact |
|-----------|-------|--------|
| Outbound bandwidth per data center | 10 Gbps provisioned | Limits total fetch throughput per region |
| Cross-region bandwidth (frontier ↔ fetchers) | 1 Gbps provisioned | URL metadata only; small payloads |
| TCP connection limit per fetcher worker | ~10,000 (OS file descriptor limit) | Bounds concurrent connections per worker |
| TLS handshake overhead | 30-100ms per new connection | Favors persistent connections; session resumption |

### Operational Limits

| Limit | Value | Consequence if Exceeded |
|-------|-------|------------------------|
| Max URLs per frontier partition | 500M | Partition performance degrades; rebalancing needed |
| Max hosts per frontier partition | 5M | Hash distribution may need rebalancing |
| Max URL depth | 15 path segments | Deeper URLs blocked as potential spider traps |
| Max URL length | 2,048 characters | Longer URLs rejected at normalization |
| Max page size | 10 MB | Larger pages aborted mid-download |
| Max redirect chain depth | 10 | Deeper chains treated as redirect bomb |
| Max robots.txt size | 500 KB | Larger files truncated; treated as permissive |
| Max consecutive errors per host | 10 | Host circuit breaker opens; crawling paused |
