# Deep Dive & Bottlenecks — Web Crawlers

## Critical Component 1: URL Frontier — The Brain of the Crawler

### Why It Is Critical

The URL Frontier determines what the crawler fetches and when. Every architectural property — coverage (which pages are crawled), freshness (how often they are recrawled), and politeness (how aggressively each host is hit) — is ultimately a consequence of frontier scheduling decisions. A poorly designed frontier can waste 50%+ of crawl bandwidth on low-value pages while critical pages go stale. A frontier that fails to enforce politeness will get the crawler's IP ranges blocked by major hosts, creating coverage gaps worse than not crawling at all.

### How It Works Internally

The frontier implements the Mercator two-queue architecture:

**Front Queues (Priority Scheduling):**

The priority assigner classifies each incoming URL into one of K priority levels (typically 4-8). The classification uses multiple signals:

| Signal | Weight | Source |
|--------|--------|--------|
| Page importance (PageRank-like) | High | Precomputed from link graph |
| Host authority | Medium | Domain-level reputation score |
| Change frequency | Medium | Historical crawl data |
| Path depth | Low | URL structure (shallow = more important) |
| Content type | Low | HTML pages > PDFs > images |
| Source priority | Low | URLs discovered from high-priority pages inherit priority |

A biased selector draws from front queues with frequency proportional to their priority. For example, with 4 queues: F1 gets 40% of draws, F2 gets 30%, F3 gets 20%, F4 gets 10%. This ensures high-priority URLs are crawled first without completely starving low-priority URLs.

**Back Queues (Politeness Enforcement):**

Each back queue corresponds to exactly one host. When a URL is drawn from a front queue, it is routed to its host's back queue. Each back queue carries a `next_fetch_time` timestamp representing the earliest time the next URL from this host may be fetched. A min-heap orders all non-empty back queues by their `next_fetch_time`.

The dequeue operation:
1. Pop the back queue with the smallest `next_fetch_time` from the heap
2. If `next_fetch_time` > now, no host is ready — wait or return empty
3. Dequeue one URL from this back queue
4. Compute the new `next_fetch_time = now + crawl_delay` for this host
5. Push the back queue back into the heap with the updated `next_fetch_time`

The `crawl_delay` is the maximum of: the robots.txt `Crawl-delay` directive, the adaptive delay computed from the host's response times, and a global minimum delay (e.g., 1 second).

**Back Queue Refill:**

When a back queue is empty (all URLs for a host have been fetched), it must be refilled from the front queues. The selector draws a URL from the front queues and routes it to the appropriate back queue. If the drawn URL's host already has a non-empty back queue, it is appended there. If not, the empty back queue is repurposed for the new host.

### The Back Queue Mapping Problem

With 500 million distinct hosts and only ~10,000 back queues (memory constraint), the frontier cannot maintain a dedicated back queue per host. Instead, it uses a **host-to-queue mapping table** that dynamically assigns hosts to back queues. When a back queue empties and is refilled:

1. The current host mapping is released
2. A URL is drawn from the front queues
3. The URL's host is assigned to this back queue
4. All other queued URLs for this host are moved to this back queue

This dynamic remapping means each back queue serves one host at a time, but the host changes as the queue drains and refills. The mapping table tracks which host is currently assigned to which back queue.

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Front queue imbalance | Low-priority queue grows unboundedly while high-priority queue is always empty | Monitor queue depths; rebalance if ratio exceeds 100:1 |
| Back queue heap corruption | Fetchers get no URLs or get URLs from wrong hosts | Periodic heap validation; rebuild from back queue state on corruption |
| Host mapping table loss | Cannot route URLs to correct back queues | Persist mapping to disk; rebuild from back queue contents on restart |
| Single-host URL flood | One host has millions of URLs, dominates the frontier | Per-host URL budget (e.g., max 100K URLs per host in frontier) |
| Stale priority signals | PageRank or change frequency data is months old | Periodic batch recomputation; frontier uses best-effort signals, not perfect |

---

## Critical Component 2: Politeness Engine — The Ethical Constraint

### Why It Is Critical

Politeness is not optional — it is the fundamental constraint that distinguishes a web crawler from a DDoS attack. Violating politeness has concrete consequences: hosts block the crawler's IP ranges, reducing coverage. Overloading small servers can cause outages, creating legal liability. At web scale, even a small politeness bug (e.g., ignoring Crawl-delay for 1% of hosts) means thousands of servers are being overloaded.

### The Three Layers of Politeness

**Layer 1: robots.txt Compliance**

The crawler fetches and caches each host's `/robots.txt` file. The cache has a configurable TTL (default: 24 hours). Before any page fetch, the politeness engine checks whether the URL is allowed by the applicable robots.txt rules.

Key edge cases:
- **robots.txt returns 5xx:** Assume all URLs are disallowed (conservative) and retry robots.txt fetch with exponential backoff
- **robots.txt returns 404:** Assume all URLs are allowed (the host has no crawl restrictions)
- **robots.txt is too large (>500 KB):** Treat as empty (malformed or adversarial)
- **Multiple user-agent matches:** Use the most specific matching directive (e.g., `Googlebot` > `*`)
- **Crawl-delay specified:** Honor even if it seems unreasonably high (up to a configurable maximum, e.g., 300 seconds); beyond the maximum, deprioritize the host

**Layer 2: Per-Host Rate Limiting**

Even without an explicit Crawl-delay, the crawler enforces a minimum inter-request delay per host. The default is computed adaptively:

```
adaptive_delay(host) = MAX(
    MIN_DELAY,                           // e.g., 1 second
    host.avg_response_time * MULTIPLIER  // e.g., 10x average response time
)
```

If a host typically responds in 100ms, the adaptive delay is 1 second (10 x 100ms). If a host responds in 2 seconds (slow server), the adaptive delay is 20 seconds (10 x 2s). This Practical rule of thumb ensures the crawler's load is proportional to the host's capacity.

**Layer 3: IP-Based Rate Limiting**

Multiple virtual hosts can share a single IP address (shared hosting). Fetching from `siteA.example.com` and `siteB.example.com` at 1 req/sec each creates 2 req/sec to the same physical server. The politeness engine maintains an IP-to-host mapping and enforces an aggregate rate limit per IP address.

### The Politeness-Freshness Tension

Politeness directly conflicts with freshness. A news site's homepage changes every 5 minutes, but the politeness constraint allows only one request per second to that host. With a 1-second delay, the crawler can fetch 3,600 pages/hour from that host — but the homepage is just one of those 3,600. If the site has 1 million pages, the homepage will be recrawled at most once every ~278 hours at the default politeness level.

**Resolution:** Priority queues ensure the homepage (high change frequency + high importance) is near the front of the back queue for that host. The crawler cannot fetch it more often than once per crawl-delay, but it can ensure the homepage is among the first pages fetched in each politeness window.

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| robots.txt cache corruption | All URLs for affected hosts are either blocked or unblocked incorrectly | Independent robots.txt refresh thread; cache integrity checks |
| Adaptive delay miscalculation | Crawler overwhelms slow hosts or under-utilizes fast hosts | Bound delay to [1s, 300s] range; log anomalies for review |
| IP-to-host mapping stale | Shared hosting overloaded (IP changed, new host added) | Periodic DNS re-resolution; event-driven mapping updates on fetch errors |
| Crawl-delay directive conflict | Different robots.txt rules specify conflicting delays | Use the most restrictive delay (max of all applicable rules) |

---

## Critical Component 3: Content Deduplication Pipeline — The Efficiency Guard

### Why It Is Critical

The web is full of duplicate content. Mirror sites, syndicated articles, printer-friendly versions, session-ID URL variants, and www vs. non-www versions all create duplicate pages. Without deduplication, the crawler wastes bandwidth fetching identical content, the content store bloats with redundant copies, and the downstream indexer must process (and rank) duplicates. At 1 billion pages/day, even 10% duplicates means 100 million wasted fetches — the equivalent of roughly 5 TB of wasted bandwidth per day.

### Three-Stage Deduplication

**Stage 1: URL Normalization (Pre-fetch)**

Before a URL is even enqueued in the frontier, it is normalized to a canonical form. This catches syntactic duplicates:
- `HTTP://Example.COM/Path` → `http://example.com/Path`
- `http://example.com/a/../b` → `http://example.com/b`
- `http://example.com/page?b=2&a=1` → `http://example.com/page?a=1&b=2`
- `http://example.com/page#section` → `http://example.com/page`

After normalization, the URL hash is checked against the Bloom filter. This is the cheapest dedup check: O(1) time, no network call.

**Stage 2: Exact Content Hash (Post-fetch)**

After fetching, the page content is hashed (MD5 or SHA-256). The hash is compared against the content dedup store. If an exact match exists, the page is a duplicate — it is not stored again, but the URL-to-content mapping is updated.

This catches cases where different URLs serve identical content (mirrors, URL variants not caught by normalization).

**Stage 3: Near-Duplicate Detection via SimHash (Post-fetch)**

Many duplicate pages are not byte-for-byte identical. They differ in headers, footers, timestamps, ad blocks, or minor edits. SimHash fingerprinting detects these near-duplicates:

1. Compute the 64-bit SimHash of the page's text content (after stripping HTML tags, scripts, and styles)
2. Query the SimHash index for existing pages within a Hamming distance of 3
3. If a near-duplicate is found, mark the URL as a near-duplicate of the canonical version

The SimHash index uses a multi-probe lookup: the 64-bit fingerprint is divided into B blocks (e.g., 4 blocks of 16 bits), and B separate hash tables are queried, one per block permutation. This enables O(1) amortized lookup for near-duplicates.

### Slowest part of the process: SimHash Index at Scale

With 10 billion unique pages, the SimHash index must store 10 billion 64-bit fingerprints. At 8 bytes each, this is 80 GB of fingerprints alone. The multi-probe index structure multiplies this by B (block count), giving ~320 GB for a 4-block index. This fits in memory on a single large machine or is easily partitioned across a small cluster.

The real Slowest part of the process is query latency under concurrent updates. Each new page requires both a lookup (is there a near-duplicate?) and an insert (add the new fingerprint). At 11,500 pages/second, this is 23,000 index operations/second. Partitioning by the first block's hash distributes load across machines.

---

## Spider Trap Detection

### How Traps Arise

Spider traps are not always malicious. Common causes:

| Trap Type | Example | Pattern |
|-----------|---------|---------|
| Calendar pages | `/calendar/2025/01/01`, `/calendar/2025/01/02`, ... infinitely into the future | Incrementing date in URL path |
| Session IDs | `/page?sid=abc123`, `/page?sid=def456` (each visit generates a new URL) | Random parameter values creating infinite URL space |
| Infinite directory depth | `/a/a/a/a/a/a/...` (each page links to a deeper version) | Repeating path segments |
| Faceted navigation | `/products?color=red&size=M&brand=X&...` (combinatorial explosion of filters) | Exponential query parameter combinations |
| Soft 404s | Server returns 200 OK for any URL, including non-existent pages | `/anything/goes/here` returns a generic page with links |

### Detection Heuristics

```
FUNCTION detect_spider_trap(url, host_stats):
    // Practical rule of thumb 1: URL depth exceeds threshold
    IF count_path_segments(url) > MAX_PATH_DEPTH:  // e.g., 15
        RETURN TRAP_DETECTED("excessive_depth")

    // Practical rule of thumb 2: URL length exceeds threshold
    IF length(url) > MAX_URL_LENGTH:  // e.g., 2048 characters
        RETURN TRAP_DETECTED("excessive_length")

    // Practical rule of thumb 3: Repeating path segments
    segments = split_path(url)
    IF has_repeating_pattern(segments):  // e.g., /a/b/a/b/a/b
        RETURN TRAP_DETECTED("repeating_segments")

    // Practical rule of thumb 4: Host URL budget exceeded
    IF host_stats.urls_discovered > HOST_URL_BUDGET:  // e.g., 500,000
        RETURN TRAP_DETECTED("host_budget_exceeded")

    // Practical rule of thumb 5: High ratio of new URLs from this host with identical content
    IF host_stats.unique_content_ratio < 0.1:  // <10% unique content
        RETURN TRAP_DETECTED("low_content_uniqueness")

    // Practical rule of thumb 6: Known trap URL patterns (regex-based blocklist)
    IF matches_trap_pattern(url):
        RETURN TRAP_DETECTED("pattern_match")

    RETURN ALLOWED
```

---

## Slowest part of the process Analysis

| Slowest part of the process | Symptom | Root Cause | Mitigation |
|-----------|---------|------------|------------|
| DNS resolution throughput | Fetchers idle waiting for DNS responses | Upstream DNS resolvers rate-limited; cache miss rate too high | Local caching resolver with aggressive TTL; pre-resolve URLs in the near-term fetch queue; use multiple upstream resolvers |
| Per-host politeness ceiling | High-value hosts (news sites) cannot be crawled fast enough | robots.txt Crawl-delay or adaptive delay limits throughput to 1 req/sec per host | Prioritize important pages within the per-host budget; nothing can bypass the politeness constraint (this is by design) |
| Frontier dequeue contention | Fetchers block waiting for frontier partition to serve URLs | Hot partition receives disproportionate traffic; heap lock contention | Partition frontier by host hash; each partition serves independently; batch dequeue (50-100 URLs per call) |
| Bloom filter false positives | New URLs incorrectly rejected as duplicates | Bloom filter nearing capacity; accumulated dead entries | Periodic Bloom filter rebuild from URL database; scale to lower false positive rate |
| Content store write throughput | Fetched pages queue up waiting for storage | Object storage write latency under load | Buffered writes with local disk as WAL; batch uploads to object storage |
| Network bandwidth saturation | Fetcher workers cannot open new connections | Outbound bandwidth fully utilized | Add fetcher workers in additional data centers; compress transfers where possible |
| SimHash index hot spots | Near-duplicate queries slow down for popular content fingerprints | Many pages cluster around similar SimHash values (boilerplate content) | Partition SimHash index by fingerprint prefix; use dedicated hot-key handling |
| robots.txt 5xx storm | Large CDN outage causes robots.txt fetches to fail for millions of hosts | All hosts behind the CDN become un-crawlable simultaneously | Serve cached robots.txt beyond TTL during outage (stale-while-revalidate); alert on mass robots.txt failure rate |
| Redirect chain explosion | Site migration creates 10-level redirect chains consuming fetcher connections | Each redirect is a separate HTTP request, multiplying latency | Hard cap at 10 redirects; track redirect chain origins for bulk resolution |

---

## Failure Mode Analysis

### Failure Mode 1: Bloom Filter Capacity Overflow

**Trigger:** URL discovery rate exceeds expectations; Bloom filter reaches capacity (false positive rate exceeds 5%).

**Cascade:**
1. False positive rate climbs → genuinely new URLs are rejected as "already seen"
2. Coverage drops silently — no error, just missing pages
3. The frontier appears healthy (queue depths normal), but new URL injection rate drops
4. Freshness degrades as recrawl dominates the frontier (no new URLs entering)

**Detection:**
- Monitor Bloom filter fill ratio (entries / capacity)
- Track new URL injection rate — sudden drop indicates capacity issue
- Compare discovered URL count (from parsers) vs. frontier enqueue count — growing gap indicates rejection

**Resolution:**
- Trigger Bloom filter rebuild from URL database with 2x capacity
- During rebuild, run parallel old + new filters; union results
- Rebuild takes ~30 minutes for 10B entries; serve from old filter during rebuild

### Failure Mode 2: DNS Resolver Cache Poisoning

**Trigger:** An upstream DNS resolver returns a poisoned record, directing the crawler to a malicious IP for a legitimate domain.

**Cascade:**
1. Crawler fetches pages from malicious server instead of legitimate host
2. Poisoned content enters the content store
3. If the poisoned domain is high-value (news site, government), corrupted content reaches the index
4. DNS cache TTL means poisoned entries persist for hours

**Prevention:**
- Use DNSSEC-validating resolvers
- Cross-validate DNS responses across multiple upstream resolvers
- Monitor for sudden IP changes on high-value domains (alert if a top-10K domain resolves to a new IP)
- Content integrity check: if fetched content's SimHash differs drastically from the previous crawl, flag for review

### Failure Mode 3: Frontier Partition Split-Brain

**Trigger:** Network partition between primary and standby frontier partitions; both believe they are the primary.

**Cascade:**
1. Both partitions serve URLs to fetchers → same URLs fetched twice
2. Politeness violation: fetchers from both partitions hit the same host simultaneously, doubling the request rate
3. Host detects excessive crawl rate → blocks crawler IP range
4. Coverage loss for all hosts on that partition

**Prevention:**
- Fencing tokens on frontier lease: each partition has a monotonically increasing epoch; fetchers reject URLs from a partition with a stale epoch
- Partition membership managed by consensus service (3-node cluster)
- On split-brain detection: both partitions freeze and wait for consensus resolution
- Post-recovery: reconcile partition state; de-duplicate any double-fetched URLs

### Failure Mode 4: Crawl Budget Exhaustion by Low-Value Pages

**Trigger:** The priority signals (PageRank, change frequency) are stale or miscalibrated. Low-value pages consume the crawl budget while high-value pages go stale.

**Cascade:**
1. Freshness SLO for top-1M pages degrades
2. Search quality drops — users see stale results for news, product listings
3. Business impact: user dissatisfaction, advertiser complaints

**Detection:**
- Monitor freshness distribution: median and p90 age of last crawl for top-1M, top-10M, all pages
- Track priority signal freshness: when were PageRank and change frequency last updated?
- Compare actual change rates (observed at crawl time) with predicted change rates (used for scheduling)

**Resolution:**
- Emergency priority recalculation: batch PageRank recomputation over the link graph
- Short-term: boost priority of pages with high observed change frequency
- Long-term: recrawl scheduler should self-correct using observed change data within 2-3 crawl cycles

---

## Algorithm Complexity Analysis

### Frontier Operations

| Operation | Time Complexity (Speed of the algorithm) | Space Complexity (Memory usage of the algorithm) | Notes |
|---|---|---|---|
| Front queue enqueue | O(log K) | O(1) | K = number of priority levels (4-8); priority classification |
| Front queue dequeue | O(1) amortized | O(1) | Biased random selection across K queues |
| Back queue dequeue (heap pop) | O(log Q) | O(1) | Q = number of back queues (~10,000) |
| Back queue re-insert (heap push) | O(log Q) | O(1) | After updating next_fetch_time |
| Bloom filter insert/query | O(k) | O(m) | k = hash functions (~7); m = bit array size (~12 GB) |
| URL normalization | O(L) | O(L) | L = URL length; dominated by path resolution |
| Host-to-queue mapping lookup | O(1) | O(H) | H = active hosts; hash table |

### Deduplication Operations

| Operation | Time Complexity (Speed of the algorithm) | Space Complexity (Memory usage of the algorithm) | Notes |
|---|---|---|---|
| Exact content hash (SHA-256) | O(P) | O(1) | P = page size; streamed computation |
| SimHash computation | O(T) | O(1) | T = number of tokens in page text |
| SimHash near-duplicate query | O(B) | O(N × B) | B = number of blocks (4); N = total fingerprints (10B) |
| SimHash insert | O(B) | O(B) | Insert into B hash tables |

### Recrawl Scheduling

```
Recrawl priority computation:

  FUNCTION compute_recrawl_priority(url_metadata):
    // Multi-armed bandit approach: balance exploration vs. exploitation

    // Exploitation: recrawl pages known to change frequently
    change_score = url_metadata.observed_change_rate * CHANGE_WEIGHT

    // Exploration: occasionally recrawl pages with unknown change rate
    IF url_metadata.crawl_count < 3:
      exploration_bonus = EXPLORATION_BONUS * (1 / url_metadata.crawl_count)
    ELSE:
      exploration_bonus = 0

    // Importance: PageRank-like score
    importance_score = url_metadata.page_rank * IMPORTANCE_WEIGHT

    // Staleness: how long since last crawl
    staleness = (now() - url_metadata.last_crawled_at) / url_metadata.expected_change_interval
    staleness_score = min(staleness, 5.0) * STALENESS_WEIGHT  // cap at 5x overdue

    RETURN change_score + exploration_bonus + importance_score + staleness_score
```

---

## Race Conditions

### Race Condition 1: Concurrent URL Discovery from Multiple Fetchers

**Scenario:** Fetcher A and Fetcher B both discover URL X on different pages at nearly the same time. Both submit URL X to the frontier for enqueue.

**Resolution:** The Bloom filter provides probabilistic deduplication: the first enqueue succeeds and sets the Bloom filter bits. The second enqueue queries the Bloom filter, finds the URL already "seen," and drops it. If the Bloom filter returns a false negative (due to timing — bits not yet visible across partitions), the duplicate URL is enqueued twice. This is harmless: the second fetch wastes one request but the content dedup catches the duplicate content.

### Race Condition 2: robots.txt Update During Active Crawl

**Scenario:** A site owner updates robots.txt to disallow `/private/`. The crawler has already enqueued 100 URLs matching `/private/*` in the frontier, and 10 are being actively fetched.

**Resolution:** The politeness engine re-checks robots.txt before every fetch (cache TTL typically 24 hours). URLs already in the frontier are NOT retroactively filtered — this would require scanning all queued URLs (too expensive). Instead:
1. When a URL is dequeued for fetching, the robots.txt check runs with the cached version
2. When the robots.txt cache refreshes (at TTL expiry), the new rules take effect for subsequent dequeues
3. URLs that were fetched before the robots.txt update are already fetched — the crawler cannot "un-fetch" them
4. The content store can be post-filtered if the site owner requests removal

### Race Condition 3: Frontier Checkpoint During Active Dequeue

**Scenario:** The frontier checkpoints its state to disk while fetchers are actively dequeuing URLs. Some URLs are "checked out" (dequeued but not yet acknowledged as fetched).

**Resolution:** The checkpoint includes the checked-out URL list with their lease timestamps. On recovery from a checkpoint, URLs whose lease has expired are re-enqueued. URLs whose lease is still active are left in checked-out state until the lease expires or the fetcher acknowledges.

---

## Edge Cases

### Edge Case (Unusual or extreme situation) 1: Host With Millions of Identical Pages (Content Farm)

A content farm generates 10 million pages with near-identical content (template pages with slight variations). Each page has unique URLs.

**Expected behavior:** URL normalization won't catch these (URLs are genuinely different). The Bloom filter won't catch them (different URLs). The exact content hash will catch identical pages. SimHash will catch near-duplicates. The key defense is the per-host URL budget: after 500,000 URLs from this host, the frontier stops accepting new URLs. Combined with the content uniqueness monitor (< 10% unique content triggers a trap flag), the host is deprioritized.

### Edge Case (Unusual or extreme situation) 2: Legitimate Massive Site (Wikipedia, Government Archives)

Wikipedia has 60+ million articles across all languages. The per-host URL budget (500,000) would artificially limit coverage of a legitimate site.

**Expected behavior:** The URL budget is configurable per host. A whitelist of known-legitimate massive sites (identified by domain reputation, editorial review, or automation based on content uniqueness ratio > 80%) have their budget increased to match the site's actual size. Wikipedia might have a budget of 100 million URLs.

### Edge Case (Unusual or extreme situation) 3: Site Using Only JavaScript Rendering

A single-page application (SPA) returns an empty HTML shell with JavaScript that renders all content client-side. The crawler's HTML parser finds no links.

**Expected behavior:** The base crawler marks this page as "JS-required" and routes it to the headless rendering pipeline (out of scope for the base crawler, but the detection is in scope). Detection: if the fetched HTML contains < 100 bytes of visible text but > 10 KB of JavaScript, flag as JS-rendered. The URL is re-queued with a "render-required" flag for the rendering farm.

---

## Real-World Case Study: News Crawling at Scale

### Context
A major search engine operates a dedicated news crawling tier that must maintain < 5-minute freshness for the top 50,000 news sites globally, while the general web crawl maintains < 30-day freshness.

### Architecture Specialization

**Dedicated news frontier:** The news tier has its own frontier with aggressive priority settings: news homepages are recrawled every 2-5 minutes; article pages discovered on homepages are fetched within 30 seconds of discovery. The politeness constraint is the binding limit: at 1 req/sec per host, recrawling a news homepage every 2 minutes consumes 0.5% of the host's crawl budget.

**Feed-based discovery:** For sites that publish RSS/Atom feeds, the crawler monitors feeds (every 1-5 minutes) to discover new articles without crawling the full site. Feed monitoring is cheaper than page crawling: a single feed request returns 20-50 new article URLs.

**Conditional GET optimization:** The news crawler uses `If-Modified-Since` headers aggressively. If the server returns 304 Not Modified, the crawler avoids downloading the full page, saving bandwidth. At 50,000 sites x 288 recrawls/day = 14.4 million recrawl requests/day, conditional GET with a 70% 304 rate saves ~500 GB/day of bandwidth.

**Priority inversion under load:** During breaking news events (elections, natural disasters), multiple news sites publish high-priority content simultaneously. The crawler's fixed per-host rate limits prevent it from crawling all sites fast enough. Solution: a "breaking news mode" that temporarily doubles the priority of news sites and pre-allocates fetcher workers to the news tier. The general crawl's throughput drops by ~10% during breaking news mode.

---

## Deep Dive 5: IP-Based Aggregate Throttling for Shared Hosting

### The Problem

Per-host politeness is necessary but insufficient. Many small websites share a single physical server behind one IP address (shared hosting, CDN origin pools, cloud hosting platforms). If the crawler has 100 hosts mapped to the same IP, each with a 1-second crawl delay, the aggregate request rate to that IP is 100 req/sec — enough to overwhelm the shared server and trigger abuse detection.

### Architecture

```
FUNCTION enforce_ip_aggregate_throttle(host, ip_address):
    // Step 1: Look up all hosts sharing this IP
    shared_hosts = get_hosts_for_ip(ip_address)

    // Step 2: Compute aggregate request rate to this IP
    IF LENGTH(shared_hosts) > IP_SHARING_THRESHOLD:  // e.g., 5 hosts
        // Apply IP-level rate limiting
        max_rps_for_ip = IP_AGGREGATE_RATE_LIMIT  // e.g., 10 req/sec
        per_host_share = max_rps_for_ip / LENGTH(shared_hosts)
        adjusted_delay = MAX(host.crawl_delay, 1.0 / per_host_share)
        RETURN adjusted_delay
    ELSE:
        // Few hosts on this IP — per-host delay is sufficient
        RETURN host.crawl_delay
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IP-to-host mapping source | DNS resolution results (cached) | Already available from the DNS cache; no additional infrastructure needed |
| Mapping freshness | Updated on every DNS cache refresh | IPs can change; must reflect current state |
| Aggregate rate limit | 10 req/sec per IP (configurable) | Conservative default; CDNs and cloud hosting can handle more |
| Override mechanism | Allowlist of known CDN IP ranges | CDN IPs serve many unrelated hosts; aggregate throttling would cripple crawling behind CDNs |

### Complexity

This creates a three-level politeness hierarchy:
1. **Per-host rate limiting** (from robots.txt or adaptive): governs individual host crawl pace
2. **Per-IP aggregate throttling**: governs total load on a shared physical server
3. **Global crawl throughput ceiling**: governs total outbound bandwidth from the crawler fleet

All three levels are enforced simultaneously; the most restrictive wins.

---

## Deep Dive 6: Conditional GET and Bandwidth Optimization

### The Mechanism

For recrawls, the crawler sends conditional HTTP requests to avoid downloading unchanged content:

| Header | Value | Purpose |
|--------|-------|---------|
| `If-Modified-Since` | `last_crawled_at` timestamp from URL record | Server returns 304 if content hasn't changed since this date |
| `If-None-Match` | `last_etag` from URL record | Server returns 304 if the ETag matches (more precise than timestamp) |
| `Accept-Encoding: gzip, br` | Always | Compress response to save bandwidth |

### Bandwidth Impact

| Scenario | Pages/Day | Avg Page Size | Bandwidth | With Conditional GET (70% 304 rate) |
|----------|-----------|--------------|-----------|--------------------------------------|
| All recrawls | 600M | 50 KB | 30 TB/day | 9 TB/day (70% saved) |
| New discovery | 400M | 50 KB | 20 TB/day | 20 TB/day (no savings) |
| **Total** | **1B** | **50 KB** | **50 TB/day** | **29 TB/day (42% savings)** |

### Limitations

- Not all servers support conditional GET (many return 200 regardless)
- Some servers modify `Last-Modified` on every request (dynamic pages)
- CDN-served content may have different caching semantics
- ETag formats vary across server implementations (weak vs. strong ETags)

---

## Deep Dive 7: Handling the JavaScript Rendering Gap

### The Problem

Over 60% of the modern web uses JavaScript frameworks (React, Angular, Vue) that render content client-side. A traditional HTTP-only crawler fetching these pages receives an empty or minimal HTML shell with no meaningful content and no discoverable links. This creates a growing coverage gap.

### Detection Strategy

```
FUNCTION detect_js_dependency(html_content, url):
    // Signal 1: Low visible text content
    visible_text = extract_visible_text(html_content)
    IF LENGTH(visible_text) < MIN_TEXT_THRESHOLD:  // e.g., 100 characters
        js_score += 0.4

    // Signal 2: Heavy JavaScript payload
    js_bytes = count_script_tag_bytes(html_content)
    html_ratio = js_bytes / LENGTH(html_content)
    IF html_ratio > 0.7:  // >70% of page is JavaScript
        js_score += 0.3

    // Signal 3: Framework signatures
    IF contains_any(html_content, ["__NEXT_DATA__", "ng-app", "data-reactroot", "nuxt"]):
        js_score += 0.3

    // Signal 4: No discoverable links in static HTML
    link_count = count_anchor_tags(html_content)
    IF link_count < 3:
        js_score += 0.2

    IF js_score >= JS_RENDER_THRESHOLD:  // e.g., 0.5
        RETURN REQUIRES_RENDERING
    ELSE:
        RETURN STATIC_HTML_SUFFICIENT
```

### Rendering Pipeline Integration

| Aspect | Static Crawler | Rendering Pipeline |
|--------|---------------|-------------------|
| Processing time per page | 200ms | 3-5 seconds |
| Resource cost per page | ~$0.00001 | ~$0.0005 (50x) |
| Throughput per worker | 200 pages/sec | 0.2-0.3 pages/sec |
| Memory per worker | 8 GB | 32 GB (headless browser) |
| Link discovery coverage | ~40% of modern web | >95% of modern web |
| When to use | Default for all pages | Only for pages detected as JS-dependent |

The base crawler detects JS-dependent pages and routes them to the rendering pipeline. The rendering pipeline is architecturally separate: it maintains its own pool of headless browser instances, its own queue of render jobs, and returns rendered HTML back to the link extraction pipeline. This separation prevents the 50x cost differential from affecting the base crawler's throughput.
